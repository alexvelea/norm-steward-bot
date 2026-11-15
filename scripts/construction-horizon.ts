/** Reads only redacted state evidence; no settings, credentials or network access. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { constructionHorizon } from "../src/review/construction-horizon.js";

if (process.argv.length !== 3) throw new Error("Usage: node --import tsx scripts/construction-horizon.ts <redacted-evidence-directory>");
const state = JSON.parse(await readFile(resolve(process.argv[2], "state.json"), "utf8"));
if (state.collectionError) throw new Error("Evidence unavailable: state");
console.log(JSON.stringify(constructionHorizon(state), null, 2));
