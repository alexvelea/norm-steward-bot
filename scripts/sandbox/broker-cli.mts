import { createInterface } from 'node:readline';
import { resolve, isAbsolute, relative, join } from 'node:path';
import { realpathSync } from 'node:fs';
import { Broker, credentialTransport } from './broker.js';

process.umask(0o077);
const run = realpathSync(resolve(process.env.STEWARD_REVIEW_RUN!));
const base = realpathSync(resolve(process.env.STEWARD_REVIEW_DIR ?? '/var/lib/norm-steward-review'));
const child = relative(base, run);
if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Run must be a private review subdirectory');
const broker = new Broker(run, process.cwd(), credentialTransport(process.env.STEWARD_CONTROL_DIR ?? '/var/lib/norm-steward-bot'), undefined, undefined, join(base, '.sandbox-pacing.json'));
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
process.stdout.on('error', () => lines.close());
process.on('SIGTERM', () => lines.close());
process.on('SIGINT', () => lines.close());
try {
  for await (const line of lines) {
    try { process.stdout.write(JSON.stringify({ ok: true, result: await broker.call(JSON.parse(line)) }) + '\n'); }
    catch (error) { process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Sandbox operation failed' }) + '\n'); }
  }
} finally {
  try { await broker.call({ op: 'cleanup' }); }
  catch { process.stderr.write('Owned sandbox cleanup needs retry; inspect sandbox-events.jsonl\n'); process.exitCode = 1; }
}
