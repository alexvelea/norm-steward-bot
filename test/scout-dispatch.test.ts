import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateScoutDispatch, usableScoutObservation, type ScoutObservation, type ScoutingContext } from "../src/advisors/scout-dispatch.js";
import { developedContext as context } from "./control-fixtures.js";
import { Controller } from "../src/control/controller.js";
import { RemoteError, type Remote } from "../src/control/remote.js";
import type { Action, MapResponse, OutgoingCommand, ReportSummary } from "../src/shared/api.js";
import type { SavedControl, Settings } from "../src/control/types.js";

function fixture() {
  const c = context(); const v = c.state.villages[0];
  v.hidden = 1000; v.units.home = { pikeman: 10, shieldman: 5, raider: 10, scout: 2 };
  v.buildings.barracks = 5; v.buildings.stable = 1; v.buildings.smithy = 5;
  const target: MapResponse["villages"][number] = { id: "bot-village", name: "Warden", ownerId: "bot", ownerName: "Bot", x: 2, y: 1, points: 50 };
  const map: MapResponse = { tick: 100, snapshotTick: 100, size: 100, villages: [target], players: [{ id: "bot", name: "Bot", houseBot: "warden", protectedUntilTick: null, points: 50, villages: 1 }] };
  const scouting: ScoutingContext = { scope: "scope", map, observations: [] };
  const command: OutgoingCommand = { id: "command", seq: 1, kind: "attack", returning: false,
    from: { id: v.id, name: v.name, ownerId: c.state.player.id, ownerName: "Tester", x: 1, y: 1 }, to: target,
    units: { scout: 2 }, aim: null, sentTick: 100, arrivalTick: 109, cancellableUntilTick: 108, loot: null, raidOrder: null };
  const report: ReportSummary = { id: "report", commandId: command.id, tick: 109, kind: "scouting", role: "attacker", attacker: command.from, defender: command.to, outcome: "scouted", conquered: false, read: false };
  const observation: ScoutObservation = { scope: "scope", villageId: v.id, targetId: target.id, targetOwnerId: "bot", sentTick: 100, commandId: command.id, report };
  return { c, scouting, command, report, observation };
}

test("bounded dispatch uses only two Scouts and skips protected, human, distant and late targets", () => {
  const x = fixture();
  assert.deepEqual(evaluateScoutDispatch(x.c, x.scouting)[0].action, { type: "send", village: "v1", target: "bot-village", kind: "attack", units: { scout: 2 } });
  for (const mutate of [
    (y: typeof x) => { y.c.state.player.protectedUntilTick = 101; },
    (y: typeof x) => { y.scouting.map.players[0].protectedUntilTick = 101; },
    (y: typeof x) => { y.scouting.map.players[0].houseBot = null; },
    (y: typeof x) => { y.scouting.map.villages[0].x = 99; },
    (y: typeof x) => { y.c.state.world.endsAtTick = 177; },
    (y: typeof x) => { y.c.state.villages[0].units.home.scout = 1; },
    (y: typeof x) => { y.c.state.commands.outgoing.push(y.command); },
    (y: typeof x) => { y.scouting.observations.push(y.observation); },
    (y: typeof x) => { y.scouting.map.snapshotTick = 69; },
    (y: typeof x) => { y.c.state.villages[0].orders.raids.push({} as never); },
  ]) { const y = fixture(); mutate(y); assert.equal(evaluateScoutDispatch(y.c, y.scouting).length, 0); }
});
test("observation use requires journal provenance, exact command, owner, epoch scope and bounded age", () => {
  const x = fixture(); x.c.state.world.tick = 409; x.scouting.map.tick = 409; x.scouting.map.snapshotTick = 409;
  assert.equal(usableScoutObservation(x.observation, x.c.state, x.scouting.map, "scope"), true);
  for (const mutate of [
    (y: typeof x) => { y.c.state.world.tick = 410; },
    (y: typeof x) => { y.observation.scope = "old-epoch"; },
    (y: typeof x) => { y.scouting.map.villages[0].ownerId = "new-owner"; },
    (y: typeof x) => { y.observation.report!.outcome = "failed"; },
    (y: typeof x) => { y.observation.report!.commandId = "other"; },
    (y: typeof x) => { y.observation.report!.tick = 410; },
    (y: typeof x) => { y.observation.report!.role = "defender"; },
    (y: typeof x) => { y.observation.report!.attacker.ownerId = "other-account"; },
  ]) { const y = structuredClone(x); mutate(y); assert.equal(usableScoutObservation(y.observation, y.c.state, y.scouting.map, "scope"), false); }
});

