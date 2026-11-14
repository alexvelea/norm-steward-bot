import type { BuildingId, Resources } from "../shared/api.js";
import type { Advisor, AdvisorContext, Proposal } from "./types.js";

export const ECONOMIC_BUILDINGS = ["hall", "lumberyard", "quarry", "mine", "storehouse", "cellar", "farm"] as const;
const producers = { lumberyard: "timber", quarry: "stone", mine: "iron" } as const;
const round = (n: number) => Math.round(n * 10) / 10;

export const economicAdvisor: Advisor = { id: "economic", evaluate: evaluateEconomy };
export function evaluateEconomy({ state, rules }: AdvisorContext): Proposal[] {
  const metadata = rules.rules.BUILDINGS as Record<BuildingId, { name: string; maxLevel: number }>;
  if (!metadata || rules.version !== state.world.rulesVersion)
    throw new Error("Live rules do not match this world's rules version.");
  const out: Proposal[] = [];
  for (const v of state.villages) {
    const free = v.population.max - v.population.used;
    const pressure = Math.max(...Object.values(v.resources).map((n) => n / Math.max(1, v.storage)));
    const fillTicks = Math.min(
      ...Object.keys(v.resources).map((r) => {
        const resource = r as keyof Resources;
        return (v.storage - v.resources[resource]) / Math.max(0.001, v.productionPerTickMilli[resource] / 1000);
      }),
    );
    const maxProduction = Math.max(1, ...Object.values(v.production));
    const needsStorage = v.options.build.some(
      (o) =>
        ECONOMIC_BUILDINGS.includes(o.building as (typeof ECONOMIC_BUILDINGS)[number]) &&
        o.blockers.includes("EXCEEDS_STORAGE"),
    );
    const hasOrders = v.orders.build.length > 0;
    for (const building of ECONOMIC_BUILDINGS) {
      const option = v.options.build.find((o) => o.building === building);
      const queued = v.buildQueue.find((q) => q.building === building);
      if (!option || (!queued && v.buildings[building] >= metadata[building].maxLevel)) continue;
      let importance = 0,
        reason = "";
      if (building in producers) {
        const r = producers[building as keyof typeof producers];
        const deficit = 1 - v.production[r] / maxProduction;
        const largestBill = Math.max(
          1,
          ...v.options.build
            .filter((o) => ECONOMIC_BUILDINGS.includes(o.building as (typeof ECONOMIC_BUILDINGS)[number]))
            .map((o) => o.cost[r]),
        );
        const shortage = Math.max(0, 1 - v.resources[r] / largestBill);
        importance = Math.min(79, 40 + Math.round(25 * deficit) + Math.round(14 * shortage));
        reason = `${r} production is ${round(v.production[r])}/min versus the fastest resource at ${round(maxProduction)}/min. Production imbalance adds ${Math.round(25 * deficit)} points; upgrade-cost pressure adds ${Math.round(14 * shortage)} to a base of 40.`;
      } else if (building === "farm") {
        importance =
          free <= 0
            ? 100
            : free <= Math.max(10, v.population.max * 0.08)
              ? 95
              : free <= v.population.max * 0.2
                ? 75
                : 20;
        reason = `${free} population slots free (${v.population.used}/${v.population.max} used, including reserved queues). ${importance >= 75 ? "Capacity is becoming a construction and recruitment bottleneck." : "There is comfortable population headroom."}`;
      } else if (building === "storehouse") {
        importance = needsStorage
          ? 99
          : pressure >= 0.95
            ? 98
            : pressure >= 0.85
              ? 90
              : fillTicks <= 120
                ? 86
                : pressure >= 0.65
                  ? 65
                  : 25;
        reason = needsStorage
          ? "An economic upgrade exceeds current storage capacity; expand storage to make it reachable."
          : `Fullest resource is at ${round(pressure * 100)}% of storage; production fills a store in about ${Math.max(0, Math.ceil(fillTicks))} game ticks. Preventing overflow outranks ordinary growth.`;
      } else if (building === "cellar") {
        const exposed = Math.max(0, Math.max(...Object.values(v.resources)) - v.hidden);
        const threatened = state.commands.incoming.some((c) => c.kind === "attack" && c.to.id === v.id);
        importance = threatened && exposed > 0 ? 85 : exposed > v.storage * 0.5 ? 40 : 25;
        reason = `${round(exposed)} of the most exposed resource is above cellar protection. ${threatened ? "An incoming attack raises protection priority (it may be scouting)." : "No incoming attack; protection ranks below capacity and production."}`;
      } else {
        const next = Math.min(v.buildings.hall + 1, rules.tables.hallSpeed.length - 1);
        const savings = v.options.build
          .filter(
            (o) =>
              o.building !== "hall" &&
              !o.blockers.includes("MAX_LEVEL") &&
              ECONOMIC_BUILDINGS.includes(o.building as (typeof ECONOMIC_BUILDINGS)[number]),
          )
          .reduce((sum, o) => {
            const row = rules.tables.buildings[o.building][o.level - 1];
            return sum + (row ? Math.max(0, row.ticksByHall[v.buildings.hall] - row.ticksByHall[next]) : 0);
          }, 0);
        const reduction = (1 - rules.tables.hallSpeed[next] / rules.tables.hallSpeed[v.buildings.hall]) * 100;
        importance = 30 + Math.min(45, Math.round((savings / Math.max(1, option.ticks)) * 35));
        reason = `Next hall level cuts construction duration by ${round(reduction)}%. Across the other economic upgrades that saves ${savings} ticks; the hall itself takes ${option.ticks} ticks. Score 30 plus up to 45 for near-term time savings.`;
      }
      const blockers: string[] = queued ? ["ALREADY_QUEUED"] : [...option.blockers];
      if (
        !queued &&
        Object.entries(option.cost).some(([r, cost]) => cost > v.resources[r as keyof Resources]) &&
        !blockers.includes("INSUFFICIENT_RESOURCES")
      )
        blockers.push("INSUFFICIENT_RESOURCES");
      if (!queued && v.buildQueue.length) blockers.push("BUILD_QUEUE_BUSY");
      if (hasOrders) blockers.push("EXTERNAL_BUILD_ORDERS");
      if (state.world.status !== "running" && state.world.status !== "paused") blockers.push("WORLD_ENDED");
      if (state.player.nextActTick !== null && state.player.nextActTick > state.world.tick)
        blockers.push("COUNCIL_COOLDOWN");
      const target = queued?.level ?? option.level;
      out.push({
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
        status: queued ? "queued" : option.ok && blockers.length === 0 ? "ready" : "waiting",
        affordableAtTick: option.affordableAtTick,
      });
    }
  }
  return out.sort(
    (a, b) =>
      b.importance - a.importance ||
      a.villageId.localeCompare(b.villageId) ||
      a.action.building.localeCompare(b.action.building),
  );
}
