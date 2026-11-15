import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateRecruitment } from "../src/advisors/recruitment.js";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { selectProposal } from "../src/advisors/president.js";
import { context } from "./control-fixtures.js";
function ready() {
  const c = context(), v = c.state.villages[0];
  v.buildings.barracks = 1; v.hidden = 1000;
  v.options.train = [{unit:"pikeman", cost:{timber:45,stone:35,iron:15}, pop:1, ticksEach:8, maxCount:20, ok:true, blockers:[], affordableAtTick:null}];
  return c;
}
test("President recruits at most five using live costs and preserves capacity/protection priority", () => {
  const c = ready(), v = c.state.villages[0];
  v.options.train[0].cost.timber = 47;
  const [p] = evaluateRecruitment(c);
  assert.equal(p.action.count, 5); assert.deepEqual(p.requirements, {timber:235, stone:175, iron:75});
  assert.equal(selectProposal([...evaluateEconomy(c), p]).selected?.action.type, "train");
  v.hidden = 0;
  assert.equal(selectProposal([...evaluateEconomy(c), p]).selected?.buildingName, "Cellar");
  v.population.used = 200;
  assert.equal(selectProposal([...evaluateEconomy(c), ...evaluateRecruitment(c)]).selected?.buildingName, "Farm");
});
test("count respects owned/away/queued troops, population buffer and server maximum", () => {
  const c = ready(), v = c.state.villages[0];
  v.units.home.pikeman = 4; v.units.away.pikeman = 4;
  assert.equal(evaluateRecruitment(c)[0].action.count, 2);
  v.options.train[0].maxCount = 1;
  assert.equal(evaluateRecruitment(c)[0].action.count, 1);
  v.units.away.pikeman = 6;
  assert.deepEqual(evaluateRecruitment(c), []);
  v.units.away.pikeman = 0; v.population.used = 149;
  assert.equal(evaluateRecruitment(c)[0].action.count, 1);
  v.population.used = 150;
  assert.equal(evaluateRecruitment(c)[0].status, "not-needed");
});
test("unavailable troops and resource waits never reserve the economy", () => {
  for (const change of [
    (c: ReturnType<typeof ready>) => {c.state.villages[0].buildings.barracks = 0;},
    (c: ReturnType<typeof ready>) => {c.state.villages[0].options.train[0].blockers = ["REQUIREMENTS_NOT_MET"];},
    (c: ReturnType<typeof ready>) => {c.state.villages[0].options.train[0].maxCount = 0;},
    (c: ReturnType<typeof ready>) => {c.state.villages[0].resourcesMilli.timber = 0;},
  ]) {
    const c = ready(); change(c); const ps = evaluateRecruitment(c);
    assert.equal(ps[0].status, "not-needed"); assert.deepEqual(selectProposal(ps).reservations, []);
  }
});
test("busy training, external orders, world pause and Council cooldown prevent recruitment", () => {
  const c = ready(), v = c.state.villages[0];
  v.training.barracks = [{id:"q", unit:"pikeman", count:2, remaining:2,costEach:{timber:45,stone:35,iron:15},nextTick:108,endTick:116}];
  assert.equal(evaluateRecruitment(c)[0].status, "waiting");
  v.training.barracks = []; v.orders.train = [{unit:"pikeman",keep:10}];
  assert.equal(selectProposal(evaluateRecruitment(c)).selected, null);
  v.orders.train = []; c.state.world.status = "paused";
  assert.equal(selectProposal(evaluateRecruitment(c)).selected, null);
  c.state.world.status = "running"; c.state.player.nextActTick = 101;
  assert.equal(selectProposal(evaluateRecruitment(c)).selected, null);
});
test("whole batch must finish with sixty ticks for use; Council delay is included", () => {
  const c = ready(); c.state.world.endsAtTick = 200;
  assert.equal(evaluateRecruitment(c)[0].status, "ready");
  c.state.world.endsAtTick = 199;
  assert.equal(evaluateRecruitment(c)[0].status, "not-needed");
  c.state.world.endsAtTick = 200; c.state.player.nextActTick = 101;
  assert.equal(evaluateRecruitment(c)[0].status, "not-needed");
});
