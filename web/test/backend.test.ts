import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorldSummary } from "../src/contract";
import { ApiFailure } from "../src/lib/http";
import { installBackend, loadWorldList, type Backend } from "../src/world/backend";

const PUBLIC = [{ id: "tiny", name: "Tiny" } as WorldSummary];

function fakeBackend(listWorlds: Backend["listWorlds"]): Backend {
  const unused = () => {
    throw new Error("not used");
  };
  return { listWorlds, signup: unused, me: unused, rotateKey: unused, worldClient: unused };
}

test("a refused saved key still shows the public worlds, and says so", async () => {
  const asked: (string | null)[] = [];
  installBackend(
    fakeBackend(async (key) => {
      asked.push(key);
      if (key) throw new ApiFailure(401, { code: "UNAUTHORIZED", message: "That key isn't valid (rotated or mistyped)." } as never);
      return PUBLIC;
    }),
  );
  const list = await loadWorldList("nsk_AAAAAAAAAAAAAAAAAAAAAAAA");
  assert.deepEqual(list, { worlds: PUBLIC, keyRefused: true });
  assert.deepEqual(asked, ["nsk_AAAAAAAAAAAAAAAAAAAAAAAA", null]);
});

test("a good key lists as before; other failures still surface", async () => {
  installBackend(fakeBackend(async () => PUBLIC));
  assert.deepEqual(await loadWorldList("nsk_good"), { worlds: PUBLIC, keyRefused: false });
  installBackend(
    fakeBackend(async () => {
      throw new ApiFailure(0, { code: "VALIDATION", message: "The server can't be reached." } as never);
    }),
  );
  await assert.rejects(loadWorldList("nsk_good"), /can't be reached/);
  await assert.rejects(loadWorldList(null), /can't be reached/);
});
