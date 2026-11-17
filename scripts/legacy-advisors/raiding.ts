/** Historical experiment baseline only; never registered in the live advisor council. */
import { completionWindow } from "../../src/advisors/completion.js";
import { INITIAL_PIKEMEN, INITIAL_SHIELDMEN, INITIAL_RAIDERS, ownedPikemen, RECRUIT_BATCH } from "./recruitment.js";
import type { Action, BuildingId } from "../../src/shared/api.js";
import type { AdvisorContext, Proposal } from "../../src/advisors/types.js";

/** Buy only Smithy 2 after defence, with the complete bounded raiding force funded. */
export function evaluateRaidingSmithy({ state, rules }: AdvisorContext): Proposal<Extract<Action, { type: "build" }>>[] {
  if (rules.version !== state.world.rulesVersion) throw new Error("Live rules do not match this world's rules version.");
  const metadata = (rules.rules.BUILDINGS as Record<BuildingId, {
    name: string; requires: Partial<Record<BuildingId, number>>;
  }>).smithy;
  const raider = (rules.rules.UNITS as Record<string, {
    building: string; buildingLevel: number; smithyLevel: number;
  }>).raider;
  const batchMax = (rules.rules.ECONOMY as { trainBatchMax: number }).trainBatchMax;
  if (!metadata || !raider || !Number.isSafeInteger(batchMax) || batchMax < 1) throw new Error("Live Smithy rules are unavailable.");
  const proposals: Proposal<Extract<Action, { type: "build" }>>[] = [];
  for (const v of state.villages) {
    if (v.buildings.smithy !== 1 || v.buildQueue.some(q => q.building === "smithy") || ownedPikemen(v) < INITIAL_PIKEMEN ||
        (v.units.home.shieldman ?? 0) + (v.units.away.shieldman ?? 0) < INITIAL_SHIELDMEN) continue;
    const owned = (v.units.home.raider ?? 0) + (v.units.away.raider ?? 0);
    const queued = Object.values(v.training).flat().filter(q => q.unit === "raider").reduce((n, q) => n + q.remaining, 0);
    const count = INITIAL_RAIDERS - owned - queued;
    if (count <= 0) continue;
    const option = v.options.build.find(o => o.building === "smithy");
    const train = v.options.train.find(o => o.unit === "raider");
    if (!option || option.level !== 2 || !train) continue;
    if (!Number.isSafeInteger(train.ticksEach) || train.ticksEach < 1 || !Number.isSafeInteger(train.pop) || train.pop < 1 ||
        Object.values(train.cost).some(n => !Number.isFinite(n) || n < 0)) throw new Error("Invalid live Raider option.");
    const blockers: string[] = [...option.blockers];
    const add = (b: string) => { if (!blockers.includes(b)) blockers.push(b); };
    let needed = true;
    const skip = (b: string) => { needed = false; add(b); };
    if (Object.entries(metadata.requires).some(([b, level]) => v.buildings[b as BuildingId] < level!)) skip("PREREQUISITE");
    if (!option.ok || option.blockers.length) needed = false;
    if (raider.building !== "barracks" || v.buildings.barracks < raider.buildingLevel || raider.smithyLevel !== 2) skip("NO_USEFUL_RECRUIT");
    // The missing Smithy level is the only expected training blocker before this unlock.
    if (train.blockers.some(b => b !== "REQUIREMENTS_NOT_MET") || (!train.ok && !train.blockers.length)) skip("RECRUIT_UNAVAILABLE");
    const batchSize = Math.min(batchMax, RECRUIT_BATCH);
    const buffer = Math.max(50, Math.ceil(v.population.max * 0.2));
    if (v.population.max - v.population.used < option.pop + count * train.pop + buffer) skip("POPULATION_CAPACITY");
    for (const r of ["timber", "stone", "iron"] as const) {
      if (option.cost[r] > v.storage || train.cost[r] * count > v.storage) skip("STORAGE_CAPACITY");
      // No speculative saving or income: fund both infrastructure and its useful troops now.
      if (v.resourcesMilli[r] < (option.cost[r] + count * train.cost[r]) * 1000) skip("UNFUNDED_RAIDING_FORCE");
    }
    const useTicks = Math.max(600, (1 + Math.ceil(count / batchSize)) * (state.world.actIntervalTicks ?? 0) + count * train.ticksEach + 300);
    if (!Number.isSafeInteger(useTicks)) throw new Error("Invalid live raiding use timing.");
    const window = completionWindow(state, v, option);
    if (window && window.completionTick + useTicks > window.endsAtTick) skip("ROUND_END_TOO_SOON");
    if (v.buildQueue.length) add("BUILD_QUEUE_BUSY");
    if (Object.values(v.training).some(q => q.length)) add("TRAIN_QUEUE_BUSY");
    if (v.orders.build.length || v.orders.train.length) add("EXTERNAL_ORDERS");
    if (state.world.status !== "running") add("WORLD_NOT_RUNNING");
    if ((state.player.nextActTick ?? state.world.tick) > state.world.tick) add("COUNCIL_COOLDOWN");
    proposals.push({
      id: `${state.world.epoch}:${v.id}:smithy:2`, task: "defense.development", advisor: "military", villageId: v.id, villageName: v.name,
      action: { type: "build", village: v.id, building: "smithy" }, buildingName: metadata.name,
      currentLevel: 1, targetLevel: 2, importance: 75, requirements: option.cost,
      reason: `Unlock up to ${count} Raiders after ten owned Pikemen and five Shieldmen with Smithy 2. Fund construction and the remaining complement now, keep ${buffer} population free and ${useTicks} ticks after construction. Recruit separately after fresh evaluation; no attacks, Hall prerequisites or further Smithy levels.`,
      blockers, status: !needed ? "not-needed" : blockers.length ? "waiting" : "ready", affordableAtTick: option.affordableAtTick,
    });
  }
  return proposals;
}
