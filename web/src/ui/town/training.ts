import type { BuildingId, TrainBatch, TrainingBuilding } from "../../contract";
import { UNITS, UNIT_IDS } from "../../contract";

export function trainingBuilding(building: BuildingId): TrainingBuilding | null {
  return building === "barracks" || building === "stable" || building === "workshop" || building === "court" ? building : null;
}

export function trainedUnits(building: BuildingId) {
  return UNIT_IDS.filter((unit) => UNITS[unit].building === building);
}

export function trainingProgress(batch: TrainBatch, tick: number) {
  if (batch.nextTick === null || batch.count <= 0) return 0;
  const ticksEach = batch.remaining > 1 ? (batch.endTick - batch.nextTick) / (batch.remaining - 1) : 0;
  const partial = ticksEach > 0 ? Math.max(0, Math.min(1, 1 - (batch.nextTick - tick) / ticksEach)) : 0;
  return Math.max(0, Math.min(1, (batch.count - batch.remaining + partial) / batch.count));
}
