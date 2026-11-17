import type { VillageState } from "../shared/api.js";

export const RESOURCE_IDS = ["timber", "stone", "iron"] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

type BalanceView = Pick<VillageState, "resources" | "production">;

/** Stock measured in minutes of the village's average production, so every resource shares one rate. */
export function stockMinutes(village: BalanceView, resource: ResourceId): number {
  const average = RESOURCE_IDS.reduce((sum, id) => sum + village.production[id], 0) / RESOURCE_IDS.length;
  return village.resources[resource] / Math.max(1e-9, average);
}

export function balanceLags(
  village: BalanceView,
): Partial<Record<ResourceId, number>> {
  const lags: Partial<Record<ResourceId, number>> = {};
  for (const resource of RESOURCE_IDS) {
    if (village.production[resource] === 0) continue;
    const otherStocks = RESOURCE_IDS
      .filter((other) => other !== resource)
      .map((other) => stockMinutes(village, other));
    lags[resource] = Math.min(...otherStocks) - stockMinutes(village, resource);
  }
  return lags;
}

export function balanceScore(lag: number): number | null {
  return lag >= 5
    ? Math.min(99, 90 + Math.floor((lag - 5) / 5))
    : null;
}
