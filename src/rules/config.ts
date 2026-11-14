// Every rule number in Norn Steward lives here and nowhere else.
// The mechanics that use them are described in docs/design.md. GET /worlds/{w}/rules serves this
// file as JSON, plus precomputed per-level tables (src/rules/tables.ts), so bots compute with exactly
// the numbers the server uses.
//
// Time is in ticks. One tick is one second of game time. A world's speed only changes how many
// ticks pass per real second, never these numbers.
//
// Rounding: wherever a formula says round(x), it means Math.floor(x + 0.5) (half up), never
// banker's rounding. `^` is Math.pow. Bots should read the precomputed tables rather than call pow.

export const RULES_VERSION = 2;

export const round = (x: number): number => Math.floor(x + 0.5);

export type Resource = "timber" | "stone" | "iron";
export const RESOURCES: readonly Resource[] = ["timber", "stone", "iron"] as const;
export type Cost = Record<Resource, number>;

export type BuildingId =
  | "hall"
  | "lumberyard"
  | "quarry"
  | "mine"
  | "farm"
  | "storehouse"
  | "cellar"
  | "barracks"
  | "smithy"
  | "stable"
  | "workshop"
  | "market"
  | "wall"
  | "watchtower"
  | "court";

export const BUILDING_IDS: readonly BuildingId[] = [
  "hall",
  "lumberyard",
  "quarry",
  "mine",
  "farm",
  "storehouse",
  "cellar",
  "barracks",
  "smithy",
  "stable",
  "workshop",
  "market",
  "wall",
  "watchtower",
  "court",
] as const;

export interface BuildingRule {
  name: string;
  description: string;
  /** A village always has at least this level; trebuchets can't take it lower. */
  minLevel: number;
  maxLevel: number;
  /** Cost of level L = round(baseCost * costGrowth^(L-1)), per resource. */
  baseCost: Cost;
  costGrowth: number;
  /** Ticks to build level L = max(1, round(baseTime * timeGrowth^(L-1) * HALL_SPEED_BASE^hallLevel)). */
  baseTime: number;
  timeGrowth: number;
  /** Total population the building uses at level L >= 1 = round(basePop * popGrowth^(L-1)); 0 at level 0. */
  basePop: number;
  popGrowth: number;
  /** Points for level L = round(basePoints * SCORING.pointsGrowth^(L-1)); a village's points sum every level it has. */
  basePoints: number;
  /** Other buildings (and levels) needed before this one can be queued. */
  requires: Partial<Record<BuildingId, number>>;
}

const g = 1.26; // the usual cost growth

