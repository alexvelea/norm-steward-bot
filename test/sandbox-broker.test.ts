import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Broker, HttpError, credentialTransport, fingerprint, type Transport } from '../scripts/review/sandbox-broker.js';
import { brokerEnvironment, SandboxConnection } from '../src/review/sandbox-client.js';

function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'sandbox-broker-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  let tick = 0, clock = 100, serial = 0;
  const delays: number[] = [];
  const calls: { path: string; body: any; method?: string }[] = [];
  const state = () => ({ world: { id: 'box', kind: 'sandbox', ownerId: 'owner', tick, status: 'paused' }, villages: [] });
  const api: Transport = async (path, body, method) => {
    calls.push({ path, body, method });
    if (path === '/me') return { account: { id: 'owner' } };
    if (path === '/sandboxes') return { ...state().world, id: ++serial === 1 ? 'box' : 'box' + serial };
    if (/^\/worlds\/box\d*$/.test(path)) return { ...state().world, id: path.slice(8) };
    if (path.endsWith('/control')) { const startingTick = tick; tick += body.ticks; return { ...state().world, tick: startingTick, status: 'running' }; }
    if (path.endsWith('/actions')) return { results: [{ ok: true }], state: state() };
    return state();
  };
  const make = (transport = api, pacing?: string) => new Broker(root, process.cwd(), transport, () => clock, async seconds => { delays.push(seconds); clock += seconds; }, pacing);
  return { root, api, calls, make, state, delays, now: () => clock };
}

test('broker refuses all unregistered live/foreign operations without HTTP', async t => {
  const f = fixture(t), broker = f.make();
  for (const op of ['join', 'read', 'query', 'act', 'step', 'delete']) await assert.rejects(broker.call({ op, world: 'blitz-1' }), /not created/);
  assert.equal(f.calls.length, 0);
  assert.equal((await broker.call({ op: 'cleanup' })).length, 0);
});

