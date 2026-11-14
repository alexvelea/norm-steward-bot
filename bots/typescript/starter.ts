// Norn Steward: the starter steward, in TypeScript.
//
// One file, no dependencies, Node 20+ (global fetch). Copy it anywhere and change it:
//
//   npx tsx bots/typescript/starter.ts
//
// Environment:
//   STEWARD_URL      the server (default http://localhost:8787)
//   STEWARD_KEY      your API key. Without one, STEWARD_NAME signs up and prints a new key once.
//   STEWARD_NAME     the player name to sign up with (3-24 letters, digits, _ or -)
//   STEWARD_WORLD    the world to play. Default: your first sandbox, else the first public world.
//   STEWARD_SANDBOX  1 = create a fresh sandbox and play there.
//
// What it does: joins, then loops on "act, then long-poll /events until something it cares about".
// It goes straight for raiders and a first party, farms the cheapest nearby hamlets with standing raid
// orders sized by the battle simulator, grows the economy from the build options the server computes,
// keeps defence and offence in step with the farm, and answers incoming attacks by recalling raids
// and sending support. Every rule number
// comes from GET /worlds/{w}/rules; the numbers in STRATEGY below are this bot's taste, not rules.

// ---------------------------------------------------------------------------------------------
// The wire shapes this bot reads: a minimal copy of src/shared/api.ts, so this file stands alone.

type Resource = "timber" | "stone" | "iron";
type Resources = Record<Resource, number>;
type BuildingId =
  | "hall" | "lumberyard" | "quarry" | "mine" | "farm" | "storehouse" | "cellar" | "barracks"
  | "smithy" | "stable" | "workshop" | "market" | "wall" | "watchtower" | "court";
type UnitId =
  | "pikeman" | "shieldman" | "raider" | "archer" | "scout" | "lancer" | "knight" | "ram"
  | "trebuchet" | "envoy";
type UnitCounts = Partial<Record<UnitId, number>>;
type TrainingBuilding = "barracks" | "stable" | "workshop" | "court";
type WorldStatus = "running" | "paused" | "ended";

interface ApiError { code: string; message: string; details?: Record<string, unknown> }

interface WorldSummary {
  id: string; name: string; kind: "blitz" | "council" | "sandbox"; status: WorldStatus;
  speed: number; tick: number; round: number; endsAtTick: number; epoch: string;
}

interface VillageRef { id: string; name: string; x: number; y: number; ownerId: string | null; ownerName: string | null }

interface BuildOption {
  building: BuildingId; level: number; cost: Resources; ok: boolean; blockers: string[];
  affordableAtTick: number | null;
}
interface TrainOption { unit: UnitId; pop: number; maxCount: number; ok: boolean; blockers: string[] }
interface TrainBatch { unit: UnitId; remaining: number }
interface SupportStack { home: VillageRef; at: VillageRef; units: UnitCounts }
interface RaidOrder { target: string; units: UnitCounts; stopIfLoss?: number }
interface StandingOrders {
  build: { building: BuildingId; toLevel: number }[];
  train: { unit: UnitId; keep: number; batch?: number }[];
  raids: RaidOrder[];
}

interface VillageState {
  id: string; name: string; x: number; y: number;
  resources: Resources; storage: number; production: Resources;
  population: { used: number; max: number };
  buildings: Record<BuildingId, number>;
  buildQueue: { building: BuildingId; level: number; endTick: number }[];
  training: Record<TrainingBuilding, TrainBatch[]>;
  units: { home: UnitCounts; away: UnitCounts };
  supportHere: SupportStack[];
  supportAbroad: SupportStack[];
  orders: StandingOrders;
  options: { build: BuildOption[]; train: TrainOption[] };
}

interface OutgoingCommand {
  id: string; kind: "attack" | "support"; returning: boolean; from: VillageRef; to: VillageRef;
  units: UnitCounts; sentTick: number; arrivalTick: number; cancellableUntilTick: number | null;
}
interface IncomingCommand {
  id: string; kind: "attack" | "support"; from: VillageRef; to: VillageRef; sentTick: number;
  arrivalTick: number; sighted: { size: string; envoy: boolean; atTick: number } | null;
  units: UnitCounts | null;
}

type Action = { type: string; clientId?: string } & Record<string, unknown>;
/** An action waiting for its tick, such as a support send timed with arriveAtTick. */
interface ScheduledAction { id: string; atTick: number; action: Action }

interface StateResponse {
  world: WorldSummary;
  player: { id: string; name: string; rank: number; score: number; protectedUntilTick: number | null; nextActTick: number | null };
  villages: VillageState[];
  commands: { outgoing: OutgoingCommand[]; incoming: IncomingCommand[] };
  scheduled: ScheduledAction[];
  unreadReports: number;
  eventsCursor: number;
}
interface ActionResult { ok: boolean; type: string; error?: ApiError }
interface ActionsResponse { tick: number; results: ActionResult[]; state?: StateResponse }

interface ReportSummary {
  id: string; tick: number; kind: "battle" | "scouting"; role: "attacker" | "defender" | "supporter";
  attacker: VillageRef; defender: VillageRef; outcome: "won" | "lost" | "scouted" | "failed";
}
interface Report extends ReportSummary {
  attackerUnits: { sent: UnitCounts; lost: UnitCounts } | null;
  defenderUnits: { present: UnitCounts; lost: UnitCounts } | null;
  wall: { before: number; effective: number; after: number } | null;
  loot: Resources | null;
}

interface GameEvent {
  seq: number; tick: number; type: string;
  village?: string | VillageRef;
  command?: IncomingCommand | OutgoingCommand | string;
  report?: ReportSummary;
  result?: ActionResult;
  order?: string; index?: number; code?: string; unit?: UnitId;
  standings?: { rank: number; name: string; score: number }[];
}
interface EventsResponse {
  tick: number; status: WorldStatus; round: number; epoch: string; events: GameEvent[]; cursor: number; gap: boolean;
}

interface MapVillage { id: string; x: number; y: number; name: string; ownerId: string | null; points: number }
interface MapResponse { tick: number; villages: MapVillage[] }

interface SimulateBattleResponse { winner: "attacker" | "defender"; attackerLost: UnitCounts; attackerSurvivors: UnitCounts }

// The parts of GET /worlds/{w}/rules this bot uses. `rules` holds every export of src/rules/config.ts.
interface UnitRule {
  building: TrainingBuilding; buildingLevel: number; smithyLevel: number;
  cost: Resources; pop: number; attack: number; speed: number; carry: number;
}
interface Rules {
  BUILDINGS: Record<BuildingId, { maxLevel: number; requires: Partial<Record<BuildingId, number>> }>;
  UNITS: Record<UnitId, UnitRule>;
  ECONOMY: { buildQueueMax: number };
  COMBAT: { minAttackPop: number };
  MAP: {
    hamletBaseDefense: number; hamletMilitiaPerTick: number; hamletMilitiaCap: number;
    hamletLevels: Partial<Record<BuildingId, [number, number]>>;
  };
  WATCHTOWER: { sizeBuckets: { name: string; maxPop: number | null }[] };
  ORDERS: { maxRaids: number; raidStopLossDefault: number };
  LIMITS: { actionsPerBatch: number; maxEventWaitSeconds: number; maxMapRadius: number; noteMaxChars: number };
}
interface RulesResponse { rules: Rules; tables: { production: { level: number; perMinute: number }[] } }

