import type { Action, Resources, VillageState } from "../shared/api.js";
import type { AdvisorContext, Proposal } from "./types.js";
import type { TaskKey } from "../bot/plan/graph.js";

const resources = ["timber", "stone", "iron"] as const;

export function minuteTrainingProposal(
  context: AdvisorContext,
  village: VillageState,
  unit: Extract<Action, { type: "train" }>["unit"],
  deficit: number,
  task: TaskKey,
  importance: number,
  reason: string,
  id: string,
  currentLevel = 0,
  targetLevel = currentLevel + deficit,
): Proposal<Extract<Action, { type: "train" }>> | null {
  const option = village.options.train.find(value => value.unit === unit);
  if (!option || !Number.isFinite(option.ticksEach) || option.ticksEach <= 0) return null;
  const facility = (context.rules.rules.UNITS as Record<string, { building: keyof VillageState["training"] }>)[unit]?.building;
  if (!facility) return null;
  const queue = village.training[facility];
  const batchMax = (context.rules.rules.ECONOMY as { trainBatchMax: number }).trainBatchMax;
  if (!Number.isSafeInteger(batchMax) || batchMax < 1) throw new Error("Invalid live recruitment batch limit.");
  const count = Math.min(deficit, Math.ceil(61 / option.ticksEach), batchMax, option.maxCount);
  if (!Number.isSafeInteger(count) || count < 1) return null;

  const blockers: string[] = [...option.blockers];
  const add = (blocker: string) => {
    if (!blockers.includes(blocker)) blockers.push(blocker);
  };
  let needed = true;
  const skip = (blocker: string) => {
    needed = false;
    add(blocker);
  };
  if (!option.ok && (!blockers.length || blockers.some(blocker => blocker !== "INSUFFICIENT_RESOURCES"))) {
    skip("RECRUIT_UNAVAILABLE");
  }
  if (count > batchMax || count > option.maxCount) skip("BATCH_CAPACITY");
  const buffer = Math.max(50, Math.ceil(village.population.max * 0.2));
  if (village.population.max - village.population.used - buffer < count * option.pop) {
    skip("POPULATION_CAPACITY");
  }
  const requirements = Object.fromEntries(resources.map(resource => [
    resource,
    option.cost[resource] * count,
  ])) as Resources;
  let affordableAtTick = context.state.world.tick;
  for (const resource of resources) {
    if (requirements[resource] > village.storage) skip("STORAGE_CAPACITY");
    const missing = requirements[resource] * 1000 - village.resourcesMilli[resource];
    if (missing <= 0) continue;
    add("INSUFFICIENT_RESOURCES");
    const rate = village.productionPerTickMilli[resource];
    if (rate <= 0) skip("NO_AFFORDABLE_TICK");
    else affordableAtTick = Math.max(
      affordableAtTick,
      context.state.world.tick + Math.ceil(missing / rate),
    );
  }
  if (queue.length) add("TRAIN_QUEUE_BUSY");
  if (village.orders.train.length) add("EXTERNAL_ORDERS");
  const start = Math.ceil(Math.max(
    affordableAtTick,
    context.state.player.nextActTick ?? context.state.world.tick,
    ...queue.map(batch => batch.endTick),
  ));
  if (start + count * option.ticksEach + 60 > context.state.world.endsAtTick) {
    skip("ROUND_END_TOO_SOON");
  }
  if (context.state.world.status !== "running") add("WORLD_NOT_RUNNING");
  if ((context.state.player.nextActTick ?? context.state.world.tick) > context.state.world.tick) {
    add("COUNCIL_COOLDOWN");
  }

  return {
    id,
    task,
    advisor: "military",
    villageId: village.id,
    villageName: village.name,
    action: { type: "train", village: village.id, unit, count },
    buildingName: `${count} ${unit}${count === 1 ? "" : "s"}`,
    currentLevel,
    targetLevel,
    importance,
    reason: `${reason} Batch ${count} takes ${(count * option.ticksEach).toFixed(3)} ticks; keep ${buffer} population free. Time and funding include queued Barracks work, with 60 ticks left for use.`,
    requirements,
    blockers,
    status: !needed ? "not-needed" : blockers.length ? "waiting" : "ready",
    affordableAtTick: Number.isFinite(affordableAtTick) ? affordableAtTick : null,
  };
}
