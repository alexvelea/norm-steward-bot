import { PRODUCER_CEILING } from "../../advisors/defense-budget.js";

export type PlanNodeKind =
  | "objective"
  | "mission"
  | "group"
  | "task"
  | "milestone"
  | "policy"
  | "capability";

export type PlanScope = "account" | "village";

export interface PlanNode {
  key: string;
  kind: PlanNodeKind;
  title: string;
  summary: string;
  advisor?: string;
  scope?: PlanScope;
  predicateKey?: string;
  thresholds?: Readonly<Record<string, number>>;
}

export interface PlanEdge {
  from: string;
  to: string;
  kind: "contains" | "requires" | "contributesTo";
}

export interface PlanDefinition {
  nodes: readonly PlanNode[];
  edges: readonly PlanEdge[];
}

const producerLevels = { "5": 5, "8": 8, "10": 10, "15": 15, ceiling: PRODUCER_CEILING };

export const PLAN = {
  nodes: [
    { key: "round", kind: "objective", title: "Complete the round", summary: "Run the current policy in the selected world.", scope: "account" },
    { key: "economy", kind: "mission", title: "Develop the economy", summary: "Maintain capacity, protection, productive investment, and construction runway.", scope: "account" },
    { key: "economy.producers", kind: "group", title: "Resource producers", summary: "Develop lumberyard, quarry, and mine under the current producer policy.", scope: "village" },
    { key: "economy.lumberyard", kind: "task", title: "Lumberyard", summary: "Evaluate timber production and payback.", advisor: "economic", scope: "village", predicateKey: "building.lumberyard" },
    { key: "economy.quarry", kind: "task", title: "Quarry", summary: "Evaluate stone production and payback.", advisor: "economic", scope: "village", predicateKey: "building.quarry" },
    { key: "economy.mine", kind: "task", title: "Iron mine", summary: "Evaluate iron production and payback.", advisor: "economic", scope: "village", predicateKey: "building.mine" },
    { key: "economy.producers.5", kind: "milestone", title: "Producers at level 5", summary: "All three resource producers reach level 5.", scope: "village", predicateKey: "producers.minimum", thresholds: { minimum: producerLevels["5"] } },
    { key: "economy.producers.8", kind: "milestone", title: "Producers at level 8", summary: "All three resource producers reach level 8.", scope: "village", predicateKey: "producers.minimum", thresholds: { minimum: producerLevels["8"] } },
    { key: "economy.producers.10", kind: "milestone", title: "Producers at level 10", summary: "All three resource producers reach level 10.", scope: "village", predicateKey: "producers.minimum", thresholds: { minimum: producerLevels["10"] } },
    { key: "economy.producers.15", kind: "milestone", title: "Producers at level 15", summary: "All three resource producers reach level 15 for the first conquest transition.", scope: "village", predicateKey: "producers.minimum", thresholds: { minimum: producerLevels["15"] } },
    { key: "economy.capacity", kind: "group", title: "Capacity and protection", summary: "Protect resources and maintain population and storage capacity.", scope: "village" },
    { key: "economy.farm", kind: "task", title: "Farm capacity", summary: "Maintain the existing population and cohort runway.", advisor: "economic", scope: "village", predicateKey: "building.farm" },
    { key: "economy.storehouse", kind: "task", title: "Storehouse overflow", summary: "Prevent projected stock from exceeding storage.", advisor: "economic", scope: "village", predicateKey: "building.storehouse" },
    { key: "economy.farm-runway", kind: "policy", title: "Farm runway", summary: "Keep the existing farm buffer and cohort population runway.", scope: "village" },
    { key: "economy.cellar", kind: "task", title: "Cellar protection", summary: "Protect the existing 60-tick production threshold.", advisor: "economic", scope: "village", predicateKey: "building.cellar" },
    { key: "economy.hall", kind: "task", title: "Great Hall", summary: "Use the existing bounded construction payback comparison.", advisor: "economic", scope: "village", predicateKey: "building.hall" },
    { key: "economy.successor-window", kind: "policy", title: "Early-build successor window", summary: "Allow only the existing strict construction-successor window.", scope: "village", thresholds: { remainingRealSecondsExclusive: 10 } },
    { key: "economy.payback", kind: "policy", title: "Production payback", summary: "Keep the existing round-end production return test and ceiling.", scope: "village", thresholds: { producerCeiling: producerLevels.ceiling } },
    { key: "economy.round-end", kind: "policy", title: "Round-end completion", summary: "Keep current affordability, construction, and use deadlines.", scope: "village" },
    { key: "defense", kind: "mission", title: "Develop defence", summary: "Follow the existing defensive construction and cohort policy.", scope: "account" },
    { key: "defense.barracks1", kind: "task", title: "First Barracks", summary: "Build Barracks 1 when currently permitted.", advisor: "military", scope: "village", predicateKey: "building.barracks", thresholds: { level: 1 } },
    { key: "defense.smithy1", kind: "task", title: "Defensive Smithy", summary: "Unlock the first defensive Smithy under current prerequisites.", advisor: "military", scope: "village", predicateKey: "building.smithy", thresholds: { level: 1 } },
    { key: "defense.development", kind: "task", title: "Military development work", summary: "Fund intermediate military development steps under current prerequisites.", advisor: "military", scope: "village", predicateKey: "military.development" },
    { key: "defense.barracks3", kind: "task", title: "Barracks 3", summary: "Develop Barracks through the existing level-3 milestone.", advisor: "military", scope: "village", predicateKey: "building.barracks", thresholds: { level: 3 } },
    { key: "defense.stable3", kind: "task", title: "Stable 3", summary: "Complete the existing Stable level-3 development milestone.", advisor: "military", scope: "village", predicateKey: "building.stable", thresholds: { level: 3 } },
    { key: "defense.walls", kind: "task", title: "Walls", summary: "Evaluate the existing wall policy.", advisor: "military", scope: "village", predicateKey: "building.wall" },
    { key: "defense.cavalry", kind: "task", title: "Bounded cavalry force", summary: "Train the existing bounded Lancer force without movement policy.", advisor: "military", scope: "village", predicateKey: "troops.lancer" },
    { key: "defense.cohort", kind: "task", title: "Sustained 3Pi1Sh cohort", summary: "Maintain the persisted paid cohort obligation and existing loss rules.", advisor: "military", scope: "village", predicateKey: "troops.defense-cohort" },
    { key: "defense.imminent-attack", kind: "policy", title: "Imminent-attack deferral", summary: "Keep current attack handling and Hall deferral behavior.", scope: "village", thresholds: { hallDeferralTicks: 300 } },
    { key: "first-conquest", kind: "mission", title: "First conquest", summary: "Persist the bounded first-conquest transition and stop/capture evidence.", scope: "account", thresholds: { originVillages: 1, homePikemen: 150, standingOrders: 0 } },
    { key: "conquest.infrastructure", kind: "group", title: "Conquest infrastructure", summary: "Complete current building requirements and ordinary capacity prerequisites.", scope: "village" },
    { key: "conquest.hall13", kind: "task", title: "Great Hall 13", summary: "Build the conquest Hall requirement.", advisor: "conquest", scope: "village", predicateKey: "building.hall", thresholds: { level: 13 } },
    { key: "conquest.barracks10", kind: "task", title: "Barracks 10", summary: "Build the conquest Barracks requirement.", advisor: "conquest", scope: "village", predicateKey: "building.barracks", thresholds: { level: 10 } },
    { key: "conquest.smithy10", kind: "task", title: "Smithy 10", summary: "Build the conquest Smithy requirement.", advisor: "conquest", scope: "village", predicateKey: "building.smithy", thresholds: { level: 10 } },
    { key: "conquest.market5", kind: "task", title: "Market 5", summary: "Build the conquest Market requirement.", advisor: "conquest", scope: "village", predicateKey: "building.market", thresholds: { level: 5 } },
    { key: "conquest.court", kind: "task", title: "Court", summary: "Build the next conquest building returned by current rules.", advisor: "conquest", scope: "village", predicateKey: "building.court", thresholds: { level: 1 } },
    { key: "conquest.capacity", kind: "task", title: "Conquest capacity prerequisite", summary: "Fund farm and storage capacity as ordinary paid prerequisites.", advisor: "conquest", scope: "village", predicateKey: "capacity.conquest" },
    { key: "conquest.producer-funding", kind: "policy", title: "Producer funding fallback", summary: "Compare the existing bounded producer investment against saving for the next conquest building.", scope: "village" },
    { key: "conquest.producer-investment", kind: "task", title: "Conquest producer investment", summary: "Build the selected producer when the bounded funding fallback applies.", advisor: "conquest", scope: "village", predicateKey: "producer.funding" },
    { key: "conquest.escort", kind: "task", title: "Prepare Raider escort", summary: "Prepare the simulated bounded escort without replacing surviving waves.", advisor: "conquest", scope: "village", predicateKey: "troops.raider" },
    { key: "conquest.envoy", kind: "task", title: "Prepare Envoy", summary: "Prepare one reusable Envoy for the bounded mission.", advisor: "conquest", scope: "village", predicateKey: "troops.envoy", thresholds: { count: 1 } },
    { key: "conquest.dispatch", kind: "task", title: "Dispatch conquest wave", summary: "Recheck ownership and simulation before each of at most six waves.", advisor: "conquest", scope: "village", predicateKey: "conquest.dispatch", thresholds: { maximumWaves: 6 } },
    { key: "conquest.target-owned", kind: "milestone", title: "Target owned", summary: "Fresh village ownership completes the mission regardless of final response attribution.", scope: "account", predicateKey: "village.target-owned" },
    { key: "conquest.first-achieved", kind: "milestone", title: "First conquest achieved", summary: "Retain evidence for the completed first conquest.", scope: "account", predicateKey: "history.first-conquest" },
    { key: "capability.parallel-budgets", kind: "capability", title: "Parallel mission budgets", summary: "Unavailable: no cross-mission parallel budget allocator.", scope: "account" },
    { key: "capability.multi-submit", kind: "capability", title: "Multiple submissions per cycle", summary: "Unavailable: one authorized submission per cycle remains.", scope: "account" },
    { key: "capability.satellite-roles", kind: "capability", title: "Satellite roles", summary: "Unavailable: no separate satellite role policy.", scope: "account" },
    { key: "capability.logistics", kind: "capability", title: "Resource logistics", summary: "Unavailable: resource transfer actions are not implemented.", scope: "account" },
  ] as const satisfies readonly PlanNode[],
  edges: [
    { from: "round", to: "economy", kind: "contains" },
    { from: "round", to: "defense", kind: "contains" },
    { from: "round", to: "first-conquest", kind: "contains" },
    { from: "round", to: "capability.parallel-budgets", kind: "contains" },
    { from: "round", to: "capability.multi-submit", kind: "contains" },
    { from: "round", to: "capability.satellite-roles", kind: "contains" },
    { from: "round", to: "capability.logistics", kind: "contains" },
    { from: "economy", to: "economy.producers", kind: "contains" },
    { from: "economy.producers", to: "economy.lumberyard", kind: "contains" },
    { from: "economy.producers", to: "economy.quarry", kind: "contains" },
    { from: "economy.producers", to: "economy.mine", kind: "contains" },
    { from: "economy.producers", to: "economy.producers.5", kind: "contains" },
    { from: "economy.producers", to: "economy.producers.8", kind: "contains" },
    { from: "economy.producers", to: "economy.producers.10", kind: "contains" },
    { from: "economy.producers", to: "economy.producers.15", kind: "contains" },
    { from: "economy", to: "economy.capacity", kind: "contains" },
    { from: "economy.capacity", to: "economy.farm", kind: "contains" },
    { from: "economy.capacity", to: "economy.storehouse", kind: "contains" },
    { from: "economy.capacity", to: "economy.farm-runway", kind: "contains" },
    { from: "economy.capacity", to: "economy.cellar", kind: "contains" },
    { from: "economy", to: "economy.hall", kind: "contains" },
    { from: "economy", to: "economy.successor-window", kind: "contains" },
    { from: "economy", to: "economy.payback", kind: "contains" },
    { from: "economy", to: "economy.round-end", kind: "contains" },
    { from: "defense", to: "defense.barracks1", kind: "contains" },
    { from: "defense", to: "defense.smithy1", kind: "contains" },
    { from: "defense", to: "defense.development", kind: "contains" },
    { from: "defense", to: "defense.barracks3", kind: "contains" },
    { from: "defense", to: "defense.stable3", kind: "contains" },
    { from: "defense", to: "defense.walls", kind: "contains" },
    { from: "defense", to: "defense.cavalry", kind: "contains" },
    { from: "defense", to: "defense.cohort", kind: "contains" },
    { from: "defense", to: "defense.imminent-attack", kind: "contains" },
    { from: "first-conquest", to: "conquest.infrastructure", kind: "contains" },
    { from: "conquest.infrastructure", to: "conquest.hall13", kind: "contains" },
    { from: "conquest.infrastructure", to: "conquest.barracks10", kind: "contains" },
    { from: "conquest.infrastructure", to: "conquest.smithy10", kind: "contains" },
    { from: "conquest.infrastructure", to: "conquest.market5", kind: "contains" },
    { from: "conquest.infrastructure", to: "conquest.court", kind: "contains" },
    { from: "conquest.infrastructure", to: "conquest.capacity", kind: "contains" },
    { from: "first-conquest", to: "conquest.producer-funding", kind: "contains" },
    { from: "conquest.producer-funding", to: "conquest.producer-investment", kind: "contains" },
    { from: "first-conquest", to: "conquest.escort", kind: "contains" },
    { from: "first-conquest", to: "conquest.envoy", kind: "contains" },
    { from: "first-conquest", to: "conquest.dispatch", kind: "contains" },
    { from: "first-conquest", to: "conquest.target-owned", kind: "contains" },
    { from: "first-conquest", to: "conquest.first-achieved", kind: "contains" },
    { from: "economy.producers.5", to: "economy.producers.8", kind: "requires" },
    { from: "economy.producers.8", to: "economy.producers.10", kind: "requires" },
    { from: "economy.producers.8", to: "economy.hall", kind: "requires" },
    { from: "economy.producers.10", to: "defense.barracks1", kind: "requires" },
    { from: "defense.barracks1", to: "defense.barracks3", kind: "requires" },
    { from: "defense.barracks3", to: "defense.smithy1", kind: "requires" },
    { from: "defense.smithy1", to: "defense.stable3", kind: "requires" },
    { from: "economy.producers.15", to: "conquest.infrastructure", kind: "requires" },
    { from: "conquest.escort", to: "conquest.dispatch", kind: "requires" },
    { from: "conquest.envoy", to: "conquest.dispatch", kind: "requires" },
    { from: "conquest.infrastructure", to: "conquest.dispatch", kind: "requires" },
    { from: "conquest.dispatch", to: "conquest.target-owned", kind: "contributesTo" },
    { from: "conquest.target-owned", to: "conquest.first-achieved", kind: "requires" },
  ] as const satisfies readonly PlanEdge[],
} satisfies PlanDefinition;

