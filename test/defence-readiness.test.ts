import { test } from "node:test";
import assert from "node:assert/strict";
import { defenceReadiness } from "../src/review/defence-readiness.js";
import { context } from "./control-fixtures.js";
import type { ReportsResponse } from "../src/shared/api.js";

test("readiness preserves server blockers and separates queue delay from affordability", () => {
  const { state, rules } = context();
  const v = state.villages[0];
  v.buildQueue.push({ id: "q", building: "mine", level: 2, cost: { timber: 0, stone: 0, iron: 0 }, startTick: 90, endTick: 148 });
  const option = v.options.build.find(o => o.building === "barracks")!;
  option.ok = false;
  option.blockers = ["REQUIREMENTS_NOT_MET"];
  const before = JSON.stringify({ state, rules });
  const result = defenceReadiness(state, rules, { reports: [], next: null });
  const village = result.villages[0];
  assert.equal(village.queueDrainTicks, 48);
  assert.equal(village.retainedDefensiveLosses, 0);
  assert.deepEqual(village.militaryBuildings[0].missingPrerequisites, [{ building: "hall", required: 3, current: 1 }]);
  assert.equal(village.militaryBuildings[0].nextOption?.ok, false);
  assert.equal(JSON.stringify({ state, rules }), before);
});

test("retained losses exclude scouting and other villages; pagination stays visible", () => {
  const { state, rules } = context();
  const ref = { id: "v1", name: "Test", x: 1, y: 1, ownerId: "p1", ownerName: "Tester" };
  const attack = { id: "incoming", seq: 1, kind: "attack", from: ref, to: ref, sentTick: 90, arrivalTick: 175, sighted: null, units: null } as const;
  state.commands.incoming.push(attack, { ...attack, kind: "support", units: { pikeman: 10 } }, { ...attack, to: { ...ref, id: "another" } });
  const report = { id: "r", tick: 99, kind: "battle", role: "defender", commandId: null, attacker: ref, defender: ref, outcome: "lost", conquered: false, read: false } as const;
  const reports: ReportsResponse = { reports: [report, { ...report, kind: "scouting" }, { ...report, defender: { ...ref, id: "old-village" } }], next: "older" };
  const result = defenceReadiness(state, rules, reports);
  assert.equal(result.villages[0].retainedDefensiveBattles, 1);
  assert.equal(result.villages[0].retainedDefensiveLosses, 1);
  assert.equal(result.reports.hasOlderPage, true);
  assert.deepEqual(result.villages[0].incoming, [{ id: "incoming", ticksUntilArrival: 75, unitsKnown: false, sighted: null }]);
  state.world.endsAtTick = 50;
  assert.equal(defenceReadiness(state, rules, reports).world.remainingTicks, 0);
  rules.version++;
  assert.throws(() => defenceReadiness(state, rules, reports), /version mismatch/);
});