export const BUILDINGS: Record<BuildingId, BuildingRule> = {
  hall: {
    name: "Great Hall",
    description: "Seat of the holding. Each level makes every construction in the village faster.",
    minLevel: 1, maxLevel: 30,
    baseCost: { timber: 90, stone: 80, iron: 70 }, costGrowth: g,
    baseTime: 20, timeGrowth: 1.2, basePop: 5, popGrowth: 1.17, basePoints: 10,
    requires: {},
  },
  lumberyard: {
    name: "Lumberyard",
    description: "Fells timber.",
    minLevel: 0, maxLevel: 30,
    baseCost: { timber: 50, stone: 60, iron: 40 }, costGrowth: 1.25,
    baseTime: 10, timeGrowth: 1.2, basePop: 5, popGrowth: 1.155, basePoints: 6,
    requires: {},
  },
  quarry: {
    name: "Quarry",
    description: "Cuts stone.",
    minLevel: 0, maxLevel: 30,
    baseCost: { timber: 65, stone: 50, iron: 40 }, costGrowth: 1.27,
    baseTime: 10, timeGrowth: 1.2, basePop: 10, popGrowth: 1.14, basePoints: 6,
    requires: {},
  },
  mine: {
    name: "Iron Mine",
    description: "Digs iron.",
    minLevel: 0, maxLevel: 30,
    baseCost: { timber: 75, stone: 65, iron: 70 }, costGrowth: 1.252,
    baseTime: 12, timeGrowth: 1.2, basePop: 10, popGrowth: 1.17, basePoints: 6,
    requires: {},
  },
  farm: {
    name: "Farm",
    description: "Feeds the village. Its level sets the population limit for buildings and troops.",
    minLevel: 1, maxLevel: 30,
    baseCost: { timber: 45, stone: 40, iron: 30 }, costGrowth: 1.3,
    baseTime: 14, timeGrowth: 1.2, basePop: 0, popGrowth: 1, basePoints: 5,
    requires: {},
  },
  storehouse: {
    name: "Storehouse",
    description: "Sets how much of each resource the village can hold.",
    minLevel: 1, maxLevel: 30,
    baseCost: { timber: 60, stone: 50, iron: 40 }, costGrowth: 1.265,
    baseTime: 12, timeGrowth: 1.2, basePop: 0, popGrowth: 1, basePoints: 6,
    requires: {},
  },
  cellar: {
    name: "Cellar",
    description: "Hides part of each resource from raiders.",
    minLevel: 0, maxLevel: 10,
    baseCost: { timber: 50, stone: 60, iron: 50 }, costGrowth: 1.25,
    baseTime: 8, timeGrowth: 1.2, basePop: 2, popGrowth: 1.17, basePoints: 5,
    requires: {},
  },
  barracks: {
    name: "Barracks",
    description: "Trains foot soldiers. Each level trains them faster.",
    minLevel: 0, maxLevel: 25,
    baseCost: { timber: 200, stone: 170, iron: 90 }, costGrowth: g,
    baseTime: 25, timeGrowth: 1.2, basePop: 7, popGrowth: 1.17, basePoints: 16,
    requires: { hall: 3 },
  },
  smithy: {
    name: "Smithy",
    description: "Forges arms. Its level unlocks the better unit types.",
    minLevel: 0, maxLevel: 20,
    baseCost: { timber: 220, stone: 180, iron: 240 }, costGrowth: g,
    baseTime: 50, timeGrowth: 1.2, basePop: 20, popGrowth: 1.17, basePoints: 19,
    requires: { hall: 5, barracks: 1 },
  },
  stable: {
    name: "Stable",
    description: "Trains scouts and horsemen. Each level trains them faster.",
    minLevel: 0, maxLevel: 20,
    baseCost: { timber: 270, stone: 240, iron: 260 }, costGrowth: g,
    baseTime: 80, timeGrowth: 1.2, basePop: 8, popGrowth: 1.17, basePoints: 20,
    requires: { hall: 10, barracks: 5, smithy: 5 },
  },
  workshop: {
    name: "Siege Workshop",
    description: "Builds rams and trebuchets. Each level builds them faster.",
    minLevel: 0, maxLevel: 15,
    baseCost: { timber: 300, stone: 240, iron: 260 }, costGrowth: g,
    baseTime: 80, timeGrowth: 1.2, basePop: 8, popGrowth: 1.17, basePoints: 24,
    requires: { hall: 10, smithy: 10 },
  },
  market: {
    name: "Market",
    description: "Houses merchants who carry resources to any village.",
    minLevel: 0, maxLevel: 25,
    baseCost: { timber: 100, stone: 100, iron: 100 }, costGrowth: g,
    baseTime: 35, timeGrowth: 1.2, basePop: 20, popGrowth: 1.17, basePoints: 10,
    requires: { hall: 3, storehouse: 2 },
  },
  wall: {
    name: "Wall",
    description: "Multiplies the defence of everyone inside.",
    minLevel: 0, maxLevel: 20,
    baseCost: { timber: 50, stone: 100, iron: 20 }, costGrowth: g,
    baseTime: 45, timeGrowth: 1.2, basePop: 5, popGrowth: 1.17, basePoints: 8,
    requires: { barracks: 1 },
  },
  watchtower: {
    name: "Watchtower",
    description: "Sees incoming armies early: their size, and whether an envoy marches with them.",
    minLevel: 0, maxLevel: 20,
    baseCost: { timber: 120, stone: 150, iron: 80 }, costGrowth: 1.22,
    baseTime: 40, timeGrowth: 1.2, basePop: 4, popGrowth: 1.17, basePoints: 12,
    requires: { hall: 5, wall: 1 },
  },
  court: {
    name: "Court",
    description: "Where envoys are trained, who win villages over to your banner.",
    minLevel: 0, maxLevel: 1,
    baseCost: { timber: 3000, stone: 4500, iron: 2500 }, costGrowth: 1,
    baseTime: 600, timeGrowth: 1, basePop: 20, popGrowth: 1, basePoints: 100,
    requires: { hall: 10, smithy: 10, market: 5 },
  },
};

