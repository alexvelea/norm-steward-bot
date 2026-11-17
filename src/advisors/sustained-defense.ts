import type { Action, Resources } from "../shared/api.js";
import type { AdvisorContext, Proposal } from "./types.js";
import { defenseBudget, defenseReady, defenseSustainable } from "./defense-budget.js";
import { RECRUIT_USE_TICKS } from "./defense-budget.js";
import { proposalTask } from "../bot/plan/graph.js";
/** Queue a little over one minute of 3Pi1Sh; fill both parts, then drain the whole cohort. */
export function evaluateSustainedDefense({state,rules,activeProposals=[]}: AdvisorContext): Proposal<Extract<Action,{type:"train"}>>[] {
  if (rules.version !== state.world.rulesVersion) throw new Error("Live rules do not match this world's rules version.");
  const limit=(rules.rules.ECONOMY as {trainBatchMax:number}).trainBatchMax;
  if (!Number.isSafeInteger(limit)||limit<1) throw new Error("Invalid live recruitment batch limit.");
  const result:Proposal<Extract<Action,{type:"train"}>>[]=[];
  for(const v of state.villages){
    const budget=defenseBudget(v);if(!budget)continue;
    const completing=activeProposals.some(p=>p.villageId===v.id&&p.defenseBatch);
    if(!completing&&!defenseReady(v))continue;
    const owned=(u:"pikeman"|"shieldman"|"raider")=>(v.units.home[u]??0)+(v.units.away[u]??0);
    const queued=(u:string)=>Object.values(v.training).flat().filter(q=>q.unit===u).reduce((n,q)=>n+q.remaining,0);
    const active=activeProposals.find(p=>p.villageId===v.id&&p.defenseBatch)?.defenseBatch;
    const bundles=Math.max(1,Math.ceil(61/budget.ticks));
    const baselinePikemen=owned("pikeman"),baselineShieldmen=owned("shieldman");
    const targetShields=baselineShieldmen+bundles;
    const plan=active??{baselinePikemen,baselineShieldmen,pikemen:3*bundles,shieldmen:targetShields-baselineShieldmen,ticks:0};
    const p=v.options.train.find(o=>o.unit==="pikeman")!,s=v.options.train.find(o=>o.unit==="shieldman")!;
    plan.ticks=plan.pikemen*p.ticksEach+plan.shieldmen*s.ticksEach;
    const remainingP=Math.min(plan.pikemen,Math.max(0,plan.baselinePikemen+plan.pikemen-owned("pikeman")-queued("pikeman")));
    const remainingS=Math.min(plan.shieldmen,Math.max(0,plan.baselineShieldmen+plan.shieldmen-owned("shieldman")-queued("shieldman")));
    if(active&&!remainingP&&!remainingS)continue; // Both parts queued; no Barracks refill until it drains.
    const unit=remainingP>0?"pikeman":"shieldman",count=unit==="pikeman"?remainingP:remainingS;
    const option=unit==="pikeman"?p:s;
    const blockers:string[]=[...option.blockers];const add=(b:string)=>{if(!blockers.includes(b))blockers.push(b);};let needed=true;
    const skip=(b:string)=>{needed=false;add(b);};
    if(!active&&!defenseSustainable(v))skip("INCOME_CANNOT_SUSTAIN_TRAINING_AND_CONSTRUCTION");
    const fullCost=Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,remainingP*p.cost[r]+remainingS*s.cost[r]])) as Resources;
    const funded=(["timber","stone","iron"] as const).every(r=>fullCost[r]*1000<=v.resourcesMilli[r]);
    // A resource-only wait owns the President's budget; treating it as not-needed
    // lets cheaper discretionary investments continually consume cohort funding.
    if(!option.ok&&(!blockers.length||blockers.some(b=>b!=="INSUFFICIENT_RESOURCES")))skip("RECRUIT_UNAVAILABLE");
    if(!Number.isSafeInteger(count)||count<1||count>limit||(funded&&count>option.maxCount))skip("BATCH_CAPACITY");
    const buffer=Math.max(50,Math.ceil(v.population.max*.2));
    const remainingPop=remainingP*p.pop+remainingS*s.pop;
    if(v.population.max-v.population.used-buffer<remainingPop)skip("POPULATION_CAPACITY");
    const requirements=Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,option.cost[r]*count])) as Resources;
    let fundedAtTick=state.world.tick;
    for(const r of ["timber","stone","iron"] as const){
      const completeCost=fullCost[r];
      if(completeCost>v.storage)skip("STORAGE_CAPACITY");
      if(completeCost*1000>v.resourcesMilli[r]){
        add("INSUFFICIENT_RESOURCES");
        if(v.productionPerTickMilli[r]<=0)skip("NO_AFFORDABLE_TICK");
        else fundedAtTick=Math.max(fundedAtTick,state.world.tick+Math.ceil((completeCost*1000-v.resourcesMilli[r])/v.productionPerTickMilli[r]));
      }
    }
    if(v.training.barracks.length&&!active)add("TRAIN_QUEUE_BUSY");
    if(v.orders.train.length)add("EXTERNAL_ORDERS");
    const start=Math.max(fundedAtTick,state.player.nextActTick??state.world.tick,...v.training.barracks.map(q=>q.endTick));
    const remainingTicks=remainingP*p.ticksEach+remainingS*s.ticksEach;
    if(start+remainingTicks+RECRUIT_USE_TICKS>state.world.endsAtTick)skip("ROUND_END_TOO_SOON");
    if(state.world.status!=="running")add("WORLD_NOT_RUNNING");if((state.player.nextActTick??state.world.tick)>state.world.tick)add("COUNCIL_COOLDOWN");
    result.push({id:`${state.world.epoch}:${v.id}:defense:${unit}:${plan.baselinePikemen}:${plan.baselineShieldmen}:${count}`,task:proposalTask("military",{type:"train",unit},owned(unit)+count),advisor:"military",villageId:v.id,villageName:v.name,
      action:{type:"train",village:v.id,unit,count},buildingName:`3Pi1Sh: ${unit}`,currentLevel:owned(unit),targetLevel:owned(unit)+count,importance:active?100:70,
      reason:`Queue a 3Pi1Sh cohort: ${plan.pikemen} Pikemen + ${plan.shieldmen} Shieldmen, ${plan.ticks} ticks at current Barracks speed (whole 3:1 bundles covering over one minute). Submit ${count} ${unit} now; once both parts are queued, leave Barracks alone until the cohort drains. Save through the President for an unfunded but feasible complete cohort; higher-priority deficient income and capacity still win. Keep ${buffer} population free. Construction and other training buildings can operate alongside it.`,
      defenseBatch:plan,requirements,blockers,status:!needed?"not-needed":blockers.length?"waiting":"ready",affordableAtTick:fundedAtTick});
  }
  return result;
}
