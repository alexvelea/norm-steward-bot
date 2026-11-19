// Per-level tables computed once from config.ts. The engine reads every formula through these
// lookups, and GET /worlds/{w}/rules serves TABLES, so a bot and the server use the same numbers.

import {
  BUILDINGS,
  BUILDING_IDS,
  ECONOMY,
  HALL_SPEED_BASE,
  MARKET,
  RESOURCES,
  SCORING,
  TRAINING,
  UNITS,
  UNIT_IDS,
  WATCHTOWER,
  round,
} from "./config.js";
import type { BuildingId, Cost, UnitId } from "./config.js";
import type { LevelRow, RulesTables } from "../shared/api.js";

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

const HALL_MAX = BUILDINGS.hall.maxLevel;
const RESOURCE_BUILDING_MAX = Math.max(
  BUILDINGS.lumberyard.maxLevel,
  BUILDINGS.quarry.maxLevel,
  BUILDINGS.mine.maxLevel,
);
const TRAINING_BUILDING_MAX = Math.max(
  BUILDINGS.barracks.maxLevel,
  BUILDINGS.stable.maxLevel,
  BUILDINGS.workshop.maxLevel,
  BUILDINGS.court.maxLevel,
);

const hallSpeed = range(HALL_MAX + 1).map((h) => Math.pow(HALL_SPEED_BASE, h));

function levelRow(id: BuildingId, level: number): LevelRow {
  const rule = BUILDINGS[id];
  const cost = {} as Cost;
  for (const r of RESOURCES) cost[r] = round(rule.baseCost[r] * Math.pow(rule.costGrowth, level - 1));
  const ticksAtHall0 = rule.baseTime * Math.pow(rule.timeGrowth, level - 1);
  return {
    level,
    cost,
    ticksAtHall0,
    ticksByHall: hallSpeed.map((speed) => Math.max(1, round(ticksAtHall0 * speed))),
    pop: round(rule.basePop * Math.pow(rule.popGrowth, level - 1)),
    points: round(rule.basePoints * Math.pow(SCORING.pointsGrowth, level - 1)),
  };
}

const buildings = {} as Record<BuildingId, LevelRow[]>;
for (const id of BUILDING_IDS) {
  buildings[id] = range(BUILDINGS[id].maxLevel).map((i) => levelRow(id, i + 1));
}

const perMinuteAt = (level: number): number =>
  level === 0 ? ECONOMY.productionAtZero : ECONOMY.productionBase * Math.pow(ECONOMY.productionGrowth, level - 1);

export const TABLES: RulesTables = {
  buildings,
  production: range(RESOURCE_BUILDING_MAX + 1).map((level) => {
    const perMinute = perMinuteAt(level);
    return { level, perMinute, perTickMilli: round((perMinute * 1000) / 60) };
  }),
  storage: range(BUILDINGS.storehouse.maxLevel + 1).map((l) =>
    l === 0 ? 0 : round(ECONOMY.storageBase * Math.pow(ECONOMY.storageGrowth, l - 1)),
  ),
  cellar: range(BUILDINGS.cellar.maxLevel + 1).map((l) =>
    l === 0 ? 0 : round(ECONOMY.cellarBase * Math.pow(ECONOMY.cellarGrowth, l - 1)),
  ),
  farm: range(BUILDINGS.farm.maxLevel + 1).map((l) =>
    l === 0 ? 0 : round(ECONOMY.farmBase * Math.pow(ECONOMY.farmGrowth, l - 1)),
  ),
  merchants: range(BUILDINGS.market.maxLevel + 1).map((l) => round(MARKET.merchantsA * l * l + MARKET.merchantsB * l)),
  hallSpeed,
  trainSpeed: range(TRAINING_BUILDING_MAX + 1).map((l) => Math.pow(TRAINING.speedBase, Math.max(1, l) - 1)),
  watchtowerRadius: range(BUILDINGS.watchtower.maxLevel + 1).map((l) =>
    l === 0 ? 0 : WATCHTOWER.radiusBase + WATCHTOWER.radiusPerLevel * l,
  ),
};

// ---------------------------------------------------------------------------------------------
// Lookups the engine uses. Levels outside a table are clamped to its ends.

const at = <T>(table: readonly T[], i: number): T => table[Math.max(0, Math.min(table.length - 1, i))];

const ZERO_COST: Cost = { timber: 0, stone: 0, iron: 0 };

/** Cost of building level `level` (>= 1). */
export function levelCost(id: BuildingId, level: number): Cost {
  return level < 1 ? ZERO_COST : at(TABLES.buildings[id], level - 1).cost;
}

/** Ticks to build level `level` with the Great Hall at `hall`. */
export function buildTicks(id: BuildingId, level: number, hall: number): number {
  return at(at(TABLES.buildings[id], level - 1).ticksByHall, hall);
}

/** Total population a building uses at `level` (0 at level 0). */
export function buildingPop(id: BuildingId, level: number): number {
  return level < 1 ? 0 : at(TABLES.buildings[id], level - 1).pop;
}

const cumulativePoints = {} as Record<BuildingId, number[]>;
for (const id of BUILDING_IDS) {
  const sums = [0];
  for (const row of TABLES.buildings[id]) sums.push(sums[sums.length - 1] + row.points);
  cumulativePoints[id] = sums;
}

/** Points for every level of a building up to `level`. */
export function buildingPoints(id: BuildingId, level: number): number {
  return at(cumulativePoints[id], level);
}

export const productionPerTickMilli = (level: number): number => at(TABLES.production, level).perTickMilli;
export const productionPerMinute = (level: number): number => at(TABLES.production, level).perMinute;
export const storageCapacity = (level: number): number => at(TABLES.storage, level);
export const cellarHidden = (level: number): number => at(TABLES.cellar, level);
export const farmLimit = (level: number): number => at(TABLES.farm, level);
export const merchantCount = (level: number): number => at(TABLES.merchants, level);
export const watchtowerRadius = (level: number): number => at(TABLES.watchtowerRadius, level);

const trainTicksTable = {} as Record<UnitId, number[]>;
for (const unit of UNIT_IDS) {
  trainTicksTable[unit] = TABLES.trainSpeed.map((speed) => Math.max(1, round(UNITS[unit].trainTime * 1000 * speed)) / 1000);
}

/** Ticks to train one unit with its producing building at `level`. */
export function trainTicks(unit: UnitId, level: number): number {
  return at(trainTicksTable[unit], level);
}

/** Trebuchets (or rams) needed to knock a building from `level` to `level - 1`. */
export const knockCost = (base: number, perLevel: number, level: number): number => Math.ceil(base + perLevel * level);
