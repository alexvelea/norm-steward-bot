// The world page's link to a real server: REST for the backfill, the WebSocket stream for what happens
// next. Reads use the dashboard bucket; manual commands use normal steward writes.
import type {
  Action,
  ActionsResponse,
  ActivityResponse,
  HistoryResponse,
  LeaderboardResponse,
  MapResponse,
  MeResponse,
  Report,
  ReportsResponse,
  SandboxControlRequest,
  StateResponse,
  StreamHello,
  StreamMessage,
  WorldSummary,
} from "../contract";
import { apiGet, apiWrite, ApiFailure, describeFailure, streamUrl } from "../lib/http";
import { WorldFeed } from "./feed";
import type { WorldClient } from "./types";

const REPORTS_PAGE = 30;
const ACTIVITY_BACKFILL = 300;
const BACKOFF_MS = { first: 500, max: 15_000 };
/** The stream closes with this code when the key is rotated (api.md § Accounts). */
const CLOSE_KEY_ROTATED = 4001;
/** ...and with this one when the world is gone (a sandbox deleted or expired) or was never visible to us. */
const CLOSE_NOT_FOUND = 4004;
const NO_SUCH_WORLD = "There's no such world, or it's a sandbox that isn't yours.";
/** Re-reads stay well inside the dashboard's own bucket (SERVER.dashboardPerSecond). */
const LEADERBOARD_MIN_GAP_MS = 5_000;
const HISTORY_MIN_GAP_MS = 10_000;
const REPORTS_MIN_GAP_MS = 5_000;

