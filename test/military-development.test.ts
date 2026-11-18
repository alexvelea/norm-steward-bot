import {test} from "node:test";
import assert from "node:assert/strict";
import {developedContext} from "./control-fixtures.js";
import type {AdvisorContext} from "../src/advisors/types.js";
import {evaluateMilitaryDevelopment, evaluateWalls, evaluateBarracksGrowth} from "../src/advisors/military-development.js";
import {evaluateRaiders} from "../src/advisors/military.js";
import {evaluateEconomy} from "../src/advisors/economic.js";
import {selectProposal} from "../src/advisors/president.js";

function ready() {
  const context: AdvisorContext = developedContext();
  const village = context.state.villages[0]!;
  Object.assign(village.buildings, {
    hall: 10, barracks: 3, smithy: 1, stable: 0,
    lumberyard: 20, quarry: 20, mine: 20, wall: 9,
  });
  village.resourcesMilli = {timber: 10000000, stone: 10000000, iron: 10000000};
  village.storage = 20000;
  village.population = {max: 1000, used: 300};
  village.units.home = {pikeman: 300};
  village.units.away = {};
  village.options.train = [
    {unit: "pikeman", cost: {timber: 45, stone: 35, iron: 15}, pop: 1, ticksEach: 7, maxCount: 100, ok: true, blockers: [], affordableAtTick: null},
    {unit: "raider", cost: {timber: 75, stone: 55, iron: 40}, pop: 1, ticksEach: 8, maxCount: 100, ok: true, blockers: [], affordableAtTick: null},
  ];
  for (const option of village.options.build) {
    option.level = village.buildings[option.building] + 1;
    option.cost = {timber: 100, stone: 100, iron: 100};
    option.ok = true;
    option.blockers = [];
  }
  if (!village.options.build.some(option => option.building === "stable")) {
    village.options.build.push({
      ...village.options.build.find(option => option.building === "barracks")!,
      building: "stable",
      level: 1,
    });
  }
  context.cityRoles = new Map([[village.id, {role: "capital", reason: "fixture"}]]);
  return context;
}

test("Stable 1 is the final military-development step for Scouts", () => {
  const context = ready();
  const village = context.state.villages[0]!;
  Object.assign(village.buildings, {barracks: 5, smithy: 5});
  for (const option of village.options.build) option.level = village.buildings[option.building] + 1;
  const proposal = evaluateMilitaryDevelopment(context).find(value => value.task === "military.scouts");
  assert.equal(proposal?.action.type, "build");
  if (proposal?.action.type === "build") {
    assert.equal(proposal.action.building, "stable");
    assert.equal(proposal.targetLevel, 1);
    assert.equal(proposal.task, "military.scouts");
  }
});

test("capital Walls stop at level 10 and economic cities are excluded", () => {
  const context = ready();
  const capital = context.state.villages[0]!;
  const economic = structuredClone(capital);
  economic.id = "eco";
  economic.buildings.wall = 0;
  context.state.villages.push(economic);
  context.cityRoles = new Map([
    [capital.id, {role: "capital", reason: "fixture"}],
    [economic.id, {role: "economic", reason: "fixture"}],
  ]);
  const wallOption = capital.options.build.find(option => option.building === "wall")!;
  wallOption.level = 11;
  assert.deepEqual(evaluateWalls(context), []);

  wallOption.level = 10;
  assert.ok(evaluateWalls(context).every(proposal => proposal.villageId === capital.id));
});

test("the early Wall rush outranks Hall and Barracks builds after Barracks 1", () => {
  const context = ready();
  const village = context.state.villages[0]!;
  Object.assign(village.buildings, {lumberyard: 14, quarry: 14, mine: 12, barracks: 1, wall: 2, hall: 10, smithy: 0});
  for (const option of village.options.build) option.level = village.buildings[option.building] + 1;
  const proposals = [
    ...evaluateEconomy(context),
    ...evaluateMilitaryDevelopment(context),
    ...evaluateBarracksGrowth(context),
    ...evaluateWalls(context),
  ];
  const wall = proposals.find(proposal => proposal.action.type === "build" && proposal.action.building === "wall");
  assert.equal(wall?.importance, 88);
  assert.equal(wall?.targetLevel, 3);
  assert.equal(selectProposal(proposals).selected?.id, wall?.id);
  assert.ok(proposals.filter(proposal => proposal.action.type === "build" && ["barracks", "hall"].includes(proposal.action.building))
    .every(proposal => proposal.importance < (wall?.importance ?? 0)));
});

test("Hall 10 rush waits on resources at importance 90 and blocks other military development", () => {
  const context = ready();
  const village = context.state.villages[0]!;
  Object.assign(village.buildings, {lumberyard: 14, quarry: 14, mine: 12, barracks: 1, wall: 5, hall: 6, smithy: 0});
  for (const option of village.options.build) option.level = village.buildings[option.building] + 1;
  village.resourcesMilli = {timber: 0, stone: 0, iron: 0};
  const hall = evaluateWalls(context).find(proposal => proposal.action.type === "build" && proposal.action.building === "hall");
  assert.equal(hall?.importance, 90);
  assert.equal(hall?.status, "waiting");
  assert.deepEqual(hall?.blockers, ["INSUFFICIENT_RESOURCES"]);
  assert.deepEqual(evaluateBarracksGrowth(context), []);
  assert.deepEqual(evaluateMilitaryDevelopment(context), []);
});

test("Barracks growth stops at level 5", () => {
  const context = ready();
  const village = context.state.villages[0]!;
  village.buildings.barracks = 5;
  village.options.build.find(option => option.building === "barracks")!.level = 6;
  village.units.home = {};
  assert.deepEqual(evaluateBarracksGrowth(context), []);
});

test("Barracks grows at importance 92 with idle stock, 65 otherwise, when Pikeman and Raider training backlog exceeds 600 ticks", () => {
  const context = ready();
  const village = context.state.villages[0]!;
  village.buildings.barracks = 1;
  village.buildings.smithy = 2;
  village.units.home = {};
  village.options.build.find(option => option.building === "barracks")!.level = 2;
  const proposal = evaluateBarracksGrowth(context)[0];
  assert.equal(proposal?.task, "military.barracks-growth");
  assert.match(proposal?.reason ?? "", /over the 600-tick threshold/);
  village.resources = { timber: 1e6, stone: 1e6, iron: 1e6 };
  assert.equal(evaluateBarracksGrowth(context)[0]?.importance, 92);
  village.resources = { timber: 0, stone: 0, iron: 0 };
  assert.equal(evaluateBarracksGrowth(context)[0]?.importance, 65);
});

test("Raiders train toward 150 owned, counting home, away and queued troops", () => {
  const context = ready();
  const village = context.state.villages[0]!;
  village.buildings.barracks = 5;
  village.buildings.smithy = 2;
  village.units.home.raider = 100;
  village.units.away.raider = 15;
  village.training.barracks = [{
    id: "queued-raiders", unit: "raider", count: 5, remaining: 5,
    costEach: {timber: 75, stone: 55, iron: 40}, nextTick: 101, endTick: 141,
  }];
  const proposal = evaluateRaiders(context)[0];
  assert.equal(proposal?.task, "military.raiders");
  assert.equal(proposal?.currentLevel, 120);
  assert.equal(proposal?.targetLevel, 150);
  assert.equal(proposal?.importance, 72);
  assert.equal(proposal?.action.type, "train");
  if (proposal?.action.type === "train") assert.equal(proposal.action.count, 8);
});