/** Build time multiplier from the Great Hall: HALL_SPEED_BASE^hallLevel. */
export const HALL_SPEED_BASE = 0.952;

// ---------------------------------------------------------------------------------------------
// Economy

export const ECONOMY = {
  /**
   * Production per minute of a lumberyard/quarry/mine at level L >= 1 = base * growth^(L-1);
   * productionAtZero at level 0. Resources are kept in milli-units (integers): each tick adds
   * round(perMinute * 1000 / 60) milli-units. The tables give that per-tick figure per level.
   */
  productionBase: 112,
  productionGrowth: 1.165,
  productionAtZero: 20,
  /** Storehouse capacity per resource at level L = round(base * growth^(L-1)). */
  storageBase: 3600,
  storageGrowth: 1.22,
  /** Cellar protection per resource at level L >= 1 = round(base * growth^(L-1)); 0 at level 0. */
  cellarBase: 450,
  cellarGrowth: 1.33,
  /** Farm population limit at level L = round(base * growth^(L-1)). */
  farmBase: 200,
  farmGrowth: 1.18,
  /** What a newly founded player village starts with (plus lateJoinResourcesPerTick * tick, capped at storage). */
  startResources: { timber: 1000, stone: 1000, iron: 1000 } as Cost,
  lateJoinResourcesPerTick: 1,
  startBuildings: { hall: 1, farm: 1, storehouse: 1, lumberyard: 1, quarry: 1, mine: 1 } as Partial<Record<BuildingId, number>>,
  /** Build queue length per village. Resources are paid when an item is queued. */
  buildQueueMax: 5,
  /** Training queue length (batches) per producing building, and units per batch. */
  trainQueueMax: 10,
  trainBatchMax: 10000,
  /** Share of the cost returned when a running build item is cancelled: floor(cost * refundInProgress). Not-started items and untrained units are refunded in full. */
  refundInProgress: 0.8,
};

// ---------------------------------------------------------------------------------------------
// Units

export type UnitId =
  | "pikeman"
  | "shieldman"
  | "raider"
  | "archer"
  | "scout"
  | "lancer"
  | "knight"
  | "ram"
  | "trebuchet"
  | "envoy";

export const UNIT_IDS: readonly UnitId[] = [
  "pikeman",
  "shieldman",
  "raider",
  "archer",
  "scout",
  "lancer",
  "knight",
  "ram",
  "trebuchet",
  "envoy",
] as const;

export type AttackType = "infantry" | "cavalry" | "ranged";
export const ATTACK_TYPES: readonly AttackType[] = ["infantry", "cavalry", "ranged"] as const;

export interface UnitRule {
  name: string;
  description: string;
  /** Which building trains it, and the level that building needs. */
  building: "barracks" | "stable" | "workshop" | "court";
  buildingLevel: number;
  smithyLevel: number;
  cost: Cost;
  pop: number;
  attack: number;
  attackType: AttackType;
  defense: Record<AttackType, number>;
  /** Ticks to cross one field. A group moves at its slowest member's pace. */
  speed: number;
  carry: number;
  /** Ticks to train one at producing-building level 1; see TRAINING. */
  trainTime: number;
}

