import { defenseBudget, PRODUCER_CEILING } from "./defense-budget.js";
import { productionPayback } from "./payback.js";
import { completionWindow } from "./completion.js";
import { estimateHall } from "./hall.js";
import type { Action, BuildingId, Resources, VillageState } from "../shared/api.js";
import {
  compareProposals,
  type Advisor,
  type AdvisorContext,
  type Proposal,
} from "./types.js";

export const ECONOMIC_BUILDINGS = [
  "hall",
  "lumberyard",
  "quarry",
  "mine",
  "storehouse",
  "cellar",
  "farm",
] as const;
const producers = {
  lumberyard: "timber",
  quarry: "stone",
  mine: "iron",
} as const;
const resources = ["timber", "stone", "iron"] as const;
const round = (n: number) => Math.round(n * 10) / 10;
export interface EconomicForecast {
  villageId: string;
  villageName: string;
  stock: Resources;
  threeMinutes: Resources;
  fiveMinutes: Resources;
  fiveMinuteProduction: Resources;
  producerDemand: Resources;
  coverage: Resources;
  freePopulation: number;
  requiredFreePopulation: number;
  storage: number;
  hidden: number;
}
export function forecastEconomy(v: VillageState): EconomicForecast {
  const stock = {} as Resources,
    threeMinutes = {} as Resources,
    fiveMinutes = {} as Resources;
  const fiveMinuteProduction = {} as Resources,
    producerDemand = {} as Resources,
    coverage = {} as Resources;
  const upgrades = v.options.build.filter(
    (o) => o.building in producers && !o.blockers.includes("MAX_LEVEL"),
  );
  for (const r of resources) {
    stock[r] = v.resourcesMilli[r] / 1000;
    threeMinutes[r] = stock[r] + (v.productionPerTickMilli[r] / 1000) * 180;
    fiveMinuteProduction[r] = (v.productionPerTickMilli[r] / 1000) * 300;
    fiveMinutes[r] = stock[r] + fiveMinuteProduction[r];
    producerDemand[r] = upgrades.reduce((sum, o) => sum + o.cost[r], 0);
    coverage[r] = threeMinutes[r] / Math.max(1, producerDemand[r]);
  }
  return {
    villageId: v.id,
    villageName: v.name,
    stock,
    threeMinutes,
    fiveMinutes,
    fiveMinuteProduction,
    producerDemand,
    coverage,
    freePopulation: v.population.max - v.population.used,
    requiredFreePopulation: Math.max(50, v.population.max * 0.2),
    storage: v.storage,
    hidden: v.hidden,
  };
}