// ---------------------------------------------------------------------------------------------
// This bot's taste. Change these first.

const STRATEGY = {
  /** Seconds to hold each long-poll (the server caps it at LIMITS.maxEventWaitSeconds). */
  waitSeconds: 20,
  /** A brand-new sandbox runs at this many ticks per real second. */
  sandboxSpeed: 10,
  /** Queue a farm when less than this share of the population limit is free. */
  farmWhenFreeBelow: 0.12,
  /** Queue a storehouse when any resource passes this share of storage. */
  storehouseWhenFullerThan: 0.8,
  /** Keep the weakest resource building within this many levels above the hall before anything else. */
  economyLeadOverHall: 2,
  /** While raiders come first, still take every resource building to this level: each level pays for itself well within a round. */
  firstEconomyLevel: 7,
  /** Build items in the queue at once; the rest of the resources stay free for troops. */
  maxQueuedBuilds: 2,
  /** Hold resources for a wanted building when production covers it within this many ticks. */
  saveForTicks: 90,
  /** Training batches per building at once. */
  maxQueuedBatches: 2,
  /** Spend at most this share of what a batch could buy, so the economy keeps growing. */
  trainSpendShare: 0.5,
  /** Population shares of the farm limit to keep in defensive and offensive troops. */
  defensePopShare: 0.2,
  offensePopShare: 0.35,
  /** Troops this far below their target (a share of it) are trained before anything is built. */
  troopsFirstWhenShort: 0.5,
  /** The defensive core (population) trained before anything else: enough to see off a stray party. */
  coreDefensePop: 5,
  /** How many hamlets each village farms, how many of the nearest it sizes parties for, and how far it looks (fields). */
  raidTargets: 3,
  raidCandidates: 5,
  raidRadius: 12,
  /**
   * A raid party is the smallest the simulator says wins losing at most this share of its population,
   * and carries home more than its losses cost. The first raid on a hamlet may lose more and needn't
   * pay (its militia has grown since tick 0, and one win knocks it back to the base), but it must leave
   * a party that can keep farming it.
   */
  raidMaxLoss: 0.2,
  firstRaidMaxLoss: 0.4,
  raidReplanTicks: 600,
  /** Once raids stand, re-plan them early when the raiding force has grown by this share since the last plan. */
  replanAfterGrowth: 0.25,
  mapRefreshTicks: 900,
  /** With no watchtower sighting, guess an attacker's army population from its village's points. */
  threatPopPerPoint: 0.5,
  /** A "host" sighting has no upper bound: guess this many times the largest bounded bucket. */
  hostOverArmy: 2,
  /** Act-then-reread passes per wake-up, so one wake can queue a build and then train. */
  passesPerWake: 4,
  /** Wake at least this often (ticks) even when nothing is due, so resources don't sit idle. */
  idleWakeTicks: 60,
  /** Real-time pauses (ms). */
  pausedPollMs: 3000,
  roundPollMs: 15000,
  errorPauseMs: 5000,
  /** Give up after this many failed wake-ups in a row (the server is gone, or the world was deleted). */
  maxConsecutiveErrors: 20,
};

const RESOURCE_BUILDINGS: Record<Resource, BuildingId> = { timber: "lumberyard", stone: "quarry", iron: "mine" };
const DEFENSIVE_UNITS: UnitId[] = ["pikeman", "shieldman", "archer"];
/** Raiding units, best first. */
const RAID_UNITS: UnitId[] = ["lancer", "raider"];

type Goal = { unit: UnitId } | { building: BuildingId; level: number };
/** The first raiding unit: a village with no raids going builds straight for it (see raidersFirst). */
const FIRST_RAIDER: Goal = { unit: "raider" };
/** What to work toward, in order, once the economy and storage are looked after. */
const GOALS: Goal[] = [
  { unit: "pikeman" },
  { unit: "raider" },
  { unit: "shieldman" },
  { building: "wall", level: 3 },
  { building: "hall", level: 8 },
  { unit: "lancer" },
  { building: "watchtower", level: 2 },
  { building: "wall", level: 8 },
  { building: "market", level: 3 },
  { unit: "archer" },
  { building: "cellar", level: 5 },
  { building: "wall", level: 15 },
  { unit: "knight" },
];

// ---------------------------------------------------------------------------------------------
// Small helpers

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const RESOURCES: Resource[] = ["timber", "stone", "iron"];

function log(tick: number | null, where: string, message: string): void {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`${time} ${tick === null ? "" : `t${tick} `}${where}: ${message}`);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function addUnits(...groups: (UnitCounts | null | undefined)[]): UnitCounts {
  const sum: UnitCounts = {};
  for (const group of groups) {
    for (const [unit, n] of Object.entries(group ?? {}) as [UnitId, number][]) sum[unit] = (sum[unit] ?? 0) + n;
  }
  return sum;
}

function subtractUnits(from: UnitCounts, take: UnitCounts): UnitCounts {
  const left: UnitCounts = { ...from };
  for (const [unit, n] of Object.entries(take) as [UnitId, number][]) left[unit] = Math.max(0, (left[unit] ?? 0) - n);
  return left;
}

function pick(units: UnitCounts, keep: UnitId[]): UnitCounts {
  const picked: UnitCounts = {};
  for (const unit of keep) if (units[unit]) picked[unit] = units[unit];
  return picked;
}

function omit(units: UnitCounts, drop: UnitId[]): UnitCounts {
  const kept: UnitCounts = {};
  for (const [unit, n] of Object.entries(units) as [UnitId, number][]) if (n && !drop.includes(unit)) kept[unit] = n;
  return kept;
}

function fitsIn(party: UnitCounts, pool: UnitCounts): boolean {
  return (Object.entries(party) as [UnitId, number][]).every(([unit, n]) => n <= (pool[unit] ?? 0));
}

function describeUnits(units: UnitCounts): string {
  const parts = Object.entries(units).filter(([, n]) => n).map(([unit, n]) => `${n} ${unit}`);
  return parts.length ? parts.join(", ") : "nobody";
}

// ---------------------------------------------------------------------------------------------
// The HTTP client: auth, JSON, 429 Retry-After, and retries that are safe because of clientIds.

class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(`${status} ${code}: ${message}`);
  }
}

class Client {
  private static readonly maxAttempts = 6;
  /** Waits shorter than this are the bucket refilling at full speed: normal, so not worth a log line. */
  private static readonly quietRetryMs = 1000;

  constructor(private readonly base: string, public key: string | null) {}