export const UNITS: Record<UnitId, UnitRule> = {
  pikeman: {
    name: "Pikeman", description: "Cheap spear wall. Holds against horsemen.",
    building: "barracks", buildingLevel: 1, smithyLevel: 0,
    cost: { timber: 45, stone: 35, iron: 15 }, pop: 1,
    attack: 10, attackType: "infantry", defense: { infantry: 20, cavalry: 45, ranged: 15 },
    speed: 18, carry: 25, trainTime: 8,
  },
  shieldman: {
    name: "Shieldman", description: "Heavy shield and short sword. Holds against foot soldiers and arrows.",
    building: "barracks", buildingLevel: 1, smithyLevel: 1,
    cost: { timber: 35, stone: 30, iron: 65 }, pop: 1,
    attack: 22, attackType: "infantry", defense: { infantry: 50, cavalry: 20, ranged: 40 },
    speed: 22, carry: 15, trainTime: 11,
  },
  raider: {
    name: "Raider", description: "Axe and torch. Hits hard, defends badly.",
    building: "barracks", buildingLevel: 1, smithyLevel: 2,
    cost: { timber: 55, stone: 35, iron: 45 }, pop: 1,
    attack: 42, attackType: "infantry", defense: { infantry: 8, cavalry: 5, ranged: 8 },
    speed: 18, carry: 12, trainTime: 10,
  },
  archer: {
    name: "Archer", description: "Longbow. Strong behind a wall, useful in an attack mix.",
    building: "barracks", buildingLevel: 5, smithyLevel: 5,
    cost: { timber: 90, stone: 40, iron: 55 }, pop: 1,
    attack: 18, attackType: "ranged", defense: { infantry: 45, cavalry: 35, ranged: 10 },
    speed: 18, carry: 10, trainTime: 13,
  },
  scout: {
    name: "Scout", description: "Rides ahead and reports what a village holds. Fights other scouts first.",
    building: "stable", buildingLevel: 1, smithyLevel: 0,
    cost: { timber: 45, stone: 55, iron: 25 }, pop: 2,
    attack: 0, attackType: "cavalry", defense: { infantry: 2, cavalry: 2, ranged: 2 },
    speed: 9, carry: 0, trainTime: 7,
  },
  lancer: {
    name: "Lancer", description: "Light horse. Fast, carries a lot, the raider's raider.",
    building: "stable", buildingLevel: 3, smithyLevel: 3,
    cost: { timber: 120, stone: 110, iron: 240 }, pop: 4,
    attack: 125, attackType: "cavalry", defense: { infantry: 25, cavalry: 35, ranged: 25 },
    speed: 10, carry: 85, trainTime: 14,
  },
  knight: {
    name: "Knight", description: "Armoured horse. Expensive, good at everything.",
    building: "stable", buildingLevel: 10, smithyLevel: 10,
    cost: { timber: 210, stone: 160, iron: 580 }, pop: 6,
    attack: 160, attackType: "cavalry", defense: { infantry: 190, cavalry: 90, ranged: 170 },
    speed: 11, carry: 50, trainTime: 28,
  },
  ram: {
    name: "Ram", description: "Breaks walls, before the fight and after a win.",
    building: "workshop", buildingLevel: 1, smithyLevel: 0,
    cost: { timber: 280, stone: 220, iron: 190 }, pop: 5,
    attack: 2, attackType: "infantry", defense: { infantry: 20, cavalry: 45, ranged: 20 },
    speed: 30, carry: 0, trainTime: 35,
  },
  trebuchet: {
    name: "Trebuchet", description: "After a win, knocks down levels of the building you aim it at.",
    building: "workshop", buildingLevel: 2, smithyLevel: 5,
    cost: { timber: 330, stone: 380, iron: 120 }, pop: 8,
    attack: 90, attackType: "infantry", defense: { infantry: 100, cavalry: 50, ranged: 100 },
    speed: 30, carry: 0, trainTime: 55,
  },
  envoy: {
    name: "Envoy", description: "Talks a beaten village's people out of their loyalty. Enough of them and it's yours.",
    building: "court", buildingLevel: 1, smithyLevel: 0,
    cost: { timber: 6000, stone: 7500, iron: 6500 }, pop: 40,
    attack: 30, attackType: "infantry", defense: { infantry: 100, cavalry: 50, ranged: 100 },
    // Same pace as the siege engines, so only a watchtower tells an envoy train from a siege.
    speed: 30, carry: 0, trainTime: 150,
  },
};

