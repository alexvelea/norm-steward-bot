import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { ReviewStore } from "../src/control/reviews.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
test("scheduled reviewer quota, lock, timeout, continuity and activation guards", () => {
  execFileSync("python3", ["scripts/review/test_review.py"], {
    timeout: 15000,
    stdio: "pipe",
  });
});
test("review status exposes safe fields and a separate durable review pause", async () => {
  const dir = await mkdtemp(join(tmpdir(), "review-status-"));
  try {
    const store = new ReviewStore(dir);
    assert.equal((await store.status()).installed, false);
    await writeFile(join(dir, "installed.json"), "{}");
    await writeFile(
      join(dir, "state.json"),
      JSON.stringify({
        status: "idle",
        run: "/private/logs",
        latestReview: { summary: "Hall improvement" },
        usage: { available: false },
      }),
    );
    const paused = await store.pause(true);
    assert.equal(paused.paused, true);
    assert.equal(paused.installed, true);
    assert.equal("run" in paused, false);
    const reloaded = await new ReviewStore(dir).status();
    assert.equal(reloaded.paused, true);
    assert.equal((await store.pause(false)).paused, false);
    assert.equal((await store.status()).status, "idle");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
