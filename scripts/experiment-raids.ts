/** Real owner-only world actions use the managed broker. The existing trusted evidence helper
 * supplies read-only map/full-report reads and non-mutating report-based server simulations.
 * It reads credentials internally; this experiment never reads private connection settings.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { PrivateSandbox, sandbox } from "../src/review/sandbox-client.js";
import type { Action, MapResponse, Report, ReportsResponse, StateResponse, SimulateBattleResponse } from "../src/shared/api.js";

// Let a bounded review stop an experiment between broker calls while still running finally.
let interrupted = false;
process.once("SIGTERM", () => { interrupted = true; });
function checkInterrupted() { if (interrupted) throw new Error("Private experiment stopped at review deadline; cleanup required"); }

export function privateRead<T>(s: PrivateSandbox, suffix: string, body?: unknown): T {
  checkInterrupted();
  // Verify this managed run still owns the world before using the trusted read helper.
  s.state();
  assert.ok(suffix === "/map" || /^\/reports\/[a-zA-Z0-9_-]+$/.test(suffix) || suffix === "/simulate/battle");
  const script = `import sys,json,urllib.parse,urllib.error,time
sys.path.insert(0,sys.argv[1]+'/scripts/review')
from evidence import game
for attempt in range(20):
 try:
  result=game('/worlds/'+urllib.parse.quote(sys.argv[2],safe='')+sys.argv[3],json.loads(sys.argv[4]))
  print(json.dumps(result));break
 except urllib.error.HTTPError as error:
  if error.code!=429: raise
  delay=float(error.headers.get('Retry-After','1'))
  if not 0<=delay<=30: raise
  time.sleep(max(1,delay))
else: raise RuntimeError('Read-only sandbox evidence remained rate limited')`;

  return JSON.parse(execFileSync("python3", ["-c", script, process.env.STEWARD_REVIEW_TOOLS!, s.world.id, suffix, JSON.stringify(body ?? null)], { encoding: "utf8", timeout: 45000 }));
}

export function setup(s: PrivateSandbox, finalWait = 600, defendOrigin = false, siegeFixture = false) {
  let state = s.join(); const rules = s.rules();
  const act = (action: Action) => {
    checkInterrupted();
    const response = s.act([action]); assert.equal(response.results[0].ok, true, JSON.stringify(response.results));
    state = response.state ?? s.state(); return response;
  };
  const stepTo = (tick: number) => {
    // The broker returns authoritative state after every step; avoid a redundant read
    // for each short construction interval in this shared, exclusively owned fixture.
    while (tick > state.world.tick && state.world.status !== "ended") {
      checkInterrupted();
      state = sandbox<StateResponse>({ op: "step", world: s.world.id, ticks: Math.min(3600, tick - state.world.tick) });
    }
  };
  const complete = () => stepTo(Math.max(state.world.tick, state.player.nextActTick ?? 0,
    ...state.villages[0].buildQueue.map(q => q.endTick), ...Object.values(state.villages[0].training).flat().map(q => q.endTick)));
  const build = (building: Extract<Action, { type: "build" }>["building"]) => {
    const option = state.villages[0].options.build.find(o => o.building === building)!;
    stepTo(Math.max(state.world.tick, state.player.nextActTick ?? 0, option.affordableAtTick ?? 0));
    act({ type: "build", village: state.villages[0].id, building }); complete();
  };
  const trainFunded = (unit: Extract<Action, { type: "train" }>["unit"], count: number) => {
    const v = state.villages[0], option = v.options.train.find(o => o.unit === unit)!;
    const wait = Math.max(0, ...(["timber", "stone", "iron"] as const).map(r => {
      assert.ok(option.cost[r] * count <= v.storage);
      return Math.ceil((option.cost[r] * count * 1000 - v.resourcesMilli[r]) / v.productionPerTickMilli[r]);
    }));
    stepTo(Math.max(state.world.tick + wait, state.player.nextActTick ?? 0));
    act({ type: "train", village: v.id, unit, count }); complete();
  };
  for (const b of ["hall", "hall", "barracks", "hall", "hall", "smithy", "farm", "farm", "farm", "farm",
    "hall", "hall", "hall", "hall", "hall", "barracks", "barracks", "barracks", "barracks",
    "smithy", "smithy", "smithy", "smithy", "cellar", "cellar", "cellar", "stable"] as const) {
    build(b);
    if (defendOrigin && b === "smithy" && state.villages[0].buildings.smithy === 1) {
      build("wall"); build("wall"); build("wall");
      trainFunded("pikeman", 30); trainFunded("shieldman", 10);
      if (siegeFixture) {
        for (const b of ["lumberyard", "quarry", "mine"] as const) for (let n = 0; n < 6; n++) build(b);
        for (let n = 0; n < 4; n++) build("storehouse");
        build("farm"); build("farm"); build("farm");
      }
    }
  }
  stepTo(state.world.tick + 600);
  for (const [unit, count] of [["pikeman", 10], ["shieldman", 5], ["raider", 10], ["scout", 2]] as const) {
    if (defendOrigin) trainFunded(unit, count);
    else { act({ type: "train", village: state.villages[0].id, unit, count }); complete(); }
  }
  stepTo(state.world.tick + finalWait);
  return { get state() { return state; }, refresh() { state = s.state(); return state; }, rules, act, stepTo, complete, build, trainFunded };
}

if (process.argv.includes("--probe")) {
  const s = new PrivateSandbox(73421, 10800, process.argv.includes("--reaver") ? { warden: 0, reaver: 1, sovereign: 0 } : { warden: 1, reaver: 0, sovereign: 0 });
  const row: Record<string, unknown> = { worldId: s.world.id };
  try {
    const x = setup(s); const map = privateRead<MapResponse>(s, "/map"); row.map = map;
    const target = map.villages.find(v => v.ownerId && v.ownerId !== x.state.player.id)!;
    x.act({ type: "send", village: x.state.villages[0].id, target: target.id, kind: "attack", units: { scout: 2 } });
    const command = x.state.commands.outgoing.find(c => (c.units.scout ?? 0) === 2)!; x.stepTo(command.arrivalTick);
    const summary = sandbox<ReportsResponse>({ op: "read", world: s.world.id, resource: "reports" }).reports.find(r => r.commandId === command.id)!;
    row.report = privateRead<Report>(s, `/reports/${summary.id}`);
    row.simulation = privateRead<SimulateBattleResponse>(s, "/simulate/battle", { attacker: { raider: 10 }, fromReport: summary.id });
    row.tick = x.state.world.tick;
  } finally { s.close(); row.deleted = true; await writeFile(process.env.STEWARD_REVIEW_RUN! + (process.argv.includes("--reaver") ? "/raid-reaver-probe.json" : "/raid-probe.json"), JSON.stringify(row, null, 2)); }
  console.log(JSON.stringify(row));
}

if (process.argv.includes("--compare")) {
  const { Controller } = await import("../src/control/controller.js");
  const { evaluateEconomy } = await import("../src/advisors/economic.js");
  const { militaryAdvisor } = await import("../src/advisors/military.js");
  const { evaluateScoutDispatch } = await import("../src/advisors/scout-dispatch.js");
  const { evaluateRaidExecution } = await import("../src/advisors/raid-execution.js");
  const { selectProposal } = await import("../src/advisors/president.js");
  const results: Record<string, any>[] = [];
  const sovereign = process.argv.includes("--sovereign");
  const output = process.env.STEWARD_REVIEW_RUN! + (sovereign ? "/raid-sovereign-comparison.json" : "/raid-comparison.json");
  const save = (passed: boolean, error?: string) => writeFile(output, JSON.stringify({ taskId: "risk-gated-raid-execution", passed, error,
    baseline: "deployed-no-raid-policy", candidate: "full-intel-zero-loss-house-bot-raid-policy",
    limitation: "This matched case verifies authoritative full intel and rejection of a dangerous target. A favorable real-server policy raid and its lost-response recovery remain unverified; activation must stay disabled.", results }, null, 2));
  try {
    for (const policy of ["baseline", "candidate"]) {
      const s = new PrivateSandbox(73421, 10800, sovereign ? { warden: 0, reaver: 0, sovereign: 1 } : { warden: 1, reaver: 0, sovereign: 0 });
      const row: Record<string, any> = { policy, worldId: s.world.id }; results.push(row);
      try {
        const x = setup(s);
        const capitalMap = privateRead<MapResponse>(s, "/map");
        const capital = capitalMap.villages.find(v => v.ownerId && v.ownerId !== x.state.player.id)!;
        if (sovereign) x.stepTo(6000);
        const map = privateRead<MapResponse>(s, "/map");
        const target = sovereign ? map.villages.find(v => v.ownerId === capital.ownerId && v.id !== capital.id)! : capital;
        assert.ok(target, "Acquired Sovereign outpost required");
        if (sovereign) {
          const scoutSpeed = (x.rules.rules.UNITS as Record<string, { speed: number }>).scout.speed;
          const travel = Math.ceil(Math.hypot(target.x - x.state.villages[0].x, target.y - x.state.villages[0].y) * scoutSpeed);
          x.stepTo(6500 - travel);
        }
        x.act({ type: "send", village: x.state.villages[0].id, target: target.id, kind: "attack", units: { scout: 2 } });
        const command = x.state.commands.outgoing.find(c => (c.units.scout ?? 0) === 2)!; x.stepTo(command.arrivalTick);
        const summary = sandbox<ReportsResponse>({ op: "read", world: s.world.id, resource: "reports" }).reports.find(r => r.commandId === command.id)!;
        // Read the authoritative public-map cadence; never invent observation timestamps.
        const cadence = (x.rules.rules.SCORING as { publicSnapshotTicks: number }).publicSnapshotTicks;
        assert.ok(Number.isSafeInteger(cadence) && cadence > 0);
        x.stepTo(Math.ceil(x.state.world.tick / cadence) * cadence);
        const fullMap = privateRead<MapResponse>(s, "/map");
        row.map = fullMap; row.summary = summary;
        assert.ok(x.state.world.tick - fullMap.snapshotTick <= 30, "Authoritative public map must be fresh");
        const scope = JSON.stringify(["https://sandbox.invalid", x.state.player.id, s.world.id, x.state.world.epoch]);
        const observation = { scope, villageId: command.from.id, targetId: target.id, targetOwnerId: target.ownerId!,
          commandId: command.id, sentTick: command.sentTick, report: summary };
        const settings = { serverUrl: "https://sandbox.invalid", worldId: s.world.id, apiKey: "sandbox-adapter-no-credential" };
        let saved: import("../src/control/types.js").SavedControl = { settings, pending: null, automatic: false, decisions: [], scouting: [observation] };
        const charges: Record<string, any>[] = [];
        const storage = { load: async () => structuredClone(saved), save: async (v: typeof saved) => { saved = structuredClone(v); } };
        const planning = (): StateResponse => ({ ...x.state, world: { ...x.state.world, status: "running" } });
        const remote: import("../src/control/remote.js").Remote = async <T>(_settings: unknown, path: string, body?: unknown): Promise<T> => {
          if (path === "/me") return { account: { id: x.state.player.id }, worlds: [], sandboxes: [] } as T;
          if (path === "/worlds") return [planning().world] as T;
          if (path.endsWith("/state")) { x.refresh(); return planning() as T; }
          if (path.endsWith("/rules")) return x.rules as T;
          if (path.endsWith("/history")) return { samples: [] } as T;
          if (path.endsWith("/map")) return privateRead<MapResponse>(s, "/map") as T;
          if (path.endsWith("/reports")) return sandbox<ReportsResponse>({ op: "read", world: s.world.id, resource: "reports" }) as T;
          if (path.includes("/reports/")) return privateRead<Report>(s, path.slice(path.indexOf("/reports/"))) as T;
          if (path.endsWith("/simulate/battle")) return privateRead<SimulateBattleResponse>(s, "/simulate/battle", body) as T;
          assert.ok(path.endsWith("/actions")); const action = (body as { actions: Action[] }).actions[0];
          assert.deepEqual(saved.pending!.action, action, "journal before write");
          const before = structuredClone(x.state);
          const response = sandbox<import("../src/shared/api.js").ActionsResponse>({ op: "act", world: s.world.id, requestId: action.clientId, actions: [action] });
          assert.equal(response.results[0].ok, true, JSON.stringify(response.results));
          const after = s.state();
          charges.push({ action, results: response.results, spend: Object.fromEntries((["timber", "stone", "iron"] as const).map(r => [r, (before.villages[0].resourcesMilli[r] - after.villages[0].resourcesMilli[r]) / 1000])) });
          return response as T;
        };
        row.initial = structuredClone(x.state.villages[0]); row.initialTick = x.state.world.tick;
        row.planningWorldStatus = "running"; row.clockStatus = x.state.world.status;
        if (policy === "candidate") {
          const controller = await Controller.create(storage, settings, remote);
          await controller.cycle();
          row.detail = saved.scouting![0].detail; assert.ok(row.detail?.intel, JSON.stringify(controller.snapshot()));
          const scouting = { scope, map: fullMap, observations: saved.scouting! };
          row.raidProposalCount = evaluateRaidExecution({ state: planning(), rules: x.rules }, scouting, { attempts: [], assessments: [] }).length;
          assert.equal(row.raidProposalCount, 0);
          row.selected = controller.snapshot().selection.selected;
          await controller.setAutomatic(true); await controller.cycle();
          assert.equal(charges.length, 1, JSON.stringify(controller.snapshot()));
          assert.notEqual(charges[0].action.type, "send");
          await controller.setAutomatic(false);
          const restart = await Controller.create(storage, settings, remote); await restart.cycle();
          assert.equal(restart.snapshot().automatic, false); assert.equal(charges.length, 1);
          row.pausedRestartPreserved = true;
        } else {
          const ctx = { state: planning(), rules: x.rules };
          row.selected = selectProposal([...evaluateEconomy(ctx), ...militaryAdvisor.evaluate(ctx),
            ...evaluateScoutDispatch(ctx, { scope, map: fullMap, observations: [observation] })]).selected;
          assert.ok(row.selected); const before = structuredClone(x.state);
          const response = x.act(row.selected.action);
          charges.push({ action: row.selected.action, results: response.results, spend: Object.fromEntries((["timber", "stone", "iron"] as const).map(r => [r, (before.villages[0].resourcesMilli[r] - x.state.villages[0].resourcesMilli[r]) / 1000])) });
        }
        row.charges = charges;
        // Observe both policies at the same tick after the selected ordinary economic action finishes.
        x.stepTo(row.initialTick + 60); row.comparisonTick = x.state.world.tick; row.final = structuredClone(x.state.villages[0]);
        if (policy === "candidate") {
          row.prediction = privateRead<SimulateBattleResponse>(s, "/simulate/battle", { fromReport: summary.id, attacker: { raider: 10 } });
          assert.equal(row.prediction.attackerLost.raider, 10);
          // Explicit unsafe alternative probe, outside the policy comparison, only in this private world.
          const response = x.act({ type: "send", village: x.state.villages[0].id, target: target.id, kind: "attack", units: { raider: 10 } });
          const attack = response.results[0]; assert.ok(attack.ok && "command" in attack.data);
          const attackCommand = attack.data.command; x.stepTo(attackCommand.arrivalTick);
          const battle = sandbox<ReportsResponse>({ op: "read", world: s.world.id, resource: "reports" }).reports.find(r => r.commandId === attackCommand.id)!;
          row.unsafeAlternative = privateRead<Report>(s, `/reports/${battle.id}`);
          assert.equal(row.unsafeAlternative.attackerUnits.lost.raider, 10);
        }
        row.passed = true; await save(false);
      } finally { s.close(); row.deleted = true; await save(false); }
    }
    const [a, b] = results;
    assert.equal(a.initialTick, b.initialTick); assert.equal(a.comparisonTick, b.comparisonTick);
    for (const key of ["buildings", "resourcesMilli", "population", "units"]) assert.deepEqual(a.initial[key], b.initial[key]);
    assert.deepEqual(a.charges.map((c: any) => c.spend), b.charges.map((c: any) => c.spend));
    assert.equal(a.final.units.home.raider, 10); assert.equal(b.final.units.home.raider, 10);
    await save(true); console.log(JSON.stringify({ passed: true, results: results.map(r => ({ policy: r.policy, tick: r.comparisonTick, action: r.selected.action, deleted: r.deleted })) }));
  } catch (error) { await save(false, String(error)); throw error; }
}

if (process.argv.includes("--favorable")) {
  const { Controller } = await import("../src/control/controller.js");
  const { RemoteError } = await import("../src/control/remote.js");
  const { evaluateEconomy } = await import("../src/advisors/economic.js");
  const { militaryAdvisor } = await import("../src/advisors/military.js");
  const { evaluateScoutDispatch } = await import("../src/advisors/scout-dispatch.js");
  const { evaluateRaidExecution } = await import("../src/advisors/raid-execution.js");
  const { selectProposal } = await import("../src/advisors/president.js");
  const planned = process.argv.includes("--planned");
  const rows: Record<string, any>[] = [];
  const output = process.env.STEWARD_REVIEW_RUN! + (planned ? "/raid-planned-favorable.json" : process.argv.includes("--siege") ? "/raid-siege-favorable.json" : "/raid-favorable.json");
  const save = (passed: boolean, error?: string) => writeFile(output, JSON.stringify({ taskId: "risk-gated-raid-execution", passed, error,
    baseline: "deployed-no-raid-policy", candidate: "full-intel-zero-loss-house-bot-raid-policy", results: rows }, null, 2));
  try {
    for (const policy of (process.argv.includes("--candidate-only") ? ["candidate"] : planned ? ["candidate", "baseline"] : ["baseline", "candidate"])) {
      const s = new PrivateSandbox(73421, 10800, planned ? { warden: 0, reaver: 0, sovereign: 1 } : { warden: 0, reaver: 1, sovereign: 0 });
      const row: Record<string, any> = { policy, worldId: s.world.id }; rows.push(row);
      try {
        const x = setup(s, 0, true, planned || process.argv.includes("--siege"));
        row.setup = structuredClone(x.state.villages[0]); await save(false);
        if (planned) {
          const plan = JSON.parse(await readFile(process.env.STEWARD_REVIEW_RUN! + "/raid-outpost-plan.json", "utf8"));
          const predicted = plan.plans.find((p: any) => p.units.raider === 40 && p.units.ram === 8 && p.units.trebuchet === 20);
          assert.ok(predicted && predicted.battle.winner === "attacker" && predicted.battle.wall.after === 0 && predicted.battle.building?.after === 0,
            "Do not buy a clearing force unless the saved authoritative simulation clears wall and barracks");
          row.planningEvidence = { worldId: plan.worldId, scouting: plan.scouting, predicted };
          console.log(JSON.stringify({ policy, setupTick: x.state.world.tick, predicted }));
        }

        // The Reaver can raid the experiment origin too. Establish identical additional
        // private defenses before measuring either policy, using only ordinary actions.
        // Ordinary construction removes an urgent capacity conflict for both policies.
        x.build("storehouse"); x.build("storehouse");
        if (planned) x.build("farm");
        if (!planned && !process.argv.includes("--siege")) x.trainFunded("pikeman", 50);
        x.trainFunded("raider", planned ? 40 : process.argv.includes("--siege") ? 200 : 10);
        x.trainFunded("scout", 20);
        if (planned || process.argv.includes("--siege")) {
          // Read the authoritative prerequisite chain before committing siege resources.
          const buildings = x.rules.rules.BUILDINGS as Record<string, { requires: Record<string, number> }>;
          const requires = buildings.workshop.requires;
          for (const [building, level] of Object.entries(requires)) {
            const id = building as Extract<Action, { type: "build" }>["building"];
            while (x.state.villages[0].buildings[id] < level) x.build(id);
          }
          x.build("workshop");
          if (planned) x.build("workshop");
          x.trainFunded("ram", planned ? 8 : 35);
          if (planned) x.trainFunded("trebuchet", 20);
          while (x.state.villages[0].hidden < Math.max(...Object.values(x.state.villages[0].productionPerTickMilli)) * 300 / 1000)
            x.build("cellar");
        }
        row.origin = structuredClone(x.state); await save(false);
        const map = privateRead<MapResponse>(s, "/map");
        const target = map.villages.filter(v => v.ownerId && v.ownerId !== x.state.player.id && (!planned || v.points < Math.max(...map.villages.filter(t => t.ownerId === v.ownerId).map(t => t.points)))).sort((a, b) => Math.hypot(a.x - x.state.villages[0].x, a.y - x.state.villages[0].y) - Math.hypot(b.x - x.state.villages[0].x, b.y - x.state.villages[0].y))[0];
        assert.ok(target, "The planned outpost must exist; never substitute the capital");
        row.target = target;
        const cadence = (x.rules.rules.SCORING as { publicSnapshotTicks: number }).publicSnapshotTicks;
        const speed = (x.rules.rules.UNITS as Record<string, { speed: number }>).scout.speed;
        const travel = Math.ceil(Math.hypot(target.x - x.state.villages[0].x, target.y - x.state.villages[0].y) * speed);
        if (planned || process.argv.includes("--siege")) {
          const ramSpeed = (x.rules.rules.UNITS as Record<string, { speed: number }>).ram.speed;
          const siegeTravel = Math.ceil(Math.hypot(target.x - x.state.villages[0].x, target.y - x.state.villages[0].y) * ramSpeed);
          const arrival = Math.ceil((x.state.world.tick + siegeTravel + 2) / cadence) * cadence;
          x.stepTo(arrival - siegeTravel - 1);
          const response = x.act({ type: "send", village: x.state.villages[0].id, target: target.id, kind: "attack", units: { raider: planned ? 40 : 200, ram: planned ? 8 : 35, ...(planned ? { trebuchet: 20 } : {}), scout: (x.state.villages[0].units.home.scout ?? 0) - 2 }, ...(planned ? { aim: "barracks" as const } : {}) });
          const result = response.results[0]; assert.ok(result.ok && "command" in result.data);
          const command = result.data.command;
          x.stepTo(command.arrivalTick);
          const summary = sandbox<ReportsResponse>({ op: "read", world: s.world.id, resource: "reports" }).reports.find(r => r.commandId === command.id)!;
          row.siege = { command, detail: privateRead<Report>(s, `/reports/${summary.id}`) }; await save(false);
          // Return shared setup forces before measuring a policy. Fresh scouting below
          // will establish what actually survived or was rebuilt; never edit the report.
          x.stepTo(command.arrivalTick + siegeTravel);
        }
        row.probes = [];
        let summary: import("../src/shared/api.js").ReportSummary | undefined;
        let detail: Report | undefined;
        let command: import("../src/shared/api.js").OutgoingCommand | undefined;
        // Scout only with real actions; time arrivals to authoritative public snapshots.
        for (let attempt = 0; attempt < 6; attempt++) {
          const arrival = Math.ceil((x.state.world.tick + travel + 2) / cadence) * cadence;
          // Shared private setup: clear defending Scouts immediately before the bounded
          // two-Scout observation. This is not a purchase or action made by either policy.
          x.stepTo(arrival - travel - 1);
          const clearingCount = (x.state.villages[0].units.home.scout ?? 0) - 2;
          assert.ok(clearingCount > 2, "Private reconnaissance clearing reserve required");
          const clearingResponse = x.act({ type: "send", village: x.state.villages[0].id, target: target.id, kind: "attack", units: { scout: clearingCount } });
          const clearingResult = clearingResponse.results[0];
          assert.ok(clearingResult.ok && "command" in clearingResult.data);
          const clearingCommand = clearingResult.data.command;
          x.stepTo(arrival - travel);
          x.act({ type: "send", village: x.state.villages[0].id, target: target.id, kind: "attack", units: { scout: 2 } });
          command = x.state.commands.outgoing.find(c => (c.units.scout ?? 0) === 2 && !c.returning)!;
          assert.ok(command); x.stepTo(command.arrivalTick);
          summary = sandbox<ReportsResponse>({ op: "read", world: s.world.id, resource: "reports" }).reports.find(r => r.commandId === command!.id)!;
          assert.ok(summary); detail = privateRead<Report>(s, `/reports/${summary.id}`);
          const probe: Record<string, unknown> = { tick: x.state.world.tick, summary, detail };
          const clearingSummary = sandbox<ReportsResponse>({ op: "read", world: s.world.id, resource: "reports" }).reports.find(r => r.commandId === clearingCommand.id)!;
          probe.clearing = { command: clearingCommand, detail: privateRead<Report>(s, `/reports/${clearingSummary.id}`) };
          row.probes.push(probe); await save(false);
          // A failed reconnaissance report contains no intel and cannot be simulated.
          if (!detail.intel || detail.outcome !== "scouted") break;
          const prediction = privateRead<SimulateBattleResponse>(s, "/simulate/battle", { fromReport: summary.id, attacker: { raider: 10 } });
          probe.prediction = prediction; await save(false);
          // Scouting again cannot remove a wall; preserve this negative result promptly.
          if (detail.intel.buildings.wall > 0) break;
          if (detail.intel && detail.intel.buildings.wall === 0 &&
              !Object.values(detail.intel.unitsHome).some(n => n > 0) && !Object.values(detail.intel.supportTotal).some(n => n > 0)) break;
          if ((detail.scouts?.lost ?? 0) > 0) break;
          x.stepTo(command.arrivalTick + travel);
        }
        assert.ok(detail?.intel && command && summary, "Successful full scouting detail required");
        const fullMap = privateRead<MapResponse>(s, "/map");
        const scope = JSON.stringify(["https://sandbox.invalid", x.state.player.id, s.world.id, x.state.world.epoch]);
        const observation = { scope, villageId: command.from.id, targetId: target.id, targetOwnerId: target.ownerId!,
          commandId: command.id, sentTick: command.sentTick, report: summary };
        const settings = { serverUrl: "https://sandbox.invalid", worldId: s.world.id, apiKey: "sandbox-adapter-no-credential" };
        let saved: import("../src/control/types.js").SavedControl = { settings, pending: null, automatic: false, decisions: [], scouting: [observation] };
        const storage = { load: async () => structuredClone(saved), save: async (v: typeof saved) => { saved = structuredClone(v); } };
        let clock = 0, loseResponse = false;
        const charges: Record<string, any>[] = [];
        const planning = (): StateResponse => ({ ...x.state, world: { ...x.state.world, status: "running" } });
        const remote: import("../src/control/remote.js").Remote = async <T>(_settings: unknown, path: string, body?: unknown): Promise<T> => {
          if (path === "/me") return { account: { id: x.state.player.id }, worlds: [], sandboxes: [] } as T;
          if (path === "/worlds") return [planning().world] as T;
          if (path.endsWith("/state")) { x.refresh(); return planning() as T; }
          if (path.endsWith("/rules")) return x.rules as T;
          if (path.endsWith("/history")) return { samples: [] } as T;
          if (path.endsWith("/map")) return privateRead<MapResponse>(s, "/map") as T;
          if (path.endsWith("/reports")) return sandbox<ReportsResponse>({ op: "read", world: s.world.id, resource: "reports" }) as T;
          if (path.includes("/reports/")) return privateRead<Report>(s, path.slice(path.indexOf("/reports/"))) as T;
          if (path.endsWith("/simulate/battle")) return privateRead<SimulateBattleResponse>(s, "/simulate/battle", body) as T;
          assert.ok(path.endsWith("/actions")); const action = (body as { actions: Action[] }).actions[0];
          assert.deepEqual(saved.pending!.action, action, "journal before write");
          const before = structuredClone(x.state);
          const response = sandbox<import("../src/shared/api.js").ActionsResponse>({ op: "act", world: s.world.id, requestId: action.clientId, actions: [action] });
          assert.equal(response.results[0].ok, true, JSON.stringify(response.results));
          const after = x.refresh();
          charges.push({ action, results: response.results, spend: Object.fromEntries((["timber", "stone", "iron"] as const).map(r => [r, (before.villages[0].resourcesMilli[r] - after.villages[0].resourcesMilli[r]) / 1000])) });
          if (loseResponse && action.type === "send") throw new RemoteError(0, 5000, "Deliberately lost successful private raid response");
          return response as T;
        };
        row.initial = structuredClone(x.state.villages[0]); row.initialTick = x.state.world.tick;
        row.planningWorldStatus = "running"; row.clockStatus = x.state.world.status;
        if (policy === "candidate") {
          const controller = await Controller.create(storage, settings, remote, () => clock);
          await controller.cycle(); row.selected = controller.snapshot().selection.selected;
          row.snapshot = controller.snapshot();
          assert.equal(row.selected?.action.type, "send", "Favorable target must produce an actionable President raid");
          assert.equal(row.selected?.action.units.raider, 10);
          await controller.setAutomatic(true); await controller.cycle();
          assert.equal(charges.length, 1); assert.equal(saved.pending?.phase, "accepted");
          const raidCommand = (charges[0].results[0].data as { command: import("../src/shared/api.js").OutgoingCommand }).command;
          row.command = raidCommand;
          await controller.setAutomatic(false);
          x.stepTo(raidCommand.arrivalTick);
          const restart = await Controller.create(storage, settings, remote, () => clock); await restart.cycle();
          assert.equal(restart.snapshot().automatic, false); assert.equal(charges.length, 1); assert.equal(saved.pending, null);
          assert.ok(restart.snapshot().decisions.some(d => d.kind === "confirmed" && d.text.includes("Raid report")));
          row.pausedRestartConfirmed = true;
          const report = sandbox<ReportsResponse>({ op: "read", world: s.world.id, resource: "reports" }).reports.find(r => r.commandId === raidCommand.id)!;
          row.battle = privateRead<Report>(s, `/reports/${report.id}`);
          assert.equal(row.battle.attackerUnits.lost.raider ?? 0, 0);
          assert.ok(Object.values(row.battle.loot as Record<string, number>).reduce((a, b) => a + b, 0) >= 60);
        } else {
          const ctx = { state: planning(), rules: x.rules };
          row.selected = selectProposal([...evaluateEconomy(ctx), ...militaryAdvisor.evaluate(ctx),
            ...evaluateScoutDispatch(ctx, { scope, map: fullMap, observations: [observation] })]).selected;
          assert.ok(row.selected); assert.notEqual(row.selected.action.type, "send");
          const before = structuredClone(x.state); const response = x.act(row.selected.action);
          charges.push({ action: row.selected.action, results: response.results, spend: Object.fromEntries((["timber", "stone", "iron"] as const).map(r => [r, (before.villages[0].resourcesMilli[r] - x.state.villages[0].resourcesMilli[r]) / 1000])) });
        }
        // Equal observation time includes the Raider round trip and credited loot.
        const raidSpeed = (x.rules.rules.UNITS as Record<string, { speed: number }>).raider.speed;
        const raidTravel = Math.ceil(Math.hypot(target.x - x.state.villages[0].x, target.y - x.state.villages[0].y) * raidSpeed);
        x.stepTo(row.initialTick + 2 * raidTravel + 1);
        row.comparisonTick = x.state.world.tick; row.final = structuredClone(x.state.villages[0]); row.charges = charges;
        if (policy === "candidate") {
          assert.ok((x.state.villages[0].units.home.raider ?? 0) >= 10);
          // A second real send exercises lost-response recovery after a paused restart.
          x.stepTo(Math.max(x.state.world.tick, row.initialTick + 600));
          // Reuse only freshly obtained intel; never relabel the old report's tick.
          const arrival = Math.ceil((x.state.world.tick + travel + 1) / cadence) * cadence;
          x.stepTo(arrival - travel);
          x.act({ type: "send", village: x.state.villages[0].id, target: target.id, kind: "attack", units: { scout: 2 } });
          const scout = x.state.commands.outgoing.find(c => (c.units.scout ?? 0) === 2 && !c.returning)!;
          x.stepTo(scout.arrivalTick);
          const freshSummary = sandbox<ReportsResponse>({ op: "read", world: s.world.id, resource: "reports" }).reports.find(r => r.commandId === scout.id)!;
          saved.scouting = [{ ...observation, commandId: scout.id, sentTick: scout.sentTick, report: freshSummary }];
          saved.automatic = false;
          const recovery = await Controller.create(storage, settings, remote, () => clock); await recovery.cycle();
          row.recoverySelection = recovery.snapshot().selection.selected;
          if (row.recoverySelection?.action.type === "send" && row.recoverySelection.action.units.raider === 10) {
            loseResponse = true; await recovery.setAutomatic(true); await recovery.cycle();
            assert.equal(saved.pending?.phase, "uncertain"); const count = charges.length;
            await recovery.setAutomatic(false); clock += 10000;
            const afterLoss = await Controller.create(storage, settings, remote, () => clock); await afterLoss.cycle();
            assert.equal(charges.length, count); assert.equal(saved.pending, null); assert.equal(afterLoss.snapshot().automatic, false);
            row.lostResponseSuppressed = true;
          } else row.lostResponseSuppressed = false;
        }
        row.passed = true; await save(false);
      } finally {
        try {
          row.lastState = s.state();
          row.originReports = sandbox<ReportsResponse>({ op: "read", world: s.world.id, resource: "reports" });
        } finally { s.close(); row.deleted = true; await save(false); }
      }
    }
    if (process.argv.includes("--candidate-only")) {
      await save(false, "Candidate-only probe; matched baseline comparison remains required before activation");
    } else {
    const a = rows.find(r => r.policy === "baseline")!, b = rows.find(r => r.policy === "candidate")!;
    assert.equal(a.initialTick, b.initialTick); assert.equal(a.comparisonTick, b.comparisonTick);
    for (const key of ["buildings", "resourcesMilli", "population", "units"]) assert.deepEqual(a.initial[key], b.initial[key]);
    assert.equal(b.pausedRestartConfirmed, true); assert.equal(b.lostResponseSuppressed, true);
    await save(true); console.log(JSON.stringify({ passed: true, results: rows.map(r => ({ policy: r.policy, initialTick: r.initialTick, comparisonTick: r.comparisonTick, action: r.selected.action, deleted: r.deleted })) }));
    }
  } catch (error) { await save(false, String(error)); throw error; }
}
