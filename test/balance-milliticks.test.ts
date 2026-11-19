import assert from "node:assert/strict";
import { test } from "node:test";
import { defenseBudget } from "../src/advisors/defense-budget.js";
import { minuteTrainingProposal } from "../src/advisors/military-training.js";
import { BUILDINGS, UNITS, UNIT_IDS } from "../src/rules/config.js";
import { buildTicks, productionPerMinute, trainTicks } from "../src/rules/tables.js";
import { developedContext } from "./control-fixtures.js";

function fixture() {
  const context = developedContext();
  const village = context.state.villages[0];
  village.options.train = [{ unit: "pikeman", cost: UNITS.pikeman.cost, ticksEach: 0.906,
    pop: 1, maxCount: 1000, ok: true, blockers: [], affordableAtTick: null }];
  village.population = { used: 0, max: 1000 };
  village.storage = 100000;
  village.resourcesMilli = { timber: 100000000, stone: 100000000, iron: 100000000 };
  return { context, village };
}

test("balance snapshot uses milli-ticks while construction remains whole ticks", () => {
  assert.equal(productionPerMinute(0), 14);
  assert.equal(productionPerMinute(1), 80);
  assert.equal(BUILDINGS.hall.baseTime, 10);
  assert.equal(buildTicks("hall", 2, 1), 11);
  assert.equal(trainTicks("pikeman", 25), 0.906);
  for (const unit of UNIT_IDS) for (let level = 0; level <= BUILDINGS[UNITS[unit].building].maxLevel; level++) {
    assert.equal(trainTicks(unit, level), Math.max(1, Math.round(UNITS[unit].trainTime * 1000 * 0.94 ** (Math.max(1, level) - 1))) / 1000);
  }
});

test("fractional per-unit time funds integer minute batches and exact resource burn", () => {
  const { context, village } = fixture();
  const budget = defenseBudget(village)!;
  assert.equal(budget.ticks, 0.906);
  assert.equal(budget.perTick.timber, 45 / 0.906);
  const proposal = minuteTrainingProposal(context, village, "pikeman", 100, "early.pikemen", 80, "test", "milli");
  assert.ok(proposal);
  assert.equal(proposal.action.count, 68);
  assert.equal(proposal.requirements.timber, 68 * 45);
  assert.ok(proposal.reason.includes("61.608 ticks"));
});

test("training timing guards retain empty and malformed option handling", () => {
  const { context, village } = fixture();
  for (const ticksEach of [0, -1, NaN, Infinity]) {
    village.options.train[0].ticksEach = ticksEach;
    assert.equal(defenseBudget(village), null);
    assert.equal(minuteTrainingProposal(context, village, "pikeman", 100, "early.pikemen", 80, "test", "bad"), null);
  }
  village.options.train = [];
  assert.equal(defenseBudget(village), null);
  assert.equal(minuteTrainingProposal(context, village, "pikeman", 100, "early.pikemen", 80, "test", "empty"), null);
});
