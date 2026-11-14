import type {
  Action,
  Resources,
  RulesResponse,
  StateResponse,
} from "../shared/api.js";

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
  /** 0–39 unnecessary (not executed), 40–69 production, 70–89 protection/speed, 90–100 capacity. */
  importance: number;
  reason: string;
  requirements: Resources;
  blockers: string[];
  status: "ready" | "waiting" | "queued" | "not-needed";
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

export function compareProposals(a: Proposal, b: Proposal): number {
  return (
    Number(a.status === "not-needed") - Number(b.status === "not-needed") ||
    b.importance - a.importance ||
    a.villageId.localeCompare(b.villageId) ||
    a.action.building.localeCompare(b.action.building)
  );
}
