import type { BuildingId, Resources, VillageState } from "../shared/api.js";
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
export function evaluateEconomy({ state, rules }: AdvisorContext): Proposal[] {
  const metadata = rules.rules.BUILDINGS as Record<
    BuildingId,
    { name: string; maxLevel: number }
  >;
  if (!metadata || rules.version !== state.world.rulesVersion)
    throw new Error("Live rules do not match this world's rules version.");
  const proposals: Proposal[] = [];
  for (const v of state.villages) {
    const f = forecastEconomy(v);
    const needsFarm = f.freePopulation < f.requiredFreePopulation;
    const needsStorage = resources.some((r) => f.fiveMinutes[r] > v.storage);
    const cellarTarget = Math.max(
      ...resources.map((r) => f.fiveMinuteProduction[r]),
    );
    const needsCellar = v.hidden < cellarTarget;
    const producerCoverages = Object.values(producers).map(
      (r) => f.coverage[r],
    );
    // A hall must repay its own construction delay over the next three upgrades of each producer.
    let hallSavings = 0;
    const nextHall = Math.min(
      v.buildings.hall + 1,
      rules.tables.hallSpeed.length - 1,
    );
    for (const id of Object.keys(producers) as (keyof typeof producers)[]) {
      for (let step = 1; step <= 3; step++) {
        const row = rules.tables.buildings[id][v.buildings[id] + step - 1];
        if (row)
          hallSavings += Math.max(
            0,
            row.ticksByHall[v.buildings.hall] - row.ticksByHall[nextHall],
          );
      }
    }
    const hallDuration =
      v.options.build.find((o) => o.building === "hall")?.ticks ?? Infinity;
    const needsHall = hallSavings >= hallDuration && hallDuration > 0;
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
        importance = 60 - rank * 10;
        reason = `In 3 minutes: ${round(f.threeMinutes[r])} ${r} (stock ${round(f.stock[r])} + production). The next lumberyard/quarry/mine upgrades together require ${f.producerDemand[r]} ${r}; projected coverage is ${round(f.coverage[r])}× that basket. Lower coverage takes priority (production rank ${rank + 1}).`;
      } else if (building === "farm") {
        needed = needsFarm;
        importance = needed ? (f.freePopulation <= 0 ? 100 : 95) : 20;
        reason = `${f.freePopulation} population slots free; target max(50, 20% of ${v.population.max}) = ${round(f.requiredFreePopulation)}. ${needed ? "Below the required buffer; expand capacity." : "Buffer is sufficient; do not upgrade."} Queued buildings and recruitment are already included in population used.`;
      } else if (building === "storehouse") {
        needed = needsStorage;
        const peak = Math.max(...resources.map((r) => f.fiveMinutes[r]));
        importance = needed
          ? 90 +
            Math.min(9, Math.ceil((peak / Math.max(1, v.storage) - 1) * 10))
          : 25;
        reason = `Stock + 5 minutes of production: timber ${round(f.fiveMinutes.timber)}, stone ${round(f.fiveMinutes.stone)}, iron ${round(f.fiveMinutes.iron)}. Storage holds ${v.storage} of each. ${needed ? "At least one resource would overflow; upgrade storage." : "All resources fit; do not upgrade."}`;
      } else if (building === "cellar") {
        needed = needsCellar;
        importance = needed ? 80 : 25;
        reason = `Five-minute production buffer: timber ${round(f.fiveMinuteProduction.timber)}, stone ${round(f.fiveMinuteProduction.stone)}, iron ${round(f.fiveMinuteProduction.iron)}. Cellar hides ${v.hidden} of each; target is ${round(cellarTarget)} per resource. ${needed ? "Expand protection toward that target." : "Five minutes of production are covered; do not upgrade."}`;
      } else {
        needed = needsHall;
        importance = needed ? 75 : 30;
        reason = `Next hall level saves ${hallSavings} construction ticks across the next three upgrades of each resource producer; the hall itself takes ${option.ticks} ticks. ${needed ? "The projected savings repay the hall's construction delay." : "The savings do not repay that delay within this short horizon; do not upgrade."}`;
      }
      const blockers: string[] = queued
        ? ["ALREADY_QUEUED"]
        : [...option.blockers];
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