  async call<T>(method: string, path: string, options: { body?: unknown; query?: Record<string, string | number | undefined>; timeoutMs?: number } = {}): Promise<T> {
    const url = new URL(`${this.base}/api/v1${path}`);
    for (const [name, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(name, String(value));
    const headers: Record<string, string> = {};
    if (this.key) headers.authorization = `Bearer ${this.key}`;
    // Only send a content type with a body: an empty JSON body is a 400.
    if (options.body !== undefined) headers["content-type"] = "application/json";
    // The same body goes out on every retry, so a retried action batch carries the same clientIds.
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);

    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(options.timeoutMs ?? 30_000) });
      } catch (err) {
        if (attempt >= Client.maxAttempts) throw err;
        log(null, "http", `${method} ${path} failed (${(err as Error).message}); retrying`);
        await sleep(1000 * 2 ** (attempt - 1));
        continue;
      }
      if (response.status === 204) return undefined as T;
      const payload = (await response.json().catch(() => null)) as (T & { error?: ApiError }) | null;
      if (response.ok) return payload as T;

      const error: ApiError = payload?.error ?? { code: `HTTP_${response.status}`, message: response.statusText };
      const details = error.details ?? {};
      // A Council world's early batch carries nextActTick: that's a game wait, not a transport one.
      if (response.status === 429 && details.nextActTick === undefined && attempt < Client.maxAttempts) {
        const retryMs = typeof details.retryAfterMs === "number" ? details.retryAfterMs : (Number(response.headers.get("retry-after")) || 1) * 1000;
        if (retryMs >= Client.quietRetryMs) log(null, "http", `rate limited; waiting ${retryMs} ms`);
        await sleep(retryMs);
        continue;
      }
      if (response.status >= 500 && attempt < Client.maxAttempts) {
        await sleep(1000 * 2 ** (attempt - 1));
        continue;
      }
      throw new ApiFailure(response.status, error.code, error.message, details);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Reading a village

function option(v: VillageState, building: BuildingId): BuildOption {
  return v.options.build.find((o) => o.building === building)!;
}

function trainOption(v: VillageState, unit: UnitId): TrainOption {
  return v.options.train.find((o) => o.unit === unit)!;
}

/** Built level plus the levels already queued. */
function plannedLevel(v: VillageState, building: BuildingId): number {
  return v.buildings[building] + v.buildQueue.filter((item) => item.building === building).length;
}

function blockedOnlyByResources(o: BuildOption): boolean {
  return o.blockers.length === 1 && o.blockers[0] === "INSUFFICIENT_RESOURCES";
}

/** Every unit this village owns: home, away, and still in a training queue. */
function ownedUnits(v: VillageState): UnitCounts {
  const queued: UnitCounts = {};
  for (const batches of Object.values(v.training)) for (const b of batches) queued[b.unit] = (queued[b.unit] ?? 0) + b.remaining;
  return addUnits(v.units.home, v.units.away, queued);
}

function popOf(units: UnitCounts, rules: Rules): number {
  return (Object.entries(units) as [UnitId, number][]).reduce((sum, [unit, n]) => sum + n * rules.UNITS[unit].pop, 0);
}

/** What a party can carry home. */
function carryOf(units: UnitCounts, rules: Rules): number {
  return (Object.entries(units) as [UnitId, number][]).reduce((sum, [unit, n]) => sum + n * rules.UNITS[unit].carry, 0);
}

/** What the units cost to train, all resources together. */
function valueOf(units: UnitCounts, rules: Rules): number {
  return (Object.entries(units) as [UnitId, number][]).reduce((sum, [unit, n]) => sum + n * RESOURCES.reduce((s, r) => s + rules.UNITS[unit].cost[r], 0), 0);
}

function travelTicks(from: { x: number; y: number }, to: { x: number; y: number }, units: UnitCounts, rules: Rules): number {
  const slowest = Math.max(...(Object.keys(units) as UnitId[]).filter((u) => units[u]).map((u) => rules.UNITS[u].speed));
  return Math.ceil(distance(from, to) * slowest);
}

// ---------------------------------------------------------------------------------------------
// The build planner: one item per pass, chosen from the options the server computed.

interface Wish { building: BuildingId; why: string }
interface BuildPlan { wish: Wish | null; wakeAt: number | null; saving: boolean }

/** The resource building whose next level adds least, measured by production at its planned level. */
function weakestResourceBuilding(v: VillageState, tables: RulesResponse["tables"]): { building: BuildingId; resource: Resource } {
  let best: { building: BuildingId; resource: Resource; perMinute: number } | null = null;
  for (const resource of RESOURCES) {
    const building = RESOURCE_BUILDINGS[resource];
    const perMinute = tables.production[plannedLevel(v, building)].perMinute;
    if (!best || perMinute < best.perMinute) best = { building, resource, perMinute };
  }
  return best!;
}

/** The next building to queue toward `level` of `building`, its requirements first. Null once planned. */
function stepToward(v: VillageState, building: BuildingId, level: number, rules: Rules): BuildingId | null {
  const rule = rules.BUILDINGS[building];
  if (plannedLevel(v, building) >= Math.min(level, rule.maxLevel)) return null;
  for (const [required, requiredLevel] of Object.entries(rule.requires) as [BuildingId, number][]) {
    const step = stepToward(v, required, requiredLevel, rules);
    if (step) return step;
  }
  return building;
}

/** The next building toward one goal, or null once it's planned. */
function goalStep(v: VillageState, goal: Goal, rules: Rules): Wish | null {
  if ("unit" in goal) {
    const unit = rules.UNITS[goal.unit];
    const step = stepToward(v, unit.building, unit.buildingLevel, rules) ?? stepToward(v, "smithy", unit.smithyLevel, rules);
    return step ? { building: step, why: `toward ${goal.unit}` } : null;
  }
  const step = stepToward(v, goal.building, goal.level, rules);
  return step ? { building: step, why: `toward ${goal.building} ${goal.level}` } : null;
}

function nextGoalStep(v: VillageState, rules: Rules): Wish | null {
  for (const goal of GOALS) {
    const step = goalStep(v, goal, rules);
    if (step) return step;
  }
  return null;
}

/** What this village wants built, most urgent first. Raiders first: only the road to them. */
function buildWishes(v: VillageState, rules: Rules, tables: RulesResponse["tables"], raidersFirst: boolean): Wish[] {
  const wishes: Wish[] = [];
  const { used, max } = v.population;
  if (max - used < max * STRATEGY.farmWhenFreeBelow && plannedLevel(v, "farm") === v.buildings.farm) {
    wishes.push({ building: "farm", why: `population ${used}/${max}` });
  }
  const fullest = Math.max(...RESOURCES.map((r) => v.resources[r])) / v.storage;
  if (fullest > STRATEGY.storehouseWhenFullerThan && plannedLevel(v, "storehouse") === v.buildings.storehouse) {
    wishes.push({ building: "storehouse", why: `stores ${Math.round(fullest * 100)}% full` });
  }
  const weakest = weakestResourceBuilding(v, tables);
  const economyWish = { building: weakest.building, why: `${weakest.resource} is the scarcest` };
  if (raidersFirst) {
    // The first levels are cheap and pay for themselves: they barely delay the first party, and keep paying.
    if (plannedLevel(v, weakest.building) < STRATEGY.firstEconomyLevel) wishes.push(economyWish);
    const step = goalStep(v, FIRST_RAIDER, rules);
    if (step) wishes.push(step);
    return wishes;
  }
  if (plannedLevel(v, weakest.building) < plannedLevel(v, "hall") + STRATEGY.economyLeadOverHall) wishes.push(economyWish);
  const goal = nextGoalStep(v, rules);
  if (goal) {
    if (option(v, goal.building).blockers.includes("EXCEEDS_STORAGE")) {
      wishes.push({ building: "storehouse", why: `${goal.building} costs more than storage holds` });
    }
    wishes.push(goal);
  }
  wishes.push({ building: "hall", why: "faster building" }, economyWish);
  return wishes;
}

