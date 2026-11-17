// The wire contract: every shape the REST API, the stream and MCP send or accept.
// docs/api.md describes the endpoints and the semantics; this file is the one definition of the shapes.
// The server, the dashboard and the TypeScript starter bot all import from here.
// Add fields freely; never rename or remove one without bumping the API version.

import type { AttackType, BuildingId, Cost, Resource, UnitId } from "../rules/config.js";

export type { AttackType, BuildingId, Resource, UnitId };
export type Resources = Cost;
export type UnitCounts = Partial<Record<UnitId, number>>;
export type BuildingLevels = Record<BuildingId, number>;
export type TrainingBuilding = "barracks" | "stable" | "workshop" | "court";

// ---------------------------------------------------------------------------------------------
// Errors

export type ErrorCode =
  | "UNAUTHORIZED" // 401: missing or wrong API key
  | "FORBIDDEN" // 403: e.g. a dashboard-marked write
  | "NOT_FOUND" // 404: doesn't exist, or isn't yours (the two answer the same)
  | "VALIDATION" // 400: the request doesn't match the shape; details.issues lists each problem
  | "RATE_LIMITED" // 429: details.retryAfterMs, or on Council details.nextActTick
  | "NOT_IN_WORLD" // 409: join the world first
  | "WORLD_NOT_RUNNING" // 409: the round has ended (a paused sandbox still accepts actions)
  | "NAME_TAKEN" // 409
  | "LIMIT_REACHED" // 409: e.g. too many sandboxes, too many commands out, too many scheduled actions
  | "CURSOR_EXPIRED" // reserved
  | "INTERNAL" // 500: a bug on the server's side; the message says nothing more
  // Action errors: returned per action in a batch (the batch itself answers 200)
  | "INSUFFICIENT_RESOURCES" // details: { missing: Resources, availableAtTick: number | null, inTicks: number | null }
  | "INSUFFICIENT_POPULATION" // details: { needed: number, free: number }
  | "EXCEEDS_STORAGE" // one item costs more than the storehouse holds: details: { capacity }
  | "QUEUE_FULL" // details: { max }
  | "REQUIREMENTS_NOT_MET" // details: { requires: Partial<Record<BuildingId, number>> }
  | "MAX_LEVEL" // details: { maxLevel }
  | "NOT_ENOUGH_UNITS" // details: { missing: UnitCounts }
  | "NO_UNITS" // a command with no units
  | "TOO_SMALL" // an attack under COMBAT.minAttackPop: details: { minPop, pop }
  | "INVALID_TARGET" // details.reason: "self" | "own_village" | "hamlet_support" | "hamlet_trade" | "trade_before_protection_end"
  | "TARGET_PROTECTED" // details: { protectedUntilTick }
  | "NOT_ENOUGH_MERCHANTS" // details: { needed, available }
  | "CANCEL_WINDOW_PASSED" // details: { cancellableUntilTick }
  | "COOLDOWN" // details: { readyAtTick }
  | "TOO_LATE" // arriveAtTick can't be met: details: { earliestArrivalTick }
  | "IDEMPOTENCY_CONFLICT" // a clientId reused for a different action: details: { clientId }
  // Standing orders only (order_paused): a raid lost its battle, or lost more than stopIfLoss of what it sent
  | "RAID_LOST";

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** Every non-2xx response body. */
export interface ErrorResponse {
  error: ApiError;
}

// ---------------------------------------------------------------------------------------------
// Accounts and worlds

export interface Account {
  id: string;
  name: string;
  createdAt: string; // ISO 8601
}

export interface SignupRequest {
  /** 3–24 letters, digits, `_` or `-`. Unique, case-insensitive. */
  name: string;
}
export interface SignupResponse {
  account: Account;
  /** `nsk_` + 43 base62 chars. Shown once; the server keeps only its hash. */
  apiKey: string;
}
export interface RotateKeyResponse {
  apiKey: string;
}

export interface MeResponse {
  account: Account;
  worlds: { worldId: string; playerId: string; villages: number }[];
  sandboxes: string[];
}

export type WorldKind = "blitz" | "council" | "sandbox";
export type WorldStatus = "running" | "paused" | "ended";
export type SandboxClock = "realtime" | "lockstep";

