import type { Resources, VillageState } from "../shared/api.js";
export const PRODUCER_CEILING = 20;
/** Average cost of the requested 3Pi1Sh mix at this village's live Barracks speed. */
export function defenseBudget(v: VillageState) {
  if ([v.buildings.lumberyard, v.buildings.quarry, v.buildings.mine].some(n => n < 5) || v.buildings.barracks < 1 || v.buildings.smithy < 1) return null;
  const p = v.options.train.find(o => o.unit === "pikeman"), s = v.options.train.find(o => o.unit === "shieldman");
  if (!p || !s || ![p.ticksEach,s.ticksEach,p.pop,s.pop].every(n => Number.isSafeInteger(n) && n > 0)) return null;
  const ticks = 3 * p.ticksEach + s.ticksEach;
  const cost = Object.fromEntries((["timber","stone","iron"] as const).map(r => [r, 3*p.cost[r]+s.cost[r]])) as Resources;
  if (Object.values(cost).some(n => !Number.isFinite(n) || n < 0)) return null;
  const perTick = Object.fromEntries((["timber","stone","iron"] as const).map(r => [r,cost[r]/ticks])) as Resources;
  return { ticks, cost, perTick, pop:3*p.pop+s.pop };
}