export const TRAINING = {
  /** Ticks to train one unit = max(1, round(unit.trainTime * speedBase^(max(1, buildingLevel)-1))), at the building's level when that unit starts. */
  speedBase: 0.94,
  /** Envoy cost = unit cost * the number of villages you own when the batch is queued. */
  envoyCostPerVillageOwned: true,
};

// ---------------------------------------------------------------------------------------------
// Combat

export const COMBAT = {
  /** Defence every player village has before any troops: farmers with pitchforks. */
  villageBaseDefense: 20,
  /** Wall at effective level E: defence = (units + base + wallFlat * E) * wallMultBase^E. */
  wallFlat: 25,
  wallMultBase: 1.04,
  /** Loser loses everything; winner loses round(count * (loserStrength / winnerStrength)^lossExponent) of each unit type. */
  lossExponent: 1.5,
  /** Rams to knock the wall from level L to L-1: ceil(ramBase + ramPerLevel * L). Rams are never used up by knocking. */
  ramBase: 1,
  ramPerLevel: 0.5,
  /** Trebuchets to knock a building from level L to L-1: ceil(trebuchetBase + trebuchetPerLevel * L). */
  trebuchetBase: 2,
  trebuchetPerLevel: 0.25,
  /** Each surviving envoy in a winning attack lowers loyalty by this much. */
  envoyLoyaltyHit: 34,
  /** Loyalty a conquered village starts at under its new owner. */
  loyaltyAfterConquest: 25,
  loyaltyMax: 100,
  /** Every village below loyaltyMax regains 1 loyalty on each tick T where T % loyaltyRegenTicks == 0. */
  loyaltyRegenTicks: 120,
  /** Ticks after it's sent during which a command can still be called back (never past arrivalTick - 1). */
  cancelWindow: 30,
  /** An attack (other than a scouting run) must carry at least this much population. */
  minAttackPop: 10,
};

export const SCOUTING = {
  /** If attacking scouts a > defending scouts d, every defending scout dies and the attacker loses
   * round(a * (d/a)^lossExponent); otherwise every attacking scout dies and the defender loses
   * round(d * (a/d)^lossExponent). d counts scouts in support too. */
  lossExponent: 1.5,
};

// ---------------------------------------------------------------------------------------------
// Market

export const MARKET = {
  /** Merchants at market level L: round(merchantsA * L^2 + merchantsB * L). */
  merchantsA: 0.4,
  merchantsB: 0.6,
  merchantCarry: 1000,
  /** Ticks per field, both ways. */
  merchantSpeed: 6,
};

// ---------------------------------------------------------------------------------------------
// Watchtower

export const WATCHTOWER = {
  /** Radius in fields at level L >= 1: radiusBase + radiusPerLevel * L; no sighting at level 0. */
  radiusBase: 3,
  radiusPerLevel: 1.5,
  /** Size buckets by total population of the incoming army; maxPop is inclusive, null means no upper bound. */
  sizeBuckets: [
    { name: "handful", maxPop: 50 },
    { name: "company", maxPop: 500 },
    { name: "army", maxPop: 3000 },
    { name: "host", maxPop: null },
  ] as { name: "handful" | "company" | "army" | "host"; maxPop: number | null }[],
};

// ---------------------------------------------------------------------------------------------
// The map

