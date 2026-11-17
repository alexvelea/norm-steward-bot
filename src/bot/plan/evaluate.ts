import type { AdvisorContext, Proposal } from "../../advisors/types.js";
import type { Pending } from "../../control/types.js";
import type {
  PlanningAllocation,
  PlanningBlocker,
  PlanningCandidate,
  PlanningCommitment,
  PlanningMission,
  PlanningNodeState,
  PlanningOperation,
  PlanningProjection,
  PlanningReservation,
  TaskState,
} from "../diagnostics/planning.js";
import { PLAN, type PlanNode } from "./graph.js";
import type { MissionInstance } from "../strategy/missions/conquest.js";
import type { StrategicCommitment } from "../strategy/commitments.js";

export interface PlanningMemory {
  missions: readonly MissionInstance[];
  commitments: readonly StrategicCommitment[];
  scope: string;
}

export interface PlanningInput {
  context: AdvisorContext;
  memory: PlanningMemory;
  candidates: readonly Proposal[];
  journal: readonly Pending[];
  evaluatedAt: string;
  selectedId: string | null;
  allocationReasonCode: string;
  reservations?: readonly PlanningReservation[];
  excludedCandidates?: readonly PlanningAllocation["excluded"][number][];
}

const resources = ["lumberyard", "quarry", "mine"] as const;
let planningRevision = 0;

function milestoneProgress(
  node: PlanNode,
  context: AdvisorContext,
  villageId: string,
  mission: MissionInstance | undefined,
): { observed: number | null; goal: number | null; satisfied: boolean } {
  if (node.predicateKey === "producers.minimum") {
    const goal = node.thresholds?.minimum ?? null;
    const village = context.state.villages.find(value => value.id === villageId);
    const observed = village
      ? Math.min(...resources.map(building => village.buildings[building]))
      : null;
    return { observed, goal, satisfied: observed !== null && goal !== null && observed >= goal };
  }
  if (node.key === "conquest.target-owned" || node.key === "conquest.first-achieved") {
    const observed = mission?.status === "completed" ? 1 : 0;
    return { observed, goal: 1, satisfied: observed === 1 };
  }
  return { observed: null, goal: null, satisfied: false };
}

function taskProgress(
  node: PlanNode,
  context: AdvisorContext,
  villageId: string,
  mission: MissionInstance | undefined,
  candidate: Proposal | undefined,
): { observed: number | null; goal: number | null; satisfied: boolean } {
  const village = context.state.villages.find(value => value.id === villageId);
  const predicate = node.predicateKey ?? "";
  let observed: number | null = null;
  if (predicate.startsWith("building.") && village) {
    const building = predicate.slice("building.".length) as keyof typeof village.buildings;
    observed = village.buildings[building];
  } else if (predicate === "troops.raider" && village) {
    observed = (village.units.home.raider ?? 0) + (village.units.away.raider ?? 0);
  } else if (predicate === "troops.envoy" && village) {
    observed = (village.units.home.envoy ?? 0) + (village.units.away.envoy ?? 0);
  } else if (predicate === "troops.lancer" && village) {
    observed = (village.units.home.lancer ?? 0) + (village.units.away.lancer ?? 0);
  } else if (node.key === "conquest.dispatch" && mission) {
    observed = mission.memory.waves;
  } else if (node.key === "defense.cohort" && village) {
    observed =
      (village.units.home.pikeman ?? 0) +
      (village.units.away.pikeman ?? 0) +
      (village.units.home.shieldman ?? 0) +
      (village.units.away.shieldman ?? 0);
  }
  const explicitLevel = node.thresholds?.level;
  const goal = explicitLevel ?? candidate?.targetLevel ?? null;
  return {
    observed,
    goal,
    satisfied: explicitLevel !== undefined && observed !== null && observed >= explicitLevel,
  };
}

function proposalStatus(proposal: Proposal): TaskState {
  if (proposal.status === "ready") return "ready";
  if (proposal.status === "waiting") return "waiting";
  if (proposal.status === "queued") return "running";
  return "idle";
}

function isRollupNode(node: PlanNode): boolean {
  return (
    node.kind === "objective" ||
    node.kind === "mission" ||
    node.kind === "group" ||
    (node.kind === "policy" && PLAN.edges.some(edge => edge.kind === "contains" && edge.from === node.key))
  );
}

function containedTaskKeys(nodeKey: string): string[] {
  const children = new Map<string, string[]>();
  for (const edge of PLAN.edges) {
    if (edge.kind === "contains") children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  }
  const nodes = new Map<string, PlanNode>();
  for (const node of PLAN.nodes) nodes.set(node.key, node);
  const result: string[] = [];
  const visit = (parent: string): void => {
    for (const childKey of children.get(parent) ?? []) {
      const child = nodes.get(childKey);
      if (!child || child.kind === "capability") continue;
      if (child.kind === "task" || child.kind === "milestone") result.push(child.key);
      else visit(child.key);
    }
  };
  visit(nodeKey);
  return result;
}

