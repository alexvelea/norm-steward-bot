/** Reproduce end-of-round spending against the actual private sandbox engine. */
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { PrivateSandbox } from "../src/review/sandbox-client.js";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { selectProposal } from "../src/advisors/president.js";
const base = process.env.STEWARD_EXPERIMENT_BASE || "03a2a89";
const temp = await mkdtemp(tmpdir() + "/steward-completion-");
// The old evaluator imports Hall relatively; copy that exact baseline too.
for (const file of ["economic", "hall", "types"])
  await writeFile(
    `${temp}/${file}.ts`,
    execFileSync("git", ["show", `${base}:src/advisors/${file}.ts`]),
  );
// tsx resolves .js imports in the baseline source to these adjacent .ts snapshots.
const { evaluateEconomy: baseline } = await import(
  pathToFileURL(temp + "/economic.ts").href
);
const results = [];
for (const offset of [-1, 0, 1])
  for (const policy of ["baseline", "candidate"]) {
    const world = new PrivateSandbox(73421, 600);
    try {
      let state = world.join();
      const rules = world.rules();
      const chosen = selectProposal(
        baseline({
          state: { ...state, world: { ...state.world, status: "running" } },
          rules,
        }),
      ).selected!;
      const option = state.villages[0].options.build.find(
        (o) => o.building === chosen.action.building,
      )!;
      state = world.step(600 - option.ticks + offset);
      const planning = {
        ...state,
        world: { ...state.world, status: "running" as const },
      };
      const proposals = (policy === "baseline" ? baseline : evaluateEconomy)({
        state: planning,
        rules,
      });
      const selected = selectProposal(proposals).selected;
      const before = state.villages[0];
      let cost = 0,
        accepted = false;
      if (selected) {
        const response = world.act([selected.action]);
        assert.equal(response.results[0].ok, true);
        accepted = true;
        cost = Object.values(selected.requirements).reduce((a, b) => a + b, 0);
        state = response.state!;
      }
      const queued = state.villages[0].buildQueue.map((q) => ({
        building: q.building,
        endTick: q.endTick,
      }));
      state = world.step(600 - state.world.tick);
      const result = {
        policy,
        offset,
        duration: 600,
        worldId: world.world.id,
        startTick: planning.world.tick,
        selected: selected?.action.building || null,
        accepted,
        cost,
        queued,
        buildingsBefore: before.buildings,
        buildingsAfter: state.villages[0].buildings,
      };
      results.push(result);
      if (policy === "candidate" && offset > 0)
        assert.equal(accepted, false, "Guard must reject an overrun");
      if (offset <= 0)
        assert.equal(
          accepted,
          true,
          "A useful completion by round end must remain allowed",
        );
      console.log(JSON.stringify(result));
    } finally {
      world.close();
    }
  }
assert.ok(
  results.some(
    (r) => r.policy === "baseline" && r.queued.some((q) => q.endTick > 600),
  ),
  "Baseline must reproduce actual server-accepted overrun",
);
const output = process.env.STEWARD_REVIEW_RUN! + "/completion-comparison.json";
await writeFile(
  output,
  JSON.stringify({ baselineCommit: base, results, passed: true }, null, 2),
);
