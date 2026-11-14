import assert from "node:assert/strict";
import { test } from "node:test";
import { WorldFeed, type FeedHooks } from "../src/world/feed";
import { report, state, summary } from "./fixtures";

function feedWith(extra: Partial<FeedHooks> = {}) {
  const calls: string[] = [];
  const hooks: FeedHooks = {
    epochChanged: () => calls.push("epoch"),
    pointsRefreshed: () => calls.push("points"),
    historySampled: () => calls.push("history"),
    stateAppeared: () => calls.push("stateAppeared"),
    reportsReadElsewhere: () => calls.push("reportsReadElsewhere"),
    ...extra,
  };
  return { feed: new WorldFeed("tiny", hooks), calls };
}

function roundOne() {
  const t = feedWith();
  t.feed.summary(summary({ epoch: "r1.0", tick: 120 }));
  t.feed.state(state({ tick: 120 }));
  t.feed.history({ samples: [{ tick: 60 }, { tick: 120 }] as never });
  t.feed.reports({ reports: [report("r-a")], next: "r-a" }, false);
  t.feed.activity([{ seq: 1 } as never]);
  return t;
}

test("a new round (summary) drops everything that was the player's in the last one", () => {
  const { feed, calls } = roundOne();
  feed.summary(summary({ epoch: "r2.0", tick: 0, round: 2 }));
  const v = feed.view;
  assert.equal(v.state, null);
  assert.equal(v.playerId, null);
  assert.deepEqual(v.history, []);
  assert.deepEqual(v.reports, []);
  assert.equal(v.reportsNext, null);
  assert.deepEqual(v.activity, []);
  assert.deepEqual(calls, ["epoch"]);
});

test("a new round seen first in the welcome or the round message drops it too", () => {
  for (const msg of [
    { type: "welcome", world: summary({ epoch: "r2.0", round: 2 }), authenticated: true, playerId: null, channels: [] },
    { type: "round", round: 2, status: "running", epoch: "r2.0" },
  ] as const) {
    const { feed } = roundOne();
    feed.message(msg as never);
    assert.equal(feed.view.playerId, null, msg.type);
    assert.deepEqual(feed.view.history, [], msg.type);
    assert.deepEqual(feed.view.reports, [], msg.type);
  }
});

test("a state on the stream while none is held says so, once", () => {
  const { feed, calls } = feedWith();
  feed.summary(summary());
  feed.message({ type: "state", state: state() });
  feed.message({ type: "state", state: state({ tick: 1 }) });
  assert.deepEqual(calls, ["stateAppeared"]);
});

test("reports the steward read elsewhere stop showing unread", () => {
  const { feed, calls } = feedWith({ stateAppeared: () => undefined });
  feed.summary(summary());
  feed.reports({ reports: [report("r3"), report("r2"), report("r1")], next: null }, false);
  feed.message({ type: "state", state: state({ unreadReports: 3 }) });
  assert.deepEqual(calls, []);

  // One left unread: the list doesn't know which, so it asks for the first page again.
  feed.message({ type: "state", state: state({ unreadReports: 1 }) });
  assert.deepEqual(calls, ["reportsReadElsewhere"]);
  feed.reportReadFlags({ reports: [report("r3"), report("r2", true), report("r1", true)], next: null });
  assert.deepEqual(feed.view.reports.map((r) => r.read), [false, true, true]);

  // None unread: none are.
  feed.message({ type: "state", state: state({ unreadReports: 0 }) });
  assert.deepEqual(feed.view.reports.map((r) => r.read), [true, true, true]);
});

test("a lockstep sandbox's clock is marked lockstep from the summary on", () => {
  const { feed } = feedWith();
  feed.summary(summary({ kind: "sandbox", clock: "lockstep" }));
  assert.equal(feed.view.clock.lockstep, true);
  feed.message({ type: "tick", tick: 10, status: "running", speed: 5 });
  assert.equal(feed.view.clock.lockstep, true);
  feed.summary(summary({ kind: "sandbox", clock: "realtime" }));
  assert.equal(feed.view.clock.lockstep, false);
});
