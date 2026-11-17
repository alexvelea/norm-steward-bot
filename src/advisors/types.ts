import type {
  Action,
  Resources,
  RulesResponse,
  StateResponse,
} from "../shared/api.js";
import type { TaskKey } from "../bot/plan/graph.js";
import type { CityRole } from "../bot/plan/graph.js";

export type CityRoles = ReadonlyMap<string, { role: CityRole; reason: string }>;

export interface AdvisorContext {
  state: StateResponse;
  rules: RulesResponse;
  activeProposals?: Proposal[];
  cityRoles?: CityRoles;
}
export type AdvisorAction = Extract<Action, { type: "build" | "train" | "send" | "trade" | "recall" }>;
export interface Proposal<A extends AdvisorAction = AdvisorAction> {
  id: string;
  task: TaskKey;
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
  requestRank?: number;
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
    (a.requestRank !== undefined && b.requestRank !== undefined ? a.requestRank - b.requestRank : 0) ||
    a.villageId.localeCompare(b.villageId) ||
    actionKey(a.action).localeCompare(actionKey(b.action))
  );
}

function actionKey(action: AdvisorAction): string {
  if (action.type === "build") return action.building;
  if (action.type === "train") return action.unit;
  if (action.type === "send") return action.target;
  if (action.type === "trade") return action.target;
  return action.home;
}