test('owned creation, cached ownership, stable IDs and durable receipts', async t => {
  const f = fixture(t), broker = f.make();
  await broker.call({ op: 'create' });
  await broker.call({ op: 'join', world: 'box' });
  for (const resource of ['state', 'rules', 'reports', 'log']) await broker.call({ op: 'read', world: 'box', resource });
  for (const suffix of ['/map', '/reports/report_1', '/simulate/battle']) await broker.call({ op: 'query', world: 'box', suffix });
  const request = { op: 'act', world: 'box', requestId: 'stable', actions: [{ type: 'build', building: 'farm', village: 'v' }] };
  await broker.call(request); await broker.call(request);
  assert.equal(f.calls.filter(c => c.path === '/worlds/box').length, 0);
  const actions = f.calls.filter(c => c.path.endsWith('/actions'));
  const expected = 'sbx-' + createHash('sha256').update('box:stable:0').digest('hex').slice(0, 32);
  assert.equal(actions[0].body.actions[0].clientId, expected);
  assert.deepEqual(actions[0].body, actions[1].body);
  await assert.rejects(broker.call({ ...request, actions: [{ ...request.actions[0], building: 'hall' }] }), /different actions/);
  assert.equal(f.calls.filter(c => c.path.endsWith('/actions')).length, 2);
  assert.equal((await broker.call({ op: 'step', world: 'box', ticks: 300 })).world.tick, 300);
  assert.equal(f.calls.filter(c => c.path.endsWith('/state')).length, 2);
  await broker.call({ op: 'delete', world: 'box' }); await broker.call({ op: 'delete', world: 'box' });
  const registry = JSON.parse(readFileSync(join(f.root, 'sandboxes.json'), 'utf8'));
  assert.equal(registry.worlds.box.deleted, true);
  assert.equal(statSync(join(f.root, 'sandboxes.json')).mode & 0o777, 0o600);
  const events = readFileSync(join(f.root, 'sandbox-events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  for (const op of ['create', 'join', 'act', 'step', 'delete']) assert.ok(events.some(e => e.op === op && e.ok && e.fingerprint === fingerprint(process.cwd())));
  assert.ok(events.some(e => e.op === 'act' && e.actionResults?.[0]?.ok));
});

test('guards cover query allowlist, action cardinality, horizons and step integers', async t => {
  const f = fixture(t), broker = f.make(); await broker.call({ op: 'create' });
  for (const request of [
    { op: 'query', suffix: '/actions' }, { op: 'query', suffix: '/reports/../actions' }, { op: 'query', suffix: '/map', body: {} },
    { op: 'read', resource: 'account' }, { op: 'act', requestId: 'x', actions: [] }, { op: 'act', requestId: 'x', actions: Array(9).fill({}) },
    { op: 'act', actions: [{}] }, ...[0, -1, 3601, 1.5].map(ticks => ({ op: 'step', ticks })), { op: 'unknown' },
  ]) await assert.rejects(broker.call({ world: 'box', ...request }));
  for (const durationTicks of [599, 10801, 600.1]) await assert.rejects(broker.call({ op: 'create', durationTicks }), /bounded/);
  await broker.call({ op: 'create' }); await assert.rejects(broker.call({ op: 'create' }), /Two running/);
  await broker.call({ op: 'cleanup' });
});

test('restarted registry verifies once, blocks foreign ownership and handles delete 404', async t => {
  const f = fixture(t); await f.make().call({ op: 'create' });
  const restarted = f.make(); await restarted.call({ op: 'read', world: 'box' }); await restarted.call({ op: 'read', world: 'box' });
  assert.equal(f.calls.filter(c => c.path === '/worlds/box').length, 1);
  const foreign = f.make(async () => ({ kind: 'sandbox', ownerId: 'foreign' }));
  await assert.rejects(foreign.call({ op: 'act', world: 'box', requestId: 'x', actions: [{}] }), /ownership/);
  const absent = f.make(async () => { throw new HttpError(404); });
  assert.deepEqual(await absent.call({ op: 'delete', world: 'box' }), { deleted: 'box' });
  assert.equal(JSON.parse(readFileSync(join(f.root, 'sandboxes.json'), 'utf8')).worlds.box.deleted, true);
});

test('foreign creation is refused and eight total creations remain the run limit', async t => {
  const f = fixture(t);
  await assert.rejects(f.make(async path => path === '/me' ? { account: { id: 'owner' } } : { id: 'live', kind: 'live', ownerId: 'owner' }).call({ op: 'create' }), /owner-created/);
  const broker = f.make();
  for (let n = 0; n < 8; n++) { await broker.call({ op: 'create' }); await broker.call({ op: 'cleanup' }); }
  await assert.rejects(broker.call({ op: 'create' }), /Eight sandbox/);
});

test('request digests match existing Python registries, including Unicode IDs', async t => {
  const f = fixture(t), broker = f.make(); await broker.call({ op: 'create' });
  const actions = [{ type: 'build', building: 'farm', village: 'cité' }];
  const digest = spawnSync('python3', ['-c', 'import json,hashlib,sys;print(hashlib.sha256(json.dumps(json.loads(sys.argv[1]),sort_keys=True).encode()).hexdigest())', JSON.stringify(actions)], { encoding: 'utf8' });
  assert.equal(digest.status, 0, digest.stderr);
  const path = join(f.root, 'sandboxes.json'); const registry = JSON.parse(readFileSync(path, 'utf8'));
  registry.requests['box:old'] = digest.stdout.trim(); writeFileSync(path, JSON.stringify(registry));
  await f.make().call({ op: 'act', world: 'box', requestId: 'old', actions });
});

test('403 invalidates cache and rechecks ownership; mismatched state is never returned', async t => {
  const f = fixture(t); let forbidden = false, foreign = false;
  const broker = f.make(async (path, body, method) => {
    if (path === '/worlds/box' && foreign) return { kind: 'sandbox', ownerId: 'foreign' };
    if (path.endsWith('/state') && forbidden) { foreign = true; throw new HttpError(403); }
    return f.api(path, body, method);
  });
  await broker.call({ op: 'create' }); forbidden = true;
  await assert.rejects(broker.call({ op: 'read', world: 'box' }), /403/);
  await assert.rejects(broker.call({ op: 'read', world: 'box' }), /ownership/);
  const mismatch = f.make(async (path, body, method) => path.endsWith('/state') ? { world: { id: 'live', kind: 'live', tick: 1 } } : f.api(path, body, method));
  await assert.rejects(mismatch.call({ op: 'read', world: 'box' }), /mismatch/);
  const controlMismatch = f.make(async (path, body, method) => path.endsWith('/control') ? { id: 'live', kind: 'live', tick: 1 } : f.api(path, body, method));
  await assert.rejects(controlMismatch.call({ op: 'step', world: 'box', ticks: 1 }), /mismatch/);
});

test('async step waits for scheduler then polls until paused at target', async t => {
  const f = fixture(t); let reads = 0;
  const broker = f.make(async (path, body, method) => {
    if (path.endsWith('/control')) return { ...f.state().world, status: 'running' };
    if (path.endsWith('/state')) return { ...f.state(), world: { ...f.state().world, tick: ++reads < 2 ? 150 : 300, status: reads === 2 ? 'running' : 'paused' } };
    return f.api(path, body, method);
  });
  await broker.call({ op: 'create' });
  assert.equal((await broker.call({ op: 'step', world: 'box', ticks: 300 })).world.tick, 300);
  assert.equal(reads, 3);
  assert.deepEqual(f.delays, [0.15, 0.05, 0.1]);
  const ended = f.make(async (path, body, method) => path.endsWith('/state') ? { world: { ...f.state().world, tick: 200, status: 'ended' } } : f.api(path, body, method));
  assert.equal((await ended.call({ op: 'step', world: 'box', ticks: 300 })).world.tick, 200);
  const stuck = f.make(async (path, body, method) => path.endsWith('/control') ? {} : f.api(path, body, method));
  await assert.rejects(stuck.call({ op: 'step', world: 'box', ticks: 300 }), /timed out/);
});

test('token buckets and Retry-After pace without real waits, including shared state', async t => {
  const f = fixture(t), broker = f.make(async () => ({}), join(f.root, 'pacing.json'));
  for (let n = 0; n < 55; n++) await broker.api('/state');
  assert.ok(Math.abs(f.now() - 100.5) < 0.000001);
  const restarted = f.make(async () => ({}), join(f.root, 'pacing.json'));
  await restarted.api('/state'); assert.ok(Math.abs(f.now() - 100.6) < 0.000001);
  let attempts = 0;
  const limited = f.make(async () => { if (++attempts === 1) throw new HttpError(429, '2'); return { ok: true }; });
  const before = f.now(); assert.deepEqual(await limited.api('/state'), { ok: true });
  assert.equal(attempts, 2); assert.ok(f.now() >= before + 2);
  let preciseAttempts = 0;
  const precise = f.make(async () => { if (++preciseAttempts === 1) throw new HttpError(429, '1', 125); return {}; });
  const preciseStart = f.now(); await precise.api('/state');
  assert.equal(f.now() - preciseStart, 0.125);
  await assert.rejects(f.make(async () => { throw new HttpError(429, '61'); }).api('/state'), /Rate limited for 61/);
  const writes = f.make(async () => ({})); const start = f.now();
  for (let n = 0; n < 70; n++) await writes.api('/actions', { actions: Array(8).fill({}) });
  assert.ok(Math.abs(f.now() - start - 60 / 62) < 0.000001);
  const calls = f.make(async () => ({})); const callStart = f.now();
  for (let n = 0; n < 105; n++) await calls.api('/control', {});
  assert.ok(Math.abs(f.now() - callStart - 0.1) < 0.000001);
});

test('pacing locks recover dead holders, expired live holders and incomplete old locks', async t => {
  const f = fixture(t), pacing = join(f.root, 'pacing.json'), lock = pacing + '.lock';
  const exited = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  assert.equal(exited.status, 0); const deadPid = Number(exited.stdout.trim());
  assert.throws(() => process.kill(deadPid, 0), { code: 'ESRCH' });
  for (const owner of [{ pid: deadPid, startedAt: Date.now() }, { pid: process.pid, startedAt: Date.now() - 12000 }, null]) {
    mkdirSync(lock);
    if (owner) writeFileSync(join(lock, 'owner.json'), JSON.stringify(owner));
    if (!owner) { const old = new Date(Date.now() - 12000); utimesSync(lock, old, old); }
    assert.deepEqual(await f.make(async () => ({ ok: true }), pacing).api('/state'), { ok: true });
    assert.equal(existsSync(lock), false);
  }
});

test('fresh live pacing locks are respected and throttle sleeps happen after release', async t => {
  const f = fixture(t), pacing = join(f.root, 'pacing.json'), lock = pacing + '.lock';
  mkdirSync(lock); const owner = { pid: process.pid, startedAt: Date.now(), token: 'other-holder' };
  writeFileSync(join(lock, 'owner.json'), JSON.stringify(owner));
  let clock = 100, waited = false;
  const broker = new Broker(f.root, process.cwd(), async () => ({}), () => clock, async seconds => {
    if (!waited) {
      assert.deepEqual(JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')), owner);
      rmSync(lock, { recursive: true }); waited = true;
    } else assert.equal(existsSync(lock), false);
    clock += seconds;
  }, pacing);
  for (let n = 0; n < 55; n++) await broker.api('/state');
  assert.ok(waited); assert.ok(Math.abs(clock - 100.51) < 0.000001); assert.equal(existsSync(lock), false);
});

test('credential transport preserves dashboard GET header without exposing credentials', async t => {
  const f = fixture(t); writeFileSync(join(f.root, 'control.json'), JSON.stringify({ settings: { apiKey: 'test-only-key', serverUrl: 'https://example.invalid' } }));
  const requests: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => { requests.push(init!); return new Response('{}'); });
  const api = credentialTransport(f.root); await api('/me'); await api('/join', {}); await api('/world', undefined, 'DELETE');
  assert.equal((requests[0].headers as any)['X-Steward-Client'], 'dashboard');
  assert.equal((requests[1].headers as any)['X-Steward-Client'], undefined);
  assert.equal((requests[2].headers as any)['X-Steward-Client'], undefined);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('test-only-key'); });
  await assert.rejects(api('/me'), error => !String(error).includes('test-only-key'));
});

