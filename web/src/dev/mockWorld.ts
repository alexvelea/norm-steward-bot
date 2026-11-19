// A fake world for building the dashboard without a server (?mock=1). Deterministic from the world id:
// the same villages, the same marches and the same battles every time. It is not the game: rules are
// borrowed from config.ts where the picture needs them (production, build and travel times, sightings)
// and everything else is invented to look plausible. It speaks the real wire shapes and emits real
// StreamMessages, so the page under test runs the same code as against a server.
import type {
  ActivityEntry,
  BuildingId,
  BuildOption,
  BuildQueueItem,
  GameEvent,
  GodMovement,
  HistorySample,
  IncomingCommand,
  LeaderboardResponse,
  MapPlayer,
  MapResponse,
  MapVillage,
  OutgoingCommand,
  Report,
  ReportSummary,
  Resources,
  SizeBucket,
  StateResponse,
  StreamMessage,
  SupportStack,
  Trade,
  TrainBatch,
  TrainingBuilding,
  TrainOption,
  UnitCounts,
  UnitId,
  VillageRef,
  VillageState,
  WorldKind,
  WorldSummary,
} from "../contract";
import {
  BUILDINGS,
  BUILDING_IDS,
  COMBAT,
  ECONOMY,
  HALL_SPEED_BASE,
  HISTORY,
  MAP,
  MARKET,
  RESOURCES,
  roundHalfUp,
  SANDBOX,
  SCORING,
  TRAINING,
  UNITS,
  UNIT_IDS,
  WATCHTOWER,
} from "../contract";
import { hashString, seededRandom } from "../lib/noise";
import { distance, travelTicks } from "../world/movements";

// ---- Rule helpers (formulas from design.md, numbers from config.ts) ----------------------------

const costOf = (b: BuildingId, level: number): Resources => {
  const rule = BUILDINGS[b];
  const k = rule.costGrowth ** (level - 1);
  return { timber: roundHalfUp(rule.baseCost.timber * k), stone: roundHalfUp(rule.baseCost.stone * k), iron: roundHalfUp(rule.baseCost.iron * k) };
};
const buildTicks = (b: BuildingId, level: number, hall: number) =>
  Math.max(1, roundHalfUp(BUILDINGS[b].baseTime * BUILDINGS[b].timeGrowth ** (level - 1) * HALL_SPEED_BASE ** hall));
const buildingPop = (b: BuildingId, level: number) => (level <= 0 ? 0 : roundHalfUp(BUILDINGS[b].basePop * BUILDINGS[b].popGrowth ** (level - 1)));
const levelPoints = (b: BuildingId, level: number) => roundHalfUp(BUILDINGS[b].basePoints * SCORING.pointsGrowth ** (level - 1));
const perMinute = (level: number) => (level === 0 ? ECONOMY.productionAtZero : ECONOMY.productionBase * ECONOMY.productionGrowth ** (level - 1));
const perTickMilli = (level: number) => roundHalfUp((perMinute(level) * 1000) / 60);
const storageAt = (level: number) => roundHalfUp(ECONOMY.storageBase * ECONOMY.storageGrowth ** (level - 1));
const cellarAt = (level: number) => (level === 0 ? 0 : roundHalfUp(ECONOMY.cellarBase * ECONOMY.cellarGrowth ** (level - 1)));
const farmAt = (level: number) => roundHalfUp(ECONOMY.farmBase * ECONOMY.farmGrowth ** (level - 1));
const merchantsAt = (level: number) => roundHalfUp(MARKET.merchantsA * level * level + MARKET.merchantsB * level);
const watchRadius = (level: number) => (level === 0 ? 0 : WATCHTOWER.radiusBase + WATCHTOWER.radiusPerLevel * level);
const trainTicks = (u: UnitId, level: number) => Math.max(1, roundHalfUp(UNITS[u].trainTime * 1000 * TRAINING.speedBase ** (Math.max(1, level) - 1))) / 1000;
const PRODUCER: Record<BuildingId, keyof Resources | null> = {
  hall: null, lumberyard: "timber", quarry: "stone", mine: "iron", farm: null, storehouse: null, cellar: null, barracks: null,
  smithy: null, stable: null, workshop: null, market: null, wall: null, watchtower: null, court: null,
};
const TRAINERS: TrainingBuilding[] = ["barracks", "stable", "workshop", "court"];
const MILLI = 1000;

function sizeBucket(pop: number): SizeBucket {
  for (const b of WATCHTOWER.sizeBuckets) if (b.maxPop === null || pop <= b.maxPop) return b.name;
  return "host";
}

function popOf(units: UnitCounts): number {
  return UNIT_IDS.reduce((sum, u) => sum + (units[u] ?? 0) * UNITS[u].pop, 0);
}

function addUnits(into: UnitCounts, add: UnitCounts, sign = 1): void {
  for (const u of UNIT_IDS) {
    const n = (into[u] ?? 0) + sign * (add[u] ?? 0);
    if (n > 0) into[u] = n;
    else delete into[u];
  }
}

type EventBody = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, "seq" | "tick"> : never) : never;

// ---- Names ------------------------------------------------------------------------------------

const PLACE_HEAD = ["Ash", "Bram", "Cold", "Dun", "Elm", "Fen", "Gold", "Hart", "Iron", "Kings", "Lark", "Moor", "North", "Oak", "Raven", "Stone", "Thorn", "Wester", "Wolf", "Yew", "Brack", "Hollow", "Marsh", "Sal", "Wyrm"];
const PLACE_TAIL = ["ford", "holt", "by", "wick", "stead", "mere", "ton", "croft", "fell", "gate", "hollow", "bridge", "ham", "dale", "march", "watch"];
const PLAYER_NAMES = ["ironwright", "mossback", "quillon", "tallowmere", "bitterroot", "corvid", "hearthless", "oxbow", "saltmarsh", "vellum", "kestrel", "grimsel", "tinder", "lowmoor", "brackwater", "fenrunner", "copperkey", "nightledger", "redcap", "ashgrove_ai", "marrow", "sable", "tidewright", "gloam", "wickett", "harrow", "yarrow", "ember_bot", "cairn", "dunlin"];
const HOUSE_NAMES = ["Warden Ashgrove", "Reaver Holloway", "Sovereign Merrow", "Warden Stillwater", "Reaver Kettleby", "Sovereign Dunmore"];

// ---- The world ------------------------------------------------------------------------------

interface Owned {
  id: string;
  name: string;
  x: number;
  y: number;
  loyalty: number;
  buildings: Record<BuildingId, number>;
  milli: Resources;
  queue: BuildQueueItem[];
  training: Record<TrainingBuilding, TrainBatch[]>;
  home: UnitCounts;
  merchantsOut: number;
}

interface Stationed {
  stack: SupportStack;
  sentTick: number;
  recallTick: number;
}

