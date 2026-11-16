import type { Action, Report, SimulateBattleResponse, StateResponse } from "../shared/api.js";
import { HAMLET_RETRY_TICKS, SCOUT_RETRY_TICKS, usableScoutObservation, type ScoutObservation, type ScoutingContext } from "./scout-dispatch.js";
import type { AdvisorContext, Proposal } from "./types.js";

export interface RaidAttempt {
  scope: string;
  villageId: string;
  targetId: string;
  reportId: string;
  sentTick: number;
}
export interface RaidAssessment {
  scope: string;
  reportId: string;
  tick: number;
  battle: SimulateBattleResponse;
  unit?: "raider" | "lancer";
  baseDefense?: number;
}
export interface RaidContext {
  attempts: RaidAttempt[];
  assessments: RaidAssessment[];
}
/** Full detail must agree with the journal-linked summary; a summary never supplies intel. */
export function usableRaidIntel(o: ScoutObservation, state: StateResponse, scouting: ScoutingContext): o is ScoutObservation & { detail: Report } {
  const d = o.detail, r = o.report;
  if (!usableScoutObservation(o, state, scouting.map, scouting.scope) || !d || !r || !d.intel ||
      d.id !== r.id || d.commandId !== r.commandId || d.tick !== r.tick || d.kind !== "scouting" ||
      d.role !== "attacker" || d.outcome !== "scouted" || d.attacker.id !== o.villageId ||
      d.attacker.ownerId !== state.player.id || d.defender.id !== o.targetId || d.defender.ownerId !== o.targetOwnerId ||
      d.scouts?.sent !== 2 || d.scouts.lost !== 0) return false;
  const intel = d.intel;
  return [intel.resources, intel.buildings, intel.unitsHome, intel.supportTotal].every(x =>
    x !== null && typeof x === "object" && !Array.isArray(x) &&
    Object.values(x).every(n => Number.isSafeInteger(n) && n >= 0)) &&
    ["timber", "stone", "iron"].every(r => Number.isSafeInteger(intel.resources[r as keyof typeof intel.resources])) &&
    Number.isSafeInteger(intel.buildings.wall) && Number.isSafeInteger(intel.buildings.cellar);
}

/** A neutral target needs our own scoped victory; scouting does not reveal militia.
 * Project the live militia rule through arrival and pass it to the authoritative simulator. */
export function hamletArrivalDefense(o: ScoutObservation, state: StateResponse, rules: AdvisorContext["rules"], travel: number): number | undefined {
  const b = o.clearing;
  const map = rules.rules.MAP as { hamletBaseDefense: number; hamletMilitiaCap: number; hamletMilitiaPerTick: number };
  if (!b || b.kind !== "battle" || b.role !== "attacker" || b.outcome !== "won" || b.conquered ||
      b.attacker.ownerId !== state.player.id || b.defender.id !== o.targetId || b.defender.ownerId !== null ||
      !b.commandId || !Number.isSafeInteger(b.tick) || b.tick < 0 || b.tick > (o.report?.tick ?? -1) ||
      !map || ![map.hamletBaseDefense, map.hamletMilitiaCap, map.hamletMilitiaPerTick].every(n => Number.isFinite(n) && n >= 0)) return;
  return Math.ceil(map.hamletBaseDefense + Math.min(map.hamletMilitiaCap, map.hamletMilitiaPerTick * (state.world.tick + travel - b.tick)));
}

