import {test} from "node:test";
import assert from "node:assert/strict";
import {developedContext} from "./control-fixtures.js";
import {evaluateSustainedDefense} from "../src/advisors/sustained-defense.js";
import {militaryAdvisor} from "../src/advisors/military.js";

function ready() {
  const context = developedContext();
  const village = context.state.villages[0]!;
  Object.assign(village.buildings, {lumberyard: 14, quarry: 14, mine: 12, barracks: 1, smithy: 0});
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

test("after Barracks 1 and the 14/14/12 producer gate, a zero-Pikeman capital starts toward 250", () => {
  const context = ready();
  const proposal = evaluateSustainedDefense(context).find(value =>
    value.action.type === "train",
  );
  assert.equal(proposal?.task, "early.pikemen");
  assert.equal(proposal?.importance, 75);
  assert.equal(proposal?.targetLevel, 250);
  assert.equal(proposal?.action.type, "train");
  if (proposal?.action.type === "train") assert.equal(proposal.action.unit, "pikeman");
  assert.ok(militaryAdvisor.evaluate(context).every(value =>
    value.action.type !== "train" || !["shieldman", "lancer"].includes(value.action.unit),
  ));
});

test("Pikeman training waits for the exact early producer gate", () => {
  const context = ready();
  const capital = context.state.villages[0]!;
  Object.assign(capital.buildings, {lumberyard: 13, quarry: 14, mine: 12});
  assert.equal(evaluateSustainedDefense(context).some(value =>
    value.task === "early.pikemen",
  ), false);

  Object.assign(capital.buildings, {lumberyard: 14, quarry: 14, mine: 12});
  const proposal = evaluateSustainedDefense(context).find(value =>
    value.task === "early.pikemen",
  );
  assert.equal(proposal?.targetLevel, 250);
});
