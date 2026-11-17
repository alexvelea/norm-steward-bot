import type { ActionsResponse } from "../../shared/api.js";
import type { WorldAdapter, WorldCapabilities, WorldObservation } from "./types.js";

export interface ScriptedStep {
  observation: WorldObservation;
  membership?: unknown;
  outcome?: ActionsResponse;
}

export class ScriptedAdapter implements WorldAdapter {
  readonly #steps: ScriptedStep[];
  readonly calls: string[] = [];
  #index = 0;

  constructor(steps: ScriptedStep[]) {
    this.#steps = structuredClone(steps);
  }

  capabilities(): WorldCapabilities {
    return { clock: "scripted", canControlClock: false };
  }

  async observe(signal: AbortSignal): Promise<WorldObservation> {
    if (signal.aborted) throw signal.reason;
    this.calls.push("observe");
    const step = this.#steps[this.#index];
    if (!step) throw new Error("Scripted observation sequence is exhausted.");
    return structuredClone(step.observation);
  }

  async recoverMembership(signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw signal.reason;
    this.calls.push("recoverMembership");
    return structuredClone(this.#steps[this.#index]?.membership ?? null);
  }

  async submit(_payload: unknown, signal: AbortSignal): Promise<ActionsResponse> {
    if (signal.aborted) throw signal.reason;
    this.calls.push("submit");
    const step = this.#steps[this.#index];
    if (!step?.outcome) throw new Error("Scripted action outcome is unavailable.");
    this.#index++;
    return structuredClone(step.outcome);
  }

  async wait(_milliseconds: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw signal.reason;
    this.calls.push("wait");
    this.#index++;
  }
}
