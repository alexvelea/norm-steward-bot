import assert from "node:assert/strict";
import { test } from "node:test";
import { applyConquest, conquestScope } from "../src/advisors/conquest.js";
import { economicAdvisor, evaluateEconomy } from "../src/advisors/economic.js";
import { militaryAdvisor } from "../src/advisors/military.js";
import { allocateWithPresident } from "../src/bot/allocation/president.js";
import type { PlanningMemory } from "../src/bot/plan/evaluate.js";
import { evaluatePlanning } from "../src/bot/plan/evaluate.js";
import { PLAN, type TaskKey } from "../src/bot/plan/graph.js";
import type { StrategicCommitment } from "../src/bot/strategy/commitments.js";
import type { MissionInstance } from "../src/bot/strategy/missions/conquest.js";
import type { Proposal } from "../src/advisors/types.js";
import type { Pending } from "../src/control/types.js";
import type { PlanningNodeState, PlanningProjection } from "../src/bot/diagnostics/planning.js";
import { completeOpening, context } from "./control-fixtures.js";

function project(
  c = context(),
  options: {
    memory?: Partial<PlanningMemory>;
    candidates?: readonly Proposal[];
    journal?: readonly Pending[];
  } = {},
): PlanningProjection {
  return evaluatePlanning({
    context: c,
    memory: { missions: [], commitments: [], scope: "fixture", ...options.memory },
    candidates: options.candidates ?? [],
    journal: options.journal ?? [],
    evaluatedAt: "2026-11-14T00:00:00.000Z",
    selectedId: null,
    allocationReasonCode: "NO_ACTION_NEEDED",
  });
}

function node(projection: PlanningProjection, key: string, villageId = "v1"): PlanningNodeState {
  const found = projection.nodes.find(value => value.key === key && value.villageId === villageId);
  assert.ok(found, `missing ${key} for ${villageId}`);
  return found;
}

function setProducers(c: ReturnType<typeof context>, level: number): void {
  for (const village of c.state.villages) {
    village.buildings.lumberyard = level;
    village.buildings.quarry = level;
    village.buildings.mine = level;
  }
}

function candidate(
  task: TaskKey,
  overrides: Partial<Proposal> = {},
): Proposal {
  const source = economicAdvisor.evaluate(context())[0];
  assert.ok(source);
  return {
    ...source,
    id: `candidate-${task}`,
    task,
    villageId: "v1",
    status: "ready",
    blockers: [],
    targetLevel: 3,
    ...overrides,
  };
}

function pending(proposal: Proposal): Pending {
  return {
    proposal,
    action: { ...proposal.action, clientId: `client-${proposal.id}` } as Pending["action"],
    accountId: "p1",
    worldId: "test",
    epoch: "r1",
    serverUrl: "https://game.invalid",
    createdTick: 100,
    expiresTick: 200,
    phase: "accepted",
  };
}

function mission(
  status: MissionInstance["status"] = "active",
  reason?: string,
  phase: string = status,
): MissionInstance {
  return {
    id: "mission-1",
    incarnation: "incarnation-1",
    definition: "firstConquest",
    definitionVersion: 1,
    scope: "fixture",
    villageId: "v1",
    targetId: "target-1",
    status,
    phase,
    memory: { escort: 12, waves: 2, ...(reason === undefined ? {} : { reason }) },
    startedTick: 40,
  };
}

test("a: explicit level thresholds are goals and observed levels satisfy tasks", () => {
  const c = context();
  setProducers(c, 10);
  c.state.villages[0]!.buildings.barracks = 1;
  const barracks = node(project(c), "defense.barracks1");
  assert.equal(barracks.progress.goal, 1);
  assert.equal(barracks.progress.observed, 1);
  assert.equal(barracks.status, "satisfied");
});

test("b: tasks without level thresholds are continuous and idle without a candidate or operation", () => {
  const c = context();
  c.state.villages[0]!.buildings.farm = 100;
  const idle = node(project(c), "economy.farm");
  assert.equal(idle.status, "idle");
  assert.equal(idle.progress.observed, 100);
  assert.equal(idle.progress.goal, null);
  assert.deepEqual(idle.primaryBlocker, { reasonCode: "NO_NEED_THIS_CYCLE" });

  const ready = node(project(c, {
    candidates: [
      candidate("economy.farm", { id: "farm-top", targetLevel: 4 }),
      candidate("economy.farm", { id: "farm-next", targetLevel: 8 }),
    ],
  }), "economy.farm");
  assert.equal(ready.progress.goal, 4);
  assert.equal(ready.status, "ready");
});

