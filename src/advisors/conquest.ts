/** Research candidate: the owner's bounded first-conquest transition.
 * All proposals still pass through the President and the journalled executor.
 * Peaceful hamlet assumptions are experimental, not a player-threat policy. */
import type {BuildingId, MapResponse, Report, Resources, SimulateBattleResponse, UnitId, VillageState} from '../shared/api.js';
import type {AdvisorContext, Proposal} from './types.js';
import {nextConquestBuilding, fundingUpgrade, conquestLoyalty} from '../review/conquest-plan.js';

export interface ConquestPlan {
 scope: string;
 villageId: string;
 startedTick: number;
 status: 'preparing' | 'captured' | 'stopped';
 targetId?: string;
 escort?: number;
 waves: number;
 lastBattle?: Report;
 reason?: string;
 capturedTick?: number;
}
export interface ConquestContext {
 plan: ConquestPlan;
 map?: MapResponse;
 assessment?: {tick: number; raiders: number; battle: SimulateBattleResponse};
}
const resources = ['timber','stone','iron'] as const;
export function conquestScope(server: string, account: string, context: AdvisorContext): string {
 return JSON.stringify([server,account,context.state.world.id,context.state.world.epoch]);
}
export function conquestTravel(context: AdvisorContext, c: ConquestContext): number | null {
 const v=context.state.villages.find(v=>v.id===c.plan.villageId),t=c.map?.villages.find(t=>t.id===c.plan.targetId);
 const speed=(context.rules.rules.UNITS as Record<string,{speed:number}>).envoy.speed;
 return v&&t?Math.max(1,Math.ceil(Math.hypot(t.x-v.x,t.y-v.y)*speed)):null;
}
/** Exact loyalty boundaries, allowing council spacing, and six bounded hits at most. */
export function conquestCaptureTick(context: AdvisorContext,c: ConquestContext,start=context.state.world.tick): number | null {
 const travel=conquestTravel(context,c);if(travel===null)return null;
 const combat=context.rules.rules.COMBAT as {envoyLoyaltyHit:number;loyaltyRegenTicks:number};
 const interval=Math.max(travel*2,context.state.world.actIntervalTicks??0);
 const arrivals=Array.from({length:6},(_,i)=>start+travel+i*interval);
 const hit=conquestLoyalty(arrivals,combat.envoyLoyaltyHit,combat.loyaltyRegenTicks).findIndex(n=>n<=0);
 return hit<0?null:arrivals[hit];
}

