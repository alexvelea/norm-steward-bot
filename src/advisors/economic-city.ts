import type { Action, BuildingId, Resources, VillageState } from "../shared/api.js";
import { evaluateEconomy } from "./economic.js";
import { balanceLags, balanceScore } from "./balance.js";
import type { Advisor, AdvisorContext, Proposal } from "./types.js";
import type { TaskKey } from "../bot/plan/graph.js";

const resources = ["timber", "stone", "iron"] as const;
const producers = ["lumberyard", "quarry", "mine"] as const;
const producerResources = {
  lumberyard: "timber",
  quarry: "stone",
  mine: "iron",
} as const;
const buildOrder = [
  { task: "econ.cellar3", building: "cellar", level: 3 },
  { task: "econ.hall5", building: "hall", level: 5 },
  { task: "econ.cellar-cover", building: "cellar", level: 7 },
  { task: "econ.hall13", building: "hall", level: 13 },
  { task: "econ.cellar10", building: "cellar", level: 10 },
  { task: "econ.storehouse3", building: "storehouse", level: 3 },
] as const satisfies readonly { task: TaskKey; building: BuildingId; level: number }[];

export function economicCitySetupDone(village: VillageState): boolean {
  return buildOrder.every(step => village.buildings[step.building] >= step.level);
}

function buildProposal(
  context: AdvisorContext,
  village: VillageState,
  task: TaskKey,
  building: BuildingId,
  importance: number,
  reason: string,
): Proposal<Extract<Action, { type: "build" }>> | null {
  const option = village.options.build.find(value => value.building === building);
  if (!option || option.blockers.includes("MAX_LEVEL")) return null;
  const metadata = context.rules.rules.BUILDINGS as Record<BuildingId, { name: string }>;
  const blockers: string[] = [...option.blockers];
  if (village.buildQueue.length) blockers.push("BUILD_QUEUE_BUSY");
  if (resources.some(resource => village.resourcesMilli[resource] < option.cost[resource] * 1000) &&
      !blockers.includes("INSUFFICIENT_RESOURCES")) blockers.push("INSUFFICIENT_RESOURCES");
  const tick = context.state.world.tick;
  if (context.state.player.nextActTick !== null && context.state.player.nextActTick > tick) {
    blockers.push("COUNCIL_COOLDOWN");
  }
  let funded = tick;
  for (const resource of resources) {
    const deficit = option.cost[resource] * 1000 - village.resourcesMilli[resource];
    if (deficit <= 0) continue;
    const rate = village.productionPerTickMilli[resource];
    funded = rate > 0 ? Math.max(funded, tick + Math.ceil(deficit / rate)) : Infinity;
  }
  if (funded + option.ticks + 60 > context.state.world.endsAtTick) blockers.push("ROUND_END_TOO_SOON");
  const uniqueBlockers = [...new Set(blockers)];
  return {
    id: `${context.state.world.epoch}:${village.id}:${task}:${option.level}`,
    task,
    advisor: "economic-city",
    villageId: village.id,
    villageName: village.name,
    action: { type: "build", village: village.id, building },
    buildingName: metadata[building].name,
    currentLevel: village.buildings[building],
    targetLevel: option.level,
    importance,
    reason,
    requirements: option.cost,
    blockers: uniqueBlockers,
    status: uniqueBlockers.length ? "waiting" : "ready",
    affordableAtTick: option.affordableAtTick,
  };
}

function unblocker(
  context: AdvisorContext,
  village: VillageState,
  option: { pop: number; cost: Resources },
): Proposal<Extract<Action, { type: "build" }>> | null {
  const freePopulation = village.population.max - village.population.used;
  const populationBuffer = Math.max(50, Math.ceil(village.population.max * 0.2));
  if (freePopulation < option.pop + populationBuffer) {
    return buildProposal(context, village, "econ.farm", "farm", 95, "Build Farm capacity to unblock the current economic-city step.");
  }
  if (resources.some(resource => option.cost[resource] > village.storage) || village.storage < 2000) {
    return buildProposal(context, village, "econ.storehouse", "storehouse", 95, "Build Storehouse capacity to fit the current step and the 2,000-resource request top-up.");
  }
  return null;
}