export const economicAdvisor: Advisor = {
  id: "economic",
  evaluate: evaluateEconomy,
};
export function evaluateEconomy({ state, rules }: AdvisorContext): Proposal<Extract<Action, {type: "build"}>>[] {
  const metadata = rules.rules.BUILDINGS as Record<
    BuildingId,
    { name: string; maxLevel: number }
  >;
  if (!metadata || rules.version !== state.world.rulesVersion)
    throw new Error("Live rules do not match this world's rules version.");
  const proposals: Proposal<Extract<Action, {type: "build"}>>[] = [];
  for (const v of state.villages) {
    const f = forecastEconomy(v);
    const defense = defenseBudget(v);
    const farmOption = v.options.build.find(o => o.building === "farm");
    const farmForRecruitment = !!defense && !!farmOption && state.world.endsAtTick - state.world.tick > farmOption.ticks + defense.ticks + 60 && f.freePopulation < Math.ceil(f.requiredFreePopulation) + defense.pop;
    const needsFarm = f.freePopulation < f.requiredFreePopulation || farmForRecruitment;
    const storageTicks = Math.max(0, Math.min(300, state.world.endsAtTick - state.world.tick));
    const storageForecast = (r: keyof Resources) => v.resourcesMilli[r] + v.productionPerTickMilli[r] * storageTicks;
    const needsStorage = resources.some((r) => storageForecast(r) > v.storage * 1000);
    const cellarTarget = Math.max(
      ...resources.map((r) => (v.productionPerTickMilli[r] / 1000) * 60),
    );
    const needsCellar = v.hidden < cellarTarget;
    const producerCoverages = Object.values(producers).map(
      (r) => f.coverage[r],
    );
    const hall = estimateHall(v, rules, state.world);
    const imminentThreat = state.commands.incoming.some(
      (c) =>
        c.kind === "attack" &&
        c.to.id === v.id &&
        c.arrivalTick <= state.world.tick + 300,
    );
    if (imminentThreat) {
      hall.needed = false;
      hall.importance = 30;
      hall.reason =
        "An attack arrives within 300 ticks. Defer construction-speed investment; preserve resources for defence. " +
        hall.reason;
    }
    for (const building of ECONOMIC_BUILDINGS) {
      const option = v.options.build.find((o) => o.building === building),
        queued = v.buildQueue.find((q) => q.building === building);
      if (
        !option ||
        (!queued && v.buildings[building] >= metadata[building].maxLevel)
      )
        continue;
      let importance = 0,
        reason = "",
        needed = true;
      if (building in producers) {
        const r = producers[building as keyof typeof producers];
        const rank = producerCoverages.filter(
          (n) => n < f.coverage[r] - 1e-9,
        ).length;
        importance = v.buildings[building] < 5 ? 85 - rank : 60 - rank * 10;
        if (defense && v.productionPerTickMilli[r] / 1000 < defense.perTick[r] && f.stock[r] < Math.max(defense.cost[r], (defense.perTick[r] - v.productionPerTickMilli[r] / 1000) * 120)) importance = 82 - rank;
        reason = (v.buildings[building] < 5 ? "Production-first opening: bring each producer to level 5 before protection, Hall investment or starter military; necessary Farm/Storehouse capacity still takes priority. " : "") + `In 3 minutes: ${round(f.threeMinutes[r])} ${r} (stock ${round(f.stock[r])} + production). The next lumberyard/quarry/mine upgrades together require ${f.producerDemand[r]} ${r}; projected coverage is ${round(f.coverage[r])}× that basket. Lower coverage takes priority (production rank ${rank + 1}).`;
        if (defense && importance >= 80 && v.buildings[building] >= 5) reason += ` Recruitment resource shortage: 3Pi1Sh needs ${round(defense.perTick[r]*60)} ${r}/minute; current production is ${round(v.productionPerTickMilli[r]*60/1000)}. Less than a two-minute deficit buffer remains; strengthen this income before discretionary spending.`;
        if (v.buildings[building] >= PRODUCER_CEILING) { needed = false; reason += ` Producer policy ceiling ${PRODUCER_CEILING} reached; spend on useful military capability instead of further compounding.`; }
      } else if (building === "farm") {
        needed = needsFarm;
        importance = needed ? (f.freePopulation <= 0 ? 100 : 95) : 20;
        reason = `${f.freePopulation} population slots free; target max(50, 20% of ${v.population.max}) = ${round(f.requiredFreePopulation)}. ${needed ? "Below the required buffer; expand capacity." : "Buffer is sufficient; do not upgrade."} Queued buildings and recruitment are already included in population used.${farmForRecruitment ? " Also leave room for the next four-population 3Pi1Sh bundle so recruitment cannot stall exactly at the buffer." : ""}`;
      } else if (building === "storehouse") {
        needed = needsStorage;
        const peak = Math.max(...resources.map((r) => storageForecast(r) / 1000));
        importance = needed
          ? 90 +
            Math.min(9, Math.ceil((peak / Math.max(1, v.storage) - 1) * 10))
          : 25;
        reason = `Stock + ${storageTicks} ticks of production (at most 300, bounded by round end): timber ${round(storageForecast("timber") / 1000)}, stone ${round(storageForecast("stone") / 1000)}, iron ${round(storageForecast("iron") / 1000)}. Storage holds ${v.storage} of each. ${needed ? "At least one resource would overflow; upgrade storage." : "All resources fit; do not upgrade."}`;
      } else if (building === "cellar") {
        needed = needsCellar;
        importance = needed ? 80 : 25;
        reason = `One-minute production buffer (60 ticks): timber ${round(v.productionPerTickMilli.timber * 60 / 1000)}, stone ${round(v.productionPerTickMilli.stone * 60 / 1000)}, iron ${round(v.productionPerTickMilli.iron * 60 / 1000)}. Cellar hides ${v.hidden} of each; target is ${round(cellarTarget)} per resource. ${needed ? "Expand protection toward that target." : "One minute of production is covered; do not upgrade."}`;
      } else {
        needed = hall.needed;
        importance = defense ? Math.min(69, hall.importance) : hall.importance;
        reason = hall.reason;
      }
      const payback =
        building in producers && !queued && !v.buildQueue.length
          ? productionPayback({
              cost: option.cost,
              stockMilli: v.resourcesMilli,
              ratesMilli: v.productionPerTickMilli,
              resource: producers[building as keyof typeof producers],
              currentLevel: v.buildings[building],
              targetLevel: option.level,
              production: rules.tables.production,
              tick: state.world.tick,
              endTick: state.world.endsAtTick,
              buildTicks: option.ticks,
              nextActTick: state.player.nextActTick,
              affordableAtTick: option.affordableAtTick,
            })
          : null;
      if (payback) {
        reason += " " + payback.reason;
        if (!payback.repays) needed = false;
      }
      const window = queued ? null : completionWindow(state, v, option);
      const tooLate = !!window && !window.fits;
      if (tooLate && needed) {
        needed = false;
        reason += ` Earliest snapshot completion is tick ${window!.completionTick}; the round ends at ${window!.endsAtTick}. Save these resources rather than buy construction that cannot finish by round end.`;
      }
      const blockers: string[] = queued
        ? ["ALREADY_QUEUED"]
        : [...option.blockers];
      if (payback && !payback.repays)
        blockers.push("NO_PAYBACK_BEFORE_ROUND_END");
      if (tooLate && !queued) blockers.push("ROUND_END_TOO_SOON");
      if (!needed && !queued) blockers.push("NOT_NEEDED");
      if (
        !queued &&
        Object.entries(option.cost).some(
          ([r, n]) => n > v.resources[r as keyof Resources],
        ) &&
        !blockers.includes("INSUFFICIENT_RESOURCES")
      )
        blockers.push("INSUFFICIENT_RESOURCES");
      if (!queued && v.buildQueue.length) blockers.push("BUILD_QUEUE_BUSY");
      if (v.orders.build.length) blockers.push("EXTERNAL_BUILD_ORDERS");
      if (state.world.status === "ended") blockers.push("WORLD_ENDED");
      if (
        state.player.nextActTick !== null &&
        state.player.nextActTick > state.world.tick
      )
        blockers.push("COUNCIL_COOLDOWN");
      const target = queued?.level ?? option.level;
      proposals.push({
        id: `${state.world.epoch}:${v.id}:${building}:${target}`,
        advisor: "economic",
        villageId: v.id,
        villageName: v.name,
        action: { type: "build", village: v.id, building },
        buildingName: metadata[building].name,
        currentLevel: v.buildings[building],
        targetLevel: target,
        importance,
        reason,
        requirements: queued?.cost ?? option.cost,
        blockers,
        status: queued
          ? "queued"
          : !needed
            ? "not-needed"
            : option.ok && blockers.length === 0
              ? "ready"
              : "waiting",
        affordableAtTick: option.affordableAtTick,
      });
    }
  }
  return proposals.sort(compareProposals);
}
