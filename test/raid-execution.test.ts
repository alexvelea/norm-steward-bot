import assert from "node:assert/strict";
import { test } from "node:test";
import { developedContext as context } from "./control-fixtures.js";
import { evaluateRaidExecution, hamletArrivalDefense, usableRaidIntel, type RaidContext } from "../src/advisors/raid-execution.js";
import { evaluateScoutDispatch, type ScoutingContext } from "../src/advisors/scout-dispatch.js";
import { Controller } from "../src/control/controller.js";
import { RemoteError, type Remote } from "../src/control/remote.js";
import type { Action, OutgoingCommand, Report, SimulateBattleResponse } from "../src/shared/api.js";
import type { SavedControl, Settings } from "../src/control/types.js";
function fixture() {
  const c = context(), v = c.state.villages[0]; v.hidden = 1000;
  v.units.home = { pikeman: 10, shieldman: 5, raider: 10, scout: 2 };
  v.buildings.hall = 10; v.buildings.wall = 20; v.buildings.barracks = 10; v.buildings.smithy = 5; v.buildings.stable = 3;
  const target = { id: "bot-v", name: "Bot", ownerId: "bot", ownerName: "Bot", x: 2, y: 1, points: 1 };
  const from = { id: v.id, name: v.name, ownerId: c.state.player.id, ownerName: "Owner", x: 1, y: 1 };
  const detail: Report = { id: "intel", commandId: "scout-command", tick: 95, kind: "scouting", role: "attacker", attacker: from,
    defender: target, outcome: "scouted", conquered: false, read: true, attackerUnits: null, defenderUnits: null,
    scouts: { sent: 2, lost: 0, defending: 0, defendingLost: 0 }, strength: null, wall: null, building: null, loyalty: null,
    loot: null, carry: null, intel: { resources: { timber: 1000, stone: 1000, iron: 1000 }, buildings: { ...v.buildings, wall: 0, cellar: 0 }, unitsHome: {}, supportTotal: {} } };
  const scope = JSON.stringify(["https://sandbox.invalid", c.state.player.id, c.state.world.id, c.state.world.epoch]);
  const scouting: ScoutingContext = { scope, map: { tick: 100, snapshotTick: 100, size: 100, villages: [target],
    players: [{ id: "bot", name: "Bot", houseBot: "warden", protectedUntilTick: null, points: 1, villages: 1 }] },
    observations: [{ scope, villageId: v.id, targetId: target.id, targetOwnerId: "bot", sentTick: 80, commandId: "scout-command", report: detail, detail }] };
  const battle: SimulateBattleResponse = { winner: "attacker", strength: { attack: 420, defense: 20 }, attackerLost: {}, attackerSurvivors: { raider: 10 },
    defenderLost: {}, defenderSurvivors: {}, scouting: null, wall: { before: 0, effective: 0, after: 0 }, building: null, loyalty: null,
    loot: { timber: 40, stone: 40, iron: 40 } };
  const raids: RaidContext = { attempts: [], assessments: [{ scope, reportId: detail.id, tick: 100, battle }] };
  const command: OutgoingCommand = { id: "raid-command", seq: 2, kind: "attack", returning: false, from, to: target, units: { raider: 10 }, aim: null,
    sentTick: 100, arrivalTick: 118, cancellableUntilTick: 117, loot: null, raidOrder: null };
  return { c, scouting, raids, detail, battle, command, scope };
}
test("malformed full-intelligence collections cannot authorize a raid", () => {
  for (const field of ["resources", "buildings", "unitsHome", "supportTotal"] as const) {
    for (const value of [1, "", [], null]) {
      const x = fixture();
      (x.detail.intel as unknown as Record<string, unknown>)[field] = value;
      assert.equal(usableRaidIntel(x.scouting.observations[0], x.c.state, x.scouting), false, `${field}: ${JSON.stringify(value)}`);
      assert.deepEqual(evaluateRaidExecution(x.c, x.scouting, x.raids), []);
    }
  }
});
test("raid proposals require full proven intel, no defenders, zero simulated losses and useful loot", () => {
  const x = fixture(); assert.equal(evaluateRaidExecution(x.c, x.scouting, x.raids).length, 1);
  assert.deepEqual(evaluateRaidExecution(x.c, x.scouting, x.raids)[0].action.units, { raider: 10 });
  for (const mutate of [
    (y: typeof x) => { delete y.scouting.observations[0].detail; },
    (y: typeof x) => { y.detail.commandId = "foreign"; },
    (y: typeof x) => { y.detail.defender.ownerId = "changed"; },
    (y: typeof x) => { y.detail.intel!.unitsHome = { pikeman: 1 }; },
    (y: typeof x) => { y.detail.intel!.supportTotal = { shieldman: 1 }; },
    (y: typeof x) => { y.detail.intel!.buildings.wall = 1; },
    (y: typeof x) => { y.detail.intel!.resources.timber = NaN; },
    (y: typeof x) => { y.battle.attackerLost = { raider: 1 }; },
    (y: typeof x) => { y.battle.loot = { timber: 59, stone: 0, iron: 0 }; },
    (y: typeof x) => { y.battle.strength.defense = 211; },
    (y: typeof x) => { y.raids.assessments[0].tick = 99; },
    (y: typeof x) => { y.scouting.map.players[0].houseBot = null; },
    (y: typeof x) => { y.scouting.map.players[0].protectedUntilTick = 101; },
    (y: typeof x) => { y.c.state.player.protectedUntilTick = 101; },
    (y: typeof x) => { y.scouting.scope = "other-epoch"; },
    (y: typeof x) => { y.scouting.map.snapshotTick = 69; },
    (y: typeof x) => { y.detail.tick = 0; y.scouting.map.villages[0].x = 15; },
    (y: typeof x) => { y.c.state.world.endsAtTick = 195; },
    (y: typeof x) => { y.c.state.villages[0].units.home.pikeman = 9; },
    (y: typeof x) => { y.c.state.villages[0].orders.raids.push({} as never); },
    (y: typeof x) => { y.raids.attempts.push({ scope: y.scope, villageId: "v1", targetId: "bot-v", reportId: "intel", sentTick: 99 }); },
  ]) { const y = fixture(); mutate(y); assert.equal(evaluateRaidExecution(y.c, y.scouting, y.raids).length, 0, String(mutate)); }
  const incomplete = fixture(); (incomplete.detail.intel as unknown) = {}; assert.equal(usableRaidIntel(incomplete.scouting.observations[0], incomplete.c.state, incomplete.scouting), false);
});
test("raid return reserves storage for each resource's loot and round-trip production", () => {
  for (const resource of ["timber", "stone", "iron"] as const) {
    const x = fixture(), v = x.c.state.villages[0];
    const travel = Math.ceil(Math.hypot(x.scouting.map.villages[0].x - v.x, x.scouting.map.villages[0].y - v.y) *
      (x.c.rules.rules.UNITS as Record<string, { speed: number }>).raider.speed);
    const required = 2 * travel * v.productionPerTickMilli[resource] + x.battle.loot![resource] * 1000;
    v.resourcesMilli[resource] = v.storage * 1000 - required;
    assert.equal(evaluateRaidExecution(x.c, x.scouting, x.raids).length, 1, `${resource}: exact capacity fits`);
    v.resourcesMilli[resource]++;
    assert.equal(evaluateRaidExecution(x.c, x.scouting, x.raids).length, 0, `${resource}: overflow refuses raid`);
  }
});
async function executor(mode: "ok" | "lost" | "reject" | "unapplied" = "ok") {
  const x = fixture(); let now = 0, first = true; const writes: Action[] = []; const reads: string[] = [];
  const settings: Settings = { serverUrl: "https://sandbox.invalid", worldId: x.c.state.world.id, apiKey: "test" };
  let saved: SavedControl = { settings, pending: null, decisions: [], scouting: structuredClone(x.scouting.observations) };
  delete saved.scouting![0].detail;
  const storage = { load: async () => structuredClone(saved), save: async (s: SavedControl) => { saved = structuredClone(s); } };
  const remote: Remote = async <T>(_s: Settings, path: string, body?: unknown): Promise<T> => {
    reads.push(path);
    if (path === "/me") return { account: { id: x.c.state.player.id }, worlds: [], sandboxes: [] } as T;
    if (path === "/worlds") return [x.c.state.world] as T;
    if (path.endsWith("/state")) return structuredClone(x.c.state) as T;
    if (path.endsWith("/rules")) return x.c.rules as T;
    if (path.endsWith("/history")) return { samples: [] } as T;
    if (path.endsWith("/map")) return x.scouting.map as T;
    if (path.endsWith("/reports/intel")) return x.detail as T;
    if (path.endsWith("/simulate/battle")) { assert.deepEqual(body, { fromReport: "intel", attacker: { raider: 10 } }); return x.battle as T; }
    if (path.endsWith("/reports")) return { reports: x.c.state.world.tick >= 118 ? [{ ...x.detail, id: "battle", kind: "battle", commandId: x.command.id, tick: 118, outcome: "won" }] : [], next: null } as T;
    assert.ok(path.endsWith("/actions")); const action = (body as { actions: Action[] }).actions[0];
    assert.deepEqual(saved.pending!.action, action); assert.equal(saved.pending!.raid?.reportId, "intel"); writes.push(structuredClone(action));
    if (mode === "reject") return { tick: 100, results: [{ ok: false, type: "send", error: { code: "TARGET_PROTECTED", message: "Changed" } }] } as T;
    if (mode === "unapplied" && first) { first = false; throw new RemoteError(429, 5000, "backoff"); }
    x.c.state.commands.outgoing.push(x.command); x.c.state.villages[0].units.home.raider = 0; x.c.state.villages[0].units.away.raider = 10;
    if (mode === "lost") throw new RemoteError(0, 5000, "lost successful response");
    return { tick: 100, results: [{ ok: true, type: "send", data: { command: x.command } }] } as T;
  };
  const create = () => Controller.create(storage, settings, remote, () => now);
  const controller = await create(); await controller.cycle();
  return { ...x, controller, create, writes, reads, saved: () => saved, advance: () => { now += 10000; } };
}
test("full report retrieval, journal-before-write and paused restart confirm one raid", async () => {
  const x = await executor(); assert.equal(x.writes.length, 1, JSON.stringify(x.controller.snapshot()));
  assert.equal(x.reads.filter(p => p.endsWith("/map")).length, 1, "same-tick preflight reuses the scoped map");
  assert.equal(x.reads.filter(p => p.endsWith("/simulate/battle")).length, 1, "same-tick immutable report assessment is reused");
  assert.equal(x.saved().pending?.phase, "accepted"); assert.equal(x.saved().scouting![0].detail!.id, "intel");
  await x.controller.setAutomatic(false); const restarted = await x.create();
  x.c.state.world.tick = 118; x.scouting.map.tick = 118; x.scouting.map.snapshotTick = 118;
  await restarted.cycle(); assert.equal(x.writes.length, 1); assert.equal(x.saved().pending, null); assert.equal(restarted.snapshot().automatic, false);
  assert.ok(restarted.snapshot().decisions.some(d => d.kind === "confirmed" && d.text.includes("Raid report")));
  assert.equal(x.reads.filter(p => p.endsWith("/map")).length, 2, "a new tick/restart reads a new map");
});
test("raid loss response suppresses replay and failures remain visible; retry retains exact ID", async () => {
  const lost = await executor("lost"); await lost.controller.setAutomatic(false); lost.advance(); await lost.controller.cycle();
  assert.equal(lost.writes.length, 1); assert.equal(lost.saved().pending, null); assert.equal(lost.saved().raids?.length, 1);
  const rejected = await executor("reject"); assert.equal(rejected.saved().pending, null);
  assert.ok(rejected.controller.snapshot().decisions.some(d => d.kind === "rejected" && d.text.includes("TARGET_PROTECTED")));
  const retry = await executor("unapplied"); retry.advance(); const restart = await retry.create(); await restart.cycle();
  assert.deepEqual(retry.writes[1], retry.writes[0]); assert.equal(retry.saved().pending?.phase, "accepted");
});
test("uncertain raid expiry pauses and epoch changes discard pending requests", async () => {
  const x = await executor("unapplied"); x.c.state.world.tick = x.saved().pending!.expiresTick; x.advance();
  await x.controller.cycle(); assert.equal(x.controller.snapshot().automatic, false); assert.equal(x.writes.length, 1);
  x.c.state.world.epoch = "new-round"; for (let i = 0; i < 7; i++) x.advance();
  await x.controller.cycle(); assert.equal(x.saved().pending, null); assert.equal(x.writes.length, 1);
});

