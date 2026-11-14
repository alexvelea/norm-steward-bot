// Where a moving army or merchant train is at a given tick. Outward legs are exact (sentTick to
// arrivalTick). A returning leg's start isn't sent, so it is worked out from how it can have turned:
// - Turned round (an attack that resolved, any command cancelled, a delivered trade): it comes home in
//   the time it spent going out (engine turnRound), so the turn is the midpoint of sentTick..arrivalTick.
//   A resolved attack turns at the target; a cancelled command turns where it had got to.
// - Withdrawn (support recalled by its owner or sent back by its host): a new command whose sentTick is
//   the recall and whose arrivalTick is the recall plus its own travel time (engine withdrawStack). It
//   leaves the host at sentTick and walks home at its own pace.
// The two can only be told apart by their numbers: a turn-round leg spans an even number of ticks, at
// most twice COMBAT.cancelWindow for support (support is only turned round by a cancel), and with the
// units in hand a withdrawn leg spans exactly its own travel time.
import type { GodMovement, IncomingCommand, OutgoingCommand, Trade, UnitCounts } from "../contract";
import { COMBAT, UNITS, UNIT_IDS } from "../contract";

export interface Leg {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startTick: number;
  endTick: number;
}

/** The engine's distance (mapgen.distance), written the same way so travel times round the same. */
export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

/** ceil(distance * slowest unit's speed), as design.md § Moving armies; null with no units. */
export function travelTicks(fields: number, units: UnitCounts): number | null {
  let slowest = 0;
  for (const u of UNIT_IDS) if ((units[u] ?? 0) > 0) slowest = Math.max(slowest, UNITS[u].speed);
  return slowest > 0 ? Math.ceil(fields * slowest) : null;
}

/** A returning support leg that can't be a cancelled one, so it was recalled or sent back. */
function couldOnlyBeWithdrawn(span: number): boolean {
  return span % 2 !== 0 || span > 2 * COMBAT.cancelWindow;
}

/** Leaves the host (awayXY) at sentTick and reaches home at arrivalTick. */
function withdrawnLeg(homeX: number, homeY: number, awayX: number, awayY: number, sentTick: number, arrivalTick: number): Leg {
  return { fromX: awayX, fromY: awayY, toX: homeX, toY: homeY, startTick: sentTick, endTick: arrivalTick };
}

/**
 * Turned round at the midpoint and home in as long as it was out. With its own pace known, it starts
 * from where it had got to (the whole way, for a resolved attack); without, from the far end.
 */
function turnedRoundLeg(
  homeX: number,
  homeY: number,
  awayX: number,
  awayY: number,
  sentTick: number,
  arrivalTick: number,
  ownPace: number | null,
): Leg {
  const back = Math.max(1, (arrivalTick - sentTick) / 2);
  const reached = ownPace === null || ownPace <= 0 ? 1 : Math.min(1, back / ownPace);
  return {
    fromX: homeX + (awayX - homeX) * reached,
    fromY: homeY + (awayY - homeY) * reached,
    toX: homeX,
    toY: homeY,
    startTick: arrivalTick - back,
    endTick: arrivalTick,
  };
}

export function commandLeg(c: OutgoingCommand): Leg {
  if (!c.returning) {
    return { fromX: c.from.x, fromY: c.from.y, toX: c.to.x, toY: c.to.y, startTick: c.sentTick, endTick: c.arrivalTick };
  }
  const span = c.arrivalTick - c.sentTick;
  const ownPace = travelTicks(distance(c.from.x, c.from.y, c.to.x, c.to.y), c.units);
  if (c.kind === "support" && (span === ownPace || couldOnlyBeWithdrawn(span))) {
    return withdrawnLeg(c.from.x, c.from.y, c.to.x, c.to.y, c.sentTick, c.arrivalTick);
  }
  return turnedRoundLeg(c.from.x, c.from.y, c.to.x, c.to.y, c.sentTick, c.arrivalTick, ownPace);
}

export function tradeLeg(t: Trade): Leg {
  if (!t.returning) {
    return { fromX: t.from.x, fromY: t.from.y, toX: t.to.x, toY: t.to.y, startTick: t.sentTick, endTick: t.arrivalTick };
  }
  // Merchants turn round only on delivery, at the target.
  return turnedRoundLeg(t.from.x, t.from.y, t.to.x, t.to.y, t.sentTick, t.arrivalTick, null);
}

export function incomingLeg(c: IncomingCommand): Leg {
  return { fromX: c.from.x, fromY: c.from.y, toX: c.to.x, toY: c.to.y, startTick: c.sentTick, endTick: c.arrivalTick };
}

/**
 * Read as an OutgoingCommand's from/to: fromXY is the sender's village, toXY the target. The god view
 * carries no units, so a short, even returning support leg (which could be a cancel) is drawn as a
 * turn-round; any other returning support leg was withdrawn.
 */
export function godLeg(m: GodMovement): Leg {
  const [fx, fy] = m.fromXY;
  const [tx, ty] = m.toXY;
  if (!m.returning) return { fromX: fx, fromY: fy, toX: tx, toY: ty, startTick: m.sentTick, endTick: m.arrivalTick };
  if (m.kind === "support" && couldOnlyBeWithdrawn(m.arrivalTick - m.sentTick)) {
    return withdrawnLeg(fx, fy, tx, ty, m.sentTick, m.arrivalTick);
  }
  return turnedRoundLeg(fx, fy, tx, ty, m.sentTick, m.arrivalTick, null);
}

export function legProgress(leg: Leg, tick: number): number {
  const span = leg.endTick - leg.startTick;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (tick - leg.startTick) / span));
}

export function legPoint(leg: Leg, t: number): [number, number] {
  return [leg.fromX + (leg.toX - leg.fromX) * t, leg.fromY + (leg.toY - leg.fromY) * t];
}