export type TaskKey = Extract<(typeof PLAN.nodes)[number], { kind: "task" }>["key"];

export function proposalTask(
  advisor: string,
  action: { type: string; building?: string; unit?: string },
  targetLevel: number,
): TaskKey {
  if (advisor === "conquest") {
    if (action.type === "send") return "conquest.dispatch";
    if (action.type === "train") return action.unit === "envoy" ? "conquest.envoy" : "conquest.escort";
    if (["lumberyard", "quarry", "mine"].includes(action.building ?? "")) return "conquest.producer-investment";
    if (action.building === "hall") return "conquest.hall13";
    if (action.building === "barracks") return "conquest.barracks10";
    if (action.building === "smithy") return "conquest.smithy10";
    if (action.building === "market") return "conquest.market5";
    if (action.building === "court") return "conquest.court";
    return "conquest.capacity";
  }
  if (action.type === "train") {
    if (action.unit === "lancer") return "defense.cavalry";
    return "defense.cohort";
  }
  if (action.building === "farm") return "economy.farm";
  if (action.building === "storehouse") return "economy.storehouse";
  if (action.building === "cellar") return "economy.cellar";
  if (action.building === "hall") return "economy.hall";
  if (action.building === "lumberyard") return "economy.lumberyard";
  if (action.building === "quarry") return "economy.quarry";
  if (action.building === "mine") return "economy.mine";
  if (action.building === "wall") return "defense.walls";
  if (action.building === "barracks" && targetLevel === 1) return "defense.barracks1";
  if (action.building === "barracks" && targetLevel === 3) return "defense.barracks3";
  if (action.building === "stable" && targetLevel === 3) return "defense.stable3";
  if (action.building === "smithy" && targetLevel === 1) return "defense.smithy1";
  return "defense.development";
}