async function executor(mode: "ok" | "lost" | "reject" | "unapplied" = "ok") {
  const x = fixture(); let saved: SavedControl | null = null; let now = 0; const writes: Action[] = []; let fail = true;
  const storage = { load: async () => structuredClone(saved), save: async (v: SavedControl) => { saved = structuredClone(v); } };
  const settings: Settings = { serverUrl: "https://sandbox.invalid", worldId: x.c.state.world.id, apiKey: "test" };
  const request: Remote = async <T>(_s: Settings, path: string, body?: unknown): Promise<T> => {
    if (path === "/me") return { account: { id: x.c.state.player.id }, worlds: [], sandboxes: [] } as T;
    if (path === "/worlds") return [x.c.state.world] as T;
    if (path.endsWith("/state")) return structuredClone(x.c.state) as T;
    if (path.endsWith("/rules")) return x.c.rules as T;
    if (path.endsWith("/history")) return { samples: [] } as T;
    if (path.endsWith("/map")) return x.scouting.map as T;
    if (path.endsWith("/reports")) return { reports: x.c.state.world.tick >= 109 ? [x.report] : [], next: null } as T;
    const action = (body as { actions: Action[] }).actions[0];
    assert.deepEqual(saved!.pending!.action, action, "journal before POST"); writes.push(structuredClone(action));
    if (mode === "reject") return { tick: 100, results: [{ ok: false, type: "send", error: { code: "TARGET_PROTECTED", message: "Target changed" } }] } as T;
    if (mode === "unapplied" && fail) { fail = false; throw new RemoteError(429, 5000, "backoff"); }
    x.c.state.commands.outgoing.push(x.command); x.c.state.villages[0].units.home.scout = 0; x.c.state.villages[0].units.away.scout = 2;
    if (mode === "lost") throw new RemoteError(0, 5000, "lost response");
    return { tick: 100, results: [{ ok: true, type: "send", data: { command: x.command } }] } as T;
  };
  const create = () => Controller.create(storage, settings, request, () => now);
  const controller = await create(); await controller.cycle();
  return { ...x, controller, create, writes, saved: () => saved!, advance: () => { now += 10000; } };
}
test("shared executor journals dispatch and confirms a report across a paused restart", async () => {
  const x = await executor(); assert.equal(x.writes[0].type, "send"); assert.equal(x.saved().pending?.phase, "accepted");
  await x.controller.setAutomatic(false); const restarted = await x.create();
  x.c.state.world.tick = 109; x.scouting.map.tick = 109; x.scouting.map.snapshotTick = 109;
  await restarted.cycle(); assert.equal(x.writes.length, 1); assert.equal(restarted.snapshot().automatic, false);
  assert.equal(x.saved().pending, null); assert.equal(x.saved().scouting?.[0].report?.id, "report");
  assert.ok(restarted.snapshot().decisions.some(d => d.kind === "confirmed" && d.text.includes("Scouting report")));
});
test("lost send response suppresses duplicates, rejected actions stay visible, retries preserve exact IDs", async () => {
  const lost = await executor("lost"); await lost.controller.setAutomatic(false); lost.advance(); await lost.controller.cycle();
  assert.equal(lost.writes.length, 1); assert.equal(lost.saved().pending, null); assert.equal(lost.saved().scouting?.length, 1);
  const rejected = await executor("reject"); assert.equal(rejected.saved().pending, null);
  assert.ok(rejected.controller.snapshot().decisions.some(d => d.kind === "rejected" && d.text.includes("TARGET_PROTECTED")));
  const retry = await executor("unapplied"); const first = retry.writes[0]; retry.advance(); const restarted = await retry.create(); await restarted.cycle();
  assert.deepEqual(retry.writes[1], first); assert.equal(retry.saved().pending?.phase, "accepted");
});
test("uncertain expiry pauses and a different epoch never replays a Scout command", async () => {
  const x = await executor("unapplied"); x.c.state.world.tick = x.saved().pending!.expiresTick; x.advance();
  await x.controller.cycle(); assert.equal(x.controller.snapshot().automatic, false); assert.equal(x.writes.length, 1);
  x.c.state.world.epoch = "reset"; for (let i = 0; i < 7; i++) x.advance(); await x.controller.cycle();
  assert.equal(x.saved().pending, null); assert.equal(x.writes.length, 1);
});

test("scouting leaves time for the follow-up raid, with equality allowed", () => {
  for (const neutral of [false, true]) {
    const x = fixture(), v = x.c.state.villages[0], t = x.scouting.map.villages[0];
    if (neutral) {
      t.ownerId = null;
      v.units.home.lancer = 30;
      x.scouting.observations.push({ scope: "scope", villageId: v.id, targetId: t.id, targetOwnerId: null,
        sentTick: -600, clearing: { outcome: "won", defender: { ownerId: null } } as never });
    }
    const units = x.c.rules.rules.UNITS as Record<string, { speed: number }>;
    const distance = Math.hypot(t.x-v.x,t.y-v.y);
    const scout = Math.ceil(distance*units.scout.speed);
    const raid = Math.ceil(distance*units[neutral ? "lancer" : "raider"].speed);
    x.c.state.world.endsAtTick = 100 + scout + 2*raid + 60;
    assert.equal(evaluateScoutDispatch(x.c,x.scouting).length,1, "exact follow-up deadline is usable");
    x.c.state.world.endsAtTick--;
    assert.ok(100+2*scout+60 <= x.c.state.world.endsAtTick, "old Scout-only deadline still fits");
    assert.deepEqual(evaluateScoutDispatch(x.c,x.scouting),[], "one tick too short for raid return");
    x.c.state.world.endsAtTick++;
    units[neutral ? "lancer" : "raider"].speed = NaN;
    assert.deepEqual(evaluateScoutDispatch(x.c,x.scouting),[], "unknown live combat timing cannot establish a window");
  }
});
