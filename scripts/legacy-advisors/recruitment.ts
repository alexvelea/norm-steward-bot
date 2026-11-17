/** Historical experiment baseline only; never registered in the live advisor council. */
import type { Action, Resources, VillageState } from "../../src/shared/api.js";
import type { AdvisorContext, Proposal } from "../../src/advisors/types.js";

export const INITIAL_PIKEMEN = 10;
export const INITIAL_SHIELDMEN = 5;
export const INITIAL_RAIDERS = 10;
export const RECRUIT_BATCH = 5;
export const RECRUIT_USE_TICKS = 60;
export function ownedPikemen(v: VillageState): number {
  return (v.units.home.pikeman ?? 0) + (v.units.away.pikeman ?? 0);
}
/** Bounded defensive and raiding forces; recruitment never dispatches troops. */
export function evaluateRecruitment({ state, rules }: AdvisorContext): Proposal<Extract<Action, { type: "train" }>>[] {
  if (rules.version !== state.world.rulesVersion) throw new Error("Live rules do not match this world's rules version.");
  const units = rules.rules.UNITS as Record<string, {
    name: string; building: string; buildingLevel: number; smithyLevel: number;
  }>;
  const limit = (rules.rules.ECONOMY as { trainBatchMax: number }).trainBatchMax;
  if (!units.pikeman || !units.shieldman || !Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Live recruitment rules are unavailable.");
  const proposals: Proposal<Extract<Action, { type: "train" }>>[] = [];
  for (const v of state.villages) for (const unitId of ["pikeman", "shieldman", "raider"] as const) {
    // Keep the existing spear wall. Add a small complement only after it is owned and
    // Shields are unlocked; infrastructure is a separate President proposal.
    if (unitId === "shieldman" && ownedPikemen(v) < INITIAL_PIKEMEN) continue;
    if (unitId === "raider" && (ownedPikemen(v) < INITIAL_PIKEMEN ||
        (v.units.home.shieldman ?? 0) + (v.units.away.shieldman ?? 0) < INITIAL_SHIELDMEN)) continue;
    const unit = units[unitId];
    if (!unit || unit.building !== "barracks") continue;
    const cap = unitId === "pikeman" ? INITIAL_PIKEMEN : unitId === "shieldman" ? INITIAL_SHIELDMEN : INITIAL_RAIDERS;
    const owned = (v.units.home[unitId] ?? 0) + (v.units.away[unitId] ?? 0);
    const queued = Object.values(v.training).flat().filter((q) => q.unit === unitId).reduce((n, q) => n + q.remaining, 0);
    if (owned + queued >= cap) continue;
    const option = v.options.train.find((o) => o.unit === unitId);
    if (!option) continue;
    const blockers: string[] = [...option.blockers];
    const add = (b: string) => { if (!blockers.includes(b)) blockers.push(b); };
    let needed = true;
    const skip = (b: string) => { needed = false; add(b); };
    if (v.buildings.barracks < unit.buildingLevel || v.buildings.smithy < unit.smithyLevel) skip("PREREQUISITE");
    if (!Number.isSafeInteger(option.ticksEach) || option.ticksEach < 1 || !Number.isSafeInteger(option.pop) || option.pop < 1 ||
        !Number.isSafeInteger(option.maxCount) || option.maxCount < 0 ||
        Object.values(option.cost).some((n) => !Number.isFinite(n) || n < 0)) throw new Error("Invalid live recruitment option.");
    if (!option.ok || blockers.length) needed = false;
    const buffer = Math.max(50, Math.ceil(v.population.max * 0.2));
    const popCount = Math.max(0, Math.floor((v.population.max - v.population.used - buffer) / option.pop));
    const remaining = cap - owned - queued;
    const count = Math.min(RECRUIT_BATCH, remaining, option.maxCount, popCount, limit);
    // Five Raiders cannot meet the normal attack minimum. Do not start a partial
    // force unless the complete remaining force fits current funding/population.
    if (unitId === "raider" && popCount < remaining) skip("RAIDING_FORCE_POPULATION");
    // No resource reservations: train only the currently affordable small batch.
    if (count < 1) skip("NO_BOUNDED_BATCH");
    const cost = Object.fromEntries((["timber", "stone", "iron"] as const).map((r) => [r, option.cost[r] * count])) as Resources;
    for (const r of ["timber", "stone", "iron"] as const) {
      if (cost[r] > v.storage) skip("STORAGE_CAPACITY");
      if (cost[r] * 1000 > v.resourcesMilli[r]) skip("INSUFFICIENT_RESOURCES");
      if (unitId === "raider" && option.cost[r] * remaining * 1000 > v.resourcesMilli[r]) skip("UNFUNDED_RAIDING_FORCE");
    }
    if (v.training.barracks.length) add("TRAIN_QUEUE_BUSY");
    if (v.orders.train.length) add("EXTERNAL_ORDERS");
    const start = Math.max(state.world.tick, state.player.nextActTick ?? state.world.tick);
    const useTicks = unitId === "raider" ? 300 : RECRUIT_USE_TICKS;
    const forceTicks = unitId === "raider"
      ? remaining * option.ticksEach + (Math.ceil(remaining / Math.min(RECRUIT_BATCH, limit)) - 1) * (state.world.actIntervalTicks ?? 0)
      : count * option.ticksEach;
    if (start + forceTicks + useTicks > state.world.endsAtTick) skip("ROUND_END_TOO_SOON");
    if (state.world.status !== "running") add("WORLD_NOT_RUNNING");
    if (start > state.world.tick) add("COUNCIL_COOLDOWN");
    proposals.push({
      id: `${state.world.epoch}:${v.id}:train:${unitId}:${owned}:${count}`,
      task: unitId === "raider" ? "conquest.escort" : "defense.cohort",
      advisor: "military", villageId: v.id, villageName: v.name,
      action: { type: "train", village: v.id, unit: unitId, count },
      buildingName: `${unit.name} troops`, currentLevel: owned, targetLevel: owned + count,
      importance: unitId === "raider" ? 76 : 78,
      reason: `Train ${count} ${unit.name} toward an initial cap of ${cap} owned ${unit.name} troops (including away and queued).${unitId === "shieldman" ? " Complement ten owned Pikemen with at most five Shieldmen for infantry and ranged defence; use existing unlocks only." : unitId === "raider" ? " Enable a bounded raiding force after the defensive complement exists. Scouting and target-risk selection are separate; this proposal sends no attacks." : ""} Keep ${buffer} population free and ${useTicks} ticks after completion for use; capacity and protection take priority.`,
      requirements: cost, blockers,
      status: !needed ? "not-needed" : blockers.length ? "waiting" : "ready",
      affordableAtTick: option.affordableAtTick,
    });
  }
  return proposals;
}