function neutralFixture() {
  const x = fixture();
  x.c.state.villages[0].units.home.lancer = 30;
  const o = x.scouting.observations[0]; o.targetOwnerId = null;
  x.scouting.map.villages[0].ownerId = null; x.detail.defender.ownerId = null;
  o.clearing = { ...structuredClone(x.detail), id: "clearing", commandId: "clear-command", tick: 90,
    kind: "battle", outcome: "won", conquered: false };
  x.battle.attackerSurvivors = { lancer: 30 };
  const travel = Math.ceil(Math.hypot(x.scouting.map.villages[0].x-x.c.state.villages[0].x,
    x.scouting.map.villages[0].y-x.c.state.villages[0].y) * (x.c.rules.rules.UNITS as any).lancer.speed);
  x.raids.assessments[0].unit = "lancer";
  x.raids.assessments[0].baseDefense = hamletArrivalDefense(o,x.c.state,x.c.rules,travel);
  return {...x,travel};
}
test("cleared hamlet raids require scoped own victory and arrival-time militia assessment", () => {
  const x=neutralFixture(), o=x.scouting.observations[0];
  const map=x.c.rules.rules.MAP as any;
  assert.equal(hamletArrivalDefense(o,x.c.state,x.c.rules,x.travel),Math.ceil(map.hamletBaseDefense+map.hamletMilitiaPerTick*(100+x.travel-90)));
  assert.deepEqual(evaluateRaidExecution(x.c,x.scouting,x.raids)[0].action.units,{lancer:30});
  for(const mutate of [
    (y:typeof x)=>{delete y.scouting.observations[0].clearing;},
    (y:typeof x)=>{y.scouting.observations[0].clearing!.attacker.ownerId="foreign";},
    (y:typeof x)=>{y.scouting.observations[0].clearing!.defender.ownerId="bot";},
    (y:typeof x)=>{y.scouting.observations[0].clearing!.tick=96;},
    (y:typeof x)=>{y.scouting.observations[0].clearing!.conquered=true;},
    (y:typeof x)=>{y.scouting.observations[0].clearing!.outcome="lost";},
    (y:typeof x)=>{delete y.raids.assessments[0].baseDefense;},
    (y:typeof x)=>{y.raids.assessments[0].baseDefense!--;},
    (y:typeof x)=>{y.c.state.villages[0].units.home.lancer=29;},
    (y:typeof x)=>{y.c.state.villages[0].units.away.lancer=1;},
    (y:typeof x)=>{y.battle.attackerLost={lancer:1};},
  ]){const y=neutralFixture();mutate(y);assert.deepEqual(evaluateRaidExecution(y.c,y.scouting,y.raids),[],String(mutate));}
});

