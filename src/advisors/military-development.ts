import type {Action,BuildingId,Resources} from "../shared/api.js";
import type {AdvisorContext,Proposal} from "./types.js";
import { proposalTask } from "../bot/plan/graph.js";
import {completionWindow} from "./completion.js";
import { BARRACKS_CAP, EARLY_HALL, EARLY_WALL, defenseBudget, earlyGoalMet, hallRushActive, militaryUnlocked } from "./defense-budget.js";
import {RECRUIT_USE_TICKS} from "./defense-budget.js";
import {evaluateSustainedDefense} from "./sustained-defense.js";
import {cityRoles} from "../bot/strategy/roles.js";

function isCapital(context:AdvisorContext,villageId:string):boolean {
 return (context.cityRoles??cityRoles(context,[])).get(villageId)?.role==="capital";
}
/** One affordable step through military development after the early capital opening. */
export function evaluateMilitaryDevelopment(context:AdvisorContext):Proposal<Extract<Action,{type:"build"}>>[]{
 const {state,rules}=context;
 if(rules.version!==state.world.rulesVersion)throw new Error("Live rules do not match this world's rules version.");
 const metadata=rules.rules.BUILDINGS as Record<BuildingId,{name:string;requires:Partial<Record<BuildingId,number>>}>;
 const proposals:Proposal<Extract<Action,{type:"build"}>>[]=[];
 for(const v of state.villages){
  if(!isCapital(context,v.id))continue;
  if(!militaryUnlocked(v)||!v.buildings.barracks||v.buildings.wall<EARLY_WALL||hallRushActive(v))continue;
  let building:BuildingId=v.buildings.barracks<3?"barracks":v.buildings.smithy<1?"smithy":"stable";
  if(v.buildings.barracks>=3&&!earlyGoalMet(v))continue;
  const goal=building==="barracks"?3:1;
  if(v.buildings[building]>=goal)continue;
  // Follow only this step's actual missing prerequisite, rather than buying unrelated buildings.
  const missing=Object.entries(metadata[building].requires).find(([b,n])=>v.buildings[b as BuildingId]<n!);
  const destination=building;if(missing)building=missing[0] as BuildingId;
  const o=v.options.build.find(o=>o.building===building);if(!o||o.level!==v.buildings[building]+1)continue;
  const blockers:string[]=[...o.blockers];let needed=o.ok&&!blockers.length;
  if(v.buildQueue.length)blockers.push("BUILD_QUEUE_BUSY");if(v.orders.build.length)blockers.push("EXTERNAL_BUILD_ORDERS");
  const free=v.population.max-v.population.used,buffer=Math.max(50,Math.ceil(v.population.max*.2));
  if(free<o.pop+buffer){needed=false;blockers.push("POPULATION_CAPACITY");}
  for(const r of ["timber","stone","iron"] as const)if(v.resourcesMilli[r]<o.cost[r]*1000||o.cost[r]>v.storage){needed=false;blockers.push("INSUFFICIENT_RESOURCES");break;}
  // Faster training cannot sustain defence when its input is already scarce.
  // Keep one complete next Pikeman batch funded before discretionary military construction.
  const budget=defenseBudget(v);
  const bundles=budget?Math.ceil(61/budget.ticks):0;
  const nextStart=Math.max(state.world.tick,...v.training.barracks.map(q=>q.endTick));
  const protectDefense=budget&&
   !v.orders.train.length&&free>=buffer+budget.pop*bundles&&nextStart+budget.ticks*bundles+RECRUIT_USE_TICKS<=state.world.endsAtTick;
  if(protectDefense&&(["timber","stone","iron"] as const).some(r=>v.productionPerTickMilli[r]/1000<budget.perTick[r]&&v.resourcesMilli[r]<(o.cost[r]+budget.cost[r]*bundles)*1000)){
   needed=false;blockers.push("DEFENSE_RESOURCE_RUNWAY");
  }
  const completion=completionWindow(state,v,o);if(completion&&completion.completionTick+600>state.world.endsAtTick){needed=false;blockers.push("ROUND_END_TOO_SOON");}
  if(state.world.status!=="running")blockers.push("WORLD_NOT_RUNNING");if((state.player.nextActTick??state.world.tick)>state.world.tick)blockers.push("COUNCIL_COOLDOWN");
  proposals.push({id:`${state.world.epoch}:${v.id}:development:${building}:${o.level}`,task:proposalTask("military",{type:"build",building},o.level),advisor:"military",villageId:v.id,villageName:v.name,action:{type:"build",village:v.id,building},buildingName:metadata[building].name,currentLevel:v.buildings[building],targetLevel:o.level,importance:76,
   reason:`Military development after the Wall 5 and Hall 10 opening. Next: ${metadata[building].name} ${o.level}${missing?` to unlock ${metadata[destination].name}`:""}. Fund this step now, retain the population buffer and at least 600 ticks after construction. Training continues in its own queue. For resources produced below the sustained Pikeman demand, retain funding for one complete next batch before this construction.`,requirements:o.cost,blockers,status:!needed?"not-needed":blockers.length?"waiting":"ready",affordableAtTick:o.affordableAtTick});
 }
 return proposals;
}
/** Wall value is the actual marginal static defence, compared with another Pikeman. */
export function evaluateWalls(context:AdvisorContext):Proposal<Extract<Action,{type:"build"}>>[]{
 const {state,rules}=context;
 if(rules.version!==state.world.rulesVersion)throw new Error("Live rules do not match this world's rules version.");
 const combat=rules.rules.COMBAT as {villageBaseDefense:number;wallFlat:number;wallMultBase:number};
 const units=rules.rules.UNITS as Record<string,{defense:Record<string,number>;cost:Resources}>;
 const proposals:Proposal<Extract<Action,{type:"build"}>>[]=[];
 function hallRushProposal(v:AdvisorContext["state"]["villages"][number]):Proposal<Extract<Action,{type:"build"}>>|null{
  const hall=v.options.build.find(option=>option.building==="hall");
  if(!hall||hall.level!==v.buildings.hall+1||hall.level>EARLY_HALL)return null;
  const blockers:string[]=[...hall.blockers];let needed=hall.ok||blockers.includes("INSUFFICIENT_RESOURCES");
  if(v.buildQueue.length&&!blockers.includes("BUILD_QUEUE_BUSY"))blockers.push("BUILD_QUEUE_BUSY");
  if(v.orders.build.length&&!blockers.includes("EXTERNAL_BUILD_ORDERS"))blockers.push("EXTERNAL_BUILD_ORDERS");
  if(v.population.max-v.population.used<hall.pop&&!blockers.includes("POPULATION_CAPACITY")){needed=false;blockers.push("POPULATION_CAPACITY");}
  for(const r of ["timber","stone","iron"] as const){
   if(hall.cost[r]>v.storage&&!blockers.includes("STORAGE_CAPACITY")){needed=false;blockers.push("STORAGE_CAPACITY");}
   if(v.resourcesMilli[r]<hall.cost[r]*1000&&!blockers.includes("INSUFFICIENT_RESOURCES"))blockers.push("INSUFFICIENT_RESOURCES");
  }
  const completion=completionWindow(state,v,hall);
  if(completion&&completion.completionTick+300>state.world.endsAtTick&&!blockers.includes("ROUND_END_TOO_SOON")){needed=false;blockers.push("ROUND_END_TOO_SOON");}
  if(state.world.status!=="running"&&!blockers.includes("WORLD_NOT_RUNNING"))blockers.push("WORLD_NOT_RUNNING");
  if((state.player.nextActTick??state.world.tick)>state.world.tick&&!blockers.includes("COUNCIL_COOLDOWN"))blockers.push("COUNCIL_COOLDOWN");
  return {id:`${state.world.epoch}:${v.id}:hall-rush:${hall.level}`,task:proposalTask("military",{type:"build",building:"hall"},hall.level),advisor:"military",villageId:v.id,villageName:v.name,action:{type:"build",village:v.id,building:"hall"},buildingName:"Great Hall",currentLevel:v.buildings.hall,targetLevel:hall.level,importance:90,
   reason:`Complete the Hall ${EARLY_HALL} opening before further Barracks growth or military development.`,requirements:hall.cost,blockers,status:!needed?"not-needed":blockers.length?"waiting":"ready",affordableAtTick:hall.affordableAtTick};
 }
 for(const v of state.villages){
  if(!isCapital(context,v.id))continue;
  if(hallRushActive(v)){
   const hall=hallRushProposal(v);
   if(hall)proposals.push(hall);
  }
  const wallRush=v.buildings.barracks>=1&&v.buildings.wall<EARLY_WALL;
  if(!wallRush&&[v.buildings.mine,v.buildings.quarry,v.buildings.lumberyard].some(n=>n<13))continue;
  if(v.buildings.wall>=10)continue;
  const o=v.options.build.find(o=>o.building==="wall");if(!o||o.level<=v.buildings.wall||o.level>10)continue;
  if(wallRush&&o.level>EARLY_WALL)continue;
  const cost=Object.values(o.cost).reduce((a,b)=>a+b,0),bundleCost=Object.values(units.pikeman.cost).reduce((a,b)=>a+b,0);
  const troops={...v.units.home};for(const stack of v.supportHere)for(const [u,n] of Object.entries(stack.units))troops[u as keyof typeof troops]=(troops[u as keyof typeof troops]??0)+n;
  const gains:Record<string,number>={},ratios:number[]=[];
  for(const type of ["infantry","cavalry","ranged"]){
   const d=Object.entries(troops).reduce((sum,[u,n])=>sum+n*(units[u]?.defense[type]??0),0);
   const total=(level:number)=>(d+combat.villageBaseDefense+combat.wallFlat*level)*combat.wallMultBase**level;
   gains[type]=total(o.level)-total(v.buildings.wall);
   const bundle=units.pikeman.defense[type]*combat.wallMultBase**v.buildings.wall;
   ratios.push((gains[type]/Math.max(1,cost))/(bundle/Math.max(1,bundleCost)));
  }
  const efficiency=Math.min(...ratios),rush=wallRush&&o.level<=EARLY_WALL,blockers:string[]=[...o.blockers];let needed=(rush||efficiency>=1.1)&&o.ok&&!blockers.length;
  if(!rush&&efficiency<1.1)blockers.push("TROOPS_BETTER_VALUE");
  if(v.population.max-v.population.used<o.pop){needed=false;blockers.push("POPULATION_CAPACITY");}
  for(const r of ["timber","stone","iron"] as const)if(o.cost[r]*1000>v.resourcesMilli[r]||o.cost[r]>v.storage){needed=false;blockers.push("INSUFFICIENT_RESOURCES");break;}
  if(v.buildQueue.length)blockers.push("BUILD_QUEUE_BUSY");if(v.orders.build.length)blockers.push("EXTERNAL_BUILD_ORDERS");
  const completion=completionWindow(state,v,o);if(completion&&completion.completionTick+120>state.world.endsAtTick){needed=false;blockers.push("ROUND_END_TOO_SOON");}
  if(state.world.status!=="running")blockers.push("WORLD_NOT_RUNNING");if((state.player.nextActTick??state.world.tick)>state.world.tick)blockers.push("COUNCIL_COOLDOWN");
  proposals.push({id:`${state.world.epoch}:${v.id}:wall:${o.level}`,task:proposalTask("military",{type:"build",building:"wall"},o.level),advisor:"military",villageId:v.id,villageName:v.name,action:{type:"build",village:v.id,building:"wall"},buildingName:"Wall",currentLevel:v.buildings.wall,targetLevel:o.level,importance:rush?88:84,
   reason:rush?`Build Wall ${o.level} immediately after Barracks 1, before further military development.`:`All resource producers have reached 13; Wall ${o.level} adds ${Object.entries(gains).map(([t,n])=>`${Math.round(n)} ${t}`).join(", ")} defence from troops at home/support plus base defence and the wall multiplier. Worst-type defence per resource is ${efficiency.toFixed(2)}x another Pikeman at the current wall; require at least 1.10x. Away troops excluded. Static comparison assumes no attacking Rams; it is not a battle prediction.`,requirements:o.cost,blockers,status:!needed?"not-needed":blockers.length?"waiting":"ready",affordableAtTick:o.affordableAtTick});
 }
 return proposals;
}
export function evaluateBarracksGrowth(context:AdvisorContext):Proposal<Extract<Action,{type:"build"}>>[]{
 const proposals:Proposal<Extract<Action,{type:"build"}>>[]=[];
 for(const v of context.state.villages){
  if(!isCapital(context,v.id))continue;
  if(v.buildings.barracks<1||v.buildings.barracks>=BARRACKS_CAP||v.buildings.wall<EARLY_WALL||hallRushActive(v))continue;
  const pikes=evaluateSustainedDefense(context).find(p=>p.villageId===v.id&&p.action.type==="train"&&p.action.unit==="pikeman");
  const pikeDeficit=pikes&&pikes.importance===75?Math.max(0,pikes.targetLevel-pikes.currentLevel):0;
  const raiderOption=v.options.train.find(o=>o.unit==="raider");
  const queued=v.training.barracks.reduce((sum,batch)=>{
   const option=v.options.train.find(o=>o.unit===batch.unit);return sum+batch.remaining*(option?.ticksEach??0);
  },0);
  const raiderQueued=Object.values(v.training).flat().filter(batch=>batch.unit==="raider").reduce((sum,batch)=>sum+batch.remaining,0);
  const raiderOwned=(v.units.home.raider??0)+(v.units.away.raider??0);
  const backlog=queued+pikeDeficit*(v.options.train.find(o=>o.unit==="pikeman")?.ticksEach??0)+
   Math.max(0,140-raiderOwned-raiderQueued)*(raiderOption?.ticksEach??0);
  if(backlog<=600)continue;
  const o=v.options.build.find(option=>option.building==="barracks");if(!o||o.level<=v.buildings.barracks)continue;
  const batch=pikes?.requirements;
  const idle=(["timber","stone","iron"] as const).every(r=>v.resources[r]>=2*(o.cost[r]??0)+2*(batch?.[r]??0));
  const blockers:string[]=[...o.blockers];let needed=o.ok&&!blockers.length;
  if(v.buildQueue.length)blockers.push("BUILD_QUEUE_BUSY");
  if(v.orders.build.length)blockers.push("EXTERNAL_BUILD_ORDERS");
  const buffer=Math.max(50,Math.ceil(v.population.max*.2));
  if(v.population.max-v.population.used<o.pop+buffer){needed=false;blockers.push("POPULATION_CAPACITY");}
  if(context.state.world.status!=="running")blockers.push("WORLD_NOT_RUNNING");
  if((context.state.player.nextActTick??context.state.world.tick)>context.state.world.tick)blockers.push("COUNCIL_COOLDOWN");
  proposals.push({id:`${context.state.world.epoch}:${v.id}:barracks-growth:${o.level}`,task:"military.barracks-growth",
   advisor:"military",villageId:v.id,villageName:v.name,action:{type:"build",village:v.id,building:"barracks"},
   buildingName:"Barracks",currentLevel:v.buildings.barracks,targetLevel:o.level,importance:idle?92:65,
   reason:`Barracks work backlog is ${Math.ceil(backlog)} ticks, over the 600-tick threshold. ${idle?"Stock covers twice the upgrade plus two Pikemen batches, so it outranks other builds.":"Stock is below twice the upgrade plus two Pikemen batches, so it waits behind other builds."}`,requirements:o.cost,
   blockers,status:!needed?"not-needed":blockers.length?"waiting":"ready",affordableAtTick:o.affordableAtTick});
 }
 return proposals;
}