export const MAP = {
  /** Map is size × size fields per world kind; villages sit on whole-number coordinates; centre (size/2, size/2). */
  size: { blitz: 200, council: 200, sandbox: 100 },
  /** The n-th player village founded in a round (0-based, rejoins included) goes at radius
   * round(ringBase + ringGrowth * sqrt(n)) and angle n * spawnAngle + the world's seeded offset. */
  ringBase: 6,
  ringGrowth: 2.5,
  spawnAngle: 2.399963,
  /** No two villages closer than this (fields). */
  minSpacing: 2,
  /** Hamlets placed around a player's first village of the round, at a seeded distance in hamletDistance. */
  hamletsPerPlayer: 3,
  hamletDistance: [2, 5] as [number, number],
  /** Hamlet building levels are drawn from these ranges (inclusive); unlisted buildings are 0 except the minimums. */
  hamletLevels: {
    hall: [1, 3], lumberyard: [1, 4], quarry: [1, 4], mine: [1, 4], farm: [1, 3], storehouse: [2, 5], wall: [1, 3],
  } as Partial<Record<BuildingId, [number, number]>>,
  /** Hamlets start with this share of their storage in each resource. */
  hamletStartFill: 0.5,
  /** A hamlet's base defence (instead of villageBaseDefense): hamletBaseDefense +
   * min(hamletMilitiaCap, hamletMilitiaPerTick * ticks since it last lost a battle, or since tick 0). */
  hamletBaseDefense: 150,
  hamletMilitiaPerTick: 0.25,
  hamletMilitiaCap: 1500,
};

export const PROTECTION = {
  /** A player's villages can't be attacked or scouted by players for
   * min(maxTicks, newPlayerTicks + floor(tickAtJoin * lateJoinFactor)) ticks after joining.
   * Sending an attack or scouting run at another player ends your own protection. */
  newPlayerTicks: 900,
  lateJoinFactor: 0.25,
  maxTicks: 2700,
};

// ---------------------------------------------------------------------------------------------
// Points, score and rounds

export const SCORING = {
  /** Points for a building level: round(basePoints * pointsGrowth^(L-1)). */
  pointsGrowth: 1.2,
  /** Score = points + renownWeight * (attack renown + defence renown). The leaderboard ranks by score. */
  renownWeight: 2,
  /** Public numbers (map points, the leaderboard) refresh only on ticks divisible by this; owners see their own live. */
  publicSnapshotTicks: 300,
  /** A round ends early when one player holds this share of all villages, hamlets included. */
  dominanceShare: 0.5,
};

export const HISTORY = {
  sampleEveryTicks: 60,
};

// ---------------------------------------------------------------------------------------------
// World kinds and sandboxes

export const WORLD_KINDS = {
  blitz: { speed: 1, durationTicks: 10800, houseBots: { warden: 2, reaver: 2, sovereign: 2 } },
  /** For LLMs: everyone gets one batch of actions per actIntervalTicks, so thinking time isn't the deciding factor. */
  council: { speed: 0.25, durationTicks: 10800, actIntervalTicks: 8, houseBots: { warden: 1, reaver: 1, sovereign: 1 } },
};

export const SANDBOX = {
  speedMin: 0.25,
  /** On a server started with STEWARD_DEV=1 (your own machine) the cap is devSpeedMax. */
  speedMax: 50,
  devSpeedMax: 1000,
  speedDefault: 5,
  durationMin: 600,
  durationMax: 43200,
  durationDefault: 10800,
  houseBotsMax: 12,
  /** House bots a sandbox seats when its creator doesn't say. */
  houseBotsDefault: { warden: 1, reaver: 1, sovereign: 1 },
  stepMax: 3600,
  perAccount: 2,
  /** Lockstep sandboxes: a creator's wait advances at most this many ticks (default ticksPerTurn). */
  ticksPerTurnMax: 300,
  ticksPerTurnDefault: 10,
};

// ---------------------------------------------------------------------------------------------
// Standing orders: simple automation the server runs for every player, on every surface.

export const ORDERS = {
  maxBuild: 20,
  maxTrain: 10,
  maxRaids: 10,
  /** A raid order pauses after a lost battle or when it loses more than this share of what it sent. */
  raidStopLossDefault: 0.2,
};

