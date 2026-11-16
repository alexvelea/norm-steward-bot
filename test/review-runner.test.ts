import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { ReviewStore } from "../src/control/reviews.js";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
test("scheduled reviewer quota, lock, timeout, continuity and activation guards", () => {
  execFileSync("python3", ["-m", "unittest", "discover", "-s", "scripts/review", "-p", "test_*.py"], {
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
    await mkdir(join(dir,"experiments/jobs/one/baseline"),{recursive:true});
    await writeFile(join(dir,"experiments/jobs/one/job.json"),JSON.stringify({status:"running",hypothesis:"Later Walls",metric:"production",ticks:7200,privateKey:"must not escape"}));
    await writeFile(join(dir,"experiments/jobs/one/baseline/result.json"),JSON.stringify({lastTick:600}));
    const experiment=(await store.status()).experiments![0];
    assert.equal(experiment.status,"running");assert.match(experiment.progress,/baseline: 600\/7200/);assert.equal("privateKey" in experiment,false);
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
