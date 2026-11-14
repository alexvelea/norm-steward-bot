import assert from "node:assert/strict";
import { test } from "node:test";
import {
  productionScope,
  productionView,
  trackProduction,
} from "../src/control/production.js";
import type { HistorySample } from "../src/shared/api.js";
import { context } from "./control-fixtures.js";

test("gross production persists across observations without double counting or subtracting expenditure", () => {
  const { state } = context();
  state.villages[0].productionPerTickMilli = {
    timber: 1000,
    stone: 2000,
    iron: 3000,
  };
  let ledger = trackProduction(undefined, "scope", state);
  state.world.tick += 60;
  state.villages[0].resourcesMilli = { timber: 0, stone: 0, iron: 0 };
  ledger = trackProduction(ledger, "scope", state);
  assert.deepEqual(productionView(ledger)!.produced, {
    timber: 60,
    stone: 120,
    iron: 180,
  });
  assert.deepEqual(trackProduction(ledger, "scope", state), ledger);
  const persisted = JSON.parse(JSON.stringify(ledger));
  state.world.tick += 60;
  assert.equal(
    productionView(trackProduction(persisted, "scope", state))!.produced.timber,
    120,
  );
});
test("history bootstraps totals and rate changes use the average observed rate", () => {
  const { state } = context();
  state.world.tick = 120;
  state.villages[0].productionPerTickMilli = {
    timber: 3000,
    stone: 3000,
    iron: 3000,
  };
  const sample = (tick: number, rate: number): HistorySample => ({
    tick,
    points: 0,
    score: 0,
    villages: 1,
    resources: { timber: 0, stone: 0, iron: 0 },
    production: { timber: rate, stone: rate, iron: rate },
    armyPop: 0,
    renown: { attack: 0, defense: 0 },
  });
  const ledger = trackProduction(undefined, "scope", state, [
    sample(60, 120),
    sample(0, 60),
    sample(180, 999),
  ]);
  assert.equal(ledger.fromTick, 0);
  assert.equal(productionView(ledger)!.produced.timber, 240); // 60*1.5 + 60*2.5
});
test("account, world epoch and backwards clock reset the production counter", () => {
  const { state } = context();
  const scope = productionScope("https://game.test", "a", state);
  let ledger = trackProduction(undefined, scope, state);
  state.world.tick += 60;
  ledger = trackProduction(ledger, scope, state);
  assert.ok(productionView(ledger)!.produced.timber > 0);
  assert.equal(
    productionView(
      trackProduction(
        ledger,
        productionScope("https://game.test", "b", state),
        state,
      ),
    )!.produced.timber,
    0,
  );
  state.world.epoch = "next";
  assert.equal(
    productionView(
      trackProduction(
        ledger,
        productionScope("https://game.test", "a", state),
        state,
      ),
    )!.produced.timber,
    0,
  );
  state.world.tick = 0;
  assert.equal(
    productionView(trackProduction(ledger, scope, state))!.produced.timber,
    0,
  );
});
test("production sums all managed villages", () => {
  const { state } = context();
  state.villages.push(structuredClone(state.villages[0]));
  state.villages.forEach(
    (v) =>
      (v.productionPerTickMilli = { timber: 1000, stone: 1000, iron: 1000 }),
  );
  const ledger = trackProduction(undefined, "scope", state);
  state.world.tick += 10;
  assert.equal(
    productionView(trackProduction(ledger, "scope", state))!.produced.timber,
    20,
  );
});