/** Bounded raids use scouted house bots or a cleared neutral hamlet with arrival-time militia. */
export function evaluateRaidExecution({ state, rules }: AdvisorContext, scouting?: ScoutingContext, raids?: RaidContext): Proposal<Extract<Action, { type: "send" }>>[] {
  if (!scouting || !raids || state.world.status !== "running" || rules.version !== state.world.rulesVersion ||
      (state.player.protectedUntilTick ?? 0) > state.world.tick || (state.player.nextActTick ?? 0) > state.world.tick ||
      state.scheduled.length || state.commands.outgoing.some(c => c.kind === "attack" && Object.entries(c.units).some(([unit, n]) => unit !== "scout" && n > 0))) return [];

  const proposals: Proposal<Extract<Action, { type: "send" }>>[] = [];
  for (const v of state.villages) {
    if ((v.units.home.pikeman ?? 0) < 10 || (v.units.home.shieldman ?? 0) < 5 ||
        v.buildQueue.length ||
        Object.values(v.orders).some(q => q.length) || state.commands.incoming.some(c => c.kind === "attack" && c.to.id === v.id)) continue;
    for (const o of scouting.observations) {
      if (o.villageId !== v.id || !usableRaidIntel(o, state, scouting)) continue;
      const target = scouting.map.villages.find(t => t.id === o.targetId)!;
      const owner = scouting.map.players.find(p => p.id === target.ownerId);
      const unit = target.ownerId === null ? "lancer" : "raider";
      if (target.ownerId !== null && (!owner?.houseBot || (owner.protectedUntilTick ?? 0) > state.world.tick)) continue;
      const count = unit === "lancer" ? 30 : 10;
      // Queued recruits are never counted toward the dispatch or home garrison.
      if ((v.units.home[unit] ?? 0) < count || (v.units.away[unit] ?? 0) > 0) continue;
      const speed = (rules.rules.UNITS as Record<string, { speed: number }>)[unit]?.speed;
      if (!Number.isFinite(speed) || speed <= 0) continue;
      const travel = Math.ceil(Math.hypot(target.x - v.x, target.y - v.y) * speed);
      if (!Number.isSafeInteger(travel) || travel < 1 || travel > 300 ||
          state.world.tick + travel - o.detail.tick > 300 || state.world.tick + 2 * travel + 60 > state.world.endsAtTick) continue;
      const baseDefense = unit === "lancer" ? hamletArrivalDefense(o, state, rules, travel) : undefined;
      if (unit === "lancer" && baseDefense === undefined) continue;
      // A single successful scouting report authorizes at most one raid, including uncertain sends.
      if (raids.attempts.some(a => a.scope === scouting.scope && (a.reportId === o.detail.id ||
          (a.villageId === v.id && state.world.tick - a.sentTick < (unit === "lancer" ? HAMLET_RETRY_TICKS : SCOUT_RETRY_TICKS))))) continue;
      const intel = o.detail.intel!;
      if (intel.buildings.wall !== 0 || Object.values(intel.unitsHome).some(n => n > 0) || Object.values(intel.supportTotal).some(n => n > 0)) continue;
      const assessment = raids.assessments.find(a => a.scope === scouting.scope && a.reportId === o.detail.id && a.tick === state.world.tick && (a.unit ?? "raider") === unit);
      if (unit === "lancer" && assessment?.baseDefense !== baseDefense) continue;
      const b = assessment?.battle;
      if (!b || b.winner !== "attacker" || !b.loot || Object.values(b.attackerLost).some(n => n !== 0) ||
          b.attackerSurvivors[unit] !== count || !Number.isFinite(b.strength.attack) || !Number.isFinite(b.strength.defense) ||
          b.strength.attack <= 0 || b.strength.defense < 0 || b.strength.attack < 2 * b.strength.defense ||
          !Object.values(b.loot).every(n => Number.isSafeInteger(n) && n >= 0) ||
          Object.values(b.loot).reduce((n, x) => n + x, 0) < 60) continue;
      // Loot is credited on return. Reserve room for production over the whole trip,
      // without assuming another advisor will spend resources while this army is out.
      if ((["timber", "stone", "iron"] as const).some(r =>
        v.resourcesMilli[r] + 2 * travel * v.productionPerTickMilli[r] + b.loot![r] * 1000 > v.storage * 1000)) continue;
      proposals.push({ id: `${state.world.epoch}:${v.id}:raid:${o.detail.id}`, advisor: "military", villageId: v.id, villageName: v.name,
        action: { type: "send", village: v.id, target: target.id, kind: "attack", units: { [unit]: count } },
        buildingName: `Raid ${target.name}`, currentLevel: v.units.home[unit] ?? 0, targetLevel: count, importance: 71,
        reason: `Send ${count} ${unit === "lancer" ? "Lancers" : "Raiders"} once using scouting report ${o.detail.id}. Full intel shows no home/support defenders or wall; the authoritative report-based simulation predicts zero losses and at least 60 loot with a twofold strength margin. Keep ten Pikemen and five Shieldmen home. Neutral targets additionally require our recorded victory and arrival-time militia assessment. Historical intel cannot guarantee arrival conditions.`,
        requirements: { timber: 0, stone: 0, iron: 0 }, blockers: [], status: "ready", affordableAtTick: state.world.tick });
    }
  }
  return proposals;
}
