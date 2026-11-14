import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTicksAsTime } from "../src/lib/format";
import { extrapolateTick, isFlowing, paceOf, TickSmoother } from "../src/world/clock";
import type { Clock } from "../src/world/types";

test("a realtime clock runs ahead of the last message, a lockstep one never does", () => {
  const realtime: Clock = { tick: 0, receivedAt: 1000, speed: 5, status: "running" };
  const lockstep: Clock = { ...realtime, lockstep: true };
  assert.ok(extrapolateTick(realtime, 5000) > 0);
  assert.equal(extrapolateTick(lockstep, 5000), 0);
  assert.equal(new TickSmoother().at(lockstep, 5000), 0);
  assert.equal(isFlowing(lockstep), false);
  assert.equal(isFlowing(realtime), true);
});

test("lockstep countdowns are in ticks, not real time", () => {
  const lockstep: Clock = { tick: 0, receivedAt: 1000, speed: 5, status: "running", lockstep: true };
  assert.equal(paceOf(lockstep), 0);
  assert.equal(formatTicksAsTime(42, paceOf(lockstep)), "42 ticks");
  assert.equal(formatTicksAsTime(0.4, 0), "1 tick");
  assert.equal(formatTicksAsTime(50, 5), "0:10");
});
