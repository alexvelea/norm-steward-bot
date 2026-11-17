import { randomUUID } from "node:crypto";
import {
  createServer as createLeaseServer,
  type Server as LeaseServer,
} from "node:net";
import type {
  ActionsResponse,
  HistoryResponse,
  MapResponse,
  ReportsResponse,
  Report,
  SimulateBattleResponse,
  MeResponse,
  RulesResponse,
  StateResponse,
  WorldSummary,
} from "../shared/api.js";
import {
  productionScope,
  productionView,
  trackProduction,
} from "./production.js";
import { economicAdvisor, forecastEconomy } from "../advisors/economic.js";
import { militaryAdvisor } from "../advisors/military.js";
import { evaluateScoutDispatch, usableScoutObservation, type ScoutingContext, type ScoutObservation } from "../advisors/scout-dispatch.js";
import { evaluateRaidExecution, hamletArrivalDefense, usableRaidIntel, type RaidContext, type RaidAttempt } from "../advisors/raid-execution.js";
import { selectProposal } from "../advisors/president.js";
import { prioritizeFarmRunway } from "../advisors/farm-runway.js";
import {applyConquest, conquestScope, conquestTravel, type ConquestContext} from "../advisors/conquest.js";
import {safeEnvoyAttack} from "../review/conquest-plan.js";
import type { AdvisorContext, Proposal } from "../advisors/types.js";
import type { ControlStorage } from "./storage.js";
import {
  remoteRequest,
  RemoteError,
  validateOrigin,
  type Remote,
} from "./remote.js";
import type {
  ControlView,
  Decision,
  Pending,
  SavedControl,
  Settings,
} from "./types.js";