function firstUnmetPrerequisite(nodeKey: string, states: Map<string, PlanningNodeState>): string | undefined {
  return PLAN.edges.find(edge =>
    edge.kind === "requires" &&
    edge.to === nodeKey &&
    states.get(edge.from)?.status !== "satisfied"
  )?.from;
}

function rollupState(nodeKey: string, states: Map<string, PlanningNodeState>): {
  status: TaskState;
  primaryBlocker: PlanningBlocker | null;
} {
  const descendants = containedTaskKeys(nodeKey)
    .map(key => states.get(key))
    .filter((state): state is PlanningNodeState => state !== undefined);
  const waiting = descendants.find(state => state.status === "waiting");
  const primaryBlocker = waiting?.primaryBlocker
    ? { ...waiting.primaryBlocker, nodeKey: waiting.key }
    : null;
  if (descendants.some(state => state.status === "running")) return { status: "running", primaryBlocker };
  if (descendants.some(state => state.status === "ready")) return { status: "ready", primaryBlocker };
  if (waiting) return { status: "waiting", primaryBlocker };
  const goalStates = descendants.filter(state => state.progress.goal !== null);
  if (goalStates.length > 0 && goalStates.every(state => state.status === "satisfied")) {
    return { status: "satisfied", primaryBlocker: null };
  }
  return { status: "idle", primaryBlocker: null };
}

function planningMissions(missions: readonly MissionInstance[]): PlanningMission[] {
  return missions.map(mission => ({
    id: mission.id,
    definition: mission.definition,
    nodeKey: "first-conquest",
    villageId: mission.villageId,
    status: mission.status,
    phase: mission.phase ?? null,
    targetId: mission.targetId ?? null,
    startedTick: mission.startedTick,
    memory: {
      ...(mission.memory.escort === undefined ? {} : { escort: mission.memory.escort }),
      waves: mission.memory.waves,
      ...(mission.memory.reason === undefined ? {} : { reason: mission.memory.reason }),
      ...(mission.memory.capturedTick === undefined ? {} : { capturedTick: mission.memory.capturedTick }),
      ...(mission.memory.lastBattle?.outcome === undefined
        ? {}
        : { lastBattleOutcome: mission.memory.lastBattle.outcome }),
    },
  }));
}

function planningCommitments(commitments: readonly StrategicCommitment[]): PlanningCommitment[] {
  return commitments.map(commitment => ({
    id: commitment.id,
    kind: commitment.kind,
    nodeKey: "defense.cohort",
    villageId: commitment.villageId,
    targets: { ...commitment.targets },
    baselines: { ...commitment.baselines },
    createdTick: commitment.createdTick,
  }));
}

