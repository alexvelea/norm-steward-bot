// The dev backend behind ?mock=1: two invented worlds, fed through the same WorldFeed as the live
// client. "mock" is your own sandbox (you play, you hold the clock, god view on offer); "mock-blitz"
// is a big public world watched as a spectator. Loaded as its own chunk, never in normal use.
import type { MeResponse, Report, RotateKeyResponse, SandboxControlRequest, SignupResponse, StreamMessage, WorldSummary } from "../contract";
import { MAP, SANDBOX, SERVER } from "../contract";
import { hashString } from "../lib/noise";
import { WorldFeed } from "../world/feed";
import type { Backend } from "../world/backend";
import type { WorldClient } from "../world/types";
import { MockWorld, YOU, type MockWorldSpec } from "./mockWorld";

const SPECS: Record<string, MockWorldSpec> = {
  mock: { id: "mock", name: "Ashfen Marches", kind: "sandbox", size: MAP.size.sandbox, players: 34, withYou: true },
  "mock-blitz": { id: "mock-blitz", name: "Blitz · Cinder Reach", kind: "blitz", size: MAP.size.blitz, players: 120, withYou: false },
};

const TICK_MS = 1000 / SERVER.tickMessagesPerSecond;
const STATE_MS = 1000 / SERVER.stateMessagesPerSecond;

/** A world keeps running while you move between pages, as a server's would. */
const worlds = new Map<string, MockWorld>();
const listeners = new Map<string, Set<(m: StreamMessage) => void>>();

function worldFor(id: string): MockWorld | null {
  const spec = SPECS[id];
  if (!spec) return null;
  let world = worlds.get(id);
  if (!world) {
    world = new MockWorld(spec, (m) => listeners.get(id)?.forEach((l) => l(m)));
    worlds.set(id, world);
    startClock(world);
  }
  return world;
}

function startClock(world: MockWorld): void {
  let carry = 0;
  let last = performance.now();
  let lastState = 0;
  setInterval(() => {
    const now = performance.now();
    if (world.status === "running") {
      carry += ((now - last) / 1000) * world.speed;
      const whole = Math.floor(carry);
      carry -= whole;
      for (let i = 0; i < whole; i++) world.advance();
    } else {
      carry = 0;
    }
    last = now;
    const send = (m: StreamMessage) => listeners.get(world.spec.id)?.forEach((l) => l(m));
    send({ type: "tick", tick: world.tick, status: world.status, speed: world.speed });
    if (world.spec.kind === "sandbox") send({ type: "god", tick: world.tick, movements: world.godMovements(), battles: [] });
    if (now - lastState >= STATE_MS) {
      lastState = now;
      const state = world.state();
      if (state) send({ type: "state", state });
    }
  }, TICK_MS);
}

class MockWorldClient implements WorldClient {
  private readonly feed: WorldFeed;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly worldId: string,
    private readonly keyed: boolean,
  ) {
    this.feed = new WorldFeed(worldId, {
      epochChanged: () => undefined,
      pointsRefreshed: () => {
        const world = worldFor(this.worldId);
        if (world) this.feed.leaderboard(world.leaderboard());
      },
      historySampled: () => {
        const world = worldFor(this.worldId);
        if (world && this.keyed) this.feed.history({ samples: world.history() });
      },
    });
  }

  get store() {
    return this.feed.store;
  }

  start(): void {
    const world = worldFor(this.worldId);
    if (!world) {
      this.feed.patch({ fatal: "There's no such world, or it's a sandbox that isn't yours.", connection: "offline" });
      return;
    }
    const mine = this.keyed && world.spec.withYou;
    this.feed.summary(world.summary());
    this.feed.map(world.map());
    this.feed.leaderboard(world.leaderboard());
    const state = mine ? world.state() : null;
    if (state) {
      this.feed.state(state);
      this.feed.activity(world.activity());
      this.feed.history({ samples: world.history() });
      this.feed.reports({ reports: world.reportList(), next: null }, false);
    }
    this.feed.message({
      type: "welcome",
      world: world.summary(),
      authenticated: this.keyed,
      playerId: mine ? YOU.id : null,
      channels: mine ? ["tick", "events", "state", "activity", "map", ...(world.spec.kind === "sandbox" ? (["god"] as const) : [])] : ["tick", "map"],
    });
    const listener = (m: StreamMessage) => {
      // Private channels reach only the key that owns them, as on the server.
      if (!mine && (m.type === "event" || m.type === "state" || m.type === "activity" || m.type === "god")) return;
      this.feed.message(m);
    };
    const set = listeners.get(this.worldId) ?? new Set();
    set.add(listener);
    listeners.set(this.worldId, set);
    this.unsubscribe = () => set.delete(listener);
  }

  stop(): void {
    this.unsubscribe?.();
  }

  async fetchReport(id: string): Promise<Report> {
    const report = worldFor(this.worldId)?.report(id);
    if (!report) throw new Error("No such report");
    this.feed.markReportRead(id);
    return report;
  }

  async fetchMoreReports(): Promise<void> {}

  async join(): Promise<void> { throw new Error("Manual commands need a live world; leave mock mode first."); }
  async act(): Promise<never> { throw new Error("Manual commands need a live world; leave mock mode first."); }

  async control(request: SandboxControlRequest): Promise<void> {
    const world = worldFor(this.worldId);
    if (!world || world.spec.kind !== "sandbox") throw new Error("Not a sandbox");
    switch (request.action) {
      case "pause":
        world.status = "paused";
        break;
      case "resume":
        world.status = "running";
        break;
      case "step":
        for (let i = 0; i < Math.min(request.ticks, SANDBOX.stepMax); i++) world.advance();
        world.status = "paused";
        break;
      case "set_speed":
        world.speed = Math.min(SANDBOX.speedMax, Math.max(SANDBOX.speedMin, request.speed));
        break;
      case "run_until": {
        const until = request.tick ?? world.tick + 60;
        while (world.tick < until && world.status !== "ended") world.advance();
        world.status = "paused";
        break;
      }
    }
    this.feed.summary(world.summary());
    const state = world.state();
    if (state) this.feed.state(state);
  }
}

function fakeKey(seed: string): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let key = "nsk_";
  let h = hashString(seed);
  for (let i = 0; i < 43; i++) {
    h = hashString(String(h), i);
    key += alphabet[h % alphabet.length];
  }
  return key;
}

export const mockBackend: Backend = {
  async listWorlds(): Promise<WorldSummary[]> {
    return Object.keys(SPECS).map((id) => worldFor(id)!.summary());
  },
  async signup(name: string): Promise<SignupResponse> {
    return { account: { id: YOU.accountId, name, createdAt: new Date().toISOString() }, apiKey: fakeKey(name) };
  },
  async me(): Promise<MeResponse> {
    return { account: { id: YOU.accountId, name: YOU.name, createdAt: new Date().toISOString() }, worlds: [{ worldId: "mock", playerId: YOU.id, villages: 4 }], sandboxes: ["mock"] };
  },
  async rotateKey(key: string): Promise<RotateKeyResponse> {
    return { apiKey: fakeKey(`${key}:rotated`) };
  },
  // In the mock, "mock" always shows your own view so the panels can be tuned without pasting a key.
  worldClient: (worldId, key) => new MockWorldClient(worldId, worldId === "mock" || !!key),
};
