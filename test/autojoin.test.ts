import assert from "node:assert/strict";
import { test } from "node:test";
import { Controller } from "../src/control/controller.js";
import { RemoteError, type Remote } from "../src/control/remote.js";
import type { SavedControl } from "../src/control/types.js";
import { context } from "./control-fixtures.js";

async function setup(execute = true) {
  const c = context();
  let member = false,
    joins = 0,
    now = 0,
    fail: RemoteError | null = null;
  let empty = false;
  let appliedBeforeFailure = false;
  const request: Remote = async <T>(_settings: unknown, path: string) => {
    if (path === "/me")
      return {
        account: { id: "a", name: "Tester" },
        worlds: [],
        sandboxes: [],
      } as T;
    if (path === "/worlds") return [c.state.world] as T;
    if (path.endsWith("/rules")) return c.rules as T;
    if (path.endsWith("/history")) return { samples: [] } as T;
    if (path.endsWith("/join")) {
      joins++;
      if (fail) {
        const error = fail;
        fail = null;
        if (appliedBeforeFailure) member = true;
        throw error;
      }
      member = true;
      return c.state as T;
    }
    if (path.endsWith("/state")) {
      if (!member) {
        if (empty) return { ...c.state, villages: [] } as T;
        throw new RemoteError(409, 5000, "Join first", "NOT_IN_WORLD");
      }
      return c.state as T;
    }
    throw new Error("Unexpected gameplay action");
  };
  // Standing orders prevent construction; these tests exercise joining only.
  c.state.villages[0].orders.build = [{ building: "farm", toLevel: 2 }];
  let saved: SavedControl | null = null;
  const controller = await Controller.create(
    {
      load: async () => saved,
      save: async (value) => {
        saved = structuredClone(value);
      },
    },
    { serverUrl: "https://game.test", apiKey: "test", worldId: "test" },
    request,
    () => now,
    { execute },
  );
  return {
    controller,
    c,
    get joins() {
      return joins;
    },
    leave: () => {
      member = false;
    },
    setEmpty: () => {
      empty = true;
    },
    failNext: (error: RemoteError, applied = false) => {
      fail = error;
      appliedBeforeFailure = applied;
    },
    advance: () => {
      now += 20000;
    },
  };
}
test("persistent executor joins once without a browser and rejoins after round rollover", async () => {
  const x = await setup();
  await Promise.all([x.controller.cycle(), x.controller.cycle()]);
  assert.equal(x.joins, 1);
  assert.equal(x.controller.snapshot().villages.length, 1);
  await x.controller.cycle();
  assert.equal(x.joins, 1);
  x.leave();
  x.c.state.world.epoch = "r2";
  x.c.state.world.round = 2;
  await x.controller.cycle();
  assert.equal(x.joins, 2);
  assert.ok(
    x.controller
      .snapshot()
      .decisions.some(
        (d) => d.kind === "confirmed" && d.text.includes("round 2"),
      ),
  );
});
test("zero villages automatically refounds through the same idempotent join endpoint", async () => {
  const x = await setup();
  x.setEmpty();
  await x.controller.cycle();
  assert.equal(x.joins, 1);
});
test("paused execution and ended or paused worlds do not join", async () => {
  const paused = await setup(false);
  await paused.controller.cycle();
  assert.equal(paused.joins, 0);
  for (const status of ["ended", "paused"] as const) {
    const x = await setup();
    x.c.state.world.status = status;
    await x.controller.cycle();
    assert.equal(x.joins, 0);
  }
});
test("join rate limits back off and retry only after refreshing membership", async () => {
  const x = await setup();
  x.failNext(new RemoteError(429, 20000, "Rate limited"));
  await x.controller.cycle();
  await x.controller.cycle();
  assert.equal(x.joins, 1);
  x.advance();
  await x.controller.cycle();
  assert.equal(x.joins, 2);
  assert.equal(x.controller.snapshot().connection, "connected");
});
test("an unrelated state error never triggers joining", async () => {
  const c = context();
  let joins = 0;
  const request: Remote = async <T>(_s: unknown, p: string) => {
    if (p === "/me") return { account: { id: "a" } } as T;
    if (p === "/worlds") return [c.state.world] as T;
    if (p.endsWith("/rules")) return c.rules as T;
    if (p.endsWith("/join")) joins++;
    throw new RemoteError(409, 5000, "Different conflict", "OTHER");
  };
  const controller = await Controller.create(
    { load: async () => null, save: async () => {} },
    { serverUrl: "https://game.test", worldId: "test", apiKey: "test" },
    request,
  );
  await controller.cycle();
  assert.equal(joins, 0);
});

test("HTTP transport retains the structured NOT_IN_WORLD code", async () => {
  const { createServer } = await import("node:http");
  const { remoteRequest } = await import("../src/control/remote.js");
  const server = createServer((_req, res) => {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: { code: "NOT_IN_WORLD", message: "Join first" },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(
      remoteRequest(
        {
          serverUrl: `http://127.0.0.1:${address.port}`,
          worldId: "test",
          apiKey: "test",
        },
        "/worlds/test/state",
      ),
      (error: unknown) =>
        error instanceof RemoteError &&
        error.status === 409 &&
        error.code === "NOT_IN_WORLD",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a timed-out join that succeeded is discovered by state refresh rather than repeated", async () => {
  const x = await setup();
  x.failNext(new RemoteError(0, 5000, "Outcome unknown"), true);
  await x.controller.cycle();
  assert.equal(x.joins, 1);
  x.advance();
  await x.controller.cycle();
  assert.equal(x.joins, 1);
  assert.equal(x.controller.snapshot().villages.length, 1);
});
