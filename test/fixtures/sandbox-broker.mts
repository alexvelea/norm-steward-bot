import { createInterface } from 'node:readline';
import { Broker } from '../../scripts/sandbox/broker.js';

const directory = process.env.STEWARD_REVIEW_RUN!;
let tick = 0;
let clock = 100;
const state = () => ({ world: { id: 'offline', tick, status: 'paused', kind: 'sandbox', ownerId: 'owner' }, villages: [], brokerPid: process.pid,
  unexpectedEnv: ['STEWARD_KEY', 'API_KEY', 'NODE_OPTIONS', 'OPENAI_API_KEY'].filter(key => process.env[key] !== undefined) });
const broker = new Broker(directory, process.cwd(), async (path, body) => {
  if (path === '/me') return { account: { id: 'owner' } };
  if (path === '/sandboxes' || path === '/worlds/offline') return state().world;
  if (path.endsWith('/control')) { tick += body.ticks; return state(); }
  return state();
}, () => clock++, async () => {});
try {
  for await (const line of createInterface({ input: process.stdin })) {
    try { process.stdout.write(JSON.stringify({ ok: true, result: await broker.call(JSON.parse(line)) }) + '\n'); }
    catch (error) { process.stdout.write(JSON.stringify({ ok: false, error: String(error) }) + '\n'); }
  }
} finally { await broker.call({ op: 'cleanup' }); }
