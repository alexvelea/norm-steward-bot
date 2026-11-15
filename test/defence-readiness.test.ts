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
