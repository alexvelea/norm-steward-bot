import type { Pending, SavedControl, Settings, Decision } from "../../control/types.js";
import type { ConquestPlan } from "../../advisors/conquest.js";
import { proposalTask, isTaskKey } from "../plan/graph.js";
import type { ProductionLedger } from "../../control/production.js";
import type { StrategicCommitment } from "../strategy/commitments.js";
import { conquestMission, type MissionInstance } from "../strategy/missions/conquest.js";

export const CONTROL_STORE_VERSION = 2;
export const EXECUTION_JOURNAL_VERSION = 1;

export interface ControlStoreV2 {
  storeVersion: 2;
  settings: Settings;
  execution: {
    journalVersion: 1;
    automatic: boolean;
    pending: Pending | null;
    active: Pending[];
    decisions: Decision[];
    persistenceFault?: string;
  };
  strategy: {
    schema: 1;
    missions: MissionInstance[];
    commitments: StrategicCommitment[];
    production?: ProductionLedger;
  };
}

export function isControlStoreV2(value: unknown): value is ControlStoreV2 {
  if (!value || typeof value !== "object") return false;
  const store = value as Partial<ControlStoreV2>;
  return store.storeVersion === CONTROL_STORE_VERSION &&
    !!store.execution && store.execution.journalVersion === EXECUTION_JOURNAL_VERSION &&
    typeof store.execution.automatic === "boolean" &&
    Array.isArray(store.execution.decisions) &&
    !!store.strategy && store.strategy.schema === 1 &&
    Array.isArray(store.strategy.missions) && Array.isArray(store.strategy.commitments);
}