export interface WorldSummary {
  id: string;
  name: string;
  kind: WorldKind;
  status: WorldStatus;
  /** Ticks per real second. */
  speed: number;
  tick: number;
  round: number;
  endsAtTick: number;
  size: number;
  players: number;
  villages: number;
  rulesVersion: number;
  /** Changes when the round changes or the server restores the world from a snapshot. When it differs from the one you saw, re-read /state. */
  epoch: string;
  /** Council: one batch of actions per this many ticks. Null elsewhere. */
  actIntervalTicks: number | null;
  /** Sandboxes only. */
  ownerId?: string;
  clock?: SandboxClock;
  /** Sandboxes only, and only for their creator. */
  seed?: number;
}

export type HouseBotKind = "warden" | "reaver" | "sovereign";

export interface CreateSandboxRequest {
  name?: string;
  /** Ticks per real second, SANDBOX.speedMin..speedMax. Default SANDBOX.speedDefault. */
  speed?: number;
  /** SANDBOX.durationMin..durationMax. Default SANDBOX.durationDefault. */
  durationTicks?: number;
  seed?: number;
  /** House bots seated at tick 0. Total 0..SANDBOX.houseBotsMax. Default one of each. */
  houseBots?: Partial<Record<HouseBotKind, number>>;
  /** "lockstep": the clock moves only while you wait for events (GET /events with wait, or MCP wait_for_events), ticksPerTurn at a time or until your next event. Default "realtime". */
  clock?: SandboxClock;
  ticksPerTurn?: number;
  /** Starts paused. Default false. */
  paused?: boolean;
}

export type SandboxControlRequest =
  | { action: "pause" }
  | { action: "resume" }
  /** Advance N ticks (1..SANDBOX.stepMax) then stay paused. wait:true returns StateResponse after completion or timeout. */
  | { action: "step"; ticks: number; wait?: boolean }
  | { action: "set_speed"; speed: number }
  /** Advance until `tick`, or until your next event when untilEvent is true (both: whichever comes first), then pause. */
  | { action: "run_until"; tick?: number; untilEvent?: boolean };

/** StateResponse for step with wait:true; WorldSummary for all other control requests. */
export type SandboxControlResponse = WorldSummary | StateResponse;

export interface SandboxLogEntry {
  tick: number;
  seq: number;
  playerId: string;
  action: Action;
  ok: boolean;
  /** Who applied it: the player's own call (scheduled ones are logged when submitted), their standing orders, or a house bot. */
  by: "player" | "orders" | "house_bot";
}

export interface SandboxLogResponse {
  entries: SandboxLogEntry[];
}

// ---------------------------------------------------------------------------------------------
// Rules (GET /worlds/{w}/rules)

export interface LevelRow {
  level: number;
  cost: Resources;
  /** Build ticks at hall level 0, before rounding; multiply by HALL_SPEED_BASE^hall and round, or use ticksByHall. */
  ticksAtHall0: number;
  /** Index = hall level (0..hall maxLevel): the exact build ticks, max(1, round(ticksAtHall0 * HALL_SPEED_BASE^hall)). */
  ticksByHall: number[];
  /** Total population at this level. */
  pop: number;
  points: number;
}

export interface RulesTables {
  buildings: Record<BuildingId, LevelRow[]>;
  /** Index = level (0..30): production per minute and per tick (milli-units). */
  production: { level: number; perMinute: number; perTickMilli: number }[];
  storage: number[];
  cellar: number[];
  farm: number[];
  merchants: number[];
  hallSpeed: number[];
  /** Index = building level (0..25): seconds-per-unit multiplier speedBase^(max(1,L)-1). */
  trainSpeed: number[];
  watchtowerRadius: number[];
}

export interface RulesResponse {
  version: number;
  /** Every export of src/rules/config.ts, as JSON (no Infinity or NaN; an open bound is null). */
  rules: Record<string, unknown>;
  tables: RulesTables;
}

// ---------------------------------------------------------------------------------------------
// The state a steward reads

export interface VillageRef {
  id: string;
  name: string;
  x: number;
  y: number;
  ownerId: string | null;
  ownerName: string | null;
}

export interface BuildQueueItem {
  id: string;
  building: BuildingId;
  /** The level it will build (current level + its place among this building's queued levels). */
  level: number;
  cost: Resources;
  /** Null until it starts. */
  startTick: number | null;
  /** Fixed once started; for waiting items, computed by running the queue in order (earlier hall levels speed later items). */
  endTick: number;
}

