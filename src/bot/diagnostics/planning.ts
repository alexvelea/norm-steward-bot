import type { Action } from "../../shared/api.js";
import type { PlanEdge, PlanNode, TaskKey } from "../plan/graph.js";

export type TaskState = "ready" | "waiting" | "running" | "satisfied" | "idle" | "invalid" | "unavailable";

export interface PlanningBlocker {
  reasonCode: string;
  message?: string;
  nodeKey?: string;
}

export interface PlanningProgress {
  observed: number | null;
  goal: number | null;
}

export interface PlanningNodeState {
  key: string;
  kind: PlanNode["kind"];
  title: string;
  villageId: string | null;
  status: TaskState;
  progress: PlanningProgress;
  primaryBlocker: PlanningBlocker | null;
  candidates: string[];
  operations: string[];
  wake: number | null;
  /** False when the village's role is outside this node's roles. */
  applies?: false;
}

export interface PlanningCandidate {
  id: string;
  task: TaskKey;
  villageId: string;
  status: "ready" | "waiting" | "queued" | "not-needed";
  importance: number;
  reasonCode: string;
  blockers: string[];
  action: Action;
}

export type PlanningReservation =
  | { kind: "fundingGoal"; id: string; ownerId: string; villageId: string; goal: string; reasonCode: string }
  | { kind: "exclusiveSpending"; id: string; ownerId: string; villageId: string; excludes: TaskKey[]; reasonCode: string }
  | { kind: "uncertainCost"; id: string; ownerId: string; villageId: string; operationId: string; reasonCode: string };

export interface PlanningOperation {
  id: string;
  task: TaskKey;
  villageId: string;
  status: string;
  clientId: string | null;
  itemId: string | null;
}

export interface PlanningVillage {
  id: string;
  name: string;
  scope: string;
  role: "capital" | "economic";
  roleReason: string;
}

export interface PlanningAllocation {
  selectedCandidateId: string | null;
  reasonCode: string;
  excluded: { candidateId: string; reasonCode: string }[];
}

export interface PlanningMission {
  id: string;
  definition: string;
  nodeKey: string;
  villageId: string;
  status: string;
  phase: string | null;
  targetId: string | null;
  startedTick: number;
  memory: {
    escort?: number;
    waves: number;
    reason?: string;
    capturedTick?: number;
    lastBattleOutcome?: string;
  };
}

export interface PlanningProjection {
  version: 1;
  revision: number;
  scope: string;
  rulesVersion: number;
  observedTick: number;
  evaluatedAt: string;
  nodes: PlanningNodeState[];
  edges: readonly PlanEdge[];
  villages: PlanningVillage[];
  missions: PlanningMission[];
  candidates: PlanningCandidate[];
  allocation: PlanningAllocation;
  reservations: PlanningReservation[];
  operations: PlanningOperation[];
  wake: number | null;
}

export type PlanningNode = PlanNode;
