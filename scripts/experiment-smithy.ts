/** Two President decisions from matched, already Hall-qualified private villages.
 * Candidate uses the real durable executor; the baseline omits only Smithy 1.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { PrivateSandbox, sandbox } from "../src/review/sandbox-client.js";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { evaluateMilitary } from "../src/advisors/military.js";
import { evaluateRecruitment } from "../src/advisors/recruitment.js";
import { evaluateDefensiveSmithy } from "../src/advisors/smithy.js";
import { selectProposal } from "../src/advisors/president.js";
import { Controller } from "../src/control/controller.js";
import type { Remote } from "../src/control/remote.js";
import type { SavedControl, Settings } from "../src/control/types.js";
import type { Action, ActionsResponse, RulesResponse, StateResponse } from "../src/shared/api.js";

const output = process.env.STEWARD_REVIEW_RUN! + "/smithy-comparison.json";
const results: Record<string, any>[] = [];
const planning = (s: StateResponse): StateResponse => ({ ...s, world: { ...s.world, status: "running" } });
function decide(state: StateResponse, rules: RulesResponse, policy: string) {
  const context = { state: planning(state), rules };
  return selectProposal([...evaluateEconomy(context), ...evaluateMilitary(context).filter(p => policy === "candidate" || p.action.building !== "smithy"), ...evaluateRecruitment(context)]);
}
async function save(passed: boolean, error?: string) {
  await writeFile(output, JSON.stringify({ taskId: "defensive-smithy-unlock", passed, error,
    baseline: "deployed-policy-without-smithy-purchase", candidate: "fully-funded-smithy-one-after-ten-pikemen",
    comparison: "two President decisions, then equal elapsed time; no combat claim", results }, null, 2));
}
try {
  for (const scenario of ["useful", "too-late"]) for (const policy of ["baseline", "candidate"]) {
    const s = new PrivateSandbox(73421, 3600);
    try {
      let state = s.join(); const rules = s.rules(); const warmup: unknown[] = [];
      function act(action: Action) {
        const response = s.act([action]);
        assert.equal(response.results[0].ok, true, JSON.stringify(response.results));
        state = response.state ?? s.state(); return response;
      }
      function stepTo(tick: number) { if (tick > state.world.tick) state = s.step(tick - state.world.tick); }
      function complete() {
        stepTo(Math.max(state.world.tick, state.player.nextActTick ?? 0, ...state.villages[0].buildQueue.map(q => q.endTick),
          ...Object.values(state.villages[0].training).flat().map(q => q.endTick)));
      }
      function build(building: Extract<Action, { type: "build" }>["building"]) {
        const option = state.villages[0].options.build.find(o => o.building === building)!;
        stepTo(Math.max(state.world.tick, state.player.nextActTick ?? 0, option.affordableAtTick ?? 0));
        warmup.push({ action: building, results: act({ type: "build", village: state.villages[0].id, building }).results }); complete();
      }
      for (const b of ["hall", "hall", "barracks", "hall", "hall", "cellar", "cellar", "cellar"] as const) build(b);
      stepTo(500);
      warmup.push({ action: "ten-pikemen", results: act({ type: "train", village: state.villages[0].id, unit: "pikeman", count: 10 }).results });
      complete(); stepTo(800);
      const buildOption = state.villages[0].options.build.find(o => o.building === "smithy")!;
      const trainOption = state.villages[0].options.train.find(o => o.unit === "shieldman")!;
      const first = decide(state, rules, "candidate").selected;
      assert.ok(first?.action.type === "build" && first.action.building === "smithy");
      if (scenario === "too-late") stepTo(state.world.endsAtTick - buildOption.ticks - 299);
      const initial = structuredClone(state);
      const deadline = initial.world.tick + buildOption.ticks + 5 * trainOption.ticksEach;
      const proposal = evaluateDefensiveSmithy({ state: planning(state), rules })[0];
      if (scenario === "too-late") {
        assert.equal(proposal.status, "not-needed");
        assert.ok(proposal.blockers.includes("ROUND_END_TOO_SOON"));
      }
      const charges: Record<string, any>[] = [];
      const selections: unknown[] = [];
      function record(action: Action, before: StateResponse, response: ActionsResponse) {
        assert.equal(response.results[0].ok, true, JSON.stringify(response.results));
        charges.push({ action, tick: before.world.tick, results: response.results,
          spend: Object.fromEntries((["timber", "stone", "iron"] as const).map(r => [r, (before.villages[0].resourcesMilli[r] - state.villages[0].resourcesMilli[r]) / 1000])) });
      }
      let saved: SavedControl | null = null;
      const storage = { load: async () => structuredClone(saved), save: async (v: SavedControl) => { saved = structuredClone(v); } };
      const settings: Settings = { serverUrl: "https://sandbox.invalid", worldId: s.world.id, apiKey: "sandbox-adapter-no-credential" };
      const remote: Remote = async <T>(_settings: Settings, path: string, body?: unknown): Promise<T> => {
        if (path === "/me") return { account: { id: state.player.id, name: "Sandbox owner", createdAt: "" }, worlds: [], sandboxes: [] } as T;
        if (path === "/worlds") return [planning(state).world] as T;
        if (path.endsWith("/rules")) return rules as T;
        if (path.endsWith("/history")) return { samples: [] } as T;
        if (path.endsWith("/state")) { state = s.state(); return planning(state) as T; }
        assert.ok(path.endsWith("/actions"));
        const action = (body as { actions: Action[] }).actions[0];
        assert.equal(saved?.pending?.action.clientId, action.clientId, "Journal must precede every server write");
        const before = structuredClone(state);
        const response = sandbox<ActionsResponse>({ op: "act", world: s.world.id, requestId: action.clientId, actions: [action] });
        state = response.state ?? s.state(); record(action, before, response); return response as T;
      };
      let controller = await Controller.create(storage, settings, remote, () => 1000, { execute: false });
      const confirmed: unknown[] = [];
      for (let i = 0; i < 2; i++) {
        const selected = decide(state, rules, policy).selected;
        selections.push(selected);
        if (!selected) break;
        if (scenario === "too-late") assert.ok(selected.action.type !== "build" || selected.action.building !== "smithy");
        if (policy === "candidate") {
          await controller.cycle(); await controller.setAutomatic(true); await controller.cycle();
          assert.equal(charges.length, i + 1, JSON.stringify(controller.snapshot()));
          assert.equal(saved!.pending?.phase, "accepted");
          const pendingId: string = saved!.pending!.action.clientId!;
          await controller.setAutomatic(false);
          // Restart while accepted, keeping the same pending ID and paused preference.
          controller = await Controller.create(storage, settings, remote, () => 2000);
          assert.equal(saved!.pending?.action.clientId, pendingId);
          assert.equal(controller.snapshot().automatic, false);
          complete(); await controller.cycle();
          assert.equal(saved!.pending, null);
          assert.equal(charges.length, i + 1, "Restart must not resubmit accepted work");
          assert.ok(controller.snapshot().decisions.some(d => d.kind === "confirmed" && d.clientId === pendingId));
          confirmed.push({ pendingId, journalBeforeWrite: true, restartConfirmed: true, duplicateSubmissions: 0 });
        } else {
          const before = structuredClone(state); const response = act(selected.action); record(selected.action, before, response); complete();
        }
      }
      const operationsCompleteTick = state.world.tick;
      stepTo(Math.max(deadline, state.world.tick));
      const final = state.villages[0];
      assert.equal(final.units.home.pikeman, 10);
      assert.equal(final.buildings.smithy, scenario === "useful" && policy === "candidate" ? 1 : 0);
      assert.equal(final.units.home.shieldman ?? 0, scenario === "useful" && policy === "candidate" ? 5 : 0);
      const result = { scenario, policy, worldId: s.world.id, initialTick: initial.world.tick, comparisonTick: state.world.tick,
        operationsCompleteTick, planningWorldStatus: "running", sandboxClockStatus: initial.world.status,
        initial: initial.villages[0], final, selections, proposal, warmup, charges, confirmed,
        totalSpend: Object.fromEntries((["timber", "stone", "iron"] as const).map(r => [r, charges.reduce((n, c) => n + c.spend[r], 0)])) };
      results.push(result); await save(false);
      console.log(JSON.stringify({ scenario, policy, worldId: s.world.id, tick: state.world.tick, operationsCompleteTick,
        actions: charges.map(c => c.action), totalSpend: result.totalSpend, population: final.population, troops: final.units.home }));
    } finally { s.close(); }
  }
  for (const scenario of ["useful", "too-late"]) {
    const [baseline, candidate] = results.filter(r => r.scenario === scenario);
    assert.equal(baseline.initialTick, candidate.initialTick);
    assert.deepEqual(baseline.initial.buildings, candidate.initial.buildings);
    assert.deepEqual(baseline.initial.resourcesMilli, candidate.initial.resourcesMilli);
    assert.deepEqual(baseline.initial.population, candidate.initial.population);
    assert.equal(baseline.comparisonTick, candidate.comparisonTick);
  }
  await save(true);
} catch (error) { await save(false, String(error)); throw error; }
