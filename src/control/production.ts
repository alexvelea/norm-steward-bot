import type { HistorySample, Resources, StateResponse } from "../shared/api.js";
export interface ProductionLedger {
  scope: string;
  fromTick: number;
  toTick: number;
  generatedMilli: Resources;
  ratesMilli: Resources;
}
export interface ProductionView {
  fromTick: number;
  toTick: number;
  produced: Resources;
  estimated: true;
}
const resources = ["timber", "stone", "iron"] as const;
const zero = (): Resources => ({ timber: 0, stone: 0, iron: 0 });
export function productionScope(
  server: string,
  account: string,
  state: StateResponse,
): string {
  return `${server}|${account}|${state.world.id}|${state.world.epoch}`;
}
/** Gross generation, before overflow or spending. Rate changes are estimated between observations. */
export function trackProduction(
  previous: ProductionLedger | undefined,
  scope: string,
  state: StateResponse,
  history: HistorySample[] = [],
): ProductionLedger {
  const tick = state.world.tick,
    rates = zero();
  for (const v of state.villages)
    for (const r of resources) rates[r] += v.productionPerTickMilli[r];
  let ledger: ProductionLedger;
  if (previous?.scope === scope && previous.toTick <= tick)
    ledger = structuredClone(previous);
  else {
    const samples = [...history]
      .filter((s) => s.tick <= tick)
      .sort((a, b) => a.tick - b.tick);
    const first = samples[0];
    ledger = {
      scope,
      fromTick: first?.tick ?? tick,
      toTick: first?.tick ?? tick,
      generatedMilli: zero(),
      ratesMilli: first
        ? (Object.fromEntries(
            resources.map((r) => [
              r,
              Math.round((first.production[r] * 1000) / 60),
            ]),
          ) as Resources)
        : rates,
    };
    for (const sample of samples.slice(1)) {
      const sampleRates = Object.fromEntries(
        resources.map((r) => [
          r,
          Math.round((sample.production[r] * 1000) / 60),
        ]),
      ) as Resources;
      for (const r of resources)
        ledger.generatedMilli[r] +=
          ((sample.tick - ledger.toTick) *
            (ledger.ratesMilli[r] + sampleRates[r])) /
          2;
      ledger.toTick = sample.tick;
      ledger.ratesMilli = sampleRates;
    }
  }
  for (const r of resources)
    ledger.generatedMilli[r] +=
      ((tick - ledger.toTick) * (ledger.ratesMilli[r] + rates[r])) / 2;
  ledger.toTick = tick;
  ledger.ratesMilli = rates;
  return ledger;
}
export function productionView(
  ledger: ProductionLedger | undefined,
): ProductionView | null {
  return ledger
    ? {
        fromTick: ledger.fromTick,
        toTick: ledger.toTick,
        produced: Object.fromEntries(
          resources.map((r) => [r, ledger.generatedMilli[r] / 1000]),
        ) as Resources,
        estimated: true,
      }
    : null;
}
