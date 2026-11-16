import type {
  Action,
  Resources,
  RulesResponse,
  StateResponse,
} from "../shared/api.js";

export interface AdvisorContext {
  state: StateResponse;
  rules: RulesResponse;
  activeProposals?: Proposal[];
}
export type AdvisorAction = Extract<Action, { type: "build" | "train" | "send" }>;
export interface Proposal<A extends AdvisorAction = AdvisorAction> {
  id: string;
  advisor: string;
  villageId: string;
  villageName: string;
  action: A;
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
  defenseBatch?: { pikemen: number; shieldmen: number; baselinePikemen: number; baselineShieldmen: number; ticks: number };
}
export interface Advisor {
  id: string;
  evaluate(context: AdvisorContext): Proposal[];
}
export interface Selection<A extends AdvisorAction = AdvisorAction> {
  selected: Proposal<A> | null;
  reason: string;
  reservations: { villageId: string; proposalId: string; reason: string }[];
}

export function compareProposals(a: Proposal, b: Proposal): number {
  return (
    Number(a.status === "not-needed") - Number(b.status === "not-needed") ||
    b.importance - a.importance ||
    a.villageId.localeCompare(b.villageId) ||
    (a.action.type === "build" ? a.action.building : a.action.type === "train" ? a.action.unit : a.action.target).localeCompare(
      b.action.type === "build" ? b.action.building : b.action.type === "train" ? b.action.unit : b.action.target
    )
  );
}