/** Limits on what a bot can ask for. */
export const LIMITS = {
  actionsPerBatch: 50,
  maxMapRadius: 30,
  maxEventWaitSeconds: 25,
  eventsPerPage: 500,
  reportsPerPage: 100,
  /** How long (ticks) a successful action's clientId is remembered for idempotent retries, and how many per player. */
  clientIdTtl: 3600,
  clientIdsKept: 5000,
  eventsKept: 5000,
  reportsKept: 1000,
  villageNameMax: 24,
  playerNameMin: 3,
  playerNameMax: 24,
  renameCooldownTicks: 600,
  outgoingCommandsPerVillage: 100,
  /** Scheduled actions (atTick / arriveAtTick): how far ahead, and how many pending per player. */
  maxScheduleAhead: 3600,
  scheduledPerPlayer: 100,
  notesMaxChars: 4000,
  noteMaxChars: 200,
  /** Simulator inputs (api.ts § Simulators): unit counts up to this, resources and hidden up to simulateMaxResources. */
  simulateMaxUnits: 1_000_000,
  simulateMaxResources: 1_000_000_000,
};

/** Server-side limits (transport, not game rules). */
export const SERVER = {
  /** Per account: calls (token bucket). */
  callBurst: 40,
  callsPerSecond: 20,
  /** Per account: actions across REST, MCP and both; standing orders are exempt. */
  actionBurst: 200,
  actionsPerSecond: 25,
  /** Calls without a key, per client IP (IPv6 grouped by /64). */
  keylessBurst: 20,
  keylessPerSecond: 5,
  /** Dashboard reads (GET with X-Steward-Client: dashboard), per account. */
  dashboardBurst: 20,
  dashboardPerSecond: 4,
  signupsPerIpPerHour: 5,
  rotationsPerHour: 3,
  concurrentWaitsPerAccount: 2,
  socketsPerIp: 8,
  socketsPerAccountPerWorld: 4,
  helloTimeoutMs: 5000,
  bodyLimitBytes: 65536,
  activityKept: 2000,
  /** Stream rates per socket. */
  tickMessagesPerSecond: 4,
  stateMessagesPerSecond: 2,
  /** Ticks a clock processes per macrotask before yielding. */
  ticksPerChunk: 50,
  /** Sandboxes across the whole server. */
  sandboxesMax: 20,
  sandboxTickBudgetPerSecond: 2000,
  endedSandboxTtlMs: 3600_000,
  snapshotEveryMs: 10_000,
  /** A public world starts its next round this long after one ends. */
  nextRoundDelayMs: 60_000,
};

/** House bots think every thinkEveryTicks ticks, staggered by seat, so a world full of them stays cheap. */
export const HOUSE_BOTS = {
  thinkEveryTicks: 5,
};

/** How the MCP server sizes what it returns for a language model's context (docs/mcp.md). Not game rules. */
export const MCP = {
  /** Briefings stay within these budgets, counted as characters / charsPerToken. */
  charsPerToken: 3.5,
  briefTokensOneVillage: 1500,
  briefTokensMax: 4000,
  /** Beyond this many villages, those needing no attention shrink to { id, name, res, queueFree }. */
  briefFullVillages: 6,
  /** BriefVillage.soon: at most this many. */
  briefSoonMax: 3,
  /** A village needs attention when a resource is at this share of its storage or more. */
  nearFullShare: 0.9,
  briefReportsLatest: 3,
  briefThreatsMax: 20,
  briefMovingMax: 20,
  /** list_reports when no limit is given. */
  reportsDefault: 10,
  /** view_map rows, and get_leaderboard rows (your own row always comes too). */
  mapRowsDefault: 20,
  mapRowsMax: 100,
  leaderboardRowsDefault: 20,
  /** view_map distances are rounded to this many decimals. */
  distanceDecimals: 1,
  /** wait_for_events: at most this many event lines per return (the rest come with the next one). */
  waitLinesMax: 50,
  /** wait_for_events sends a progress notification this often while it holds. */
  progressEveryMs: 10_000,
  instructionsMaxChars: 1500,
  promptMaxTokens: 1200,
  /** The steward prompt's shift length when none is given, in real minutes. */
  shiftMinutesDefault: 30,
};
