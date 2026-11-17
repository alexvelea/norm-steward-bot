import { completionWindow } from "./completion.js";
import { RECRUIT_USE_TICKS } from "./defense-budget.js";
import type { Action, BuildingId } from "../shared/api.js";
import type { AdvisorContext, Proposal } from "./types.js";
import { proposalTask } from "../bot/plan/graph.js";
/** Unlock the 3:1 training path directly, without a starter troop quota. */
export function evaluateDefensiveSmithy({state,rules}:AdvisorContext):Proposal<Extract<Action,{type:"build"}>>[]{
 if(rules.version!==state.world.rulesVersion)throw new Error("Live rules do not match this world's rules version.");
 const metadata=(rules.rules.BUILDINGS as Record<BuildingId,{name:string;requires:Partial<Record<BuildingId,number>>}>).smithy;
 const proposals:Proposal<Extract<Action,{type:"build"}>>[]=[];
 for(const v of state.villages){
  if(v.buildings.smithy>0||v.buildings.barracks<1||[v.buildings.mine,v.buildings.quarry,v.buildings.lumberyard].some(n=>n<10))continue;
  const o=v.options.build.find(o=>o.building==="smithy"),p=v.options.train.find(o=>o.unit==="pikeman"),s=v.options.train.find(o=>o.unit==="shieldman");
  if(!o||o.level!==1||!p||!s)continue;
  if(![p.ticksEach,s.ticksEach,p.pop,s.pop].every(n=>Number.isSafeInteger(n)&&n>0))throw new Error("Invalid live defensive training option.");
  const bundles=Math.ceil(61/(3*p.ticksEach+s.ticksEach)),blockers:string[]=[...o.blockers];let needed=o.ok&&!blockers.length;
  const skip=(b:string)=>{needed=false;if(!blockers.includes(b))blockers.push(b);};
  if(Object.entries(metadata.requires).some(([b,n])=>v.buildings[b as BuildingId]<n!))skip("PREREQUISITE");
  const buffer=Math.max(50,Math.ceil(v.population.max*.2));
  if(v.population.max-v.population.used<o.pop+bundles*(3*p.pop+s.pop)+buffer)skip("POPULATION_CAPACITY");
  for(const r of ["timber","stone","iron"] as const){
   const cost=o.cost[r]+bundles*(3*p.cost[r]+s.cost[r]);
   if(cost>v.storage)skip("STORAGE_CAPACITY");if(cost*1000>v.resourcesMilli[r])skip("UNFUNDED_DEFENSE_BATCH");
  }
  if(s.blockers.some(b=>b!=="REQUIREMENTS_NOT_MET")||p.blockers.some(b=>b!=="INSUFFICIENT_RESOURCES"))skip("RECRUIT_UNAVAILABLE");
  const window=completionWindow(state,v,o),use=Math.max(300,bundles*(3*p.ticksEach+s.ticksEach)+RECRUIT_USE_TICKS);
  if(window&&window.completionTick+use>window.endsAtTick)skip("ROUND_END_TOO_SOON");
  if(v.buildQueue.length)blockers.push("BUILD_QUEUE_BUSY");if(v.orders.build.length)blockers.push("EXTERNAL_BUILD_ORDERS");
  if(state.world.status!=="running")blockers.push("WORLD_NOT_RUNNING");if((state.player.nextActTick??state.world.tick)>state.world.tick)blockers.push("COUNCIL_COOLDOWN");
  proposals.push({id:`${state.world.epoch}:${v.id}:smithy:1`,task:proposalTask("military",{type:"build",building:"smithy"},1),advisor:"military",villageId:v.id,villageName:v.name,action:{type:"build",village:v.id,building:"smithy"},buildingName:metadata.name,currentLevel:0,targetLevel:1,importance:77,
   reason:`Unlock Smithy 1 for minute-long 3Pi1Sh recruitment directly. No initial troop quota. Fund this construction plus ${3*bundles} Pikemen and ${bundles} Shieldmen, retaining ${buffer} population slots.`,requirements:o.cost,blockers,status:!needed?"not-needed":blockers.length?"waiting":"ready",affordableAtTick:o.affordableAtTick});
 }
 return proposals;
}
