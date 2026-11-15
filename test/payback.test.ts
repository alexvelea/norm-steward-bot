import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productionPayback,
  type PaybackInput,
} from "../src/advisors/payback.js";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { selectProposal } from "../src/advisors/president.js";
import { context } from "./control-fixtures.js";
function input(): PaybackInput {
  return {
    cost: { timber: 40, stone: 30, iron: 30 },
    stockMilli: { timber: 100000, stone: 100000, iron: 100000 },
    ratesMilli: { timber: 1000, stone: 1000, iron: 1000 },
    resource: "timber",
    currentLevel: 1,
    targetLevel: 2,
    production: [
      { level: 0, perTickMilli: 500, perMinute: 30 },
      { level: 1, perTickMilli: 1000, perMinute: 60 },
      { level: 2, perTickMilli: 2000, perMinute: 120 },
    ],
    tick: 100,
    endTick: 210,
    buildTicks: 10,
  };
}
test("only incremental output repays the sum of all resource costs; equality is allowed", () => {
  const i = input();
  let p = productionPayback(i);
  assert.equal(p.totalCost, 100);
  assert.equal(p.extraPerTickMilli, 1000);
  assert.equal(p.repaymentTicks, 100);
  assert.equal(p.repaymentTick, 210);
  assert.equal(p.repays, true);
  i.endTick = 209;
  p = productionPayback(i);
  assert.equal(p.repays, false);
  assert.equal(p.extraByEnd, 99);
  i.endTick = 211;
  assert.equal(productionPayback(i).repays, true);
});
test("resource waits and Council cooldown precede construction and earning", () => {
  const i = input();
  i.stockMilli.timber = 0;
  i.endTick = 250;
  assert.equal(productionPayback(i).repaymentTick, 250);
  i.nextActTick = 141;
  assert.equal(productionPayback(i).repaymentTick, 251);
  assert.equal(productionPayback(i).repays, false);
  i.nextActTick = null;
  i.affordableAtTick = 142;
  assert.equal(productionPayback(i).completionTick, 152);
});
test("live multipliers and integer milli-output are used instead of total current income", () => {
  const i = input();
  i.ratesMilli.timber = 1500;
  const p = productionPayback(i);
  assert.equal(p.extraPerTickMilli, 1500);
  assert.equal(p.repaymentTicks, 67);
  i.production[2].perTickMilli = 1333;
  i.ratesMilli.timber = 1000;
  assert.equal(productionPayback(i).repaymentTicks, 301);
});
test("zero growth, missing tables and an unfundable cost are ineligible", () => {
  const i = input();
  i.production[2].perTickMilli = 1000;
  assert.equal(productionPayback(i).repays, false);
  i.production[2].perTickMilli = 2000;
  i.stockMilli.iron = 0;
  i.ratesMilli.iron = 0;
  assert.equal(productionPayback(i).repays, false);
  i.targetLevel = 99;
  assert.equal(productionPayback(i).repays, false);
});
test("unprofitable producer proposals do not reserve resources or prevent other advisors spending", () => {
  const c = context();
  c.state.world.endsAtTick = c.state.world.tick + 100;
  const producers = evaluateEconomy(c).filter((p) =>
    ["lumberyard", "quarry", "mine"].includes(p.action.building),
  );
  assert.equal(producers.length, 3);
  assert.ok(
    producers.every(
      (p) =>
        p.status === "not-needed" &&
        p.blockers.includes("NO_PAYBACK_BEFORE_ROUND_END"),
    ),
  );
  const selection = selectProposal(producers);
  assert.equal(selection.selected, null);
  assert.equal(selection.reservations.length, 0);
});
test("accepted work is preserved and resource payback is refreshed after queued construction", () => {
  const c = context(),
    v = c.state.villages[0];
  c.state.world.endsAtTick = 150;
  v.buildQueue = [
    {
      id: "q",
      building: "lumberyard",
      level: 2,
      startTick: 100,
      endTick: 120,
      cost: { timber: 1, stone: 1, iron: 1 },
    },
  ];
  assert.equal(
    evaluateEconomy(c).find((p) => p.action.building === "lumberyard")!.status,
    "queued",
  );
  assert.ok(
    !evaluateEconomy(c)
      .find((p) => p.action.building === "quarry")!
      .blockers.includes("NO_PAYBACK_BEFORE_ROUND_END"),
  );
  v.buildQueue = [];
  assert.ok(
    evaluateEconomy(c)
      .find((p) => p.action.building === "quarry")!
      .blockers.includes("NO_PAYBACK_BEFORE_ROUND_END"),
  );
});
