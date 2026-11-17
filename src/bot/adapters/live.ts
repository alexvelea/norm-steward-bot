import type { Settings } from "../../control/types.js";
import type { LiveAdapterCalls, WorldAdapter, WorldCapabilities, WorldObservation } from "./types.js";

export class LiveAdapter implements WorldAdapter {
  readonly #calls: LiveAdapterCalls;
  readonly #settings: () => Settings;

  constructor(settings: () => Settings, calls: LiveAdapterCalls) {
    this.#settings = settings;
    this.#calls = calls;
  }

  capabilities(): WorldCapabilities {
    return { clock: "realtime", canControlClock: false };
  }

  observe(signal: AbortSignal): Promise<WorldObservation> {
    return this.#calls.observe(this.#settings(), signal);
  }

  recoverMembership(signal: AbortSignal): Promise<unknown> {
    return this.#calls.recoverMembership(this.#settings(), signal);
  }

  submit(payload: unknown, signal: AbortSignal) {
    return this.#calls.submit(this.#settings(), payload, signal);
  }

  wait(milliseconds: number, signal: AbortSignal): Promise<void> {
    return this.#calls.wait(milliseconds, signal);
  }
}