/** Replace discretionary origin spending during the transition, preserving paid complements. */
export function applyConquest(context: AdvisorContext,proposals: Proposal[],c?: ConquestContext): Proposal[] {
 if(!c||c.plan.status!=='preparing')return proposals;
 const {state,rules}=context,plan=c.plan,v=state.villages.find(v=>v.id===plan.villageId);
 if(!v)return proposals;
 const retained=proposals.filter(p=>p.villageId!==v.id ||
   (p.action.type==='train'&&p.action.unit==='shieldman'&&p.defenseBatch&&
    (context.activeProposals??[]).some(a=>a.villageId===v.id&&a.defenseBatch)));
 if(state.world.status!=='running'||rules.version!==state.world.rulesVersion||
   Object.values(v.orders).some(o=>o.length)||state.scheduled.length)return retained;
 const metadata=rules.rules.BUILDINGS as Record<BuildingId,{name:string}>;
 const blockers=()=> (state.player.nextActTick??0)>state.world.tick?['COUNCIL_COOLDOWN']:[];
 const buffer=Math.max(50,Math.ceil(v.population.max*.2));
 const free=v.population.max-v.population.used;
 function build(building: BuildingId,importance=88): Proposal | null {
  const o=v!.options.build.find(o=>o.building===building);if(!o)return null;
  // Capacity is itself an ordinary paid prerequisite, never injected assets.
  if(building!=='farm'&&free<o.pop+buffer)return build('farm',96);
  if(building!=='storehouse'&&resources.some(r=>o.cost[r]>v!.storage))return build('storehouse',96);
  const b:string[]=[...o.blockers,...blockers()];
  if(v!.buildQueue.length)b.push('BUILD_QUEUE_BUSY');
  for(const r of resources)if(v!.resourcesMilli[r]<o.cost[r]*1000&&!b.includes('INSUFFICIENT_RESOURCES'))b.push('INSUFFICIENT_RESOURCES');
  const funded=Math.max(state.world.tick,...resources.map(r=>v!.productionPerTickMilli[r]>0?state.world.tick+Math.max(0,Math.ceil((o.cost[r]*1000-v!.resourcesMilli[r])/v!.productionPerTickMilli[r])):Infinity));
  if(funded+o.ticks+60>state.world.endsAtTick)b.push('ROUND_END_TOO_SOON');
  return {id:`${state.world.epoch}:${v!.id}:conquest:build:${building}:${o.level}`,advisor:'conquest',villageId:v!.id,villageName:v!.name,
   action:{type:'build',village:v!.id,building},buildingName:metadata[building].name,currentLevel:v!.buildings[building],targetLevel:o.level,
   importance,reason:'Bounded conquest transition: retain the paid home defence, producers 15, Hall 13, Barracks 10, Smithy 10, Market 5 and Court; fund capacity as needed.',requirements:o.cost,blockers:[...new Set(b)],
   status:b.length?'waiting':'ready',affordableAtTick:Number.isFinite(funded)?funded:null};
 }
 function train(unit: 'raider'|'envoy',goal:number): Proposal | null {
  const o=v!.options.train.find(o=>o.unit===unit);if(!o)return null;
  const u=(rules.rules.UNITS as Record<UnitId,{building:keyof VillageState['training'];buildingLevel:number;smithyLevel:number}>)[unit];
  if(v!.buildings[u.building]<u.buildingLevel||v!.buildings.smithy<u.smithyLevel)return null;
  const owned=(v!.units.home[unit]??0)+(v!.units.away[unit]??0);
  const queued=Object.values(v!.training).flat().filter(q=>q.unit===unit).reduce((n,q)=>n+q.remaining,0);
  const remaining=goal-owned-queued;
  const count=unit==='raider'?Math.min(remaining,Math.ceil(61/o.ticksEach)):remaining;if(count<=0)return null;
  if(free<o.pop*count+buffer)return build('farm',96);
  const cost=Object.fromEntries(resources.map(r=>[r,o.cost[r]*count])) as Resources;
  if(resources.some(r=>cost[r]>v!.storage))return build('storehouse',96);
  const b:string[]=[...o.blockers,...blockers()];
  if(v!.training[u.building].length)b.push('TRAIN_QUEUE_BUSY');
  for(const r of resources)if(v!.resourcesMilli[r]<cost[r]*1000&&!b.includes('INSUFFICIENT_RESOURCES'))b.push('INSUFFICIENT_RESOURCES');
  const funded=Math.max(state.world.tick,...resources.map(r=>state.world.tick+Math.max(0,Math.ceil((cost[r]*1000-v!.resourcesMilli[r])/v!.productionPerTickMilli[r]))));
  const capture=conquestCaptureTick(context,c!,funded+o.ticksEach*(unit==='raider'?remaining:count));
  if(capture===null||capture+60>state.world.endsAtTick)b.push('ROUND_END_TOO_SOON');
  if(count>(rules.rules.ECONOMY as {trainBatchMax:number}).trainBatchMax)b.push('BATCH_CAPACITY');
  return {id:`${state.world.epoch}:${v!.id}:conquest:train:${unit}:${goal}`,advisor:'conquest',villageId:v!.id,villageName:v!.name,
   action:{type:'train',village:v!.id,unit,count},buildingName:`Conquest ${unit}`,currentLevel:owned,targetLevel:owned+count,
   importance:90,reason:'Fund the bounded escort in minute-long Raider batches and one reusable Envoy; no recurring Raider stream. Paid defensive troops remain at home.',requirements:cost,
   blockers:[...new Set(b)],status:b.length?'waiting':'ready',affordableAtTick:funded};
 }
 const producers=['lumberyard','quarry','mine'] as const;
 const deficient=producers.filter(b=>v.buildings[b]<15).sort((a,b)=>v.buildings[a]-v.buildings[b]||a.localeCompare(b));
 if(deficient.length){const p=build(deficient[0]);if(p)retained.push(p);return retained;}
 let next=nextConquestBuilding(v.buildings,rules);
 let construction=next?build(next):null;
 // Saved prototype's funding fallback: compare paying for a producer with saving for this bill.
 if(construction?.blockers.length===1&&construction.blockers[0]==='INSUFFICIENT_RESOURCES'){
  let best:{p:Proposal;ticks:number}|undefined;
  for(const [building,resource] of [['lumberyard','timber'],['quarry','stone'],['mine','iron']] as const){
   const o=v.options.build.find(o=>o.building===building);if(!o?.ok||o.level>20||free<o.pop+buffer)continue;
   const income=(rules.tables.production as {perTickMilli:number}[])[o.level]?.perTickMilli;if(!income)continue;
   const f=fundingUpgrade({stockMilli:v.resourcesMilli,incomeMilli:v.productionPerTickMilli,bill:construction.requirements,upgradeCost:o.cost,ticks:o.ticks,resource,newIncomeMilli:income});
   const p=build(building);if(f.improves&&p?.status==='ready'&&(!best||f.upgradeTicks<best.ticks))best={p,ticks:f.upgradeTicks};
  }
  if(best)construction=best.p;
 }
 if(construction)retained.push(construction);
 if(plan.escort&&plan.waves===0&&v.buildings.barracks>=10){const p=train('raider',plan.escort);if(p)retained.push(p);}
 if(!next){const p=train('envoy',1);if(p)retained.push(p);}
 const raiders=v.units.home.raider??0;
 if(!next&&(v.units.home.envoy??0)>=1&&raiders>0&&!Object.values(v.training).some(q=>q.length)&&
   !state.commands.outgoing.some(cmd=>cmd.from.id===v.id)&&c.map?.tick===state.world.tick&&
   c.map.villages.find(t=>t.id===plan.targetId)?.ownerId===null&&c.assessment?.tick===state.world.tick&&
   c.assessment.raiders===raiders&&c.assessment.battle.winner==='attacker'&&(c.assessment.battle.attackerSurvivors.envoy??0)>=1){
  const capture=conquestCaptureTick(context,c),b=blockers();
  if(plan.waves>=6||capture===null||capture+60>state.world.endsAtTick)b.push('ROUND_END_TOO_SOON');
  if((v.units.home.pikeman??0)<150)b.push('HOME_DEFENCE_CHANGED');
  retained.push({id:`${state.world.epoch}:${v.id}:conquest:send:${plan.waves}`,advisor:'conquest',villageId:v.id,villageName:v.name,
   action:{type:'send',village:v.id,target:plan.targetId!,kind:'attack',units:{raider:raiders,envoy:1}},buildingName:'Conquest attack',currentLevel:raiders,targetLevel:plan.waves+1,
   importance:94,reason:'Fresh unowned target, server-simulated surviving Envoy and retained 150 Pikemen. Confirm each battle before reusing the Envoy; stop after capture or six waves.',requirements:{timber:0,stone:0,iron:0},blockers:b,status:b.length?'waiting':'ready',affordableAtTick:state.world.tick});
 }
 return retained;
}
