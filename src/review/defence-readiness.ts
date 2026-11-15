import type { BuildingId, ReportsResponse, RulesResponse, StateResponse } from "../shared/api.js";

const militaryBuildings = ["barracks", "smithy", "wall", "watchtower", "stable", "workshop"] as const;

/** Observations only: no actions, combat model, or hypothetical recruitment target. */
export function defenceReadiness(state: StateResponse, rules: RulesResponse, reports: ReportsResponse) {
  if (state.world.rulesVersion !== rules.version) throw new Error("Evidence rules version mismatch");
  const metadata = rules.rules.BUILDINGS as Record<BuildingId, { requires: Partial<Record<BuildingId, number>> }>;
  if (!metadata) throw new Error("Missing building prerequisites in evidence");
  const tick = state.world.tick;
  return {
    world: { id: state.world.id, epoch: state.world.epoch, round: state.world.round, tick,
      remainingTicks: state.world.endsAtTick === null ? null : Math.max(0, state.world.endsAtTick - tick) },
    limitations: [
      "Snapshot observations only; options marked ok are not execution approval or a President allocation.",
      "Report summaries omit attack strength, troop losses and loot; no force target or combat benefit is inferred.",
      "Reports are a retained page matched to current village IDs, not a complete round loss rate; reports have no epoch field.",
      "Queue drain excludes polling, Council cooldown, standing orders, other villages and future actions; it is not a readiness forecast.",
    ],
    reports: { retained: reports.reports.length, hasOlderPage: reports.next !== null },
    villages: state.villages.map(v => {
      const incoming = state.commands.incoming.filter(c => c.kind === "attack" && c.to.id === v.id);
      const battles = reports.reports.filter(r => r.kind === "battle" && r.role === "defender" && r.defender.id === v.id);
      return {
        villageId: v.id, name: v.name,
        units: v.units, supportHere: v.supportHere, training: v.training,
        freePopulation: v.population.max - v.population.used,
        queueDrainTicks: Math.max(0, ...v.buildQueue.map(q => q.endTick - tick)),
        standingBuildOrders: v.orders.build.length,
        incoming: incoming.map(c => ({ id: c.id, ticksUntilArrival: c.arrivalTick - tick,
          unitsKnown: c.units !== null, sighted: c.sighted })),
        retainedDefensiveBattles: battles.length,
        retainedDefensiveLosses: battles.filter(r => r.outcome === "lost").length,
        militaryBuildings: militaryBuildings.map(building => {
          const definition = metadata[building];
          if (!definition?.requires) throw new Error(`Missing prerequisites for ${building}`);
          return {
            building, level: v.buildings[building],
            missingPrerequisites: Object.entries(definition.requires)
              .filter(([id, level]) => v.buildings[id as BuildingId] < level!)
              .map(([id, level]) => ({ building: id, required: level, current: v.buildings[id as BuildingId] })),
            nextOption: v.options.build.find(o => o.building === building) ?? null,
          };
        }),
        trainingOptions: v.options.train,
      };
    }),
  };
}
