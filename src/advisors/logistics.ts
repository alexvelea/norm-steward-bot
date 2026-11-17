import type { Action, BuildingId, Resources, VillageState } from "../shared/api.js";
import { RESOURCE_IDS, type ResourceId } from "./balance.js";
import { economicCitySetupDone } from "./economic-city.js";
import { cityRoles } from "../bot/strategy/roles.js";
import type { Advisor, AdvisorContext, Proposal } from "./types.js";
import type { TaskKey } from "../bot/plan/graph.js";

const resources = RESOURCE_IDS;
const producers = ["lumberyard", "quarry", "mine"] as const;

interface Request {
  village: VillageState;
  resource: ResourceId;
  amount: number;
  score: number;
}

function requestStage(village: VillageState): {
  trigger: number;
  topUp: number;
  score: number;
} {
  if (!economicCitySetupDone(village)) {
    return { trigger: 1000, topUp: 2000, score: 95 };
  }
  if (Math.min(...producers.map((building) => village.buildings[building])) < 10) {
    return { trigger: 2000, topUp: 4000, score: 85 };
  }
  return { trigger: 2000, topUp: 4000, score: 40 };
}

function incomingTo(context: AdvisorContext, villageId: string): Resources {
  return context.state.trades.incoming
    .filter(trade => trade.to.id === villageId)
    .reduce((sum, trade) => ({
      timber: sum.timber + trade.resources.timber,
      stone: sum.stone + trade.resources.stone,
      iron: sum.iron + trade.resources.iron,
    }), { timber: 0, stone: 0, iron: 0 });
}

function requestsFor(
  context: AdvisorContext,
  capital: VillageState,
  village: VillageState,
): Request[] {
  const stage = requestStage(village);
  const incoming = incomingTo(context, village.id);
  return resources.flatMap((resource) => {
    if (village.resources[resource] >= stage.trigger) return [];
    const hasOutgoing = context.state.trades.outgoing.some((trade) =>
      !trade.returning &&
      trade.from.id === capital.id &&
      trade.to.id === village.id &&
      (trade.resources[resource] ?? 0) > 0
    );
    const hasJournalTrade = (context.activeProposals ?? []).some((proposal) =>
      proposal.action.type === "trade" &&
      proposal.action.village === capital.id &&
      proposal.action.target === village.id &&
      (proposal.action.resources[resource] ?? 0) > 0
    );
    if (hasOutgoing || hasJournalTrade) return [];
    const amount = Math.max(
      0,
      Math.min(stage.topUp, village.storage) -
        village.resources[resource] -
        incoming[resource],
    );
    return amount > 0
      ? [{ village, resource, amount, score: stage.score }]
      : [];
  });
}

function tradeProposal(
  context: AdvisorContext,
  capital: VillageState,
  request: Request,
  requestRank: number,
): Proposal<Extract<Action, { type: "trade" }>> {
  const blockers: string[] = [];
  if (capital.resourcesMilli[request.resource] < request.amount * 1000) {
    blockers.push("INSUFFICIENT_RESOURCES");
  }
  if (Math.ceil(request.amount / 1000) > capital.merchants.available) {
    blockers.push("NOT_ENOUGH_MERCHANTS");
  }
  if ((context.state.player.nextActTick ?? 0) > context.state.world.tick) {
    blockers.push("COUNCIL_COOLDOWN");
  }
  return {
    id: `${context.state.world.epoch}:${capital.id}:trade:${request.village.id}:${request.resource}:${request.amount}`,
    task: "logistics.fulfil",
    advisor: "logistics",
    villageId: capital.id,
    villageName: capital.name,
    action: {
      type: "trade",
      village: capital.id,
      target: request.village.id,
      resources: { [request.resource]: request.amount },
    },
    buildingName: `Trade ${request.resource} to ${request.village.name}`,
    currentLevel: 0,
    targetLevel: 0,
    importance: request.score,
    reason: `Fulfil the economic-city ${request.resource} request (${request.amount}).`,
    requirements: {
      timber: request.resource === "timber" ? request.amount : 0,
      stone: request.resource === "stone" ? request.amount : 0,
      iron: request.resource === "iron" ? request.amount : 0,
    },
    blockers,
    status: blockers.length ? "waiting" : "ready",
    affordableAtTick: null,
    requestRank,
  };
}

function marketProposal(
  context: AdvisorContext,
  capital: VillageState,
  importance: number,
): Proposal<Extract<Action, { type: "build" }>> | null {
  const option = capital.options.build.find(value => value.building === "market");
  if (!option || option.blockers.includes("MAX_LEVEL")) return null;
  const blockers: string[] = [...option.blockers];
  if (capital.buildQueue.length) blockers.push("BUILD_QUEUE_BUSY");
  if (resources.some(resource =>
    capital.resourcesMilli[resource] < option.cost[resource] * 1000
  ) && !blockers.includes("INSUFFICIENT_RESOURCES")) blockers.push("INSUFFICIENT_RESOURCES");
  if ((context.state.player.nextActTick ?? 0) > context.state.world.tick) blockers.push("COUNCIL_COOLDOWN");
  let funded = context.state.world.tick;
  for (const resource of resources) {
    const deficit = option.cost[resource] * 1000 - capital.resourcesMilli[resource];
    if (deficit <= 0) continue;
    const rate = capital.productionPerTickMilli[resource];
    funded = rate > 0
      ? Math.max(funded, context.state.world.tick + Math.ceil(deficit / rate))
      : Infinity;
  }
  if (funded + option.ticks + 60 > context.state.world.endsAtTick) blockers.push("ROUND_END_TOO_SOON");
  const uniqueBlockers = [...new Set(blockers)];
  const metadata = context.rules.rules.BUILDINGS as Record<BuildingId, { name: string }>;
  return {
    id: `${context.state.world.epoch}:${capital.id}:logistics.market-growth:${option.level}`,
    task: "logistics.market-growth" as TaskKey,
    advisor: "logistics",
    villageId: capital.id,
    villageName: capital.name,
    action: { type: "build", village: capital.id, building: "market" },
    buildingName: metadata.market.name,
    currentLevel: capital.buildings.market,
    targetLevel: option.level,
    importance,
    reason: "Increase capital merchant capacity to serve all currently open economic-city requests.",
    requirements: option.cost,
    blockers: uniqueBlockers,
    status: uniqueBlockers.length ? "waiting" : "ready",
    affordableAtTick: option.affordableAtTick,
  };
}

export function evaluateLogistics(context: AdvisorContext): Proposal[] {
  const roles = context.cityRoles ?? cityRoles(context, []);
  const capital = context.state.villages.find(village => roles.get(village.id)?.role === "capital");
  if (!capital) return [];
  const requests = context.state.villages
    .filter(village => roles.get(village.id)?.role === "economic")
    .flatMap(village => requestsFor(context, capital, village))
    .sort((a, b) =>
      b.score - a.score ||
      a.village.points - b.village.points ||
      resources.indexOf(a.resource) - resources.indexOf(b.resource)
    );
  if (!requests.length) return [];
  const proposals: Proposal[] = requests.map((request, index) =>
    tradeProposal(context, capital, request, index)
  );
  const totalDemand = requests.reduce((total, request) => total + request.amount, 0);
  const totalMerchants = Math.ceil(totalDemand / 1000);
  if (totalMerchants > capital.merchants.total) {
    const proposal = marketProposal(context, capital, Math.max(...requests.map(request => request.score)));
    if (proposal) proposals.push(proposal);
  }
  return proposals;
}

export const logisticsAdvisor: Advisor = {
  id: "logistics",
  evaluate: evaluateLogistics,
};
