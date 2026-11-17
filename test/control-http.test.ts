import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { Controller } from "../src/control/controller.js";
import { ControlHttp } from "../src/control/http.js";
import type { Remote } from "../src/control/remote.js";
import type { SavedControl, Settings } from "../src/control/types.js";
// @ts-expect-error The hosting utility is intentionally plain JavaScript.
import { createUiServer } from "../scripts/serve.mjs";

test("personal settings, keys and game proxy require authentication and same-origin writes", async () => {
  let saved: SavedControl | null = null;
  const request: Remote = async <T>(_s: Settings, _p: string, _b?: unknown): Promise<T> => {
    throw new Error("No live network in this test");
  };
  const controller = await Controller.create(
    {
      load: async () => saved,
      save: async (v) => {
        saved = structuredClone(v);
      },
    },
    { serverUrl: "https://game.test", worldId: "test", apiKey: "private-test-key" },
    request,
  );
  const server = createUiServer({ control: new ControlHttp(controller) });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + "/control/state")).status, 401);
    assert.equal((await fetch(base + "/api/v1/me")).status, 401);
    const login = await fetch(base + "/control/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "private-test-key" }),
    });
    assert.equal(login.status, 200);
    const text = await login.text();
    assert.ok(!text.includes("private-test-key"));
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const state = await fetch(base + "/control/state", { headers: { Cookie: cookie } });
    assert.equal(state.status, 200);
    assert.ok(!(await state.text()).includes('"apiKey"'));
    assert.equal(
      (
        await fetch(base + "/control/key", {
          method: "POST",
          headers: { Cookie: cookie, Origin: "https://other.test" },
          body: "{}",
        })
      ).status,
      403,
    );
    const reveal = await fetch(base + "/control/key", { method: "POST", headers: { Cookie: cookie }, body: "{}" });
    assert.deepEqual(await reveal.json(), { apiKey: "private-test-key" });
    assert.equal(
      (
        await fetch(base + "/api/v1/worlds/test/actions", {
          method: "POST",
          headers: { Cookie: cookie, Origin: "https://other.test" },
          body: "{}",
        })
      ).status,
      401,
    );
    const logout = await fetch(base + "/control/logout", { method: "POST", headers: { Cookie: cookie }, body: "{}" });
    assert.equal(logout.status, 200);
    assert.equal((await fetch(base + "/control/state", { headers: { Cookie: cookie } })).status, 401);
  } finally {
    await controller.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
