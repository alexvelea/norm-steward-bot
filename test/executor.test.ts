import assert from "node:assert/strict";
import { test } from "node:test";
import { Controller, acquireExecutorLease } from "../src/control/controller.js";
import { RemoteError, type Remote } from "../src/control/remote.js";
import type { Proposal } from "../src/advisors/types.js";
import type { Pending, SavedControl, Settings } from "../src/control/types.js";
import type { ControlStorage } from "../src/control/storage.js";
import type { Action, BuildQueueItem } from "../src/shared/api.js";
import { context, completeOpening } from "./control-fixtures.js";
class Memory implements ControlStorage {
  value: SavedControl | null = null;
  saves=0;
  failAt:number|null=null;
  async load() {
    return structuredClone(this.value);
  }
  async save(v: SavedControl) {
    this.saves++;
    if(this.failAt===this.saves)throw new Error("Storage write failed.");
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
    const action = actions[0];
    const v = c.state.villages[0];
    if (action.type === "train") {
      const batch = {
        id: "training-accepted",
        unit: action.unit,
        count: action.count,
        remaining: action.count,
        costEach: { timber: 45, stone: 35, iron: 15 },
        nextTick: c.state.world.tick + 8,
        endTick: c.state.world.tick + 8 * action.count,
      };
      v.training.barracks.push(batch);
      return {
        tick: c.state.world.tick,
        results: [{ ok: true, type: "train", data: { batch } }],
      } as T;
    }
    if (action.type === "trade") {
      assert.deepEqual(storage.value?.pending?.action, action);
      assert.ok(storage.value?.pending?.phase === "prepared" || storage.value?.pending?.phase === "uncertain");
      const trade = {
        id: "trade-accepted",
        seq: 1,
        from: { id: action.village },
        to: { id: action.target },
        resources: {
          timber: action.resources.timber ?? 0,
          stone: action.resources.stone ?? 0,
          iron: action.resources.iron ?? 0,
        },
        merchants: 1,
        sentTick: c.state.world.tick,
        arrivalTick: c.state.world.tick + 10,
        returning: false,
      };
      c.state.trades.outgoing.push(trade as any);
      return {
        tick: c.state.world.tick,
        results: [{ ok: true, type: "trade", clientId: action.clientId, data: { trade } }],
      } as T;
    }
    if (action.type === "recall") {
      const city = c.state.villages.find(value => value.id === action.village)!;
      const command = {
        id: "recall-accepted", kind: "support", from: {id: action.village},
        to: {id: action.home}, units: action.units, returning: true,
        sentTick: c.state.world.tick, arrivalTick: c.state.world.tick + 10,
      };
      city.supportHere = [];
      c.state.commands.outgoing.push(command as any);
      return {
        tick: c.state.world.tick,
        results: [{ok: true, type: "recall", data: {command}}],
      } as T;
    }
    if (action.type !== "build") throw new Error("Unexpected action");
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
test("accepted support confirms against the capital-origin count sent, not the destination target", async () => {
  const x = await setup();
  await x.controller.cycle();
  const capital = x.c.state.villages[0]!;
  const city = structuredClone(capital);
  city.id = "v2";
  city.name = "Harbor";
  city.units.home.pikeman = 199;
  city.supportHere = [{
    home: {
      id: capital.id, name: capital.name, x: capital.x, y: capital.y,
      ownerId: x.c.state.player.id, ownerName: x.c.state.player.name,
    },
    at: {
      id: city.id, name: city.name, x: city.x, y: city.y,
      ownerId: x.c.state.player.id, ownerName: x.c.state.player.name,
    },
    units: {pikeman: 51},
  }];
  x.c.state.villages.push(city);
  x.c.state.world.villages = 2;

  const action: Extract<Action, {type: "send"}> = {
    type: "send",
    village: capital.id,
    target: city.id,
    kind: "support",
    units: {pikeman: 51},
    clientId: "accepted-support",
  };
  const proposal: Proposal = {
    id: "support-request",
    task: "econ.request-defenders",
    advisor: "military",
    villageId: city.id,
    villageName: city.name,
    action,
    buildingName: "Pikeman support",
    currentLevel: 199,
    targetLevel: 250,
    importance: 80,
    reason: "Top up the city.",
    requirements: {timber: 0, stone: 0, iron: 0},
    blockers: [],
    status: "ready",
    affordableAtTick: null,
  };
  const operation: Pending = {
    proposal,
    action,
    accountId: "a1",
    worldId: x.c.state.world.id,
    epoch: x.c.state.world.epoch,
    serverUrl: settings.serverUrl,
    createdTick: x.c.state.world.tick,
    expiresTick: x.c.state.world.tick + 10000,
    phase: "accepted",
    itemId: "support-command",
  };
  x.storage.value = {...x.storage.value!, pending: null, active: [operation]};

  const resumed = await Controller.create(x.storage, settings, x.request, () => 20000, {execute: false});
  await resumed.cycle();
  assert.ok(resumed.snapshot().decisions.some(decision =>
    decision.kind === "confirmed" && decision.text === "Support arrived and is present in fresh state.",
  ));
});

test("recommendation mode never writes, even when many tabs refresh", async () => {
  const x = await setup();
  await Promise.all([
    x.controller.cycle(),
    x.controller.cycle(),
    x.controller.cycle(),
  ]);
  await x.controller.cycle();
  assert.ok(x.reads>0);
  assert.equal(x.writes.length, 0);
  assert.equal(x.controller.snapshot().automatic, false);
  assert.ok(x.controller.snapshot().proposals.length);
  await x.controller.setAutomatic(true);
  assert.equal(x.controller.snapshot().automatic, true);
});

test("trade execution journals before submit and confirms delivery from fresh state", async () => {
  const x = await setup();
  const capital = x.c.state.villages[0]!;
  const economic = structuredClone(capital);
  economic.id = "v2";
  economic.name = "Harbor";
  economic.storage = 5000;
  economic.resources = { timber: 0, stone: 0, iron: 0 };
  economic.resourcesMilli = { timber: 0, stone: 0, iron: 0 };
  x.c.state.villages.push(economic);
  x.c.state.world.villages = 2;
  capital.storage = 100000;
  capital.resources = { timber: 10000, stone: 10000, iron: 10000 };
  capital.resourcesMilli = { timber: 10000000, stone: 10000000, iron: 10000000 };
  capital.merchants = { total: 10, available: 10 };
  for (const option of capital.options.build) {
    option.ok = false;
    option.blockers = ["MAX_LEVEL"];
  }
  await x.controller.cycle();
  await x.controller.setAutomatic(true);
  await x.controller.cycle();
  const selected = x.controller.snapshot().selection.selected;
  assert.equal(selected?.task, "logistics.fulfil", JSON.stringify({
    selected: selected?.task,
    proposals: x.controller.snapshot().proposals.map(proposal => ({
      task: proposal.task,
      status: proposal.status,
      blockers: proposal.blockers,
      importance: proposal.importance,
    })),
  }));
  assert.equal(x.writes.length, 1);
  assert.equal(x.writes[0]?.[0]?.type, "trade");
  const acceptedTrade = [
    ...(x.storage.value?.active ?? []),
    ...(x.storage.value?.pending ? [x.storage.value.pending] : []),
  ].find(operation => operation.action.type === "trade");
  assert.equal(acceptedTrade?.phase, "accepted");
  assert.equal(acceptedTrade?.itemId, "trade-accepted");
  assert.ok(x.controller.snapshot().decisions.some(decision =>
    decision.kind === "accepted" && decision.text.includes("Trade to Harbor accepted")
  ));

  await x.controller.setAutomatic(false);
  x.c.state.trades.outgoing = [];
  economic.resources = { timber: 2000, stone: 2000, iron: 2000 };
  economic.resourcesMilli = { timber: 2000000, stone: 2000000, iron: 2000000 };
  x.advance();
  await x.controller.cycle();
  assert.ok(!(x.storage.value?.active ?? []).some(operation => operation.action.type === "trade"));
  assert.notEqual(x.storage.value?.pending?.action.type, "trade");
  assert.ok(x.controller.snapshot().decisions.some(decision =>
    decision.kind === "confirmed" && decision.text === "Trade to Harbor delivered."
  ));
});

test("trade executor lanes are independent by target and resource", async () => {
  const x = await setup();
  const capital = x.c.state.villages[0]!;
  capital.points = 5000;
  capital.resourcesMilli = { timber: 10000000, stone: 10000000, iron: 10000000 };
  capital.merchants = { total: 10, available: 10 };
  const harbor = structuredClone(capital);
  harbor.id = "v2";
  harbor.name = "Harbor";
  harbor.points = 10;
  harbor.storage = 5000;
  harbor.resources = { timber: 500, stone: 500, iron: 500 };
  const cove = structuredClone(harbor);
  cove.id = "v3";
  cove.name = "Cove";
  x.c.state.villages.push(harbor, cove);
  x.c.state.world.villages = 3;

  await x.controller.cycle();
  const tradeAction: Extract<Action, { type: "trade" }> = {
    type: "trade",
    clientId: "client-active-trade",
    village: capital.id,
    target: harbor.id,
    resources: { timber: 500 },
  };
  const proposal: Proposal = {
    id: "active-harbor-timber",
    task: "logistics.fulfil",
    advisor: "logistics",
    villageId: capital.id,
    villageName: capital.name,
    action: tradeAction,
    buildingName: "Trade timber to Harbor",
    currentLevel: 0,
    targetLevel: 0,
    importance: 95,
    reason: "Existing shipment.",
    requirements: { timber: 500, stone: 0, iron: 0 },
    blockers: [],
    status: "ready",
    affordableAtTick: null,
  };
  const operation: Pending = {
    proposal,
    action: tradeAction,
    accountId: "a1",
    worldId: "test",
    epoch: "r1",
    serverUrl: settings.serverUrl,
    createdTick: 100,
    expiresTick: 10000,
    phase: "accepted",
    itemId: "active-harbor-timber",
  };
  x.storage.value!.active = [operation];
  x.c.state.trades.outgoing.push({
    id: operation.itemId,
    seq: 1,
    from: { id: capital.id },
    to: { id: harbor.id },
    resources: { timber: 500, stone: 0, iron: 0 },
    merchants: 1,
    sentTick: 100,
    arrivalTick: 110,
    returning: false,
  } as any);

  const resumed = await Controller.create(
    x.storage,
    settings,
    x.request,
    () => 20000,
    { execute: false },
  );
  await resumed.cycle();
  const trades = resumed.snapshot().proposals.filter(
    (candidate) => candidate.action.type === "trade",
  );
  const harborStone = trades.find(
    (candidate) =>
      candidate.action.type === "trade" &&
      candidate.action.target === harbor.id &&
      candidate.action.resources.stone,
  )!;
  const coveTimber = trades.find(
    (candidate) =>
      candidate.action.type === "trade" &&
      candidate.action.target === cove.id &&
      candidate.action.resources.timber,
  )!;
  assert.equal(harborStone.status, "ready");
  assert.equal(coveTimber.status, "ready");
  assert.ok(!harborStone.blockers.includes("EXECUTOR_QUEUE_BUSY"));
  assert.ok(!coveTimber.blockers.includes("EXECUTOR_QUEUE_BUSY"));
});

test("uncertain trade submissions retry with the same idempotent action", async () => {
  const x = await setup();
  const capital = x.c.state.villages[0]!;
  const economic = structuredClone(capital);
  economic.id = "v2";
  economic.name = "Harbor";
  economic.storage = 5000;
  economic.resources = { timber: 0, stone: 0, iron: 0 };
  economic.resourcesMilli = { timber: 0, stone: 0, iron: 0 };
  x.c.state.villages.push(economic);
  x.c.state.world.villages = 2;
  capital.storage = 100000;
  capital.resources = { timber: 10000, stone: 10000, iron: 10000 };
  capital.resourcesMilli = { timber: 10000000, stone: 10000000, iron: 10000000 };
  capital.merchants = { total: 10, available: 10 };
  for (const option of capital.options.build) {
    option.ok = false;
    option.blockers = ["MAX_LEVEL"];
  }
  await x.controller.cycle();
  await x.controller.setAutomatic(true);
  x.failNext();
  await x.controller.cycle();
  const first = structuredClone(x.writes[0]?.[0]);
  assert.equal(first?.type, "trade");
  assert.equal(x.storage.value?.pending?.phase, "uncertain");
  x.advance();
  await x.controller.cycle();
  assert.equal(x.writes.length, 2);
  assert.deepEqual(x.writes[1]?.[0], first);
});

test("a pre-submit journal persistence failure prevents the write",async()=>{
 const x=await setup();await x.controller.cycle();await x.controller.setAutomatic(true);
 x.storage.failAt=x.storage.saves+2;await x.controller.cycle();
 assert.equal(x.writes.length,0);assert.ok(x.controller.snapshot().error?.includes("persistence"));
 await x.controller.cycle();assert.equal(x.writes.length,0);
});

test("a post-submit persistence failure faults and halts later writes",async()=>{
 const x=await setup();await x.controller.cycle();await x.controller.setAutomatic(true);
 x.storage.failAt=x.storage.saves+3;await x.controller.cycle();
 assert.equal(x.writes.length,1);assert.equal(x.controller.snapshot().automatic,false);
 assert.ok(x.controller.snapshot().error?.includes("persistence"));
 await x.controller.cycle();assert.equal(x.writes.length,1);
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
  assert.equal(pending.action.type, "build");
  if (pending.action.type !== "build") throw new Error("Expected build");
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
  if (p.action.type !== "build") throw new Error("Expected build");
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
  assert.match(x.controller.snapshot().error ?? "", /persistence failed/i);
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

test("an operator pause survives service restart", async () => {
  const x = await setup();
  await x.controller.cycle();
  await x.controller.setAutomatic(true);
  await x.controller.setAutomatic(false);
  const restarted = await Controller.create(
    x.storage,
    settings,
    x.request,
    () => 10000,
  );
  await restarted.cycle();
  assert.equal(restarted.snapshot().automatic, false);
  assert.equal(x.writes.length, 0);
});

test("fresh revalidation stops spending when round completion no longer fits", async () => {
  const x = await setup();
  x.c.state.world.endsAtTick = 110;
  x.c.state.villages[0].population.used=200;
  for (const o of x.c.state.villages[0].options.build) o.ticks = 5;
  let reads = 0;
  const remote: Remote = async <T>(
    settings: Settings,
    path: string,
    body?: unknown,
  ) => {
    if (path.endsWith("/state") && ++reads === 2) x.c.state.world.tick = 109;
    return x.request<T>(settings, path, body);
  };
  const controller = await Controller.create(
    x.storage,
    settings,
    remote,
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
      .proposals.some((p) => p.blockers.includes("ROUND_END_TOO_SOON")),
  );
});

test("Military Advisor uses the durable shared executor and confirms its first Barracks", async () => {
  const x = await setup(),
    v = x.c.state.villages[0];
  completeOpening(x.c);
  for (const producer of ["mine", "quarry", "lumberyard"] as const) {
    v.buildings[producer] = 12;
    v.options.build.find(option => option.building === producer)!.level = 13;
  }
  v.buildings.hall = 5;
  v.hidden = 1000;
  await x.controller.cycle();
  assert.equal(x.controller.snapshot().selection.selected?.advisor, "military");
  await x.controller.setAutomatic(true);
  await x.controller.cycle();
  assert.equal(x.writes.length, 1);
  assert.equal(
    (x.writes[0][0] as Extract<Action, { type: "build" }>).building,
    "barracks",
  );
  assert.equal(x.storage.value?.pending?.proposal.advisor, "military");
  v.buildQueue = [];
  v.buildings.barracks = 1;
  await x.controller.setAutomatic(false);
  await x.controller.cycle();
  assert.ok(
    x.controller
      .snapshot()
      .decisions.some(
        (d) => d.kind === "confirmed" && d.text.includes("Barracks"),
      ),
  );
  assert.equal(x.writes.length, 1);
});

test("fresh military revalidation catches a lost prerequisite before spending", async () => {
  const x = await setup(),
    v = x.c.state.villages[0];
  completeOpening(x.c);
  for (const producer of ["mine", "quarry", "lumberyard"] as const) {
    v.buildings[producer] = 12;
    v.options.build.find(option => option.building === producer)!.level = 13;
  }
  v.buildings.hall = 5;
  v.hidden = 1000;
  let reads = 0;
  const remote: Remote = async <T>(s: Settings, p: string, b?: unknown) => {
    if (p.endsWith("/state") && ++reads === 2) {
      v.buildings.hall = 2;
      // Keep the queue occupied by an operator as well, so no alternate build is sent.
      v.orders.build = [{ building: "hall", toLevel: 3 }];
    }
    return x.request<T>(s, p, b);
  };
  const controller = await Controller.create(
    x.storage,
    settings,
    remote,
    Date.now,
    { execute: false },
  );
  await controller.cycle();
  reads = 0;
  await controller.setAutomatic(true);
  await controller.cycle();
  assert.equal(x.writes.length, 0);
  assert.equal(
    controller.snapshot().proposals.find((p) => p.advisor === "military")
      ?.status,
    "not-needed",
  );
});

test("fresh revalidation stops a producer whose payback crosses round end while its build still fits", async () => {
  const x = await setup();
  x.c.state.world.endsAtTick = 724;
  x.c.state.villages[0].hidden = 1000;
  let reads = 0;
  const remote: Remote = async <T>(
    s: Settings,
    path: string,
    body?: unknown,
  ) => {
    if (path.endsWith("/state") && ++reads === 2) x.c.state.world.tick = 103;
    return x.request<T>(s, path, body);
  };
  const controller = await Controller.create(
    x.storage,
    settings,
    remote,
    Date.now,
    { execute: false },
  );
  await controller.cycle();
  const selected = controller.snapshot().selection.selected;
  assert.equal(selected?.action.type, "build");
  assert.ok(selected?.action.type === "build");
  assert.equal(selected.action.building, "lumberyard");
  reads = 0;
  await controller.setAutomatic(true);
  await controller.cycle();
  assert.equal(x.writes.length, 0);
  const p = controller
    .snapshot()
    .proposals.find(
      (p) => p.action.type === "build" && p.action.building === "lumberyard",
    )!;
  assert.ok(p.blockers.includes("NO_PAYBACK_BEFORE_ROUND_END"));
  assert.ok(!p.blockers.includes("ROUND_END_TOO_SOON"));
});

function allowRecruitment(x: Awaited<ReturnType<typeof setup>>) {
  const v = x.c.state.villages[0];
  completeOpening(x.c);
  for (const producer of ["mine", "quarry", "lumberyard"] as const) {
    v.buildings[producer] = 12;
    v.options.build.find(option => option.building === producer)!.level = 13;
  }
  v.buildings.hall = 5;
  v.buildings.smithy = 1;
  v.buildings.barracks = 3;
  v.hidden = 1000;
  v.options.train = [
    {
      unit: "pikeman",
      cost: { timber: 45, stone: 35, iron: 15 },
      ticksEach: 8,
      pop: 1,
      maxCount: 20,
      ok: true,
      blockers: [],
      affordableAtTick: null,
    },
  ];
}
test("training is journalled, accepted once and confirmed after the batch finishes", async () => {
  const x = await setup();
  allowRecruitment(x);
  x.c.state.villages[0].orders.build = [{building:"hall",toLevel:10}]; // Isolate recruitment while manual construction owns its queue.
  const save = x.storage.save.bind(x.storage);
  let prepared = false;
  x.storage.save = async (v) => {
    if (v.pending?.phase === "prepared") prepared = true;
    await save(v);
  };
  await x.controller.cycle();
  await x.controller.setAutomatic(true);
  await x.controller.cycle();
  assert.equal(prepared, true);
  assert.equal(x.writes[0][0].type, "train");
  assert.equal(x.storage.value?.pending?.phase, "accepted");
  await x.controller.setAutomatic(false);
  await x.controller.cycle();
  assert.equal(x.writes.length, 1);
  const v = x.c.state.villages[0];
  v.training.barracks = [];
  v.units.away.pikeman = (x.writes[0]![0] as Extract<Action, {type: "train"}>).count;
  await x.controller.setAutomatic(false);
  await x.controller.cycle();
  assert.equal(x.controller.snapshot().pending, null);
  assert.ok(
    x.controller
      .snapshot()
      .decisions.some(
        (d) => d.kind === "confirmed" && d.text.includes("training"),
      ),
  );
});
test("uncertain training survives restart and retries the identical batch ID and count", async () => {
  const x = await setup();
  allowRecruitment(x);
  x.c.state.villages[0].orders.build = [{building:"hall",toLevel:10}]; // Isolate recruitment while manual construction owns its queue.
  await x.controller.cycle();
  await x.controller.setAutomatic(true);
  x.failNext();
  await x.controller.cycle();
  const first = structuredClone(x.writes[0]);
  const restarted = await Controller.create(
    x.storage,
    settings,
    x.request,
    () => 10000,
  );
  await restarted.cycle();
  assert.deepEqual(x.writes[1], first);
  assert.equal(restarted.snapshot().pending?.phase, "accepted");
});
test("observed training suppresses an uncertain replay; disappearance is not false confirmation", async () => {
  const x = await setup();
  allowRecruitment(x);
  x.c.state.villages[0].orders.build = [{building:"hall",toLevel:10}]; // Isolate recruitment while manual construction owns its queue.
  await x.controller.cycle();
  await x.controller.setAutomatic(true);
  x.failNext();
  await x.controller.cycle();
  x.c.state.villages[0].training.barracks = [
    {
      id: "observed",
      unit: "pikeman",
      count: 5,
      remaining: 5,
      costEach: { timber: 45, stone: 35, iron: 15 },
      nextTick: 108,
      endTick: 140,
    },
  ];
  x.advance();
  await x.controller.cycle();
  assert.equal(x.writes.length, 1);
  assert.equal(x.controller.snapshot().pending, null);
  x.c.state.villages[0].training.barracks = [];
  await x.controller.cycle();
  assert.equal(x.writes.length, 2);
  x.c.state.villages[0].training.barracks = [];
  await x.controller.setAutomatic(false);
  await x.controller.cycle();
  assert.ok(
    x.controller
      .snapshot()
      .decisions.some(
        (d) => d.kind === "cancelled" && d.text.includes("training"),
      ),
  );
  assert.ok(
    !x.controller.snapshot().decisions.some((d) => d.kind === "confirmed"),
  );
});
test("fresh recruitment revalidation rejects lost population before the write", async () => {
  const x = await setup();
  allowRecruitment(x);
  let reads = 0;
  const remote: Remote = async <T>(s: Settings, p: string, b?: unknown) => {
    if (p.endsWith("/state") && ++reads === 2) {
      x.c.state.villages[0].population.used = 200;
      x.c.state.villages[0].orders.build = [{ building: "farm", toLevel: 2 }];
    }
    return x.request<T>(s, p, b);
  };
  const c = await Controller.create(x.storage, settings, remote, Date.now, {
    execute: false,
  });
  await c.cycle();
  reads = 0;
  await c.setAutomatic(true);
  await c.cycle();
  assert.equal(x.writes.length, 0);
});

test("uncertain training expiry pauses execution and a new world never replays it", async () => {
  const x = await setup();
  allowRecruitment(x);
  await x.controller.cycle();
  await x.controller.setAutomatic(true);
  x.failNext();
  await x.controller.cycle();
  x.c.state.world.tick = x.controller.snapshot().pending!.expiresTick;
  x.advance();
  await x.controller.cycle();
  assert.equal(x.controller.snapshot().automatic, false);
  assert.equal(x.writes.length, 1);
  x.c.state.world.epoch = "new-round";
  for (let i = 0; i < 6; i++) x.advance();
  await x.controller.cycle();
  assert.equal(x.controller.snapshot().pending, null);
  assert.equal(x.writes.length, 1);
});
test("training HTTP 429 retains payload through backoff; per-action rejection remains visible", async () => {
  const x = await setup();
  allowRecruitment(x);
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
  assert.deepEqual(x.writes[1], first);
  const y = await setup();
  allowRecruitment(y);
  const remote: Remote = async <T>(s: Settings, p: string, b?: unknown) =>
    p.endsWith("/actions")
      ? ({
          tick: 100,
          results: [
            {
              ok: false,
              type: "train",
              error: { code: "POPULATION_FULL", message: "Population changed" },
            },
          ],
        } as T)
      : y.request<T>(s, p, b);
  const c = await Controller.create(y.storage, settings, remote, Date.now, {
    execute: false,
  });
  await c.cycle();
  await c.setAutomatic(true);
  await c.cycle();
  assert.equal(c.snapshot().pending, null);
  assert.ok(
    c
      .snapshot()
      .decisions.some(
        (d) => d.kind === "rejected" && d.text.includes("POPULATION_FULL"),
      ),
  );
  assert.ok(!c.snapshot().decisions.some((d) => d.kind === "accepted"));
});

test("one-second idle cycles refresh state without repeatedly fetching metadata or unchanged rules", async () => {
  const x = await setup();
  const calls: string[] = [];
  const remote: Remote = async <T>(s: Settings, p: string, b?: unknown) => {
    calls.push(p);
    return x.request<T>(s, p, b);
  };
  const controller = await Controller.create(
    x.storage,
    settings,
    remote,
    () => 0,
    { execute: false },
  );
  for (let i = 0; i < 12; i++) await controller.cycle();
  assert.equal(calls.filter((p) => p === "/me").length, 1);
  assert.equal(calls.filter((p) => p === "/worlds").length, 1);
  assert.equal(calls.filter((p) => p.endsWith("/rules")).length, 1);
  assert.equal(calls.filter((p) => p.endsWith("/state")).length, 12);
  x.c.state.world.epoch = "next-round";
  await controller.cycle();
  assert.equal(calls.filter((p) => p.endsWith("/rules")).length, 2);
});
test("version changes invalidate rule cache and metadata refreshes at its bounded TTL", async () => {
  const x = await setup();
  let now = 0;
  const calls: string[] = [];
  const remote: Remote = async <T>(s: Settings, p: string, b?: unknown) => {
    calls.push(p);
    return x.request<T>(s, p, b);
  };
  const controller = await Controller.create(
    x.storage,
    settings,
    remote,
    () => now,
    { execute: false },
  );
  await controller.cycle();
  x.c.state.world.rulesVersion++;
  x.c.rules.version++;
  now = 31000;
  await controller.cycle();
  assert.equal(calls.filter((p) => p === "/me").length, 2);
  assert.equal(calls.filter((p) => p.endsWith("/rules")).length, 2);
});

test("accepted construction and training run concurrently, survive paused restart and confirm independently", async()=>{
 const x=await setup();allowRecruitment(x);
 await x.controller.cycle();await x.controller.setAutomatic(true);await x.controller.cycle();
 await x.controller.cycle();await x.controller.cycle();
 assert.ok(x.writes.flat().some(action=>action.type==="train"));
 assert.ok(x.writes.flat().some(action=>action.type==="build"));
 assert.equal(x.storage.value!.active!.length,2);
 await x.controller.setAutomatic(false);
 const restarted=await Controller.create(x.storage,settings,x.request,()=>10000);
 await restarted.cycle();assert.equal(restarted.snapshot().automatic,false);assert.equal(restarted.snapshot().active!.length,2);
 const build=x.storage.value!.active!.find(p=>p.action.type==="build")!;
 if(build.action.type==="build")x.c.state.villages[0].buildings[build.action.building]=build.proposal.targetLevel;
 x.c.state.villages[0].buildQueue=[];x.c.state.villages[0].training.barracks=[];
 x.c.state.villages[0].units.away.pikeman=x.writes.flat().filter((a):a is Extract<Action,{type:"train"}>=>a.type==="train"&&a.unit==="pikeman").reduce((sum,a)=>sum+a.count,0);
 await restarted.cycle();assert.equal(restarted.snapshot().active!.length,0);assert.equal(restarted.snapshot().pending,null);
 assert.equal(x.writes.length,2);
 assert.equal(restarted.snapshot().decisions.filter(d=>d.kind==="confirmed").length,2);
});

test("recall is journalled and accepted with a per-action result", async () => {
  const x = await setup();
  const capital = x.c.state.villages[0]!;
  const city = structuredClone(capital);
  city.id = "v2"; city.name = "Captured";
  city.supportHere = [{
    home: {id: capital.id, name: capital.name}, units: {raider: 12},
  }] as typeof city.supportHere;
  x.c.state.villages.push(city);
  x.c.state.world.villages = 2;
  await x.controller.cycle();
  await x.controller.setAutomatic(true);
  await x.controller.cycle();
  await x.controller.cycle();
  const action = x.writes.flat().find(value => value.type === "recall");
  assert.deepEqual(action, {type:"recall",village:"v2",home:capital.id,units:{raider:12},clientId:action?.clientId});
  assert.ok(x.storage.value?.active?.some(value => value.action.type === "recall"));
});
