import type {Action,BuildingId,Resources} from "../shared/api.js";
import type {AdvisorContext,Proposal} from "./types.js";
import {completionWindow} from "./completion.js";
import {defenseBudget} from "./defense-budget.js";
import {RECRUIT_USE_TICKS} from "./defense-budget.js";
/** One affordable construction step toward Barracks 10 -> Smithy 5 -> Stable 3. */
export function evaluateMilitaryDevelopment({state,rules}:AdvisorContext):Proposal<Extract<Action,{type:"build"}>>[]{
 if(rules.version!==state.world.rulesVersion)throw new Error("Live rules do not match this world's rules version.");
 const metadata=rules.rules.BUILDINGS as Record<BuildingId,{name:string;requires:Partial<Record<BuildingId,number>>}>;
 const proposals:Proposal<Extract<Action,{type:"build"}>>[]=[];
 for(const v of state.villages){
  if([v.buildings.mine,v.buildings.quarry,v.buildings.lumberyard].some(n=>n<10)||!v.buildings.barracks)continue;
  let building:BuildingId=v.buildings.barracks<3?"barracks":v.buildings.smithy<1?"smithy":"stable";
  if(building==="stable") { const b=defenseBudget(v); const lancer=(rules.rules.UNITS as Record<string,{cost:Resources;trainTime:number}>).lancer; const ticks=Math.max(1,Math.round(lancer.trainTime*rules.tables.trainSpeed[3])); if(!b||(["timber","stone","iron"] as const).some(r=>v.productionPerTickMilli[r]/1000*.8<b.perTick[r]+lancer.cost[r]/ticks))continue; }
  const goal=building==="barracks"?3:building==="smithy"?1:3;
  if(v.buildings[building]>=goal)continue;
  // Follow only this step's actual missing prerequisite, rather than buying unrelated buildings.
  const missing=Object.entries(metadata[building].requires).find(([b,n])=>v.buildings[b as BuildingId]<n!);
  const destination=building;if(missing)building=missing[0] as BuildingId;
  if(destination==="stable"&&v.buildings.stable===0&&!missing)continue; // Existing Scout-readiness proposal funds Stable 1 plus its Scouts.
  const o=v.options.build.find(o=>o.building===building);if(!o||o.level!==v.buildings[building]+1)continue;
  const blockers:string[]=[...o.blockers];let needed=o.ok&&!blockers.length;
  if(v.buildQueue.length)blockers.push("BUILD_QUEUE_BUSY");if(v.orders.build.length)blockers.push("EXTERNAL_BUILD_ORDERS");
  const free=v.population.max-v.population.used,buffer=Math.max(50,Math.ceil(v.population.max*.2));
  if(free<o.pop+buffer){needed=false;blockers.push("POPULATION_CAPACITY");}
  for(const r of ["timber","stone","iron"] as const)if(v.resourcesMilli[r]<o.cost[r]*1000||o.cost[r]>v.storage){needed=false;blockers.push("INSUFFICIENT_RESOURCES");break;}
  // Faster training cannot sustain defence when its input is already scarce.
  // Keep one complete next cohort funded before discretionary military construction.
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
  proposals.push({id:`${state.world.epoch}:${v.id}:development:${building}:${o.level}`,advisor:"military",villageId:v.id,villageName:v.name,action:{type:"build",village:v.id,building},buildingName:metadata[building].name,currentLevel:v.buildings[building],targetLevel:o.level,importance:76,
   reason:`Military construction path: Barracks 3, then Smithy 1, then Stable 3 for Scouts and Lancers. Next: ${metadata[building].name} ${o.level}${missing?` to unlock ${metadata[destination].name}`:""}. Fund this step now, retain the population buffer and at least 600 ticks after construction. Training continues in its own queue. For resources produced below the sustained defensive training demand, retain funding for one complete next cohort before this construction.`,requirements:o.cost,blockers,status:!needed?"not-needed":blockers.length?"waiting":"ready",affordableAtTick:o.affordableAtTick});
 }
 return proposals;
}
/** Wall value is the actual marginal static defence, compared with buying another 3Pi1Sh. */
export function evaluateWalls({state,rules}:AdvisorContext):Proposal<Extract<Action,{type:"build"}>>[]{
 if(rules.version!==state.world.rulesVersion)throw new Error("Live rules do not match this world's rules version.");
 const combat=rules.rules.COMBAT as {villageBaseDefense:number;wallFlat:number;wallMultBase:number};
 const units=rules.rules.UNITS as Record<string,{defense:Record<string,number>;cost:Resources}>;
 const proposals:Proposal<Extract<Action,{type:"build"}>>[]=[];
 for(const v of state.villages){
  if([v.buildings.mine,v.buildings.quarry,v.buildings.lumberyard].some(n=>n<5))continue;
  const o=v.options.build.find(o=>o.building==="wall");if(!o||o.level<=v.buildings.wall)continue;
  const cost=Object.values(o.cost).reduce((a,b)=>a+b,0),bundleCost=Object.values(units.pikeman.cost).reduce((a,b)=>a+3*b,0)+Object.values(units.shieldman.cost).reduce((a,b)=>a+b,0);
  const troops={...v.units.home};for(const stack of v.supportHere)for(const [u,n] of Object.entries(stack.units))troops[u as keyof typeof troops]=(troops[u as keyof typeof troops]??0)+n;
  const gains:Record<string,number>={},ratios:number[]=[];
  for(const type of ["infantry","cavalry","ranged"]){
   const d=Object.entries(troops).reduce((sum,[u,n])=>sum+n*(units[u]?.defense[type]??0),0);
   const total=(level:number)=>(d+combat.villageBaseDefense+combat.wallFlat*level)*combat.wallMultBase**level;
   gains[type]=total(o.level)-total(v.buildings.wall);
   const bundle=(3*units.pikeman.defense[type]+units.shieldman.defense[type])*combat.wallMultBase**v.buildings.wall;
   ratios.push((gains[type]/Math.max(1,cost))/(bundle/Math.max(1,bundleCost)));
  }
  const efficiency=Math.min(...ratios),blockers:string[]=[...o.blockers];let needed=efficiency>=1.1&&o.ok&&!blockers.length;
  if(efficiency<1.1)blockers.push("TROOPS_BETTER_VALUE");
  if(v.population.max-v.population.used<o.pop){needed=false;blockers.push("POPULATION_CAPACITY");}
  for(const r of ["timber","stone","iron"] as const)if(o.cost[r]*1000>v.resourcesMilli[r]||o.cost[r]>v.storage){needed=false;blockers.push("INSUFFICIENT_RESOURCES");break;}
  if(v.buildQueue.length)blockers.push("BUILD_QUEUE_BUSY");if(v.orders.build.length)blockers.push("EXTERNAL_BUILD_ORDERS");
  const completion=completionWindow(state,v,o);if(completion&&completion.completionTick+120>state.world.endsAtTick){needed=false;blockers.push("ROUND_END_TOO_SOON");}
  if(state.world.status!=="running")blockers.push("WORLD_NOT_RUNNING");if((state.player.nextActTick??state.world.tick)>state.world.tick)blockers.push("COUNCIL_COOLDOWN");
  proposals.push({id:`${state.world.epoch}:${v.id}:wall:${o.level}`,advisor:"military",villageId:v.id,villageName:v.name,action:{type:"build",village:v.id,building:"wall"},buildingName:"Wall",currentLevel:v.buildings.wall,targetLevel:o.level,importance:84,
   reason:`Wall ${o.level} adds ${Object.entries(gains).map(([t,n])=>`${Math.round(n)} ${t}`).join(", ")} defence from troops at home/support plus base defence and the wall multiplier. Worst-type defence per resource is ${efficiency.toFixed(2)}x another 3Pi1Sh at the current wall; require at least 1.10x. Away troops excluded. Static comparison assumes no attacking Rams; it is not a battle prediction.`,requirements:o.cost,blockers,status:!needed?"not-needed":blockers.length?"waiting":"ready",affordableAtTick:o.affordableAtTick});
 }
 return proposals;
}
export function evaluateCavalry({state,rules}:AdvisorContext):Proposal<Extract<Action,{type:"train"}>>[]{
 if(rules.version!==state.world.rulesVersion)throw new Error("Live rules do not match this world's rules version.");
 const proposals:Proposal<Extract<Action,{type:"train"}>>[]=[];
 for(const v of state.villages){
  if(v.buildings.barracks<3||v.buildings.smithy<3||v.buildings.stable<3)continue;
  const o=v.options.train.find(o=>o.unit==="lancer");if(!o)continue;
  const owned=(v.units.home.lancer??0)+(v.units.away.lancer??0),queued=v.training.stable.filter(q=>q.unit==="lancer").reduce((n,q)=>n+q.remaining,0);
  if(owned+queued>=30)continue;
  const budget=defenseBudget(v);
  if(Math.min(v.buildings.mine,v.buildings.quarry,v.buildings.lumberyard)<10||!budget||(["timber","stone","iron"] as const).some(r=>v.productionPerTickMilli[r]/1000*.8<budget.perTick[r]+o.cost[r]/o.ticksEach))continue;
  const limit=(rules.rules.ECONOMY as {trainBatchMax:number}).trainBatchMax;
  const count=Math.min(30-owned-queued,Math.ceil(61/o.ticksEach),limit),blockers:string[]=[...o.blockers];let needed=o.ok&&!blockers.length;
  const buffer=Math.max(50,Math.ceil(v.population.max*.2));if(count<1||count>o.maxCount||v.population.max-v.population.used<count*o.pop+buffer){needed=false;blockers.push("POPULATION_OR_BATCH_CAPACITY");}
  const requirements=Object.fromEntries((["timber","stone","iron"] as const).map(r=>[r,count*o.cost[r]])) as Resources;
  for(const r of ["timber","stone","iron"] as const)if(requirements[r]*1000>v.resourcesMilli[r]||requirements[r]>v.storage){needed=false;blockers.push("INSUFFICIENT_RESOURCES");break;}
  if(v.training.stable.length)blockers.push("TRAIN_QUEUE_BUSY");if(v.orders.train.length)blockers.push("EXTERNAL_ORDERS");
  const start=Math.max(state.world.tick,state.player.nextActTick??state.world.tick);
  if(start+count*o.ticksEach+300>state.world.endsAtTick){needed=false;blockers.push("ROUND_END_TOO_SOON");}
  if(state.world.status!=="running")blockers.push("WORLD_NOT_RUNNING");if(start>state.world.tick)blockers.push("COUNCIL_COOLDOWN");
  proposals.push({id:`${state.world.epoch}:${v.id}:lancer:${owned}:${count}`,advisor:"military",villageId:v.id,villageName:v.name,action:{type:"train",village:v.id,unit:"lancer",count},buildingName:"Lancer troops",currentLevel:owned,targetLevel:owned+count,importance:72,
   reason:`Train ${count} Lancers (${count*o.ticksEach} ticks) toward 30 owned/queued, using the Stable independently of Barracks. Keep ${buffer} population free and 300 ticks for use. This is a bounded initial cavalry force; dispatch still requires intelligence and the existing risk checks.`,requirements,blockers,status:!needed?"not-needed":blockers.length?"waiting":"ready",affordableAtTick:o.affordableAtTick});
 }
 return proposals;
}