function planBuild(v: VillageState, rules: Rules, tables: RulesResponse["tables"], tick: number, raidersFirst: boolean): BuildPlan {
  const queueRoom = Math.min(STRATEGY.maxQueuedBuilds, rules.ECONOMY.buildQueueMax) - v.buildQueue.length;
  if (queueRoom <= 0) return { wish: null, wakeAt: null, saving: false };
  let wakeAt: number | null = null;
  for (const wish of buildWishes(v, rules, tables, raidersFirst)) {
    const o = option(v, wish.building);
    if (o.ok) return { wish, wakeAt: null, saving: false };
    if (blockedOnlyByResources(o) && o.affordableAtTick !== null) {
      wakeAt = Math.min(wakeAt ?? Infinity, o.affordableAtTick);
      // Close enough to afford: keep the resources for it instead of buying something lesser.
      if (o.affordableAtTick - tick <= STRATEGY.saveForTicks) return { wish: null, wakeAt, saving: true };
    }
  }
  return { wish: null, wakeAt, saving: false };
}

// ---------------------------------------------------------------------------------------------
// The training planner: a small defensive core, then raiders first until raids are going, then defence
// and offence in step with the farm.

/** What to train, and how far below its target that kind of troop is (a share of the target). */
interface TrainPlan { unit: UnitId; count: number; why: string; short: number }

function batchSize(o: TrainOption, missingPop: number): number {
  const wanted = Math.ceil(missingPop / o.pop);
  return Math.min(wanted, Math.max(1, Math.floor(o.maxCount * STRATEGY.trainSpendShare)));
}

function planTraining(v: VillageState, rules: Rules, raidersFirst: boolean): TrainPlan | null {
  const owned = ownedUnits(v);
  const roomIn = (unit: UnitId) => v.training[rules.UNITS[unit].building].length < STRATEGY.maxQueuedBatches;
  const trainable = (unit: UnitId) => trainOption(v, unit).ok && trainOption(v, unit).maxCount > 0 && roomIn(unit);

  const defensePop = popOf(pick(owned, DEFENSIVE_UNITS), rules);
  const defenseTarget = v.population.max * STRATEGY.defensePopShare;
  const offensePop = popOf(pick(owned, RAID_UNITS), rules);
  const offenseTarget = v.population.max * STRATEGY.offensePopShare;

  const trainDefence = (target: number): TrainPlan | null => {
    // The defensive unit we have least of, so the mix holds against every attack type.
    const unit = DEFENSIVE_UNITS.filter(trainable).sort((a, b) => (owned[a] ?? 0) - (owned[b] ?? 0))[0];
    if (!unit || defensePop >= target) return null;
    return { unit, count: batchSize(trainOption(v, unit), target - defensePop), why: `defence ${defensePop}/${Math.round(target)} pop`, short: 1 - defensePop / target };
  };
  const trainOffence = (): TrainPlan | null => {
    const unit = RAID_UNITS.find(trainable);
    if (!unit || offensePop >= offenseTarget) return null;
    return { unit, count: batchSize(trainOption(v, unit), offenseTarget - offensePop), why: `raiding force ${offensePop}/${Math.round(offenseTarget)} pop`, short: 1 - offensePop / offenseTarget };
  };

  const core = Math.min(STRATEGY.coreDefensePop, defenseTarget);
  if (defensePop < core) return trainDefence(core);
  if (raidersFirst) return trainOffence();
  // Whichever of defence and offence is further below its share of the farm.
  const defenceShort = 1 - defensePop / defenseTarget;
  const offenceShort = 1 - offensePop / offenseTarget;
  return defenceShort >= offenceShort
    ? trainDefence(defenseTarget) ?? trainOffence()
    : trainOffence() ?? trainDefence(defenseTarget);
}

/**
 * Raiders first: a village with no raids going trains raiders before it builds anything but a farm or
 * a storehouse it needs, until a party is big enough to farm a hamlet (or its raiding force is full-size).
 * That is the opening, straight to a first party whose loot and beaten-down hamlets pay for the rest,
 * and the way back to farming whenever losses break up its parties.
 */
function raidersFirst(v: VillageState, rules: Rules, raiding: boolean): boolean {
  return !raiding && popOf(pick(ownedUnits(v), RAID_UNITS), rules) < v.population.max * STRATEGY.offensePopShare;
}

// ---------------------------------------------------------------------------------------------
// Threats: who could be coming, and how big.

/** Units whose travel time over this distance equals the attack's: the slowest unit is one of them. */
function slowestCandidates(inc: IncomingCommand, rules: Rules): UnitId[] {
  const d = distance(inc.from, inc.to);
  return (Object.keys(rules.UNITS) as UnitId[]).filter((u) => Math.ceil(d * rules.UNITS[u].speed) === inc.arrivalTick - inc.sentTick);
}

/** Population guess from a watchtower's size bucket, or null without a sighting. */
function sightedPop(inc: IncomingCommand, rules: Rules): number | null {
  if (!inc.sighted) return null;
  const buckets = rules.WATCHTOWER.sizeBuckets;
  const bucket = buckets.find((b) => b.name === inc.sighted!.size);
  if (bucket?.maxPop != null) return bucket.maxPop;
  const largestBounded = Math.max(...buckets.map((b) => b.maxPop ?? 0));
  return largestBounded * STRATEGY.hostOverArmy;
}

/** The worst army that fits what we know: all of the hardest-hitting unit no slower than the slowest candidate. */
function guessAttacker(pop: number, candidates: UnitId[], rules: Rules): UnitCounts {
  const pace = candidates.length ? Math.max(...candidates.map((u) => rules.UNITS[u].speed)) : Infinity;
  const fits = (Object.keys(rules.UNITS) as UnitId[]).filter((u) => rules.UNITS[u].speed <= pace && rules.UNITS[u].attack > 0);
  const best = fits.sort((a, b) => rules.UNITS[b].attack / rules.UNITS[b].pop - rules.UNITS[a].attack / rules.UNITS[a].pop)[0];
  return { [best]: Math.max(1, Math.ceil(pop / rules.UNITS[best].pop)) };
}

// ---------------------------------------------------------------------------------------------
// The steward

interface Hamlet { id: string; name: string; x: number; y: number; lastWinTick: number | null; wall: number | null }
interface Planned { action: Action; label: string }
interface SupportOut { at: string; home: string; afterTick: number }

class Steward {
  private rules!: Rules;
  private tables!: RulesResponse["tables"];
  private state!: StateResponse;
  private cursor = 0;
  private epoch = "";
  private round = 0;
  private clientSeq = 0;
  private readonly runId = Math.random().toString(36).slice(2, 10);

  // Memory for one round.
  private hamlets = new Map<string, Hamlet>();
  private mapTick = -Infinity;
  private raidPlanTick = new Map<string, number>();
  private raidReplan = new Set<string>();
  private raidPoolAtPlan = new Map<string, number>();
  private raidsSuspendedUntil = new Map<string, number>();
  private handledThreats = new Set<string>();
  private supportOut: SupportOut[] = [];
  private buildWakeAt: number | null = null;

  constructor(private readonly client: Client, private readonly worldId: string) {}

  private get tick(): number {
    return this.state.world.tick;
  }

  private path(rest: string): string {
    return `/worlds/${encodeURIComponent(this.worldId)}${rest}`;
  }