export interface MockWorldSpec {
  id: string;
  name: string;
  kind: WorldKind;
  size: number;
  players: number;
  /** Whether "you" play here (and, for a sandbox, created it). */
  withYou: boolean;
}

export const YOU = { id: "p_you0000001", name: "nightwarden", accountId: "a_mock" };
const START_TICK = 2400;
const DURATION = SANDBOX.durationDefault;

export class MockWorld {
  tick = START_TICK;
  speed: number;
  status: WorldSummary["status"] = "running";
  readonly epoch: string;
  private serial = 0;
  private seq = 1000;
  private eventSeq = 0;
  private activitySeq = 0;
  private readonly players = new Map<string, MapPlayer>();
  private readonly villages = new Map<string, MapVillage>();
  private readonly own = new Map<string, Owned>();
  private outgoing: OutgoingCommand[] = [];
  private incoming: IncomingCommand[] = [];
  private trades: Trade[] = [];
  private stationed: Stationed[] = [];
  private god: GodMovement[] = [];
  private readonly reports = new Map<string, Report>();
  private reportOrder: string[] = [];
  private activityLog: ActivityEntry[] = [];
  private historyLog: HistorySample[] = [];
  private renown = { attack: 0, defense: 0 };
  private notes =
    "Shift 4 plan:\n- Hold Ravenholt: walls to 5, pikemen to 300.\n- Farm the three hamlets east with raiders (raid orders 1-3).\n- Save for the market; trade timber to Oakmere when it fills.";
  private readonly seedBase: number;
  private quiet = true;

  constructor(
    readonly spec: MockWorldSpec,
    private readonly emit: (message: StreamMessage) => void,
  ) {
    this.seedBase = hashString(`mock:${spec.id}`);
    this.speed = spec.kind === "sandbox" ? SANDBOX.speedDefault : 1;
    this.epoch = `e_${spec.id}`;
    this.populate();
    this.backfill();
    this.quiet = false;
  }

  private random(salt = 0): () => number {
    return seededRandom(this.seedBase ^ Math.imul(this.tick + 1, 2654435761) ^ salt);
  }

  private id(prefix: string): string {
    this.serial++;
    return `${prefix}_${(hashString(`${this.spec.id}:${this.serial}`) >>> 0).toString(36).padStart(7, "0").slice(0, 7)}${(this.serial % 1000).toString(36).padStart(3, "0")}`;
  }

  // ---- Setup ----------------------------------------------------------------------------------

