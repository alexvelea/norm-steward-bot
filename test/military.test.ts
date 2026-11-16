import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateMilitary } from "../src/advisors/military.js";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { selectProposal } from "../src/advisors/president.js";
import { developedContext as context } from "./control-fixtures.js";

function ready() {
  const c = context();
  c.state.villages[0].buildings.hall = 3;
  c.state.villages[0].hidden = 1000;
  return c;
}
test("first Barracks uses live costs and outranks discretionary economy through the President", () => {
  const c = ready(), v = c.state.villages[0];
  const o = v.options.build.find((o) => o.building === "barracks")!;
  o.cost = { timber: 201, stone: 172, iron: 93 };
  const [p] = evaluateMilitary(c);
  assert.equal(p.status, "ready");
  assert.equal(p.targetLevel, 1);
  assert.deepEqual(p.requirements, o.cost);
  assert.equal(selectProposal([...evaluateEconomy(c), p]).selected?.advisor, "military");
  v.population.used = v.population.max;
  assert.equal(selectProposal([...evaluateEconomy(c), ...evaluateMilitary(c)]).selected?.action.building, "farm");
});
test("protection and storage emergencies retain priority", () => {
  const c = ready(), v = c.state.villages[0];
  v.hidden = 0;
  assert.equal(selectProposal([...evaluateEconomy(c), ...evaluateMilitary(c)]).selected?.action.building, "cellar");
  v.storage = 1100;
  assert.equal(selectProposal([...evaluateEconomy(c), ...evaluateMilitary(c)]).selected?.action.building, "storehouse");
});
test("locked prerequisites, capacity and hard server blockers never reserve the economy", () => {
  for (const change of [
    (c: ReturnType<typeof ready>) => { c.state.villages[0].buildings.hall = 2; },
    (c: ReturnType<typeof ready>) => { c.state.villages[0].storage = 100; },
    (c: ReturnType<typeof ready>) => { c.state.villages[0].population.used = 199; },
    (c: ReturnType<typeof ready>) => { const o = c.state.villages[0].options.build.find((o) => o.building === "barracks")!; o.ok = false; o.blockers = ["REQUIREMENTS_NOT_MET"]; },
  ]) {
    const c = ready(); change(c);
    const [p] = evaluateMilitary(c);
    assert.equal(p.status, "not-needed");
    assert.equal(selectProposal([p]).reservations.length, 0);
    assert.notEqual(selectProposal([...evaluateEconomy(c), p]).selected?.advisor, "military");
  }
});
test("only a feasible resource wait reserves for the bounded first level", () => {
  const c = ready(), v = c.state.villages[0];
  const o = v.options.build.find((o) => o.building === "barracks")!;
  v.resources.timber = 0; v.resourcesMilli.timber = 0;
  o.ok = false; o.blockers = ["INSUFFICIENT_RESOURCES"]; o.affordableAtTick = 250;
  assert.equal(evaluateMilitary(c)[0].status, "waiting");
  assert.equal(selectProposal([...evaluateEconomy(c), ...evaluateMilitary(c)]).reservations[0]?.proposalId, evaluateMilitary(c)[0].id);
  o.affordableAtTick = null;
  assert.equal(evaluateMilitary(c)[0].status, "not-needed");
});
test("round window includes resource waits, Council cooldown and a 300-tick use horizon", () => {
  const c = ready(), o = c.state.villages[0].options.build.find((o) => o.building === "barracks")!;
  o.ticks = 20;
  c.state.world.endsAtTick = 420;
  assert.equal(evaluateMilitary(c)[0].status, "ready");
  c.state.world.endsAtTick = 419;
  assert.equal(evaluateMilitary(c)[0].status, "not-needed");
  c.state.world.endsAtTick = 430;
  c.state.player.nextActTick = 111;
  assert.equal(evaluateMilitary(c)[0].status, "not-needed");
  c.state.player.nextActTick = null;
  o.affordableAtTick = 111;
  assert.equal(evaluateMilitary(c)[0].status, "not-needed");
});
test("existing or queued military infrastructure suppresses duplicates and upgrades", () => {
  const c = ready(), v = c.state.villages[0];
  v.buildings.barracks = 1;
  assert.deepEqual(evaluateMilitary(c), []);
  v.buildings.barracks = 0; v.buildings.stable = 1;
  assert.deepEqual(evaluateMilitary(c), []);
  v.buildings.stable = 0;
  v.buildQueue = [{ id: "q", building: "barracks", level: 1, startTick: 100, endTick: 120, cost: {timber: 200, stone: 170, iron: 90} }];
  assert.deepEqual(evaluateMilitary(c), []);
});
test("busy queues, external orders, paused worlds and cooldown prevent writes", () => {
  const c = ready(), v = c.state.villages[0];
  v.orders.build = [{building: "hall", toLevel: 4}];
  assert.equal(selectProposal(evaluateMilitary(c)).selected, null);
  v.orders.build = [];
  c.state.world.status = "paused";
  assert.equal(selectProposal(evaluateMilitary(c)).selected, null);
  c.state.world.status = "running"; c.state.player.nextActTick = 101;
  assert.equal(selectProposal(evaluateMilitary(c)).selected, null);
  c.state.player.nextActTick = null;
  v.buildQueue = [{ id: "q", building: "hall", level: 4, startTick: 100, endTick: 120, cost: {timber: 1, stone: 1, iron: 1} }];
  assert.equal(selectProposal(evaluateMilitary(c)).selected, null);
});
test("mismatched rules fail closed", () => {
  const c = ready(); c.rules.version += 1;
  assert.throws(() => evaluateMilitary(c), /rules version/);
});
