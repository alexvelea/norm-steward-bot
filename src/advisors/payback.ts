import type { Resources, RulesResponse } from "../shared/api.js";
export const PRODUCER_RESOURCE = {
  lumberyard: "timber",
  quarry: "stone",
  mine: "iron",
} as const;
const resources = ["timber", "stone", "iron"] as const;
export interface PaybackInput {
  cost: Resources;
  stockMilli: Resources;
  ratesMilli: Resources;
  resource: keyof Resources;
  currentLevel: number;
  targetLevel: number;
  production: RulesResponse["tables"]["production"];
  tick: number;
  endTick: number;
  buildTicks: number;
  nextActTick?: number | null;
  affordableAtTick?: number | null;
}
export interface ProductionPayback {
  totalCost: number;
  extraPerTickMilli: number;
  completionTick: number | null;
  repaymentTicks: number | null;
  repaymentTick: number | null;
  extraByEnd: number;
  repays: boolean;
  reason: string;
}
/** Gross marginal production, not existing income. Costs treat timber/stone/iron as equal units. */
export function productionPayback(input: PaybackInput): ProductionPayback {
  const {
    cost,
    stockMilli,
    ratesMilli,
    resource,
    production,
    currentLevel,
    targetLevel,
    tick,
    endTick,
    buildTicks,
  } = input;
  const totalCost = resources.reduce((sum, r) => sum + cost[r], 0);
  const result: ProductionPayback = {
    totalCost,
    extraPerTickMilli: 0,
    completionTick: null,
    repaymentTicks: null,
    repaymentTick: null,
    extraByEnd: 0,
    repays: false,
    reason: "",
  };
  const invalid = (reason: string) => ({ ...result, reason });
  if (
    ![
      tick,
      endTick,
      buildTicks,
      totalCost,
      ...resources.flatMap((r) => [cost[r], stockMilli[r], ratesMilli[r]]),
    ].every((n) => Number.isFinite(n) && n >= 0)
  )
    return invalid(
      "Live production-payback inputs are unavailable; do not reserve for an unproven investment.",
    );
  const oldBase = production[currentLevel]?.perTickMilli,
    newBase = production[targetLevel]?.perTickMilli;
  if (!oldBase || newBase === undefined || targetLevel <= currentLevel)
    return invalid(
      "The live production table does not establish this upgrade's additional output.",
    );
  // Preserve the multiplier observed in state, with the server's integer milli-resource precision.
  const nextRate = Math.round((ratesMilli[resource] * newBase) / oldBase);
  result.extraPerTickMilli = nextRate - ratesMilli[resource];
  if (result.extraPerTickMilli <= 0)
    return invalid(
      "This upgrade has no measurable additional resource production; it cannot repay its cost.",
    );
  let wait = 0;
  for (const r of resources) {
    const shortfall = cost[r] * 1000 - stockMilli[r];
    if (shortfall > 0) {
      if (ratesMilli[r] <= 0)
        return invalid(
          `Cannot fund the ${r} cost from current production; no resource payback is established.`,
        );
      wait = Math.max(wait, Math.ceil(shortfall / ratesMilli[r]));
    }
  }
  const start = Math.max(
    tick + wait,
    input.nextActTick ?? tick,
    input.affordableAtTick ?? tick,
  );
  result.completionTick = start + buildTicks;
  result.repaymentTicks = Math.ceil(
    (totalCost * 1000) / result.extraPerTickMilli,
  );
  result.repaymentTick = result.completionTick + result.repaymentTicks;
  result.extraByEnd =
    (Math.max(0, endTick - result.completionTick) * result.extraPerTickMilli) /
    1000;
  result.repays = result.repaymentTick <= endTick;
  result.reason = `Resource payback: ${totalCost} total cost (timber + stone + iron), +${(result.extraPerTickMilli / 1000).toFixed(3)} ${resource}/tick after completion at ${result.completionTick}. Repayment takes ${result.repaymentTicks} production ticks, reaching tick ${result.repaymentTick}; round ends at ${endTick}. Extra gross output by then: ${result.extraByEnd.toFixed(1)}. ${result.repays ? "Pays back by round end." : "Does not pay back by round end; do not upgrade."}`;
  return result;
}