test("comparison counts interval battles once and exposes truncated history", () => {
  const { state, rules } = context();
  const previous = structuredClone(state);
  previous.world.tick = 50;
  previous.villages[0].buildings.mine = 0;
  const ref = { id: "v1", name: "Test", x: 1, y: 1, ownerId: "p1", ownerName: "Tester" };
  const report = { id: "new", tick: 75, kind: "battle", role: "defender", commandId: null, attacker: ref, defender: ref, outcome: "lost", conquered: false, read: false } as const;
  const reports: ReportsResponse = { reports: [report, report,
    { ...report, id: "scout", kind: "scouting" },
    { ...report, id: "scout", kind: "scouting" },
    { ...report, id: "future-scout", kind: "scouting", tick: 101 },
    { ...report, id: "foreign-scout", kind: "scouting", defender: { ...ref, id: "other" } },
    { ...report, id: "outbound-scout", kind: "scouting", role: "attacker" },
    { ...report, id: "foreign", defender: { ...ref, id: "other" } },
    { ...report, id: "future", tick: 101 }], next: "older" };
  const before = JSON.stringify({ state, previous, reports });
  const comparison = defenceReadiness(state, rules, reports, previous).comparison!;
  assert.equal(comparison.status, "comparable");
  if (comparison.status !== "comparable") throw new Error("Expected comparison");
  assert.equal(comparison.reportIntervalCovered, false);
  assert.equal(comparison.elapsedTicks, 50);
  assert.equal(comparison.villages[0].observedDefensiveScouting, 1);
  assert.equal(comparison.villages[0].observedDefensiveLosses, 1);
  assert.deepEqual(comparison.villages[0].buildingLevelChanges, [{ building: "mine", before: 0, after: 1 }]);
  assert.equal(JSON.stringify({ state, previous, reports }), before);
  reports.reports.push({ ...report, id: "boundary", tick: 50 });
  reports.reports.push({ ...report, id: "old-scout", kind: "scouting", tick: 50 });
  const covered = defenceReadiness(state, rules, reports, previous).comparison!;
  assert.equal(covered.status === "comparable" && covered.reportIntervalCovered, true);
  assert.equal(covered.status === "comparable" && covered.villages[0].observedDefensiveLosses, 1);
  assert.equal(covered.status === "comparable" && covered.villages[0].observedDefensiveScouting, 1);
  reports.reports = [];
  reports.next = null;
  const empty = defenceReadiness(state, rules, reports, previous).comparison!;
  assert.equal(empty.status === "comparable" && empty.reportIntervalCovered, true);
  assert.equal(empty.status === "comparable" && empty.villages[0].observedDefensiveScouting, 0);
});

test("comparison refuses resets, account changes and non-forward clocks", () => {
  const { state, rules } = context();
  for (const mutate of [
    (p: typeof state) => { p.world.epoch = "previous"; },
    (p: typeof state) => { p.world.round++; },
    (p: typeof state) => { p.world.id = "other"; },
    (p: typeof state) => { p.player.id = "other"; },
    (p: typeof state) => { p.world.tick = 100; },
    (p: typeof state) => { p.world.tick = 101; },
  ]) {
    const previous = structuredClone(state);
    previous.world.tick = 50;
    mutate(previous);
    assert.equal(defenceReadiness(state, rules, { reports: [], next: null }, previous).comparison?.status, "not-comparable");
  }
});

test("training readiness explains rule prerequisites without overriding server blockers", () => {
  const { state, rules } = context();
  const village = state.villages[0];
  village.options.train = ["pikeman", "shieldman", "archer", "scout"].map(unit => ({
    unit, cost: { timber: 1, stone: 1, iron: 1 }, ticksEach: 8, pop: 1,
    maxCount: 0, ok: false, blockers: ["REQUIREMENTS_NOT_MET"], affordableAtTick: null,
  })) as typeof village.options.train;
  const report = () => defenceReadiness(state, rules, { reports: [], next: null }).villages[0];
  const before = JSON.stringify({ state, rules });
  assert.deepEqual(report().trainingPrerequisites, [
    { unit: "pikeman", missingPrerequisites: [{ building: "barracks", required: 1, current: 0 }] },
    { unit: "shieldman", missingPrerequisites: [{ building: "barracks", required: 1, current: 0 }, { building: "smithy", required: 1, current: 0 }] },
    { unit: "archer", missingPrerequisites: [{ building: "barracks", required: 5, current: 0 }, { building: "smithy", required: 5, current: 0 }] },
    { unit: "scout", missingPrerequisites: [{ building: "stable", required: 1, current: 0 }] },
  ]);
  assert.equal(JSON.stringify({ state, rules }), before);
  village.buildings.barracks = 5;
  village.buildings.smithy = 5;
  assert.deepEqual(report().trainingPrerequisites.slice(0, 3).map(o => o.missingPrerequisites), [[], [], []]);
  assert.deepEqual(report().trainingOptions[0].blockers, ["REQUIREMENTS_NOT_MET"]);
  delete (rules.rules.UNITS as Record<string, unknown>).pikeman;
  assert.throws(report, /training prerequisites for pikeman/);
});
