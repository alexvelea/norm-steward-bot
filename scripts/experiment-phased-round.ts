/** Matched live-server opening comparison using the complete durable executor. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {PrivateSandbox,sandbox} from '../src/review/sandbox-client.js';
import {Controller} from '../src/control/controller.js';
import {privateRead} from './experiment-raids.js';
import type {Remote} from '../src/control/remote.js';
import type {SavedControl} from '../src/control/types.js';
import type {Action,StateResponse} from '../src/shared/api.js';
const run=process.env.STEWARD_REVIEW_RUN!, base=process.env.STEWARD_BASELINE_COMMIT!;
const duration=Number(process.env.STEWARD_EXPERIMENT_TICKS??10800), cadence=30;
assert.ok(Number.isSafeInteger(duration)&&duration>=600&&duration<=10800);
let interrupted=false;process.once('SIGTERM',()=>{interrupted=true;});
const policies=(process.env.STEWARD_EXPERIMENT_POLICIES??'baseline,candidate').split(',');
assert.ok(run&&base);
const producerBuildings=['lumberyard','quarry','mine'] as const;
const producerMilestones=[8,10,15,20] as const;
function villageTelemetry(state:StateResponse,capitalId:string){
 return state.villages.map(v=>{
  const support={pikeman:0,scout:0};
  for(const stack of v.supportHere){
   support.pikeman+=stack.units.pikeman??0;
   support.scout+=stack.units.scout??0;
  }
  return {
   id:v.id,name:v.name,role:v.id===capitalId?'capital':'economic',
   buildings:{wall:v.buildings.wall,mine:v.buildings.mine,quarry:v.buildings.quarry,
    lumberyard:v.buildings.lumberyard,hall:v.buildings.hall,barracks:v.buildings.barracks,
    market:v.buildings.market},
   home:{pikeman:v.units.home.pikeman??0,scout:v.units.home.scout??0,raider:v.units.home.raider??0},
   stationedSupport:support,resources:structuredClone(v.resources),resourcesMilli:structuredClone(v.resourcesMilli),
  };
 });
}
function recordVillageMilestones(row:any,state:StateResponse,capitalId:string){
 for(const v of state.villages){
  const milestone=row.villageMilestones[v.id]??(row.villageMilestones[v.id]={
   id:v.id,name:v.name,role:v.id===capitalId?'capital':'economic',wall10:null,
   producers:Object.fromEntries(producerMilestones.map(level=>[level,null])),
  });
  milestone.name=v.name;milestone.role=v.id===capitalId?'capital':'economic';
  if(milestone.wall10===null&&v.buildings.wall>=10)milestone.wall10=state.world.tick;
  const minimum=Math.min(...producerBuildings.map(building=>v.buildings[building]));
  for(const level of producerMilestones){
   if(milestone.producers[level]===null&&minimum>=level)milestone.producers[level]=state.world.tick;
  }
 }
}
function recordCaptureTicks(row:any,state:StateResponse,seenOwned:Set<string>){
 for(const v of state.villages){
  if(seenOwned.has(v.id))continue;
  seenOwned.add(v.id);
  row.captureTicks.push({tick:state.world.tick,villageId:v.id,villageName:v.name});
 }
}
function summarizeRun(row:any,state:StateResponse,capitalId:string){
 row.finalVillages=villageTelemetry(state,capitalId);
 row.summary={
  captureTicks:row.captureTicks,
  perVillageMilestones:Object.values(row.villageMilestones).sort((a:any,b:any)=>a.id.localeCompare(b.id)),
  supportSendCount:row.supportSends.length,recallSendCount:row.recallSends.length,
  finalVillages:row.finalVillages,rejectedActionCount:row.rejectedActionCount,
  uncertainActionCount:row.uncertainActionCount,
 };
 console.log(JSON.stringify({policy:row.policy,summary:row.summary}));
}
function assertActionResults(row:any){
 for(const result of row.actionResults.splice(0))assert.ok(result.ok,JSON.stringify([result]));
}
const root=run+'/baseline-src';
for(const path of execFileSync('git',['ls-tree','-r','--name-only',base,'src'],{encoding:'utf8'}).trim().split('\n')){
 const target=root+'/'+path.slice(4);await mkdir(dirname(target),{recursive:true});await writeFile(target,execFileSync('git',['show',base+':'+path]));
}
const {Controller:BaselineController}=await import(root+'/control/controller.ts');
const results:any[]=[];
const save=(passed=false,error?:string)=>writeFile(run+'/'+(process.env.STEWARD_EXPERIMENT_OUTPUT??'phased-round-comparison.json'),JSON.stringify({taskId:'phased-economy-full-round-allocation',baselineCommit:base,duration,cadence,passed,error,verdict:'inconclusive',evaluation:'At most 30 ticks between decisions, stopping at construction/training queue ends, command arrivals, and the President resource reservation; one shared executor; paused server clock; both planners see running; no opponents',results},null,2));
try{
 for(const policy of policies){
  const box=new PrivateSandbox(73430,10800), row:any={policy,world:box.world,charges:[],milestones:[],samples:[],idleReasons:{},queueBusyTicks:0,constructionBusyTicks:0,captureTicks:[],villageMilestones:{},supportSends:[],recallSends:[],actionResults:[],rejectedActionCount:0,uncertainActionCount:0};results.push(row);
  let latestState:StateResponse|undefined, capitalId:string|undefined;
  try{
   let state=box.join(), now=0;const rules=box.rules();capitalId=state.villages[0]!.id;latestState=state;const seenOwned=new Set(state.villages.map(v=>v.id));row.capitalVillageId=capitalId;row.initial=structuredClone(state.villages[0]);row.initialVillages=villageTelemetry(state,capitalId);row.clockStatus=state.world.status;row.planningStatus='running';recordVillageMilestones(row,state,capitalId);
   const settings={serverUrl:'https://sandbox.invalid',worldId:box.world.id,apiKey:'sandbox-no-credential'};
   let saved:SavedControl={settings,pending:null,automatic:false,decisions:[]};
   const seenDecisionIds=new Set<string>();
   const storage={load:async()=>structuredClone(saved),save:async(v:SavedControl)=>{for(const decision of v.decisions??[]){if(seenDecisionIds.has(decision.id))continue;seenDecisionIds.add(decision.id);if(decision.kind==='rejected')row.rejectedActionCount++;if(decision.kind==='uncertain')row.uncertainActionCount++;}saved=structuredClone(v);}};
   const planning=()=>({...state,world:{...state.world,status:state.world.status==='ended'?'ended' as const:'running' as const}});
   const remote:Remote=async<T>(_s:unknown,path:string,body?:unknown):Promise<T>=>{
    if(path==='/me')return {account:{id:state.player.id},worlds:[],sandboxes:[]} as T;
    if(path==='/worlds')return [planning().world] as T;
    if(path.endsWith('/state'))return planning() as T;
    if(path.endsWith('/rules'))return rules as T;
    if(path.endsWith('/history'))return {samples:[]} as T;
    if(path.endsWith('/reports'))return {reports:[],next:null} as T;
    if(path.endsWith('/map'))return privateRead(box,'/map') as T;
    if(path.endsWith('/simulate/battle'))return privateRead(box,'/simulate/battle',body) as T;
    assert.ok(path.endsWith('/actions'),path);
    const action=(body as {actions:Action[]}).actions[0];assert.deepEqual(saved.pending!.action,action,'journal before write');
    const before=state.villages[0].resourcesMilli;
    let sendRecord:any;
    const villageName=(id:string)=>state.villages.find(v=>v.id===id)?.name??id;
    if(action.type==='send'&&action.kind==='support'){
     sendRecord={event:'support-send',tick:state.world.tick,from:{id:action.village,name:villageName(action.village)},to:{id:action.target,name:villageName(action.target)},units:structuredClone(action.units)};
    }else if(action.type==='recall'||action.type==='send_back'){
     const stack=state.villages.find(v=>v.id===action.village)?.supportHere.find(value=>value.home.id===action.home);
     sendRecord={event:'recall-send',tick:state.world.tick,from:{id:action.village,name:villageName(action.village)},to:{id:action.home,name:villageName(action.home)},units:structuredClone(action.units??stack?.units??{})};
    }
    let response:ReturnType<typeof box.act>;
    try{response=box.act([action]);}
    catch(error){
     if(sendRecord){sendRecord.outcome='uncertain';if(sendRecord.event==='support-send')row.supportSends.push(sendRecord);else row.recallSends.push(sendRecord);console.log(JSON.stringify({policy,event:sendRecord.event,...sendRecord}));}
     throw error;
    }
    row.actionResults.push(...response.results);state=response.state!;latestState=state;
    if(sendRecord){
     sendRecord.outcome=response.results[0]?.ok?'accepted':'rejected';
     if(sendRecord.event==='support-send')row.supportSends.push(sendRecord);else row.recallSends.push(sendRecord);
     console.log(JSON.stringify({policy,event:sendRecord.event,...sendRecord}));
    }
    row.charges.push({minimumProducer:Math.min(...["lumberyard","quarry","mine"].map(b=>state.villages[0].buildings[b as "mine"])),results:response.results,task:saved.pending!.proposal.task,tick:state.world.tick,action,spend:Object.fromEntries(['timber','stone','iron'].map(r=>[r,(before[r as 'timber']-state.villages[0].resourcesMilli[r as 'timber'])/1000]))});return response as T;
   };
   const Factory=policy==='baseline'?BaselineController:Controller;
   const c=await Factory.create(storage,settings,remote,()=>now);await c.cycle();assertActionResults(row);await c.setAutomatic(true);
   for(let iteration=0;iteration<2500&&state.world.tick<=duration;iteration++){
    if(interrupted)throw new Error('Bounded review interrupted; partial results are not a full-round comparison');
    now+=10000;await c.cycle();assertActionResults(row);assert.equal(c.snapshot().error,null);
    const v=state.villages[0];
    recordCaptureTicks(row,state,seenOwned);recordVillageMilestones(row,state,capitalId);
    for(const target of [5,8,10])if(!row.milestones.some((m:any)=>m.target===target)&&['lumberyard','quarry','mine'].every(b=>v.buildings[b as 'mine']>=target)){
     row.milestones.push({target,tick:state.world.tick,village:structuredClone(v),spending:row.charges.reduce((sum:any,x:any)=>Object.fromEntries(['timber','stone','iron'].map(r=>[r,sum[r]+x.spend[r]])),{timber:0,stone:0,iron:0})});await save();console.log(JSON.stringify({policy,target,tick:state.world.tick}));
    }
    if(state.world.tick===duration)break;
    const events=[...v.buildQueue.map(q=>q.endTick),...Object.values(v.training).flat().map(q=>q.endTick),...state.commands.outgoing.map(q=>q.arrivalTick),...state.commands.incoming.map(q=>q.arrivalTick),state.player.nextActTick??0];
    const selected=c.snapshot().selection.selected;
    if(!saved.pending&&!selected){for(const r of c.snapshot().selection.reservations){const p=c.snapshot().proposals.find((p:any)=>p.id===r.proposalId);if(p?.affordableAtTick)events.push(p.affordableAtTick);}}
    const next=Math.min(...events.filter(t=>t>state.world.tick),Math.min(duration,state.world.tick+cadence));
    const delta=next-state.world.tick;
    if(v.training.barracks.length)row.queueBusyTicks+=delta;
    else {const p=c.snapshot().proposals.find((p:any)=>p.task==="military.pikemen-baseline"||p.task==="military.defence-scale");const key=p?p.blockers.join(',')||p.status:'not-unlocked';row.idleReasons[key]=(row.idleReasons[key]??0)+delta;}
    if(v.buildQueue.length)row.constructionBusyTicks+=delta;
    row.samples.push({tick:state.world.tick,productionPerTickMilli:v.productionPerTickMilli,buildings:v.buildings,units:v.units,resourcesMilli:v.resourcesMilli,population:v.population,training:v.training,selection:c.snapshot().selection,villages:villageTelemetry(state,capitalId)});
    if(iteration%50===0){await save();console.log(JSON.stringify({policy,tick:state.world.tick,actions:row.charges.length}));}
    state=sandbox<StateResponse>({op:'step',world:box.world.id,ticks:delta});latestState=state;
   }
   row.final=state.villages[0];assert.equal(state.world.tick,duration);assert.equal(state.world.status,'ended');
   await c.setAutomatic(false);
   const restarted=await Factory.create(storage,settings,remote,()=>now);await restarted.cycle();assert.equal(restarted.snapshot().automatic,false);
   row.finalTick=state.world.tick;row.finalStatus=state.world.status;row.grossProductionEstimate=c.snapshot().production;
   row.spending=Object.fromEntries(['build','train'].map(type=>[type,Object.fromEntries(['timber','stone','iron'].map(r=>[r,row.charges.filter((x:any)=>x.action.type===type).reduce((n:number,x:any)=>n+x.spend[r],0)]))]));
   row.retainedProduction=Object.fromEntries(['timber','stone','iron'].map(r=>[r,(row.final.resourcesMilli[r]-row.initial.resourcesMilli[r])/1000+row.spending.build[r]+row.spending.train[r]]));
   row.cohortsCompleted=Math.min(Math.floor((row.final.units.home.pikeman??0)/3),row.final.units.home.shieldman??0);
   row.passed=true;
  }finally{if(latestState&&capitalId)summarizeRun(row,latestState,capitalId);box.close();row.deleted=true;await save();}
 }
 if(results.length<2){await save(true);process.exitCode=0;}else{
 for(const k of ['buildings','resourcesMilli','population','units'])assert.deepEqual(results[0].initial[k],results[1].initial[k]);
 const candidate=results[1],trains=candidate.charges.filter((x:any)=>x.action.type==="train");
 assert.ok(trains.length>0,"candidate reaches sustainable recruitment");
 assert.ok(!trains.some((x:any)=>["shieldman","lancer"].includes(x.action.unit)),"candidate trains no Shieldmen or Lancers");
 assert.ok((candidate.final.buildings.wall??0)<=10,"candidate capital Wall stays at or below 10");
 assert.ok(results.every((r:any)=>r.deleted));

 await save(true);console.log('Matched comparison passed.');}

}catch(error){await save(false,String(error));throw error;}