  async run(): Promise<never> {
    await this.enterWorld();
    let consecutiveErrors = 0;
    for (;;) {
      try {
        if (this.state.world.status === "ended") await this.awaitNextRound();
        else await this.turn();
        consecutiveErrors = 0;
      } catch (err) {
        if (err instanceof ApiFailure && err.code === "WORLD_NOT_RUNNING") {
          await this.awaitNextRound();
        } else if (err instanceof ApiFailure && err.code === "NOT_IN_WORLD") {
          await this.enterWorld();
        } else if ((err instanceof ApiFailure && err.status === 401) || ++consecutiveErrors >= STRATEGY.maxConsecutiveErrors) {
          throw err;
        } else {
          log(this.tick, "steward", `error: ${(err as Error).message}; carrying on`);
          await sleep(STRATEGY.errorPauseMs);
          await this.refreshState().catch(() => undefined);
        }
      }
    }
  }

  /** Join (or rejoin after a round change), load the rules, forget last round. */
  private async enterWorld(): Promise<void> {
    this.state = await this.client.call<StateResponse>("POST", this.path("/join"));
    const rules = await this.client.call<RulesResponse>("GET", this.path("/rules"));
    this.rules = rules.rules;
    this.tables = rules.tables;
    this.cursor = this.state.eventsCursor;
    this.epoch = this.state.world.epoch;
    this.round = this.state.world.round;
    this.hamlets.clear();
    this.mapTick = -Infinity;
    this.raidPlanTick.clear();
    this.raidReplan.clear();
    this.raidPoolAtPlan.clear();
    this.raidsSuspendedUntil.clear();
    this.handledThreats.clear();
    this.supportOut = [];
    const { world, player } = this.state;
    const homes = this.state.villages.map((v) => `${v.name} (${v.x},${v.y})`).join(", ");
    const shield = player.protectedUntilTick ? `, protected until t${player.protectedUntilTick}` : "";
    log(this.tick, "steward", `${player.name} in ${world.name} round ${world.round} (${world.kind}, speed ${world.speed}): ${homes}${shield}`);
  }

  private async refreshState(): Promise<void> {
    this.state = await this.client.call<StateResponse>("GET", this.path("/state"));
  }

  private async awaitNextRound(): Promise<void> {
    await this.refreshWorld();
    if (this.state.world.kind === "sandbox") {
      log(this.tick, "steward", "the sandbox has ended; nothing more to play");
      process.exit(0);
    }
    log(this.tick, "steward", `round ${this.round} is over; waiting for the next one`);
    for (;;) {
      await sleep(STRATEGY.roundPollMs);
      const world = await this.client.call<WorldSummary>("GET", this.path(""));
      if (world.status === "running" && world.round > this.round) break;
    }
    await this.enterWorld();
  }

  private async refreshWorld(): Promise<void> {
    this.state.world = await this.client.call<WorldSummary>("GET", this.path(""));
  }

  /** One wake-up: farm planning, then act until there's nothing to do, then wait for events. */
  private async turn(): Promise<void> {
    if (this.state.villages.length === 0) {
      log(this.tick, "steward", "every village is lost; founding a new one");
      return this.enterWorld();
    }
    await this.refreshMapIfDue();
    await this.planRaidsIfDue();
    for (let pass = 0; pass < STRATEGY.passesPerWake && this.canAct(); pass++) {
      if (!(await this.actOnce())) break;
    }
    await this.waitForEvents();
  }

  /** Council worlds take one batch per interval. */
  private canAct(): boolean {
    const next = this.state.player.nextActTick;
    return next === null || next <= this.tick;
  }

  private async actOnce(): Promise<boolean> {
    const planned: Planned[] = [...(await this.answerThreats()), ...this.recallSupport()];
    this.buildWakeAt = null;
    for (const v of this.state.villages) {
      // Raids kept home by a threat still count as going.
      const first = raidersFirst(v, this.rules, v.orders.raids.length > 0 || this.raidsSuspendedUntil.has(v.id));
      const train = planTraining(v, this.rules, first);
      // Troops far below target come before more building; otherwise they get what building leaves.
      if (train && !first && train.short >= STRATEGY.troopsFirstWhenShort) {
        planned.push({ action: { type: "train", village: v.id, unit: train.unit, count: train.count }, label: `${v.name} train ${train.count} ${train.unit} (${train.why})` });
        continue; // build next pass, against the resources left after paying for them
      }
      const build = planBuild(v, this.rules, this.tables, this.tick, first);
      if (build.wakeAt !== null) this.buildWakeAt = Math.min(this.buildWakeAt ?? Infinity, build.wakeAt);
      if (build.wish) {
        const level = option(v, build.wish.building).level;
        planned.push({ action: { type: "build", village: v.id, building: build.wish.building }, label: `${v.name} build ${build.wish.building} to ${level} (${build.wish.why})` });
        continue; // train next pass, against the resources left after paying for it
      }
      if (build.saving) continue;
      if (train) {
        planned.push({ action: { type: "train", village: v.id, unit: train.unit, count: train.count }, label: `${v.name} train ${train.count} ${train.unit} (${train.why})` });
      }
    }
    if (planned.length === 0) return false;
    return this.apply(planned);
  }

