// Shared sandbox helpers for the experiment scripts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PrivateSandbox, sandbox } from "../src/review/sandbox-client.js";
import type { Action, StateResponse } from "../src/shared/api.js";

let interrupted = false;
let interruptHandlerInstalled = false;
function checkInterrupted() {
  if (!interruptHandlerInstalled) {
    interruptHandlerInstalled = true;
    process.once("SIGTERM", () => { interrupted = true; });
  }
  if (interrupted) throw new Error("Private experiment stopped at review deadline; cleanup required");
}

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
