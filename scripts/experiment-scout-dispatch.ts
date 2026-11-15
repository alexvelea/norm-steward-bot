/** Matched private worlds. Map fixture comes from an actual server-returned support destination;
 * the managed broker cannot read /map. No hidden intelligence or report details are fabricated.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { PrivateSandbox, sandbox } from "../src/review/sandbox-client.js";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { militaryAdvisor } from "../src/advisors/military.js";
import { evaluateScoutDispatch, usableScoutObservation } from "../src/advisors/scout-dispatch.js";
import { selectProposal } from "../src/advisors/president.js";
import { Controller } from "../src/control/controller.js";
import { RemoteError, type Remote } from "../src/control/remote.js";
import type { SavedControl, Settings } from "../src/control/types.js";
import type { Action, ActionsResponse, MapResponse, ReportsResponse, StateResponse } from "../src/shared/api.js";

const output = process.env.STEWARD_REVIEW_RUN! + "/scout-dispatch-comparison.json";
const verifyExisting = process.argv.includes("--verify-existing");
const results: Record<string, any>[] = verifyExisting ? JSON.parse(await readFile(output, "utf8")).results : [];
const planning = (s: StateResponse): StateResponse => ({ ...s, world: { ...s.world, status: "running" } });
async function save(passed: boolean, error?: string) {
  await writeFile(output, JSON.stringify({ taskId: "bounded-scout-dispatch", passed, error,
    baseline: "deployed-readiness-without-dispatch", candidate: "bounded-two-scout-house-bot-dispatch",
    limitation: "The broker exposes state, rules, logs and report summaries, not map or full intel. Both policies receive the same map fixture constructed from a server-returned support destination and the configured Warden identity. Server validates all actual sends. Freshness tests validate historical observations, never hidden troop/resource intelligence or raid profitability.", results }, null, 2));
}
try {
  for (const scenario of verifyExisting ? [] : ["useful"]) for (const policy of ["baseline", "candidate"]) {
    const s = new PrivateSandbox(73421, 10800, { warden: 1, reaver: 0, sovereign: 0 });
    const row: Record<string, any> = { scenario, policy, worldId: s.world.id };
    try {
      let state = s.join(); const rules = s.rules();
      function act(action: Action) {
        const response = s.act([action]); assert.equal(response.results[0].ok, true, JSON.stringify(response.results));
        state = response.state ?? s.state(); return response;
      }
      function stepTo(tick: number) { if (tick > state.world.tick) state = s.step(tick - state.world.tick); }
      function complete() { stepTo(Math.max(state.world.tick, state.player.nextActTick ?? 0,
        ...state.villages[0].buildQueue.map(q => q.endTick), ...Object.values(state.villages[0].training).flat().map(q => q.endTick))); }
      function build(building: Extract<Action, { type: "build" }>["building"]) {
        const option = state.villages[0].options.build.find(o => o.building === building)!;
        stepTo(Math.max(state.world.tick, state.player.nextActTick ?? 0, option.affordableAtTick ?? 0));
        act({ type: "build", village: state.villages[0].id, building }); complete();
      }
      for (const b of ["hall", "hall", "barracks", "hall", "hall", "smithy", "farm", "farm", "farm", "farm",
        "hall", "hall", "hall", "hall", "hall", "barracks", "barracks", "barracks", "barracks",
        "smithy", "smithy", "smithy", "smithy", "cellar", "cellar", "cellar", "stable"] as const) build(b);
      stepTo(state.world.tick + 600);
      for (const [unit, count] of [["pikeman", 10], ["shieldman", 5], ["raider", 10], ["scout", 2]] as const) {
        act({ type: "train", village: state.villages[0].id, unit, count }); complete();
      }
      stepTo(state.world.tick + 600);
      const log = sandbox<{entries: { by: string; action: Action }[]}>({ op: "read", world: s.world.id, resource: "log" });
      const targetId = (log.entries.find(e => e.by === "house_bot")!.action as { village: string }).village;
      // One Pikeman is stationed as common setup solely to obtain the authoritative destination ref.
      act({ type: "send", village: state.villages[0].id, target: targetId, kind: "support", units: { pikeman: 1 } });
      const target = state.commands.outgoing.find(c => c.to.id === targetId)!.to;
      const map = (): MapResponse => ({ tick: state.world.tick, snapshotTick: state.world.tick, size: state.world.size,
        villages: [{ ...target, points: 0 }], players: [{ id: target.ownerId!, name: target.ownerName!, houseBot: "warden", protectedUntilTick: null, points: 0, villages: 1 }] });
      const scope = JSON.stringify(["https://sandbox.invalid", state.player.id, state.world.id, state.world.epoch]);
      const scoutContext = () => ({ scope, map: map(), observations: [] });
      function decide(kind: string) {
        const context = { state: planning(state), rules };
        return selectProposal([...evaluateEconomy(context), ...militaryAdvisor.evaluate(context), ...(kind === "candidate" ? evaluateScoutDispatch(context, scoutContext()) : [])]);
      }
      for (let i = 0; i < 16; i++) {
        const p = decide("candidate").selected;
        if (p?.action.type === "send") break;
        if (p) { act(p.action); complete(); } else stepTo(state.world.tick + 100);
      }
      assert.equal(decide("candidate").selected?.action.type, "send");
      const travel = Math.ceil(Math.hypot(state.villages[0].x - target.x, state.villages[0].y - target.y) * (rules.rules.UNITS as any).scout.speed);
      if (scenario === "too-late") stepTo(state.world.endsAtTick - 2 * travel - 59);
      const initial = structuredClone(state); row.initialTick = state.world.tick; row.initial = initial.villages[0]; row.travel = travel;
      row.planningWorldStatus = "running"; row.clockStatus = state.world.status; row.selected = decide(policy).selected;
      const charges: Record<string, any>[] = []; let saved: SavedControl | null = null; let loseResponse = false; let now = 1000;
      const storage = { load: async () => structuredClone(saved), save: async (v: SavedControl) => { saved = structuredClone(v); } };
      const settings: Settings = { serverUrl: "https://sandbox.invalid", worldId: s.world.id, apiKey: "sandbox-adapter-no-credential" };
      const remote: Remote = async <T>(_settings: Settings, path: string, body?: unknown): Promise<T> => {
        if (path === "/me") return { account: { id: state.player.id, name: "Owner", createdAt: "" }, worlds: [], sandboxes: [] } as T;
        if (path === "/worlds") return [planning(state).world] as T;
        if (path.endsWith("/rules")) return rules as T;
        if (path.endsWith("/history")) return { samples: [] } as T;
        if (path.endsWith("/state")) { state = s.state(); return planning(state) as T; }
        if (path.endsWith("/map")) return map() as T;
        if (path.endsWith("/reports")) return sandbox<ReportsResponse>({ op: "read", world: s.world.id, resource: "reports" }) as T;
        assert.ok(path.endsWith("/actions")); const action = (body as { actions: Action[] }).actions[0];
        assert.deepEqual(saved!.pending!.action, action, "durable journal must precede write");
        const before = structuredClone(state);
        const response = sandbox<ActionsResponse>({ op: "act", world: s.world.id, requestId: action.clientId, actions: [action] });
        assert.equal(response.results[0].ok, true, JSON.stringify(response.results)); state = response.state ?? s.state();
        charges.push({ action, results: response.results, tick: before.world.tick,
          spend: Object.fromEntries((["timber", "stone", "iron"] as const).map(r => [r, (before.villages[0].resourcesMilli[r] - state.villages[0].resourcesMilli[r]) / 1000])) });
        if (loseResponse) { loseResponse = false; throw new RemoteError(0, 5000, "Controlled lost successful scouting response"); }
        return response as T;
      };
      let controller = await Controller.create(storage, settings, remote, () => now, { execute: false });
      if (policy === "candidate") {
        await controller.cycle(); await controller.setAutomatic(true); await controller.cycle();
        assert.equal(charges.length, 1, JSON.stringify(controller.snapshot()));
        const pendingId = saved!.pending!.action.clientId;
        await controller.setAutomatic(false); controller = await Controller.create(storage, settings, remote, () => now);
        assert.equal(controller.snapshot().automatic, false);
        if (scenario === "useful") {
          assert.equal(saved!.pending!.action.type, "send");
          const command = state.commands.outgoing.find(c => c.id === saved!.pending!.itemId)!;
          stepTo(command.arrivalTick); await controller.cycle();
          assert.equal(saved!.pending, null); assert.equal(charges.length, 1);
          const observation = saved!.scouting![0]; assert.equal(observation.report!.outcome, "scouted");
          row.report = observation.report; row.confirmedAfterRestart = controller.snapshot().decisions.some(d => d.kind === "confirmed" && d.clientId === pendingId);
          assert.ok(row.confirmedAfterRestart);
          row.freshUsable = usableScoutObservation(observation, planning(state), map(), scope); assert.ok(row.freshUsable);
          const changed = map(); changed.villages[0].ownerId = "different-owner";
          row.ownerChangeRejected = !usableScoutObservation(observation, planning(state), changed, scope); assert.ok(row.ownerChangeRejected);
          row.epochChangeRejected = !usableScoutObservation(observation, planning(state), map(), scope + "new-epoch"); assert.ok(row.epochChangeRejected);
          stepTo(observation.report!.tick + 301);
          row.staleRejected = !usableScoutObservation(observation, planning(state), map(), scope); assert.ok(row.staleRejected);
        } else {
          assert.notEqual(saved!.pending!.action.type, "send"); complete(); await controller.cycle();
        }
      } else {
        if (row.selected) { const before = structuredClone(state); const response = act(row.selected.action);
          charges.push({ action: row.selected.action, results: response.results, tick: before.world.tick,
            spend: Object.fromEntries((["timber", "stone", "iron"] as const).map(r => [r, (before.villages[0].resourcesMilli[r] - state.villages[0].resourcesMilli[r]) / 1000])) }); complete(); }
      }
      stepTo(Math.max(state.world.tick, initial.world.tick + travel + 301));
      row.comparisonTick = state.world.tick; row.final = state.villages[0]; row.charges = structuredClone(charges);
      row.totalSpend = Object.fromEntries((["timber", "stone", "iron"] as const).map(r => [r, charges.reduce((n, c) => n + c.spend[r], 0)]));
      if (scenario === "useful" && policy === "candidate") {
        stepTo(Math.max(state.world.tick, initial.world.tick + 601, ...state.commands.outgoing.filter(c => (c.units.scout ?? 0) > 0).map(c => c.arrivalTick)));
        assert.equal(state.villages[0].units.home.scout, 2);
        // Let urgent economic priorities finish while paused, then test a successful send whose response is lost.
        for (let i = 0; i < 10; i++) { const p = decide("candidate").selected; if (p?.action.type === "send") break; if (p) { act(p.action); complete(); } }
        loseResponse = true; await controller.setAutomatic(true); await controller.cycle();
        assert.equal(saved!.pending?.phase, "uncertain", JSON.stringify(controller.snapshot()));
        const count = charges.length; await controller.setAutomatic(false); now += 10000;
        controller = await Controller.create(storage, settings, remote, () => now); await controller.cycle();
        assert.equal(charges.length, count); assert.equal(saved!.pending, null);
        row.lostResponse = { journalBeforeWrite: true, duplicateSubmissions: 0, suppressedAfterRestart: true, result: charges.at(-1) };
      }
      row.passed = true; results.push(row); await save(false);
      console.log(JSON.stringify({ scenario, policy, worldId: s.world.id, tick: row.comparisonTick, spend: row.totalSpend, report: row.report?.outcome, restart: row.confirmedAfterRestart, lostResponse: row.lostResponse?.suppressedAfterRestart }));
    } finally { s.close(); row.deleted = true; }
  }
  for (const scenario of ["useful"]) {
    const [a, b] = results.filter(r => r.scenario === scenario);
    assert.equal(results.length, 2); assert.ok(a.passed && b.passed);
    assert.equal(a.initialTick, b.initialTick); assert.deepEqual(a.initial.buildings, b.initial.buildings);
    assert.deepEqual(a.initial.resourcesMilli, b.initial.resourcesMilli); assert.deepEqual(a.initial.units, b.initial.units);
    assert.deepEqual(a.initial.population, b.initial.population);
    assert.equal(a.comparisonTick, b.comparisonTick);
    if (scenario === "too-late") assert.deepEqual(a.totalSpend, b.totalSpend);
  }
  if (verifyExisting) {
    const registry = JSON.parse(await readFile(process.env.STEWARD_REVIEW_RUN! + "/sandboxes.json", "utf8"));
    for (const row of results) { assert.equal(registry.worlds[row.worldId]?.deleted, true); row.deleted = true; }
  }
  await save(true);
} catch (error) { await save(false, String(error)); throw error; }