test("c: requires edges gate candidate-free nodes; candidate blockers take precedence", () => {
  const c = context();
  c.state.villages[0]!.buildings.barracks = 0;
  const blocked = node(project(c), "defense.barracks1");
  assert.equal(blocked.status, "waiting");
  assert.deepEqual(blocked.primaryBlocker, {
    reasonCode: "REQUIRES_PREREQUISITE",
    nodeKey: "economy.producers.10",
  });

  const waitingCandidate = candidate("defense.barracks1", {
    status: "waiting",
    blockers: ["COUNCIL_COOLDOWN"],
  });
  const candidateState = node(project(c, { candidates: [waitingCandidate] }), "defense.barracks1");
  assert.equal(candidateState.status, "waiting");
  assert.deepEqual(candidateState.primaryBlocker, { reasonCode: "COUNCIL_COOLDOWN" });
});

test("d: an unmet milestone reports progress only after its prerequisites are satisfied", () => {
  const readyPrerequisite = context();
  setProducers(readyPrerequisite, 5);
  const progress = node(project(readyPrerequisite), "economy.producers.8");
  assert.equal(progress.status, "waiting");
  assert.deepEqual(progress.primaryBlocker, {
    reasonCode: "PROGRESS_BELOW_GOAL",
    nodeKey: "economy.producers.8",
  });

  const unmetPrerequisite = context();
  setProducers(unmetPrerequisite, 4);
  const prerequisite = node(project(unmetPrerequisite), "economy.producers.8");
  assert.equal(prerequisite.status, "waiting");
  assert.deepEqual(prerequisite.primaryBlocker, {
    reasonCode: "REQUIRES_PREREQUISITE",
    nodeKey: "economy.producers.5",
  });
});

test("e: rollups honor status precedence, descendant blockers, and goals", () => {
  const developed = context();
  setProducers(developed, 15);
  assert.equal(node(project(developed), "economy.producers").status, "satisfied");

  const c = context();
  const waiting = candidate("economy.lumberyard", { status: "waiting", blockers: ["NO_FUNDS"] });
  const waitingRollup = node(project(c, { candidates: [waiting] }), "economy.producers");
  assert.equal(waitingRollup.status, "waiting");
  assert.deepEqual(waitingRollup.primaryBlocker, {
    reasonCode: "NO_FUNDS",
    nodeKey: "economy.lumberyard",
  });

  const readyRollup = node(project(c, {
    candidates: [
      waiting,
      candidate("economy.quarry", { id: "quarry-ready", status: "ready" }),
    ],
  }), "economy.producers");
  assert.equal(readyRollup.status, "ready");

  const runningRollup = node(project(c, {
    candidates: [candidate("economy.quarry", { id: "quarry-ready", status: "ready" })],
    journal: [pending(candidate("economy.lumberyard"))],
  }), "economy.producers");
  assert.equal(runningRollup.status, "running");
  assert.equal(node(project(c, {
    journal: [pending(candidate("economy.lumberyard"))],
  }), "economy.lumberyard").progress.goal, null);

  const fundingPolicy = node(project(c, {
    candidates: [candidate("conquest.producer-investment", { status: "waiting", blockers: ["NO_FUNDS"] })],
  }), "conquest.producer-funding");
  assert.equal(fundingPolicy.status, "waiting");
  assert.deepEqual(fundingPolicy.primaryBlocker, {
    reasonCode: "NO_FUNDS",
    nodeKey: "conquest.producer-investment",
  });
});

test("f: first-conquest reflects mission start, completion, failure, cancellation, and active rollup", () => {
  const notStarted = node(project(), "first-conquest");
  assert.equal(notStarted.status, "idle");
  assert.deepEqual(notStarted.primaryBlocker, { reasonCode: "MISSION_NOT_STARTED" });

  const completed = node(project(context(), { memory: { missions: [mission("completed")] } }), "first-conquest");
  assert.equal(completed.status, "satisfied");

  const failed = node(project(context(), { memory: { missions: [mission("failed", "MISSION_STOPPED", "stopped")] } }), "first-conquest");
  assert.equal(failed.status, "invalid");
  assert.deepEqual(failed.primaryBlocker, { reasonCode: "MISSION_STOPPED", message: "MISSION_STOPPED" });

  const cancelled = node(project(context(), { memory: { missions: [mission("cancelled", "OWNER_CANCELLED", "cancelled")] } }), "first-conquest");
  assert.equal(cancelled.status, "invalid");
  assert.equal(cancelled.primaryBlocker?.reasonCode, "OWNER_CANCELLED");

  const active = node(project(context(), { memory: { missions: [mission()] } }), "first-conquest");
  assert.equal(active.status, "running");
});