export interface TrainBatch {
  id: string;
  unit: UnitId;
  count: number;
  /** Units still to come out (the one in progress included). */
  remaining: number;
  /** What was paid per unit (envoys: with the multiplier). */
  costEach: Resources;
  /** When the next unit comes out; null while an earlier batch in this building is running. */
  nextTick: number | null;
  /** When the last unit comes out, at today's building level. */
  endTick: number;
}

export interface SupportStack {
  /** The village the troops came from. */
  home: VillageRef;
  /** The village they're stationed in. */
  at: VillageRef;
  units: UnitCounts;
}

export interface BuildOption {
  building: BuildingId;
  /** The level the next queue item would build. A maxed building shows maxLevel with zero cost, ticks and pop. */
  level: number;
  cost: Resources;
  /** At today's hall level. */
  ticks: number;
  /** Extra population that level needs. */
  pop: number;
  ok: boolean;
  /** Every reason it would fail, in the check order of api.md. */
  blockers: ErrorCode[];
  /** Non-null only when the blockers are exactly ["INSUFFICIENT_RESOURCES"]: when production alone covers it. */
  affordableAtTick: number | null;
}

export interface TrainOption {
  unit: UnitId;
  /** Cost of one (envoys: with the multiplier). */
  cost: Resources;
  ticksEach: number;
  pop: number;
  /** min(trainBatchMax, affordable, free pop / pop); 0 if any blocker other than INSUFFICIENT_RESOURCES applies. */
  maxCount: number;
  ok: boolean;
  blockers: ErrorCode[];
  /** For one unit, as BuildOption.affordableAtTick. */
  affordableAtTick: number | null;
}

export interface StandingOrders {
  build: { building: BuildingId; toLevel: number }[];
  train: { unit: UnitId; keep: number; batch?: number }[];
  raids: { target: string; units: UnitCounts; stopIfLoss?: number }[];
  /** Which orders are paused, and why. An order is resumed by setting the orders again. */
  paused: { order: "build" | "train" | "raid"; index: number; code: ErrorCode; atTick: number }[];
}

export type SetOrdersRequest = Omit<StandingOrders, "paused">;

export interface VillageState {
  id: string;
  name: string;
  x: number;
  y: number;
  points: number;
  loyalty: number;
  /** Whole units, rounded down. */
  resources: Resources;
  /** Exact, in milli-units. */
  resourcesMilli: Resources;
  /** Per resource. */
  storage: number;
  /** Per resource, safe from raiders. */
  hidden: number;
  /** Per minute (60 ticks). */
  production: Resources;
  /** Per tick, in milli-units. */
  productionPerTickMilli: Resources;
  population: { used: number; max: number };
  buildings: BuildingLevels;
  buildQueue: BuildQueueItem[];
  training: Record<TrainingBuilding, TrainBatch[]>;
  units: {
    /** This village's own troops, in the village. */
    home: UnitCounts;
    /** This village's own troops anywhere else: marching, coming home, or stationed elsewhere. */
    away: UnitCounts;
  };
  /** Troops from other villages (yours or anyone's) stationed here. */
  supportHere: SupportStack[];
  /** This village's troops stationed in other villages. */
  supportAbroad: SupportStack[];
  merchants: { total: number; available: number };
  /** Null when it can be renamed now. */
  renameReadyTick: number | null;
  orders: StandingOrders;
  options: { build: BuildOption[]; train: TrainOption[] };
}

export type CommandKind = "attack" | "support";

export interface OutgoingCommand {
  id: string;
  /** World-wide order of sending: the tie-break for arrivals in the same tick. */
  seq: number;
  kind: CommandKind;
  /** True once it has turned round (after resolving, after a cancel, or a recall). */
  returning: boolean;
  from: VillageRef;
  to: VillageRef;
  /** What marches: once returning, the survivors. */
  units: UnitCounts;
  /** Trebuchet target; null for support and for attacks without trebuchets. */
  aim: BuildingId | null;
  sentTick: number;
  /** When it reaches `to` (or, when returning, home). */
  arrivalTick: number;
  /** Last tick it can be cancelled; null once it can't. */
  cancellableUntilTick: number | null;
  /** What it carries home. */
  loot: Resources | null;
  /** Set when a standing raid order sent it. */
  raidOrder: number | null;
}

export type SizeBucket = "handful" | "company" | "army" | "host";

