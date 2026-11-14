import assert from "node:assert/strict";
import { test } from "node:test";
import { Controller, acquireExecutorLease } from "../src/control/controller.js";
import { RemoteError, type Remote } from "../src/control/remote.js";
import type { SavedControl, Settings } from "../src/control/types.js";
import type { ControlStorage } from "../src/control/storage.js";
import type { Action, BuildQueueItem } from "../src/shared/api.js";
import { context } from "./control-fixtures.js";
class Memory implements ControlStorage {
  value: SavedControl | null = null;
  async load() {
    return structuredClone(this.value);
  }
  async save(v: SavedControl) {
    this.value = structuredClone(v);
  }
}
const settings: Settings = {
  serverUrl: "https://game.test",
  worldId: "test",
  apiKey: "test-secret",
};
async function setup() {
  const c = context(),
    storage = new Memory();
  let now = 0,
    reads = 0,
    fail: RemoteError | null = null;
  const writes: Action[][] = [];
  const request: Remote = async <T>(
    _s: Settings,
    path: string,
    body?: unknown,
  ) => {
    if (path === "/me")
      return {
        account: { id: "a1", name: "Tester", createdAt: "" },
        worlds: [],
        sandboxes: [],
      } as T;
    if (path === "/worlds") return [c.state.world] as T;
    if (path.endsWith("/history")) return { samples: [] } as T;
    if (path.endsWith("/rules")) return structuredClone(c.rules) as T;
    if (path.endsWith("/state")) {
      reads++;
      return structuredClone(c.state) as T;
    }
    const actions = (body as { actions: Action[] }).actions;
    writes.push(actions);
    if (fail) {
      const error = fail;
      fail = null;
      throw error;
    }
    const action = actions[0] as Extract<Action, { type: "build" }>;
    const v = c.state.villages[0];
    const level = v.buildings[action.building] + 1;
    const item: BuildQueueItem = {
      id: "q-accepted",
      building: action.building,
      level,
      cost: { timber: 1, stone: 1, iron: 1 },
      startTick: c.state.world.tick,
      endTick: c.state.world.tick + 10,
    };
    v.buildQueue.push(item);
    return {
      tick: c.state.world.tick,
      results: [
        { ok: true, type: "build", clientId: action.clientId, data: { item } },
      ],
      state: structuredClone(c.state),
    } as T;
  };
  const controller = await Controller.create(
    storage,
    settings,
    request,
    () => now,
    { execute: false },
  );
  return {
    controller,
    c,
    storage,
    writes,
    request,
    get reads() {
      return reads;
    },
    failNext: (status = 0, retryMs = 5000) => {
      fail = new RemoteError(status, retryMs, "Network outcome unknown");
    },
    advance: () => {
      now += 10000;
    },
  };
}
test("recommendation mode never writes, even when many tabs refresh", async () => {
  const x = await setup();
  await Promise.all([
    x.controller.cycle(),
    x.controller.cycle(),
    x.controller.cycle(),
  ]);
  await x.controller.cycle();
  assert.equal(x.writes.length, 0);
  assert.equal(x.controller.snapshot().automatic, false);
  assert.ok(x.controller.snapshot().proposals.length);
  await x.controller.setAutomatic(true);
  assert.equal(x.controller.snapshot().automatic, true);
});
test("one submission survives concurrent evaluation and accepted construction is confirmed separately", async () => {
  const x = await setup();
  await x.controller.cycle();
  await x.controller.setAutomatic(true);
  await Promise.all([
    x.controller.cycle(),
    x.controller.cycle(),
    x.controller.cycle(),
  ]);
  assert.equal(x.writes.length, 1);
  assert.equal(x.controller.snapshot().pending?.phase, "accepted");
  assert.equal(
    x.storage.value?.pending?.action.clientId,
    x.writes[0][0].clientId,
  );
  await x.controller.cycle();
  assert.equal(x.writes.length, 1);
  const pending = x.controller.snapshot().pending!;
  x.c.state.villages[0].buildQueue = [];
  x.c.state.villages[0].buildings[pending.action.building] =
    pending.proposal.targetLevel;
  await x.controller.setAutomatic(false);
  await x.controller.cycle();
  assert.ok(
    x.controller.snapshot().decisions.some((d) => d.kind === "confirmed"),
  );
  assert.equal(x.writes.length, 1);
});
test("refresh before submission catches a manual build made after the recommendation", async () => {
  const x = await setup();
  await x.controller.cycle();
  let reads = 0;
  const changing: Remote = async <T>(s: Settings, p: string, b?: unknown) => {
    if (p.endsWith("/state") && ++reads === 2)
      x.c.state.villages[0].buildQueue = [
        {
          id: "manual",
          building: "farm",
          level: 2,
          cost: { timber: 1, stone: 1, iron: 1 },
          startTick: 100,
          endTick: 120,
        },
      ];
    return x.request<T>(s, p, b);
  };
  const controller = await Controller.create(
    x.storage,
    settings,
    changing,
    Date.now,
    { execute: false },
  );
  await controller.cycle();
  reads = 0;
  await controller.setAutomatic(true);
  await controller.cycle();
  assert.equal(x.writes.length, 0);
  assert.ok(
    controller
      .snapshot()
      .proposals.some((p) => p.blockers.includes("BUILD_QUEUE_BUSY")),
  );
});
test("uncertain retries preserve the exact ID and payload when the bot restarts automatically", async () => {
  const x = await setup();
  await x.controller.cycle();
  await x.controller.setAutomatic(true);
  x.failNext();
  await x.controller.cycle();
  assert.equal(x.writes.length, 1);
  const first = structuredClone(x.writes[0]);
  assert.equal(x.storage.value?.pending?.phase, "uncertain");
  const restarted = await Controller.create(
    x.storage,
    settings,
    x.request,
    () => 10000,
  );
  await restarted.cycle();
  assert.equal(restarted.snapshot().automatic, true);
  assert.equal(x.writes.length, 2);
  assert.deepEqual(x.writes[1], first);
});
test("an uncertain operation never adds another level if state has already changed", async () => {
  const x = await setup();
  await x.controller.cycle();
  await x.controller.setAutomatic(true);
  x.failNext();
  await x.controller.cycle();
  const p = x.controller.snapshot().pending!;
  x.c.state.villages[0].buildQueue = [
    {
      id: "observed",
      building: p.action.building,
      level: p.proposal.targetLevel,
      cost: { timber: 1, stone: 1, iron: 1 },
      startTick: 100,
      endTick: 120,
    },
  ];
  x.advance();
  await x.controller.cycle();
  assert.equal(x.writes.length, 1);
  assert.equal(x.controller.snapshot().pending, null);
  assert.ok(
    x.controller
      .snapshot()
      .decisions.some(
        (d) => d.kind === "uncertain" && d.text.includes("another actor"),
      ),
  );
});
test("expired idempotency windows pause execution rather than risking a duplicate", async () => {
  const x = await setup();
  await x.controller.cycle();
  await x.controller.setAutomatic(true);
  x.failNext();
  await x.controller.cycle();
  x.c.state.world.tick = x.controller.snapshot().pending!.expiresTick;
  x.advance();
  await x.controller.cycle();
  assert.equal(x.writes.length, 1);
  assert.equal(x.controller.snapshot().automatic, false);
  assert.ok(x.controller.snapshot().pending);
});
test("a second process cannot acquire the authoritative executor lease", async () => {
  const first = await acquireExecutorLease(0);
  try {
    const address = first.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(acquireExecutorLease(address.port), {
      code: "EADDRINUSE",
    });
  } finally {
    await new Promise<void>((resolve) => first.close(() => resolve()));
  }
});

