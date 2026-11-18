import { evaluateBarracksGrowth, evaluateMilitaryDevelopment, evaluateWalls } from "./military-development.js";
import { evaluateSustainedDefense } from "./sustained-defense.js";
import { evaluateAttackSink } from "./attack-sink.js";
import { minuteTrainingProposal } from "./military-training.js";
import { completionWindow } from "./completion.js";
import type { Action, BuildingId, Resources } from "../shared/api.js";
import type { Advisor, AdvisorContext, Proposal } from "./types.js";
import { proposalTask } from "../bot/plan/graph.js";
import { cityRoles } from "../bot/strategy/roles.js";
import { evaluateRecall } from "./conquest.js";
import { EARLY_GATE, EARLY_HALL, EARLY_WALL, RAIDER_MIN_BARRACKS, RAIDER_TARGET, militaryUnlocked } from "./defense-budget.js";

/** Bounded military proposals share the President and its durable executor. */
export const militaryAdvisor: Advisor = { id: "military", evaluate: context => {
  const roles = context.cityRoles ?? cityRoles(context, []);
  const capital = context.state.villages.find(village => roles.get(village.id)?.role === "capital");
  if (!capital) return [];
  return [
    ...evaluateMilitary(context), ...evaluateSustainedDefense(context), ...evaluateRaiders(context),
    ...evaluateMilitaryDevelopment(context), ...evaluateBarracksGrowth(context), ...evaluateWalls(context),
    ...evaluateRecall(context), ...evaluateAttackSink(context),
  ].filter(proposal => proposal.villageId === capital.id ||
    proposal.task === "econ.request-defenders" || proposal.task === "econ.request-scouts" ||
    proposal.task === "expansion.recall");
} };

export function evaluateRaiders(context: AdvisorContext): Proposal<Extract<Action, {type:"train"}>>[] {
  const roles = context.cityRoles ?? cityRoles(context, []);
  const capital = context.state.villages.find(village => roles.get(village.id)?.role === "capital") ?? context.state.villages[0];
  if (!capital || capital.buildings.barracks < RAIDER_MIN_BARRACKS || capital.buildings.smithy < 2) return [];
  const queued = capital.training.barracks.filter(batch => batch.unit === "raider").reduce((sum,batch) => sum + batch.remaining, 0);
  const current = (capital.units.home.raider ?? 0) + (capital.units.away.raider ?? 0) + queued;
  const deficit = RAIDER_TARGET - current;
  if (deficit <= 0) return [];
  const proposal = minuteTrainingProposal(context, capital, "raider", deficit, "military.raiders", 72,
    `Train toward ${RAIDER_TARGET} owned Raiders, counting home, away, and queued troops; losses are retrained.`,
    `${context.state.world.epoch}:${capital.id}:raiders:${RAIDER_TARGET}`, current, RAIDER_TARGET);
  return proposal ? [proposal] : [];
}
export function evaluateMilitary(context: AdvisorContext): Proposal<Extract<Action, {type: "build"}>>[] {
  const { state, rules } = context;
  const roles = context.cityRoles ?? cityRoles(context, []);
  const capitalId = state.villages.find(village => roles.get(village.id)?.role === "capital")?.id;
  if (!capitalId) return [];
  if (rules.version !== state.world.rulesVersion)
    throw new Error("Live rules do not match this world's rules version.");
  const metadata = (rules.rules.BUILDINGS as Record<BuildingId, {
    name: string; requires: Partial<Record<BuildingId, number>>;
  }>).barracks;
  const pikeman = (rules.rules.UNITS as Record<string, {
    building: string; buildingLevel: number; smithyLevel: number;
    trainTime: number; pop: number; cost: Resources;
  }>).pikeman;
  if (!metadata || !pikeman) throw new Error("Live military rules are unavailable.");
  const proposals: Proposal<Extract<Action, {type: "build"}>>[] = [];
  for (const v of state.villages) {
    if (v.id !== capitalId) continue;
    if (!militaryUnlocked(v)) continue;
    // Never buy further levels or duplicate an existing military training path.
    const facilities = ["barracks", "stable", "workshop", "court"] as const;
    if (facilities.some((b) => v.buildings[b] > 0 || v.buildQueue.some((q) => q.building === b))) continue;
    const option = v.options.build.find((o) => o.building === "barracks");
    if (!option || option.level !== 1) continue;
    const blockers: string[] = [...option.blockers];
    const add = (b: string) => { if (!blockers.includes(b)) blockers.push(b); };
    let needed = true;
    const skip = (b: string) => { needed = false; add(b); };
    if (Object.entries(metadata.requires).some(([b, level]) => v.buildings[b as BuildingId] < level!)) skip("PREREQUISITE");
    // A hard server blocker must never reserve the economy for impossible infrastructure.
    if (option.blockers.some((b) => b !== "INSUFFICIENT_RESOURCES")) needed = false;
    if (!option.ok && !option.blockers.length) skip("UNAVAILABLE");
    if (Object.values(option.cost).some((cost) => cost > v.storage)) skip("STORAGE_CAPACITY");
    if (pikeman.building !== "barracks" || pikeman.buildingLevel > 1 || pikeman.smithyLevel > v.buildings.smithy) skip("NO_USEFUL_RECRUIT");
    if (v.population.max - v.population.used < option.pop + pikeman.pop) skip("POPULATION_CAPACITY");
    if (Object.values(pikeman.cost).some((cost) => cost > v.storage)) skip("RECRUIT_STORAGE_CAPACITY");
    for (const r of ["timber", "stone", "iron"] as const) {
      if (v.resourcesMilli[r] < option.cost[r] * 1000) {
        add("INSUFFICIENT_RESOURCES");
        if (v.productionPerTickMilli[r] <= 0 || option.affordableAtTick === null) skip("NO_AFFORDABLE_TICK");
      }
    }
    const window = completionWindow(state, v, option);
    const trainTicks = v.options.train.find((o) => o.unit === "pikeman")?.ticksEach ?? pikeman.trainTime;
    // Leave a five-minute use horizon, including a possible Council interval and one recruit.
    const useTicks = Math.max(300, trainTicks + (state.world.actIntervalTicks ?? 0));
    if (!Number.isFinite(useTicks) || useTicks <= 0) skip("INVALID_RECRUIT_TIMING");
    if (window && (!window.fits || window.completionTick + useTicks > window.endsAtTick)) skip("ROUND_END_TOO_SOON");
    if (v.buildQueue.length) add("BUILD_QUEUE_BUSY");
    if (v.orders.build.length) add("EXTERNAL_BUILD_ORDERS");
    if (state.world.status !== "running") add("WORLD_NOT_RUNNING");
    if ((state.player.nextActTick ?? state.world.tick) > state.world.tick) add("COUNCIL_COOLDOWN");
    proposals.push({
      id: `${state.world.epoch}:${v.id}:barracks:1`,
      task: proposalTask("military", { type: "build", building: "barracks" }, 1),
      advisor: "military",
      villageId: v.id, villageName: v.name,
      action: { type: "build", village: v.id, building: "barracks" },
      buildingName: metadata.name, currentLevel: 0, targetLevel: 1,
      importance: 79,
      reason: `After Lumberyard ${EARLY_GATE.lumberyard}, Quarry ${EARLY_GATE.quarry} and Mine ${EARLY_GATE.mine}, enable Pikeman training with Barracks 1; reserve ${useTicks} ticks after construction for use. Recruitment continues in parallel.${needed ? "" : " Skip unavailable or unusable infrastructure so economic investment can continue."}`,
      requirements: option.cost, blockers,
      status: !needed ? "not-needed" : blockers.length ? "waiting" : "ready",
      affordableAtTick: option.affordableAtTick,
    });
  }
  return [...proposals, ...evaluateMilitaryHall({state,rules})];
}

