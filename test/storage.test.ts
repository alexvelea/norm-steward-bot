import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, stat, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileControlStorage } from "../src/control/storage.js";

test("private settings and journal survive atomic saves without leaving temporary credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "steward-control-"));
  try {
    const storage = new FileControlStorage(directory);
    assert.equal(await storage.load(), null);
    const value = {
      settings: { apiKey: "fake-secret", worldId: "test", serverUrl: "https://game.test" },
      pending: null,
      decisions: [],
    };
    await storage.save(value);
    assert.deepEqual(await storage.load(), {
      ...value,
      active: [],
      automatic: true,
      missions: [],
      commitments: [],
      production: undefined,
      persistenceFault: undefined,
    });
    assert.equal((await stat(join(directory, "control.json"))).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(directory), ["control.json"]);
    await writeFile(join(directory, "control.json"), '{"apiKey":"do-not-echo-this-secret');
    await assert.rejects(
      storage.load(),
      (error) =>
        error instanceof Error &&
        !error.message.includes("do-not-echo-this-secret") &&
        error.message.includes("Private control state"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
