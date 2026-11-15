/** A credential-free adapter to the managed owner-only sandbox broker. */
import { execFileSync } from "node:child_process";
import type {
  StateResponse,
  RulesResponse,
  WorldSummary,
  Action,
  ActionsResponse,
} from "../shared/api.js";
export function sandbox<T>(request: Record<string, unknown>): T {
  const tools = process.env.STEWARD_REVIEW_TOOLS || "/root/norm-steward-bot";
  try {
    return JSON.parse(
      execFileSync("python3", [tools + "/scripts/sandbox.py"], {
        input: JSON.stringify(request),
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: 45000,
      }),
    );
  } catch (error) {
    const output = (error as { stdout?: string }).stdout;
    throw new Error(
      output || "Sandbox broker failed; see sandbox-events.jsonl",
    );
  }
}
export class PrivateSandbox {
  readonly world: WorldSummary;
  private sequence = 0;
  constructor(
    seed = 73421,
    durationTicks = 600,
    houseBots = { warden: 0, reaver: 0, sovereign: 0 },
  ) {
    this.world = sandbox({ op: "create", seed, durationTicks, houseBots });
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
  step(ticks: number) {
    let state = this.state();
    while (ticks > 0 && state.world.status !== "ended") {
      const count = Math.min(3600, ticks);
      state = sandbox<StateResponse>({
        op: "step",
        world: this.world.id,
        ticks: count,
      });
      ticks -= count;
    }
    return state;
  }
  close() {
    return sandbox({ op: "delete", world: this.world.id });
  }
}
