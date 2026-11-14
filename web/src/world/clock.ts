// Game time between stream messages. Tick messages arrive at most SERVER.tickMessagesPerSecond times a
// real second, so motion extrapolates from the last one at the world's speed, never running further
// ahead than one message's worth, and never stepping backwards on screen. A lockstep sandbox is
// "running" yet moves only while its creator waits for events, so it never runs ahead: its tick is the
// last one the server sent, and its countdowns are in ticks, not real time.
import { useSyncExternalStore } from "react";
import type { WorldSummary } from "../contract";
import { SERVER } from "../contract";
import type { Clock } from "./types";

export function isLockstep(summary: Pick<WorldSummary, "clock"> | null | undefined): boolean {
  return summary?.clock === "lockstep";
}

/** True while game time passes on its own, so the shown tick may run ahead of the last message. */
export function isFlowing(clock: Clock): boolean {
  return clock.status === "running" && !clock.lockstep;
}

/** Ticks per real second to turn a tick count into time left; 0 when there is no such pace (lockstep). */
export function paceOf(clock: Clock): number {
  return clock.lockstep ? 0 : clock.speed;
}

export function maxLead(speed: number): number {
  return Math.max(1, speed / SERVER.tickMessagesPerSecond) + 1;
}

export function extrapolateTick(clock: Clock, now: number): number {
  if (!isFlowing(clock) || clock.receivedAt === 0) return clock.tick;
  const ahead = ((now - clock.receivedAt) / 1000) * clock.speed;
  return clock.tick + Math.min(Math.max(0, ahead), maxLead(clock.speed));
}

/** Keeps the shown tick monotonic unless the clock really went back (a new round, a restore). */
export class TickSmoother {
  private shown = Number.NEGATIVE_INFINITY;

  at(clock: Clock, now: number): number {
    const target = extrapolateTick(clock, now);
    if (target >= this.shown || this.shown - target > maxLead(clock.speed) + 1) this.shown = target;
    return this.shown;
  }
}

// A shared quarter-second heartbeat for countdowns and live numbers in the panels.
const HEARTBEAT_MS = 250;
let now = performance.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => {
      now = performance.now();
      for (const l of listeners) l();
    }, HEARTBEAT_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getNow = () => now;

export function useHeartbeat(): number {
  return useSyncExternalStore(subscribe, getNow, getNow);
}

/** The current game tick (fractional), refreshed four times a second. */
export function useLiveTick(clock: Clock): number {
  const at = useHeartbeat();
  return extrapolateTick(clock, Math.max(at, clock.receivedAt));
}