export function isTaskKey(value: unknown): value is TaskKey {
  return typeof value === "string" && PLAN.nodes.some(node => node.kind === "task" && node.key === value);
}

export function validatePlan(plan: PlanDefinition = PLAN): void {
  const byKey = new Map<string, PlanNode>();
  for (const node of plan.nodes) {
    if (!node.key || byKey.has(node.key)) throw new Error(`Duplicate or empty plan node key: ${node.key}`);
    if ((node.kind === "task" || node.kind === "milestone") && !node.scope) {
      throw new Error(`Plan node ${node.key} requires a scope`);
    }
    byKey.set(node.key, node);
  }
  const containsParents = new Map<string, string>();
  const requires = new Map<string, string[]>();
  for (const edge of plan.edges) {
    if (!byKey.has(edge.from) || !byKey.has(edge.to)) throw new Error(`Unknown plan edge reference: ${edge.from} -> ${edge.to}`);
    if (edge.kind === "contains") {
      if (containsParents.has(edge.to)) throw new Error(`Plan node ${edge.to} has multiple contains parents`);
      containsParents.set(edge.to, edge.from);
    }
    if (edge.kind === "requires") requires.set(edge.from, [...(requires.get(edge.from) ?? []), edge.to]);
  }
  const roots = plan.nodes.filter(node => !containsParents.has(node.key));
  if (roots.length !== 1 || roots[0]?.kind !== "objective") throw new Error("Contains edges must form one rooted tree");
  const visiting = new Set<string>(), visited = new Set<string>();
  const walkContains = (key: string): void => {
    if (visiting.has(key)) throw new Error(`Contains cycle at ${key}`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const edge of plan.edges) if (edge.kind === "contains" && edge.from === key) walkContains(edge.to);
    visiting.delete(key);
    visited.add(key);
  };
  walkContains(roots[0].key);
  if (visited.size !== plan.nodes.length) throw new Error("Contains edges must reach every plan node");
  visiting.clear(); visited.clear();
  const walkRequires = (key: string): void => {
    if (visiting.has(key)) throw new Error(`Requires cycle at ${key}`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const next of requires.get(key) ?? []) walkRequires(next);
    visiting.delete(key);
    visited.add(key);
  };
  for (const node of plan.nodes) walkRequires(node.key);
}
