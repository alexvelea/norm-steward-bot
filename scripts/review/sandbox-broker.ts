import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, openSync, closeSync, fsyncSync, writeSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SANDBOX } from '../../src/rules/config.js';

export type Request = { op: string; world?: string; [key: string]: any };
export type Transport = (path: string, body?: any, method?: string) => Promise<any>;
export class HttpError extends Error {
  constructor(readonly status: number, readonly retryAfter = '1', readonly retryAfterMs?: number) { super(`Sandbox API returned HTTP ${status}`); }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function fingerprint(work: string) {
  const digest = createHash('sha256').update('norm-steward-source-fingerprint-v2\0');
  const walk = (folder: string): string[] => existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(folder, entry.name)) : entry.name.endsWith('.ts') ? [join(folder, entry.name)] : []) : [];
  for (const folder of ['src/advisors', 'src/control', 'src/bot', 'src/review']) for (const path of walk(join(work, folder)).sort()) digest.update(relative(work, path)).update('\0').update(readFileSync(path));
  return digest.digest('hex');
}
function atomic(path: string, value: unknown) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
}
function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(', ') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => canonical(key) + ': ' + canonical(value[key])).join(', ') + '}';
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}
export function credentialTransport(control: string): Transport {
  let settings: { apiKey: string; serverUrl: string } | undefined;
  return async (path, body, method) => {
    try { settings ??= JSON.parse(readFileSync(join(control, 'control.json'), 'utf8')).settings; }
    catch { throw new Error('Sandbox connection settings unavailable'); }
    const headers: Record<string, string> = { Authorization: 'Bearer ' + settings!.apiKey, 'Content-Type': 'application/json' };
    if (body == null && method == null) headers['X-Steward-Client'] = 'dashboard';
    let response: Response;
    try { response = await fetch(settings!.serverUrl + '/api/v1' + path, { method: method ?? (body == null ? 'GET' : 'POST'), headers, body: body == null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(body?.action === 'step' && body?.wait === true ? SANDBOX.stepWaitTimeoutMs + 5000 : 25000) }); }
    catch { throw new Error('Sandbox API connection failed'); }
    if (!response.ok) {
      let retryAfterMs: number | undefined;
      try { const data = await response.json() as { error?: { details?: { retryAfterMs?: number } } }; retryAfterMs = data.error?.details?.retryAfterMs; } catch {}
      throw new HttpError(response.status, response.headers.get('Retry-After') ?? '1', retryAfterMs);
    }
    const raw = await response.text();
    try { return raw ? JSON.parse(raw) : null; } catch { throw new Error('Sandbox API returned invalid JSON'); }
  };
}
export class Broker {
  private registry: { worlds: Record<string, any>; requests: Record<string, string> };
  private verified = new Map<string, any>();
  private buckets: Record<string, { tokens: number; at: number }> = {};
  private httpCalls = 0;
  private readonly path: string;
  private readonly sourceFingerprint: string;
  constructor(readonly directory: string, readonly work: string, private transport: Transport,
    private now = () => Date.now() / 1000, private sleep = (seconds: number) => new Promise<void>(r => setTimeout(r, seconds * 1000)), private pacingFile?: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 }); this.path = join(directory, 'sandboxes.json');
    this.registry = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : { worlds: {}, requests: {} };
    this.sourceFingerprint = fingerprint(work);
  }
  private async pace(body?: any, method?: string): Promise<void> {
    const lock = this.pacingFile && this.pacingFile + '.lock';
    const token = randomUUID();
    const ownsLock = () => {
      try { return JSON.parse(readFileSync(join(lock!, 'owner.json'), 'utf8')).token === token; }
      catch { return false; }
    };
    if (lock) {
      for (;;) {
        try {
          mkdirSync(lock, { mode: 0o700 });
          writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: Date.now(), token }), { mode: 0o600 });
          break;
        }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          try {
            const before = statSync(lock);
            let dead = false;
            let startedAt = before.mtimeMs;
            try {
              const owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'));
              if (Number.isFinite(owner.startedAt)) startedAt = Math.min(startedAt, owner.startedAt);
              if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
                try { process.kill(owner.pid, 0); }
                catch (error) { dead = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
              }
            } catch {}
            if (dead || Date.now() - startedAt > 10000) {
              const current = statSync(lock);
              if (current.ino === before.ino && current.mtimeMs === before.mtimeMs) rmSync(lock, { recursive: true, force: true });
              continue;
            }
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          await this.sleep(0.01);
        }
      }
    }
    let delay = 0;
    try {
      if (lock && !ownsLock()) return await this.pace(body, method);
      if (this.pacingFile && existsSync(this.pacingFile)) this.buckets = JSON.parse(readFileSync(this.pacingFile, 'utf8'));
      const now = this.now();
      const buckets: [string, number, number, number][] = body == null && method == null ? [['dashboard', SANDBOX.dashboardBurst, SANDBOX.dashboardPerSecond, 1]] : [['calls', SANDBOX.callBurst, SANDBOX.callsPerSecond, 1]];
      if (Array.isArray(body?.actions)) buckets.push(['actions', SANDBOX.actionBurst, SANDBOX.actionsPerSecond, body.actions.length]);
      for (const [key, capacity, rate, cost] of buckets) {
        const old = this.buckets[key] ?? { tokens: capacity, at: now };
        const tokens = Math.min(capacity, old.tokens + Math.max(0, now - old.at) * rate);
        delay = Math.max(delay, (cost - tokens) / rate); this.buckets[key] = { tokens: tokens - cost, at: now };
      }
      if (lock && !ownsLock()) return await this.pace(body, method);
      if (this.pacingFile) atomic(this.pacingFile, this.buckets);
    } finally { if (lock && ownsLock()) rmSync(lock, { recursive: true, force: true }); }
    if (delay > 0) await this.sleep(delay);
  }
  private save() { atomic(this.path, this.registry); }
  private record(op: string, world: string | undefined, extra: Record<string, any>) {
    const fd = openSync(join(this.directory, 'sandbox-events.jsonl'), 'a', 0o600);
    try { writeSync(fd, JSON.stringify({ at: this.now(), op, worldId: world ?? null, fingerprint: this.sourceFingerprint, ...extra }) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  }
  async api(path: string, body?: any, method?: string): Promise<any> {
    for (let attempt = 0; attempt < 6; attempt++) {
      await this.pace(body, method);
      try { this.httpCalls++; return await this.transport(path, body, method); }
      catch (error) {
        if (!(error instanceof HttpError) || error.status !== 429 || attempt === 5) throw error;
        const numeric = Number(error.retryAfter);
        const seconds = typeof error.retryAfterMs === 'number' && Number.isFinite(error.retryAfterMs) && error.retryAfterMs >= 0
          ? error.retryAfterMs / 1000
          : Math.max(1, Number.isFinite(numeric) ? numeric : (Date.parse(error.retryAfter) / 1000 - this.now()) || 1);
        this.record('rate-limit', undefined, { ok: false, retryAfterSeconds: seconds });
        if (seconds > 60) throw new Error(`Rate limited for ${seconds.toFixed(0)} seconds; preserve work and retry later`);
        await this.sleep(seconds);
      }
    }
  }
  private async verify(world: string, registered: any) {
    const info = await this.api('/worlds/' + encodeURIComponent(world));
    if (info?.kind !== 'sandbox' || info.ownerId !== registered.ownerId) { this.verified.delete(world); throw new Error('Sandbox ownership verification failed'); }
    this.verified.set(world, info); return info;
  }
  async call(request: Request): Promise<any> {
    const { op } = request; let world = request.world;
    const httpStart = this.httpCalls;
    let stepWaitIncomplete = false;
    try {
      if (op === 'create') {
        if (Object.keys(this.registry.worlds).length >= 8) throw new Error('Eight sandbox creations per review is the limit; finish this bounded experiment');
        if (Object.values(this.registry.worlds).filter(v => !v.deleted).length >= SANDBOX.perAccount) throw new Error('Sandbox per-account limit reached');
        const config = { name: 'review-' + randomUUID().slice(0, 8), seed: request.seed ?? 73421, durationTicks: request.durationTicks ?? 600, clock: 'lockstep', paused: true, houseBots: request.houseBots ?? { warden: 0, reaver: 0, sovereign: 0 } };
        if (!Number.isSafeInteger(config.durationTicks) || config.durationTicks < 600 || config.durationTicks > 10800) throw new Error('Use a bounded 600–10800 tick experiment');
        const me = (await this.api('/me')).account.id;
        const result = await this.api('/sandboxes', config);
        if (result?.kind !== 'sandbox' || result.ownerId !== me || typeof result.id !== 'string') throw new Error('Server did not return an owner-created sandbox');
        world = result.id; this.registry.worlds[world!] = { ownerId: me, deleted: false, config }; this.save(); this.verified.set(world!, result);
        this.record(op, world, { ok: true, config, httpCalls: this.httpCalls - httpStart }); return result;
      }
      if (op === 'cleanup') {
        const results = [];
        for (const [id, value] of Object.entries(this.registry.worlds)) if (!value.deleted) results.push(await this.call({ op: 'delete', world: id }));
        return results;
      }
      const registered = world && Object.hasOwn(this.registry.worlds, world) ? this.registry.worlds[world] : undefined;
      if (!registered || registered.deleted && op !== 'delete') throw new Error('World was not created by this run; live/foreign world access is refused');
      if (registered.deleted) { this.record(op, world, { ok: true, alreadyAbsent: true }); return { deleted: world }; }
      const id = encodeURIComponent(world!); const prefix = '/worlds/' + id;
      const info = this.verified.get(world!) ?? await this.verify(world!, registered);
      let result: any;
      if (op === 'join') result = await this.api(prefix + '/join', {});
      else if (op === 'read') {
        const resource = request.resource ?? 'state';
        if (!['state', 'rules', 'reports', 'log'].includes(resource)) throw new Error('Unknown sandbox read resource');
        result = await this.api(resource === 'log' ? '/sandboxes/' + id + '/log' : prefix + '/' + resource);
      } else if (op === 'query') {
        const suffix = request.suffix ?? '';
        if (!['/map', '/simulate/battle'].includes(suffix) && !/^\/reports\/[a-zA-Z0-9_-]+$/.test(suffix)) throw new Error('Unknown sandbox query');
        if (suffix !== '/simulate/battle' && request.body != null) throw new Error('Read query cannot have a body');
        result = await this.api(prefix + suffix, request.body);
      } else if (op === 'act') {
        const { actions, requestId } = request;
        if (!Array.isArray(actions) || actions.length < 1 || actions.length > 8) throw new Error('Supply 1–8 ordinary sandbox actions');
        if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 80) throw new Error('A stable requestId is required for action retries');
        const key = world + ':' + requestId; const digest = hash(canonical(actions));
        if (this.registry.requests[key] && this.registry.requests[key] !== digest) throw new Error('requestId reused with different actions');
        this.registry.requests[key] = digest; this.save();
        result = await this.api(prefix + '/actions', { actions: actions.map((action: any, i: number) => ({ ...action, clientId: 'sbx-' + hash(key + ':' + i).slice(0, 32) })), returnState: true });
      } else if (op === 'step') {
        const ticks = request.ticks;
        if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 3600) throw new Error('Step must be 1–3600 ticks');
        if (!Number.isFinite(info.tick)) info.tick = (await this.api(prefix + '/state')).world.tick;
        const target = info.tick + ticks;
        const response = await this.api('/sandboxes/' + id + '/control', { action: 'step', ticks, wait: true });
        const returnedWorld = response?.world ?? response;
        if (returnedWorld?.id && returnedWorld.id !== world || returnedWorld?.kind && returnedWorld.kind !== 'sandbox' || returnedWorld?.ownerId && returnedWorld.ownerId !== registered.ownerId) {
          this.verified.delete(world!); await this.verify(world!, registered); throw new Error('Sandbox response ownership mismatch');
        }
        if (!response?.world || !Number.isFinite(response.world.tick)) throw new Error('Waiting step returned invalid state');
        result = response;
        stepWaitIncomplete = result.world.tick < target && result.world.status !== 'ended';
        for (let poll = 0; result.world.tick < target && result.world.status !== 'ended'; poll++) {
          if (poll >= 150) throw new Error('Sandbox step timed out');
          await this.sleep(Math.min(0.5, 0.05 * 2 ** Math.min(poll, 4)));
          result = await this.api(prefix + '/state');
        }
      } else if (op === 'delete') {
        await this.api('/sandboxes/' + id, undefined, 'DELETE'); registered.deleted = true; this.save(); this.verified.delete(world!); result = { deleted: world };
      } else throw new Error('Unknown sandbox operation');
      const state = result?.state ?? result;
      if (state?.world?.id && state.world.id !== world || state?.world?.ownerId && state.world.ownerId !== registered.ownerId || state?.world?.kind && state.world.kind !== 'sandbox') {
        this.verified.delete(world!); await this.verify(world!, registered); throw new Error('Sandbox response ownership mismatch');
      }
      if (state?.world && Number.isFinite(state.world.tick)) info.tick = state.world.tick;
      this.record(op, world, { ok: true, httpCalls: this.httpCalls - httpStart, ...(op === 'step' ? { stepWaitIncomplete } : {}), worldTick: state?.world?.tick, worldStatus: state?.world?.status, requestId: request.requestId ?? null, ticks: request.ticks ?? null, actionTypes: (request.actions ?? []).map((a: any) => a.type), actionResults: (result?.results ?? []).map((r: any) => ({ ok: r.ok, code: r.error?.code ?? null })) });
      return result;
    } catch (error) {
      if (world && error instanceof HttpError && [403, 404].includes(error.status)) {
        this.verified.delete(world);
        if (op === 'delete' && error.status === 404 && this.registry.worlds[world]) {
          this.registry.worlds[world].deleted = true; this.save(); this.record(op, world, { ok: true, alreadyAbsent: true }); return { deleted: world };
        }
        try { await this.verify(world, this.registry.worlds[world]); } catch { this.verified.delete(world); }
      }
      this.record(op, world, { ok: false, error: error instanceof HttpError ? { kind: 'game-api', httpStatus: error.status } : { kind: 'broker', message: 'Sandbox operation failed: ' + (error instanceof Error ? error.message : 'unknown error').slice(0, 200) } });
      throw error;
    }
  }
}
