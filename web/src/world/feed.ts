// Folds REST responses and stream messages into the WorldView store. The live client and the dev mock
// both feed the page through here, so the mock exercises the same path the server does.
import type {
  ActivityEntry,
  GameEvent,
  HistoryResponse,
  LeaderboardResponse,
  MapPlayer,
  MapResponse,
  MapVillage,
  ReportSummary,
  ReportsResponse,
  StateResponse,
  StreamMessage,
  WorldSummary,
} from "../contract";
import { HISTORY, SERVER } from "../contract";
import { colorsForPlayer, EMBER, GOLD_BRIGHT, OWN_COLORS } from "../lib/palette";
import { Store } from "../lib/store";
import { emptyView, pruneEffects, type Clock, type Effect, type WorldView } from "./types";

export interface FeedHooks {
  /** The round changed or the server restored the world: everything read before is stale. */
  epochChanged(): void;
  /** Public points were refreshed: the leaderboard is worth re-reading. */
  pointsRefreshed(): void;
  /** A new history sample exists. */
  historySampled(): void;
  /** A state arrived on the stream while none was held (the player may just have joined, or rejoined in a new round). */
  stateAppeared?(): void;
  /** The state's unread count is below the list's: the steward read reports the list doesn't know about. */
  reportsReadElsewhere?(): void;
}

/** What belongs to the key's player in one round. A new epoch is a new World on the server: none of it carries over. */
function roundPrivate(): Partial<WorldView> {
  return { state: null, playerId: null, history: [], activity: [], reports: [], reportsNext: null, god: null };
}

const MAX_EFFECTS = 64;

export class WorldFeed {
  readonly store: Store<WorldView>;
  private epoch: string | null = null;
  private sampleBucket = -1;

  constructor(
    worldId: string,
    private hooks: FeedHooks,
  ) {
    this.store = new Store(emptyView(worldId));
  }

  get view(): WorldView {
    return this.store.get();
  }

  patch(patch: Partial<WorldView>): void {
    this.store.update(patch);
  }

  /** Remembers the epoch; true when it differs from one seen before. */
  private noteEpoch(epoch: string): boolean {
    const changed = this.epoch !== null && this.epoch !== epoch;
    this.epoch = epoch;
    return changed;
  }

  summary(summary: WorldSummary): void {
    const changed = this.noteEpoch(summary.epoch);
    if (changed) this.patch(roundPrivate());
    this.patch({ summary, clock: this.clockAt(summary.tick, summary.speed, summary.status, summary) });
    if (changed) this.hooks.epochChanged();
  }

  private clockAt(tick: number, speed: number, status: WorldSummary["status"], summary = this.view.summary): Clock {
    return { tick, speed, status, receivedAt: performance.now(), lockstep: summary?.clock === "lockstep" };
  }

  map(response: MapResponse): void {
    this.patch({
      map: {
        size: response.size,
        snapshotTick: response.snapshotTick,
        villages: new Map(response.villages.map((v) => [v.id, v])),
        players: new Map(response.players.map((p) => [p.id, p])),
      },
    });
  }

  leaderboard(response: LeaderboardResponse): void {
    this.patch({ leaderboard: response });
  }

  history(response: HistoryResponse): void {
    this.patch({ history: response.samples });
  }

  state(state: StateResponse): void {
    const clock = this.view.clock;
    const tickMoved = state.world.tick !== clock.tick || state.world.status !== clock.status || state.world.speed !== clock.speed;
    this.patch({
      state,
      playerId: state.player.id,
      ...(tickMoved ? { clock: this.clockAt(state.world.tick, state.world.speed, state.world.status) } : {}),
    });
    this.reconcileUnread(state.unreadReports);
  }

  /**
   * The state's unread count is the truth: the steward reads its reports over the API, which marks them
   * read, and nothing on the stream says which. None unread means none; fewer than the list shows asks
   * for the list again.
   */
  private reconcileUnread(unread: number): void {
    const listed = this.view.reports.reduce((n, r) => n + (r.read ? 0 : 1), 0);
    if (listed <= unread) return;
    if (unread === 0) this.patch({ reports: this.view.reports.map((r) => (r.read ? r : { ...r, read: true })) });
    else this.hooks.reportsReadElsewhere?.();
  }

  /** Takes the read flags of a fresh first page for the reports already listed. */
  reportReadFlags(response: ReportsResponse): void {
    const read = new Map(response.reports.map((r) => [r.id, r.read]));
    let changed = false;
    const reports = this.view.reports.map((r) => {
      const now = read.get(r.id);
      if (now === undefined || now === r.read) return r;
      changed = true;
      return { ...r, read: now };
    });
    if (changed) this.patch({ reports });
  }

  /** Backfill: replaces the log, newest first. */
  activity(entries: ActivityEntry[]): void {
    this.patch({ activity: [...entries].sort((a, b) => b.seq - a.seq).slice(0, SERVER.activityKept) });
  }

  private addActivity(entry: ActivityEntry): void {
    const log = this.view.activity;
    if (log.some((e) => e.seq === entry.seq)) return;
    this.patch({ activity: [entry, ...log].slice(0, SERVER.activityKept) });
  }

  reports(response: ReportsResponse, append: boolean): void {
    const known = append ? this.view.reports : [];
    const ids = new Set(known.map((r) => r.id));
    this.patch({ reports: [...known, ...response.reports.filter((r) => !ids.has(r.id))], reportsNext: response.next });
  }

