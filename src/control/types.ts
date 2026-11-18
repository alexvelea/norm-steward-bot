import type {
  Action,
  MeResponse,
  StateResponse,
  WorldSummary,
} from "../shared/api.js";
import type { EconomicForecast } from "../advisors/economic.js";
import type { ProductionLedger, ProductionView } from "./production.js";
import type { Proposal, Selection } from "../advisors/types.js";
import type { MissionInstance } from "../bot/strategy/missions/conquest.js";
import type { PlanningProjection } from "../bot/diagnostics/planning.js";
export interface Settings {
  serverUrl: string;
  worldId: string;
  apiKey: string;
}
export interface Pending {
  proposal: Proposal;
  action: Extract<Action, { type: "build" | "train" | "send" | "trade" | "recall" }>;
  accountId: string;
  worldId: string;
  epoch: string;
  serverUrl: string;
  createdTick: number;
  expiresTick: number;
  phase: "prepared" | "submitted" | "uncertain" | "accepted";
  itemId?: string;
  missionId?: string;
}
export interface Decision {
  id: string;
  at: string;
  tick?: number;
  kind:
    | "recommendation"
    | "prepared"
    | "submitted"
    | "accepted"
    | "confirmed"
    | "rejected"
    | "waiting"
    | "uncertain"
    | "cancelled";
  text: string;
  proposalId?: string;
  clientId?: string;
}
export interface SavedControl {
  settings: Settings;
  pending: Pending | null;
  /** Accepted operations occupy independent game queues; only one write can be in flight. */
  active?: Pending[];
  decisions: Decision[];
  production?: ProductionLedger;
  missions?: MissionInstance[];
  /** Plan milestones reached and tasks handed off, per village, for one world scope. */
  reached?: { scope: string; villages: Record<string, string[]> };
  persistenceFault?: string;
  recoveryRequired?: string;
  /** Persisted execution preference; service restarts must not override an operator pause. */
  automatic?: boolean;
}
export interface ControlView {
  settings: Omit<Settings, "apiKey"> & {
    keyConfigured: boolean;
    keyHint: string;
  };
  automatic: boolean;
  busy: boolean;
  connection: "unconfigured" | "connecting" | "connected" | "error";
  error: string | null;
  lastEvaluatedAt: string | null;
  nextAttemptAt: string | null;
  account: MeResponse["account"] | null;
  worlds: WorldSummary[];
  world: WorldSummary | null;
  villages: { id: string; name: string; points: number }[];
  proposals: Proposal[];
  selection: Selection;
  decisions: Decision[];
  pending: Pending | null;
  /** Accepted operations occupy independent game queues; only one write can be in flight. */
  active?: Pending[];
  conflicts: string[];
  production: ProductionView | null;
  economicForecasts: EconomicForecast[];
  planning: PlanningProjection;
}
export type StateReader = () => Promise<StateResponse>;
