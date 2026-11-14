import type { BuildingId, BuildQueueItem, RulesTables } from "../../contract";
import { BUILDINGS, BUILDING_IDS, COMBAT, MARKET, UNITS, UNIT_IDS } from "../../contract";

const number = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);

/** Public effects from the same level tables the live engine publishes. */
export function buildingBenefit(id: BuildingId, level: number, tables: RulesTables): string {
  if (level === 0 && id !== "lumberyard" && id !== "quarry" && id !== "mine") return "Not built";
  switch (id) {
    case "lumberyard":
      return `${number(tables.production[level].perMinute)} timber / min`;
    case "quarry":
      return `${number(tables.production[level].perMinute)} stone / min`;
    case "mine":
      return `${number(tables.production[level].perMinute)} iron / min`;
    case "farm":
      return `${number(tables.farm[level])} population capacity`;
    case "storehouse":
      return `${number(tables.storage[level])} storage per resource`;
    case "cellar":
      return `${number(tables.cellar[level])} hidden per resource`;
    case "hall":
      return `${number((1 - tables.hallSpeed[level]) * 100)}% less construction time vs hall level 0`;
    case "market":
      return `${number(tables.merchants[level])} merchants · ${number(tables.merchants[level] * MARKET.merchantCarry)} carry`;
    case "watchtower":
      return `${number(tables.watchtowerRadius[level])} fields of sight`;
    case "wall":
      return `×${number(Math.pow(COMBAT.wallMultBase, level))} defence · +${number(COMBAT.wallFlat * level)} base`;
    case "smithy": {
      const units = UNIT_IDS.filter((u) => UNITS[u].smithyLevel > 0 && UNITS[u].smithyLevel <= level);
      return units.length ? `Arms for ${units.map((u) => UNITS[u].name.toLowerCase()).join(", ")}` : "Foundation for advanced arms";
    }
    case "court":
      return "Enables envoy training";
    case "barracks":
    case "stable":
    case "workshop":
      return `×${number(1 / tables.trainSpeed[level])} training speed`;
  }
}

/** The marginal gain of this step, separate from the total effect at the destination level. */
export function buildingImprovement(id: BuildingId, from: number, to: number, tables: RulesTables): string {
  if (to <= from) return "No change";
  const gain = (values: number[], label: string) => `+${number(values[to] - values[from])} ${label}`;
  switch (id) {
    case "lumberyard":
    case "quarry":
    case "mine": {
      const resource = id === "lumberyard" ? "timber" : id === "quarry" ? "stone" : "iron";
      const before = tables.production[from].perMinute;
      const after = tables.production[to].perMinute;
      return `+${number(after - before)} ${resource} / min (+${number((after / before - 1) * 100)}%)`;
    }
    case "hall":
      return `${number((1 - tables.hallSpeed[to] / tables.hallSpeed[from]) * 100)}% shorter construction times`;
    case "farm":
      return gain(tables.farm, "population capacity");
    case "storehouse":
      return gain(tables.storage, "storage per resource");
    case "cellar":
      return gain(tables.cellar, "hidden per resource");
    case "watchtower":
      return gain(tables.watchtowerRadius, "fields of sight");
    case "market":
      return `${gain(tables.merchants, "merchants")} · +${number((tables.merchants[to] - tables.merchants[from]) * MARKET.merchantCarry)} carry`;
    case "wall":
      return `+${number(COMBAT.wallFlat * (to - from))} base defence · +${number((Math.pow(COMBAT.wallMultBase, to - from) - 1) * 100)}% defence multiplier`;
    case "court":
      return "Unlocks envoy training";
    case "smithy": {
      const units = UNIT_IDS.filter((u) => UNITS[u].smithyLevel > from && UNITS[u].smithyLevel <= to);
      return units.length
        ? `Unlocks ${units.map((u) => UNITS[u].name).join(", ")} (other requirements apply)`
        : "No new unit unlock; supports higher prerequisites";
    }
    case "barracks":
    case "stable":
    case "workshop":
      return from === 0
        ? `Unlocks ${BUILDINGS[id].name.toLowerCase()} training`
        : `${number((1 - tables.trainSpeed[to] / tables.trainSpeed[from]) * 100)}% shorter training times`;
  }
}

export function buildingUnlocks(id: BuildingId, from: number, to: number): string[] {
  const buildings = BUILDING_IDS.filter((b) => {
    const needed = BUILDINGS[b].requires[id];
    return needed !== undefined && needed > from && needed <= to;
  }).map((b) => BUILDINGS[b].name);
  const units = UNIT_IDS.filter((u) => {
    const r = UNITS[u];
    return (
      (r.building === id && r.buildingLevel > from && r.buildingLevel <= to) ||
      (id === "smithy" && r.smithyLevel > from && r.smithyLevel <= to)
    );
  }).map((u) => UNITS[u].name);
  return [...buildings, ...units];
}

/** Waiting queue items have no start tick; only active work has progress. */
export function buildProgress(item: BuildQueueItem, tick: number): number {
  if (item.startTick === null) return 0;
  return Math.max(0, Math.min(1, (tick - item.startTick) / Math.max(1, item.endTick - item.startTick)));
}