  private placeFree(random: () => number, x: number, y: number): [number, number] | null {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 2 || py < 2 || px > this.spec.size - 2 || py > this.spec.size - 2) return null;
    for (const v of this.villages.values()) if (distance(v.x, v.y, px, py) < MAP.minSpacing + 0.5 * random()) return null;
    return [px, py];
  }

  private populate(): void {
    const random = seededRandom(this.seedBase);
    const centre = this.spec.size / 2;
    const offset = random() * Math.PI * 2;
    const names = new Set<string>();
    // Past a few hundred villages the syllables run out, so later ones get an ordinal.
    const placeName = () => {
      const base = PLACE_HEAD[Math.floor(random() * PLACE_HEAD.length)]! + PLACE_TAIL[Math.floor(random() * PLACE_TAIL.length)]!;
      let name = base;
      for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
      names.add(name);
      return name;
    };

    const roster: MapPlayer[] = [];
    if (this.spec.withYou) roster.push({ id: YOU.id, name: YOU.name, houseBot: null, points: 0, villages: 0, protectedUntilTick: null });
    for (let i = 0; i < this.spec.players; i++) {
      const house = i < HOUSE_NAMES.length && i % 2 === 0;
      const name = house ? HOUSE_NAMES[i]! : PLAYER_NAMES[i % PLAYER_NAMES.length]! + (i >= PLAYER_NAMES.length ? String(i) : "");
      const kind = house ? (["warden", "reaver", "sovereign"] as const)[i % 3]! : null;
      roster.push({ id: `p_${hashString(name).toString(36)}`, name, houseBot: kind, points: 0, villages: 0, protectedUntilTick: i % 7 === 3 ? this.tick + 600 : null });
    }
    for (const p of roster) this.players.set(p.id, p);

    // Spawn slots as the game places them: a golden-angle spiral out from the centre.
    let slot = 0;
    const firstVillage = new Map<string, MapVillage>();
    const villagesWanted = roster.map((p, i) => (p.id === YOU.id ? 4 : 1 + Math.floor(random() ** 2.2 * (i < 8 ? 6 : 3))));
    let remaining = villagesWanted.reduce((a, b) => a + b, 0);
    const pending = [...villagesWanted];
    while (remaining > 0 && slot < 2000) {
      const r = roundHalfUp(MAP.ringBase + MAP.ringGrowth * Math.sqrt(slot));
      const a = slot * MAP.spawnAngle + offset;
      slot++;
      const spot = this.placeFree(random, centre + Math.cos(a) * r, centre + Math.sin(a) * r);
      if (!spot) continue;
      // Players' later villages sit near their first, so holdings look like holdings.
      let owner = pending.findIndex((n, i) => n > 0 && !firstVillage.has(roster[i]!.id));
      if (owner < 0) {
        let bestD = Infinity;
        pending.forEach((n, i) => {
          const first = firstVillage.get(roster[i]!.id);
          if (n <= 0 || !first) return;
          const d = distance(first.x, first.y, spot[0], spot[1]);
          if (d < bestD) {
            bestD = d;
            owner = i;
          }
        });
      }
      if (owner < 0) break;
      const player = roster[owner]!;
      pending[owner]!--;
      remaining--;
      const village: MapVillage = {
        id: this.id("v"),
        x: spot[0],
        y: spot[1],
        name: placeName(),
        ownerId: player.id,
        ownerName: player.name,
        points: Math.round(60 + random() ** 1.8 * (player.houseBot ? 3200 : 9000)),
      };
      this.villages.set(village.id, village);
      if (!firstVillage.has(player.id)) {
        firstVillage.set(player.id, village);
        for (let h = 0; h < MAP.hamletsPerPlayer; h++) {
          for (let tries = 0; tries < 12; tries++) {
            const d = MAP.hamletDistance[0] + random() * (MAP.hamletDistance[1] - MAP.hamletDistance[0]);
            const ha = random() * Math.PI * 2;
            const hs = this.placeFree(random, village.x + Math.cos(ha) * d, village.y + Math.sin(ha) * d);
            if (!hs) continue;
            const hamlet: MapVillage = { id: this.id("v"), x: hs[0], y: hs[1], name: placeName(), ownerId: null, ownerName: null, points: Math.round(40 + random() * 90) };
            this.villages.set(hamlet.id, hamlet);
            break;
          }
        }
      }
    }

    if (this.spec.withYou) this.foundOwn(random);
    this.refreshPlayers();
  }

  private foundOwn(random: () => number): void {
    const mine = [...this.villages.values()].filter((v) => v.ownerId === YOU.id);
    const presets: Partial<Record<BuildingId, number>>[] = [
      { hall: 12, lumberyard: 16, quarry: 15, mine: 14, farm: 13, storehouse: 14, cellar: 5, barracks: 9, smithy: 7, stable: 4, market: 6, wall: 8, watchtower: 4, workshop: 0 },
      { hall: 8, lumberyard: 12, quarry: 11, mine: 10, farm: 9, storehouse: 10, cellar: 3, barracks: 5, smithy: 5, market: 3, wall: 5, watchtower: 2 },
      { hall: 5, lumberyard: 8, quarry: 8, mine: 7, farm: 6, storehouse: 7, barracks: 2, wall: 2 },
      { hall: 3, lumberyard: 5, quarry: 4, mine: 4, farm: 4, storehouse: 4, barracks: 1 },
    ];
    mine.forEach((v, i) => {
      const preset = presets[i % presets.length]!;
      const buildings = Object.fromEntries(BUILDING_IDS.map((b) => [b, preset[b] ?? BUILDINGS[b].minLevel])) as Record<BuildingId, number>;
      const storage = storageAt(buildings.storehouse);
      const owned: Owned = {
        id: v.id,
        name: v.name,
        x: v.x,
        y: v.y,
        loyalty: i === 2 ? 71 : COMBAT.loyaltyMax,
        buildings,
        milli: {
          timber: Math.floor(storage * (0.3 + random() * 0.6)) * MILLI,
          stone: Math.floor(storage * (0.3 + random() * 0.6)) * MILLI,
          iron: Math.floor(storage * (0.2 + random() * 0.5)) * MILLI,
        },
        queue: [],
        training: { barracks: [], stable: [], workshop: [], court: [] },
        home: i === 0 ? { pikeman: 240, shieldman: 120, raider: 160, archer: 40, scout: 12, lancer: 60 } : i === 1 ? { pikeman: 120, raider: 80, shieldman: 40 } : { pikeman: 30 + i * 10 },
        merchantsOut: 0,
      };
      this.own.set(v.id, owned);
      v.points = this.villagePoints(owned);
      // Something already under way everywhere.
      this.enqueueBuild(owned, i === 0 ? "wall" : "farm");
      this.enqueueBuild(owned, "storehouse");
      if (owned.buildings.barracks > 0) this.enqueueTrain(owned, "pikeman", 20 + i * 5);
      if (owned.buildings.stable > 0) {
        this.enqueueTrain(owned, "scout", 6);
        this.enqueueTrain(owned, "lancer", 2);
      }
    });
  }

  private villagePoints(v: Owned): number {
    let points = 0;
    for (const b of BUILDING_IDS) for (let l = 1; l <= v.buildings[b]; l++) points += levelPoints(b, l);
    return points;
  }

  private refreshPlayers(): void {
    for (const p of this.players.values()) {
      p.points = 0;
      p.villages = 0;
    }
    for (const v of this.villages.values()) {
      if (!v.ownerId) continue;
      const p = this.players.get(v.ownerId);
      if (!p) continue;
      p.points += v.points;
      p.villages++;
    }
  }

  /** Invents the round so far: history samples, a few reports and a stretch of the steward's log. */
  private backfill(): void {
    if (!this.spec.withYou) return;
    const end = this.tick;
    const final = this.sample(end);
    for (let t = HISTORY.sampleEveryTicks; t < end; t += HISTORY.sampleEveryTicks) {
      const k = t / end;
      const wobble = 1 + Math.sin(t / 310) * 0.06;
      const ease = k ** 1.6;
      this.historyLog.push({
        tick: t,
        points: Math.round(final.points * (0.08 + 0.92 * ease)),
        score: Math.round(final.score * (0.05 + 0.95 * ease ** 1.1)),
        villages: k < 0.35 ? 1 : k < 0.6 ? 2 : k < 0.85 ? 3 : 4,
        resources: {
          timber: Math.round(final.resources.timber * (0.2 + 0.8 * k) * wobble),
          stone: Math.round(final.resources.stone * (0.25 + 0.75 * k) / wobble),
          iron: Math.round(final.resources.iron * (0.15 + 0.85 * k) * wobble),
        },
        production: {
          timber: Math.round(final.production.timber * (0.15 + 0.85 * ease)),
          stone: Math.round(final.production.stone * (0.15 + 0.85 * ease)),
          iron: Math.round(final.production.iron * (0.12 + 0.88 * ease)),
        },
        armyPop: Math.round(final.armyPop * k ** 1.3 * (1 + Math.sin(t / 170) * 0.08)),
        renown: { attack: Math.round(final.renown.attack * ease), defense: Math.round(final.renown.defense * k) },
      });
    }
    this.historyLog.push(final);

    const first = [...this.own.values()][0]!;
    const hamlets = this.nearest(first.x, first.y, (v) => !v.ownerId, 3);
    for (let i = 0; i < 6; i++) {
      const target = hamlets[i % hamlets.length]!;
      this.tick = end - 600 + i * 90;
      this.makeReport("attacker", this.ref(first), this.ref(target), i % 4 === 3 ? "lost" : "won", { raider: 40, lancer: 10 }, false);
    }
    for (let i = 0; i < 40; i++) {
      this.tick = end - 400 + i * 10;
      this.stewardTurn();
    }
    this.tick = end;
  }

  // ---- Views --------------------------------------------------------------------------------

  summary(): WorldSummary {
    return {
      id: this.spec.id,
      name: this.spec.name,
      kind: this.spec.kind,
      status: this.status,
      speed: this.speed,
      tick: this.tick,
      round: 3,
      endsAtTick: DURATION,
      size: this.spec.size,
      players: this.players.size,
      villages: this.villages.size,
      rulesVersion: 2,
      epoch: this.epoch,
      actIntervalTicks: null,
      ...(this.spec.kind === "sandbox" ? { ownerId: YOU.accountId, clock: "realtime" as const, seed: 424242 } : {}),
    };
  }

  map(): MapResponse {
    return {
      tick: this.tick,
      snapshotTick: Math.floor(this.tick / SCORING.publicSnapshotTicks) * SCORING.publicSnapshotTicks,
      size: this.spec.size,
      villages: [...this.villages.values()].map((v) => ({ ...v })),
      players: [...this.players.values()].map((p) => ({ ...p })),
    };
  }

  leaderboard(): LeaderboardResponse {
    const entries = [...this.players.values()]
      .map((p) => {
        const renown = p.id === YOU.id ? this.renown : { attack: hashString(p.id) % 900, defense: hashString(p.name) % 600 };
        return { playerId: p.id, name: p.name, houseBot: p.houseBot, points: p.points, villages: p.villages, renown, score: p.points + SCORING.renownWeight * (renown.attack + renown.defense) };
      })
      .sort((a, b) => b.score - a.score || b.points - a.points)
      .map((e, i) => ({ rank: i + 1, ...e }));
    return { tick: this.tick, snapshotTick: Math.floor(this.tick / SCORING.publicSnapshotTicks) * SCORING.publicSnapshotTicks, round: 3, entries };
  }

  history(): HistorySample[] {
    return [...this.historyLog];
  }

  activity(): ActivityEntry[] {
    return [...this.activityLog];
  }

  reportList(): ReportSummary[] {
    return this.reportOrder.map((id) => this.summaryOf(this.reports.get(id)!));
  }

  report(id: string): Report | null {
    const r = this.reports.get(id);
    if (!r) return null;
    r.read = true;
    return { ...r };
  }

  godMovements(): GodMovement[] {
    const own: GodMovement[] = this.outgoing.map((c) => ({
      id: c.id,
      kind: c.kind,
      ownerId: YOU.id,
      fromXY: [c.from.x, c.from.y],
      toXY: [c.to.x, c.to.y],
      sentTick: c.sentTick,
      arrivalTick: c.arrivalTick,
      returning: c.returning,
      pop: popOf(c.units),
    }));
    return [...this.god, ...own];
  }

  private ref(v: { id: string }): VillageRef {
    const m = this.villages.get(v.id)!;
    return { id: m.id, name: m.name, x: m.x, y: m.y, ownerId: m.ownerId, ownerName: m.ownerName };
  }

  private nearest(x: number, y: number, keep: (v: MapVillage) => boolean, count: number): MapVillage[] {
    return [...this.villages.values()]
      .filter(keep)
      .sort((a, b) => distance(x, y, a.x, a.y) - distance(x, y, b.x, b.y))
      .slice(0, count);
  }

  state(): StateResponse | null {
    if (!this.spec.withYou) return null;
    const villages = [...this.own.values()].map((v) => this.villageState(v));
    const me = this.players.get(YOU.id)!;
    const board = this.leaderboard();
    const rank = board.entries.find((e) => e.playerId === YOU.id)!;
    return {
      world: this.summary(),
      serverTime: new Date().toISOString(),
      player: {
        id: YOU.id,
        name: YOU.name,
        points: me.points,
        score: rank.score,
        rank: rank.rank,
        renown: { ...this.renown },
        villages: villages.length,
        protectedUntilTick: null,
        nextActTick: null,
      },
      villages,
      commands: { outgoing: this.outgoing.map((c) => ({ ...c })), incoming: this.incoming.map((c) => ({ ...c })) },
      trades: { outgoing: this.trades.map((t) => ({ ...t })), incoming: [] },
      scheduled: [
        {
          id: "s_mock000001",
          atTick: this.tick + 140 - (this.tick % 140),
          action: { type: "send", village: villages[0]!.id, target: villages[1]!.id, kind: "support", units: { pikeman: 50 } },
        },
      ],
      notes: this.notes,
      unreadReports: this.reportOrder.filter((id) => !this.reports.get(id)!.read).length,
      eventsCursor: this.eventSeq,
    };
  }

  private villageState(v: Owned): VillageState {
    const storage = storageAt(v.buildings.storehouse);
    const away: UnitCounts = {};
    for (const c of this.outgoing) if (c.from.id === v.id) addUnits(away, c.units);
    for (const s of this.stationed) if (s.stack.home.id === v.id) addUnits(away, s.stack.units);
    const production = { timber: 0, stone: 0, iron: 0 };
    const productionMilli = { timber: 0, stone: 0, iron: 0 };
    for (const b of BUILDING_IDS) {
      const r = PRODUCER[b];
      if (!r) continue;
      production[r] = Math.round(perMinute(v.buildings[b]));
      productionMilli[r] = perTickMilli(v.buildings[b]);
    }
    const used = this.popUsed(v, away);
    const marketMerchants = merchantsAt(v.buildings.market);
    return {
      id: v.id,
      name: v.name,
      x: v.x,
      y: v.y,
      points: this.villages.get(v.id)!.points,
      loyalty: v.loyalty,
      resources: { timber: Math.floor(v.milli.timber / MILLI), stone: Math.floor(v.milli.stone / MILLI), iron: Math.floor(v.milli.iron / MILLI) },
      resourcesMilli: { ...v.milli },
      storage,
      hidden: cellarAt(v.buildings.cellar),
      production,
      productionPerTickMilli: productionMilli,
      population: { used, max: farmAt(v.buildings.farm) },
      buildings: { ...v.buildings },
      buildQueue: v.queue.map((q) => ({ ...q })),
      training: {
        barracks: v.training.barracks.map((b) => ({ ...b })),
        stable: v.training.stable.map((b) => ({ ...b })),
        workshop: v.training.workshop.map((b) => ({ ...b })),
        court: v.training.court.map((b) => ({ ...b })),
      },
      units: { home: { ...v.home }, away },
      supportHere: this.stationed.filter((s) => s.stack.at.id === v.id).map((s) => s.stack),
      supportAbroad: this.stationed.filter((s) => s.stack.home.id === v.id).map((s) => s.stack),
      merchants: { total: marketMerchants, available: Math.max(0, marketMerchants - v.merchantsOut) },
      renameReadyTick: null,
      orders: {
        build: v.buildings.hall >= 8 ? [{ building: "farm", toLevel: 15 }, { building: "wall", toLevel: 10 }, { building: "watchtower", toLevel: 6 }] : [],
        train: v.buildings.barracks >= 5 ? [{ unit: "pikeman", keep: 300, batch: 25 }, { unit: "raider", keep: 160 }] : [],
        raids: v.buildings.hall >= 12 ? this.nearest(v.x, v.y, (m) => !m.ownerId, 3).map((h) => ({ target: h.id, units: { raider: 30 } as UnitCounts, stopIfLoss: 0.2 })) : [],
        paused: v.buildings.hall >= 12 ? [{ order: "raid", index: 2, code: "TARGET_PROTECTED", atTick: this.tick - 80 }] : [],
      },
      options: { build: BUILDING_IDS.map((b) => this.buildOption(v, b, used)), train: UNIT_IDS.map((u) => this.trainOption(v, u, used)) },
    };
  }

  private popUsed(v: Owned, away: UnitCounts): number {
    let used = 0;
    for (const b of BUILDING_IDS) used += buildingPop(b, v.buildings[b] + v.queue.filter((q) => q.building === b).length);
    used += popOf(v.home) + popOf(away);
    for (const t of TRAINERS) for (const batch of v.training[t]) used += batch.remaining * UNITS[batch.unit].pop;
    return used;
  }

  private buildOption(v: Owned, b: BuildingId, used: number): BuildOption {
    const rule = BUILDINGS[b];
    const next = v.buildings[b] + v.queue.filter((q) => q.building === b).length + 1;
    if (next > rule.maxLevel) {
      return { building: b, level: rule.maxLevel, cost: { timber: 0, stone: 0, iron: 0 }, ticks: 0, pop: 0, ok: false, blockers: ["MAX_LEVEL"], affordableAtTick: null };
    }
    const cost = costOf(b, next);
    const blockers: BuildOption["blockers"] = [];
    if (Object.entries(rule.requires).some(([req, lvl]) => v.buildings[req as BuildingId] < (lvl ?? 0))) blockers.push("REQUIREMENTS_NOT_MET");
    if (v.queue.length >= ECONOMY.buildQueueMax) blockers.push("QUEUE_FULL");
    const pop = buildingPop(b, next) - buildingPop(b, next - 1);
    if (used + pop > farmAt(v.buildings.farm)) blockers.push("INSUFFICIENT_POPULATION");
    if (RESOURCES.some((r) => v.milli[r] < cost[r] * MILLI)) blockers.push("INSUFFICIENT_RESOURCES");
    return { building: b, level: next, cost, ticks: buildTicks(b, next, v.buildings.hall), pop, ok: blockers.length === 0, blockers, affordableAtTick: blockers.length === 1 && blockers[0] === "INSUFFICIENT_RESOURCES" ? this.tick + 120 : null };
  }

  private trainOption(v: Owned, u: UnitId, used: number): TrainOption {
    const rule = UNITS[u];
    const blockers: TrainOption["blockers"] = [];
    if (v.buildings[rule.building] < rule.buildingLevel || v.buildings.smithy < rule.smithyLevel) blockers.push("REQUIREMENTS_NOT_MET");
    const free = farmAt(v.buildings.farm) - used;
    if (free < rule.pop) blockers.push("INSUFFICIENT_POPULATION");
    const affordable = Math.min(...RESOURCES.map((r) => Math.floor(v.milli[r] / MILLI / Math.max(1, rule.cost[r]))));
    if (affordable < 1) blockers.push("INSUFFICIENT_RESOURCES");
    const maxCount = blockers.some((b) => b !== "INSUFFICIENT_RESOURCES") ? 0 : Math.max(0, Math.min(ECONOMY.trainBatchMax, affordable, Math.floor(free / rule.pop)));
    return { unit: u, cost: rule.cost, ticksEach: trainTicks(u, v.buildings[rule.building]), pop: rule.pop, maxCount, ok: blockers.length === 0, blockers, affordableAtTick: null };
  }

  private sample(tick: number): HistorySample {
    const resources = { timber: 0, stone: 0, iron: 0 };
    const production = { timber: 0, stone: 0, iron: 0 };
    let armyPop = 0;
    for (const v of this.own.values()) {
      for (const r of RESOURCES) resources[r] += Math.floor(v.milli[r] / MILLI);
      production.timber += Math.round(perMinute(v.buildings.lumberyard));
      production.stone += Math.round(perMinute(v.buildings.quarry));
      production.iron += Math.round(perMinute(v.buildings.mine));
      armyPop += popOf(v.home);
    }
    for (const c of this.outgoing) armyPop += popOf(c.units);
    const me = this.players.get(YOU.id);
    const points = me?.points ?? 0;
    return { tick, points, score: points + SCORING.renownWeight * (this.renown.attack + this.renown.defense), villages: this.own.size, resources, production, armyPop, renown: { ...this.renown } };
  }

  // ---- Actions the mock steward takes ----------------------------------------------------------

  private enqueueBuild(v: Owned, b: BuildingId): boolean {
    if (v.queue.length >= ECONOMY.buildQueueMax) return false;
    const level = v.buildings[b] + v.queue.filter((q) => q.building === b).length + 1;
    if (level > BUILDINGS[b].maxLevel) return false;
    const cost = costOf(b, level);
    if (RESOURCES.some((r) => v.milli[r] < cost[r] * MILLI)) return false;
    for (const r of RESOURCES) v.milli[r] -= cost[r] * MILLI;
    const start = v.queue.length === 0 ? this.tick : null;
    const prevEnd = v.queue.length ? v.queue[v.queue.length - 1]!.endTick : this.tick;
    v.queue.push({ id: this.id("q"), building: b, level, cost, startTick: start, endTick: prevEnd + buildTicks(b, level, v.buildings.hall) });
    return true;
  }

  private enqueueTrain(v: Owned, u: UnitId, count: number): boolean {
    const building = UNITS[u].building;
    const queue = v.training[building];
    const each = trainTicks(u, v.buildings[building]);
    const prevEnd = queue.length ? queue[queue.length - 1]!.endTick : this.tick;
    queue.push({ id: this.id("b"), unit: u, count, remaining: count, costEach: UNITS[u].cost, nextTick: queue.length ? null : (this.tick * 1000 + Math.round(each * 1000)) / 1000, endTick: (Math.round(prevEnd * 1000) + Math.round(each * 1000) * count) / 1000 });
    return true;
  }

  private log(entry: Omit<ActivityEntry, "seq" | "at" | "tick">): void {
    const full: ActivityEntry = { seq: ++this.activitySeq, at: new Date().toISOString(), tick: this.tick, ...entry };
    this.activityLog.push(full);
    this.broadcast({ type: "activity", entry: full });
  }

  private event(event: EventBody): void {
    this.broadcast({ type: "event", event: { seq: ++this.eventSeq, tick: this.tick, ...event } as GameEvent });
  }

  /** Quiet while the past is being invented, so the page doesn't replay it as live. */
  private broadcast(message: StreamMessage): void {
    if (!this.quiet) this.emit(message);
  }

  /** A turn of the pretend steward: reads, a batch of actions with a note, and now and then a slip. */
  private stewardTurn(): void {
    const random = this.random(7);
    const villages = [...this.own.values()];
    const v = villages[Math.floor(random() * villages.length)]!;
    const roll = random();
    const via = roll < 0.55 ? "rest" : "mcp";
    if (roll < 0.25) {
      this.log({ via, call: via === "rest" ? "GET /state" : "get_briefing", status: 200, ms: 8 + Math.floor(random() * 30) });
      return;
    }
    if (roll < 0.35) {
      this.log({ via, call: via === "rest" ? "GET /events?wait=25" : "wait_for_events", status: 200, ms: 1200 + Math.floor(random() * 9000) });
      return;
    }
    const candidates: BuildingId[] = ["farm", "storehouse", "lumberyard", "quarry", "mine", "barracks", "wall", "hall", "market", "smithy"];
    const building = candidates[Math.floor(random() * candidates.length)]!;
    const built = this.enqueueBuild(v, building);
    const unit: UnitId = random() < 0.6 ? "pikeman" : "raider";
    const count = 10 + Math.floor(random() * 30);
    const trained = v.buildings.barracks > 0 && random() < 0.6 && this.enqueueTrain(v, unit, count);
    const notes = ["Economy first: queue what's affordable", "Pikemen up before the reaver wakes", "Storehouse is the bottleneck", "Farm hamlets, push barracks", "Wall up; an attack was sighted east", ""];
    const note = notes[Math.floor(random() * notes.length)]!;
    const actions: NonNullable<ActivityEntry["actions"]> = [
      built
        ? { type: "build", ok: true, summary: `${BUILDINGS[building].name} → ${v.buildings[building] + v.queue.filter((q) => q.building === building).length} in ${v.name}` }
        : { type: "build", ok: false, code: v.queue.length >= ECONOMY.buildQueueMax ? "QUEUE_FULL" : "INSUFFICIENT_RESOURCES", summary: `${BUILDINGS[building].name} in ${v.name}` },
    ];
    if (trained) actions.push({ type: "train", ok: true, summary: `${count} ${UNITS[unit].name.toLowerCase()} in ${v.name}` });
    else if (random() < 0.3) actions.push({ type: "train", ok: false, code: "INSUFFICIENT_POPULATION", summary: `${count} ${UNITS[unit].name.toLowerCase()} in ${v.name}` });
    this.log({ via, call: via === "rest" ? "POST /actions" : "act", status: 200, ms: 14 + Math.floor(random() * 40), ...(note ? { note } : {}), actions });
  }

  // ---- The clock ------------------------------------------------------------------------------

  /** Processes tick + 1, in the order of design.md § The tick (loosely). */
  advance(): void {
    if (this.tick >= DURATION) {
      this.status = "ended";
      return;
    }
    this.tick++;
    const t = this.tick;
    this.produce();
    this.construct();
    this.train();
    this.arrive();
    this.sight();
    this.recall();
    if (this.spec.withYou) {
      if (t % 9 === 0) this.stewardTurn();
      if (t % 29 === 0) this.orderTurn();
      if (t % 23 === 0) this.sendRaid();
      if (t % 151 === 0) this.sendSupport();
      if (t % 97 === 0) this.sendTrade();
      if (t % 67 === 0) this.attackYou();
    }
    this.marchOthers();
    if (t % 211 === 0) this.conquer();
    if (t % HISTORY.sampleEveryTicks === 0 && this.spec.withYou) this.historyLog.push(this.sample(t));
    if (t % SCORING.publicSnapshotTicks === 0) this.snapshot();
  }

  private produce(): void {
    for (const v of this.own.values()) {
      const cap = storageAt(v.buildings.storehouse) * MILLI;
      v.milli.timber = Math.min(cap, v.milli.timber + perTickMilli(v.buildings.lumberyard));
      v.milli.stone = Math.min(cap, v.milli.stone + perTickMilli(v.buildings.quarry));
      v.milli.iron = Math.min(cap, v.milli.iron + perTickMilli(v.buildings.mine));
    }
  }

  private construct(): void {
    for (const v of this.own.values()) {
      const head = v.queue[0];
      if (!head || head.endTick > this.tick) continue;
      v.queue.shift();
      v.buildings[head.building]++;
      const pub = this.villages.get(v.id)!;
      pub.points = this.villagePoints(v);
      this.event({ type: "build_completed", village: v.id, building: head.building, level: v.buildings[head.building] });
      const next = v.queue[0];
      if (next) {
        next.startTick = this.tick;
        let end = this.tick;
        for (const q of v.queue) {
          end += buildTicks(q.building, q.level, v.buildings.hall);
          q.endTick = end;
        }
      }
    }
  }

  private train(): void {
    for (const v of this.own.values()) {
      for (const building of TRAINERS) {
        while (v.training[building].length) {
          const batch = v.training[building][0];
          if (!batch || batch.nextTick === null || batch.nextTick > this.tick) break;
          const finishedAt = batch.nextTick;
          batch.remaining--;
          addUnits(v.home, { [batch.unit]: 1 });
          if (batch.remaining <= 0) {
            v.training[building].shift();
            this.event({ type: "training_completed", village: v.id, unit: batch.unit, count: batch.count, batch: batch.id });
            const next = v.training[building][0];
            if (next) next.nextTick = Math.round((finishedAt + trainTicks(next.unit, v.buildings[building])) * 1000) / 1000;
          } else {
            batch.nextTick = Math.round((finishedAt + trainTicks(batch.unit, v.buildings[building])) * 1000) / 1000;
          }
        }
      }
    }
  }

  private arrive(): void {
    const t = this.tick;
    for (const c of this.outgoing.filter((c) => c.arrivalTick <= t)) {
      const home = this.own.get(c.from.id);
      if (c.returning) {
        this.outgoing = this.outgoing.filter((x) => x !== c);
        if (home) {
          addUnits(home.home, c.units);
          if (c.loot) for (const r of RESOURCES) home.milli[r] = Math.min(storageAt(home.buildings.storehouse) * MILLI, home.milli[r] + c.loot[r] * MILLI);
        }
        this.event({ type: "command_returned", command: c });
      } else if (c.kind === "attack") {
        const random = this.random(c.seq);
        const won = random() < 0.8;
        const lost: UnitCounts = {};
        for (const u of UNIT_IDS) if (c.units[u]) lost[u] = Math.round((c.units[u] ?? 0) * (won ? random() * 0.15 : 1));
        const survivors: UnitCounts = { ...c.units };
        addUnits(survivors, lost, -1);
        this.makeReport("attacker", c.from, c.to, won ? "won" : "lost", c.units, false, lost);
        if (won) this.renown.attack += 8 + Math.floor(random() * 30);
        if (!won || popOf(survivors) === 0) {
          this.outgoing = this.outgoing.filter((x) => x !== c);
          continue;
        }
        const carry = UNIT_IDS.reduce((s, u) => s + (survivors[u] ?? 0) * UNITS[u].carry, 0);
        const third = Math.floor(carry / 3);
        c.returning = true;
        c.units = survivors;
        c.loot = { timber: Math.floor(third * (0.6 + random() * 0.4)), stone: Math.floor(third * random()), iron: Math.floor(third * (0.3 + random() * 0.5)) };
        c.arrivalTick = t + (t - c.sentTick);
        c.cancellableUntilTick = null;
      } else {
        this.outgoing = this.outgoing.filter((x) => x !== c);
        this.stationed.push({ stack: { home: c.from, at: c.to, units: c.units }, sentTick: c.sentTick, recallTick: t + 150 + (c.seq % 200) });
        this.event({ type: "command_arrived", command: c });
      }
    }

    for (const trade of this.trades.filter((x) => x.arrivalTick <= t)) {
      if (trade.returning) {
        this.trades = this.trades.filter((x) => x !== trade);
        const home = this.own.get(trade.from.id);
        if (home) home.merchantsOut = Math.max(0, home.merchantsOut - trade.merchants);
      } else {
        const target = this.own.get(trade.to.id);
        if (target) for (const r of RESOURCES) target.milli[r] = Math.min(storageAt(target.buildings.storehouse) * MILLI, target.milli[r] + trade.resources[r] * MILLI);
        trade.returning = true;
        trade.arrivalTick = t + (t - trade.sentTick);
        this.event({ type: "trade_arrived", trade });
      }
    }

    for (const c of this.incoming.filter((x) => x.arrivalTick <= t)) {
      this.incoming = this.incoming.filter((x) => x !== c);
      if (c.kind === "support") continue;
      const random = this.random(c.seq);
      const held = random() < 0.7;
      this.makeReport("defender", c.from, c.to, held ? "won" : "lost", { raider: 30 + Math.floor(random() * 60), lancer: Math.floor(random() * 20) }, false);
      if (held) this.renown.defense += 10 + Math.floor(random() * 25);
    }

    const battles = [];
    for (const m of this.god.filter((x) => x.arrivalTick <= t)) {
      this.god = this.god.filter((x) => x !== m);
      if (m.kind === "attack" && !m.returning) {
        const random = this.random(hashString(m.id));
        const target = [...this.villages.values()].find((v) => v.x === m.toXY[0] && v.y === m.toXY[1]);
        battles.push({ tick: t, x: m.toXY[0], y: m.toXY[1], attackerId: m.ownerId, defenderId: target?.ownerId ?? null, winner: random() < 0.6 ? ("attacker" as const) : ("defender" as const), conquered: false });
        this.god.push({ ...m, id: `${m.id}r`, returning: true, arrivalTick: t + (t - m.sentTick) });
      }
    }
    if (battles.length && this.spec.kind === "sandbox") this.broadcast({ type: "god", tick: t, movements: this.godMovements(), battles });
  }

  private sight(): void {
    for (const c of this.incoming) {
      if (c.sighted || c.kind !== "attack") continue;
      const target = this.own.get(c.to.id);
      if (!target) continue;
      const total = distance(c.from.x, c.from.y, c.to.x, c.to.y);
      const left = (total * (c.arrivalTick - this.tick)) / Math.max(1, c.arrivalTick - c.sentTick);
      if (left > watchRadius(target.buildings.watchtower)) continue;
      const random = this.random(c.seq + 5);
      c.sighted = { size: sizeBucket(40 + Math.floor(random() * 700)), envoy: random() < 0.2, atTick: this.tick };
      this.event({ type: "incoming_sighted", command: c });
    }
  }

  private recall(): void {
    for (const s of this.stationed.filter((x) => x.recallTick <= this.tick)) {
      this.stationed = this.stationed.filter((x) => x !== s);
      const travel = travelTicks(distance(s.stack.home.x, s.stack.home.y, s.stack.at.x, s.stack.at.y), s.stack.units) ?? 1;
      this.outgoing.push({ id: this.id("c"), seq: ++this.seq, kind: "support", returning: true, from: s.stack.home, to: s.stack.at, units: s.stack.units, aim: null, sentTick: this.tick, arrivalTick: this.tick + travel, cancellableUntilTick: null, loot: null, raidOrder: null });
    }
  }

  private orderTurn(): void {
    const v = [...this.own.values()][0]!;
    const ok = this.enqueueBuild(v, "farm");
    this.log({ via: "orders", call: "standing orders", status: 200, ms: 0, actions: [ok ? { type: "build", ok: true, summary: `Farm → ${v.buildings.farm + v.queue.filter((q) => q.building === "farm").length} in ${v.name}` } : { type: "build", ok: false, code: "INSUFFICIENT_RESOURCES", summary: `Farm in ${v.name}` }] });
  }

  private send(from: Owned, to: MapVillage, kind: "attack" | "support", units: UnitCounts, raidOrder: number | null): OutgoingCommand | null {
    for (const u of UNIT_IDS) if ((units[u] ?? 0) > (from.home[u] ?? 0)) return null;
    addUnits(from.home, units, -1);
    const travel = travelTicks(distance(from.x, from.y, to.x, to.y), units) ?? 1;
    const command: OutgoingCommand = {
      id: this.id("c"),
      seq: ++this.seq,
      kind,
      returning: false,
      from: this.ref(from),
      to: this.ref(to),
      units,
      aim: null,
      sentTick: this.tick,
      arrivalTick: this.tick + travel,
      cancellableUntilTick: Math.min(this.tick + COMBAT.cancelWindow, this.tick + travel - 1),
      loot: null,
      raidOrder,
    };
    this.outgoing.push(command);
    return command;
  }

  private sendRaid(): void {
    if (this.outgoing.filter((c) => c.kind === "attack").length >= 7) return;
    const random = this.random(11);
    const villages = [...this.own.values()].filter((v) => (v.home.raider ?? 0) >= 20 || (v.home.lancer ?? 0) >= 10);
    const from = villages[Math.floor(random() * villages.length)];
    if (!from) return;
    const targets = this.nearest(from.x, from.y, (m) => m.ownerId !== YOU.id, 8);
    const to = targets[Math.floor(random() * targets.length)]!;
    const units: UnitCounts = (from.home.lancer ?? 0) >= 10 && random() < 0.5 ? { lancer: 10 } : { raider: 20, ...((from.home.scout ?? 0) > 1 ? { scout: 1 } : {}) };
    const order = random() < 0.5 ? Math.floor(random() * 3) : null;
    const c = this.send(from, to, "attack", units, order);
    if (c) this.log({ via: order !== null ? "orders" : "rest", call: order !== null ? "standing orders" : "POST /actions", status: 200, ms: order !== null ? 0 : 21, actions: [{ type: "send", ok: true, summary: `attack ${from.name} → ${to.name}: ${units.lancer ? `${units.lancer} lancer` : `${units.raider} raider`}` }] });
  }

  private sendSupport(): void {
    const villages = [...this.own.values()];
    if (villages.length < 2) return;
    const from = villages[0]!;
    const to = this.villages.get(villages[1 + (this.tick % (villages.length - 1))]!.id)!;
    const c = this.send(from, to, "support", { pikeman: 40, shieldman: 20 }, null);
    if (c) this.log({ via: "mcp", call: "act", status: 200, ms: 33, note: "Shore up the young villages", actions: [{ type: "send", ok: true, summary: `support ${from.name} → ${to.name}: 40 pikeman, 20 shieldman` }] });
  }

  private sendTrade(): void {
    const villages = [...this.own.values()];
    const from = villages.find((v) => merchantsAt(v.buildings.market) - v.merchantsOut >= 2);
    const to = villages.find((v) => v !== from);
    if (!from || !to) return;
    const resources = { timber: 1200, stone: 600, iron: 0 };
    const merchants = Math.ceil((resources.timber + resources.stone) / MARKET.merchantCarry);
    from.merchantsOut += merchants;
    for (const r of RESOURCES) from.milli[r] = Math.max(0, from.milli[r] - resources[r] * MILLI);
    const travel = Math.ceil(distance(from.x, from.y, to.x, to.y) * MARKET.merchantSpeed);
    this.trades.push({ id: this.id("t"), seq: ++this.seq, from: this.ref(from), to: this.ref(to), resources, merchants, sentTick: this.tick, arrivalTick: this.tick + travel, returning: false });
    this.log({ via: "rest", call: "POST /actions", status: 200, ms: 18, note: "Even out the stores", actions: [{ type: "trade", ok: true, summary: `${from.name} → ${to.name}: 1200 timber, 600 stone` }] });
  }

  private attackYou(): void {
    if (this.incoming.length >= 4) return;
    const random = this.random(13);
    const villages = [...this.own.values()];
    const to = villages[Math.floor(random() * villages.length)]!;
    const enemies = this.nearest(to.x, to.y, (m) => !!m.ownerId && m.ownerId !== YOU.id, 6);
    const from = enemies[Math.floor(random() * enemies.length)]!;
    const supportive = random() < 0.15;
    const units: UnitCounts = supportive ? { pikeman: 25 } : random() < 0.3 ? { ram: 4, raider: 80 } : { raider: 60, lancer: 15 };
    const travel = travelTicks(distance(from.x, from.y, to.x, to.y), units) ?? 1;
    const command: IncomingCommand = { id: this.id("c"), seq: ++this.seq, kind: supportive ? "support" : "attack", from: this.ref(from), to: this.ref(to), sentTick: this.tick, arrivalTick: this.tick + travel, sighted: null, units: supportive ? units : null };
    this.incoming.push(command);
    this.event({ type: supportive ? "support_incoming" : "attack_incoming", command });
  }

  private marchOthers(): void {
    const wanted = this.spec.kind === "sandbox" ? 36 : 0;
    if (this.god.length >= wanted) return;
    const random = this.random(17);
    const owned = [...this.villages.values()].filter((v) => v.ownerId && v.ownerId !== YOU.id);
    const from = owned[Math.floor(random() * owned.length)];
    if (!from) return;
    const near = this.nearest(from.x, from.y, (v) => v.id !== from.id, 6);
    const to = near[Math.floor(random() * near.length)]!;
    const roll = random();
    const kind = roll < 0.6 ? "attack" : roll < 0.8 ? "support" : "trade";
    const pace = kind === "trade" ? MARKET.merchantSpeed : UNITS.raider.speed;
    const travel = Math.ceil(distance(from.x, from.y, to.x, to.y) * pace);
    const sent = this.tick - Math.floor(random() * travel * 0.5);
    this.god.push({ id: this.id("g"), kind, ownerId: from.ownerId!, fromXY: [from.x, from.y], toXY: [to.x, to.y], sentTick: sent, arrivalTick: sent + travel, returning: false, pop: Math.floor(20 + random() * 400) });
  }

  private conquer(): void {
    const random = this.random(19);
    const candidates = [...this.villages.values()].filter((v) => v.ownerId !== YOU.id);
    const target = candidates[Math.floor(random() * candidates.length)]!;
    const near = this.nearest(target.x, target.y, (v) => !!v.ownerId && v.ownerId !== target.ownerId && v.ownerId !== YOU.id, 3);
    const winner = near[0];
    if (!winner?.ownerId) return;
    const from = target.ownerId;
    target.ownerId = winner.ownerId;
    target.ownerName = winner.ownerName;
    this.refreshPlayers();
    this.broadcast({ type: "conquest", tick: this.tick, village: this.ref(target), from, to: winner.ownerId });
    this.broadcast({ type: "map", tick: this.tick, villages: [{ ...target }], players: [...this.players.values()].filter((p) => p.id === from || p.id === winner.ownerId).map((p) => ({ ...p })) });
  }

  private snapshot(): void {
    const random = this.random(23);
    const grown: MapVillage[] = [];
    for (const v of this.villages.values()) {
      if (!v.ownerId || v.ownerId === YOU.id || random() > 0.4) continue;
      v.points += Math.floor(5 + random() * 60);
      grown.push({ ...v });
    }
    for (const v of this.own.values()) grown.push({ ...this.villages.get(v.id)! });
    this.refreshPlayers();
    this.broadcast({ type: "map", tick: this.tick, villages: grown, players: [...this.players.values()].map((p) => ({ ...p })) });
  }

  // ---- Reports --------------------------------------------------------------------------------

  private makeReport(role: "attacker" | "defender", attacker: VillageRef, defender: VillageRef, outcome: "won" | "lost", sent: UnitCounts, conquered: boolean, lost: UnitCounts = {}): void {
    const random = this.random(this.reports.size + 31);
    const id = this.id("r");
    const defenders: UnitCounts = defender.ownerId ? { pikeman: 20 + Math.floor(random() * 120), shieldman: Math.floor(random() * 60) } : {};
    const won = outcome === "won";
    const attackerWins = role === "attacker" ? won : !won;
    const scouted = role === "attacker" && won && (sent.scout ?? 0) > 0;
    const report: Report = {
      id,
      tick: this.tick,
      kind: "battle",
      role,
      commandId: role === "attacker" ? this.id("c") : null,
      attacker,
      defender,
      outcome,
      conquered,
      read: this.reports.size < 4,
      attackerUnits: { sent, lost: Object.keys(lost).length ? lost : attackerWins ? { raider: Math.floor((sent.raider ?? 0) * 0.1) } : sent },
      defenderUnits: role === "attacker" && !won ? null : { present: defenders, lost: attackerWins ? defenders : { pikeman: Math.floor((defenders.pikeman ?? 0) * 0.3) } },
      scouts: (sent.scout ?? 0) > 0 ? { sent: sent.scout ?? 0, lost: 0, defending: 0, defendingLost: 0 } : null,
      strength: { attack: Math.round(popOf(sent) * 30 * (0.8 + random())), defense: Math.round((defender.ownerId ? 900 : 300) * (0.5 + random())) },
      wall: { before: 3, effective: (sent.ram ?? 0) > 0 ? 1 : 3, after: attackerWins && (sent.ram ?? 0) > 0 ? 2 : 3 },
      building: null,
      loyalty: null,
      loot: attackerWins ? { timber: Math.floor(random() * 900), stone: Math.floor(random() * 700), iron: Math.floor(random() * 500) } : null,
      carry: role === "attacker" && won ? { capacity: 1500, taken: 1100 } : null,
      intel: scouted
        ? {
            resources: { timber: Math.floor(random() * 3000), stone: Math.floor(random() * 3000), iron: Math.floor(random() * 2000) },
            buildings: Object.fromEntries(BUILDING_IDS.map((b) => [b, Math.max(BUILDINGS[b].minLevel, Math.floor(random() * 6))])) as Record<BuildingId, number>,
            unitsHome: defenders,
            supportTotal: {},
          }
        : null,
    };
    this.reports.set(id, report);
    this.reportOrder.unshift(id);
    this.event({ type: "report", report: this.summaryOf(report) });
  }

  private summaryOf(r: Report): ReportSummary {
    return { id: r.id, tick: r.tick, kind: r.kind, role: r.role, commandId: r.commandId, attacker: r.attacker, defender: r.defender, outcome: r.outcome, conquered: r.conquered, read: r.read };
  }
}
