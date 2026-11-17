import type { ActionsResponse, RulesResponse, StateResponse } from "../../shared/api.js";
import type { Settings } from "../../control/types.js";

export interface WorldCapabilities {
  clock: "realtime" | "lockstep" | "paused-step" | "scripted";
  canControlClock: boolean;
}

export interface WorldObservation {
  state: StateResponse;
  rules: RulesResponse;
  scope: string;
  observedTick: number;
  observedAt: string;
  rulesVersion: number;
}

export interface WorldAdapter {
  capabilities(): WorldCapabilities;
  observe(signal: AbortSignal): Promise<WorldObservation>;
  recoverMembership(signal: AbortSignal): Promise<unknown>;
  submit(payload: unknown, signal: AbortSignal): Promise<ActionsResponse>;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export interface LiveAdapterCalls {
  observe(settings: Settings, signal: AbortSignal): Promise<WorldObservation>;
  recoverMembership(settings: Settings, signal: AbortSignal): Promise<unknown>;
  submit(settings: Settings, payload: unknown, signal: AbortSignal): Promise<ActionsResponse>;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}
