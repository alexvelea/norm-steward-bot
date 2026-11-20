import type { Action, BuildingId, Resources, VillageState } from "../shared/api.js";
import type { TaskKey } from "../bot/plan/graph.js";
import { cityRoles } from "../bot/strategy/roles.js";
import { completionWindow } from "./completion.js";
import { PRODUCER_CEILING } from "./defense-budget.js";
import { minuteTrainingProposal } from "./military-training.js";
import type { AdvisorContext, Proposal } from "./types.js";

export const LANCER_FLOOR = 10000;
export const RAM_FLOOR = 20000;
export const ATTACK_HALL = 15;
export const ATTACK_STABLE = 10;
export const ATTACK_WORKSHOP = 10;
const resources = ["timber", "stone", "iron"] as const;

function above(v: VillageState, floor: number): boolean {
  return resources.every(r => v.resourcesMilli[r] > floor * 1000);
}

function build(context: AdvisorContext, v: VillageState, building: BuildingId, task: TaskKey, importance: number, reason: string): Proposal<Extract<Action, { type: "build" }>> | null {
  const { state, rules } = context;
  const metadata = rules.rules.BUILDINGS as Record<BuildingId, { name: string }>;
  const o = v.options.build.find(option => option.building === building);
  if (!o || o.level !== v.buildings[building] + 1) return null;
  const blockers: string[] = [...o.blockers];
  let needed = o.ok && !blockers.length;
  if (v.buildQueue.length) blockers.push("BUILD_QUEUE_BUSY");
  if (v.orders.build.length) blockers.push("EXTERNAL_BUILD_ORDERS");
  if (v.population.max - v.population.used < o.pop) { needed = false; blockers.push("POPULATION_CAPACITY"); }
  for (const r of resources) if (v.resourcesMilli[r] < o.cost[r] * 1000 || o.cost[r] > v.storage) { needed = false; blockers.push("INSUFFICIENT_RESOURCES"); break; }
  const window = completionWindow(state, v, o);
  if (window && window.completionTick + 600 > window.endsAtTick) { needed = false; blockers.push("ROUND_END_TOO_SOON"); }
  if (state.world.status !== "running") blockers.push("WORLD_NOT_RUNNING");
  if ((state.player.nextActTick ?? state.world.tick) > state.world.tick) blockers.push("COUNCIL_COOLDOWN");
  return { id: `${state.world.epoch}:${v.id}:attack:${building}:${o.level}`, task, advisor: "military", villageId: v.id, villageName: v.name,
    action: { type: "build", village: v.id, building }, buildingName: metadata[building].name, currentLevel: v.buildings[building], targetLevel: o.level,
    importance, reason, requirements: o.cost, blockers, status: !needed ? "not-needed" : blockers.length ? "waiting" : "ready", affordableAtTick: o.affordableAtTick };
}

/** Units affordable without any resource falling below its floor, after reserved spending. */
function sinkCount(v: VillageState, unit: string, floor: number, reserved?: Resources): number {
  const option = v.options.train.find(value => value.unit === unit);
  if (!option) return 0;
  return Math.max(0, Math.min(...resources.map(r => option.cost[r] > 0
    ? Math.floor((Math.floor(v.resourcesMilli[r] / 1000) - floor - (reserved?.[r] ?? 0)) / option.cost[r])
    : Number.MAX_SAFE_INTEGER)));
}

/** Late-game capital: Hall 15, Stable 10, Workshop 10, then Lancers and Rams from resources above their per-resource floors. */
export function evaluateAttackSink(context: AdvisorContext): Proposal[] {
  const { state } = context;
  const roles = context.cityRoles ?? cityRoles(context, []);
  const v = state.villages.find(village => roles.get(village.id)?.role === "capital");
  if (!v || Math.min(v.buildings.lumberyard, v.buildings.quarry, v.buildings.mine) < PRODUCER_CEILING) return [];
  const proposals: Proposal[] = [];
  const push = (proposal: Proposal | null) => { if (proposal) proposals.push(proposal); };
  if (v.buildings.hall < ATTACK_HALL) {
    push(build(context, v, "hall", "economy.hall-push", 88, `Producers reached ${PRODUCER_CEILING}: force the Great Hall to ${ATTACK_HALL} before the late-game troop sink.`));
  } else if (v.buildings.stable < ATTACK_STABLE) {
    if (state.villages.length >= 2) push(build(context, v, "stable", "military.attack-stable", 74, `Late game: raise the Stable to ${ATTACK_STABLE} so surplus resources can become Lancers.`));
  } else if (v.buildings.workshop < ATTACK_WORKSHOP) {
    push(build(context, v, "workshop", "military.attack-workshop", 75, `Late game: Stable ${ATTACK_STABLE} is done; build Workshop ${ATTACK_WORKSHOP} before raising the Stable further.`));
  } else if (state.villages.length >= 2 && v.training.stable.length > 0 && above(v, LANCER_FLOOR)) {
    push(build(context, v, "stable", "military.attack-stable", 70, `Late game: the Stable queue is busy while every resource is above ${LANCER_FLOOR}; raise the Stable to train faster.`));
  }
  let reserved: Resources | undefined;
  if (v.buildings.stable >= 1 && v.training.stable.length === 0) {
    const count = sinkCount(v, "lancer", LANCER_FLOOR);
    const lancers = count > 0 ? minuteTrainingProposal(context, v, "lancer", count, "military.lancers", 42,
      `Late-game resource sink: every capital resource is above ${LANCER_FLOOR}; train Lancers without dropping any below it.`,
      `${state.world.epoch}:${v.id}:lancers:${state.world.tick}`) : null;
    if (lancers) { reserved = lancers.requirements; proposals.push(lancers); }
  }
  if (v.buildings.workshop >= 1 && v.training.workshop.length === 0) {
    const count = sinkCount(v, "ram", RAM_FLOOR, reserved);
    push(count > 0 ? minuteTrainingProposal(context, v, "ram", count, "military.rams", 40,
      `Late-game resource sink after Lancers: every capital resource is above ${RAM_FLOOR}; train Rams without dropping any below it.`,
      `${state.world.epoch}:${v.id}:rams:${state.world.tick}`) : null);
  }
  return proposals;
}
