/** A credential-free adapter to the managed owner-only sandbox broker. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  StateResponse,
  RulesResponse,
  WorldSummary,
  Action,
  ActionsResponse,
} from "../shared/api.js";
export function brokerEnvironment(env = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'TMPDIR', 'STEWARD_CONTROL_DIR', 'STEWARD_REVIEW_DIR', 'STEWARD_REVIEW_RUN', 'STEWARD_REVIEW_TOOLS']) if (env[key] !== undefined) clean[key] = env[key];
  return clean;
}
export class SandboxConnection {
  private child: ChildProcessWithoutNullStreams;
  private pending: { resolve: (value: any) => void; reject: (error: Error) => void }[] = [];
  private failed?: Error;
  private exited: Promise<void>;
  constructor(script = (process.env.STEWARD_REVIEW_TOOLS || '/root/norm-steward-bot') + '/scripts/sandbox-broker.mts', env = brokerEnvironment()) {
    this.child = spawn(process.execPath, ['--import', 'tsx', script], { env: brokerEnvironment(env), stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.resume();
    const fail = () => {
      this.failed = new Error('Sandbox broker exited; see sandbox-events.jsonl');
      for (const waiter of this.pending.splice(0)) waiter.reject(this.failed);
    };
    this.child.on('error', fail); this.child.stdin.on('error', fail);
    this.exited = new Promise(resolve => this.child.on('close', () => { fail(); resolve(); }));
    createInterface({ input: this.child.stdout }).on('line', line => {
      const waiter = this.pending.shift();
      if (!waiter) return;
      try { const response = JSON.parse(line); if (response.ok) waiter.resolve(response.result); else waiter.reject(new Error(response.error)); }
      catch { waiter.reject(new Error('Invalid sandbox broker response')); this.child.kill(); }
    });
    process.once('exit', this.onExit);
  }
  private onExit = () => { this.child.kill(); };
  call<T>(request: Record<string, unknown>): Promise<T> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      const line = JSON.stringify(request) + '\n';
      this.pending.push({ resolve, reject }); this.child.stdin.write(line);
    });
  }
  async close() {
    this.child.stdin.end();
    const timeout = setTimeout(() => this.child.kill('SIGKILL'), 30000);
    try { await this.exited; } finally { clearTimeout(timeout); process.removeListener('exit', this.onExit); }
  }
}
let connection: SandboxConnection | undefined;
export function sandbox<T>(request: Record<string, unknown>): Promise<T> { return (connection ??= new SandboxConnection()).call<T>(request); }
export async function shutdownSandbox() { if (connection) { await connection.close(); connection = undefined; } }
export class PrivateSandbox {
  private constructor(readonly world: WorldSummary) {}
  private sequence = 0;
  static async create(
    seed = 73421,
    durationTicks = 600,
    houseBots = { warden: 0, reaver: 0, sovereign: 0 },
  ) {
    return new PrivateSandbox(await sandbox<WorldSummary>({ op: "create", seed, durationTicks, houseBots }));
  }
  join() {
    return sandbox<StateResponse>({ op: "join", world: this.world.id });
  }
  state() {
    return sandbox<StateResponse>({
      op: "read",
      world: this.world.id,
      resource: "state",
    });
  }
  rules() {
    return sandbox<RulesResponse>({
      op: "read",
      world: this.world.id,
      resource: "rules",
    });
  }
  act(actions: Action[]) {
    return sandbox<ActionsResponse>({
      op: "act",
      world: this.world.id,
      requestId: `batch-${this.sequence++}`,
      actions,
    });
  }
  async step(ticks: number) {
    if (!Number.isSafeInteger(ticks) || ticks < 0) throw new Error("Invalid step ticks");
    if (ticks === 0) return this.state();
    let state: StateResponse;
    do {
      const count = Math.min(3600, ticks);
      state = await sandbox<StateResponse>({
        op: "step",
        world: this.world.id,
        ticks: count,
      });
      ticks -= count;
    } while (ticks > 0 && state.world.status !== "ended");
    return state;
  }
  close() {
    return sandbox({ op: "delete", world: this.world.id });
  }
}
