import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { selectProposal } from "../src/advisors/president.js";
import { context } from "./control-fixtures.js";

test("economic scores are deterministic, explain production bottlenecks and cover exactly seven buildings", () => {
  const c = context();
  c.state.villages[0].production.iron = 20;
  const first = evaluateEconomy(c);
  assert.deepEqual(first, evaluateEconomy(c));
  assert.equal(first.length, 7);
  assert.ok(first.every((p) => p.importance >= 0 && p.importance <= 100 && p.reason.length > 30));
  assert.ok(
    first.find((p) => p.action.building === "mine")!.importance >
      first.find((p) => p.action.building === "lumberyard")!.importance,
  );
  assert.match(first.find((p) => p.action.building === "mine")!.reason, /20\/min/);
});
test("population exhaustion and storage limits outrank discretionary growth", () => {
  const c = context();
  const v = c.state.villages[0];
  v.population.used = v.population.max;
  let ranked = evaluateEconomy(c);
  assert.equal(ranked[0].action.building, "farm");
  assert.equal(ranked[0].importance, 100);
  v.population.used = 30;
  v.options.build.find((o) => o.building === "mine")!.blockers = ["EXCEEDS_STORAGE"];
  ranked = evaluateEconomy(c);
  assert.equal(ranked[0].action.building, "storehouse");
  assert.equal(ranked[0].importance, 99);
});
test("queued builds, standing build orders and Council cooldown are explicit blockers", () => {
  const c = context();
  const v = c.state.villages[0];
  v.buildQueue = [
    { id: "q1", building: "hall", level: 2, startTick: 100, endTick: 125, cost: { timber: 1, stone: 1, iron: 1 } },
  ];
  let proposals = evaluateEconomy(c);
  assert.equal(proposals.find((p) => p.action.building === "hall")!.status, "queued");
  assert.equal(selectProposal(proposals).selected, null);
  v.buildQueue = [];
  v.orders.build = [{ building: "farm", toLevel: 3 }];
  assert.equal(selectProposal(evaluateEconomy(c)).selected, null);
  v.orders.build = [];
  c.state.player.nextActTick = 105;
  assert.ok(evaluateEconomy(c).every((p) => p.blockers.includes("COUNCIL_COOLDOWN")));
});
test("President saves for important affordable-in-principle work instead of spending on lower priorities", () => {
  const proposals = evaluateEconomy(context());
  const high = { ...proposals[0], importance: 95, status: "waiting" as const, blockers: ["INSUFFICIENT_RESOURCES"] };
  const low = { ...proposals[1], importance: 50, status: "ready" as const, blockers: [] };
  const selected = selectProposal([low, high]);
  assert.equal(selected.selected, null);
  assert.equal(selected.reservations[0].proposalId, high.id);
  assert.equal(selectProposal([{ ...high, importance: 60 }, low]).selected!.id, low.id);
  assert.equal(selectProposal([{ ...high, blockers: ["REQUIREMENTS_NOT_MET"] }, low]).selected!.id, low.id);
  const independent = { ...low, villageId: "v2", id: "v2-low" };
  assert.equal(selectProposal([high, low, independent]).selected!.id, independent.id);
});
test("maximum levels are omitted and mismatched live rule versions stop evaluation", () => {
  const c = context();
  c.state.villages[0].buildings.cellar = 10;
  assert.ok(!evaluateEconomy(c).some((p) => p.action.building === "cellar"));
  c.rules.version++;
  assert.throws(() => evaluateEconomy(c), /rules/);
});
