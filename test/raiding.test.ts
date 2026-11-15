import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateRaidingSmithy } from "../src/advisors/raiding.js";
import { evaluateMilitary } from "../src/advisors/military.js";
import { evaluateRecruitment } from "../src/advisors/recruitment.js";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { selectProposal } from "../src/advisors/president.js";
import { context } from "./control-fixtures.js";

function ready() {
  const c = context(), v = c.state.villages[0];
  v.buildings.hall = 5; v.buildings.barracks = 1; v.buildings.smithy = 1;
  v.units.home = { pikeman: 10, shieldman: 5 }; v.hidden = 1000;
  const o = v.options.build.find(o => o.building === "smithy")!;
  o.level = 2; o.cost = { timber: 275, stone: 225, iron: 300 }; o.pop = 24; o.ticks = 40;
  v.options.train = [{ unit: "raider", cost: { timber: 55, stone: 35, iron: 45 },
    pop: 1, ticksEach: 10, maxCount: 0, ok: false, blockers: ["REQUIREMENTS_NOT_MET"], affordableAtTick: null }];
  return c;
}
test("fully funded Smithy 2 reaches President; capacity and protection retain priority", () => {
  const c = ready(), v = c.state.villages[0], [p] = evaluateRaidingSmithy(c);
  assert.equal(p.status, "ready"); assert.equal(p.targetLevel, 2); assert.equal(p.currentLevel, 1);
  assert.equal(selectProposal([...evaluateEconomy(c), ...evaluateMilitary(c)]).selected?.id, p.id);
  v.hidden = 0;
  assert.equal(selectProposal([...evaluateEconomy(c), ...evaluateMilitary(c)]).selected?.action.building, "cellar");
});
test("raiding unlock requires owned defence and buys neither earlier nor later Smithy levels", () => {
  const c = ready(), v = c.state.villages[0];
  v.units.home.pikeman = 9; assert.deepEqual(evaluateRaidingSmithy(c), []);
  v.units.away.pikeman = 1; v.units.home.shieldman = 4; assert.deepEqual(evaluateRaidingSmithy(c), []);
  v.units.away.shieldman = 1; assert.equal(evaluateRaidingSmithy(c)[0].status, "ready");
  v.buildings.smithy = 0; assert.deepEqual(evaluateRaidingSmithy(c), []);
  v.buildings.smithy = 2; assert.deepEqual(evaluateRaidingSmithy(c), []);
});
test("unfunded force, storage, population and unavailable recruit do not reserve economy", () => {
  for (const change of [
    (c: ReturnType<typeof ready>) => { c.state.villages[0].resourcesMilli.timber = 824999; },
    (c: ReturnType<typeof ready>) => { c.state.villages[0].population.used = 117; },
    (c: ReturnType<typeof ready>) => { c.state.villages[0].storage = 549; },
    (c: ReturnType<typeof ready>) => { c.state.villages[0].options.train[0].blockers = ["INSUFFICIENT_POPULATION"]; },
    (c: ReturnType<typeof ready>) => { c.state.villages[0].buildings.hall = 4; },
  ]) {
    const c = ready(); change(c); const ps = evaluateRaidingSmithy(c);
    assert.equal(ps[0].status, "not-needed"); assert.deepEqual(selectProposal(ps).reservations, []);
  }
  const c = ready(), v = c.state.villages[0];
  v.population.used = 116; v.resourcesMilli = { timber: 825000, stone: 575000, iron: 750000 };
  assert.equal(evaluateRaidingSmithy(c)[0].status, "ready");
});
test("unlock funds only missing Raiders, counting home, away and queued toward ten", () => {
  const c = ready(), v = c.state.villages[0];
  v.units.home.raider = 4; v.units.away.raider = 5;
  v.resourcesMilli = { timber: 330000, stone: 260000, iron: 345000 };
  assert.equal(evaluateRaidingSmithy(c)[0].status, "ready");
  v.units.away.raider = 6; assert.deepEqual(evaluateRaidingSmithy(c), []);
});
test("unlock deadline includes whole force, multiple Council intervals and use horizon", () => {
  const c = ready(); c.state.world.endsAtTick = 740;
  assert.equal(evaluateRaidingSmithy(c)[0].status, "ready");
  c.state.world.endsAtTick--; assert.equal(evaluateRaidingSmithy(c)[0].status, "not-needed");
  c.state.world.actIntervalTicks = 200; c.state.world.endsAtTick = 1140;
  assert.equal(evaluateRaidingSmithy(c)[0].status, "ready");
  c.state.world.endsAtTick--; assert.equal(evaluateRaidingSmithy(c)[0].status, "not-needed");
});
test("queues, standing orders, pause and cooldown defer the unlock", () => {
  const c = ready(), v = c.state.villages[0];
  v.orders.train = [{ unit: "raider", keep: 10 }];
  assert.equal(selectProposal(evaluateRaidingSmithy(c)).selected, null);
  v.orders.train = []; c.state.world.status = "paused";
  assert.equal(selectProposal(evaluateRaidingSmithy(c)).selected, null);
  c.state.world.status = "running"; c.state.player.nextActTick = 101;
  assert.equal(selectProposal(evaluateRaidingSmithy(c)).selected, null);
  c.state.player.nextActTick = null; c.rules.version++;
  assert.throws(() => evaluateRaidingSmithy(c), /rules version/);
});
test("Raiders require completed defence and existing unlock; batch and owned cap remain bounded", () => {
  const c = ready(), v = c.state.villages[0];
  assert.equal(evaluateRecruitment(c)[0].status, "not-needed");
  v.buildings.smithy = 2; Object.assign(v.options.train[0], { ok: true, blockers: [], maxCount: 20 });
  const [p] = evaluateRecruitment(c);
  assert.equal(p.action.unit, "raider"); assert.equal(p.action.count, 5); assert.equal(p.importance, 76);
  assert.deepEqual(p.requirements, { timber: 275, stone: 175, iron: 225 });
  v.units.home.raider = 4; v.units.away.raider = 5;
  assert.equal(evaluateRecruitment(c)[0].action.count, 1);
  v.training.barracks = [{ id: "r", unit: "raider", count: 1, remaining: 1, costEach: v.options.train[0].cost, nextTick: 110, endTick: 110 }];
  assert.deepEqual(evaluateRecruitment(c), []);
  v.training.barracks = []; v.units.home.pikeman = 9;
  assert.equal(evaluateRecruitment(c).some(p => p.action.unit === "raider"), false);
});
test("Raider training funds and fits the complete remaining force before starting a partial batch", () => {
  const c = ready(), v = c.state.villages[0];
  v.buildings.smithy = 2; Object.assign(v.options.train[0], { ok: true, blockers: [], maxCount: 20 });
  c.state.world.endsAtTick = 500; assert.equal(evaluateRecruitment(c)[0].status, "ready");
  c.state.world.endsAtTick--; assert.equal(evaluateRecruitment(c)[0].status, "not-needed");
  c.state.world.endsAtTick = 600; c.state.world.actIntervalTicks = 100;
  assert.equal(evaluateRecruitment(c)[0].status, "ready");
  c.state.world.endsAtTick--; assert.equal(evaluateRecruitment(c)[0].status, "not-needed");
  c.state.world.endsAtTick = 10800; v.population.used = 149;
  assert.equal(evaluateRecruitment(c)[0].status, "not-needed");
  v.units.away.raider = 9;
  assert.equal(evaluateRecruitment(c)[0].action.count, 1);
  assert.equal(evaluateRecruitment(c)[0].status, "ready");
  v.population.used = 150; assert.equal(evaluateRecruitment(c)[0].status, "not-needed");
  v.population.used = 30; v.units.away.raider = 0; v.resourcesMilli.iron = 449999;
  assert.equal(evaluateRecruitment(c)[0].status, "not-needed");
  assert.deepEqual(selectProposal(evaluateRecruitment(c)).reservations, []);
});
