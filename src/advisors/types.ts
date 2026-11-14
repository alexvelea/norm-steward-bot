import type { Action, Resources, RulesResponse, StateResponse } from "../shared/api.js";

export interface AdvisorContext {
  state: StateResponse;
  rules: RulesResponse;
}
export interface Proposal {
  id: string;
  advisor: string;
  villageId: string;
  villageName: string;
  action: Extract<Action, { type: "build" }>;
  buildingName: string;
  currentLevel: number;
  targetLevel: number;
  /** 0–39 discretionary, 40–69 useful, 70–89 important/save, 90–100 urgent. */
  importance: number;
  reason: string;
  requirements: Resources;
  blockers: string[];
  status: "ready" | "waiting" | "queued";
  affordableAtTick: number | null;
}
export interface Advisor {
  id: string;
  evaluate(context: AdvisorContext): Proposal[];
}
export interface Selection {
  selected: Proposal | null;
  reason: string;
  reservations: { villageId: string; proposalId: string; reason: string }[];
}