test("HTTP 429 observes backoff and then reuses the request instead of duplicating it", async () => {
  const x = await setup();
  await x.controller.cycle();
  await x.controller.setAutomatic(true);
  x.failNext(429, 20000);
  await x.controller.cycle();
  const first = structuredClone(x.writes[0]);
  x.advance();
  await x.controller.cycle();
  assert.equal(x.writes.length, 1);
  x.advance();
  await x.controller.cycle();
  assert.equal(x.writes.length, 2);
  assert.deepEqual(x.writes[1], first);
});
test("per-action errors inside HTTP 200 are rejected, never marked accepted", async () => {
  const x = await setup();
  const request: Remote = async <T>(s: Settings, p: string, b?: unknown) =>
    p.endsWith("/actions")
      ? ({
          tick: 100,
          results: [
            {
              ok: false,
              type: "build",
              error: {
                code: "QUEUE_FULL",
                message: "Another actor filled the queue",
              },
            },
          ],
        } as T)
      : x.request<T>(s, p, b);
  const controller = await Controller.create(
    x.storage,
    settings,
    request,
    Date.now,
    { execute: false },
  );
  await controller.cycle();
  await controller.setAutomatic(true);
  await controller.cycle();
  assert.equal(controller.snapshot().pending, null);
  assert.ok(controller.snapshot().decisions.some((d) => d.kind === "rejected"));
  assert.ok(
    !controller.snapshot().decisions.some((d) => d.kind === "accepted"),
  );
});
test("no submission occurs if the durable request journal cannot be written", async () => {
  const x = await setup();
  const original = x.storage.save.bind(x.storage);
  x.storage.save = async (value) => {
    if (value.pending) throw new Error("Disk unavailable");
    return original(value);
  };
  await x.controller.cycle();
  await x.controller.setAutomatic(true);
  await x.controller.cycle();
  assert.equal(x.writes.length, 0);
  assert.match(x.controller.snapshot().error ?? "", /Disk unavailable/);
});
test("turning off automatic execution during revalidation prevents the write", async () => {
  const x = await setup();
  let reads = 0,
    ready!: () => void,
    release!: () => void;
  const reached = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request: Remote = async <T>(s: Settings, p: string, b?: unknown) => {
    if (p.endsWith("/state") && ++reads === 2) {
      ready();
      await barrier;
    }
    return x.request<T>(s, p, b);
  };
  const controller = await Controller.create(
    x.storage,
    settings,
    request,
    Date.now,
    { execute: false },
  );
  await controller.cycle();
  reads = 0;
  await controller.setAutomatic(true);
  const cycle = controller.cycle();
  await reached;
  await controller.setAutomatic(false);
  release();
  await cycle;
  assert.equal(x.writes.length, 0);
});

test("key rotation preserves tracked work and lets the bot resume", async () => {
  const x = await setup();
  await x.controller.cycle();
  await x.controller.setAutomatic(true);
  await x.controller.cycle();
  assert.equal(x.controller.snapshot().pending?.phase, "accepted");
  await x.controller.configure({ apiKey: "new-test-key" });
  assert.equal(x.controller.snapshot().automatic, true);
  assert.equal(x.controller.settings.apiKey, "new-test-key");
  assert.equal(x.controller.snapshot().pending?.phase, "accepted");
  assert.equal(x.writes.length, 1);
});