  /** Sends a batch, logs one line per action, and takes the fresh state back. */
  private async apply(planned: Planned[]): Promise<boolean> {
    const batch = planned.slice(0, this.rules.LIMITS.actionsPerBatch);
    const actions = batch.map((p) => ({ ...p.action, clientId: `${this.runId}-${++this.clientSeq}` }));
    const note = batch.map((p) => p.label).join("; ").slice(0, this.rules.LIMITS.noteMaxChars);
    try {
      const response = await this.client.call<ActionsResponse>("POST", this.path("/actions"), { body: { actions, note, returnState: true } });
      response.results.forEach((result, i) => {
        log(response.tick, "act", result.ok ? batch[i].label : `${batch[i].label} -> ${result.error!.code}: ${result.error!.message}`);
      });
      if (response.state) this.state = response.state;
      return response.results.some((r) => r.ok);
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 429 && typeof err.details.nextActTick === "number") {
        log(this.tick, "act", `council: next batch at t${err.details.nextActTick}`);
        this.state.player.nextActTick = err.details.nextActTick;
        return false;
      }
      throw err;
    }
  }

  // ---- Waiting and events ------------------------------------------------------------------

  /** The next tick worth waking for even if no event comes. */
  private wakeTick(): number {
    const candidates = [
      this.buildWakeAt,
      this.state.player.nextActTick,
      ...this.supportOut.map((s) => s.afterTick + 1),
      ...[...this.raidsSuspendedUntil.values()].map((t) => t + 1),
    ].filter((t): t is number => t !== null && t > this.tick);
    return Math.min(this.tick + STRATEGY.idleWakeTicks, ...candidates);
  }

  private async waitForEvents(): Promise<void> {
    const wait = Math.min(STRATEGY.waitSeconds, this.rules.LIMITS.maxEventWaitSeconds);
    const response = await this.client.call<EventsResponse>("GET", this.path("/events"), {
      query: { after: this.cursor, wait, untilTick: this.wakeTick() },
      timeoutMs: (wait + 15) * 1000,
    });
    if (response.epoch !== this.epoch) {
      log(response.tick, "steward", response.round !== this.round ? `round ${response.round} has begun` : "the server restored the world; re-reading");
      if (response.status === "ended") return this.refreshState();
      return this.enterWorld();
    }
    if (response.gap) {
      log(response.tick, "steward", "missed events; re-reading the state");
      await this.refreshState();
      this.cursor = this.state.eventsCursor;
      return;
    }
    this.cursor = response.cursor;
    for (const event of response.events) await this.onEvent(event);
    if (response.status === "paused") await sleep(STRATEGY.pausedPollMs);
    await this.refreshState();
  }

  private villageName(id: string): string {
    return this.state.villages.find((v) => v.id === id)?.name ?? id;
  }

  private async onEvent(e: GameEvent): Promise<void> {
    switch (e.type) {
      case "attack_incoming": {
        const inc = e.command as IncomingCommand;
        log(e.tick, inc.to.name, `attack from ${inc.from.name} (${inc.from.ownerName ?? "hamlet"}) lands t${inc.arrivalTick}`);
        break;
      }
      case "incoming_sighted": {
        const inc = e.command as IncomingCommand;
        log(e.tick, inc.to.name, `watchtower: a ${inc.sighted?.size}${inc.sighted?.envoy ? " with an envoy" : ""} from ${inc.from.name}`);
        break;
      }
      case "incoming_cancelled":
        log(e.tick, "steward", `an incoming attack turned back`);
        break;
      case "report":
        await this.readReport(e.report!);
        break;
      case "order_paused": {
        const village = e.village as string;
        log(e.tick, this.villageName(village), `${e.order} order ${e.index} paused: ${e.code}`);
        if (e.order === "raid") this.raidReplan.add(village);
        break;
      }
      case "scheduled_applied":
        if (!e.result?.ok) log(e.tick, "steward", `scheduled ${e.result?.type} failed: ${e.result?.error?.code}`);
        break;
      case "village_lost":
      case "village_conquered": {
        const village = e.village as VillageRef;
        log(e.tick, village.name, e.type === "village_lost" ? "LOST" : "conquered");
        this.mapTick = -Infinity;
        break;
      }
      case "protection_ended":
        log(e.tick, "steward", "protection has ended");
        break;
      case "round_ended": {
        const top = (e.standings ?? []).slice(0, 3).map((s) => `${s.rank}. ${s.name} ${s.score}`).join(", ");
        log(e.tick, "steward", `round over: ${top}`);
        break;
      }
    }
  }

  private async readReport(summary: ReportSummary): Promise<void> {
    const report = await this.client.call<Report>("GET", this.path(`/reports/${encodeURIComponent(summary.id)}`));
    const sent = report.attackerUnits?.sent ?? {};
    const lost = report.attackerUnits?.lost ?? {};
    const loot = report.loot ? ` loot ${RESOURCES.map((r) => report.loot![r]).join("/")}` : "";
    const where = report.role === "attacker" ? report.attacker.name : report.defender.name;
    log(report.tick, where, `${report.kind} ${report.role} vs ${report.role === "attacker" ? report.defender.name : report.attacker.name}: ${report.outcome}, lost ${popOf(lost, this.rules)}/${popOf(sent, this.rules)} pop${loot}`);

    const hamlet = this.hamlets.get(report.defender.id);
    if (report.role === "attacker" && hamlet) {
      if (report.wall) hamlet.wall = report.wall.after;
      const firstWin = report.outcome === "won" && hamlet.lastWinTick === null;
      if (report.outcome === "won") hamlet.lastWinTick = report.tick;
      // A loss means the sizing was wrong; a first win resets the militia, so smaller parties will do.
      if (report.outcome !== "won" || firstWin) this.raidReplan.add(report.attacker.id);
    }
  }

  // ---- Farming hamlets ---------------------------------------------------------------------

  private async refreshMapIfDue(): Promise<void> {
    if (this.tick - this.mapTick < STRATEGY.mapRefreshTicks) return;
    const r = Math.min(this.rules.LIMITS.maxMapRadius, STRATEGY.raidRadius);
    for (const v of this.state.villages) {
      const map = await this.client.call<MapResponse>("GET", this.path("/map"), { query: { x: v.x, y: v.y, r } });
      for (const mv of map.villages) {
        if (mv.ownerId !== null) {
          this.hamlets.delete(mv.id); // someone took it
        } else if (!this.hamlets.has(mv.id)) {
          this.hamlets.set(mv.id, { id: mv.id, name: mv.name, x: mv.x, y: mv.y, lastWinTick: null, wall: null });
        }
      }
    }
    this.mapTick = this.tick;
  }

  private async planRaidsIfDue(): Promise<void> {
    for (const v of this.state.villages) {
      const suspendedUntil = this.raidsSuspendedUntil.get(v.id);
      if (suspendedUntil !== undefined) {
        if (this.tick <= suspendedUntil) continue;
        this.raidsSuspendedUntil.delete(v.id);
        this.raidReplan.add(v.id);
      }
      const due = this.tick - (this.raidPlanTick.get(v.id) ?? -Infinity) >= STRATEGY.raidReplanTicks;
      const pool = this.raidPool(v);
      // With no raid going yet, any new raider may be the one that makes a winning party. Once raids
      // stand, one more at a time isn't worth a re-plan: wait until the force has grown by a share.
      const growth = v.orders.raids.length ? STRATEGY.replanAfterGrowth : 0;
      const grown = popOf(pool, this.rules) > (this.raidPoolAtPlan.get(v.id) ?? 0) * (1 + growth);
      // A raid that lost troops can't go again with the party it was sized for.
      const stalled = v.orders.raids.some((r) => !fitsIn(r.units, pool));
      if (due || grown || stalled || this.raidReplan.has(v.id)) await this.planRaids(v);
    }
  }

  /** Our raiding units, wherever they are, except those stationed abroad as support. */
  private raidPool(v: VillageState): UnitCounts {
    const abroad = addUnits(...v.supportAbroad.map((s) => s.units));
    return pick(subtractUnits(addUnits(v.units.home, v.units.away), abroad), RAID_UNITS);
  }

  private async planRaids(v: VillageState): Promise<void> {
    this.raidPlanTick.set(v.id, this.tick);
    this.raidReplan.delete(v.id);
    let pool = this.raidPool(v);
    this.raidPoolAtPlan.set(v.id, popOf(pool, this.rules));
    if (popOf(pool, this.rules) < this.rules.COMBAT.minAttackPop) return;

    const nearest = [...this.hamlets.values()]
      .filter((h) => distance(v, h) <= STRATEGY.raidRadius)
      .sort((a, b) => distance(v, a) - distance(v, b))
      .slice(0, STRATEGY.raidCandidates);

    // Each raiding unit farms on its own: lancers first (fast, and they carry the most), then raiders
    // at the hamlets left. For each, size the smallest party that works at every hamlet, then farm the
    // cheapest ones the pool covers. Raiding a hamlet often keeps it cheap, so the same ones stay on top.
    const raids: RaidOrder[] = [];
    const maxRaids = Math.min(STRATEGY.raidTargets, this.rules.ORDERS.maxRaids);
    for (const unit of RAID_UNITS) {
      const sized: { hamlet: Hamlet; raid: RaidOrder; count: number }[] = [];
      for (const hamlet of nearest) {
        if (raids.length >= maxRaids || raids.some((r) => r.target === hamlet.id)) continue;
        const raid = await this.sizeRaid(v, hamlet, unit, pool[unit] ?? 0);
        if (raid) sized.push({ hamlet, raid, count: raid.units[unit]! });
      }
      sized.sort((a, b) => a.count - b.count || distance(v, a.hamlet) - distance(v, b.hamlet));
      for (const { raid } of sized) {
        if (raids.length >= maxRaids || !fitsIn(raid.units, pool)) continue;
        raids.push(raid);
        pool = subtractUnits(pool, raid.units);
      }
    }
    // The rest of the pool joins the parties already using its units: a bigger party loses a smaller
    // share and carries more home.
    for (const unit of RAID_UNITS) {
      const takers = raids.filter((r) => r.units[unit]);
      let left = pool[unit] ?? 0;
      takers.forEach((r, i) => {
        const extra = Math.floor(left / (takers.length - i));
        r.units[unit] = r.units[unit]! + extra;
        left -= extra;
      });
    }
    if (JSON.stringify(raids) === JSON.stringify(v.orders.raids)) return;
    await this.setRaids(v, raids);
    const summary = raids.map((r) => `${this.hamlets.get(r.target)?.name}: ${describeUnits(r.units)}`).join("; ");
    log(this.tick, v.name, raids.length ? `farming ${summary}` : "no hamlet worth raiding yet");
  }

  private async setRaids(v: VillageState, raids: RaidOrder[]): Promise<void> {
    const body = { build: v.orders.build, train: v.orders.train, raids };
    v.orders = await this.client.call<StandingOrders>("PUT", this.path(`/villages/${encodeURIComponent(v.id)}/orders`), { body });
  }

  /**
   * The smallest party of up to `available` of `unit` that raids the hamlet well (see raidWorks), as a
   * standing raid order that pauses if a raid ever loses more than the party was sized for.
   */
  private async sizeRaid(v: VillageState, hamlet: Hamlet, unit: UnitId, available: number): Promise<RaidOrder | null> {
    if (available === 0 || !(await this.raidWorks(v, hamlet, { [unit]: available }))) return null;
    // All of them work. Halve the gap to the fewest that still do: a bigger party loses a smaller
    // share and carries more, so the answer only ever turns from no to yes as it grows.
    let fails = 0;
    let works = available;
    while (works - fails > 1) {
      const mid = Math.floor((works + fails) / 2);
      if (await this.raidWorks(v, hamlet, { [unit]: mid })) works = mid;
      else fails = mid;
    }
    const maxLoss = hamlet.lastWinTick === null ? STRATEGY.firstRaidMaxLoss : STRATEGY.raidMaxLoss;
    return { target: hamlet.id, units: { [unit]: works }, stopIfLoss: Math.max(this.rules.ORDERS.raidStopLossDefault, maxLoss) };
  }

  /**
   * A raid works when it wins losing at most STRATEGY.raidMaxLoss of the party and brings home more
   * than the troops it loses are worth. The first raid on a hamlet is the price of knocking its
   * militia back to the base, so it may lose more and needn't pay; but what it leaves must be a
   * party whose next raid there works.
   */
  private async raidWorks(v: VillageState, hamlet: Hamlet, party: UnitCounts): Promise<boolean> {
    // A standing order may first wait for its party to come home: size for a round trip from now.
    const arrival = this.tick + 2 * travelTicks(v, hamlet, party, this.rules);
    if (hamlet.lastWinTick !== null) {
      return (await this.raidOutcome(hamlet, party, arrival - hamlet.lastWinTick, STRATEGY.raidMaxLoss, true)) !== null;
    }
    // A hamlet nobody has beaten has grown its militia since tick 0.
    const survivors = await this.raidOutcome(hamlet, party, arrival, STRATEGY.firstRaidMaxLoss, false);
    if (!survivors) return false;
    // They go again as soon as they're home: a round trip after the win.
    const again = 2 * travelTicks(v, hamlet, survivors, this.rules);
    return (await this.raidOutcome(hamlet, survivors, again, STRATEGY.raidMaxLoss, true)) !== null;
  }

  /**
   * Simulates `party` against the hamlet with `militiaTicks` of militia grown. Its survivors if it wins
   * losing at most `maxLoss` of its population (and, if it `mustPay`, carries home more than its
   * losses are worth), else null.
   */
  private async raidOutcome(hamlet: Hamlet, party: UnitCounts, militiaTicks: number, maxLoss: number, mustPay: boolean): Promise<UnitCounts | null> {
    const { MAP, COMBAT } = this.rules;
    const pop = popOf(party, this.rules);
    if (pop < COMBAT.minAttackPop) return null;
    // The wall is in the first report; until then, the highest a hamlet is drawn with.
    const wall = hamlet.wall ?? MAP.hamletLevels.wall?.[1] ?? 0;
    const militia = Math.min(MAP.hamletMilitiaCap, MAP.hamletMilitiaPerTick * militiaTicks);
    const sim = await this.client.call<SimulateBattleResponse>("POST", this.path("/simulate/battle"), {
      body: { attacker: party, wall, baseDefense: MAP.hamletBaseDefense + militia },
    });
    if (sim.winner !== "attacker" || popOf(sim.attackerLost, this.rules) > pop * maxLoss) return null;
    if (mustPay && carryOf(sim.attackerSurvivors, this.rules) < valueOf(sim.attackerLost, this.rules)) return null;
    return sim.attackerSurvivors;
  }

  // ---- Defence -----------------------------------------------------------------------------

  private async holds(attacker: UnitCounts, defender: UnitCounts, wall: number): Promise<boolean> {
    const sim = await this.client.call<SimulateBattleResponse>("POST", this.path("/simulate/battle"), { body: { attacker, defender, wall } });
    return sim.winner === "defender";
  }

  private async attackerPop(inc: IncomingCommand): Promise<number> {
    const sighted = sightedPop(inc, this.rules);
    if (sighted !== null) return sighted;
    const origin = await this.client.call<MapVillage>("GET", this.path(`/villages/${encodeURIComponent(inc.from.id)}`));
    return Math.max(this.rules.COMBAT.minAttackPop, Math.round(origin.points * STRATEGY.threatPopPerPoint));
  }

  /** For each new or newly sighted attack: does the village hold? If not, recall raids, then call support. */
  private async answerThreats(): Promise<Planned[]> {
    const planned: Planned[] = [];
    const attacks = this.state.commands.incoming.filter((c) => c.kind === "attack").sort((a, b) => a.arrivalTick - b.arrivalTick);
    for (const inc of attacks) {
      const key = `${inc.id}:${inc.sighted?.size ?? "unseen"}`;
      if (this.handledThreats.has(key)) continue;
      this.handledThreats.add(key);
      const v = this.state.villages.find((x) => x.id === inc.to.id);
      if (!v) continue;

      const candidates = slowestCandidates(inc, this.rules);
      if (candidates.length === 1 && candidates[0] === "scout") {
        log(this.tick, v.name, `scouts from ${inc.from.name}; nothing to do`);
        continue;
      }
      const pop = await this.attackerPop(inc);
      const attacker = guessAttacker(pop, candidates, this.rules);
      const guess = `~${describeUnits(attacker)} (slowest: ${candidates.join("/") || "unknown"})`;
      const wall = v.buildings.wall;

      // Support already on the road, or timed to land by then, and our own troops home by then.
      const support = addUnits(
        ...v.supportHere.map((s) => s.units),
        ...this.state.commands.incoming.filter((c) => c.kind === "support" && c.to.id === v.id && c.arrivalTick <= inc.arrivalTick).map((c) => c.units),
        ...this.scheduledSends(v.id, inc.arrivalTick),
      );
      const ownTroops = addUnits(
        v.units.home,
        ...this.state.commands.outgoing.filter((c) => c.from.id === v.id && c.returning && c.arrivalTick <= inc.arrivalTick).map((c) => c.units),
      );
      // While raid orders stand, raiders ride out again as soon as they're home: don't count on them.
      const staying = v.orders.raids.length ? omit(ownTroops, RAID_UNITS) : ownTroops;
      if (await this.holds(attacker, addUnits(support, staying), wall)) {
        log(this.tick, v.name, `holds against ${guess} at t${inc.arrivalTick}`);
        continue;
      }

      // Stop the raids, so everyone home stays home, and call back the raids still in their cancel
      // window that would be home before the attack lands.
      const recalls = this.state.commands.outgoing.filter((c) =>
        c.from.id === v.id && c.kind === "attack" && !c.returning &&
        c.cancellableUntilTick !== null && c.cancellableUntilTick >= this.tick &&
        this.tick + (this.tick - c.sentTick) <= inc.arrivalTick);
      let defenders = addUnits(support, ownTroops, ...recalls.map((c) => c.units));
      const recallActions = recalls.map((c): Planned => ({ action: { type: "cancel_command", command: c.id }, label: `${v.name} call back raid on ${c.to.name}` }));

      if (await this.holds(attacker, defenders, wall)) {
        await this.suspendRaids(v, inc.arrivalTick);
        log(this.tick, v.name, `holds against ${guess} once raids are home`);
        planned.push(...recallActions);
        continue;
      }

      const supports = this.supportFor(v, inc);
      defenders = addUnits(defenders, ...supports.map((s) => s.units));
      if (supports.length && (await this.holds(attacker, defenders, wall))) {
        await this.suspendRaids(v, inc.arrivalTick);
        log(this.tick, v.name, `needs help against ${guess}: support from ${supports.length} village(s)`);
        planned.push(...recallActions, ...supports.map((s) => s.planned));
        for (const s of supports) this.supportOut.push({ at: v.id, home: s.home, afterTick: inc.arrivalTick });
        continue;
      }
      log(this.tick, v.name, `can't hold against ${guess}; troops out stay out`);
    }
    return planned;
  }

  /** Units in our support sends to `target`, timed with arriveAtTick, that haven't left yet but land by `byTick`. */
  private scheduledSends(target: string, byTick: number): UnitCounts[] {
    return this.state.scheduled
      .filter((s) => s.action.type === "send" && s.action.kind === "support" && s.action.target === target)
      .filter((s) => typeof s.action.arriveAtTick === "number" && s.action.arriveAtTick <= byTick)
      .map((s) => s.action.units as UnitCounts);
  }

  /** Defensive troops from our other villages that can arrive in time, landing on the attack's tick. */
  private supportFor(v: VillageState, inc: IncomingCommand): { home: string; units: UnitCounts; planned: Planned }[] {
    const threatened = new Set(this.state.commands.incoming.filter((c) => c.kind === "attack" && c.id !== inc.id).map((c) => c.to.id));
    const supports: { home: string; units: UnitCounts; planned: Planned }[] = [];
    for (const w of this.state.villages) {
      if (w.id === v.id || threatened.has(w.id)) continue;
      // Not the troops already timed to leave on another send.
      const leaving = addUnits(...this.state.scheduled.filter((s) => s.action.type === "send" && s.action.village === w.id).map((s) => s.action.units as UnitCounts));
      const units = pick(subtractUnits(w.units.home, leaving), DEFENSIVE_UNITS);
      if (popOf(units, this.rules) === 0) continue;
      const travel = travelTicks(w, v, units, this.rules);
      if (this.tick + travel > inc.arrivalTick) continue;
      // Support landing on the attack's tick arrives first (design: arrivals). Leave now if it's that tight.
      const timing = inc.arrivalTick - travel > this.tick ? { arriveAtTick: inc.arrivalTick } : {};
      supports.push({
        home: w.id,
        units,
        planned: {
          action: { type: "send", village: w.id, target: v.id, kind: "support", units, ...timing },
          label: `${w.name} support ${v.name} with ${describeUnits(units)} by t${inc.arrivalTick}`,
        },
      });
    }
    return supports;
  }

  /** Keeps raiding troops home until the attack has landed. */
  private async suspendRaids(v: VillageState, untilTick: number): Promise<void> {
    this.raidsSuspendedUntil.set(v.id, Math.max(untilTick, this.raidsSuspendedUntil.get(v.id) ?? 0));
    if (v.orders.raids.length) await this.setRaids(v, []);
  }

  /** Brings support home once the attack it went for has landed and nothing else is coming. */
  private recallSupport(): Planned[] {
    const planned: Planned[] = [];
    this.supportOut = this.supportOut.filter((s) => {
      if (this.tick <= s.afterTick) return true;
      if (this.state.commands.incoming.some((c) => c.kind === "attack" && c.to.id === s.at)) return true;
      const home = this.state.villages.find((v) => v.id === s.home);
      if (home?.supportAbroad.some((stack) => stack.at.id === s.at)) {
        planned.push({ action: { type: "recall", village: s.at, home: s.home }, label: `${home.name} recall support from ${this.villageName(s.at)}` });
      }
      return false;
    });
    return planned;
  }
}