test('persistent NDJSON child survives errors, serializes calls, scrubs env, closes and deletes', async t => {
  const f = fixture(t);
  const env = { ...process.env, STEWARD_REVIEW_RUN: f.root, STEWARD_KEY: 'not-a-real-key', API_KEY: 'not-a-real-key', OPENAI_API_KEY: 'not-a-real-key' };
  assert.equal(brokerEnvironment({ ...env, NODE_OPTIONS: '--trace-warnings' }).NODE_OPTIONS, undefined);
  const connection = new SandboxConnection(resolve('test/fixtures/sandbox-broker.mts'), env);
  try {
    await assert.rejects(connection.call({ op: 'read', world: 'live' }), /not created/);
    await connection.call({ op: 'create' });
    const rows = await Promise.all(Array.from({ length: 20 }, () => connection.call<any>({ op: 'step', world: 'offline', ticks: 1 })));
    assert.equal(new Set(rows.map(row => row.brokerPid)).size, 1);
    assert.deepEqual(rows.map(row => row.world.tick), Array.from({ length: 20 }, (_, i) => i + 1));
    assert.deepEqual(rows[0].unexpectedEnv, []);
  } finally { await connection.close(); }
  assert.equal(JSON.parse(readFileSync(join(f.root, 'sandboxes.json'), 'utf8')).worlds.offline.deleted, true);
  await assert.rejects(connection.call({ op: 'read', world: 'offline' }), /exited/);
});

