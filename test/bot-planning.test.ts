import assert from "node:assert/strict";
import { test } from "node:test";
import { applyConquest, conquestScope } from "../src/advisors/conquest.js";
import { economicAdvisor, evaluateEconomy } from "../src/advisors/economic.js";
import { evaluateEconomicCities } from "../src/advisors/economic-city.js";
import { logisticsAdvisor } from "../src/advisors/logistics.js";
import { militaryAdvisor } from "../src/advisors/military.js";
import { allocateWithPresident } from "../src/bot/allocation/president.js";
import type { PlanningMemory } from "../src/bot/plan/evaluate.js";
import { effectiveRoles, evaluatePlanning } from "../src/bot/plan/evaluate.js";
import { isTaskKey, PLAN, type TaskKey } from "../src/bot/plan/graph.js";
import type { MissionInstance } from "../src/bot/strategy/missions/conquest.js";
import { cityRoles, filterProposalsByRole } from "../src/bot/strategy/roles.js";
import type { AdvisorContext, Proposal } from "../src/advisors/types.js";
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
    memory: { missions: [], scope: "fixture", ...options.memory },
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

test("producer task copies report current levels against their separate targets", () => {
  const c = context();
  setProducers(c, 7);
  const projection = project(c);
  assert.deepEqual(node(projection, "econ.lumberyard").progress, { observed: 7, goal: 10 });
  assert.deepEqual(node(projection, "econ.lumberyard25").progress, { observed: 7, goal: 25 });
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
      candidate("economy.farm", {
        id: "farm-top",
        targetLevel: 4,
        action: {type: "build", village: "v1", building: "farm"},
      }),
      candidate("economy.farm", {
        id: "farm-next",
        targetLevel: 8,
        action: {type: "build", village: "v1", building: "farm"},
      }),
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
  const nearlyDeveloped = context();
  setProducers(nearlyDeveloped, 15);
  const level20 = node(project(nearlyDeveloped), "economy.producers.20");
  assert.equal(level20.status, "waiting");
  assert.deepEqual(level20.progress, { observed: 15, goal: 20 });

  const developed = context();
  setProducers(developed, 20);
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

test("f: expansion reflects mission start, completion, failure, cancellation, and active rollup", () => {
  const notStarted = node(project(), "expansion");
  assert.equal(notStarted.status, "idle");
  assert.deepEqual(notStarted.primaryBlocker, { reasonCode: "MISSION_NOT_STARTED" });

  const completedProjection = project(context(), { memory: { missions: [mission("completed")] } });
  assert.equal(node(completedProjection, "conquest.first-achieved").status, "satisfied");
  assert.notEqual(node(completedProjection, "expansion").status, "invalid");

  const failed = node(project(context(), { memory: { missions: [mission("failed", "MISSION_STOPPED", "stopped")] } }), "expansion");
  assert.equal(failed.status, "invalid");
  assert.deepEqual(failed.primaryBlocker, { reasonCode: "MISSION_STOPPED", message: "MISSION_STOPPED" });

  const cancelled = node(project(context(), { memory: { missions: [mission("cancelled", "OWNER_CANCELLED", "cancelled")] } }), "expansion");
  assert.equal(cancelled.status, "invalid");
  assert.equal(cancelled.primaryBlocker?.reasonCode, "OWNER_CANCELLED");

  const active = node(project(context(), { memory: { missions: [mission()] } }), "expansion");
  assert.equal(active.status, "running");
  assert.equal(node(project(context(), {
    memory: { missions: [{ ...mission(), definition: "conquest", sequence: 2 }] },
  }), "expansion.captured").status, "running");
  assert.equal(node(project(context(), {
    memory: { missions: [{ ...mission("completed"), definition: "conquest", sequence: 2 }] },
  }), "expansion.captured").status, "satisfied");
  const captured = node(project(context(), {
    memory: { missions: [{ ...mission("completed"), definition: "conquest", sequence: 2 }] },
  }), "expansion.captured");
  assert.equal(captured.progress.observed, 1);
  assert.equal(captured.progress.goal, null);
  assert.equal(node(project(context(), {
    memory: { missions: [mission("completed")] },
  }), "expansion.captured").status, "idle");
  const later = {
    ...mission("active"),
    id: "mission-2",
    definition: "conquest" as const,
    sequence: 2,
    startedTick: 80,
  };
  const history = project(context(), { memory: { missions: [mission("completed"), later] } });
  assert.equal(node(history, "conquest.first-achieved").status, "satisfied");
  assert.equal(node(history, "expansion").status, "running");
});

test("roles use the earliest owned conquest origin and fall back to the first village", () => {
  const c = context();
  const second = structuredClone(c.state.villages[0]!);
  second.id = "v2";
  second.resources = { timber: 500, stone: 500, iron: 500 };
  c.state.villages.push(second);
  const fallback = cityRoles(c, []);
  assert.equal(fallback.get("v1")?.role, "capital");
  assert.equal(fallback.get("v2")?.role, "economic");
  const roles = cityRoles(c, [
    { ...mission(), villageId: "v1", startedTick: 20 },
    { ...mission(), id: "later", villageId: "v2", startedTick: 30 },
  ]);
  assert.equal(roles.get("v1")?.role, "capital");
  c.state.villages = c.state.villages.filter(village => village.id !== "v1");
  assert.equal(cityRoles(c, [mission()]).get("v2")?.role, "capital");
});

test("role filtering keeps capital policy at the capital and economic-city work elsewhere", () => {
  const c = context();
  const second = structuredClone(c.state.villages[0]!);
  second.id = "v2";
  second.resources = { timber: 500, stone: 500, iron: 500 };
  c.state.villages.push(second);
  c.state.world.villages = 2;
  const roles = cityRoles(c, [mission()]);
  (c as AdvisorContext).cityRoles = roles;
  const proposals = [
    ...economicAdvisor.evaluate(c),
    ...militaryAdvisor.evaluate(c),
    ...evaluateEconomicCities(c),
    ...logisticsAdvisor.evaluate(c),
    candidate("conquest.court", { id: "economic-conquest", villageId: "v2" }),
  ];
  const filtered = filterProposalsByRole(proposals, roles, effectiveRoles);
  assert.ok(filtered.some(proposal => proposal.villageId === "v1"));
  assert.ok(filtered.some(proposal => proposal.villageId === "v2" && proposal.task.startsWith("econ.")));
  assert.ok(filtered.some(proposal => proposal.villageId === "v1" && proposal.task === "logistics.fulfil"));
  assert.ok(!filtered.some(proposal => proposal.villageId === "v1" && proposal.task.startsWith("econ.")));
  assert.ok(!filtered.some(proposal => proposal.villageId === "v2" &&
    (proposal.task.startsWith("economy.") || proposal.task.startsWith("defense.") || proposal.task.startsWith("conquest."))
  ));
  assert.ok(filtered.every(proposal =>
    !effectiveRoles(proposal.task) ||
    effectiveRoles(proposal.task)!.includes(roles.get(proposal.villageId)!.role)
  ));
  const projection = project(c, { memory: { missions: [mission()] } });
  assert.equal(node(projection, "military.wall-cap", "v2").applies, false);
  assert.equal(node(projection, "economy.hall", "v2").applies, false);
  assert.equal(node(projection, "expansion.next", "v2").applies, false);
  assert.notEqual(node(projection, "econ.cellar3", "v2").applies, false);
});

test("economic-city setup builds its next step, Farm or Storehouse unblocker, then only economic work", () => {
  const c = context();
  const economic = structuredClone(c.state.villages[0]!);
  economic.id = "v2";
  economic.name = "Harbor";
  c.state.villages.push(economic);
  c.state.world.villages = 2;
  (c as AdvisorContext).cityRoles = cityRoles(c, []);
  assert.equal(evaluateEconomicCities(c).length, 1);
  const first = evaluateEconomicCities(c)[0]!;
  assert.equal(first.task, "econ.cellar3");
  assert.equal(first.action.type, "build");
  assert.equal(first.importance, 85);

  economic.population = { used: 190, max: 200 };
  const farm = evaluateEconomicCities(c)[0]!;
  assert.equal(farm.task, "econ.farm");
  assert.equal(farm.importance, 95);
  economic.population = { used: 30, max: 200 };
  economic.storage = 1000;
  const storehouse = evaluateEconomicCities(c)[0]!;
  assert.equal(storehouse.task, "econ.storehouse");

  economic.storage = 10000;
  Object.assign(economic.buildings, { cellar: 10, hall: 13, storehouse: 3, lumberyard: 5, quarry: 5, mine: 5 });
  economic.options.build.find(option => option.building === "cellar")!.level = 11;
  economic.hidden = 100;
  economic.resources = { timber: 2000, stone: 1000, iron: 1500 };
  economic.resourcesMilli = { timber: 2000000, stone: 1000000, iron: 1500000 };
  const mature = evaluateEconomicCities(c);
  assert.ok(mature.some(proposal => proposal.task === "econ.cellar" && proposal.importance === 80));
  assert.ok(mature.some(proposal => proposal.task === "econ.market" && proposal.importance === 60));
  assert.ok(mature.every(proposal =>
    proposal.action.type === "build" &&
    !["barracks", "smithy", "stable", "wall"].includes(proposal.action.building)
  ));
  Object.assign(economic.buildings, { lumberyard: 4, quarry: 4, mine: 4 });
  economic.resourcesMilli = { timber: 10000000, stone: 10000000, iron: 10000000 };
  economic.production = { timber: 100, stone: 100, iron: 100 };
  economic.resources = { timber: 500, stone: 5000, iron: 5000 };
  const producerWork = evaluateEconomicCities(c).filter(proposal =>
    proposal.task === "econ.lumberyard" || proposal.task === "econ.quarry" || proposal.task === "econ.mine"
  );
  assert.ok(producerWork.length > 0);
  assert.ok(producerWork.every(proposal => proposal.advisor === "economic-city"));
  assert.ok(producerWork.some(proposal =>
    proposal.action.type === "build" &&
    proposal.action.building === "lumberyard" &&
    proposal.importance > 65
  ));

  economic.storage = 10000;
  economic.productionPerTickMilli = { timber: 30000, stone: 30000, iron: 30000 };
  c.state.trades.incoming.push({
    id: "incoming", seq: 1, from: { id: "v1" }, to: { id: "v2" },
    resources: { timber: 1000, stone: 0, iron: 0 }, merchants: 1,
    sentTick: 100, arrivalTick: 110, returning: false,
  } as any);
  assert.ok(evaluateEconomicCities(c).some(proposal =>
    proposal.task === "econ.storehouse" && proposal.importance === 90
  ));
  economic.storage = 1000;
  economic.population = { used: 190, max: 200 };
  assert.equal(evaluateEconomicCities(c)[0]?.task, "econ.farm");
  economic.population = { used: 30, max: 200 };
  assert.ok(evaluateEconomicCities(c).some(proposal =>
    proposal.task === "econ.storehouse" && proposal.importance === 95
  ));
});

test("economic-city build options preserve queue, affordability and round-end blockers", () => {
  const c = context();
  const economic = structuredClone(c.state.villages[0]!);
  economic.id = "v2";
  c.state.villages.push(economic);
  (c as AdvisorContext).cityRoles = cityRoles(c, []);
  const option = economic.options.build.find(value => value.building === "cellar")!;
  option.blockers = ["REQUIREMENTS_NOT_MET"];
  option.ticks = 100;
  economic.resourcesMilli = { timber: 0, stone: 0, iron: 0 };
  economic.buildQueue.push({
    id: "busy", building: "farm", level: 2, cost: { timber: 1, stone: 1, iron: 1 },
    startTick: 100, endTick: 110,
  });
  c.state.world.endsAtTick = 150;
  const proposal = evaluateEconomicCities(c).find(value => value.task === "econ.cellar3")!;
  assert.ok(proposal.blockers.includes("REQUIREMENTS_NOT_MET"));
  assert.ok(proposal.blockers.includes("BUILD_QUEUE_BUSY"));
  assert.ok(proposal.blockers.includes("INSUFFICIENT_RESOURCES"));
  assert.ok(proposal.blockers.includes("ROUND_END_TOO_SOON"));
});

test("economic-city Storehouse overflow survives conquest deduplication", () => {
  const c = context();
  const economic = structuredClone(c.state.villages[0]!);
  economic.id = "v2";
  economic.name = "Harbor";
  economic.storage = 5000;
  economic.resources = { timber: 10000, stone: 10000, iron: 10000 };
  economic.resourcesMilli = { timber: 10000000, stone: 10000000, iron: 10000000 };
  Object.assign(economic.buildings, {
    cellar: 10,
    hall: 13,
    storehouse: 3,
    lumberyard: 5,
    quarry: 5,
    mine: 5,
  });
  c.state.villages.push(economic);
  c.state.world.villages = 2;
  const roles = cityRoles(c, []);
  (c as AdvisorContext).cityRoles = roles;
  const proposals = [
    ...economicAdvisor.evaluate(c),
    ...evaluateEconomicCities(c),
  ];
  const capitalStorehouse = proposals.find(
    (proposal) =>
      proposal.villageId === economic.id &&
      proposal.task === "economy.storehouse" &&
      proposal.action.type === "build" &&
      proposal.action.building === "storehouse",
  );
  const economicStorehouse = proposals.find(
    (proposal) =>
      proposal.villageId === economic.id &&
      proposal.task === "econ.storehouse" &&
      proposal.action.type === "build" &&
      proposal.action.building === "storehouse",
  );
  assert.ok(capitalStorehouse);
  assert.ok(economicStorehouse);
  assert.ok(capitalStorehouse.importance > economicStorehouse.importance);

  const conquest = {
    plan: {
      scope: conquestScope("https://sandbox.invalid", "p1", c),
      villageId: "v1",
      startedTick: c.state.world.tick,
      status: "preparing" as const,
      waves: 0,
    },
  };
  const filteredAfterConquest = filterProposalsByRole(
    applyConquest(c, [...proposals], conquest),
    roles,
    effectiveRoles,
  );
  assert.ok(!filteredAfterConquest.some((proposal) => proposal.id === economicStorehouse.id));

  const allowed = filterProposalsByRole(proposals, roles, effectiveRoles);
  const afterConquest = applyConquest(c, allowed, conquest);
  assert.ok(afterConquest.some((proposal) => proposal.id === economicStorehouse.id));
  assert.ok(!afterConquest.some((proposal) => proposal.id === capitalStorehouse.id));
});

function economicCity(
  c: ReturnType<typeof context>,
  id: string,
  name: string,
  points: number,
) {
  const city = structuredClone(c.state.villages[0]!);
  city.id = id;
  city.name = name;
  city.points = points;
  city.storage = 5000;
  c.state.villages.push(city);
  return city;
}

function assignLogisticsRoles(
  c: ReturnType<typeof context>,
  cities: ReturnType<typeof economicCity>[],
) {
  const roles = new Map<
    string,
    { role: "capital" | "economic"; reason: string }
  >();
  roles.set(c.state.villages[0]!.id, { role: "capital", reason: "test" });
  for (const city of cities) {
    roles.set(city.id, { role: "economic", reason: "test" });
  }
  (c as AdvisorContext).cityRoles = roles;
}

test("logistics splits staged top-ups by resource and preserves request order", () => {
  const c = context();
  const capital = c.state.villages[0]!;
  const setup = economicCity(c, "v2", "Setup", 100);
  const growth = economicCity(c, "v3", "Growth", 200);
  const developed = economicCity(c, "v4", "Developed", 300);
  const lowerPointDeveloped = economicCity(c, "v5", "Lower Point Developed", 250);
  c.state.world.villages = 5;
  Object.assign(setup, {
    storage: 5000,
    resources: { timber: 500, stone: 1500, iron: 5000 },
  });
  Object.assign(growth.buildings, {
    cellar: 10,
    hall: 13,
    storehouse: 3,
    lumberyard: 4,
    quarry: 4,
    mine: 4,
  });
  growth.resources = { timber: 1999, stone: 2000, iron: 4000 };
  Object.assign(developed.buildings, {
    cellar: 10,
    hall: 13,
    storehouse: 3,
    lumberyard: 10,
    quarry: 10,
    mine: 10,
  });
  developed.resources = { timber: 1999, stone: 1999, iron: 4000 };
  Object.assign(lowerPointDeveloped.buildings, {
    cellar: 10,
    hall: 13,
    storehouse: 3,
    lumberyard: 10,
    quarry: 10,
    mine: 10,
  });
  lowerPointDeveloped.resources = { timber: 1999, stone: 1999, iron: 4000 };
  assignLogisticsRoles(c, [setup, growth, developed, lowerPointDeveloped]);
  capital.resourcesMilli = { timber: 10000000, stone: 10000000, iron: 10000000 };
  capital.merchants = { total: 1, available: 10 };
  c.state.trades.incoming.push({
    id: "inbound",
    seq: 1,
    from: { id: "v1" },
    to: { id: setup.id },
    resources: { timber: 200, stone: 0, iron: 0 },
    merchants: 1,
    sentTick: 100,
    arrivalTick: 110,
    returning: false,
  } as any);

  const proposals = logisticsAdvisor.evaluate(c);
  const trades = proposals.filter((proposal) => proposal.action.type === "trade");
  const findTrade = (target: string, resource: string) =>
    trades.find((proposal) =>
      proposal.action.type === "trade" &&
      proposal.action.target === target &&
      Object.keys(proposal.action.resources).join() === resource,
    )!;

  const setupTimber = findTrade("v2", "timber");
  assert.equal(setupTimber.importance, 95);
  assert.equal(setupTimber.id, "r1:v1:trade:v2:timber:1300");
  assert.equal(setupTimber.buildingName, "Trade timber to Setup");
  assert.deepEqual(
    setupTimber.action.type === "trade" ? setupTimber.action.resources : null,
    { timber: 1300 },
  );
  const growthTimber = findTrade("v3", "timber");
  assert.equal(growthTimber.importance, 85);
  assert.deepEqual(
    growthTimber.action.type === "trade" ? growthTimber.action.resources : null,
    { timber: 2001 },
  );
  const developedTimber = findTrade("v4", "timber");
  assert.equal(developedTimber.importance, 40);
  assert.deepEqual(
    developedTimber.action.type === "trade" ? developedTimber.action.resources : null,
    { timber: 2001 },
  );
  assert.deepEqual(
    trades.map((proposal) => proposal.requestRank),
    trades.map((_, index) => index),
  );
  assert.deepEqual(
    trades.map((proposal) =>
      proposal.action.type === "trade"
        ? `${proposal.action.target}:${Object.keys(proposal.action.resources).join()}`
        : "",
    ),
    [
      "v2:timber",
      "v3:timber",
      "v5:timber",
      "v5:stone",
      "v4:timber",
      "v4:stone",
    ],
  );
  assert.ok(proposals.some((proposal) => proposal.task === "logistics.market-growth"));
});

test("a capital short on stone can still request timber and iron", () => {
  const c = context();
  const capital = c.state.villages[0]!;
  const city = economicCity(c, "v2", "Harbor", 100);
  city.resources = { timber: 500, stone: 500, iron: 500 };
  assignLogisticsRoles(c, [city]);
  capital.resourcesMilli = { timber: 10000000, stone: 1000000, iron: 10000000 };
  capital.merchants = { total: 10, available: 10 };

  const proposals = logisticsAdvisor.evaluate(c).filter((proposal) =>
    proposal.action.type === "trade",
  );
  const tradeFor = (resource: string) =>
    proposals.find((proposal) =>
      proposal.action.type === "trade" &&
      Object.keys(proposal.action.resources).join() === resource,
    )!;
  assert.equal(tradeFor("timber").status, "ready");
  assert.equal(tradeFor("iron").status, "ready");
  assert.equal(tradeFor("stone").status, "waiting");
  assert.deepEqual(tradeFor("stone").blockers, ["INSUFFICIENT_RESOURCES"]);

  capital.merchants.available = 1;
  const shortMerchants = logisticsAdvisor.evaluate(c).find((proposal) =>
    proposal.action.type === "trade" &&
    proposal.action.target === city.id &&
    proposal.action.resources.timber,
  )!;
  assert.ok(shortMerchants.blockers.includes("NOT_ENOUGH_MERCHANTS"));
  capital.merchants.available = 10;
  c.state.player.nextActTick = c.state.world.tick + 1;
  const cooldown = logisticsAdvisor.evaluate(c).find((proposal) =>
    proposal.action.type === "trade" &&
    proposal.action.target === city.id &&
    proposal.action.resources.timber,
  )!;
  assert.ok(cooldown.blockers.includes("COUNCIL_COOLDOWN"));
});

test("outgoing and journal trades suppress only the matching resource request", () => {
  const c = context();
  const capital = c.state.villages[0]!;
  const city = economicCity(c, "v2", "Harbor", 100);
  city.resources = { timber: 500, stone: 500, iron: 500 };
  assignLogisticsRoles(c, [city]);
  capital.resourcesMilli = { timber: 10000000, stone: 10000000, iron: 10000000 };
  capital.merchants = { total: 10, available: 10 };
  c.state.trades.outgoing.push({
    id: "in-flight",
    seq: 1,
    from: { id: capital.id },
    to: { id: city.id },
    resources: { timber: 1, stone: 0, iron: 0 },
    merchants: 1,
    sentTick: c.state.world.tick,
    arrivalTick: c.state.world.tick + 10,
    returning: false,
  } as any);

  const outgoing = logisticsAdvisor.evaluate(c).filter((proposal) =>
    proposal.action.type === "trade",
  );
  assert.ok(!outgoing.some((proposal) =>
    proposal.action.type === "trade" && proposal.action.target === city.id &&
    proposal.action.resources.timber,
  ));
  assert.ok(outgoing.some((proposal) =>
    proposal.action.type === "trade" && proposal.action.resources.stone,
  ));
  const stoneTrade = outgoing.find((proposal) =>
    proposal.action.type === "trade" && proposal.action.resources.stone,
  )!;
  (c as AdvisorContext).activeProposals = [stoneTrade];
  c.state.trades.outgoing[0]!.returning = true;
  const journal = logisticsAdvisor.evaluate(c).filter((proposal) =>
    proposal.action.type === "trade",
  );
  assert.ok(journal.some((proposal) =>
    proposal.action.type === "trade" && proposal.action.resources.timber,
  ));
  assert.ok(!journal.some((proposal) =>
    proposal.action.type === "trade" && proposal.action.resources.stone,
  ));
  assert.ok(journal.some((proposal) =>
    proposal.action.type === "trade" && proposal.action.resources.iron,
  ));
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
  assert.equal(projection.nodes.filter(value => value.kind === "capability").length, PLAN.nodes.filter(value => value.kind === "capability").length);
  assert.ok(projection.nodes.filter(value => value.kind === "capability").every(value => value.villageId === null));
});

test("h: planning revision increments on every evaluation", () => {
  const c = context();
  const first = project(c).revision;
  const second = project(c).revision;
  assert.equal(second, first + 1);
});

test("mission memory is projected independently of retired cohort commitments", () => {
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
  const projection = project(c, {
    memory: { missions: [conquest] },
  });
  assert.deepEqual(projection.missions, [{
    id: "mission-1",
    definition: "firstConquest",
    nodeKey: "expansion",
    villageId: "v1",
    status: "active",
    phase: "active",
    targetId: "target-1",
    startedTick: 40,
    memory: { escort: 12, waves: 2, capturedTick: 39, lastBattleOutcome: "won" },
  }]);
});

test("each first and recurring mission projects under the expansion node", () => {
  const recurring: MissionInstance = {
    ...mission("active"),
    id: "recurring-2",
    incarnation: "recurring-2",
    definition: "conquest",
    sequence: 2,
    startedTick: 80,
  };
  const projection = project(context(), {
    memory: { missions: [mission("completed"), recurring] },
  });
  assert.deepEqual(projection.missions.map(value => value.nodeKey), ["expansion", "expansion"]);
  assert.deepEqual(projection.missions.map(value => value.definition), ["firstConquest", "conquest"]);
  assert.equal(node(projection, "expansion").status, "running");
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
  assert.ok(proposals.every(proposal => isTaskKey(proposal.task)));
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

test("economic-city producers stop at 10 before Wall 10 and use level-25 tasks afterward", () => {
  const c = context();
  const economic = structuredClone(c.state.villages[0]!);
  economic.id = "v2";
  Object.assign(economic.buildings, {
    cellar: 10, hall: 13, storehouse: 3, lumberyard: 10, quarry: 10, mine: 10, wall: 0,
  });
  economic.resourcesMilli = {timber: 100000000, stone: 100000000, iron: 100000000};
  economic.productionPerTickMilli = {timber: 100000, stone: 100000, iron: 100000};
  economic.resources = {timber: 50000, stone: 50000, iron: 50000};
  economic.storage = 100000;
  for (const building of ["lumberyard", "quarry", "mine", "wall"] as const) {
    const option = economic.options.build.find(value => value.building === building)!;
    option.level = 11;
    option.cost = {timber: 100, stone: 100, iron: 100};
    option.ok = true;
    option.blockers = [];
  }
  c.state.villages.push(economic);
  (c as AdvisorContext).cityRoles = new Map([
    ["v1", {role: "capital", reason: "fixture"}],
    ["v2", {role: "economic", reason: "fixture"}],
  ]);

  let proposals = evaluateEconomicCities(c).filter(value => value.villageId === "v2");
  assert.ok(proposals.some(value => value.task === "econ.wall10"));
  assert.ok(!proposals.some(value =>
    value.task === "econ.lumberyard" || value.task === "econ.quarry" || value.task === "econ.mine",
  ));

  economic.buildings.wall = 10;
  proposals = evaluateEconomicCities(c).filter(value => value.villageId === "v2");
  assert.ok(["econ.lumberyard25", "econ.quarry25", "econ.mine25"].every(task =>
    proposals.some(value => value.task === task),
  ));
});

test("economic-city Wall task builds its missing Barracks prerequisite first", () => {
  const c = context();
  const economic = structuredClone(c.state.villages[0]!);
  economic.id = "v2";
  Object.assign(economic.buildings, {
    cellar: 10, hall: 13, storehouse: 3, lumberyard: 10, quarry: 10, mine: 10,
    barracks: 0, wall: 1, market: 1,
  });
  economic.resourcesMilli = {timber: 100000000, stone: 100000000, iron: 100000000};
  economic.resources = {timber: 50000, stone: 50000, iron: 50000};
  economic.productionPerTickMilli = {timber: 100000, stone: 100000, iron: 100000};
  economic.storage = 100000;
  economic.hidden = 100000;
  for (const building of ["lumberyard", "quarry", "mine"] as const) {
    const option = economic.options.build.find(value => value.building === building)!;
    option.level = 11;
    option.cost = {timber: 100, stone: 100, iron: 100};
    option.ok = true;
    option.blockers = [];
  }
  const wall = economic.options.build.find(value => value.building === "wall")!;
  wall.level = 2;
  wall.cost = {timber: 100, stone: 100, iron: 100};
  wall.ok = true;
  wall.blockers = ["REQUIREMENTS_NOT_MET"];
  const barracks = economic.options.build.find(value => value.building === "barracks")!;
  barracks.level = 1;
  barracks.cost = {timber: 100, stone: 100, iron: 100};
  barracks.ok = true;
  barracks.blockers = [];
  c.state.villages.push(economic);
  (c as AdvisorContext).cityRoles = new Map([
    ["v1", {role: "capital", reason: "fixture"}],
    ["v2", {role: "economic", reason: "fixture"}],
  ]);

  let proposal = evaluateEconomicCities(c).find(value => value.task === "econ.wall10" && value.villageId === "v2")!;
  assert.equal(proposal.action.type, "build");
  if (proposal.action.type !== "build") throw new Error("Expected a building proposal.");
  assert.equal(proposal.action.building, "barracks");
  assert.equal(proposal.targetLevel, 1);
  assert.equal(proposal.importance, 75);
  assert.match(proposal.reason, /to unlock Wall/);

  economic.buildings.barracks = 1;
  wall.blockers = [];
  proposal = evaluateEconomicCities(c).find(value => value.task === "econ.wall10" && value.villageId === "v2")!;
  assert.equal(proposal.action.type, "build");
  if (proposal.action.type !== "build") throw new Error("Expected a building proposal.");
  assert.equal(proposal.action.building, "wall");
  assert.equal(proposal.targetLevel, 2);
});
