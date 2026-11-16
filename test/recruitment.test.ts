import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateRecruitment } from "../scripts/legacy-advisors/recruitment.js";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { selectProposal } from "../src/advisors/president.js";
import { developedContext as context } from "./control-fixtures.js";
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
function shieldsReady() {
  const c = ready(), v = c.state.villages[0];
  v.units.home.pikeman = 10; v.buildings.smithy = 1;
  v.options.train.push({unit:"shieldman", cost:{timber:35,stone:30,iron:65}, pop:1,ticksEach:11,maxCount:20,ok:true,blockers:[],affordableAtTick:null});
  return c;
}
test("unlocked Shieldmen complement rather than replace ten Pikemen through the President", () => {
  const c = shieldsReady(), v = c.state.villages[0];
  const [p] = evaluateRecruitment(c);
  assert.deepEqual(p.action, {type:"train",village:v.id,unit:"shieldman",count:5});
  assert.equal(p.currentLevel,0); assert.equal(p.targetLevel,5);
  assert.deepEqual(p.requirements,{timber:175,stone:150,iron:325});
  assert.equal(selectProposal([...evaluateEconomy(c),p]).selected?.action.type,"train");
  v.units.home.pikeman = 9;
  assert.equal(evaluateRecruitment(c).some(p=>p.action.unit === "shieldman"), false);
  v.units.away.pikeman = 1;
  assert.equal(evaluateRecruitment(c)[0].action.unit,"shieldman");
});
test("Shieldman cap counts away and queued troops without buying or reserving prerequisites", () => {
  const c = shieldsReady(), v = c.state.villages[0];
  v.units.home.shieldman=2;v.units.away.shieldman=2;
  assert.equal(evaluateRecruitment(c)[0].action.count,1);
  v.units.away.shieldman=3;assert.deepEqual(evaluateRecruitment(c),[]);
  v.units.away.shieldman=0;
  v.training.barracks=[{id:"s",unit:"shieldman",count:3,remaining:3,costEach:{timber:35,stone:30,iron:65},nextTick:111,endTick:133}];
  assert.deepEqual(evaluateRecruitment(c),[]);
  v.training.barracks=[];v.buildings.smithy=0;
  assert.equal(evaluateRecruitment(c)[0].status,"not-needed");
  assert.deepEqual(selectProposal(evaluateRecruitment(c)).reservations,[]);
});
test("Shieldmen retain live affordability, population, queue, priority and full-batch horizon guards", () => {
  const c=shieldsReady(),v=c.state.villages[0];
  c.state.world.endsAtTick=215;assert.equal(evaluateRecruitment(c)[0].status,"ready");
  c.state.world.endsAtTick=214;assert.equal(evaluateRecruitment(c)[0].status,"not-needed");
  c.state.world.endsAtTick=10800;v.resourcesMilli.iron=0;
  assert.equal(evaluateRecruitment(c)[0].status,"not-needed");
  assert.deepEqual(selectProposal(evaluateRecruitment(c)).reservations,[]);
  v.resourcesMilli.iron=1000000;v.population.used=149;
  assert.equal(evaluateRecruitment(c)[0].action.count,1);
  v.population.used=150;assert.equal(evaluateRecruitment(c)[0].status,"not-needed");
  v.population.used=40;v.hidden=0;
  assert.equal(selectProposal([...evaluateEconomy(c),...evaluateRecruitment(c)]).selected?.buildingName,"Cellar");
  v.hidden=1000;v.orders.train=[{unit:"shieldman",keep:5}];
  assert.equal(selectProposal(evaluateRecruitment(c)).selected,null);
});
