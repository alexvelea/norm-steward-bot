import assert from "node:assert/strict";
import { test } from "node:test";
import { apiGet, apiWrite, ApiFailure } from "../src/lib/http";
import type { ActionsResponse } from "../src/contract";

test("manual writes keep auth and idempotency, omit dashboard header, and expose per-action failures", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return new Response(
      JSON.stringify({ tick: 10, results: [{ ok: false, type: "build", error: { code: "QUEUE_FULL", message: "Queue full" } }] }),
      { status: 200 },
    );
  };
  try {
    const body = { actions: [{ type: "build", village: "v1", building: "hall", clientId: "ui-retry-1" }], returnState: true };
    const response = await apiWrite<ActionsResponse>("POST", "/worlds/tiny/actions", body, "test-key");
    assert.equal(response.results[0].ok, false);
    await apiWrite("POST", "/worlds/tiny/actions", body, "test-key");
    assert.equal(calls[0].url, "/api/v1/worlds/tiny/actions");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer test-key");
    assert.equal((calls[0].init.headers as Record<string, string>)["X-Steward-Client"], undefined);
    assert.equal(calls[0].init.body, calls[1].init.body);
    await apiGet("/worlds/tiny/state", "test-key");
    assert.equal((calls[2].init.headers as Record<string, string>)["X-Steward-Client"], "dashboard");
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "Wait for your turn" } }), { status: 429 });
    await assert.rejects(
      apiWrite("POST", "/worlds/tiny/actions", body, "test-key"),
      (error: unknown) => error instanceof ApiFailure && error.status === 429,
    );
  } finally {
    globalThis.fetch = original;
  }
});