export interface IncomingCommand {
  id: string;
  seq: number;
  kind: CommandKind;
  from: VillageRef;
  to: VillageRef;
  sentTick: number;
  arrivalTick: number;
  /** Filled once a watchtower in the target village sees an attack. */
  sighted: { size: SizeBucket; envoy: boolean; atTick: number } | null;
  /** Support only: what's coming (you're being given troops, so you see them). */
  units: UnitCounts | null;
}

export interface Trade {
  id: string;
  seq: number;
  from: VillageRef;
  to: VillageRef;
  resources: Resources;
  merchants: number;
  sentTick: number;
  arrivalTick: number;
  /** True once the merchants are walking home empty. */
  returning: boolean;
}

export interface ScheduledAction {
  id: string;
  atTick: number;
  action: Action;
}

export interface PlayerSummary {
  id: string;
  name: string;
  points: number;
  score: number;
  rank: number;
  renown: { attack: number; defense: number };
  villages: number;
  /** Null when not protected. */
  protectedUntilTick: number | null;
  /** Council only: the first tick your next batch of actions is accepted. */
  nextActTick: number | null;
}

export interface StateResponse {
  world: WorldSummary;
  serverTime: string;
  player: PlayerSummary;
  villages: VillageState[];
  commands: { outgoing: OutgoingCommand[]; incoming: IncomingCommand[] };
  trades: { outgoing: Trade[]; incoming: Trade[] };
  scheduled: ScheduledAction[];
  notes: string;
  unreadReports: number;
  /** Pass to GET /events?after= to get only what happens from now on. */
  eventsCursor: number;
}

// ---------------------------------------------------------------------------------------------
// Actions (POST /worlds/{w}/actions)

interface ActionBase {
  /** Your id for this action, up to 64 chars. A retry with the same clientId returns the first successful result instead of acting twice. Failed actions aren't remembered. */
  clientId?: string;
  /** Apply at this future tick instead of now (≤ tick + LIMITS.maxScheduleAhead). */
  atTick?: number;
}

export type Action =
  | (ActionBase & { type: "build"; village: string; building: BuildingId })
  | (ActionBase & { type: "cancel_build"; village: string; item: string })
  | (ActionBase & { type: "train"; village: string; unit: UnitId; count: number })
  | (ActionBase & { type: "cancel_train"; village: string; batch: string })
  | (ActionBase & {
      type: "send";
      village: string;
      target: string;
      kind: CommandKind;
      units: UnitCounts;
      /** Trebuchet target. Default "hall". */
      aim?: BuildingId;
      /** Depart so as to arrive exactly at this tick (scheduled; the units must be home at departure). */
      arriveAtTick?: number;
    })
  | (ActionBase & { type: "cancel_command"; command: string })
  /** Call home your troops from `home` that are stationed in `village`. Omit units for all of them. */
  | (ActionBase & { type: "recall"; village: string; home: string; units?: UnitCounts })
  /** Send back troops from `home` stationed in your village `village`. Omit units for all of them. */
  | (ActionBase & { type: "send_back"; village: string; home: string; units?: UnitCounts })
  | (ActionBase & { type: "trade"; village: string; target: string; resources: Partial<Resources> })
  | (ActionBase & { type: "rename"; village: string; name: string })
  | (ActionBase & { type: "cancel_scheduled"; scheduled: string });

export type ActionType = Action["type"];

export interface ActionsRequest {
  actions: Action[];
  /** Why, in a line (≤ LIMITS.noteMaxChars). Shown above this batch in the dashboard's steward log. */
  note?: string;
  /** Include the fresh StateResponse after applying. Default false. */
  returnState?: boolean;
}

export type ActionResult =
  | { ok: true; clientId?: string; type: ActionType; data: ActionData }
  | { ok: false; clientId?: string; type: ActionType; error: ApiError };

export type ActionData =
  | { item: BuildQueueItem }
  | { batch: TrainBatch }
  | { command: OutgoingCommand }
  | { trade: Trade }
  | { scheduled: ScheduledAction }
  | { cancelled: string; refund?: Resources }
  | { renamed: string };

export interface ActionsResponse {
  tick: number;
  results: ActionResult[];
  state?: StateResponse;
}

// ---------------------------------------------------------------------------------------------
// Notes (an LLM's memory between shifts; any steward may use them)

export interface NotesResponse {
  text: string;
  updatedTick: number | null;
}

// ---------------------------------------------------------------------------------------------
// Events (GET /worlds/{w}/events, and the stream)

