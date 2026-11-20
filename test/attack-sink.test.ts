import {test} from "node:test";
import assert from "node:assert/strict";
import {developedContext} from "./control-fixtures.js";
import type {AdvisorContext} from "../src/advisors/types.js";
import {evaluateAttackSink} from "../src/advisors/attack-sink.js";

function lateGame(buildings: Record<string, number>, each = 30000) {
  const context: AdvisorContext = developedContext();
  const village = context.state.villages[0]!;
  Object.assign(village.buildings, {hall: 15, barracks: 5, smithy: 10, stable: 10, workshop: 10, lumberyard: 20, quarry: 20, mine: 20}, buildings);
  village.resourcesMilli = {timber: each * 1000, stone: each * 1000, iron: each * 1000};
  village.storage = 40000;
  village.population = {max: 5000, used: 1000};
  village.buildQueue = [];
  village.orders.build = [];
  village.training.stable = [];
  village.training.workshop = [];
  village.options.train = [
    {unit: "lancer", cost: {timber: 120, stone: 110, iron: 240}, pop: 4, ticksEach: 20, maxCount: 100, ok: true, blockers: [], affordableAtTick: null},
    {unit: "ram", cost: {timber: 280, stone: 220, iron: 190}, pop: 5, ticksEach: 30, maxCount: 100, ok: true, blockers: [], affordableAtTick: null},
  ];
  const template = village.options.build[0]!;
  village.options.build = (["hall", "stable", "workshop"] as const).map(building => ({
    ...template, building, level: village.buildings[building] + 1, cost: {timber: 100, stone: 100, iron: 100}, ok: true, blockers: [],
  }));
  context.state.villages.push({...structuredClone(village), id: "second"});
  context.cityRoles = new Map([[village.id, {role: "capital", reason: "fixture"}]]);
  return context;
}

const builds = (context: AdvisorContext) => evaluateAttackSink(context).filter(value => value.action.type === "build").map(value => `${value.task}:${value.buildingName === undefined ? "" : (value.action as {building: string}).building}`);

test("attack sink waits for producers 20", () => {
  assert.deepEqual(evaluateAttackSink(lateGame({mine: 19})), []);
});

test("attack sink orders Hall 15, Stable 10, then Workshop 10", () => {
  assert.deepEqual(builds(lateGame({hall: 12, stable: 3, workshop: 0})), ["economy.hall-push:hall"]);
  assert.deepEqual(builds(lateGame({stable: 5, workshop: 0})), ["military.attack-stable:stable"]);
  assert.deepEqual(builds(lateGame({workshop: 4})), ["military.attack-workshop:workshop"]);
  assert.deepEqual(builds(lateGame({})), []);
});

test("Lancers train above 10k of each resource and Rams above 20k, Lancers first", () => {
  const sink = evaluateAttackSink(lateGame({}, 30000));
  const lancers = sink.find(value => value.task === "military.lancers");
  const rams = sink.find(value => value.task === "military.rams");
  assert.ok(lancers && lancers.importance > (rams?.importance ?? 0));
  for (const r of ["timber", "stone", "iron"] as const)
    assert.ok(30000 - lancers.requirements[r] - (rams?.requirements[r] ?? 0) >= 20000);
  assert.ok(sink.every(value => value.importance < 70));
  const middle = evaluateAttackSink(lateGame({}, 15000)).filter(value => value.action.type === "train").map(value => value.task);
  assert.deepEqual(middle, ["military.lancers"]);
  assert.deepEqual(evaluateAttackSink(lateGame({}, 9000)).filter(value => value.action.type === "train"), []);
});

test("attack sink cannot build Stable before the second village", () => {
  for (const buildings of [{stable: 0}, {stable: 10}]) {
    const context = lateGame(buildings);
    context.state.villages.splice(1);
    context.state.villages[0]!.training.stable.push({endTick: 200} as any);
    assert.ok(!evaluateAttackSink(context).some(value => value.action.type === "build" && value.action.building === "stable"));
  }
});
