import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDefensiveSmithy } from "../src/advisors/smithy.js";
import { evaluateMilitary } from "../src/advisors/military.js";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { selectProposal } from "../src/advisors/president.js";
import { developedContext as context } from "./control-fixtures.js";

function ready() {
  const c = context(), v = c.state.villages[0];
  v.buildings.hall = 5; v.buildings.barracks = 1;
  v.hidden = 1000; v.units.home.pikeman = 10;
  v.options.train = [{ unit: "shieldman", cost: { timber: 35, stone: 30, iron: 65 }, pop: 1,
    ticksEach: 11, maxCount: 0, ok: false, blockers: ["REQUIREMENTS_NOT_MET"], affordableAtTick: null }];
  return c;
}
test("Smithy 1 shares the President with live costs and yields to capacity/protection", () => {
  const c = ready(), v = c.state.villages[0];
  const option = v.options.build.find(o => o.building === "smithy")!;
  option.cost.iron = 251;
  const [p] = evaluateMilitary(c);
  assert.equal(p.status, "ready"); assert.equal(p.importance, 77);
  assert.deepEqual(p.requirements, option.cost);
  assert.equal(selectProposal([...evaluateEconomy(c), p]).selected?.action.building, "smithy");
  v.hidden = 0;
  assert.equal(selectProposal([...evaluateEconomy(c), p]).selected?.action.building, "cellar");
  v.population.used = v.population.max;
  assert.equal(selectProposal([...evaluateEconomy(c), ...evaluateMilitary(c)]).selected?.action.building, "farm");
});
test("Smithy requires ten owned Pikemen, counts away troops and never buys additional levels", () => {
  const c = ready(), v = c.state.villages[0];
  v.units.home.pikeman = 9;
  assert.deepEqual(evaluateDefensiveSmithy(c), []);
  v.units.away.pikeman = 1;
  assert.equal(evaluateDefensiveSmithy(c)[0].status, "ready");
  v.buildings.smithy = 1;
  assert.deepEqual(evaluateDefensiveSmithy(c), []);
  v.buildings.smithy = 0;
  v.buildQueue = [{ id: "q", building: "smithy", level: 1, startTick: 100, endTick: 140, cost: { timber: 220, stone: 180, iron: 240 } }];
  assert.deepEqual(evaluateDefensiveSmithy(c), []);
});
test("unmet prerequisites, insufficient full-path funding and hard blockers never reserve", () => {
  for (const change of [
    (c: ReturnType<typeof ready>) => { c.state.villages[0].buildings.hall = 4; },
    (c: ReturnType<typeof ready>) => { c.state.villages[0].buildings.barracks = 0; },
    (c: ReturnType<typeof ready>) => { c.state.villages[0].resourcesMilli.iron = 564999; },
    (c: ReturnType<typeof ready>) => { const v = c.state.villages[0]; v.population.used = v.population.max - 50 - v.options.build.find(o => o.building === "smithy")!.pop - 4; },
    (c: ReturnType<typeof ready>) => { c.state.villages[0].storage = 200; },
    (c: ReturnType<typeof ready>) => { c.state.villages[0].options.build.find(o => o.building === "smithy")!.blockers = ["REQUIREMENTS_NOT_MET"]; },
    (c: ReturnType<typeof ready>) => { c.state.villages[0].options.train[0].blockers = ["INSUFFICIENT_POPULATION"]; },
  ]) {
    const c = ready(); change(c);
    const ps = evaluateDefensiveSmithy(c);
    assert.equal(ps[0].status, "not-needed");
    assert.deepEqual(selectProposal(ps).reservations, []);
    assert.notEqual(selectProposal([...evaluateEconomy(c), ...ps]).selected?.action.building, "smithy");
  }
});
test("full-path resource and population equality permit the remaining bounded complement", () => {
  const c = ready(), v = c.state.villages[0];
  const option = v.options.build.find(o => o.building === "smithy")!;
  v.population.used = v.population.max - 50 - option.pop - 5;
  for (const r of ["timber", "stone", "iron"] as const) v.resourcesMilli[r] = (option.cost[r] + 5 * v.options.train[0].cost[r]) * 1000;
  assert.equal(evaluateDefensiveSmithy(c)[0].status, "ready");
  v.units.home.shieldman = 2; v.units.away.shieldman = 2;
  v.resourcesMilli.iron = (option.cost.iron + 65) * 1000;
  assert.equal(evaluateDefensiveSmithy(c)[0].status, "ready");
  v.units.away.shieldman = 3;
  assert.deepEqual(evaluateDefensiveSmithy(c), []);
});
test("Smithy reserves a useful horizon including cooldown, construction and the full training batch", () => {
  const c = ready(), option = c.state.villages[0].options.build.find(o => o.building === "smithy")!;
  option.ticks = 40; c.state.world.endsAtTick = 440;
  assert.equal(evaluateDefensiveSmithy(c)[0].status, "ready");
  c.state.world.endsAtTick = 439;
  assert.equal(evaluateDefensiveSmithy(c)[0].status, "not-needed");
  c.state.world.endsAtTick = 440; c.state.player.nextActTick = 101;
  assert.equal(evaluateDefensiveSmithy(c)[0].status, "not-needed");
  c.state.player.nextActTick = null; c.state.world.actIntervalTicks = 400;
  c.state.world.endsAtTick = 655; // 100 + 40 + 400 + 55 + 60
  assert.equal(evaluateDefensiveSmithy(c)[0].status, "ready");
  c.state.world.endsAtTick--;
  assert.equal(evaluateDefensiveSmithy(c)[0].status, "not-needed");
});
test("external orders, busy queues, pause and cooldown prevent Smithy submission", () => {
  const c = ready(), v = c.state.villages[0];
  v.orders.train = [{ unit: "pikeman", keep: 10 }];
  assert.equal(selectProposal(evaluateDefensiveSmithy(c)).selected, null);
  v.orders.train = []; v.orders.build = [{ building: "hall", toLevel: 6 }];
  assert.equal(selectProposal(evaluateDefensiveSmithy(c)).selected, null);
  v.orders.build = []; v.training.barracks = [{ id: "q", unit: "pikeman", count: 1, remaining: 1,
    costEach: { timber: 45, stone: 35, iron: 15 }, nextTick: 108, endTick: 108 }];
  assert.equal(selectProposal(evaluateDefensiveSmithy(c)).selected, null);
  v.training.barracks = []; c.state.world.status = "paused";
  assert.equal(selectProposal(evaluateDefensiveSmithy(c)).selected, null);
  c.state.world.status = "running"; c.state.player.nextActTick = 101;
  assert.equal(selectProposal(evaluateDefensiveSmithy(c)).selected, null);
  c.state.player.nextActTick = null;
  v.buildQueue = [{ id: "h", building: "hall", level: 6, startTick: 100, endTick: 140, cost: { timber: 1, stone: 1, iron: 1 } }];
  assert.equal(selectProposal(evaluateDefensiveSmithy(c)).selected, null);
  c.rules.version++;
  assert.throws(() => evaluateDefensiveSmithy(c), /rules version/);
});