test("neutral scouting retains distance, deadline, scope and existing-observation guards", () => {
  const seed=()=>{const x=neutralFixture();const o=x.scouting.observations[0];o.sentTick=-600;delete o.report;delete o.detail;delete o.commandId;return x;};
  const x=seed();assert.equal(evaluateScoutDispatch(x.c,x.scouting).length,1);
  for(const mutate of [
    (y:typeof x)=>{y.scouting.map.villages[0].x=1000;},
    (y:typeof x)=>{y.c.state.world.endsAtTick=101;},
    (y:typeof x)=>{y.scouting.observations[0].scope="old-epoch";},
    (y:typeof x)=>{y.c.state.villages[0].units.home.lancer=29;},
    (y:typeof x)=>{delete y.scouting.observations[0].clearing;},
  ]){const y=seed();mutate(y);assert.deepEqual(evaluateScoutDispatch(y.c,y.scouting),[],String(mutate));}
});

test("neutral repeats require new intel and 120 ticks; house bot retries retain 600 ticks", () => {
  const x = neutralFixture();
  x.raids.attempts = [{ scope: x.scope, villageId: "v1", targetId: x.detail.defender.id, reportId: "previous-intel", sentTick: -20 }];
  assert.equal(evaluateRaidExecution(x.c, x.scouting, x.raids).length, 1, "120 ticks permits newly scouted neutral raid");
  x.raids.attempts[0].sentTick++;
  assert.deepEqual(evaluateRaidExecution(x.c, x.scouting, x.raids), [], "119 ticks defers neutral raid");
  x.raids.attempts[0].sentTick = -20;
  x.raids.attempts[0].reportId = x.detail.id;
  assert.deepEqual(evaluateRaidExecution(x.c, x.scouting, x.raids), [], "consumed report never authorizes another raid");
  const bot = fixture();
  bot.raids.attempts = [{ scope: bot.scope, villageId: "v1", targetId: bot.detail.defender.id, reportId: "previous-intel", sentTick: -20 }];
  assert.deepEqual(evaluateRaidExecution(bot.c, bot.scouting, bot.raids), [], "house bot still waits 600 ticks");
  bot.raids.attempts[0].sentTick = -500;
  assert.equal(evaluateRaidExecution(bot.c, bot.scouting, bot.raids).length, 1);
});