  markReportRead(id: string): void {
    this.patch({ reports: this.view.reports.map((r) => (r.id === id && !r.read ? { ...r, read: true } : r)) });
  }

  effect(effect: Omit<Effect, "startedAt">): void {
    const now = performance.now();
    const effects = pruneEffects(this.view.effects, now);
    if (effects.some((e) => e.id === effect.id)) return;
    this.patch({ effects: [...effects, { ...effect, startedAt: now }].slice(-MAX_EFFECTS) });
  }

  message(msg: StreamMessage): void {
    switch (msg.type) {
      case "welcome": {
        const changed = this.noteEpoch(msg.world.epoch);
        if (changed) this.patch(roundPrivate());
        this.patch({
          summary: msg.world,
          clock: this.clockAt(msg.world.tick, msg.world.speed, msg.world.status, msg.world),
          authenticated: msg.authenticated,
          playerId: msg.playerId ?? this.view.playerId,
          channels: msg.channels,
          isCreator: this.view.isCreator || msg.channels.includes("god"),
          connection: "live",
        });
        if (changed) this.hooks.epochChanged();
        break;
      }
      case "tick":
        this.tick(msg.tick, msg.speed, msg.status);
        break;
      case "event":
        this.event(msg.event);
        break;
      case "state": {
        const appeared = !this.view.state || this.view.playerId !== msg.state.player.id;
        this.state(msg.state);
        if (appeared) this.hooks.stateAppeared?.();
        break;
      }
      case "activity":
        this.addActivity(msg.entry);
        break;
      case "map":
        this.mapChange(msg.tick, msg.villages, msg.players);
        break;
      case "conquest":
        this.conquest(msg);
        break;
      case "round": {
        const summary = this.view.summary;
        if (summary) this.patch({ summary: { ...summary, round: msg.round, status: msg.status, epoch: msg.epoch } });
        this.patch({ clock: { ...this.view.clock, status: msg.status, receivedAt: performance.now() } });
        if (this.noteEpoch(msg.epoch)) {
          this.patch(roundPrivate());
          this.hooks.epochChanged();
        }
        break;
      }
      case "god":
        this.god(msg);
        break;
      case "error":
        this.patch({ notice: msg.error.message });
        break;
    }
  }

  private tick(tick: number, speed: number, status: WorldSummary["status"]): void {
    const summary = this.view.summary;
    this.patch({
      clock: this.clockAt(tick, speed, status),
      ...(summary ? { summary: { ...summary, tick, speed, status } } : {}),
    });
    const bucket = Math.floor(tick / HISTORY.sampleEveryTicks);
    if (this.sampleBucket >= 0 && bucket > this.sampleBucket) this.hooks.historySampled();
    this.sampleBucket = bucket;
  }

  private event(event: GameEvent): void {
    if (event.type === "report") this.reportArrived(event.report);
    if (event.type === "round_ended") this.hooks.pointsRefreshed();
  }

  private reportArrived(report: ReportSummary): void {
    if (!this.view.reports.some((r) => r.id === report.id)) this.patch({ reports: [report, ...this.view.reports] });
    const won = report.outcome === "won" || report.outcome === "scouted";
    this.effect({
      id: `report:${report.commandId ?? report.id}`,
      kind: "battle",
      x: report.defender.x,
      y: report.defender.y,
      color: won ? GOLD_BRIGHT : EMBER,
      strong: won,
    });
  }

  private mapChange(tick: number, villages: MapVillage[], players: MapPlayer[]): void {
    const map = this.view.map;
    const nextVillages = new Map(map.villages);
    let pointsChanged = false;
    for (const v of villages) {
      const old = nextVillages.get(v.id);
      if (old && old.points !== v.points) pointsChanged = true;
      nextVillages.set(v.id, v);
    }
    const nextPlayers = new Map(map.players);
    for (const p of players) nextPlayers.set(p.id, p);
    this.patch({
      map: { ...map, villages: nextVillages, players: nextPlayers, snapshotTick: pointsChanged ? tick : map.snapshotTick },
    });
    if (pointsChanged) this.hooks.pointsRefreshed();
  }

  private conquest(msg: Extract<StreamMessage, { type: "conquest" }>): void {
    const map = this.view.map;
    const old = map.villages.get(msg.village.id);
    const villages = new Map(map.villages);
    villages.set(msg.village.id, {
      id: msg.village.id,
      x: msg.village.x,
      y: msg.village.y,
      name: msg.village.name,
      ownerId: msg.village.ownerId,
      ownerName: msg.village.ownerName,
      points: old?.points ?? 0,
    });
    this.patch({ map: { ...map, villages } });
    const mine = msg.to === this.view.playerId;
    this.effect({
      id: `conquest:${msg.village.id}:${msg.tick}`,
      kind: "conquest",
      x: msg.village.x,
      y: msg.village.y,
      color: mine ? OWN_COLORS.light : colorsForPlayer(msg.to).light,
      strong: true,
    });
  }

  private god(msg: Extract<StreamMessage, { type: "god" }>): void {
    this.patch({ god: { tick: msg.tick, movements: msg.movements, battles: msg.battles } });
    for (const b of msg.battles) {
      this.effect({
        id: `god:${b.tick}:${b.x},${b.y}:${b.attackerId}`,
        kind: "battle",
        x: b.x,
        y: b.y,
        color: b.winner === "attacker" ? colorsForPlayer(b.attackerId).light : EMBER,
        strong: b.conquered || b.winner === "attacker",
        god: true,
      });
    }
  }
}
