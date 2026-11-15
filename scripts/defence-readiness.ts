/** Offline only. Read the supplied redacted evidence; never loads private client settings. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defenceReadiness } from "../src/review/defence-readiness.js";

const directory = process.argv[2];
if (!directory || process.argv.length !== 3) throw new Error("Usage: node --import tsx scripts/defence-readiness.ts <redacted-evidence-directory>");
const [state, rules, reports] = await Promise.all(["state", "rules", "reports"].map(async name => {
  const data = JSON.parse(await readFile(resolve(directory, `${name}.json`), "utf8"));
  if (data.collectionError) throw new Error(`Evidence unavailable: ${name}`);
  return data;
}));
console.log(JSON.stringify(defenceReadiness(state, rules, reports), null, 2));
