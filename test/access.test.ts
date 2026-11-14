import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import { SiteAccess } from "../src/control/access.js";
// @ts-expect-error The hosting utility is intentionally plain JavaScript.
import { createUiServer } from "../scripts/serve.mjs";
const token = "synthetic-site-token-do-not-use";
const hash = createHash("sha256").update(token).digest("hex");

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "steward-access-"));
  await writeFile(join(root, "index.html"), "<h1>PRIVATE APPLICATION</h1>");
  await writeFile(join(root, "app.js"), "PRIVATE SCRIPT");
  let now = Date.now();
  const access = new SiteAccess(hash, () => now);
  const server = createUiServer({ root, access });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const login = async (value = token, headers: Record<string, string> = {}) =>
    fetch(base + "/access/login", {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams({ token: value }),
    });
  return {
    base,
    login,
    advance: () => {
      now += 8 * 86400000;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    },
  };
}
test("the entire app, assets and control API require the outer access token", async () => {
  const x = await setup();
  try {
    const root = await fetch(x.base + "/", { redirect: "manual" });
    assert.equal(root.status, 303);
    assert.equal(root.headers.get("location"), "/access/login");
    for (const path of ["/app.js", "/app.js.map", "/control/state", "/api/v1/me", "/mcp"]) {
      const r = await fetch(x.base + path, {
        redirect: "manual",
        headers: { Cookie: "steward_session=old-inner-cookie" },
      });
      assert.equal(r.status, 401, path);
      assert.ok(!(await r.text()).includes("PRIVATE"));
    }
    const page = await (await fetch(x.base + "/access/login")).text();
    assert.match(page, /name="token" type="password"/);
    assert.ok(!page.includes('name="username"'));
    assert.ok(!page.includes(token));
    assert.ok(!page.includes("PRIVATE APPLICATION"));
    assert.equal((await x.login("wrong")).status, 401);
    assert.equal((await x.login("game-api-key-is-not-the-site-token")).status, 401);
    const accepted = await x.login();
    assert.equal(accepted.status, 303);
    const cookie = accepted.headers.get("set-cookie")!.split(";")[0];
    assert.ok(!cookie.includes(token));
    assert.match(accepted.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
    assert.match(await (await fetch(x.base + "/", { headers: { Cookie: cookie } })).text(), /PRIVATE APPLICATION/);
    assert.match(await (await fetch(x.base + "/app.js", { headers: { Cookie: cookie } })).text(), /PRIVATE SCRIPT/);
    x.advance();
    assert.equal((await fetch(x.base + "/app.js", { headers: { Cookie: cookie } })).status, 401);
  } finally {
    await x.close();
  }
});
test("foreign-origin login is rejected, failures are throttled and a valid owner token still works", async () => {
  const x = await setup();
  try {
    assert.equal((await x.login(token, { Origin: "https://foreign.test" })).status, 403);
    for (let i = 0; i < 10; i++) assert.equal((await x.login("bad")).status, 401);
    const rate = await x.login("bad");
    assert.equal(rate.status, 429);
    assert.equal(rate.headers.get("retry-after"), "60");
    assert.equal((await x.login()).status, 303);
  } finally {
    await x.close();
  }
});
test("HTTPS cookies are secure and logout invalidates a copied access session", async () => {
  const x = await setup();
  try {
    const login = await x.login(token, { "X-Forwarded-Proto": "https" });
    assert.match(login.headers.get("set-cookie")!, /; Secure/);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const logout = await fetch(x.base + "/access/logout", {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: cookie },
    });
    assert.equal(logout.status, 303);
    assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/);
    assert.equal((await fetch(x.base + "/app.js", { headers: { Cookie: cookie } })).status, 401);
  } finally {
    await x.close();
  }
});
test("an unauthenticated WebSocket cannot bypass the site gate", async () => {
  const x = await setup();
  try {
    const client = new WebSocket(x.base.replace("http:", "ws:") + "/api/v1/worlds/test/stream");
    client.on("error", () => {});
    const [, response] = await once(client, "unexpected-response");
    assert.equal(response.statusCode, 401);
    client.terminate();
  } finally {
    await x.close();
  }
});
test("malformed access digests fail closed", () => {
  assert.throws(() => new SiteAccess("not-a-digest"), /Invalid site access digest/);
});

test("logging out also stops an already authenticated stream from forwarding private data", async () => {
  const { createServer } = await import("node:http");
  const { WebSocketServer } = await import("ws");
  const { Controller } = await import("../src/control/controller.js");
  const { ControlHttp } = await import("../src/control/http.js");
  const upstream = createServer();
  const sockets = new WebSocketServer({ server: upstream });
  sockets.on("connection", (socket) => socket.on("message", (data) => socket.send(data.toString())));
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const remote = upstream.address();
  assert.ok(remote && typeof remote !== "string");
  const target = `http://127.0.0.1:${remote.port}`;
  const controller = await Controller.create(
    { load: async () => null, save: async () => {} },
    { serverUrl: target, worldId: "test", apiKey: "fake-game-key" },
  );
  const server = createUiServer({
    access: new SiteAccess(hash),
    control: new ControlHttp(controller),
    upstream: target,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  let client: WebSocket | null = null;
  try {
    const outer = await fetch(base + "/access/login", {
      method: "POST",
      redirect: "manual",
      body: new URLSearchParams({ token }),
    });
    const outerCookie = outer.headers.get("set-cookie")!.split(";")[0];
    const inner = await fetch(base + "/control/session", {
      method: "POST",
      headers: { Cookie: outerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "fake-game-key" }),
    });
    assert.equal(inner.status, 200);
    const cookies = outerCookie + "; " + inner.headers.get("set-cookie")!.split(";")[0];
    client = new WebSocket(base.replace("http:", "ws:") + "/api/v1/worlds/test/stream", {
      headers: { Cookie: cookies },
    });
    await once(client, "open");
    const reply = once(client, "message");
    client.send(JSON.stringify({ type: "hello", key: "fake-game-key" }));
    await reply;
    const received: string[] = [];
    client.on("message", (data) => received.push(data.toString()));
    const closed = once(client, "close");
    await fetch(base + "/access/logout", { method: "POST", redirect: "manual", headers: { Cookie: cookies } });
    for (const socket of sockets.clients) socket.send("private-after-logout");
    const [code] = await closed;
    assert.equal(code, 1008);
    assert.deepEqual(received, []);
  } finally {
    client?.terminate();
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    controller.stop();
  }
});