/** Close the live Hall prerequisite chain after the early producer gate. */
export function evaluateMilitaryHall(context:AdvisorContext): Proposal<Extract<Action,{type:"build"}>>[] {
  const {state,rules}=context;
  const roles=context.cityRoles??cityRoles(context,[]);
  const capitalId=state.villages.find(village=>roles.get(village.id)?.role==="capital")?.id;
  if(!capitalId)return [];
  if(rules.version!==state.world.rulesVersion)throw new Error("Live rules do not match this world's rules version.");
  const buildings=rules.rules.BUILDINGS as Record<BuildingId,{requires:Partial<Record<BuildingId,number>>}>;
  const proposals:Proposal<Extract<Action,{type:"build"}>>[]=[];
  for(const v of state.villages){
    if(v.id!==capitalId)continue;
    if(v.buildings.barracks>=1&&v.buildings.wall>=EARLY_WALL&&v.buildings.hall<EARLY_HALL)continue;
    const facility=v.buildings.barracks<1?"barracks":v.buildings.smithy<1?"smithy":null;
    const required=facility?buildings[facility].requires.hall:undefined;
    if(!required||v.buildings.hall>=required||!militaryUnlocked(v))continue;
    const o=v.options.build.find(o=>o.building==="hall");if(!o)continue;
    const blockers:string[]=[...o.blockers];let needed=o.ok&&!blockers.length;
    if(v.buildQueue.length)blockers.push("BUILD_QUEUE_BUSY");
    if(v.orders.build.length)blockers.push("EXTERNAL_BUILD_ORDERS");
    if(state.world.status!=="running")blockers.push("WORLD_NOT_RUNNING");
    if((state.player.nextActTick??state.world.tick)>state.world.tick)blockers.push("COUNCIL_COOLDOWN");
    const window=completionWindow(state,v,o);
    if(window&&window.completionTick+300>window.endsAtTick){needed=false;blockers.push("ROUND_END_TOO_SOON");}
    if(v.population.max-v.population.used<o.pop){needed=false;blockers.push("POPULATION_CAPACITY");}
    for(const r of ["timber","stone","iron"] as const)if(v.resourcesMilli[r]<o.cost[r]*1000){needed=false;if(!blockers.includes("INSUFFICIENT_RESOURCES"))blockers.push("INSUFFICIENT_RESOURCES");}
    proposals.push({id:`${state.world.epoch}:${v.id}:military-hall:${o.level}`,task:proposalTask("military",{type:"build",building:"hall"},o.level),advisor:"military",villageId:v.id,villageName:v.name,action:{type:"build",village:v.id,building:"hall"},buildingName:`Great Hall for ${facility}`,currentLevel:v.buildings.hall,targetLevel:o.level,importance:79,
      reason:`Early producer gate complete. Reach the live ${facility} Hall prerequisite (${required}) to unlock the first Barracks or Scout-path Smithy; stop this unlock chain once that facility is available. Only currently affordable steps, with 300 ticks left for use.`,requirements:o.cost,blockers,status:!needed?"not-needed":blockers.length?"waiting":"ready",affordableAtTick:o.affordableAtTick});
  }
  return proposals;
}
