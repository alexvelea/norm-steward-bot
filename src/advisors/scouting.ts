import { completionWindow } from "./completion.js";
import { INITIAL_PIKEMEN, INITIAL_SHIELDMEN, INITIAL_RAIDERS } from "./recruitment.js";
import type { BuildingId } from "../shared/api.js";
import type { AdvisorContext, Proposal } from "./types.js";

export const INITIAL_SCOUTS = 2;
export const SCOUT_USE_TICKS = 600;

/** Enable a small reconnaissance force, without buying prerequisites or dispatching it. */
export function evaluateScouting({ state, rules }: AdvisorContext): Proposal[] {
  if (rules.version !== state.world.rulesVersion) throw new Error("Live rules do not match this world's rules version.");
  const stable = (rules.rules.BUILDINGS as Record<BuildingId, {
    name: string; requires: Partial<Record<BuildingId, number>>;
  }>).stable;
  const scout = (rules.rules.UNITS as Record<string, {
    name: string; building: string; buildingLevel: number; smithyLevel: number;
  }>).scout;
  const batchMax = (rules.rules.ECONOMY as { trainBatchMax: number }).trainBatchMax;
  if (!stable || !scout || !Number.isSafeInteger(batchMax) || batchMax < 1) throw new Error("Live scouting rules are unavailable.");
  const proposals: Proposal[] = [];
  for (const v of state.villages) {
    const owned = (unit: "pikeman" | "shieldman" | "raider" | "scout") => (v.units.home[unit] ?? 0) + (v.units.away[unit] ?? 0);
    if (owned("pikeman") < INITIAL_PIKEMEN || owned("shieldman") < INITIAL_SHIELDMEN || owned("raider") < INITIAL_RAIDERS) continue;
    const queued = Object.values(v.training).flat().filter(q => q.unit === "scout").reduce((n, q) => n + q.remaining, 0);
    const count = INITIAL_SCOUTS - owned("scout") - queued;
    if (count <= 0) continue;
    const train = v.options.train.find(o => o.unit === "scout");
    const build = v.buildings.stable === 0 ? v.options.build.find(o => o.building === "stable" && o.level === 1) : undefined;
    if (!train || (v.buildings.stable === 0 && !build)) continue;
    if (!Number.isSafeInteger(train.ticksEach) || train.ticksEach < 1 || !Number.isSafeInteger(train.pop) || train.pop < 1 ||
        !Number.isSafeInteger(train.maxCount) || train.maxCount < 0 ||
        Object.values(train.cost).some(n => !Number.isFinite(n) || n < 0)) throw new Error("Invalid live Scout option.");
    const option = build ?? train;
    const blockers: string[] = [...option.blockers];
    const add = (b: string) => { if (!blockers.includes(b)) blockers.push(b); };
    let needed = option.ok && !blockers.length;
    const skip = (b: string) => { needed = false; add(b); };
    if (scout.building !== "stable" || scout.buildingLevel > (build ? 1 : v.buildings.stable) || v.buildings.smithy < scout.smithyLevel) skip("PREREQUISITE");
    if (build && Object.entries(stable.requires).some(([b, level]) => v.buildings[b as BuildingId] < level!)) skip("PREREQUISITE");
    if (build ? train.blockers.some(b => b !== "REQUIREMENTS_NOT_MET") || (!train.ok && !train.blockers.length) : !train.ok || train.maxCount < count) skip("RECRUIT_UNAVAILABLE");
    if (count > batchMax) skip("NO_BOUNDED_BATCH");
    const buffer = Math.max(50, Math.ceil(v.population.max * 0.2));
    if (v.population.max - v.population.used < (build?.pop ?? 0) + count * train.pop + buffer) skip("POPULATION_CAPACITY");
    for (const r of ["timber", "stone", "iron"] as const) {
      if ((build?.cost[r] ?? 0) > v.storage || count * train.cost[r] > v.storage) skip("STORAGE_CAPACITY");
      if (v.resourcesMilli[r] < ((build?.cost[r] ?? 0) + count * train.cost[r]) * 1000) skip("UNFUNDED_SCOUT_FORCE");
    }
    const start = Math.max(state.world.tick, state.player.nextActTick ?? state.world.tick);
    const completion = build ? completionWindow(state, v, build)?.completionTick : start;
    const useTicks = count * train.ticksEach + SCOUT_USE_TICKS + (build ? state.world.actIntervalTicks ?? 0 : 0);
    if (completion === undefined || completion + useTicks > state.world.endsAtTick) skip("ROUND_END_TOO_SOON");
    if (v.buildQueue.length) add("BUILD_QUEUE_BUSY");
    if (Object.values(v.training).some(q => q.length)) add("TRAIN_QUEUE_BUSY");
    if (v.orders.build.length || v.orders.train.length) add("EXTERNAL_ORDERS");
    if (state.world.status !== "running") add("WORLD_NOT_RUNNING");
    if (start > state.world.tick) add("COUNCIL_COOLDOWN");
    proposals.push({
      id: `${state.world.epoch}:${v.id}:scouting:${build ? "stable:1" : `train:${owned("scout")}:${count}`}`,
      advisor: "military", villageId: v.id, villageName: v.name,
      action: build ? { type: "build", village: v.id, building: "stable" } : { type: "train", village: v.id, unit: "scout", count },
      buildingName: build ? stable.name : `${scout.name} troops`, currentLevel: build ? 0 : owned("scout"), targetLevel: build ? 1 : owned("scout") + count,
      importance: build ? 73 : 74,
      reason: `${build ? "Unlock Stable 1 for" : "Train"} ${count} Scouts toward a cap of two owned, including away and queued, after the defensive and raiding forces exist. Fund the complete path now, keep ${buffer} population free and ${SCOUT_USE_TICKS} ticks after training. No prerequisite purchases or dispatch; reports will require fresh target validation.`,
      requirements: build ? build.cost : { timber: count * train.cost.timber, stone: count * train.cost.stone, iron: count * train.cost.iron },
      blockers, status: !needed ? "not-needed" : blockers.length ? "waiting" : "ready", affordableAtTick: option.affordableAtTick,
    });
  }
  return proposals;
}