/** Runs `fn` at most once per `gapMs`, trailing, so a burst of triggers costs one call. */
function throttled(fn: () => void, gapMs: number): { run(): void; cancel(): void } {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    run() {
      if (timer) return;
      const wait = Math.max(0, last + gapMs - Date.now());
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn();
      }, wait);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export class LiveWorldClient implements WorldClient {
  private readonly feed: WorldFeed;
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private welcomed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keyRejected = false;
  /** The world is gone: nothing left to reconnect to. */
  private gone = false;
  /** The last read of /state said the key's player isn't in this world (yet, or not in this round). */
  private outOfWorld = false;
  private readonly leaderboardRefresh = throttled(() => void this.loadLeaderboard(), LEADERBOARD_MIN_GAP_MS);
  private readonly historyRefresh = throttled(() => void this.loadHistory(), HISTORY_MIN_GAP_MS);
  private readonly reportsRefresh = throttled(() => void this.loadReportFlags(), REPORTS_MIN_GAP_MS);

  constructor(
    private readonly worldId: string,
    private readonly key: string | null,
  ) {
    this.feed = new WorldFeed(worldId, {
      epochChanged: () => void this.loadAll(),
      pointsRefreshed: () => this.leaderboardRefresh.run(),
      // The sample for a tick is taken while that tick is processed; ask a moment later.
      historySampled: () => this.historyRefresh.run(),
      // Joining a world (or rejoining it in a new round) shows only on the stream: read the rest then.
      stateAppeared: () => {
        if (!this.outOfWorld || !this.activeKey) return;
        this.outOfWorld = false;
        void this.loadPrivate();
      },
      reportsReadElsewhere: () => this.reportsRefresh.run(),
    });
  }

  get store() {
    return this.feed.store;
  }

  private get activeKey(): string | null {
    return this.keyRejected ? null : this.key;
  }

  private path(suffix = ""): string {
    return `/worlds/${encodeURIComponent(this.worldId)}${suffix}`;
  }

  start(): void {
    void this.loadAll();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.leaderboardRefresh.cancel();
    this.historyRefresh.cancel();
    this.reportsRefresh.cancel();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close(1000);
    this.socket = null;
  }

  // ---- REST ---------------------------------------------------------------------------------

  private rejectKey(reason: string): void {
    if (this.keyRejected) return;
    this.keyRejected = true;
    this.feed.patch({ notice: reason, authenticated: false, state: null, playerId: null, isCreator: false, activity: [], reports: [], history: [] });
    this.reconnectNow();
  }

  private async read<T>(suffix: string): Promise<T | null> {
    try {
      return await apiGet<T>(suffix, this.activeKey);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401 && this.activeKey) {
        this.rejectKey("The saved key was refused (rotated or mistyped). Showing the public view.");
      }
      return null;
    }
  }

  private async loadAll(): Promise<void> {
    const summary = await this.loadSummary();
    if (!summary) return;
    await Promise.all([this.loadMap(), this.loadLeaderboard(), this.activeKey ? this.loadPrivate() : Promise.resolve()]);
  }

  private async loadSummary(): Promise<WorldSummary | null> {
    try {
      const summary = await apiGet<WorldSummary>(this.path(), this.activeKey);
      this.feed.summary(summary);
      this.feed.patch({ fatal: null });
      return summary;
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) {
        this.worldGone();
      } else {
        this.feed.patch({ fatal: describeFailure(error) });
      }
      return null;
    }
  }

  private async loadMap(): Promise<void> {
    const map = await this.read<MapResponse>(this.path("/map"));
    if (map) this.feed.map(map);
  }

  private async loadLeaderboard(): Promise<void> {
    const board = await this.read<LeaderboardResponse>(this.path("/leaderboard"));
    if (board) this.feed.leaderboard(board);
  }

  /** The world went away (or was never ours to see): show that instead of what's left of it, and stop. */
  private worldGone(): void {
    this.gone = true;
    this.feed.patch({ fatal: NO_SUCH_WORLD, summary: null, state: null, notice: null, connection: "offline" });
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const old = this.socket;
    this.socket = null;
    old?.close(1000);
  }

  /** The steward read reports over the API: take the read flags from the first page again. */
  private async loadReportFlags(): Promise<void> {
    if (!this.feed.view.state) return;
    const page = await this.read<ReportsResponse>(this.path(`/reports?limit=${REPORTS_PAGE}`));
    if (page) this.feed.reportReadFlags(page);
  }

  private async loadHistory(): Promise<void> {
    if (!this.feed.view.playerId) return;
    const history = await this.read<HistoryResponse>(this.path("/history"));
    if (history) this.feed.history(history);
  }

  /** Everything only the key's owner may read. */
  private async loadPrivate(): Promise<void> {
    const [me, state] = await Promise.all([this.read<MeResponse>("/me"), this.loadState()]);
    if (me) this.feed.patch({ isCreator: me.sandboxes.includes(this.worldId) || this.feed.view.isCreator });
    if (!state) return;
    const [activity, history, reports] = await Promise.all([
      this.read<ActivityResponse>(this.path(`/activity?limit=${ACTIVITY_BACKFILL}`)),
      this.read<HistoryResponse>(this.path("/history")),
      this.read<ReportsResponse>(this.path(`/reports?limit=${REPORTS_PAGE}`)),
    ]);
    if (activity) this.feed.activity(activity.entries);
    if (history) this.feed.history(history);
    if (reports) this.feed.reports(reports, false);
  }

  private async loadState(): Promise<StateResponse | null> {
    if (!this.activeKey) return null;
    try {
      const state = await apiGet<StateResponse>(this.path("/state"), this.activeKey);
      this.outOfWorld = false;
      this.feed.state(state);
      this.feed.patch({ authenticated: true });
      return state;
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) {
        this.rejectKey("The saved key was refused (rotated or mistyped). Showing the public view.");
      } else if (error instanceof ApiFailure && error.error.code === "NOT_IN_WORLD") {
        this.outOfWorld = true;
        this.feed.patch({ authenticated: true, state: null });
      }
      return null;
    }
  }

  async fetchReport(id: string): Promise<Report> {
    const report = await apiGet<Report>(this.path(`/reports/${encodeURIComponent(id)}`), this.activeKey);
    this.feed.markReportRead(id);
    return report;
  }

  async fetchMoreReports(): Promise<void> {
    const before = this.feed.view.reportsNext;
    if (!before) return;
    const page = await apiGet<ReportsResponse>(
      this.path(`/reports?limit=${REPORTS_PAGE}&before=${encodeURIComponent(before)}`),
      this.activeKey,
    );
    this.feed.reports(page, true);
  }

  async join(): Promise<void> {
    const state = await apiWrite<StateResponse>("POST", this.path("/join"), undefined, this.activeKey);
    if (this.stopped) return;
    this.outOfWorld = false;
    this.feed.summary(state.world);
    this.feed.state(state);
    this.feed.patch({ authenticated: true });
    await this.loadPrivate();
  }

  async act(actions: Action[]): Promise<ActionsResponse> {
    if (!this.activeKey) throw new Error("Connect your key before giving commands.");
    const response = await apiWrite<ActionsResponse>("POST", this.path("/actions"), {
      actions, returnState: true, note: "Manual command from hybrid UI",
    }, this.activeKey);
    // A stream state may have arrived while the HTTP response was in flight.
    const current = this.feed.view.state;
    if (!this.stopped && response.state && (!current || (
      response.state.world.epoch === current.world.epoch && response.state.world.tick >= current.world.tick
    ))) this.feed.state(response.state);
    return response;
  }

  async control(request: SandboxControlRequest): Promise<void> {
    const summary = await apiWrite<WorldSummary>(
      "POST",
      `/sandboxes/${encodeURIComponent(this.worldId)}/control`,
      request,
      this.activeKey,
    );
    this.feed.summary(summary);
  }

  // ---- The stream ----------------------------------------------------------------------------

  private connect(): void {
    if (this.stopped || this.gone) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(streamUrl(this.worldId));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.feed.patch({ connection: this.welcomed ? "reconnecting" : "connecting" });

    // The hello goes out the moment the socket opens, well inside SERVER.helloTimeoutMs.
    socket.onopen = () => {
      const key = this.activeKey;
      const hello: StreamHello = key ? { type: "hello", key } : { type: "hello" };
      socket.send(JSON.stringify(hello));
    };
    socket.onmessage = (event) => {
      let message: StreamMessage;
      try {
        message = JSON.parse(String(event.data)) as StreamMessage;
      } catch {
        return;
      }
      this.onMessage(message);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stopped) return;
      if (event.code === CLOSE_KEY_ROTATED && this.activeKey) {
        this.rejectKey("This key was rotated, so it no longer works. Showing the public view.");
        return;
      }
      if (event.code === CLOSE_NOT_FOUND) {
        // Deleted, expired, or not visible to this key: ask once, and stop if it really is gone.
        void this.loadSummary().then((summary) => {
          if (summary) this.scheduleReconnect();
        });
        return;
      }
      this.feed.patch({ connection: "reconnecting" });
      this.scheduleReconnect();
    };
  }

  private onMessage(message: StreamMessage): void {
    if (message.type === "welcome") {
      const reconnected = this.welcomed;
      this.welcomed = true;
      this.attempt = 0;
      if (this.activeKey && !message.authenticated) {
        this.rejectKey("The saved key was refused (rotated or mistyped). Showing the public view.");
        return;
      }
      this.feed.message(message);
      // Whatever happened while the socket was down only reaches us by reading it again.
      if (reconnected) void this.catchUp();
      return;
    }
    // The close that follows (CLOSE_NOT_FOUND) decides what a vanished world shows; no notice for it.
    if (message.type === "error" && message.error.code === "NOT_FOUND") return;
    if (message.type === "error" && message.error.code === "UNAUTHORIZED" && this.activeKey) {
      this.rejectKey("The saved key was refused (rotated or mistyped). Showing the public view.");
      return;
    }
    this.feed.message(message);
  }

  private async catchUp(): Promise<void> {
    await Promise.all([this.loadMap(), this.loadLeaderboard(), this.activeKey ? this.loadPrivate() : Promise.resolve()]);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.gone || this.reconnectTimer) return;
    const base = Math.min(BACKOFF_MS.max, BACKOFF_MS.first * 2 ** this.attempt);
    const delay = base * (0.75 + Math.random() * 0.5);
    this.attempt++;
    if (this.attempt > 3) this.feed.patch({ connection: "offline" });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private reconnectNow(): void {
    const old = this.socket;
    this.socket = null;
    old?.close(1000);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempt = 0;
    this.connect();
    void this.loadAll();
  }
}