// ---------------------------------------------------------------------------------------------
// Getting started: a key, a world, then the steward.

async function signUpIfNeeded(client: Client): Promise<void> {
  if (client.key) return;
  const name = process.env.STEWARD_NAME;
  if (!name) throw new Error("Set STEWARD_KEY, or STEWARD_NAME to sign up for a new key.");
  const signup = await client.call<{ account: { name: string }; apiKey: string }>("POST", "/accounts", { body: { name } });
  client.key = signup.apiKey;
  console.log(`Signed up as ${signup.account.name}. Your key, shown once; keep it:\n\n  STEWARD_KEY=${signup.apiKey}\n`);
}

async function chooseWorld(client: Client): Promise<string> {
  if (process.env.STEWARD_WORLD) return process.env.STEWARD_WORLD;
  if (process.env.STEWARD_SANDBOX === "1") {
    const sandbox = await client.call<WorldSummary>("POST", "/sandboxes", { body: { speed: STRATEGY.sandboxSpeed } });
    log(sandbox.tick, "steward", `created sandbox ${sandbox.id} at speed ${sandbox.speed}`);
    return sandbox.id;
  }
  // With a key, the list holds the public worlds plus your own sandboxes.
  const worlds = await client.call<WorldSummary[]>("GET", "/worlds");
  const live = worlds.filter((w) => w.status !== "ended");
  const world = live.find((w) => w.kind === "sandbox") ?? live.find((w) => w.kind !== "sandbox") ?? worlds[0];
  if (!world) throw new Error("No worlds on this server. Set STEWARD_SANDBOX=1 to make one.");
  return world.id;
}

async function main(): Promise<void> {
  const client = new Client((process.env.STEWARD_URL ?? "http://localhost:8787").replace(/\/+$/, ""), process.env.STEWARD_KEY ?? null);
  await signUpIfNeeded(client);
  const worldId = await chooseWorld(client);
  await new Steward(client, worldId).run();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