function buildOrUnblock(
  context: AdvisorContext,
  village: VillageState,
  task: TaskKey,
  building: BuildingId,
  importance: number,
  reason: string,
): Proposal<Extract<Action, { type: "build" }>> | null {
  const option=village.options.build.find(value=>value.building===building);
  if(!option)return null;
  return unblocker(context,village,option) ??
    buildProposal(context,village,task,building,importance,reason);
}

function requestStep(
  context: AdvisorContext,
  village: VillageState,
): Proposal<Extract<Action, { type: "build" }>>[] {
  const step = buildOrder.find(value => village.buildings[value.building] < value.level);
  if (!step) return [];
  const option = village.options.build.find(value => value.building === step.building);
  if (!option) return [];
  const proposal = buildOrUnblock(
    context,
    village,
    step.task,
    step.building,
    85,
    `Economic-city setup: complete ${step.building} ${step.level} before moving to later steps.`,
  );
  return proposal ? [proposal] : [];
}

function afterSetup(
  context: AdvisorContext,
  village: VillageState,
): Proposal[] {
  const proposals: Proposal[] = [];
  const balance = balanceLags(village);
  const incoming = context.state.trades.incoming
    .filter(trade => trade.to.id === village.id)
    .reduce((sum, trade) => ({
      timber: sum.timber + trade.resources.timber,
      stone: sum.stone + trade.resources.stone,
      iron: sum.iron + trade.resources.iron,
    }), { timber: 0, stone: 0, iron: 0 });
  const overflows = resources.some(resource =>
    village.resourcesMilli[resource] / 1000 +
      incoming[resource] +
      village.productionPerTickMilli[resource] * 300 / 1000 > village.storage
  );
  if (overflows) {
    const proposal = buildOrUnblock(context, village, "econ.storehouse", "storehouse", 90, "Stock, incoming shipments and 300 ticks of production exceed storage.");
    if (proposal) proposals.push(proposal);
  }
  if (village.hidden < Math.max(...resources.map(resource => village.resources[resource]))) {
    const proposal = buildOrUnblock(context, village, "econ.cellar", "cellar", 80, "Increase protection to cover the largest current resource stock.");
    if (proposal) proposals.push(proposal);
  }
  for (const proposal of evaluateEconomy(context)) {
    if (proposal.villageId !== village.id || proposal.action.type !== "build" ||
        !producers.includes(proposal.action.building as typeof producers[number])) continue;
    const option=village.options.build.find(value=>value.building===proposal.action.building);
    const capacity=option?unblocker(context,village,option):null;
    if(capacity){proposals.push(capacity);continue;}
    const resource =
      producerResources[
        proposal.action.building as keyof typeof producerResources
      ];
    const lag = balance[resource];
    const score = lag === undefined ? null : balanceScore(lag);
    proposals.push({
      ...proposal,
      task: `econ.${proposal.action.building}` as TaskKey,
      advisor: "economic-city",
      importance:
        score !== null ? score : Math.min(65, proposal.importance),
    });
  }
  if (Math.min(...producers.map(building => village.buildings[building])) >= 5 &&
      village.buildings.market === 0) {
    const proposal = buildOrUnblock(context, village, "econ.market", "market", 60, "Build Market 1 after all three producers reach level 5.");
    if (proposal) proposals.push(proposal);
  }
  return proposals;
}

export function evaluateEconomicCities(context: AdvisorContext): Proposal[] {
  return context.state.villages
    .filter(village => context.cityRoles?.get(village.id)?.role === "economic")
    .flatMap(village => economicCitySetupDone(village)
      ? afterSetup(context, village)
      : requestStep(context, village));
}

export const economicCityAdvisor: Advisor = {
  id: "economic-city",
  evaluate: evaluateEconomicCities,
};
