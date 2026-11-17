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

function missingPrerequisiteProposal(
  context: AdvisorContext,
  village: VillageState,
  task: TaskKey,
  building: BuildingId,
  importance: number,
  reason: string,
  unlockBuilding: BuildingId,
  visited: ReadonlySet<BuildingId>,
): Proposal<Extract<Action, { type: "build" }>> | null {
  const option = village.options.build.find(value => value.building === building);
  if (!option) return null;
  const metadata = context.rules.rules.BUILDINGS as Record<
    BuildingId,
    { name: string; requires: Partial<Record<BuildingId, number>> }
  >;
  if (option.blockers.includes("REQUIREMENTS_NOT_MET") && !visited.has(building)) {
    const missing = Object.entries(metadata[building].requires)
      .find(([prerequisite, level]) => village.buildings[prerequisite as BuildingId] < level!);
    if (missing) {
      const prerequisite = missing[0] as BuildingId;
      const nextVisited = new Set(visited);
      nextVisited.add(building);
      const proposal = missingPrerequisiteProposal(
        context,
        village,
        task,
        prerequisite,
        importance,
        reason,
        unlockBuilding,
        nextVisited,
      );
      if (proposal) return proposal;
    }
  }
  return buildProposal(
    context,
    village,
    task,
    building,
    importance,
    `${reason} Build ${metadata[building].name} ${option.level} to unlock ${metadata[unlockBuilding].name}.`,
  );
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
  if (option.blockers.includes("REQUIREMENTS_NOT_MET")) {
    const metadata = context.rules.rules.BUILDINGS as Record<
      BuildingId,
      { requires: Partial<Record<BuildingId, number>> }
    >;
    const missing = Object.entries(metadata[building].requires)
      .find(([prerequisite, level]) => village.buildings[prerequisite as BuildingId] < level!);
    if (missing) {
      const proposal = missingPrerequisiteProposal(
        context,
        village,
        task,
        missing[0] as BuildingId,
        importance,
        reason,
        building,
        new Set([building]),
      );
      if (proposal) return proposal;
    }
  }
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
    const ceiling=village.buildings.wall>=10?25:10;
    if(!option||option.level>ceiling)continue;
    const resource =
      producerResources[
        proposal.action.building as keyof typeof producerResources
      ];
    const lag = balance[resource];
    const score = lag === undefined ? null : balanceScore(lag);
    const task = `econ.${proposal.action.building}${option.level>10?"25":""}` as TaskKey;
    const buildingProposal = buildOrUnblock(
      context,
      village,
      task,
      proposal.action.building,
      score !== null ? score : Math.min(65, proposal.importance),
      proposal.reason,
    );
    if (buildingProposal) proposals.push(buildingProposal);
  }
  if(village.buildings.wall<10&&Math.min(...producers.map(building=>village.buildings[building]))>=10){
    const proposal=buildOrUnblock(context,village,"econ.wall10","wall",75,
      "Build the economic city's only military building: Wall 10, after all producers reach level 10.");
    if(proposal)proposals.push(proposal);
  }
  if (Math.min(...producers.map(building => village.buildings[building])) >= 5 &&
      village.buildings.market === 0) {
    const proposal = buildOrUnblock(context, village, "econ.market", "market", 60, "Build Market 1 after all three producers reach level 5.");
    if (proposal) proposals.push(proposal);
  }
  proposals.push(...surplusProposals(context, village, proposals));
  return proposals;
}

const SURPLUS_PRODUCER_LEVEL = 15;
const SURPLUS_RESERVE = 4000;
const SURPLUS_MERCHANTS = 5;

/** Above producers 15, ship stock beyond the next build's cost (at least 4,000) to the capital. */
function surplusProposals(
  context: AdvisorContext,
  village: VillageState,
  builds: readonly Proposal[],
): Proposal[] {
  if (Math.min(...producers.map(building => village.buildings[building])) < SURPLUS_PRODUCER_LEVEL ||
      village.buildings.market === 0) return [];
  const capital = context.state.villages
    .find(value => context.cityRoles?.get(value.id)?.role === "capital");
  if (!capital) return [];
  const next = [...builds].sort((a, b) => b.importance - a.importance)[0];
  const carry = 1000;
  const inbound = context.state.trades.outgoing
    .filter(trade => !trade.returning && trade.to.id === capital.id)
    .reduce((sum, trade) => ({
      timber: sum.timber + trade.resources.timber,
      stone: sum.stone + trade.resources.stone,
      iron: sum.iron + trade.resources.iron,
    }), { timber: 0, stone: 0, iron: 0 });
  const surplus = { timber: 0, stone: 0, iron: 0 };
  for (const resource of resources) {
    const reserve = Math.max(SURPLUS_RESERVE, next?.requirements[resource] ?? 0);
    const room = capital.storage - capital.resources[resource] - inbound[resource];
    surplus[resource] = Math.max(0, Math.floor(Math.min(village.resources[resource] - reserve, room)));
  }
  const total = resources.reduce((sum, resource) => sum + surplus[resource], 0);
  const wanted = Math.floor(total / carry);
  const proposals: Proposal[] = [];
  if (wanted > village.merchants.total) {
    const proposal = buildOrUnblock(context, village, "econ.market", "market", 55,
      `Surplus for the capital needs ${wanted} merchants; the Market has ${village.merchants.total}.`);
    if (proposal) proposals.push(proposal);
  }
  const journalled = (context.activeProposals ?? []).some(proposal =>
    proposal.action.type === "trade" && proposal.action.village === village.id);
  const minimum = Math.min(SURPLUS_MERCHANTS, village.merchants.total);
  if (journalled || wanted < Math.max(1, minimum)) return proposals;
  let budget = Math.min(wanted, village.merchants.available) * carry;
  const shipment = { timber: 0, stone: 0, iron: 0 };
  for (const resource of [...resources].sort((a, b) => surplus[b] - surplus[a])) {
    shipment[resource] = Math.min(surplus[resource], budget);
    budget -= shipment[resource];
  }
  const blockers: string[] = [];
  if (village.merchants.available < minimum) blockers.push("NOT_ENOUGH_MERCHANTS");
  if ((context.state.player.nextActTick ?? 0) > context.state.world.tick) blockers.push("COUNCIL_COOLDOWN");
  proposals.push({
    id: `${context.state.world.epoch}:${village.id}:econ.surplus:${capital.id}:${shipment.timber}:${shipment.stone}:${shipment.iron}`,
    task: "econ.surplus",
    advisor: "economic-city",
    villageId: village.id,
    villageName: village.name,
    action: { type: "trade", village: village.id, target: capital.id, resources: shipment },
    buildingName: `Trade surplus to ${capital.name}`,
    currentLevel: 0,
    targetLevel: 0,
    importance: 50,
    reason: `Producers are at ${SURPLUS_PRODUCER_LEVEL}+ and stock exceeds the next build's cost (at least ${SURPLUS_RESERVE} kept); send the surplus to the capital.`,
    requirements: shipment,
    blockers,
    status: blockers.length ? "waiting" : "ready",
    affordableAtTick: null,
  });
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
