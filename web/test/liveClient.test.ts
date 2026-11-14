// The live client against a fake server: fetch and WebSocket are replaced, nothing leaves the process.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { LiveWorldClient } from "../src/world/liveClient";
import { state, summary } from "./fixtures";

type Route = (path: string, key: string | null) => { status: number; body?: unknown } | undefined;

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {}
  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  serverClose(code: number) {
    this.onclose?.({ code });
  }
}

let requests: string[] = [];
let route: Route = () => undefined;
const saved = { fetch: globalThis.fetch, WebSocket: (globalThis as { WebSocket?: unknown }).WebSocket, location: (globalThis as { location?: unknown }).location };

beforeEach(() => {
  requests = [];
  FakeSocket.all = [];
  const g = globalThis as Record<string, unknown>;
  g.location = { protocol: "http:", host: "steward.test" };
  g.WebSocket = FakeSocket;
  g.fetch = async (url: string, init: RequestInit) => {
    const path = url.replace(/^\/api\/v1/, "");
    const auth = (init.headers as Record<string, string>).Authorization ?? null;
    requests.push(path);
    const answer = route(path, auth ? auth.replace(/^Bearer /, "") : null) ?? { status: 404, body: { error: { code: "NOT_FOUND", message: "No such thing." } } };
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status });
  };
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  g.fetch = saved.fetch;
  g.WebSocket = saved.WebSocket;
  g.location = saved.location;
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const ok = (body: unknown) => ({ status: 200, body });

test("joining a new round on the stream reloads the player's history and reports", async () => {
  let epoch = "r1.0";
  let joined = true;
  route = (path) => {
    if (path === "/worlds/tiny") return ok(summary({ epoch }));
    if (path === "/worlds/tiny/map") return ok({ size: 40, snapshotTick: 0, villages: [], players: [] });
    if (path === "/worlds/tiny/leaderboard") return ok({ entries: [] });
    if (path === "/me") return ok({ account: { id: "a1", name: "ironwright" }, worlds: [], sandboxes: [] });
    if (path === "/worlds/tiny/state") return joined ? ok(state()) : { status: 409, body: { error: { code: "NOT_IN_WORLD", message: "Join first." } } };
    if (path.startsWith("/worlds/tiny/activity")) return ok({ entries: [] });
    if (path === "/worlds/tiny/history") return ok({ samples: epoch === "r1.0" ? [{ tick: 60 }, { tick: 120 }] : [] });
    if (path.startsWith("/worlds/tiny/reports")) return ok({ reports: [], next: null });
    return undefined;
  };
  const client = new LiveWorldClient("tiny", "nsk_key");
  client.start();
  await settle();
  const socket = FakeSocket.all[0]!;
  socket.emit({ type: "welcome", world: summary({ epoch }), authenticated: true, playerId: "p1", channels: ["state"] });
  await settle();
  assert.equal(client.store.get().history.length, 2);

  // Round 2: the player must join again.
  epoch = "r2.0";
  joined = false;
  socket.emit({ type: "round", round: 2, status: "running", epoch });
  await settle();
  assert.equal(client.store.get().state, null);
  assert.deepEqual(client.store.get().history, [], "round 1's samples are gone");

  requests = [];
  joined = true;
  socket.emit({ type: "state", state: state({ playerId: "p1" }) });
  await settle();
  assert.ok(requests.includes("/worlds/tiny/history"), `history re-read: ${requests.join(", ")}`);
  assert.ok(requests.some((r) => r.startsWith("/worlds/tiny/reports")), "reports re-read");
  client.stop();
});

test("a world deleted while watched shows as gone and stops reconnecting", async () => {
  let exists = true;
  route = (path) => {
    if (!exists) return undefined;
    if (path === "/worlds/sb-1") return ok(summary({ id: "sb-1", kind: "sandbox" }));
    if (path === "/worlds/sb-1/map") return ok({ size: 40, snapshotTick: 0, villages: [], players: [] });
    if (path === "/worlds/sb-1/leaderboard") return ok({ entries: [] });
    return undefined;
  };
  const client = new LiveWorldClient("sb-1", null);
  client.start();
  await settle();
  FakeSocket.all[0]!.emit({ type: "welcome", world: summary({ id: "sb-1", kind: "sandbox" }), authenticated: false, playerId: null, channels: [] });
  assert.ok(client.store.get().summary);

  exists = false;
  FakeSocket.all[0]!.emit({ type: "error", error: { code: "NOT_FOUND", message: "No such world." } });
  FakeSocket.all[0]!.serverClose(4004);
  await settle();
  const view = client.store.get();
  assert.equal(view.summary, null, "the dead world's bar and panel go");
  assert.ok(view.fatal, "the page says it can't be shown");
  assert.equal(view.notice, null);
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(FakeSocket.all.length, 1, "no reconnect loop");
  client.stop();
});

test("a dropped connection still reconnects", async () => {
  route = (path) => (path === "/worlds/tiny" ? ok(summary()) : path.endsWith("/map") ? ok({ size: 40, snapshotTick: 0, villages: [], players: [] }) : path.endsWith("/leaderboard") ? ok({ entries: [] }) : undefined);
  const client = new LiveWorldClient("tiny", null);
  client.start();
  await settle();
  FakeSocket.all[0]!.serverClose(1006);
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(FakeSocket.all.length, 2);
  client.stop();
});

test("manual commands apply server state, expose rejected actions, and cannot replace a newer stream state", async () => {
  let result = state({tick:10});
  route = path => path.endsWith("/actions") ? ok({tick:result.world.tick,results:[{ok:false,type:"build",error:{code:"QUEUE_FULL",message:"Queue full"}}],state:result}) : undefined;
  const client = new LiveWorldClient("tiny", "nsk_key");
  const response = await client.act([{type:"build",village:"v1",building:"hall",clientId:"ui-1"}]);
  assert.equal(response.results[0].ok, false);
  assert.equal(client.store.get().state?.world.tick, 10);
  result = state({tick:9});
  await client.act([{type:"build",village:"v1",building:"hall",clientId:"ui-2"}]);
  assert.equal(client.store.get().state?.world.tick, 10, "older response can't rewind state");
  result = state({world:summary({epoch:"old-round",tick:100})});
  await client.act([{type:"build",village:"v1",building:"hall",clientId:"ui-3"}]);
  assert.equal(client.store.get().state?.world.tick, 10, "old epoch can't replace current state");
  client.stop();
  result = state({tick:11});
  await client.act([{type:"build",village:"v1",building:"hall",clientId:"ui-4"}]);
  assert.equal(client.store.get().state?.world.tick, 10, "unmounted client isn't updated");
  await assert.rejects(new LiveWorldClient("tiny",null).act([]), /Connect your key/);
});

test("manual join founds the player's view through the normal join endpoint", async () => {
  route = path => {
    if (path === "/worlds/tiny/join" || path === "/worlds/tiny/state") return ok(state());
    if (path === "/me") return ok({worlds:[],sandboxes:[]});
    if (path.includes("/activity")) return ok({entries:[]});
    if (path.endsWith("/history")) return ok({samples:[]});
    if (path.includes("/reports")) return ok({reports:[],next:null});
    return undefined;
  };
  const client = new LiveWorldClient("tiny", "nsk_key");
  await client.join();
  assert.equal(client.store.get().playerId, "p1");
  assert.equal(client.store.get().authenticated, true);
  assert.ok(requests.includes("/worlds/tiny/join"));
  client.stop();
});
