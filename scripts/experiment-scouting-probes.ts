/** Physical scouting probes in an owner-only world. Support supplies a known defending scout. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { PrivateSandbox, sandbox } from "../src/review/sandbox-client.js";
import type { Action, ReportsResponse } from "../src/shared/api.js";
const output = process.env.STEWARD_REVIEW_RUN! + "/scouting-probes.json";
const s = new PrivateSandbox(73421, 10800, { warden: 1, reaver: 0, sovereign: 0 });
const result: Record<string, any> = { taskId: "scouting-target-intelligence", worldId: s.world.id, passed: false,
  limitation: "Physical scouting only. Report summaries prove outcomes and observation ticks, but the managed read interface does not expose full intel details. No live target or combat benefit is inferred." };
try {
  let state = s.join(); const warmup: unknown[] = [];
  function act(action: Action) {
    const response = s.act([action]); assert.equal(response.results[0].ok, true, JSON.stringify(response.results));
    state = response.state ?? s.state(); return response;
  }
  function stepTo(tick: number) { if (tick > state.world.tick) state = s.step(tick - state.world.tick); }
  function complete() { stepTo(Math.max(state.world.tick, ...state.villages[0].buildQueue.map(q => q.endTick), ...Object.values(state.villages[0].training).flat().map(q => q.endTick))); }
  function build(building: Extract<Action, { type: "build" }>["building"]) {
    const option = state.villages[0].options.build.find(o => o.building === building)!;
    stepTo(Math.max(state.world.tick, state.player.nextActTick ?? 0, option.affordableAtTick ?? 0));
    warmup.push({ action: building, results: act({ type: "build", village: state.villages[0].id, building }).results }); complete();
  }
      // Construct the high prerequisites explicitly as shared fixture setup, not policy purchases.
      for (const b of ["hall", "hall", "barracks", "hall", "hall", "smithy", "farm", "farm", "farm", "farm",
          "hall", "hall", "hall", "hall", "hall", "barracks", "barracks", "barracks", "barracks",
          "smithy", "smithy", "smithy", "smithy", "cellar", "cellar", "cellar"] as const) build(b);

  build("stable"); stepTo(state.world.tick + 300);
  act({ type: "train", village: state.villages[0].id, unit: "scout", count: 3 }); complete();
  const log = sandbox<{entries: {by: string; action: Action}[]}>({ op: "read", world: s.world.id, resource: "log" });
  const target = (log.entries.find(e => e.by === "house_bot")!.action as { village: string }).village;
  const readReports = () => sandbox<ReportsResponse>({ op: "read", world: s.world.id, resource: "reports" });
  const send = (kind: "attack" | "support", count: number) => {
    const response = act({ type: "send", village: state.villages[0].id, target, kind, units: { scout: count } });
    const command = state.commands.outgoing.find(c => c.kind === kind)!;
    assert.ok(command); stepTo(command.arrivalTick); return { response: response.results, command };
  };
  const successful = send("attack", 2);
  const report = readReports().reports.find(r => r.commandId === successful.command.id)!;
  assert.ok(report); assert.equal(report.kind, "scouting"); assert.equal(report.outcome, "scouted");
  result.successful = { ...successful, report, troopsAfter: state.villages[0].units };
  stepTo(state.world.tick + 2 * (successful.command.arrivalTick - successful.command.sentTick) + 1);
  const supported = send("support", 1);
  assert.ok(state.villages[0].supportAbroad.some(stack => stack.units.scout === 1));
  const failed = send("attack", 1);
  const failedReport = readReports().reports.find(r => r.commandId === failed.command.id)!;
  assert.ok(failedReport); assert.equal(failedReport.outcome, "failed");
  result.failed = { ...failed, report: failedReport, suppliedDefender: supported, troopsAfter: state.villages[0].units };
  stepTo(state.world.tick + 301);
  const retained = readReports().reports.find(r => r.id === report.id)!;
  result.freshness = { reportTick: retained.tick, observedAtTick: state.world.tick, ageTicks: state.world.tick - retained.tick,
    unchangedObservationTick: retained.tick === report.tick,
    inference: "A retained scouting success remains a historical snapshot. Age alone cannot prove that target resources, troops or ownership stayed unchanged." };
  assert.equal(retained.tick, report.tick); assert.ok(result.freshness.ageTicks > 300);
  result.warmup = warmup; result.passed = true;
} catch (error) { result.error = String(error); throw error; }
finally { try { s.close(); result.deleted = true; } finally { await writeFile(output, JSON.stringify(result, null, 2)); } }
console.log(JSON.stringify({ passed: result.passed, worldId: result.worldId, success: result.successful?.report.outcome, failure: result.failed?.report.outcome, freshness: result.freshness, deleted: result.deleted }));
