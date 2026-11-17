import type { ConquestPlan } from "../../../advisors/conquest.js";

export interface MissionInstance {
  id: string;
  incarnation: string;
  definition: "firstConquest" | "conquest";
  sequence?: number;
  definitionVersion: number;
  scope: string;
  villageId: string;
  targetId?: string;
  status: "active" | "completed" | "failed" | "cancelled";
  phase: string;
  memory: {
    escort?: number;
    waves: number;
    lastBattle?: ConquestPlan["lastBattle"];
    reason?: string;
    capturedTick?: number;
  };
  startedTick: number;
}

export function conquestMission(plan: ConquestPlan): MissionInstance {
  const sequence=plan.sequence??1;
  const recurring=sequence>=2;
  const id=recurring
    ? `${plan.scope}:conquest:${plan.villageId}:${plan.startedTick}`
    : `${plan.scope}:firstConquest:${plan.villageId}`;
  return {
    id,
    incarnation: recurring ? id : `${plan.scope}:firstConquest:${plan.startedTick}`,
    definition: recurring ? "conquest" : "firstConquest",
    sequence,
    definitionVersion: 1,
    scope: plan.scope,
    villageId: plan.villageId,
    ...(plan.targetId ? { targetId: plan.targetId } : {}),
    status: plan.status === "captured" ? "completed" : plan.status === "stopped" ? "failed" : "active",
    phase: plan.status,
    memory: { escort: plan.escort, waves: plan.waves, lastBattle: plan.lastBattle, reason: plan.reason, capturedTick: plan.capturedTick },
    startedTick: plan.startedTick,
  };
}

export function conquestPlan(mission: MissionInstance): ConquestPlan {
  return {
    scope: mission.scope,
    villageId: mission.villageId,
    sequence: mission.sequence ?? 1,
    startedTick: mission.startedTick,
    status: mission.status === "completed" ? "captured" : mission.status === "active" ? "preparing" : "stopped",
    targetId: mission.targetId,
    escort: mission.memory.escort,
    waves: mission.memory.waves,
    lastBattle: mission.memory.lastBattle,
    reason: mission.memory.reason,
    capturedTick: mission.memory.capturedTick,
  };
}
