// Small wire objects for the dashboard tests: only the fields the dashboard reads.
import type { ReportSummary, StateResponse, WorldSummary } from "../src/contract";

export function summary(over: Partial<WorldSummary> = {}): WorldSummary {
  return {
    id: "tiny",
    name: "Tiny",
    kind: "blitz",
    status: "running",
    speed: 5,
    tick: 0,
    round: 1,
    endsAtTick: 150,
    size: 40,
    players: 3,
    villages: 3,
    rulesVersion: 1,
    epoch: "r1.0",
    actIntervalTicks: null,
    ...over,
  };
}

export function state(over: { playerId?: string; tick?: number; unreadReports?: number; world?: WorldSummary } = {}): StateResponse {
  const world = over.world ?? summary({ tick: over.tick ?? 0 });
  return {
    world,
    serverTime: "2026-11-14T00:00:00.000Z",
    player: { id: over.playerId ?? "p1", name: "ironwright", points: 10, score: 10, rank: 1, renown: { attack: 0, defense: 0 }, villages: 1, protectedUntilTick: null, nextActTick: null },
    villages: [],
    commands: { outgoing: [], incoming: [] },
    trades: { outgoing: [], incoming: [] },
    scheduled: [],
    notes: "",
    unreadReports: over.unreadReports ?? 0,
    eventsCursor: 0,
  };
}

export function report(id: string, read = false): ReportSummary {
  const v = { id: "v1", name: "Barleygate", x: 1, y: 1 };
  return { id, tick: 10, kind: "battle", role: "attacker", commandId: null, attacker: v, defender: v, outcome: "won", conquered: false, read } as ReportSummary;
}