test('credential transport extracts retryAfterMs and falls back for non-JSON errors', async t => {
  const f = fixture(t); writeFileSync(join(f.root, 'control.json'), JSON.stringify({ settings: { apiKey: 'test-only-key', serverUrl: 'https://example.invalid' } }));
  const responses = [
    new Response(JSON.stringify({ error: { details: { retryAfterMs: 125 } } }), { status: 429, headers: { 'Retry-After': '1' } }),
    new Response('upstream unavailable', { status: 429, headers: { 'Retry-After': '2' } }),
  ];
  t.mock.method(globalThis, 'fetch', async () => responses.shift()!);
  const api = credentialTransport(f.root);
  await assert.rejects(api('/state'), error => error instanceof HttpError && error.retryAfterMs === 125 && error.retryAfter === '1');
  await assert.rejects(api('/state'), error => error instanceof HttpError && error.retryAfterMs === undefined && error.retryAfter === '2');
});

test('per-action quota rejections remain visible in durable broker receipts', async t => {
  const f = fixture(t);
  const response = { results: [{ ok: false, error: { code: 'RATE_LIMITED', details: { retryAfterMs: 100 } } }] };
  const broker = f.make(async (path, body, method) => path.endsWith('/actions') ? response : f.api(path, body, method));
  await broker.call({ op: 'create' });
  const request = { op: 'act', world: 'box', requestId: 'quota-retry', actions: [{ type: 'build' }] };
  assert.deepEqual(await broker.call(request), response);
  assert.deepEqual(await broker.call(request), response);
  const entries = readFileSync(join(f.root, 'sandbox-events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(entries.filter(e => e.op === 'act').map(e => e.actionResults), [
    [{ ok: false, code: 'RATE_LIMITED' }], [{ ok: false, code: 'RATE_LIMITED' }],
  ]);
});

test('production entrypoint rejects foreign worlds and absent settings without credential exposure', async t => {
  const f = fixture(t); const run = join(f.root, 'run'); mkdirSync(run);
  const connection = new SandboxConnection(resolve('scripts/sandbox-broker.mts'), { PATH: process.env.PATH, HOME: process.env.HOME,
    STEWARD_REVIEW_RUN: run, STEWARD_REVIEW_DIR: f.root, STEWARD_CONTROL_DIR: join(f.root, 'missing-control') });
  try {
    await assert.rejects(connection.call({ op: 'read', world: 'blitz-1' }), /not created/);
    await assert.rejects(connection.call({ op: 'create' }), /settings unavailable/);
    assert.deepEqual(await connection.call({ op: 'cleanup' }), []);
  } finally { await connection.close(); }
});

test('TypeScript fingerprints match the retained Python review validator', () => {
  const result = spawnSync('python3', ['-c', "import sys;sys.path.insert(0,'scripts/review');from sandbox import fingerprint;print(fingerprint('.'))"], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), fingerprint(process.cwd()));
});