export class UnsupportedControlStoreError extends Error {
  constructor(readonly version: unknown) {
    super("Unsupported private control state version; recovery is required.");
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizePending(value: unknown, missionId?: string): Pending | null {
  if (value === null || value === undefined) return null;
  const pending = record(value);
  const proposal = record(pending?.proposal);
  if (!pending || !proposal || typeof proposal.id !== "string" || !record(proposal.action)) {
    throw new Error("Private control journal is invalid.");
  }
  const action = proposal.action as { type: string; building?: string; unit?: string };
  const task = typeof proposal.task === "string" && isTaskKey(proposal.task)
    ? proposal.task
    : proposalTask(
        typeof proposal.advisor === "string" ? proposal.advisor : "",
        action,
        typeof proposal.targetLevel === "number" ? proposal.targetLevel : 0,
      );
  const { scout: _scout, raid: _raid, conquest: legacyConquest, ...pendingFields } = pending;
  const { task: _task, ...proposalFields } = proposal;
  return {
    ...pendingFields,
    proposal: { ...proposalFields, task } as Pending["proposal"],
    ...(typeof pending.missionId === "string"
      ? { missionId: pending.missionId }
      : legacyConquest && missionId ? { missionId } : {}),
  } as Pending;
}

function isRemovedLegacySend(value: unknown): boolean {
  const pending=record(value),action=record(pending?.action),units=record(action?.units);
  if(action?.type!=="send"||pending?.conquest===true)return false;
  return !!pending?.scout||!!pending?.raid||Number(units?.scout)>0;
}

function removedSendDecision(value: unknown, index: number): Decision {
  const pending=record(value),proposal=record(pending?.proposal),action=record(pending?.action);
  return {
    id:`migration:removed-send:${String(action?.clientId??proposal?.id??index)}`,
    at:"1970-01-01T00:00:00.000Z",
    ...(typeof pending?.createdTick==="number"?{tick:pending.createdTick}:{}),
    kind:"cancelled",
    text:"Legacy scouting or raid send was cancelled during migration and will not be replayed.",
    ...(typeof proposal?.id==="string"?{proposalId:proposal.id}:{}),
    ...(typeof action?.clientId==="string"?{clientId:action.clientId}:{}),
  };
}

function migrateLegacy(value: Record<string, unknown>): SavedControl {
  const settings = record(value.settings);
  if (!settings || typeof settings.serverUrl !== "string" ||
      typeof settings.worldId !== "string" || typeof settings.apiKey !== "string") {
    throw new Error("Private control state is invalid.");
  }
  const rawConquest=record(value.conquest);
  if(rawConquest&&(
    typeof rawConquest.scope!=="string"||typeof rawConquest.villageId!=="string"||
    typeof rawConquest.startedTick!=="number"||!["preparing","captured","stopped"].includes(String(rawConquest.status))||
    typeof rawConquest.waves!=="number"
  ))throw new Error("Private mission state is invalid.");
  const legacyConquest = rawConquest as unknown as ConquestPlan | null;
  const missions = legacyConquest ? [conquestMission(legacyConquest)] : [];
  const missionId = missions[0]?.id;
  const decisions = Array.isArray(value.decisions) ? value.decisions as Decision[] : [];
  const cancelled:Decision[]=[];
  const pendingValue=value.pending;
  const pending=isRemovedLegacySend(pendingValue)
    ? (cancelled.push(removedSendDecision(pendingValue,0)),null)
    : normalizePending(pendingValue,missionId);
  const commitments = Array.isArray(value.defenseComplements)
    ? value.defenseComplements.flatMap(item => {
        const complement = record(item);
        const proposal = record(complement?.proposal);
        const batch = record(proposal?.defenseBatch);
        if (!complement || !proposal || !batch ||
            typeof proposal.id !== "string" || typeof proposal.villageId !== "string" ||
            typeof batch.baselinePikemen !== "number" || typeof batch.baselineShieldmen !== "number" ||
            typeof batch.pikemen !== "number" || typeof batch.shieldmen !== "number" ||
            typeof complement.serverUrl !== "string" || typeof complement.worldId !== "string" ||
            typeof complement.epoch !== "string" || typeof complement.accountId !== "string") return [];
        const action = record(proposal.action);
        if (!action) return [];
        const task = typeof proposal.task === "string" && isTaskKey(proposal.task)
          ? proposal.task
          : proposalTask(
              typeof proposal.advisor === "string" ? proposal.advisor : "military",
              action as { type: string; building?: string; unit?: string },
              typeof proposal.targetLevel === "number" ? proposal.targetLevel : 0,
            );
        const normalizedProposal = { ...proposal, task } as unknown as Pending["proposal"];
        const scope = `${complement.serverUrl}|${complement.accountId}|${complement.worldId}|${complement.epoch}`;
        return [{
          id: `${scope}:defenseCohort:${proposal.id}`,
          scope,
          villageId: proposal.villageId,
          kind: "defenceCohort" as const,
          targets: { pikemen: batch.pikemen, shieldmen: batch.shieldmen },
          baselines: { pikemen: batch.baselinePikemen, shieldmen: batch.baselineShieldmen },
          ownerTask: "defense.cohort" as const,
          createdTick: typeof proposal.createdTick === "number" ? proposal.createdTick : 0,
          proposal: normalizedProposal,
          serverUrl: complement.serverUrl,
          worldId: complement.worldId,
          epoch: complement.epoch,
          accountId: complement.accountId,
        }];
      })
    : [];
  const active = Array.isArray(value.active) ? value.active : [];
  const migratedActive=active.flatMap((item,index)=>{
    if(isRemovedLegacySend(item)){cancelled.push(removedSendDecision(item,index+1));return [];}
    const normalized=normalizePending(item,missionId);
    return normalized?[normalized]:[];
  });
  return {
    settings: settings as unknown as Settings,
    pending,
    active: migratedActive,
    decisions:[...cancelled,...decisions].slice(0,100),
    ...(value.production ? { production: value.production as SavedControl["production"] } : {}),
    ...(typeof value.automatic === "boolean" ? { automatic: value.automatic } : {}),
    missions,
    commitments,
  };
}

export function decodeControlStore(value: unknown): SavedControl {
  const store = record(value);
  if (!store) throw new Error("Private control state is invalid.");
  if ("storeVersion" in store) {
    if (store.storeVersion !== CONTROL_STORE_VERSION) {
      throw new UnsupportedControlStoreError(store.storeVersion);
    }
    const execution=record(store.execution);
    if (execution && execution.journalVersion !== EXECUTION_JOURNAL_VERSION) {
      throw new UnsupportedControlStoreError({storeVersion:store.storeVersion,journalVersion:execution.journalVersion});
    }
    const strategy=record(store.strategy);
    if (strategy && strategy.schema !== 1) {
      throw new UnsupportedControlStoreError({storeVersion:store.storeVersion,strategySchema:strategy.schema});
    }
    if (!isControlStoreV2(value)) throw new Error("Private control state is invalid.");
    return hydrateControlStore(value);
  }
  return migrateLegacy(store);
}

export function controlStore(value: SavedControl): ControlStoreV2 {
  return {
    storeVersion: CONTROL_STORE_VERSION,
    settings: value.settings,
    execution: {
      journalVersion: EXECUTION_JOURNAL_VERSION,
      automatic: value.automatic ?? true,
      pending: value.pending,
      active: value.active ?? [],
      decisions: value.decisions,
      ...(value.persistenceFault ? { persistenceFault: value.persistenceFault } : {}),
    },
    strategy: {
      schema: 1,
      missions: value.missions ?? [],
      commitments: value.commitments ?? [],
      ...(value.production ? { production: value.production } : {}),
    },
  };
}

export function hydrateControlStore(store: ControlStoreV2): SavedControl {
  return {
    settings: store.settings,
    pending: store.execution.pending,
    active: store.execution.active,
    decisions: store.execution.decisions,
    automatic: store.execution.automatic,
    missions: store.strategy.missions,
    commitments: store.strategy.commitments,
    production: store.strategy.production,
    persistenceFault: store.execution.persistenceFault,
  };
}
