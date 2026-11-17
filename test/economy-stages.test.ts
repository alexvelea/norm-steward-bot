import {test} from "node:test";
import assert from "node:assert/strict";
import {developedContext} from "./control-fixtures.js";
import {evaluateSustainedDefense} from "../src/advisors/sustained-defense.js";
import {militaryAdvisor} from "../src/advisors/military.js";

function ready() {
  const context = developedContext();
  const village = context.state.villages[0]!;
  Object.assign(village.buildings, {lumberyard: 12, quarry: 12, mine: 12, barracks: 3, smithy: 1});
  village.units.home = {};
  village.units.away = {};
  village.population = {max: 1000, used: 200};
  village.storage = 100000;
  village.resourcesMilli = {timber: 100000000, stone: 100000000, iron: 100000000};
  village.productionPerTickMilli = {timber: 100000, stone: 100000, iron: 100000};
  village.options.train = [{
    unit: "pikeman", cost: {timber: 45, stone: 35, iron: 15},
    pop: 1, ticksEach: 7, maxCount: 100, ok: true, blockers: [], affordableAtTick: null,
  }];
  return context;
}

test("after producers 12, a zero-Pikeman capital starts a bounded batch toward its 250 target", () => {
  const context = ready();
  const proposal = evaluateSustainedDefense(context).find(value =>
    value.action.type === "train",
  );
  assert.equal(proposal?.task, "military.pikemen-baseline");
  assert.equal(proposal?.importance, 75);
  assert.equal(proposal?.targetLevel, 250);
  assert.equal(proposal?.action.type, "train");
  if (proposal?.action.type === "train") assert.equal(proposal.action.unit, "pikeman");
  assert.ok(militaryAdvisor.evaluate(context).every(value =>
    value.action.type !== "train" || !["shieldman", "lancer"].includes(value.action.unit),
  ));
});

test("the capital's own Pikemen baseline waits for all producers to reach level 12", () => {
  const context = ready();
  const capital = context.state.villages[0]!;
  Object.assign(capital.buildings, {lumberyard: 11, quarry: 11, mine: 11});
  assert.equal(evaluateSustainedDefense(context).some(value =>
    value.task === "military.pikemen-baseline",
  ), false);

  Object.assign(capital.buildings, {lumberyard: 12, quarry: 12, mine: 12});
  const proposal = evaluateSustainedDefense(context).find(value =>
    value.task === "military.pikemen-baseline",
  );
  assert.equal(proposal?.targetLevel, 250);
});