/** A kernel-owned loopback listener is a process lease, automatically released even after a crash. */
export async function acquireExecutorLease(port = 8790): Promise<LeaseServer> {
  const server = createLeaseServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return server;
}
export class Controller {
  private saved: SavedControl;
  private automatic = true;
  private revision = 0;
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private backoffUntil = 0;
  private lastPlan = "";
  private metadata: {
    revision: number;
    at: number;
    me: MeResponse;
    worlds: WorldSummary[];
  } | null = null;
  private cachedRules: {
    revision: number;
    epoch: string;
    worldId: string;
    version: number;
    rules: RulesResponse;
  } | null = null;
  private scouting: ScoutingContext | undefined;
  private conquest: ConquestContext | undefined;
  private raids: RaidContext = { attempts: [], assessments: [] };
  private scoutReports: ReportsResponse = { reports: [], next: null };
  private persistence: Promise<void> = Promise.resolve();
  private view: Omit<
    ControlView,
    | "settings"
    | "automatic"
    | "busy"
    | "decisions"
    | "pending"
    | "nextAttemptAt"
  > = {
    connection: "unconfigured",
    error: null,
    lastEvaluatedAt: null,
    account: null,
    worlds: [],
    world: null,
    villages: [],
    proposals: [],
    selection: {
      selected: null,
      reason: "Waiting for a configured player and world.",
      reservations: [],
    },
    conflicts: [],
    production: null,
    economicForecasts: [],
  };
  private constructor(
    saved: SavedControl,
    private storage: ControlStorage,
    private request: Remote,
    private now: () => number,
  ) {
    this.saved = saved;
  }
  static async create(
    storage: ControlStorage,
    initial: Settings,
    request: Remote = remoteRequest,
    now: () => number = Date.now,
    options: { execute?: boolean } = {},
  ): Promise<Controller> {
    const saved = (await storage.load()) ?? {
      settings: initial,
      pending: null,
      decisions: [],
    };
    saved.settings.serverUrl = validateOrigin(saved.settings.serverUrl);
    const controller = new Controller(saved, storage, request, now);
    controller.automatic = options.execute ?? saved.automatic ?? true;
    await controller.persist();
    return controller;
  }
  get settings(): Settings {
    return { ...this.saved.settings };
  }
  snapshot(): ControlView {
    const { apiKey, ...settings } = this.saved.settings;
    // A pending operation contains no credentials. All returned objects are serialized by the HTTP layer.
    return {
      ...this.view,
      settings: {
        ...settings,
        keyConfigured: !!apiKey,
        keyHint: apiKey ? `••••••••${apiKey.slice(-4)}` : "Not configured",
      },
      automatic: this.automatic,
      busy: this.busy,
      decisions: this.saved.decisions,
      pending: this.saved.pending ?? this.saved.active?.[0] ?? null,
      active: this.saved.active ?? [],
      nextAttemptAt:
        this.backoffUntil > this.now()
          ? new Date(this.backoffUntil).toISOString()
          : null,
    };
  }
  private persist(): Promise<void> {
    const value = structuredClone({ ...this.saved, automatic: this.automatic });
    this.persistence = this.persistence
      .catch(() => undefined)
      .then(() => this.storage.save(value));
    return this.persistence;
  }
  private record(
    kind: Decision["kind"],
    text: string,
    proposal?: Proposal,
    clientId?: string,
    tick?: number,
  ): void {
    this.saved.decisions.unshift({
      id: randomUUID(),
      at: new Date(this.now()).toISOString(),
      kind,
      text,
      proposalId: proposal?.id,
      clientId,
      tick,
    });
    this.saved.decisions = this.saved.decisions.slice(0, 100);
  }
  async configure(input: Partial<Settings>): Promise<void> {
    if (this.busy)
      throw new Error(
        "An evaluation is in progress; retry settings in a moment.",
      );
    const settings = { ...this.saved.settings, ...input };
    settings.serverUrl = validateOrigin(settings.serverUrl);
    if (!settings.worldId.trim() || !settings.apiKey.trim())
      throw new Error("A player key and world are required.");
    this.revision++;
    this.backoffUntil = 0;
    this.saved.settings = settings;
    this.lastPlan = "";
    this.view = {
      ...this.view,
      connection: "connecting",
      account: null,
      world: null,
      villages: [],
      proposals: [],
      economicForecasts: [],
      production: null,
      selection: {
        selected: null,
        reason: "Revalidating connection.",
        reservations: [],
      },
      error: null,
    };
    this.record(
      "waiting",
      "Connection settings updated; revalidating the account with the current execution preference.",
    );
    await this.persist();
    await this.cycle();
  }
  async setAutomatic(enabled: boolean): Promise<void> {
    if (
      enabled &&
      (this.view.connection !== "connected" ||
        !this.view.account ||
        !this.view.world)
    )
      throw new Error(
        "The bot needs a valid game connection before it can run.",
      );
    this.automatic = enabled;
    this.revision++;
    this.record(
      "waiting",
      enabled
        ? "Bot execution resumed; decisions are revalidated against live state."
        : "Bot execution paused by operator.",
    );
    try {
      await this.persist();
    } catch (e) {
      this.automatic = false;
      this.revision++;
      throw e;
    }
  }
  async resolveUncertain(acknowledged: boolean): Promise<void> {
    if (this.automatic || this.busy || !acknowledged)
      throw new Error(
        "Pause execution and acknowledge inspection of the game activity log first.",
      );
    const pending = this.saved.pending;
    if (!pending) return;
    if (pending.phase === "accepted")
      throw new Error(
        "Accepted work is still tracked; wait for completion or cancel it in Town view.",
      );
    this.record(
      "uncertain",
      "Operator inspected the activity log and cleared this uncertain operation. Its original request ID remains in history.",
      pending.proposal,
      pending.action.clientId,
    );
    this.saved.pending = null;
    this.automatic = true;
    this.backoffUntil = 0;
    await this.persist();
  }
  start(intervalMs = 1000): void {
    const run = async () => {
      if (this.stopped) return;
      await this.cycle();
      if (!this.stopped) this.timer = setTimeout(() => void run(), intervalMs);
    };
    void run();
  }
  stop(): void {
    this.stopped = true;
    this.revision++;
    if (this.timer) clearTimeout(this.timer);
  }
  private path(suffix: string): string {
    return `/worlds/${encodeURIComponent(this.saved.settings.worldId)}${suffix}`;
  }
  private async readMetadata(force = false) {
    if (
      !force &&
      this.metadata?.revision === this.revision &&
      this.now() - this.metadata.at < 30000
    )
      return this.metadata;
    const [me, worlds] = await Promise.all([
      this.request<MeResponse>(this.settings, "/me"),
      this.request<WorldSummary[]>(this.settings, "/worlds"),
    ]);
    this.metadata = { revision: this.revision, at: this.now(), me, worlds };
    return this.metadata;
  }
  private async readContext(forceRules = false): Promise<AdvisorContext> {
    const settings = this.settings;
    const state = await this.request<StateResponse>(
      settings,
      this.path("/state"),
    );
    if (state.world.id !== settings.worldId)
      throw new Error("Returned state belongs to another world.");
    const cached = this.cachedRules;
    const valid =
      cached?.revision === this.revision &&
      cached.worldId === state.world.id &&
      cached.epoch === state.world.epoch &&
      cached.version === state.world.rulesVersion;
    const rules =
      valid && !forceRules
        ? cached.rules
        : await this.request<RulesResponse>(settings, this.path("/rules"));
    if (rules.version !== state.world.rulesVersion)
      throw new Error(
        "Rules version mismatch; wait for compatible live rules.",
      );
    this.cachedRules = {
      revision: this.revision,
      worldId: state.world.id,
      epoch: state.world.epoch,
      version: rules.version,
      rules,
    };
    return { state, rules };
  }
  /** Join is idempotent upstream: retries return the existing village, never another one. */
  private async readJoinedContext(
    worlds: WorldSummary[],
    revision: number,
  ): Promise<AdvisorContext> {
    let context: AdvisorContext | undefined;
    let missing: unknown;
    try {
      context = await this.readContext();
      if (context.state.villages.length) return context;
    } catch (error) {
      if (!(error instanceof RemoteError) || error.code !== "NOT_IN_WORLD")
        throw error;
      missing = error;
    }
    worlds = (await this.readMetadata(true)).worlds;
    const world = worlds.find((w) => w.id === this.settings.worldId);
    if (
      !this.automatic ||
      this.stopped ||
      revision !== this.revision ||
      world?.status !== "running"
    ) {
      if (context) return context;
      throw missing;
    }
    this.record(
      "submitted",
      `Automatically joining ${world.name}, round ${world.round}.`,
      undefined,
      undefined,
      world.tick,
    );
    await this.persist();
    if (!this.automatic || this.stopped || revision !== this.revision) {
      if (context) return context;
      throw missing;
    }
    await this.request<StateResponse>(this.settings, this.path("/join"), {});
    // Refresh both state and rules: joining may race a round transition.
    const joined = await this.readContext();
    if (!joined.state.villages.length)
      throw new Error(
        "World join returned no village; the bot will retry after refreshing state.",
      );
    this.record(
      "confirmed",
      `Joined ${joined.state.world.name}, round ${joined.state.world.round}; managing ${joined.state.villages.map((v) => v.name).join(", ")}.`,
      undefined,
      undefined,
      joined.state.world.tick,
    );
    return joined;
  }
  private scoutingScope(state: StateResponse): string {
    return JSON.stringify([this.settings.serverUrl, this.view.account?.id, state.world.id, state.world.epoch]);
  }
  private async readScouting(context: AdvisorContext): Promise<void> {
    const state = context.state;
    const scope = this.scoutingScope(state);
    const needed = [this.saved.pending, ...(this.saved.active ?? [])].some(p => p?.action.type === "send") || (this.saved.scouting ?? []).some(o => o.scope === this.scoutingScope(state) && o.report && state.world.tick - o.report.tick <= 300) || state.villages.some(v => (v.units.home.scout ?? 0) >= 2);
    this.scoutReports = { reports: [], next: null };
    this.raids = { attempts: this.saved.raids ?? [], assessments: this.raids.assessments.filter(a => a.scope === scope && a.tick === state.world.tick) };
    if (!needed) { this.scouting = undefined; return; }
    // A public map is enough for a scouting destination; never infer hidden defenders from it.
    // Reuse only a map read at this exact tick and scope during immediate pre-write revalidation.
    const map = this.scouting?.scope === scope && this.scouting.map.tick === state.world.tick
      ? this.scouting.map : await this.request<MapResponse>(this.settings, this.path("/map"));
    if ([this.saved.pending, ...(this.saved.active ?? [])].some(p => p?.action.type === "send") || state.villages.some(v => (v.units.home.lancer ?? 0) >= 30)) {
      this.scoutReports = await this.request<ReportsResponse>(this.settings, this.path("/reports"));
    }
    this.scouting = { scope, map, observations: (this.saved.scouting ?? []).filter(o => o.scope === scope),
      consumedReportIds: this.raids.attempts.filter(a => a.scope === scope).map(a => a.reportId) };
    for (const r of this.scoutReports.reports) {
      if (r.kind !== "battle" || r.role !== "attacker" || r.outcome !== "won" || r.attacker.ownerId !== state.player.id ||
          r.defender.ownerId !== null || !r.commandId || !state.villages.some(v => v.id === r.attacker.id) ||
          r.tick > state.world.tick || state.world.tick - r.tick > 600 ||
          this.scouting.observations.some(o => o.targetId === r.defender.id && o.clearing && o.clearing.tick >= r.tick)) continue;
      const clearing = await this.request<Report>(this.settings, this.path(`/reports/${encodeURIComponent(r.id)}`));
      if (clearing.id === r.id && clearing.commandId === r.commandId && clearing.tick === r.tick && !clearing.conquered &&
          clearing.kind === "battle" && clearing.role === "attacker" && clearing.outcome === "won" &&
          clearing.attacker.ownerId === state.player.id && clearing.defender.id === r.defender.id && clearing.defender.ownerId === null) {
        this.rememberScout({ scope, villageId: r.attacker.id, targetId: r.defender.id, targetOwnerId: null, sentTick: -600, clearing });
      }
      break;
    }
    // Fetch only a journal-linked, fresh successful report. Reading detail marks it read upstream.
    for (const o of this.scouting.observations) {
      if (!o.detail && o.report && usableScoutObservation(o, state, map, scope)) {
        const detail = await this.request<Report>(this.settings, this.path(`/reports/${encodeURIComponent(o.report.id)}`));
        // Persist full detail only if provenance and shape agree with the original observation.
        const candidate = { ...o, detail };
        if (usableRaidIntel(candidate, state, this.scouting)) this.rememberScout(candidate);
        break; // Bound reads to one detail per evaluation.
      }
    }
    if (state.commands.outgoing.some(c => c.kind === "attack" && Object.entries(c.units).some(([unit, n]) => unit !== "scout" && n > 0))) return;
    for (const o of this.scouting.observations) {
      if (!usableRaidIntel(o, state, this.scouting) || this.raids.attempts.some(a => a.scope === scope && a.reportId === o.detail.id)) continue;
      const intel = o.detail.intel!;
      const village = state.villages.find(v => v.id === o.villageId);
      const owner = map.players.find(p => p.id === o.targetOwnerId);
      const unit = o.targetOwnerId === null ? "lancer" : "raider";
      const count = unit === "lancer" ? 30 : 10;
      if (!village || (village.units.home[unit] ?? 0) < count || (o.targetOwnerId !== null && !owner?.houseBot) ||
          intel.buildings.wall !== 0 || Object.values(intel.unitsHome).some(n => n > 0) || Object.values(intel.supportTotal).some(n => n > 0)) continue;
      if (this.raids.assessments.some(a => a.reportId === o.detail.id)) break;
      const target = map.villages.find(t => t.id === o.targetId)!;
      const speed = (context.rules.rules.UNITS as Record<string, { speed: number }>)[unit]?.speed;
      const travel = Math.ceil(Math.hypot(target.x - village.x, target.y - village.y) * speed);
      const baseDefense = unit === "lancer" ? hamletArrivalDefense(o, state, context.rules, travel) : undefined;
      if (unit === "lancer" && (!Number.isSafeInteger(travel) || travel < 1 || travel > 300 || baseDefense === undefined)) continue;
      const battle = await this.request<SimulateBattleResponse>(this.settings, this.path("/simulate/battle"), {
        fromReport: o.detail.id, attacker: { [unit]: count }, ...(baseDefense === undefined ? {} : { baseDefense }),
      });
      this.raids.assessments.push({ scope, reportId: o.detail.id, tick: state.world.tick, battle, unit, baseDefense });
      break; // One authoritative risk assessment per evaluation.
    }
  }
  /** Research transition uses only the existing executor. No timers or independent spender. */
  private async readConquest(context: AdvisorContext): Promise<void> {
    const {state,rules}=context;
    const scope=conquestScope(this.settings.serverUrl,this.view.account!.id,context);
    if(this.saved.conquest?.scope!==scope)this.saved.conquest=undefined;
    if(!this.saved.conquest&&state.villages.length===1&&state.world.status==='running'){
      const v=state.villages[0];
      if((v.units.home.pikeman??0)>=150&&!Object.values(v.orders).some(q=>q.length)&&
        !state.commands.incoming.some(c=>c.kind==='attack'&&c.to.id===v.id))
        this.saved.conquest={scope,villageId:v.id,startedTick:state.world.tick,status:'preparing',waves:0};
    }
    const plan=this.saved.conquest;
    if(!plan){this.conquest=undefined;return;}
    const v=state.villages.find(v=>v.id===plan.villageId);
    if(!v){plan.status='stopped';plan.reason='Origin lost';}
    if(plan.targetId&&state.villages.some(v=>v.id===plan.targetId)){
      plan.status='captured';plan.capturedTick??=state.world.tick;
    }
    this.conquest={plan};
    if(plan.status!=='preparing'||!v||Math.min(v.buildings.lumberyard,v.buildings.quarry,v.buildings.mine)<15)return;
    const map=await this.request<MapResponse>(this.settings,this.path('/map'));
    this.conquest.map=map;
    if(!plan.targetId){
      plan.targetId=map.villages.filter(t=>t.ownerId===null).sort((a,b)=>
        Math.hypot(a.x-v.x,a.y-v.y)-Math.hypot(b.x-v.x,b.y-v.y)||a.id.localeCompare(b.id))[0]?.id;
      if(!plan.targetId){plan.status='stopped';plan.reason='No unowned target';return;}
    }
    if(map.villages.find(t=>t.id===plan.targetId)?.ownerId!==null){plan.status='stopped';plan.reason='Target ownership changed';return;}
    const hamlet=rules.rules.MAP as {hamletLevels:{wall:number[]};hamletBaseDefense:number;hamletMilitiaCap:number;hamletMilitiaPerTick:number};
    if(!plan.escort){
      for(let n=20;n<=1000;n+=20){
        const battle=await this.request<SimulateBattleResponse>(this.settings,this.path('/simulate/battle'),{
          attacker:{raider:n,envoy:1},defender:{},wall:hamlet.hamletLevels.wall[1],loyalty:100,
          baseDefense:hamlet.hamletBaseDefense+hamlet.hamletMilitiaCap});
        if(safeEnvoyAttack(battle)){plan.escort=n;break;}
      }
      if(!plan.escort){plan.status='stopped';plan.reason='No bounded surviving-Envoy escort';return;}
    }
    if((v.units.home.envoy??0)<1||(v.units.home.raider??0)<1||state.commands.outgoing.some(c=>c.from.id===v.id))return;
    const travel=conquestTravel(context,this.conquest)!;
    const last=plan.lastBattle;
    // Only a journal-linked own victory may reset militia. Otherwise use the maximum.
    const baseDefense=hamlet.hamletBaseDefense+(last?.outcome==='won'?
      Math.min(hamlet.hamletMilitiaCap,Math.ceil(hamlet.hamletMilitiaPerTick*(state.world.tick+travel-last.tick))):hamlet.hamletMilitiaCap);
    const battle=await this.request<SimulateBattleResponse>(this.settings,this.path('/simulate/battle'),{
      attacker:{raider:v.units.home.raider,envoy:1},defender:{},wall:hamlet.hamletLevels.wall[1],loyalty:100,baseDefense});
    this.conquest.assessment={tick:state.world.tick,raiders:v.units.home.raider!,battle};
  }
  private async reconcileConquest(context: AdvisorContext,p: Pending): Promise<void> {
    const state=context.state,plan=this.saved.conquest;
    if(!plan||plan.scope!==conquestScope(this.settings.serverUrl,this.view.account!.id,context)){
      this.clearOperation(p);return;
    }
    // Ownership establishes the objective even when the last request/report is uncertain.
    // Do not downgrade a captured plan or attribute that ownership to an unknown write.
    const captured=!!plan.targetId&&state.villages.some(v=>v.id===plan.targetId);
    if(captured){plan.status='captured';plan.capturedTick??=state.world.tick;}
    if(captured&&p.phase!=='accepted'){
      this.record('uncertain','Fresh state confirms conquest target ownership; final request attribution remains unknown. Suppress replay.',p.proposal,p.action.clientId,state.world.tick);
      this.clearOperation(p);await this.persist();return;
    }
    if(p.phase==='accepted'){
      const report=this.scoutReports.reports.find(r=>r.commandId===p.itemId&&r.kind==='battle'&&r.role==='attacker'&&
        r.attacker.id===plan.villageId&&r.attacker.ownerId===state.player.id&&r.defender.id===plan.targetId&&r.tick>=p.createdTick&&r.tick<=state.world.tick);
      if(report){
        const detail=await this.request<Report>(this.settings,this.path(`/reports/${encodeURIComponent(report.id)}`));
        if(detail.commandId!==p.itemId||detail.attacker.id!==plan.villageId||detail.defender.id!==plan.targetId||detail.role!=='attacker')
          throw new Error('Conquest report provenance mismatch');
        plan.lastBattle=detail;
        if(!captured&&(detail.outcome!=='won'||(!detail.conquered&&(detail.attackerUnits?.sent.envoy??0)-(detail.attackerUnits?.lost.envoy??0)<1))){
          plan.status='stopped';plan.reason='Battle failed or sole Envoy lost';
        }
        this.record('confirmed',`Conquest battle ${detail.id}: ${detail.outcome}; loyalty ${detail.loyalty?.after??'unknown'}. Ownership is checked in fresh state.`,p.proposal,p.action.clientId,state.world.tick);
        this.clearOperation(p);
      }else if(!state.commands.outgoing.some(c=>c.id===p.itemId)){
        if(!captured){plan.status='stopped';plan.reason='Accepted conquest command disappeared without report';}
        this.record(captured?'confirmed':'cancelled',captured?
          'Fresh state confirms conquest target ownership; no retained matching battle report, so battle attribution remains unknown.':
          'Accepted conquest command disappeared without report; no battle success is inferred.',p.proposal,p.action.clientId,state.world.tick);
        this.clearOperation(p);
      }
    }else if(state.commands.outgoing.some(c=>c.from.id===plan.villageId)||
      (state.villages.find(v=>v.id===plan.villageId)?.units.home.raider??0)!==p.proposal.currentLevel){
      plan.status='stopped';plan.reason='Uncertain conquest send changed troops; inspect activity';this.clearOperation(p);
    }else if(state.world.tick>=p.expiresTick){
      this.automatic=false;this.record('uncertain','Conquest idempotency window expired; inspect activity before resuming.',p.proposal,p.action.clientId,state.world.tick);
    }
    await this.persist();
  }
  private rememberScout(observation: ScoutObservation): void {
    if (!observation.clearing && observation.targetOwnerId === null) observation = { ...observation,
      clearing: this.scouting?.observations.find(o => o.targetId === observation.targetId && o.clearing)?.clearing };
    this.saved.scouting = [observation, ...(this.saved.scouting ?? []).filter(o =>
      !(o.scope === observation.scope && o.villageId === observation.villageId && o.sentTick === observation.sentTick))].slice(0, 32);
    if (this.scouting) this.scouting.observations = this.saved.scouting;
  }
  private async reconcileScout(context: AdvisorContext, p: Pending): Promise<void> {
    if (p.action.type !== "send") return;
    const state = context.state;
    const v = state.villages.find(v => v.id === p.proposal.villageId)!;
    const report = p.itemId ? this.scoutReports.reports.find(r => r.commandId === p.itemId) : undefined;
    if (p.phase === "accepted") {
      if (report && p.scout) {
        this.rememberScout({ ...p.scout, commandId: p.itemId, report });
        this.record(report.kind === "scouting" && report.outcome === "scouted" ? "confirmed" : "cancelled",
          `Scouting report ${report.id}: ${report.outcome} at tick ${report.tick}. Observation age and current ownership must be checked before target use.`, p.proposal, p.action.clientId, state.world.tick);
        this.clearOperation(p);
      } else if (!state.commands.outgoing.some(c => c.id === p.itemId)) {
        this.record("cancelled", "Scouting command disappeared without a retained matching report; no intelligence or success is inferred.", p.proposal, p.action.clientId, state.world.tick);
        this.clearOperation(p);
      }
    } else if ((v.units.home.scout ?? 0) !== p.proposal.currentLevel || state.commands.outgoing.some(c => c.from.id === v.id && (c.units.scout ?? 0) > 0)) {
      if (p.scout) this.rememberScout(p.scout);
      this.record("uncertain", "Scout troops or commands changed after an uncertain send; suppress replay without attributing the command or claiming intelligence.", p.proposal, p.action.clientId, state.world.tick);
      this.clearOperation(p);
    } else if (state.world.tick >= p.expiresTick) {
      this.automatic = false;
      this.backoffUntil = this.now() + 60000;
      this.record("uncertain", "Scouting idempotency window expired; execution paused pending activity inspection.", p.proposal, p.action.clientId, state.world.tick);
    }
    await this.persist();
  }
  private rememberRaid(attempt: RaidAttempt): void {
    // Keep every still-usable report consumed, even if many villages raid in one round.
    this.saved.raids = [attempt, ...(this.saved.raids ?? []).filter(a =>
      a.scope === attempt.scope && a.reportId !== attempt.reportId && attempt.sentTick - a.sentTick <= 900)];
    this.raids.attempts = this.saved.raids;
    if (this.scouting) this.scouting.consumedReportIds = this.saved.raids.filter(a => a.scope === this.scouting!.scope).map(a => a.reportId);
  }
  private async reconcileRaid(context: AdvisorContext, p: Pending): Promise<void> {
    const state = context.state;
    const v = state.villages.find(v => v.id === p.proposal.villageId)!;
    const report = p.itemId ? this.scoutReports.reports.find(r => r.commandId === p.itemId && r.kind === "battle" &&
      r.role === "attacker" && r.attacker.id === v.id && r.attacker.ownerId === state.player.id &&
      r.defender.id === p.raid!.targetId && r.tick >= p.createdTick && r.tick <= state.world.tick) : undefined;
    if (p.phase === "accepted") {
      if (report) {
        this.record("confirmed", `Raid report ${report.id}: ${report.outcome} at tick ${report.tick}. Actual losses and loot belong to its full battle detail.`, p.proposal, p.action.clientId, state.world.tick);
        this.clearOperation(p);
      } else if (!state.commands.outgoing.some(c => c.id === p.itemId)) {
        this.record("cancelled", "Raid command disappeared without a matching report; no victory or loot is inferred.", p.proposal, p.action.clientId, state.world.tick);
        this.clearOperation(p);
      }
    } else if ((v.units.home[p.action.type === "send" && p.action.units.lancer === 30 ? "lancer" : "raider"] ?? 0) !== p.proposal.currentLevel || state.commands.outgoing.some(c => c.from.id === v.id && ((c.units.raider ?? 0) > 0 || (c.units.lancer ?? 0) > 0))) {
      this.rememberRaid(p.raid!);
      this.record("uncertain", "Raid troops or commands changed after an uncertain send; consume this report and suppress replay without attributing success.", p.proposal, p.action.clientId, state.world.tick);
      this.clearOperation(p);
    } else if (state.world.tick >= p.expiresTick) {
      this.automatic = false;
      this.backoffUntil = this.now() + 60000;
      this.record("uncertain", "Raid idempotency window expired; execution paused pending activity inspection.", p.proposal, p.action.clientId, state.world.tick);
    }
    await this.persist();
  }
  private plan(context: AdvisorContext): void {
    // A completed first component can outlive its accepted queue item across a pause/restart.
    // Do not use that memory to append to an unrelated/manual Barracks queue.
    const complements = (this.saved.defenseComplements ?? []).filter(p =>
      !context.state.villages.find(v => v.id === p.proposal.villageId)?.training.barracks.length);
    context = {...context, activeProposals:[...(this.saved.active ?? []), ...complements].map(p => p.proposal)};
    this.view.world = context.state.world;
    this.view.villages = context.state.villages.map((v) => ({
      id: v.id,
      name: v.name,
      points: v.points,
    }));
    this.view.economicForecasts = context.state.villages.map(forecastEconomy);
    this.view.proposals = [economicAdvisor, militaryAdvisor].flatMap(
      (advisor) => advisor.evaluate(context),
    );
    this.view.proposals.push(...evaluateScoutDispatch(context, this.scouting), ...evaluateRaidExecution(context, this.scouting, this.raids));
    const lane = (a: Proposal["action"]) => a.type === "build" ? `${a.village}:build` : a.type === "send" ? "combat" : `${a.village}:train:${(context.rules.rules.UNITS as Record<string,{building:string}>)[a.unit].building}`;
    for (const proposal of this.view.proposals) {
      const occupied = (this.saved.active ?? []).filter(p => lane(p.action) === lane(proposal.action));
      // A recorded 3Pi1Sh cohort may add its second unit type to the same Barracks queue.
      const complement = proposal.defenseBatch && proposal.action.type === "train" && occupied.length === 1 &&
        occupied[0].proposal.defenseBatch && occupied[0].action.type === "train" && occupied[0].action.unit !== proposal.action.unit;
      if (occupied.length && !complement && proposal.status === "ready") {
        proposal.status = "waiting"; proposal.blockers.push("EXECUTOR_QUEUE_BUSY");
      }
    }
    if(this.conquest?.plan.status!=='preparing')prioritizeFarmRunway(context, this.view.proposals);
    this.view.proposals=applyConquest(context,this.view.proposals,this.conquest);
    this.view.selection = selectProposal(this.saved.pending ? this.view.proposals.filter(p => p.id === this.saved.pending!.proposal.id) : this.view.proposals);
    if (!this.view.selection.selected && this.saved.active?.length) {
      this.view.selection.reason += ` Tracking ${this.saved.active.length} accepted operation(s) across independent construction/training/command queues.`;
    }
    this.view.conflicts = context.state.villages
      .filter((v) => v.orders.build.length > 0)
      .map(
        (v) =>
          `${v.name} has server standing build orders. The advisor will not add competing construction there.`,
      );
    const selected = this.view.selection.selected;
    const signature = JSON.stringify({
      id: selected?.id,
      importance: selected?.importance,
      reservations: this.view.selection.reservations,
      queues: context.state.villages.map((v) => v.buildQueue.map((q) => q.id)),
    });
    if (signature !== this.lastPlan) {
      this.record(
        selected ? "recommendation" : "waiting",
        this.view.selection.reason,
        selected ?? undefined,
        undefined,
        context.state.world.tick,
      );
      this.lastPlan = signature;
    }
    this.view.lastEvaluatedAt = new Date(this.now()).toISOString();
  }
  /** Pending requests survive process restarts; retries never create a new clientId. */
  private clearOperation(p: Pending): void {
    if (this.saved.pending === p) this.saved.pending = null;
    this.saved.active = (this.saved.active ?? []).filter(o => o !== p);
  }
  private archiveAccepted(): void {
    if (this.saved.pending?.phase !== "accepted") return;
    this.saved.active = [...(this.saved.active ?? []), this.saved.pending];
    this.saved.pending = null;
  }
  private async reconcile(context: AdvisorContext): Promise<void> {
    for (const p of [...(this.saved.active ?? []), ...(this.saved.pending ? [this.saved.pending] : [])]) await this.reconcileOne(context, p);
    this.archiveAccepted();
    this.saved.defenseComplements = (this.saved.defenseComplements ?? []).filter(p => {
      const s = context.state, v = s.villages.find(v => v.id === p.proposal.villageId), plan = p.proposal.defenseBatch;
      if (!v || !plan || s.world.status === "ended" || p.serverUrl !== this.settings.serverUrl ||
          p.worldId !== s.world.id || p.epoch !== s.world.epoch || p.accountId !== this.view.account?.id) return false;
      const owned = (unit: "pikeman" | "shieldman") => (v.units.home[unit] ?? 0) + (v.units.away[unit] ?? 0);
      // Losses must not turn a remembered complement into replacement Pikemen.
      if (owned("pikeman") < plan.baselinePikemen + plan.pikemen) return false;
      const shieldsQueued = v.training.barracks.filter(q => q.unit === "shieldman").reduce((n, q) => n + q.remaining, 0);
      return owned("shieldman") + shieldsQueued < plan.baselineShieldmen + plan.shieldmen;
    });
  }
  private async reconcileOne(context: AdvisorContext, p: Pending): Promise<void> {
    const s = context.state;
    const v = s.villages.find((v) => v.id === p.proposal.villageId);
    if (
      p.serverUrl !== this.saved.settings.serverUrl ||
      p.worldId !== s.world.id ||
      p.epoch !== s.world.epoch ||
      p.accountId !== this.view.account?.id ||
      !v
    ) {
      this.record(
        "cancelled",
        "Pending operation belongs to an old world, epoch or account; it will not be replayed.",
        p.proposal,
        p.action.clientId,
        s.world.tick,
      );
      this.clearOperation(p);
      await this.persist();
      return;
    }
    if (p.action.type === "send") {
      if(p.conquest)await this.reconcileConquest(context,p);
      else if (p.raid) await this.reconcileRaid(context, p);
      else await this.reconcileScout(context, p);
      return;
    }
    if (p.action.type === "train") {
      await this.reconcileTraining(context, p);
      return;
    }
    const building = p.action.building;
    const item = p.itemId
      ? v.buildQueue.find((q) => q.id === p.itemId)
      : undefined;
    if (p.phase === "accepted") {
      if (item) return;
      this.record(
        v.buildings[building] >= p.proposal.targetLevel
          ? "confirmed"
          : "cancelled",
        v.buildings[building] >= p.proposal.targetLevel
          ? `${p.proposal.buildingName} reached level ${p.proposal.targetLevel}, confirmed by fresh server state.`
          : "Accepted construction disappeared without reaching its target; it may have been cancelled by another actor.",
        p.proposal,
        p.action.clientId,
        s.world.tick,
      );
      this.clearOperation(p);
      await this.persist();
      return;
    }
    if (
      v.buildings[building] !== p.proposal.currentLevel ||
      v.buildQueue.some((q) => q.building === building)
    ) {
      this.record(
        "uncertain",
        "Desired building state changed after an uncertain request. It may have applied or another actor may have acted; do not submit a second upgrade.",
        p.proposal,
        p.action.clientId,
        s.world.tick,
      );
      this.clearOperation(p);
      await this.persist();
      return;
    }
    if (s.world.tick >= p.expiresTick) {
      this.automatic = false;
      this.record(
        "uncertain",
        "Idempotency window expired with no confirmed outcome. Automatic execution is paused; inspect the activity log before clearing this operation.",
        p.proposal,
        p.action.clientId,
        s.world.tick,
      );
      this.backoffUntil = this.now() + 60000;
      await this.persist();
    }
  }
  /** Counts include away troops; marching a batch must never trigger replacement spending. */
  private async reconcileTraining(
    context: AdvisorContext,
    p: Pending,
  ): Promise<void> {
    if (p.action.type !== "train") return;
    const { unit, count } = p.action;
    const v = context.state.villages.find(
      (v) => v.id === p.proposal.villageId,
    )!;
    const queues = Object.values(v.training).flat();
    const owned = (v.units.home[unit] ?? 0) + (v.units.away[unit] ?? 0);
    if (p.phase === "accepted") {
      if (queues.some((q) => q.id === p.itemId)) return;
      const complete = owned >= p.proposal.currentLevel + count;
      this.record(
        complete ? "confirmed" : "cancelled",
        complete
          ? `${count} ${p.proposal.buildingName} completed training, confirmed by fresh server state.`
          : "Accepted training disappeared without its expected troops; cancellation or losses may have occurred.",
        p.proposal,
        p.action.clientId,
        context.state.world.tick,
      );
      if (complete && unit === "pikeman" && p.proposal.defenseBatch) {
        // Keep the original counts/baselines, independently of the completed operation.
        // Fresh policy checks still own funding, population, manual orders and the deadline.
        const { proposal, serverUrl, worldId, epoch, accountId } = p;
        this.saved.defenseComplements = [
          ...(this.saved.defenseComplements ?? []).filter(c => c.proposal.villageId !== proposal.villageId),
          { proposal: structuredClone(proposal), serverUrl, worldId, epoch, accountId },
        ];
      }
      this.clearOperation(p);
    } else if (
      owned !== p.proposal.currentLevel ||
      queues.some((q) => q.unit === unit)
    ) {
      // Observed changes cannot prove attribution, but must suppress a duplicate order.
      this.record(
        "uncertain",
        "Troops or training changed after an uncertain request; another actor may have acted. Do not replay this batch.",
        p.proposal,
        p.action.clientId,
        context.state.world.tick,
      );
      this.clearOperation(p);
    } else if (context.state.world.tick >= p.expiresTick) {
      this.automatic = false;
      this.backoffUntil = this.now() + 60000;
      this.record(
        "uncertain",
        "Training idempotency window expired. Automatic execution is paused; inspect activity before clearing this operation.",
        p.proposal,
        p.action.clientId,
        context.state.world.tick,
      );
    }
    await this.persist();
  }
  async cycle(): Promise<void> {
    if (this.busy || this.stopped || this.now() < this.backoffUntil) return;
    if (!this.saved.settings.apiKey) {
      this.view.connection = "unconfigured";
      return;
    }
    this.busy = true;
    const revision = this.revision;
    try {
      this.view.connection = this.view.account
        ? this.view.connection
        : "connecting";
      const { me, worlds } = await this.readMetadata();
      this.view.account = me.account;
      this.view.worlds = worlds;
      const context = await this.readJoinedContext(worlds, revision);
      this.view.connection = "connected";
      this.view.error = null;
      const scope = productionScope(
        this.settings.serverUrl,
        me.account.id,
        context.state,
      );
      let history: HistoryResponse = { samples: [] };
      if (this.saved.production?.scope !== scope) {
        try {
          history = await this.request<HistoryResponse>(
            this.settings,
            this.path("/history"),
          );
        } catch {}
      }
      this.saved.production = trackProduction(
        this.saved.production,
        scope,
        context.state,
        history.samples,
      );
      this.view.production = productionView(this.saved.production);
      await this.readScouting(context);
      await this.readConquest(context);
      await this.reconcile(context);
      this.plan(context);
      await this.persist();
      if (!this.automatic || revision !== this.revision || this.stopped) return;

      // Read state and live rules again immediately before sending: manual commands may have won the race.
      if (!this.view.selection.selected) return;
      const fresh = await this.readContext(true);
      this.saved.production = trackProduction(
        this.saved.production,
        productionScope(this.settings.serverUrl, me.account.id, fresh.state),
        fresh.state,
      );
      this.view.production = productionView(this.saved.production);
      await this.readScouting(fresh);
      await this.readConquest(fresh);
      await this.reconcile(fresh);
      this.plan(fresh);
      if (!this.automatic || revision !== this.revision || this.stopped) return;
      const selected = this.view.selection.selected;
      if (!selected) return;
      let pending = this.saved.pending;
      if (
        pending &&
        (pending.proposal.id !== selected.id ||
          fresh.state.world.tick >= pending.expiresTick)
      )
        return;
      if (!pending) {
        const ttl = Number(
          (fresh.rules.rules.LIMITS as { clientIdTtl?: number })?.clientIdTtl,
        );
        if (!Number.isFinite(ttl) || ttl <= 1)
          throw new Error(
            "Live idempotency TTL is unavailable; refusing to execute.",
          );
        pending = {
          proposal: selected,
          action: { ...selected.action, clientId: `econ-${randomUUID()}` },
          accountId: me.account.id,
          worldId: fresh.state.world.id,
          epoch: fresh.state.world.epoch,
          serverUrl: this.saved.settings.serverUrl,
          createdTick: fresh.state.world.tick,
          expiresTick: fresh.state.world.tick + ttl - 1,
          phase: "prepared",
          ...(selected.action.type === "send" && selected.action.units.scout === 2 ? { scout: {
            scope: this.scoutingScope(fresh.state), villageId: selected.villageId,
            targetId: selected.action.target,
            targetOwnerId: this.scouting!.map.villages.find(v => v.id === (selected.action.type === "send" ? selected.action.target : ""))!.ownerId!,
            sentTick: fresh.state.world.tick,
          } } : {}),
        };
        if(selected.advisor==='conquest'&&selected.action.type==='send')pending.conquest=true;
        if (selected.advisor!=='conquest'&&selected.action.type === "send" && (selected.action.units.raider === 10 || selected.action.units.lancer === 30)) {
          const observation = this.scouting!.observations.find(o => selected.id.endsWith(`:raid:${o.report?.id}`))!;
          pending.raid = { scope: this.scoutingScope(fresh.state), villageId: selected.villageId,
            targetId: selected.action.target, reportId: observation.report!.id, sentTick: fresh.state.world.tick };
        }
        this.saved.pending = pending;
        this.record(
          "prepared",
          `${selected.buildingName} target ${selected.targetLevel} prepared; journalling its request ID before any network write.`,
          selected,
          pending.action.clientId,
          fresh.state.world.tick,
        );
        await this.persist(); // Never POST unless its request ID is durably journalled.
      }
      if (!this.automatic || revision !== this.revision || this.stopped) return;
      try {
        pending.phase = "submitted";
        this.record(
          "submitted",
          `${pending.proposal.buildingName} target ${pending.proposal.targetLevel} handed to the API; awaiting its result.`,
          pending.proposal,
          pending.action.clientId,
          fresh.state.world.tick,
        );
        const response = await this.request<ActionsResponse>(
          this.settings,
          this.path("/actions"),
          {
            actions: [pending.action],
            returnState: true,
            note: `${pending.proposal.advisor} Advisor: ${pending.proposal.buildingName}; importance ${pending.proposal.importance}`,
          },
        );
        const result = response.results[0];
        if (!result)
          throw new RemoteError(
            0,
            5000,
            "Action response contained no result; outcome unknown.",
          );
        if (!result.ok) {
          this.record(
            "rejected",
            `${result.error.code}: ${result.error.message}`,
            selected,
            pending.action.clientId,
            response.tick,
          );
          this.saved.pending = null;
          this.backoffUntil =
            this.now() +
            Math.max(10000, Number(result.error.details?.retryAfterMs) || 0);
        } else if (pending.action.type === "send" && "command" in result.data) {
          const command = result.data.command;
          if(pending.conquest){
            if(command.kind!=='attack'||command.from.id!==pending.action.village||command.to.id!==pending.action.target||
              JSON.stringify(command.units)!==JSON.stringify(pending.action.units))throw new RemoteError(0,5000,'Unexpected conquest command; inspect activity.');
            pending.phase='accepted';pending.itemId=command.id;
            this.saved.conquest!.waves++;
            this.record('accepted',`Conquest wave ${this.saved.conquest!.waves} dispatched; arrival tick ${command.arrivalTick}.`,selected,pending.action.clientId,response.tick);
          } else if (pending.raid) {
            if (command.kind !== "attack" || command.from.id !== pending.action.village || command.to.id !== pending.action.target ||
                JSON.stringify(command.units) !== JSON.stringify(pending.action.units))
              throw new RemoteError(0, 5000, "Unexpected raid command result; inspect activity.");
            pending.phase = "accepted";
            pending.itemId = command.id;
            this.rememberRaid({ ...pending.raid, sentTick: command.sentTick });
            this.record("accepted", `${pending.action.units.lancer === 30 ? "Thirty Lancers" : "Ten Raiders"} dispatched as ${command.id}; arrival tick ${command.arrivalTick}. Await the matching battle report.`, selected, pending.action.clientId, response.tick);
          } else {
          if (command.kind !== "attack" || command.from.id !== pending.action.village || command.to.id !== pending.action.target ||
              command.units.scout !== 2 || Object.entries(command.units).some(([unit, count]) => unit !== "scout" && count > 0))
            throw new RemoteError(0, 5000, "Unexpected scouting command result; inspect activity.");
          pending.phase = "accepted";
          pending.itemId = command.id;
          if (pending.scout) {
            pending.scout.commandId = command.id;
            pending.scout.sentTick = command.sentTick;
            this.rememberScout(pending.scout);
          }
          this.record("accepted", `Two Scouts dispatched as ${command.id}; arrival tick ${command.arrivalTick}. Await the matching report.`, selected, pending.action.clientId, response.tick);
          }
        } else if (
          (pending.action.type === "build" && "item" in result.data) ||
          (pending.action.type === "train" && "batch" in result.data)
        ) {
          pending.phase = "accepted";
          pending.itemId =
            "item" in result.data
              ? result.data.item.id
              : "batch" in result.data
                ? result.data.batch.id
                : undefined;
          this.record(
            "accepted",
            `${selected.buildingName} target ${selected.targetLevel} accepted into ${pending.action.type === "train" ? "training" : "construction"} queue; completion is not confirmed yet.`,
            selected,
            pending.action.clientId,
            response.tick,
          );
        } else
          throw new RemoteError(
            0,
            5000,
            "Unexpected action result; inspect the game activity log.",
          );
        await this.persist();
      } catch (e) {
        const error =
          e instanceof RemoteError
            ? e
            : new RemoteError(
                0,
                5000,
                "Unexpected transport error; outcome is unknown.",
              );
        if (error.status && error.status < 500 && error.status !== 429) {
          this.saved.pending = null;
          this.record(
            "rejected",
            error.message,
            selected,
            pending.action.clientId,
          );
          if (error.status === 401 || error.status === 403)
            this.automatic = false;
        } else {
          pending.phase = "uncertain";
          this.record(
            "uncertain",
            error.message + " Revalidate before retrying the same request ID.",
            selected,
            pending.action.clientId,
          );
        }
        this.backoffUntil = this.now() + error.retryMs;
        await this.persist();
      }
    } catch (e) {
      this.view.connection = "error";
      this.view.error = e instanceof Error ? e.message : "Evaluation failed.";
      const delay = e instanceof RemoteError ? e.retryMs : 10000;
      this.backoffUntil = this.now() + delay;
      if (e instanceof RemoteError && (e.status === 401 || e.status === 403)) {
        this.automatic = false;
        await this.persist().catch(() => undefined);
      }
    } finally {
      this.busy = false;
    }
  }
}
