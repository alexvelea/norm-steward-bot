import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
// @ts-expect-error The hosting utility is intentionally plain Node.js, without a TS build step.
import { createUiServer } from "../scripts/serve.mjs";

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test("serves deep UI routes and forwards authenticated REST/MCP unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-ui-test-"));
  await writeFile(join(root, "index.html"), "<h1>Personal dashboard</h1>");
  await writeFile(join(root, "app.js"), "console.log('dashboard');");
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ url: req.url, method: req.method, key: req.headers.authorization, dashboard: req.headers["x-steward-client"], body: Buffer.concat(chunks).toString() }));
  });
  const target = await listen(upstream);
  const ui = createUiServer({ root, upstream: target });
  const origin = await listen(ui);
  try {
    assert.match(await (await fetch(`${origin}/w/test-world`)).text(), /Personal dashboard/);
    const asset = await fetch(`${origin}/app.js`);
    assert.match(asset.headers.get("content-type")!, /javascript/);
    assert.equal((await fetch(`${origin}/missing.js`)).status, 404);
    const action = await fetch(`${origin}/api/v1/worlds/test/actions`, { method: "POST", headers: { Authorization: "Bearer test-only-key", "Content-Type": "application/json" }, body: '{"actions":[]}' });
    assert.deepEqual(await action.json(), { url: "/api/v1/worlds/test/actions", method: "POST", key: "Bearer test-only-key", body: '{"actions":[]}' });
    const read = await fetch(`${origin}/api/v1/worlds?after=5`, { headers: { "X-Steward-Client": "dashboard" } });
    assert.equal(((await read.json()) as { dashboard: string }).dashboard, "dashboard");
    const mcp = await fetch(`${origin}/mcp`, { method: "POST", body: "test-rpc" });
    assert.equal(((await mcp.json()) as { body: string }).body, "test-rpc");
  } finally {
    await close(ui);
    await close(upstream);
    await rm(root, { recursive: true, force: true });
  }
});

test("proxies the live WebSocket stream including client hello", async () => {
  const upstream = createServer();
  const sockets = new WebSocketServer({ server: upstream });
  sockets.on("connection", (socket, request) => {
    assert.equal(request.url, "/api/v1/worlds/test/stream");
    socket.on("message", payload => socket.send(payload.toString()));
  });
  const target = await listen(upstream);
  const ui = createUiServer({ upstream: target });
  const origin = await listen(ui);
  const client = new WebSocket(origin.replace("http:", "ws:") + "/api/v1/worlds/test/stream");
  try {
    await once(client, "open");
    const reply = once(client, "message");
    client.send('{"type":"hello","key":"test-only-key"}');
    assert.equal((await reply)[0].toString(), '{"type":"hello","key":"test-only-key"}');
  } finally {
    client.terminate();
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    await close(ui);
    await close(upstream);
  }
});
