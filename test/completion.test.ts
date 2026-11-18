import { test } from "node:test";
import assert from "node:assert/strict";
import { completionWindow } from "../src/advisors/completion.js";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { selectProposal } from "../src/advisors/president.js";
import { context } from "./control-fixtures.js";
test("round completion allows before/equal, rejects after, and preserves live costs", () => {
  const c = context(),
    v = c.state.villages[0],
    o = v.options.build.find((o) => o.building === "cellar")!;
  Object.assign(c, {cityRoles: new Map([[v.id, {role: "economic", reason: "fixture"}]])});
  o.ticks = 8;
  c.state.world.endsAtTick = 109;
  assert.equal(completionWindow(c.state, v, o)!.fits, true);
  c.state.world.endsAtTick = 108;
  assert.equal(completionWindow(c.state, v, o)!.fits, true);
  c.state.world.endsAtTick = 107;
  const p = evaluateEconomy(c).find((p) => p.action.building === "cellar")!;
  assert.equal(p.status, "not-needed");
  assert.ok(p.blockers.includes("ROUND_END_TOO_SOON"));
  assert.deepEqual(p.requirements, o.cost);
  assert.notEqual(selectProposal(evaluateEconomy(c)).selected?.id, p.id);
});
test("resource wait and Council cooldown count toward the earliest completion", () => {
  const c = context(),
    v = c.state.villages[0],
    o = v.options.build[0];
  o.ticks = 10;
  c.state.world.endsAtTick = 125;
  o.affordableAtTick = 116;
  assert.equal(completionWindow(c.state, v, o)!.fits, false);
  o.affordableAtTick = null;
  c.state.player.nextActTick = 116;
  assert.equal(completionWindow(c.state, v, o)!.fits, false);
  c.state.player.nextActTick = 114;
  assert.equal(completionWindow(c.state, v, o)!.fits, true);
});
test("queued Hall timing is reevaluated after completion, not used for speculative approval", () => {
  const c = context(),
    v = c.state.villages[0];
  v.buildQueue = [
    {
      id: "q",
      building: "hall",
      level: 2,
      startTick: 100,
      endTick: 110,
      cost: { timber: 1, stone: 1, iron: 1 },
    },
  ];
  assert.equal(completionWindow(c.state, v, v.options.build[0]), null);
  const proposals = evaluateEconomy(c);
  assert.equal(
    proposals.find((p) => p.action.building === "hall")!.status,
    "queued",
  );
  assert.equal(selectProposal(proposals).selected, null);
});