export function evaluatePlanning(input: PlanningInput): PlanningProjection {
  const { context, memory } = input;
  const candidates: PlanningCandidate[] = input.candidates.map(proposal => ({
    id: proposal.id,
    task: proposal.task,
    villageId: proposal.villageId,
    status: proposal.status,
    importance: proposal.importance,
    reasonCode: proposal.blockers[0] ?? (proposal.status === "ready" ? "CANDIDATE_READY" : proposal.status.toUpperCase()),
    blockers: [...proposal.blockers],
    action: proposal.action,
  }));
  const proposalById = new Map(input.candidates.map(proposal => [proposal.id, proposal]));
  const operations: PlanningOperation[] = input.journal.map(operation => ({
    id: operation.proposal.id,
    task: operation.proposal.task,
    villageId: operation.proposal.villageId,
    status: operation.phase,
    clientId: operation.action.clientId ?? null,
    itemId: operation.itemId ?? null,
  }));
  const villageStates = new Map<string, Map<string, PlanningNodeState>>();

  for (const village of context.state.villages) {
    const states = new Map<string, PlanningNodeState>();
    for (const node of PLAN.nodes) {
      if (node.kind === "capability") continue;
      const mission = memory.missions.find(value => value.villageId === village.id && value.definition === "firstConquest");
      const candidatesForNode = candidates.filter(candidate => candidate.task === node.key && candidate.villageId === village.id);
      const candidate = candidatesForNode[0] ? proposalById.get(candidatesForNode[0].id) : undefined;
      const operationsForNode = operations.filter(operation => operation.task === node.key && operation.villageId === village.id);
      const progress = node.kind === "milestone"
        ? milestoneProgress(node, context, village.id, mission)
        : node.kind === "task"
          ? taskProgress(node, context, village.id, mission, candidate)
          : { observed: null, goal: null, satisfied: false };
      let status: TaskState = "idle";
      let primaryBlocker: PlanningBlocker | null = null;

      if (node.key === "first-conquest" && node.kind === "mission") {
        if (!mission) primaryBlocker = { reasonCode: "MISSION_NOT_STARTED" };
        else if (mission.status === "completed") status = "satisfied";
        else if (mission.status === "failed" || mission.status === "cancelled" || mission.phase === "stopped") {
          status = "invalid";
          primaryBlocker = {
            reasonCode: mission.memory.reason ?? "MISSION_STOPPED",
            ...(mission.memory.reason === undefined ? {} : { message: mission.memory.reason }),
          };
        } else {
          status = "running";
        }
      } else if (isRollupNode(node)) {
        const rollup = rollupState(node.key, states);
        status = rollup.status;
        primaryBlocker = rollup.primaryBlocker;
      } else if (node.kind === "task") {
        if (progress.satisfied) status = "satisfied";
        else if (operationsForNode.length > 0) status = "running";
        else if (candidate) {
          status = proposalStatus(candidate);
          primaryBlocker = candidate.blockers[0] ? { reasonCode: candidate.blockers[0] } : null;
        } else {
          primaryBlocker = { reasonCode: "NO_NEED_THIS_CYCLE" };
        }
      } else if (node.kind === "milestone") {
        status = progress.satisfied ? "satisfied" : "waiting";
        if (!progress.satisfied) primaryBlocker = { reasonCode: "PROGRESS_BELOW_GOAL", nodeKey: node.key };
      }

      const wake = candidatesForNode
        .map(value => proposalById.get(value.id)?.affordableAtTick)
        .filter((value): value is number => value !== null && value !== undefined)
        .sort((a, b) => a - b)[0] ?? null;
      states.set(node.key, {
        key: node.key,
        kind: node.kind,
        title: node.title,
        villageId: village.id,
        status,
        progress: { observed: progress.observed, goal: progress.goal },
        primaryBlocker,
        candidates: candidatesForNode.map(value => value.id),
        operations: operationsForNode.map(value => value.id),
        wake,
      });
    }

    for (let pass = 0; pass <= PLAN.nodes.length; pass++) {
      const previous = [...states.values()].map(state => `${state.key}:${state.status}:${JSON.stringify(state.primaryBlocker)}`).join("|");
      for (const node of PLAN.nodes) {
        const state = states.get(node.key);
        if (!state || !isRollupNode(node)) continue;
        if (node.key === "first-conquest") {
          const mission = memory.missions.find(value => value.villageId === village.id && value.definition === "firstConquest");
          if (mission?.status === "active") state.primaryBlocker = rollupState(node.key, states).primaryBlocker;
          continue;
        }
        const rollup = rollupState(node.key, states);
        state.status = rollup.status;
        state.primaryBlocker = rollup.primaryBlocker;
      }
      for (const node of PLAN.nodes) {
        const state = states.get(node.key);
        if (!state || state.status === "satisfied" || state.status === "running" || state.status === "invalid" || state.candidates.length > 0) continue;
        const prerequisite = firstUnmetPrerequisite(node.key, states);
        if (prerequisite) {
          state.status = "waiting";
          state.primaryBlocker = { reasonCode: "REQUIRES_PREREQUISITE", nodeKey: prerequisite };
        }
      }
      const current = [...states.values()].map(state => `${state.key}:${state.status}:${JSON.stringify(state.primaryBlocker)}`).join("|");
      if (current === previous) break;
    }
    villageStates.set(village.id, states);
  }

  const nodes: PlanningNodeState[] = [];
  for (const node of PLAN.nodes) {
    if (node.kind === "capability") {
      nodes.push({
        key: node.key,
        kind: node.kind,
        title: node.title,
        villageId: null,
        status: "unavailable",
        progress: { observed: null, goal: null },
        primaryBlocker: { reasonCode: "CAPABILITY_UNAVAILABLE" },
        candidates: [],
        operations: [],
        wake: null,
      });
    } else {
      for (const village of context.state.villages) {
        const state = villageStates.get(village.id)?.get(node.key);
        if (state) nodes.push(state);
      }
    }
  }

  const selected = input.selectedId;
  const allocation: PlanningAllocation = {
    selectedCandidateId: selected,
    reasonCode: input.allocationReasonCode,
    excluded: [...(input.excludedCandidates ?? [])],
  };
  const reservations = [...(input.reservations ?? [])];
  for (const operation of input.journal) {
    if (operation.phase === "uncertain") reservations.push({
      kind: "uncertainCost",
      id: `uncertain:${operation.proposal.id}`,
      ownerId: operation.proposal.id,
      villageId: operation.proposal.villageId,
      operationId: operation.action.clientId ?? operation.proposal.id,
      reasonCode: "UNCERTAIN_OPERATION",
    });
  }
  const wake = nodes.map(node => node.wake).filter((value): value is number => value !== null).sort((a, b) => a - b)[0] ?? null;
  return {
    version: 1,
    revision: ++planningRevision,
    scope: memory.scope,
    rulesVersion: context.rules.version,
    observedTick: context.state.world.tick,
    evaluatedAt: input.evaluatedAt,
    nodes,
    edges: PLAN.edges,
    villages: context.state.villages.map(village => ({ id: village.id, name: village.name, scope: memory.scope })),
    candidates,
    allocation,
    reservations,
    operations,
    missions: planningMissions(memory.missions),
    commitments: planningCommitments(memory.commitments),
    wake,
  };
}
