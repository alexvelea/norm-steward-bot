/** Isolated producer-decision A/B: actual costs/rates, private engine completion, exact payback boundary. */
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { PrivateSandbox } from "../src/review/sandbox-client.js";
import { productionPayback } from "../src/advisors/payback.js";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { selectProposal } from "../src/advisors/president.js";
const base = process.env.STEWARD_EXPERIMENT_BASE || "64a44fa";
const temp = await mkdtemp(tmpdir() + "/steward-payback-");
for (const file of ["economic", "hall", "types", "completion"])
  await writeFile(
    `${temp}/${file}.ts`,
    execFileSync("git", ["show", `${base}:src/advisors/${file}.ts`]),
  );
const { evaluateEconomy: baseline } = await import(
  pathToFileURL(temp + "/economic.ts").href
);
const results = [];
for (const offset of [-1, 0, 1])
  for (const policy of ["baseline", "candidate"]) {
    const s = new PrivateSandbox(73421, 1800);
    try {
      let state = s.join();
      const rules = s.rules(),
        v = state.villages[0],
        o = v.options.build.find((o) => o.building === "lumberyard")!;
      const p = productionPayback({
        cost: o.cost,
        stockMilli: v.resourcesMilli,
        ratesMilli: v.productionPerTickMilli,
        resource: "timber",
        currentLevel: v.buildings.lumberyard,
        targetLevel: o.level,
        production: rules.tables.production,
        tick: state.world.tick,
        endTick: 1800,
        buildTicks: o.ticks,
      });
      assert.ok(p.repaymentTicks !== null);
      const target = 1800 - o.ticks - p.repaymentTicks! + offset;
      state = s.step(target - state.world.tick);
      const before = structuredClone(state.villages[0]);
      const planning = {
        ...state,
        world: { ...state.world, status: "running" as const },
      };
      const proposal = (policy === "baseline" ? baseline : evaluateEconomy)({
        state: planning,
        rules,
      }).find((p: any) => p.action.building === "lumberyard")!;
      // Isolate this producer decision; support buildings retain separate policies.
      const selected = selectProposal([proposal]).selected;
      let spent = 0,
        extraMilli = 0;
      if (selected) {
        const response = s.act([selected.action]);
        assert.equal(response.results[0].ok, true);
        state = response.state!;
        const end = state.villages[0].buildQueue[0].endTick;
        state = s.step(end - state.world.tick);
        extraMilli =
          state.villages[0].productionPerTickMilli.timber -
          before.productionPerTickMilli.timber;
        assert.equal(extraMilli, p.extraPerTickMilli);
        spent = Object.values(proposal.requirements).reduce(
          (a: any, b: any) => a + b,
          0,
        );
      }
      const result = {
        policy,
        offset,
        worldId: s.world.id,
        tick: planning.world.tick,
        totalCost: p.totalCost,
        buildTicks: o.ticks,
        repaymentTicks: p.repaymentTicks,
        extraPerTickMilli: p.extraPerTickMilli,
        eligible: !!selected,
        spent,
        reason: proposal.reason,
        actualCompletedLevel: state.villages[0].buildings.lumberyard,
        actualExtraRateMilli: extraMilli,
      };
      results.push(result);
      console.log(JSON.stringify(result));
      if (policy === "candidate") assert.equal(!!selected, offset <= 0);
      else assert.equal(!!selected, true);
    } finally {
      s.close();
    }
  }
await writeFile(
  process.env.STEWARD_REVIEW_RUN! + "/payback-comparison.json",
  JSON.stringify(
    {
      baselineCommit: base,
      scope:
        "isolated lumberyard proposals; gross marginal production before overflow, not net inventory or whole-bot performance",
      results,
      passed: true,
    },
    null,
    2,
  ),
);