test("g: every non-capability node is emitted per village; capabilities are account-wide", () => {
  const c = context();
  const secondVillage = structuredClone(c.state.villages[0]!);
  secondVillage.id = "v2";
  secondVillage.name = "Second Holding";
  c.state.villages.push(secondVillage);
  c.state.world.villages = 2;
  const projection = project(c);
  assert.deepEqual(
    projection.nodes.filter(value => value.key === "round").map(value => value.villageId),
    ["v1", "v2"],
  );
  assert.equal(projection.nodes.filter(value => value.kind === "capability").length, 4);
  assert.ok(projection.nodes.filter(value => value.kind === "capability").every(value => value.villageId === null));
});

test("h: planning revision increments on every evaluation", () => {
  const c = context();
  const first = project(c).revision;
  const second = project(c).revision;
  assert.equal(second, first + 1);
});

test("mission and cohort commitment memory are included in the projection", () => {
  const c = context();
  const conquest = {
    ...mission(),
    memory: {
      escort: 12,
      waves: 2,
      capturedTick: 39,
      lastBattle: { outcome: "won" } as NonNullable<MissionInstance["memory"]["lastBattle"]>,
    },
  };
  const proposal = candidate("defense.cohort");
  const commitment: StrategicCommitment = {
    id: "commitment-1",
    scope: "fixture",
    villageId: "v1",
    kind: "defenceCohort",
    targets: { pikemen: 3, shieldmen: 1 },
    baselines: { pikemen: 12, shieldmen: 4 },
    ownerTask: "defense.cohort",
    createdTick: 25,
    proposal,
    serverUrl: "https://game.invalid",
    worldId: "test",
    epoch: "r1",
    accountId: "p1",
  };
  const projection = project(c, {
    memory: { missions: [conquest], commitments: [commitment] },
  });
  assert.deepEqual(projection.missions, [{
    id: "mission-1",
    definition: "firstConquest",
    nodeKey: "first-conquest",
    villageId: "v1",
    status: "active",
    phase: "active",
    targetId: "target-1",
    startedTick: 40,
    memory: { escort: 12, waves: 2, capturedTick: 39, lastBattleOutcome: "won" },
  }]);
  assert.deepEqual(projection.commitments, [{
    id: "commitment-1",
    kind: "defenceCohort",
    nodeKey: "defense.cohort",
    villageId: "v1",
    targets: { pikemen: 3, shieldmen: 1 },
    baselines: { pikemen: 12, shieldmen: 4 },
    createdTick: 25,
  }]);
});

test("manual Court construction satisfies its prerequisite without bot history", () => {
  const c = context();
  c.state.villages[0]!.buildings.court = 1;
  const court = node(project(c), "conquest.court");
  assert.equal(court.status, "satisfied");
  assert.equal(court.progress.observed, 1);
  assert.equal(court.progress.goal, 1);
});

test("broad advisor and conquest proposals all map to task nodes in PLAN", () => {
  const opening = context();
  const developed = completeOpening(context());
  const conquestPlan = {
    scope: conquestScope("https://sandbox.invalid", "p1", developed),
    villageId: "v1",
    startedTick: 100,
    status: "preparing" as const,
    waves: 0,
  };
  const proposals = [
    ...economicAdvisor.evaluate(opening),
    ...militaryAdvisor.evaluate(opening),
    ...economicAdvisor.evaluate(developed),
    ...militaryAdvisor.evaluate(developed),
    ...applyConquest(developed, [], { plan: conquestPlan }),
  ];
  assert.ok(proposals.length > 0);
  const taskKeys = new Set(PLAN.nodes.filter(value => value.kind === "task").map(value => value.key));
  assert.ok(proposals.every(proposal => taskKeys.has(proposal.task)));
});

test("exclusive conquest spending records the constraint without blocking another village", () => {
  const source = evaluateEconomy(context())[0];
  assert.ok(source);
  if (source.action.type !== "build") throw new Error("Expected a construction proposal.");
  const origin = { ...source, id: "origin", status: "ready" as const, blockers: [] };
  const other = { ...origin, id: "other", villageId: "v2", action: { ...origin.action, village: "v2" } };
  const allocation = allocateWithPresident([origin, other], {
    activeConquest: { id: "mission", villageId: "v1", allowedTasks: ["conquest.dispatch"] },
  });
  assert.equal(allocation.selection.selected?.villageId, "v2");
  assert.equal(allocation.excluded.find(value => value.candidateId === "origin")?.reasonCode, "CONQUEST_EXCLUSIVE_SPENDING");
  assert.equal(allocation.reservations[0]?.kind, "exclusiveSpending");
});
