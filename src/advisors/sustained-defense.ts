import type { Action, Resources } from "../shared/api.js";
import type { AdvisorContext, Proposal } from "./types.js";
import { defenseBudget } from "./defense-budget.js";
import { INITIAL_PIKEMEN, INITIAL_SHIELDMEN, INITIAL_RAIDERS, RECRUIT_USE_TICKS } from "./recruitment.js";
/** Spend on repeatable 3Pi1Sh defence after the existing starter force, with no fixed army cap. */
export function evaluateSustainedDefense({state,rules}: AdvisorContext): Proposal<Extract<Action,{type:"train"}>>[] {
  if (rules.version !== state.world.rulesVersion) throw new Error("Live rules do not match this world's rules version.");
  const limit=(rules.rules.ECONOMY as {trainBatchMax:number}).trainBatchMax;
  if (!Number.isSafeInteger(limit)||limit<1) throw new Error("Invalid live recruitment batch limit.");
  const result:Proposal<Extract<Action,{type:"train"}>>[]=[];
  for(const v of state.villages){
    const budget=defenseBudget(v);if(!budget)continue;
    const owned=(u:"pikeman"|"shieldman"|"raider")=>(v.units.home[u]??0)+(v.units.away[u]??0);
    if(owned("pikeman")<INITIAL_PIKEMEN||owned("shieldman")<INITIAL_SHIELDMEN||owned("raider")<INITIAL_RAIDERS)continue;
    const queued=(u:string)=>Object.values(v.training).flat().filter(q=>q.unit===u).reduce((n,q)=>n+q.remaining,0);
    const spears=owned("pikeman")+queued("pikeman"),shields=owned("shieldman")+queued("shieldman");
    const unit=spears<3*(shields+1)?"pikeman":"shieldman";
    const desired=unit==="pikeman"?Math.min(3,3*(shields+1)-spears):1;
    const option=v.options.train.find(o=>o.unit===unit)!;
    const buffer=Math.max(50,Math.ceil(v.population.max*.2));
    const count=Math.max(0,Math.min(desired,limit,option.maxCount,Math.floor((v.population.max-v.population.used-buffer)/option.pop)));
    if(!Number.isSafeInteger(count))throw new Error("Invalid live recruitment capacity.");
    const blockers:string[]=[...option.blockers];const add=(b:string)=>{if(!blockers.includes(b))blockers.push(b);};let needed=true;
    const skip=(b:string)=>{needed=false;add(b);};
    if(!option.ok)skip("RECRUIT_UNAVAILABLE");
    if(!count)skip("POPULATION_OR_BATCH_CAPACITY");
    const requirements=Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,option.cost[r]*count])) as Resources;
    for(const r of ["timber","stone","iron"] as const){if(requirements[r]>v.storage)skip("STORAGE_CAPACITY");if(requirements[r]*1000>v.resourcesMilli[r])skip("INSUFFICIENT_RESOURCES");}
    if(v.buildQueue.length)add("BUILD_QUEUE_BUSY");if(v.training.barracks.length)add("TRAIN_QUEUE_BUSY");
    if(v.orders.build.length||v.orders.train.length)add("EXTERNAL_ORDERS");
    const start=Math.max(state.world.tick,state.player.nextActTick??state.world.tick);
    if(start+count*option.ticksEach+RECRUIT_USE_TICKS>state.world.endsAtTick)skip("ROUND_END_TOO_SOON");
    if(state.world.status!=="running")add("WORLD_NOT_RUNNING");if(start>state.world.tick)add("COUNCIL_COOLDOWN");
    result.push({id:`${state.world.epoch}:${v.id}:defense:${unit}:${owned(unit)}:${count}`,advisor:"military",villageId:v.id,villageName:v.name,
      action:{type:"train",village:v.id,unit,count},buildingName:`3Pi1Sh: ${unit}`,currentLevel:owned(unit),targetLevel:owned(unit)+count,importance:70,
      reason:`Convert available resources into 3Pi1Sh defence, beyond starter caps. Owned/queued: ${spears} Pikemen and ${shields} Shieldmen; train ${count} ${unit} toward the 3:1 mix. A bundle costs ${budget.cost.timber}/${budget.cost.stone}/${budget.cost.iron} timber/stone/iron over ${budget.ticks} ticks at the current Barracks. Keep ${buffer} population free. Resource-starved production, capacity, protection, starter unlocks and intelligence take priority; no troop movement is submitted.`,
      requirements,blockers,status:!needed?"not-needed":blockers.length?"waiting":"ready",affordableAtTick:option.affordableAtTick});
  }
  return result;
}
