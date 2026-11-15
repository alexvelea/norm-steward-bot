import { evaluateRecruitment } from "./recruitment.js";
import { evaluateDefensiveSmithy } from "./smithy.js";
import { completionWindow } from "./completion.js";
import type { Action, BuildingId, Resources } from "../shared/api.js";
import type { Advisor, AdvisorContext, Proposal } from "./types.js";

/** Bounded military proposals share the President and its durable executor. */
export const militaryAdvisor: Advisor = { id: "military", evaluate: (context) => [...evaluateMilitary(context), ...evaluateRecruitment(context)] };
export function evaluateMilitary({ state, rules }: AdvisorContext): Proposal<Extract<Action, {type: "build"}>>[] {
  if (rules.version !== state.world.rulesVersion)
    throw new Error("Live rules do not match this world's rules version.");
  const metadata = (rules.rules.BUILDINGS as Record<BuildingId, {
    name: string; requires: Partial<Record<BuildingId, number>>;
  }>).barracks;
  const pikeman = (rules.rules.UNITS as Record<string, {
    building: string; buildingLevel: number; smithyLevel: number;
    trainTime: number; pop: number; cost: Resources;
  }>).pikeman;
  if (!metadata || !pikeman) throw new Error("Live military rules are unavailable.");
  const proposals: Proposal<Extract<Action, {type: "build"}>>[] = [];
  for (const v of state.villages) {
    // Never buy further levels or duplicate an existing military training path.
    const facilities = ["barracks", "stable", "workshop", "court"] as const;
    if (facilities.some((b) => v.buildings[b] > 0 || v.buildQueue.some((q) => q.building === b))) continue;
    const option = v.options.build.find((o) => o.building === "barracks");
    if (!option || option.level !== 1) continue;
    const blockers: string[] = [...option.blockers];
    const add = (b: string) => { if (!blockers.includes(b)) blockers.push(b); };
    let needed = true;
    const skip = (b: string) => { needed = false; add(b); };
    if (Object.entries(metadata.requires).some(([b, level]) => v.buildings[b as BuildingId] < level!)) skip("PREREQUISITE");
    // A hard server blocker must never reserve the economy for impossible infrastructure.
    if (option.blockers.some((b) => b !== "INSUFFICIENT_RESOURCES")) needed = false;
    if (!option.ok && !option.blockers.length) skip("UNAVAILABLE");
    if (Object.values(option.cost).some((cost) => cost > v.storage)) skip("STORAGE_CAPACITY");
    if (pikeman.building !== "barracks" || pikeman.buildingLevel > 1 || pikeman.smithyLevel > v.buildings.smithy) skip("NO_USEFUL_RECRUIT");
    if (v.population.max - v.population.used < option.pop + pikeman.pop) skip("POPULATION_CAPACITY");
    if (Object.values(pikeman.cost).some((cost) => cost > v.storage)) skip("RECRUIT_STORAGE_CAPACITY");
    for (const r of ["timber", "stone", "iron"] as const) {
      if (v.resourcesMilli[r] < option.cost[r] * 1000) {
        add("INSUFFICIENT_RESOURCES");
        if (v.productionPerTickMilli[r] <= 0 || option.affordableAtTick === null) skip("NO_AFFORDABLE_TICK");
      }
    }
    const window = completionWindow(state, v, option);
    const trainTicks = v.options.train.find((o) => o.unit === "pikeman")?.ticksEach ?? pikeman.trainTime;
    // Leave a five-minute use horizon, including a possible Council interval and one recruit.
    const useTicks = Math.max(300, trainTicks + (state.world.actIntervalTicks ?? 0));
    if (!Number.isFinite(useTicks) || useTicks <= 0) skip("INVALID_RECRUIT_TIMING");
    if (window && (!window.fits || window.completionTick + useTicks > window.endsAtTick)) skip("ROUND_END_TOO_SOON");
    if (v.buildQueue.length) add("BUILD_QUEUE_BUSY");
    if (v.orders.build.length) add("EXTERNAL_BUILD_ORDERS");
    if (state.world.status !== "running") add("WORLD_NOT_RUNNING");
    if ((state.player.nextActTick ?? state.world.tick) > state.world.tick) add("COUNCIL_COOLDOWN");
    proposals.push({
      id: `${state.world.epoch}:${v.id}:barracks:1`, advisor: "military",
      villageId: v.id, villageName: v.name,
      action: { type: "build", village: v.id, building: "barracks" },
      buildingName: metadata.name, currentLevel: 0, targetLevel: 1,
      importance: 79,
      reason: `Enable the first foot-soldier training path with Barracks 1; reserve ${useTicks} ticks after construction for use. Recruitment is a subsequent step; this construction alone adds no troops.${needed ? "" : " Skip unavailable or unusable infrastructure so economic investment can continue."}`,
      requirements: option.cost, blockers,
      status: !needed ? "not-needed" : blockers.length ? "waiting" : "ready",
      affordableAtTick: option.affordableAtTick,
    });
  }
  return [...proposals, ...evaluateDefensiveSmithy({ state, rules })];
}
