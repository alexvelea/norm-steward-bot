import { createHash } from "node:crypto";
import type { Action, BuildingId, Resources, VillageState } from "../shared/api.js";
import { economicCitySetupDone } from "./economic-city.js";
import { cityRoles } from "../bot/strategy/roles.js";
import type { Advisor, AdvisorContext, Proposal } from "./types.js";
import type { TaskKey } from "../bot/plan/graph.js";

const resources = ["timber", "stone", "iron"] as const;
type Amounts = Resources;

interface Request {
  village: VillageState;
  amounts: Amounts;
  merchants: number;
  score: number;
}

function requestScore(village: VillageState): number {
  if (!economicCitySetupDone(village)) return 90;
  if (Math.min(village.buildings.lumberyard, village.buildings.quarry, village.buildings.mine) < 5 ||
      village.buildings.market < 1) return 65;
  return 40;
}

function incomingTo(context: AdvisorContext, villageId: string): Amounts {
  return context.state.trades.incoming
    .filter(trade => trade.to.id === villageId)
    .reduce((sum, trade) => ({
      timber: sum.timber + trade.resources.timber,
      stone: sum.stone + trade.resources.stone,
      iron: sum.iron + trade.resources.iron,
    }), { timber: 0, stone: 0, iron: 0 });
}

function openRequest(
  context: AdvisorContext,
  capital: VillageState,
  village: VillageState,
  hasJournalTrade: boolean,
): Request | null {
  const hasOutgoing = context.state.trades.outgoing.some(trade =>
    !trade.returning && trade.from.id === capital.id && trade.to.id === village.id
  );
  if (hasOutgoing || hasJournalTrade ||
      !resources.some(resource => village.resources[resource] < 1000)) return null;
  const incoming = incomingTo(context, village.id);
  const amounts = Object.fromEntries(resources.map(resource => [
    resource,
    Math.max(0, Math.min(2000, village.storage) - village.resources[resource] - incoming[resource]),
  ])) as Amounts;
  const sum = resources.reduce((total, resource) => total + amounts[resource], 0);
  if (!sum) return null;
  return {
    village,
    amounts,
    merchants: Math.ceil(sum / 1000),
    score: requestScore(village),
  };
}

function tradeProposal(
  context: AdvisorContext,
  capital: VillageState,
  request: Request,
  requestRank: number,
): Proposal<Extract<Action, { type: "trade" }>> {
  const blockers: string[] = [];
  if (resources.some(resource =>
    capital.resourcesMilli[resource] < request.amounts[resource] * 1000
  )) blockers.push("INSUFFICIENT_RESOURCES");
  if (request.merchants > capital.merchants.available) blockers.push("NOT_ENOUGH_MERCHANTS");
  if ((context.state.player.nextActTick ?? 0) > context.state.world.tick) {
    blockers.push("COUNCIL_COOLDOWN");
  }
  const digest = createHash("sha256").update(JSON.stringify(request.amounts)).digest("hex");
  const amounts = `${request.amounts.timber}/${request.amounts.stone}/${request.amounts.iron}`;
  return {
    id: `${context.state.world.epoch}:${capital.id}:trade:${request.village.id}:${digest}`,
    task: "logistics.fulfil",
    advisor: "logistics",
    villageId: capital.id,
    villageName: capital.name,
    action: {
      type: "trade",
      village: capital.id,
      target: request.village.id,
      resources: request.amounts,
    },
    buildingName: `Trade to ${request.village.name}`,
    currentLevel: 0,
    targetLevel: 0,
    importance: request.score,
    reason: `Fulfil the economic-city resource request (${amounts}).`,
    requirements: request.amounts,
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
    .map(village => {
      const hasJournalTrade = (context.activeProposals ?? []).some(proposal =>
        proposal.action.type === "trade" &&
        proposal.action.village === capital.id &&
        proposal.action.target === village.id
      );
      return openRequest(context, capital, village, hasJournalTrade);
    })
    .filter((request): request is Request => request !== null)
    .sort((a, b) => b.score - a.score || a.village.points - b.village.points);
  if (!requests.length) return [];
  const proposals: Proposal[] = requests.map((request, index) =>
    tradeProposal(context, capital, request, index)
  );
  const totalDemand = requests.reduce((total, request) =>
    total + resources.reduce((sum, resource) => sum + request.amounts[resource], 0), 0);
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
