/** Verify storage purchases against production remaining in the actual private round. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PrivateSandbox } from "../src/review/sandbox-client.js";
import { Controller } from "../src/control/controller.js";
import type { Remote } from "../src/control/remote.js";
import type { SavedControl } from "../src/control/types.js";
import type { Action, StateResponse } from "../src/shared/api.js";

const run = process.env.STEWARD_REVIEW_RUN!;
const base = "b584d621302cb75862db1578ed13939a6b5707a7";
const baselineRoot = run + "/storage-baseline-src";
for (const path of execFileSync("git", ["ls-tree", "-r", "--name-only", base, "src"], { encoding: "utf8" }).trim().split("\n")) {
  const target = baselineRoot + "/" + path.slice(4);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, execFileSync("git", ["show", base + ":" + path]));
}
const { Controller: BaselineController } = await import(baselineRoot + "/control/controller.ts");
const results: any[] = [];
const save = (passed = false, error?: string) => writeFile(run + "/round-storage-comparison.json", JSON.stringify({
  taskId: "full-round-raid-economics", baselineCommit: base,
  baseline: "deployed-300-tick-storage-forecast", candidate: "round-bounded-storage-forecast",
  passed, verdict: passed ? "supports-change" : "inconclusive", error, results,
}, null, 2));
try {
  for (const duration of [1300, 1600]) for (const policy of ["baseline", "candidate"]) {
    const s = new PrivateSandbox(73421, duration);
    const row: any = { policy, duration, worldId: s.world.id }; results.push(row);
    try {
      let state = s.join(); const rules = s.rules();
      for (let n = 0; n < 2; n++) {
        const response = s.act([{ type: "build", village: state.villages[0].id, building: "cellar" }]);
        assert.ok(response.results[0].ok, JSON.stringify(response.results)); state = response.state!;
        const tick = Math.max(state.player.nextActTick ?? 0, ...state.villages[0].buildQueue.map(q => q.endTick));
        state = s.step(tick - state.world.tick);
      }
      state = s.step(1200 - state.world.tick);
      row.initial = structuredClone(state.villages[0]); row.initialTick = state.world.tick;
      row.clockStatus = state.world.status; row.planningWorldStatus = "running";
      const settings = { serverUrl: "https://sandbox.invalid", worldId: s.world.id, apiKey: "sandbox-adapter-no-credential" };
      let saved: SavedControl = { settings, pending: null, automatic: false, decisions: [] }; let now = 0;
      const storage = { load: async () => structuredClone(saved), save: async (v: SavedControl) => { saved = structuredClone(v); } };
      const planning = (): StateResponse => ({ ...state, world: { ...state.world, status: state.world.status === "ended" ? "ended" : "running" } });
      row.charges = [];
      const remote: Remote = async <T>(_settings: unknown, path: string, body?: unknown): Promise<T> => {
        if (path === "/me") return { account: { id: state.player.id }, worlds: [], sandboxes: [] } as T;
        if (path === "/worlds") return [planning().world] as T;
        if (path.endsWith("/state")) return planning() as T;
        if (path.endsWith("/rules")) return rules as T;
        if (path.endsWith("/history")) return { samples: [] } as T;
        assert.ok(path.endsWith("/actions"), path);
        const action = (body as { actions: Action[] }).actions[0];
        assert.deepEqual(saved.pending!.action, action, "journal before write");
        const response = s.act([action]); assert.ok(response.results[0].ok, JSON.stringify(response.results));
        state = response.state!; row.charges.push({ action, results: response.results }); return response as T;
      };
      const Factory = policy === "candidate" ? Controller : BaselineController;
      const c = await Factory.create(storage, settings, remote, () => now);
      await c.cycle(); row.selection = c.snapshot().selection; await c.setAutomatic(true);
      now += 10000; await c.cycle();
      if (duration === 1300 && policy === "candidate") assert.equal(row.charges.length, 0);
      else assert.equal(row.charges[0]?.action.building, "storehouse");
      await c.setAutomatic(false);
      state = s.step(duration - state.world.tick); now += 10000; await c.cycle();
      row.final = structuredClone(state.villages[0]); row.comparisonTick = state.world.tick;
      assert.equal(state.world.status, "ended"); assert.equal(saved.pending, null);
      row.spend = Object.fromEntries((["timber", "stone", "iron"] as const).map(r => [r, row.charges.reduce((sum: number, x: any) => sum + (x.results[0].data.queued?.cost?.[r] ?? row.initial.options.build.find((o: any) => o.building === x.action.building).cost[r]), 0)]));
      row.passed = true;
    } finally { s.close(); row.deleted = true; await save(); }
  }
  for (const duration of [1300, 1600]) {
    const [b, c] = results.filter(r => r.duration === duration);
    for (const key of ["buildings", "resourcesMilli", "units", "population"]) assert.deepEqual(b.initial[key], c.initial[key]);
    for (const r of ["timber", "stone", "iron"]) {
      const delta = (c.final.resourcesMilli[r] - b.final.resourcesMilli[r]) / 1000;
      assert.equal(delta, duration === 1300 ? b.spend[r] : 0, "retained stock must match avoided spend, with no production overflow");
    }
  }
  await save(true); console.log(JSON.stringify({ passed: true, results: results.map(r => ({ policy: r.policy, duration: r.duration, spend: r.spend, deleted: r.deleted })) }));
} catch (error) { await save(false, String(error)); throw error; }
