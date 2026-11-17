import type { UnitId, VillageState } from "../../contract";

export function unitInventory(village: Pick<VillageState, "units" | "training">, unit: UnitId) {
  const home = village.units.home[unit] ?? 0;
  const away = village.units.away[unit] ?? 0;
  const training = Object.values(village.training).flat().filter((batch) => batch.unit === unit).reduce((sum, batch) => sum + batch.remaining, 0);
  return { home, away, training, total: home + away + training };
}

export function validTrainCount(count: number, max: number) {
  return Number.isSafeInteger(count) && count > 0 && count <= max;
}