interface EventBase {
  /** Increases by one per event for this player, from 1. The cursor. */
  seq: number;
  tick: number;
}

export type GameEvent =
  | (EventBase & { type: "build_completed"; village: string; building: BuildingId; level: number })
  /** Once per batch, when its last unit comes out. */
  | (EventBase & { type: "training_completed"; village: string; unit: UnitId; count: number; batch: string })
  | (EventBase & { type: "attack_incoming"; command: IncomingCommand })
  | (EventBase & { type: "support_incoming"; command: IncomingCommand })
  | (EventBase & { type: "incoming_sighted"; command: IncomingCommand })
  | (EventBase & { type: "incoming_cancelled"; command: string })
  | (EventBase & { type: "command_arrived"; command: OutgoingCommand })
  | (EventBase & { type: "command_returned"; command: OutgoingCommand })
  /** Your troops' home village was lost while they were out; they're gone. */
  | (EventBase & { type: "command_lost"; command: OutgoingCommand })
  | (EventBase & { type: "support_disbanded"; stack: SupportStack })
  | (EventBase & { type: "support_sent_back"; stack: SupportStack })
  /** Another player recalled their troops from your village. */
  | (EventBase & { type: "support_left"; stack: SupportStack })
  | (EventBase & { type: "report"; report: ReportSummary })
  | (EventBase & { type: "village_conquered"; village: VillageRef; from: { id: string; name: string } | null })
  | (EventBase & { type: "village_lost"; village: VillageRef; to: { id: string; name: string } })
  | (EventBase & { type: "trade_arrived"; trade: Trade })
  | (EventBase & { type: "scheduled_applied"; scheduled: string; result: ActionResult })
  | (EventBase & { type: "order_paused"; village: string; order: "build" | "train" | "raid"; index: number; code: ErrorCode })
  | (EventBase & { type: "protection_ended" })
  | (EventBase & { type: "round_ended"; standings: LeaderboardEntry[] });

export type GameEventType = GameEvent["type"];

export interface EventsResponse {
  tick: number;
  status: WorldStatus;
  round: number;
  epoch: string;
  events: GameEvent[];
  /** Pass as `after` next time. */
  cursor: number;
  /** True when events after your cursor were dropped (only the last LIMITS.eventsKept are kept): re-read /state. */
  gap: boolean;
}

// ---------------------------------------------------------------------------------------------
// Reports

export type ReportKind = "battle" | "scouting";

export interface ReportSummary {
  id: string;
  tick: number;
  kind: ReportKind;
  /** Your side in it. */
  role: "attacker" | "defender" | "supporter";
  /** The attacker's command; null for the defender and supporters. */
  commandId: string | null;
  attacker: VillageRef;
  defender: VillageRef;
  /** From your side's point of view. Defender: "won" when the attack or the scouting failed. */
  outcome: "won" | "lost" | "scouted" | "failed";
  conquered: boolean;
  read: boolean;
}

export interface Intel {
  /** After this battle's loot. */
  resources: Resources;
  /** After this battle's siege. */
  buildings: BuildingLevels;
  /** The owner's surviving troops at home. */
  unitsHome: UnitCounts;
  /** Every surviving support stationed there, added up. */
  supportTotal: UnitCounts;
}

export interface Report extends ReportSummary {
  /** The attacker: always. Defender: always. Supporter: null. */
  attackerUnits: { sent: UnitCounts; lost: UnitCounts } | null;
  /** Attacker: null when wiped out. Supporter: only their own stack. */
  defenderUnits: { present: UnitCounts; lost: UnitCounts } | null;
  scouts: { sent: number; lost: number; defending: number | null; defendingLost: number | null } | null;
  /** Strength numbers as the battle computed them. */
  strength: { attack: number; defense: number } | null;
  wall: { before: number; effective: number; after: number } | null;
  building: { aim: BuildingId; before: number; after: number } | null;
  loyalty: { before: number; after: number } | null;
  loot: Resources | null;
  /** Attacker only: what the survivors could carry and what they took. */
  carry: { capacity: number; taken: number } | null;
  intel: Intel | null;
}

export interface ReportsResponse {
  reports: ReportSummary[];
  /** Pass as `before` to page back. Null at the end. */
  next: string | null;
}

// ---------------------------------------------------------------------------------------------
// Public map and leaderboard (points and standings refresh every SCORING.publicSnapshotTicks)

