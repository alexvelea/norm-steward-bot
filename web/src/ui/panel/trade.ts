import type { Resource, Resources, VillageState } from "../../contract";
import { RESOURCES } from "../../contract";

export function clampCargo(cargo: Partial<Resources>, available: Resources, capacity: number): Resources {
  let remaining = Math.max(0, Math.floor(capacity));
  return Object.fromEntries(RESOURCES.map((resource) => {
    const requested = cargo[resource] ?? 0;
    const count = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
    const amount = Math.min(count, Math.max(0, Math.floor(available[resource])), remaining);
    remaining -= amount;
    return [resource, amount];
  })) as Resources;
}

export function resourceLimit(resource: Resource, cargo: Resources, available: Resources, capacity: number): number {
  return Math.max(0, Math.floor(Math.min(available[resource], capacity - RESOURCES.reduce((sum, r) => sum + (r === resource ? 0 : cargo[r]), 0))));
}

export function supplyTargets(village: Pick<VillageState, "id" | "x" | "y">, villages: Pick<VillageState, "id" | "name" | "x" | "y">[]) {
  return villages.filter((v) => v.id !== village.id).sort((a, b) => Math.hypot(a.x - village.x, a.y - village.y) - Math.hypot(b.x - village.x, b.y - village.y));
}
