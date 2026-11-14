import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const exec = promisify(execFile);
test("token initialization keeps secrets private and refuses accidental rotation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "steward-token-"));
  const script = fileURLToPath(new URL("../scripts/access-token.mjs", import.meta.url));
  const env = { ...process.env, STEWARD_CONTROL_DIR: directory };
  try {
    const first = await exec(process.execPath, [script], { env });
    const token = (await readFile(join(directory, "access-token.txt"), "utf8")).trim();
    assert.equal(token.length, 43);
    assert.ok(!first.stdout.includes(token));
    assert.equal((await stat(join(directory, "access-token.txt"))).mode & 0o777, 0o600);
    assert.equal(
      (await readFile(join(directory, "access-token.sha256"), "utf8")).trim(),
      createHash("sha256").update(token).digest("hex"),
    );
    await assert.rejects(exec(process.execPath, [script], { env }));
    assert.equal((await readFile(join(directory, "access-token.txt"), "utf8")).trim(), token);
    await exec(process.execPath, [script, "--rotate"], { env });
    assert.notEqual((await readFile(join(directory, "access-token.txt"), "utf8")).trim(), token);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
