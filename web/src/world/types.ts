// What the world page knows, fed by a WorldClient (the live server, or the dev mock with ?mock=1).
import type {
  Action,
  ActionsResponse,
  ActivityEntry,
  GodBattle,
  GodMovement,
  HistorySample,
  LeaderboardResponse,
  MapPlayer,
  MapVillage,
  Report,
  ReportSummary,
  SandboxControlRequest,
  StateResponse,
  StreamChannel,
  WorldStatus,
  WorldSummary,
} from "../contract";
import type { Store } from "../lib/store";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

/** The last tick the server told us about, and when (performance.now()), so motion can run between messages. */
export interface Clock {
  tick: number;
  receivedAt: number;
  speed: number;
  status: WorldStatus;
  /** A lockstep sandbox: "running", but the clock moves only while its creator waits for events. */
  lockstep?: boolean;
}

export interface PublicMap {
  size: number;
  snapshotTick: number;
  villages: ReadonlyMap<string, MapVillage>;
  players: ReadonlyMap<string, MapPlayer>;
}

/** A flash on the map: a battle burst or a conquest shockwave. */
export interface Effect {
  id: string;
  kind: "battle" | "conquest";
  x: number;
  y: number;
  /** performance.now() when it started. */
  startedAt: number;
  color: string;
  /** A win or a conquest burns brighter. */
  strong: boolean;
  /** Seen only through the god channel: drawn only while the god view is on. */
  god?: boolean;
}

export interface GodView {
  tick: number;
  movements: GodMovement[];
  battles: GodBattle[];
}

export interface WorldView {
  worldId: string;
  summary: WorldSummary | null;
  connection: ConnectionState;
  /** Why the page can't show the world, when it can't. */
  fatal: string | null;
  /** Something worth telling (a rejected key, a stream error), dismissable. */
  notice: string | null;
  /** The key was given and the server accepted it. */
  authenticated: boolean;
  playerId: string | null;
  channels: StreamChannel[];
  /** This key created this sandbox: it controls the clock and may see the god view. */
  isCreator: boolean;
  clock: Clock;
  map: PublicMap;
  state: StateResponse | null;
  leaderboard: LeaderboardResponse | null;
  history: HistorySample[];
  /** Newest first. */
  activity: ActivityEntry[];
  /** Newest first. */
  reports: ReportSummary[];
  reportsNext: string | null;
  god: GodView | null;
  effects: Effect[];
}

export interface WorldClient {
  readonly store: Store<WorldView>;
  start(): void;
  stop(): void;
  fetchReport(id: string): Promise<Report>;
  fetchMoreReports(): Promise<void>;
  join(): Promise<void>;
  act(actions: Action[]): Promise<ActionsResponse>;
  control(request: SandboxControlRequest): Promise<void>;
}

export function emptyView(worldId: string): WorldView {
  return {
    worldId,
    summary: null,
    connection: "connecting",
    fatal: null,
    notice: null,
    authenticated: false,
    playerId: null,
    channels: [],
    isCreator: false,
    clock: { tick: 0, receivedAt: 0, speed: 1, status: "running" },
    map: { size: 0, snapshotTick: 0, villages: new Map(), players: new Map() },
    state: null,
    leaderboard: null,
    history: [],
    activity: [],
    reports: [],
    reportsNext: null,
    god: null,
    effects: [],
  };
}

/** How long a map effect plays, in ms. */
export const EFFECT_MS = { battle: 1700, conquest: 2600 } as const;

export function pruneEffects(effects: Effect[], now: number): Effect[] {
  const alive = effects.filter((e) => now - e.startedAt < EFFECT_MS[e.kind]);
  return alive.length === effects.length ? effects : alive;
}
