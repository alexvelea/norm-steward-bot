import { test } from "node:test";
import assert from "node:assert/strict";
import { constructionHorizon } from "../src/review/construction-horizon.js";
import { context } from "./control-fixtures.js";

test("horizon distinguishes completion boundaries and preserves evidence", () => {
  const { state } = context();
  state.world.endsAtTick = 120;
  const v = state.villages[0];
  v.options.build = [19, 20, 21].map(ticks => ({ ...v.options.build[0], ticks,
    cost: { timber: 0, stone: 0, iron: 0 }, ok: true, blockers: [], affordableAtTick: null }));
  const before = JSON.stringify(state);
  const result = constructionHorizon(state);
  assert.deepEqual(result.villages[0].options.map(o => o.roundRelation),
    ["before-round-end", "at-round-end", "after-round-end"]);
  assert.deepEqual(result.villages[0].options.map(o => o.projectedTicksBeyondRoundEnd), [0, 0, 1]);
  assert.equal(JSON.stringify(state), before);
  // Exercise incomplete runtime evidence without changing the public contract snapshot.
  Object.assign(state.world, { endsAtTick: null });
  assert.equal(constructionHorizon(state).villages[0].options[0].roundRelation, "unknown");
});

test("horizon combines other-village queue, cooldown and affordability without claiming readiness", () => {
  const { state } = context();
  state.world.endsAtTick = 150;
  state.player.nextActTick = 140;
  const v = state.villages[0];
  v.options.build = [{ ...v.options.build[0], ticks: 10, cost: { timber: 999999, stone: 0, iron: 0 },
    affordableAtTick: 145, ok: false, blockers: ["INSUFFICIENT_RESOURCES", "REQUIREMENTS_NOT_MET"] }];
  const other = structuredClone(v);
  other.id = "other";
  other.buildQueue = [{ id: "q", building: "mine", level: 2, cost: { timber: 1, stone: 2, iron: 3 }, startTick: 90, endTick: 160 }];
  state.villages.push(other);
  let result = constructionHorizon(state);
  assert.equal(result.villages[0].options[0].projectedCompletionTick, 170);
  assert.deepEqual(result.villages[0].options[0].blockers, v.options.build[0].blockers);
  assert.equal(result.villages[1].queued[0].ticksBeyondRoundEnd, 10);
  other.buildQueue = [];
  result = constructionHorizon(state);
  assert.equal(result.villages[0].options[0].projectedCompletionTick, 155);
  state.player.nextActTick = 149;
  assert.equal(constructionHorizon(state).villages[0].options[0].projectedCompletionTick, 159);
  v.options.build[0].affordableAtTick = null;
  assert.equal(constructionHorizon(state).villages[0].options[0].projectedCompletionTick, null);
  v.options.build[0].cost.timber = 0;
  // A server resource blocker still makes a missing affordability time unknown.
  assert.equal(constructionHorizon(state).villages[0].options[0].projectedCompletionTick, null);
  v.options.build[0].blockers = [];
  assert.equal(constructionHorizon(state).villages[0].options[0].projectedCompletionTick, 159);
});

test("max-level placeholders and invalid timing never imply useful completion", () => {
  const { state } = context();
  const option = state.villages[0].options.build[0];
  option.blockers = ["MAX_LEVEL"];
  option.ticks = 0;
  assert.equal(constructionHorizon(state).villages[0].options[0].roundRelation, "unknown");
  option.ticks = NaN;
  assert.throws(() => constructionHorizon(state), /build duration/);
  option.ticks = 1;
  state.world.endsAtTick = -1;
  assert.throws(() => constructionHorizon(state), /round end/);
});
