import type { MapResponse, Report, ReportSummary, StateResponse } from "../shared/api.js";
import type { AdvisorContext, Proposal } from "./types.js";

export const SCOUT_REPORT_MAX_AGE = 300;
export const SCOUT_RETRY_TICKS = 600;
export const HAMLET_RETRY_TICKS = 120;
export interface ScoutObservation {
  scope: string;
  villageId: string;
  targetId: string;
  targetOwnerId: string | null;
  sentTick: number;
  commandId?: string;
  report?: ReportSummary;
  detail?: Report;
  /** Own authoritative victory establishing the hamlet militia reset. */
  clearing?: Report;
}
export interface ScoutingContext {
  scope: string;
  map: MapResponse;
  observations: ScoutObservation[];
  /** Scoped reports already consumed by a durable raid attempt. */
  consumedReportIds?: readonly string[];
}
/** Reports have no epoch field: only a report linked to our journalled command has provenance. */
export function usableScoutObservation(observation: ScoutObservation, state: StateResponse, map: MapResponse, scope: string): boolean {
  const report = observation.report;
  const target = map.villages.find(v => v.id === observation.targetId);
  return observation.scope === scope && !!report && !!observation.commandId &&
    report.commandId === observation.commandId && report.kind === "scouting" && report.role === "attacker" && report.outcome === "scouted" &&
    report.attacker.id === observation.villageId && report.attacker.ownerId === state.player.id &&
    report.defender.id === observation.targetId && report.defender.ownerId === observation.targetOwnerId &&
    target?.ownerId === observation.targetOwnerId && target.ownerId !== state.player.id &&
    Number.isSafeInteger(report.tick) && report.tick >= observation.sentTick && report.tick <= state.world.tick &&
    state.world.tick - report.tick <= SCOUT_REPORT_MAX_AGE &&
    Number.isSafeInteger(map.tick) && map.tick <= state.world.tick && state.world.tick - map.tick <= 30 &&
    Number.isSafeInteger(map.snapshotTick) && map.snapshotTick <= map.tick && state.world.tick - map.snapshotTick <= 30;
}

/** One pair of Scouts, a nearby house bot or previously cleared hamlet, no human targets. */
export function evaluateScoutDispatch({ state, rules }: AdvisorContext, scouting?: ScoutingContext): Proposal[] {
  if (!scouting || state.world.status !== "running" || (state.player.protectedUntilTick ?? 0) > state.world.tick) return [];
  const { map, scope, observations } = scouting;
  if (!Number.isSafeInteger(map.tick) || map.tick > state.world.tick || state.world.tick - map.tick > 30 ||
      !Number.isSafeInteger(map.snapshotTick) || map.snapshotTick > map.tick || state.world.tick - map.snapshotTick > 30) return [];
  const speed = (rules.rules.UNITS as Record<string, { speed: number }>).scout?.speed;
  if (!Number.isFinite(speed) || speed <= 0 || rules.version !== state.world.rulesVersion) return [];
  // Global reconnaissance remains bounded even across villages and returning commands.
  if (state.commands.outgoing.some(c => (c.units.scout ?? 0) > 0) || state.scheduled.length) return [];
  const proposals: Proposal[] = [];
  for (const v of state.villages) {
    const owned = (unit: "pikeman" | "shieldman" | "raider") => (v.units.home[unit] ?? 0) + (v.units.away[unit] ?? 0);
    if ((v.units.home.scout ?? 0) < 2 || (v.units.away.scout ?? 0) > 0 || owned("pikeman") < 10 || owned("shieldman") < 5 || owned("raider") < 10) continue;
    // Recruitment adds future troops; dispatch uses only the forces already home.
    // Construction still defers commands because it can change production/headroom.
    if (v.buildQueue.length || v.orders.build.length || v.orders.train.length || v.orders.raids.length || v.orders.paused.length) continue;
    if (state.commands.incoming.some(c => c.kind === "attack" && c.to.id === v.id)) continue;
    if ((state.player.nextActTick ?? state.world.tick) > state.world.tick) continue;
    const target = map.villages.filter(t => {
      if (t.ownerId === state.player.id || t.id === v.id) return false;
      const retry = t.ownerId === null ? HAMLET_RETRY_TICKS : SCOUT_RETRY_TICKS;
      if (observations.some(o => o.scope === scope && o.villageId === v.id && state.world.tick - o.sentTick < retry)) return false;
      if (t.ownerId === null) {
        if ((v.units.home.lancer ?? 0) < 30 || !observations.some(o =>
          o.scope === scope && o.targetId === t.id && o.clearing?.outcome === "won" && o.clearing.defender.ownerId === null)) return false;
      } else {
        const player = map.players.find(p => p.id === t.ownerId);
        if (!player?.houseBot || (player.protectedUntilTick ?? 0) > state.world.tick) return false;
      }
      const distance = Math.hypot(t.x - v.x, t.y - v.y);
      const travel = Math.ceil(distance * speed);
      if (!Number.isSafeInteger(travel) || travel < 1 || travel > 300 || state.world.tick + 2 * travel + 60 > state.world.endsAtTick) return false;
      // Reconnaissance must leave a usable raid window after the report arrives.
      // Preserve the separate Scout return check; the combat force may leave while
      // Scouts are returning. Use live speeds and the raid policy's 60-tick margin.
      const raidSpeed = (rules.rules.UNITS as Record<string, { speed: number }>)[t.ownerId === null ? "lancer" : "raider"]?.speed;
      const raidTravel = Math.ceil(distance * raidSpeed);
      if (!Number.isFinite(raidSpeed) || raidSpeed <= 0 || !Number.isSafeInteger(raidTravel) || raidTravel < 1 || raidTravel > 300 ||
          state.world.tick + travel + 2 * raidTravel + 60 > state.world.endsAtTick) return false;
      return !observations.some(o => o.targetId === t.id && usableScoutObservation(o, state, map, scope) &&
        !(t.ownerId === null && scouting.consumedReportIds?.includes(o.report!.id)));
    }).sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y) || a.id.localeCompare(b.id))[0];
    if (!target) continue;
    proposals.push({ id: `${state.world.epoch}:${v.id}:scout:${target.id}`, advisor: "military", villageId: v.id, villageName: v.name,
      action: { type: "send", village: v.id, target: target.id, kind: "attack", units: { scout: 2 } },
      buildingName: `Scout ${target.name}`, currentLevel: v.units.home.scout ?? 0, targetLevel: 2, importance: 72,
      reason: "Dispatch two Scouts to a nearby unprotected house bot or a previously cleared hamlet after our protection ends. Leave time after reconnaissance for a combat round trip plus 60 ticks. Keep all combat troops; allow one reconnaissance command and a 600-tick retry interval for house bots or 120 ticks for cleared neutral hamlets. A consumed neutral report permits fresh reconnaissance, never a second raid from the same intel. Report summaries establish historical observations only, not raid profitability.",
      requirements: { timber: 0, stone: 0, iron: 0 }, blockers: [], status: "ready", affordableAtTick: state.world.tick });
  }
  return proposals;
}
