// Run locally. Generated credentials never enter source, stdout, URLs or Git.
import { randomBytes, createHash } from "node:crypto";
import { mkdir, access, writeFile, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = resolve(process.env.STEWARD_CONTROL_DIR || resolve(project, "data/control"));
const digestPath = resolve(process.env.STEWARD_ACCESS_TOKEN_HASH_FILE || resolve(directory, "access-token.sha256"));
const tokenPath = resolve(directory, "access-token.txt");
if (!process.argv.includes("--rotate")) {
  for (const file of [digestPath, tokenPath]) {
    try {
      await access(file);
    } catch {
      continue;
    }
    throw new Error("An access token already exists. Use --rotate only when you intend to revoke access.");
  }
}
await mkdir(directory, { recursive: true, mode: 0o700 });
await mkdir(dirname(digestPath), { recursive: true, mode: 0o700 });
const token = randomBytes(32).toString("base64url");
const digest = createHash("sha256").update(token).digest("hex");
for (const [path, contents] of [
  [tokenPath, token + "\n"],
  [digestPath, digest + "\n"],
]) {
  const temporary = path + `.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}
console.log(`Private access token saved to ${tokenPath}`);
console.log(`Service digest saved to ${digestPath}`);
console.log("Read the token locally into your password manager. Restart the service after initialization or rotation.");
