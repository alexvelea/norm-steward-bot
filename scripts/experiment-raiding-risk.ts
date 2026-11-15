/** Public, non-mutating authoritative combat probes. Explicit fixtures are not target intelligence. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import type { SimulateBattleRequest, SimulateBattleResponse } from "../src/shared/api.js";
const cases: { name: string; request: SimulateBattleRequest }[] = [
  { name: "unopposed-scouting", request: { attacker: { scout: 2 }, defender: {} } },
  { name: "one-defending-scout", request: { attacker: { scout: 2 }, defender: { scout: 1 } } },
  { name: "equal-defending-scouts", request: { attacker: { scout: 2 }, defender: { scout: 2 } } },
  { name: "unopposed-raiding-force", request: { attacker: { raider: 10 }, defender: {}, resources: { timber: 1000, stone: 1000, iron: 1000 }, hidden: 0 } },
  { name: "defended-raiding-target", request: { attacker: { raider: 10 }, defender: { pikeman: 10, shieldman: 5 }, resources: { timber: 1000, stone: 1000, iron: 1000 }, hidden: 0 } },
];
const results: { name: string; request: SimulateBattleRequest; battle: SimulateBattleResponse }[] = [];
const path = process.env.STEWARD_REVIEW_RUN! + "/raiding-risk.json";
try {
  for (const fixture of cases) {
    let response: Response;
    for (;;) {
      response = await fetch("https://norn-steward.velea.cc/api/v1/worlds/blitz-1/simulate/battle", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fixture.request),
      });
      if (response.status !== 429) break;
      const seconds = Number(response.headers.get("Retry-After") ?? "1");
      assert.ok(Number.isFinite(seconds) && seconds <= 60);
      await new Promise(resolve => setTimeout(resolve, Math.max(1, seconds) * 1000));
    }
    assert.equal(response.ok, true, `Simulator HTTP ${response.status}`);
    const battle = await response.json() as SimulateBattleResponse;
    results.push({ ...fixture, battle });
  }
  assert.equal(results[0].battle.scouting?.success, true);
  assert.equal(results[2].battle.scouting?.success, false);
  assert.equal(results[3].battle.winner, "attacker");
  assert.equal(results[4].battle.winner, "defender");
  await writeFile(path, JSON.stringify({ taskId: "scout-informed-raiding", passed: true,
    mode: "authoritative-server-simulation-no-gameplay-writes",
    limitation: "Explicit hypothetical defenders; no current enemy intelligence, no automatic target selection or measured live loot.", results }, null, 2));
  console.log(JSON.stringify(results));
} catch (error) {
  await writeFile(path, JSON.stringify({ taskId: "scout-informed-raiding", passed: false, error: String(error), results }, null, 2));
  throw error;
}
