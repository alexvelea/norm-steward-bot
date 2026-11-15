/** First Barracks comparison against the actual owner-only server; no live actions. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { PrivateSandbox } from "../src/review/sandbox-client.js";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { evaluateMilitary } from "../src/advisors/military.js";
import { selectProposal } from "../src/advisors/president.js";
import type { Action, StateResponse, RulesResponse } from "../src/shared/api.js";

const output = process.env.STEWARD_REVIEW_RUN! + "/military-comparison.json";
const results: unknown[] = [];
const planning = (state: StateResponse) => ({...state, world: {...state.world, status: "running" as const}});
const decide = (state: StateResponse, rules: RulesResponse, policy: string) =>
  selectProposal([...evaluateEconomy({state: planning(state), rules}), ...(policy === "candidate" ? evaluateMilitary({state: planning(state), rules}) : [])]);
async function save(passed: boolean, error?: string) {
  await writeFile(output, JSON.stringify({taskId: "military-infrastructure", baseline: "economic-only", candidate: "economic-plus-first-barracks", sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {encoding: "utf8"}).trim(), results, passed, error}, null, 2));
}
try {
  for (const scenario of ["useful", "too-late"])
    for (const policy of ["baseline", "candidate"]) {
      const s = new PrivateSandbox(73421, 3600);
      try {
        let state = s.join();
        const rules = s.rules();
        const warmup: unknown[] = [];
        function act(action: Action) {
          const response = s.act([action]);
          assert.equal(response.results[0].ok, true, JSON.stringify(response.results));
          state = response.state ?? s.state();
          return response;
        }
        function complete() {
          const end = Math.max(state.world.tick, ...state.villages[0].buildQueue.map((q) => q.endTick), state.player.nextActTick ?? 0);
          if (end > state.world.tick) state = s.step(end - state.world.tick);
        }
        const locked = evaluateMilitary({state: planning(state), rules})[0];
        assert.equal(locked.status, "not-needed");
        assert.notEqual(decide(state, rules, policy).selected?.action.building, "barracks");
        while (state.villages[0].buildings.hall < 3) {
          const o = state.villages[0].options.build.find((o) => o.building === "hall")!;
          const start = Math.max(state.world.tick, state.player.nextActTick ?? 0, o.affordableAtTick ?? 0);
          if (start > state.world.tick) state = s.step(start - state.world.tick);
          const response = act({type: "build", village: state.villages[0].id, building: "hall"});
          warmup.push({building: "hall", results: response.results});
          complete();
        }
        // Match ordinary urgent capacity/protection work for both policies before comparison.
        for (let i = 0; i < 12; i++) {
          const choice = decide(state, rules, "candidate");
          if (choice.selected?.advisor === "military") break;
          const top = choice.selected;
          if (!top) {
            const p = evaluateMilitary({state: planning(state), rules})[0];
            assert.equal(p.status, "waiting", JSON.stringify(p));
            assert.ok(p.affordableAtTick !== null && p.affordableAtTick > state.world.tick);
            state = s.step(p.affordableAtTick - state.world.tick);
          } else {
            warmup.push({building: top.action.building, results: act(top.action).results});
            complete();
          }
        }
        assert.equal(decide(state, rules, "candidate").selected?.action.building, "barracks", "Warmup must reach a feasible military selection");
        if (scenario === "too-late") {
          const ticks = state.villages[0].options.build.find((o) => o.building === "barracks")!.ticks;
          state = s.step(state.world.endsAtTick - ticks - 299 - state.world.tick);
        }
        const before = structuredClone(state.villages[0]);
        const tick = state.world.tick;
        const selection = decide(state, rules, policy);
        const military = evaluateMilitary({state: planning(state), rules})[0];
        let response;
        if (selection.selected) response = act(selection.selected.action);
        const afterSpend = structuredClone(state.villages[0]);
        complete();
        const result = {
          scenario, policy, worldId: s.world.id, tick, warmup,
          prerequisiteStatus: locked.status, selected: selection.selected?.action.building ?? null,
          militaryStatus: military.status, militaryBlockers: military.blockers,
          results: response?.results ?? [],
          resourceSpend: Object.fromEntries((["timber", "stone", "iron"] as const).map((r) => [r, (before.resourcesMilli[r] - afterSpend.resourcesMilli[r]) / 1000])),
          queue: afterSpend.buildQueue, completionTick: state.world.tick,
          buildingsBefore: before.buildings, buildingsAfter: state.villages[0].buildings,
          homeUnits: state.villages[0].units.home,
        };
        results.push(result);
        await save(false);
        console.log(JSON.stringify({scenario, policy, worldId: s.world.id, selected: result.selected, spend: result.resourceSpend, barracks: state.villages[0].buildings.barracks}));
        if (scenario === "useful") {
          assert.equal(result.selected === "barracks", policy === "candidate");
          assert.equal(state.villages[0].buildings.barracks, policy === "candidate" ? 1 : 0);
          if (policy === "candidate") assert.deepEqual(evaluateMilitary({state: planning(state), rules}), []);
        } else {
          assert.notEqual(result.selected, "barracks");
          assert.equal(military.status, "not-needed");
          assert.ok(military.blockers.includes("ROUND_END_TOO_SOON"));
        }
      } finally { s.close(); }
    }
  await save(true);
} catch (error) {
  await save(false, String(error));
  throw error;
}
