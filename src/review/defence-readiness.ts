import type { BuildingId, ReportsResponse, RulesResponse, StateResponse, UnitId } from "../shared/api.js";

const militaryBuildings = ["barracks", "smithy", "wall", "watchtower", "stable", "workshop"] as const;

/** Observations only: no actions, combat model, or hypothetical recruitment target. */
export function defenceReadiness(state: StateResponse, rules: RulesResponse, reports: ReportsResponse, previous?: StateResponse) {
  if (state.world.rulesVersion !== rules.version) throw new Error("Evidence rules version mismatch");
  const metadata = rules.rules.BUILDINGS as Record<BuildingId, { requires: Partial<Record<BuildingId, number>> }>;
  if (!metadata) throw new Error("Missing building prerequisites in evidence");
  const units = rules.rules.UNITS as Record<UnitId, { building: BuildingId; buildingLevel: number; smithyLevel: number }>;
  const tick = state.world.tick;
  return {
    world: { id: state.world.id, epoch: state.world.epoch, round: state.world.round, tick,
      remainingTicks: state.world.endsAtTick === null ? null : Math.max(0, state.world.endsAtTick - tick) },
    limitations: [
      "Snapshot observations only; options marked ok are not execution approval or a President allocation.",
      "Report summaries omit attack strength, troop losses and loot; no force target or combat benefit is inferred.",
      "Reports are a retained page matched to current village IDs, not a complete round loss rate; reports have no epoch field.",
      "Observed defensive scouting counts reports of enemy reconnaissance, not battles, losses, or proof of a future attack.",
      "Queue drain excludes polling, Council cooldown, standing orders, other villages and future actions; it is not a readiness forecast.",
      "Training prerequisites are direct rule requirements at current levels; construction chains, costs and completion times are not projected. Server training blockers remain authoritative.",
    ],
    reports: { retained: reports.reports.length, hasOlderPage: reports.next !== null },
    comparison: previous ? compareReadiness(state, previous, reports) : null,
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
        trainingPrerequisites: v.options.train.map(option => {
          const definition = units?.[option.unit];
          if (!definition || !(definition.building in v.buildings)
            || !Number.isInteger(definition.buildingLevel) || definition.buildingLevel < 1
            || !Number.isInteger(definition.smithyLevel) || definition.smithyLevel < 0) {
            throw new Error(`Missing or invalid training prerequisites for ${option.unit}`);
          }
          const requirements = new Map<BuildingId, number>([[definition.building, definition.buildingLevel]]);
          if (definition.smithyLevel > 0) requirements.set("smithy", Math.max(requirements.get("smithy") ?? 0, definition.smithyLevel));
          return { unit: option.unit,
            missingPrerequisites: [...requirements].filter(([building, required]) => v.buildings[building] < required)
              .map(([building, required]) => ({ building, required, current: v.buildings[building] })),
          };
        }),
      };
    }),
  };
}

/** Compare observations, never policy effectiveness. Reports have no epoch of their own. */
function compareReadiness(state: StateResponse, previous: StateResponse, reports: ReportsResponse) {
  const sameScope = state.world.id === previous.world.id && state.world.epoch === previous.world.epoch
    && state.world.round === previous.world.round && state.player.id === previous.player.id;
  if (!sameScope || previous.world.tick >= state.world.tick) {
    return { status: "not-comparable" as const,
      reason: "Different account/world/epoch/round, or previous tick is not earlier." };
  }
  const fromTick = previous.world.tick;
  const toTick = state.world.tick;
  // A page reaching the boundary (or exhausted history) covers this interval under the
  // server's newest-first pagination contract. Deduplicate IDs before counting.
  const retained = [...new Map(reports.reports.map(r => [r.id, r])).values()];
  const intervalCovered = reports.next === null || retained.some(r => r.tick <= fromTick);
  const interval = retained.filter(r => r.tick > fromTick && r.tick <= toTick);
  return {
    status: "comparable" as const, fromTick, toTick, elapsedTicks: toTick - fromTick,
    reportIntervalCovered: intervalCovered,
    limitation: "Observed changes are not policy effects; raids, operator actions and collection timing may confound them. Counts are lower bounds when reportIntervalCovered is false.",
    villages: state.villages.map(v => {
      const old = previous.villages.find(p => p.id === v.id);
      const battles = interval.filter(r => r.kind === "battle" && r.role === "defender" && r.defender.id === v.id);
      return { villageId: v.id, presentPreviously: !!old,
        buildingLevelChanges: old ? Object.entries(v.buildings)
          .filter(([id, level]) => level !== old.buildings[id as BuildingId])
          .map(([id, level]) => ({ building: id, before: old.buildings[id as BuildingId], after: level })) : null,
        observedDefensiveScouting: interval.filter(r => r.kind === "scouting" && r.role === "defender" && r.defender.id === v.id).length,
        observedDefensiveBattles: battles.length,
        observedDefensiveLosses: battles.filter(r => r.outcome === "lost").length };
    }),
    missingPreviousVillageIds: previous.villages.filter(old => !state.villages.some(v => v.id === old.id)).map(v => v.id),
  };
}
