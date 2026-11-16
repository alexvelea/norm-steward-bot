import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateScouting } from "../src/advisors/scouting.js";
import { militaryAdvisor } from "../src/advisors/military.js";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { selectProposal } from "../src/advisors/president.js";
import { developedContext as context } from "./control-fixtures.js";
function ready() {
  const c = context(), v = c.state.villages[0];
  Object.assign(v.buildings, { hall: 10, barracks: 10, smithy: 5 });
  v.units.home = { pikeman: 10, shieldman: 5, raider: 10 }; v.hidden = 1000;
  const o = v.options.build.find(o => o.building === "stable")!;
  Object.assign(o, { level: 1, cost: { timber: 270, stone: 240, iron: 260 }, pop: 8, ticks: 49 });
  v.options.train = [{ unit: "scout", cost: { timber: 45, stone: 55, iron: 25 }, pop: 2,
    ticksEach: 7, maxCount: 0, ok: false, blockers: ["REQUIREMENTS_NOT_MET"], affordableAtTick: null }];
  return c;
}
test("fully funded Stable and Scouts share the President, behind urgent protection", () => {
  const c = ready(), [p] = evaluateScouting(c);
  assert.equal(p.status, "ready"); assert.equal(p.action.type, "build");
  assert.equal(selectProposal(militaryAdvisor.evaluate(c)).selected?.id, p.id);
  c.state.villages[0].hidden = 0;
  assert.equal(selectProposal([...evaluateEconomy(c), ...militaryAdvisor.evaluate(c)]).selected?.action.type, "build");
  assert.equal(selectProposal([...evaluateEconomy(c), ...militaryAdvisor.evaluate(c)]).selected?.buildingName, "Cellar");
});
test("scouting buys no prerequisite chain and requires completed usable raiders", () => {
  const c = ready(), v = c.state.villages[0];
  v.buildings.hall = 9; assert.equal(evaluateScouting(c)[0].status, "not-needed");
  v.buildings.hall = 10; v.units.home.raider = 9; assert.deepEqual(evaluateScouting(c), []);
  v.units.away.raider = 1; assert.equal(evaluateScouting(c)[0].status, "ready");
  v.units.home.pikeman = 9; assert.deepEqual(evaluateScouting(c), []);
});
test("scouting rejects unfunded path, insufficient population and hard training blockers without reserving", () => {
  for (const change of [
    (c: ReturnType<typeof ready>) => { c.state.villages[0].resourcesMilli.stone = 349999; },
    (c: ReturnType<typeof ready>) => { c.state.villages[0].population.used = 139; },
    (c: ReturnType<typeof ready>) => { c.state.villages[0].storage = 269; },
    (c: ReturnType<typeof ready>) => { c.state.villages[0].options.train[0].blockers = ["INSUFFICIENT_POPULATION"]; },
  ]) { const c = ready(); change(c); const ps = evaluateScouting(c); assert.equal(ps[0].status, "not-needed"); assert.deepEqual(selectProposal(ps).reservations, []); }
});
test("scouting deadline includes construction, cooldown, full training and use; equality allowed", () => {
  const c = ready(); c.state.world.endsAtTick = 763;
  assert.equal(evaluateScouting(c)[0].status, "ready"); c.state.world.endsAtTick--;
  assert.equal(evaluateScouting(c)[0].status, "not-needed");
  c.state.world.actIntervalTicks = 200; c.state.player.nextActTick = 150; c.state.world.endsAtTick = 1013;
  assert.equal(evaluateScouting(c)[0].status, "waiting"); c.state.world.endsAtTick--;
  assert.equal(evaluateScouting(c)[0].status, "not-needed");
});
test("Scout recruitment counts home, away and queued and uses only an idle training path", () => {
  const c = ready(), v = c.state.villages[0]; v.buildings.stable = 1;
  Object.assign(v.options.train[0], { ok: true, blockers: [], maxCount: 20 });
  const [p] = evaluateScouting(c); assert.equal(p.action.type, "train");
  if (p.action.type === "train") assert.equal(p.action.count, 2);
  assert.equal(p.status, "ready"); v.units.away.scout = 1;
  const [one] = evaluateScouting(c); if (one.action.type === "train") assert.equal(one.action.count, 1);
  v.training.stable = [{ id: "s", unit: "scout", count: 1, remaining: 1, costEach: v.options.train[0].cost, nextTick: 107, endTick: 107 }];
  assert.deepEqual(evaluateScouting(c), []);
  v.training.stable = []; v.orders.train = [{ unit: "scout", keep: 2 }];
  assert.equal(evaluateScouting(c)[0].status, "waiting");
  v.orders.train = []; c.state.world.status = "paused";
  assert.equal(evaluateScouting(c)[0].status, "waiting");
  c.state.world.status = "running"; c.rules.version++;
  assert.throws(() => evaluateScouting(c), /rules version/);
});
test("Scout training requires the full missing complement funded and preserves the population buffer", () => {
  const c = ready(), v = c.state.villages[0]; v.buildings.stable = 2;
  Object.assign(v.options.train[0], { ok: true, blockers: [], maxCount: 20 });
  v.resourcesMilli = { timber: 90000, stone: 110000, iron: 50000 }; v.population.used = 146;
  assert.equal(evaluateScouting(c)[0].status, "ready");
  v.resourcesMilli.iron--; assert.equal(evaluateScouting(c)[0].status, "not-needed");
  v.resourcesMilli.iron++; v.population.used++;
  assert.equal(evaluateScouting(c)[0].status, "not-needed");
  v.units.away.scout = 1; assert.equal(evaluateScouting(c)[0].status, "ready");
  v.training.barracks = [{ id: "p", unit: "pikeman", count: 1, remaining: 1, costEach: { timber: 45, stone: 35, iron: 15 }, nextTick: 107, endTick: 107 }];
  assert.equal(evaluateScouting(c)[0].status, "ready"); // Barracks work no longer blocks Stable training.
  v.training.stable = [{id:"horse",unit:"lancer",count:1,remaining:1,costEach:{timber:120,stone:110,iron:240},nextTick:110,endTick:110}];
  assert.equal(evaluateScouting(c)[0].status, "waiting");
});