export interface MapVillage {
  id: string;
  x: number;
  y: number;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  points: number;
}

export interface MapPlayer {
  id: string;
  name: string;
  /** House bots are labelled so people can tell. */
  houseBot: HouseBotKind | null;
  points: number;
  villages: number;
  /** Public: whether, and until when, a player can't be attacked. */
  protectedUntilTick: number | null;
}

export interface MapResponse {
  tick: number;
  /** The tick the public numbers were last refreshed. */
  snapshotTick: number;
  size: number;
  villages: MapVillage[];
  players: MapPlayer[];
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  name: string;
  houseBot: HouseBotKind | null;
  score: number;
  points: number;
  villages: number;
  renown: { attack: number; defense: number };
}

export interface LeaderboardResponse {
  tick: number;
  snapshotTick: number;
  round: number;
  entries: LeaderboardEntry[];
}

// ---------------------------------------------------------------------------------------------
// Simulators. Inputs are bounded: unit counts 0..1e6 integers, wall 0..20, levels 0..maxLevel,
// loyalty 0..100, resources and hidden 0..1e9. Anything else is VALIDATION.

export interface SimulateBattleRequest {
  attacker: UnitCounts;
  defender?: UnitCounts;
  wall?: number;
  aim?: BuildingId;
  /** Level of the building the trebuchets aim at, to see the damage. */
  aimLevel?: number;
  loyalty?: number;
  /** Resources in the village and its cellar protection, to see the loot. */
  resources?: Resources;
  hidden?: number;
  /** Defence before troops; default COMBAT.villageBaseDefense. For a hamlet use hamletBaseDefense plus its militia. */
  baseDefense?: number;
  /** One of your reports with intel: fills defender, wall, aimLevel, resources and hidden from it. Fields you pass override it. Needs your key. */
  fromReport?: string;
}

export interface SimulateBattleResponse {
  winner: "attacker" | "defender";
  strength: { attack: number; defense: number };
  attackerLost: UnitCounts;
  attackerSurvivors: UnitCounts;
  defenderLost: UnitCounts;
  defenderSurvivors: UnitCounts;
  scouting: { success: boolean; lost: number; defendingLost: number } | null;
  wall: { before: number; effective: number; after: number };
  building: { aim: BuildingId; before: number; after: number } | null;
  loyalty: { before: number; after: number; conquered: boolean } | null;
  loot: Resources | null;
}

export interface TravelResponse {
  distance: number;
  /** Per unit type, ticks to arrive. */
  ticks: Partial<Record<UnitId, number>>;
  /** For the units given (the slowest of them), or null if none were given. */
  groupTicks: number | null;
}

// ---------------------------------------------------------------------------------------------
// History (GET /worlds/{w}/history): one sample every HISTORY.sampleEveryTicks for the round

export interface HistorySample {
  tick: number;
  points: number;
  score: number;
  villages: number;
  /** Totals across your villages. */
  resources: Resources;
  production: Resources;
  /** Population in units, wherever they are. */
  armyPop: number;
  renown: { attack: number; defense: number };
}

export interface HistoryResponse {
  samples: HistorySample[];
}

// ---------------------------------------------------------------------------------------------
// The activity log (what your steward did), for the dashboard

export interface ActivityEntry {
  seq: number;
  at: string; // ISO
  tick: number;
  via: "rest" | "mcp" | "orders";
  /** e.g. "POST /actions" or the MCP tool name. */
  call: string;
  status: number;
  ms: number;
  /** The batch's note, if any. */
  note?: string;
  /** For action batches: one line per action. */
  actions?: { type: ActionType; ok: boolean; code?: ErrorCode; summary: string }[];
}

export interface ActivityResponse {
  entries: ActivityEntry[];
  cursor: number;
}

// ---------------------------------------------------------------------------------------------
// MCP-only shapes: compact records sized for a language model's context

/** get_briefing and join_world. Minified; nulls, empty arrays and zero counts are left out. */
export interface Briefing {
  world: string;
  tick: number;
  speed: number;
  status: WorldStatus;
  endsAtTick: number;
  nextActTick?: number;
  you: { name: string; score: number; points: number; rank: number; villages: number; protectedUntilTick?: number };
  /** Villages that need attention first (idle queue, threatened, a resource near storage). Beyond six villages, those needing none come as a BriefVillageStub. */
  villages: (BriefVillage | BriefVillageStub)[];
  /** Soonest first. */
  threats: BriefThreat[];
  moving: { id: string; kind: CommandKind | "trade"; from: string; to: string; arrivalTick: number; returning?: boolean }[];
  reports: { unread: number; latest: ReportSummary[] };
  notes?: string;
  /** True when your notes were too long for the briefing's budget and `notes` is only their start (GET /notes has them whole). */
  notesTruncated?: boolean;
  eventsCursor: number;
  /** The soonest thing that will happen. */
  next?: { tick: number; what: string };
}

