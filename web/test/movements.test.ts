// The dashboard draws each army where the server says it is. Run: node --import tsx --test "web/test/**/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GodMovement, OutgoingCommand, UnitCounts } from "../src/contract";
import { COMBAT } from "../src/contract";
import { commandLeg, distance, godLeg, legPoint, legProgress, travelTicks } from "../src/world/movements";

const HOME = { id: "v-home", name: "Home", x: 50, y: 50, ownerId: "p1", ownerName: "ironwright" };
const HOST = { id: "v-host", name: "Barleygate", x: 56, y: 49, ownerId: "p2", ownerName: "warden" };
const FAR = { id: "v-far", name: "Far", x: 80, y: 70, ownerId: null, ownerName: null };

function command(over: Partial<OutgoingCommand>): OutgoingCommand {
  return {
    id: "c1",
    seq: 1,
    kind: "support",
    returning: false,
    from: HOME,
    to: HOST,
    units: { pikeman: 5 },
    aim: null,
    sentTick: 0,
    arrivalTick: 0,
    cancellableUntilTick: null,
    loot: null,
    raidOrder: null,
    ...over,
  };
}

const pace = (to: { x: number; y: number }, units: UnitCounts) => travelTicks(distance(HOME.x, HOME.y, to.x, to.y), units)!;

test("recalled support leaves the host at the recall and walks home at its own pace", () => {
  const travel = pace(HOST, { pikeman: 5 });
  // engine withdrawStack: sentTick is the recall, arrivalTick the recall plus its travel.
  const c = command({ returning: true, sentTick: 1800, arrivalTick: 1800 + travel });
  const leg = commandLeg(c);
  assert.equal(leg.startTick, 1800);
  assert.equal(leg.endTick, 1800 + travel);
  assert.deepEqual([leg.fromX, leg.fromY, leg.toX, leg.toY], [HOST.x, HOST.y, HOME.x, HOME.y]);
  assert.ok(legProgress(leg, 1801) > 0, "it is already moving one tick after the recall");
  assert.ok(Math.abs(legProgress(leg, 1800 + travel / 2) - 0.5) < 1e-9, "halfway in time is halfway home");
});

test("a long recall is still told apart without units (the god view)", () => {
  const travel = pace(FAR, { pikeman: 5 });
  assert.ok(travel > 2 * COMBAT.cancelWindow);
  const m: GodMovement = { id: "c1", kind: "support", ownerId: "p1", fromXY: [HOME.x, HOME.y], toXY: [FAR.x, FAR.y], sentTick: 500, arrivalTick: 500 + travel, returning: true, pop: 5 };
  const leg = godLeg(m);
  assert.equal(leg.startTick, 500);
  assert.deepEqual([leg.fromX, leg.fromY], [FAR.x, FAR.y]);
});

test("a short recall with an odd span can't be a cancel, so the god view draws it from the recall", () => {
  const m: GodMovement = { id: "c1", kind: "support", ownerId: "p1", fromXY: [HOME.x, HOME.y], toXY: [HOST.x, HOST.y], sentTick: 100, arrivalTick: 137, returning: true, pop: 5 };
  assert.equal(godLeg(m).startTick, 100);
});

test("support cancelled on the way turns where it had got to, at the cancel", () => {
  const travel = pace(FAR, { pikeman: 5 });
  // Sent at 100, cancelled at 120: home at 140 (engine turnRound).
  const c = command({ to: FAR, returning: true, sentTick: 100, arrivalTick: 140 });
  const leg = commandLeg(c);
  assert.equal(leg.startTick, 120);
  assert.equal(leg.endTick, 140);
  const reached = 20 / travel;
  assert.ok(Math.abs(leg.fromX - (HOME.x + (FAR.x - HOME.x) * reached)) < 1e-9);
  assert.ok(Math.abs(leg.fromY - (HOME.y + (FAR.y - HOME.y) * reached)) < 1e-9);
  assert.deepEqual(legPoint(leg, legProgress(leg, 140)), [HOME.x, HOME.y]);
});

test("a resolved attack comes home from the target in the time it took to get there", () => {
  const travel = pace(FAR, { pikeman: 40 });
  const c = command({ kind: "attack", to: FAR, units: { pikeman: 12 }, returning: true, sentTick: 0, arrivalTick: 2 * travel });
  const leg = commandLeg(c);
  assert.equal(leg.startTick, travel);
  assert.deepEqual([leg.fromX, leg.fromY], [FAR.x, FAR.y]);
});

test("a returning attack in the god view turns at the midpoint", () => {
  const m: GodMovement = { id: "c2", kind: "attack", ownerId: "p1", fromXY: [HOME.x, HOME.y], toXY: [FAR.x, FAR.y], sentTick: 0, arrivalTick: 300, returning: true, pop: 30 };
  assert.equal(godLeg(m).startTick, 150);
});