test("only consumed neutral intelligence allows fresh reconnaissance before expiry", () => {
  const x = neutralFixture();
  x.scouting.observations[0].sentTick = -20;
  assert.deepEqual(evaluateScoutDispatch(x.c, x.scouting), [], "fresh unused intel avoids redundant scouting");
  x.scouting.consumedReportIds = [x.detail.id];
  assert.equal(evaluateScoutDispatch(x.c, x.scouting).length, 1, "new pair may scout after exact 120-tick cooldown");
  x.scouting.observations[0].sentTick++;
  assert.deepEqual(evaluateScoutDispatch(x.c, x.scouting), []);
  const bot = fixture(); bot.scouting.consumedReportIds = [bot.detail.id]; bot.scouting.observations[0].sentTick = -600;
  assert.deepEqual(evaluateScoutDispatch(bot.c, bot.scouting), [], "house bot behavior is unchanged");
});

test("controller never replaces a newer neutral victory with an older retained report", async () => {
  const x = neutralFixture();
  const newest = { ...structuredClone(x.scouting.observations[0].clearing!), id: "newest-victory", tick: 98 };
  const settings: Settings = { serverUrl: "https://sandbox.invalid", worldId: x.c.state.world.id, apiKey: "test" };
  let saved: SavedControl = { settings, pending: null, automatic: false, decisions: [], scouting: [
    ...x.scouting.observations,
    { scope: x.scope, villageId: "v1", targetId: x.detail.defender.id, targetOwnerId: null, sentTick: -600, clearing: newest },
  ] };
  const storage = { load: async () => structuredClone(saved), save: async (s: SavedControl) => { saved = structuredClone(s); } };
  const reads: string[] = [];
  const remote: Remote = async <T>(_s: unknown, path: string): Promise<T> => {
    reads.push(path);
    if (path === "/me") return { account: { id: x.c.state.player.id }, worlds: [], sandboxes: [] } as T;
    if (path === "/worlds") return [x.c.state.world] as T;
    if (path.endsWith("/state")) return x.c.state as T;
    if (path.endsWith("/rules")) return x.c.rules as T;
    if (path.endsWith("/history")) return { samples: [] } as T;
    if (path.endsWith("/map")) return x.scouting.map as T;
    if (path.endsWith("/reports")) return { reports: [newest, x.scouting.observations[0].clearing], next: null } as T;
    if (path.endsWith("/simulate/battle")) return x.battle as T;
    throw new Error(`Unexpected read ${path}`);
  };
  const c = await Controller.create(storage, settings, remote); await c.cycle(); await c.cycle();
  assert.equal(c.snapshot().error, null);
  assert.ok(saved.scouting?.some(o => o.clearing?.id === newest.id));
  assert.equal(reads.some(p => p.includes("/reports/")), false, "older clearing detail must not be reloaded");
  assert.equal(c.snapshot().automatic, false);
});