export interface BriefVillage {
  id: string;
  name: string;
  x: number;
  y: number;
  /** timber, stone, iron */
  res: [number, number, number];
  cap: number;
  prodPerMin: [number, number, number];
  /** First tick a resource hits storage, if production continues. */
  fullAtTick?: number;
  /** used, max */
  pop: [number, number];
  /** Non-zero levels only. */
  buildings: Partial<BuildingLevels>;
  queue: { building: BuildingId; level: number; endTick: number }[];
  queueFree: number;
  training: { unit: UnitId; remaining: number; endTick: number }[];
  home: UnitCounts;
  away?: UnitCounts;
  /** Only what can be queued right now. */
  canBuild: { building: BuildingId; level: number; cost: [number, number, number]; ticks: number }[];
  /** Blocked on resources only; at most 3. */
  soon: { building: BuildingId; level: number; atTick: number }[];
  /** Max count now, non-zero only. */
  canTrain: Partial<Record<UnitId, number>>;
  /** Only when below 100. */
  loyalty?: number;
  orders?: { build: number; train: number; raids: number; paused: number };
}

/** A briefing village that needs no attention, in a holding of more than six. */
export type BriefVillageStub = Pick<BriefVillage, "id" | "name" | "res" | "queueFree">;

export interface BriefThreat {
  id: string;
  to: string;
  from: { id: string; name: string; x: number; y: number; ownerName: string | null };
  arrivalTick: number;
  inTicks: number;
  /** Units whose ceil(distance * speed) equals arrivalTick - sentTick: the slowest unit is one of these. */
  slowestCandidates: UnitId[];
  sighted?: IncomingCommand["sighted"];
}

/** MCP wait_for_events. */
export interface WaitResult {
  tick: number;
  status: WorldStatus;
  cursor: number;
  timedOut: boolean;
  /** One line each, e.g. "t1520 build_completed v_ab12 farm→4". */
  events: string[];
  /** Per village: resources, free queue slots, threats. */
  pulse: { id: string; res: [number, number, number]; queueFree: number; threats: number }[];
}

// ---------------------------------------------------------------------------------------------
// The stream (WebSocket /api/v1/worlds/{w}/stream)

/** Client → server, the only message a client sends. Within SERVER.helloTimeoutMs of connecting; without a key you get the public channels only. */
export interface StreamHello {
  type: "hello";
  key?: string;
  /** Default: everything you're allowed. */
  channels?: StreamChannel[];
}

export type StreamChannel = "tick" | "events" | "state" | "activity" | "map" | "god";

export type StreamMessage =
  | { type: "welcome"; world: WorldSummary; authenticated: boolean; playerId: string | null; channels: StreamChannel[] }
  | { type: "tick"; tick: number; status: WorldStatus; speed: number }
  | { type: "event"; event: GameEvent }
  | { type: "state"; state: StateResponse }
  | { type: "activity"; entry: ActivityEntry }
  /** Villages whose owner, name or (on a snapshot tick) points changed, and the players' public numbers. */
  | { type: "map"; tick: number; villages: MapVillage[]; players: MapPlayer[] }
  | { type: "conquest"; tick: number; village: VillageRef; from: string | null; to: string }
  | { type: "round"; round: number; status: WorldStatus; epoch: string }
  | { type: "god"; tick: number; movements: GodMovement[]; battles: GodBattle[] }
  | { type: "error"; error: ApiError };

/** Sandbox creator only: every army on the map. */
export interface GodMovement {
  id: string;
  kind: CommandKind | "trade";
  ownerId: string;
  fromXY: [number, number];
  toXY: [number, number];
  sentTick: number;
  arrivalTick: number;
  returning: boolean;
  pop: number;
}

export interface GodBattle {
  tick: number;
  x: number;
  y: number;
  attackerId: string;
  defenderId: string | null;
  winner: "attacker" | "defender";
  conquered: boolean;
}
