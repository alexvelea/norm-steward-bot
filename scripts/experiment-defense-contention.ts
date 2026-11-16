/** Matched paid resource-contention fixture, followed by a bounded window of continuous control.
 * Skip only provably blocked executor intervals;
 * never project resources, options, troop completions or outcomes locally. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {PrivateSandbox,sandbox as broker} from '../src/review/sandbox-client.js';
import {Controller} from '../src/control/controller.js';
import {privateRead} from './experiment-raids.js';
import type {Remote} from '../src/control/remote.js';
import type {SavedControl} from '../src/control/types.js';
import type {Action,StateResponse,ReportsResponse} from '../src/shared/api.js';

const run=process.env.STEWARD_REVIEW_RUN!;assert.ok(run);
// A confirmed 429 did not advance the clock. Pace step/read retries without
// retrying ambiguous failures or changing an action request ID.
let lastBrokerCall=0;
function sandbox<T>(request:Record<string,unknown>):T {
 for(let attempt=0;;attempt++){
  const delay=Math.max(0,lastBrokerCall+550-Date.now());
  if(delay)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,delay);
  lastBrokerCall=Date.now();
  try{return broker<T>(request);}catch(error){
   if(!String(error).includes('HTTP 429')||attempt>=3)throw error;
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1500);
  }
 }
}
const baselineCommit='9816f29b860b763b37b09d2c687f70760dafdda0';
const duration=10800;
const windowTicks=Number(process.env.STEWARD_CONTENTION_TICKS??150);
assert.ok(Number.isSafeInteger(windowTicks)&&windowTicks>=150&&windowTicks<=600);
let until=0;
let start=0;
const root=run+'/defense-cadence-baseline-src';
for(const path of execFileSync('git',['ls-tree','-r','--name-only',baselineCommit,'src'],{encoding:'utf8'}).trim().split('\n')){
 const target=root+'/'+path.slice(4);await mkdir(dirname(target),{recursive:true});await writeFile(target,execFileSync('git',['show',baselineCommit+':'+path]));
}
const {Controller:BaselineController}=await import(root+'/control/controller.ts');
const results:any[]=[];
// A completed baseline is reusable only with the same controller revision and
// exact server endpoints. Keep its source receipts attached to the comparison;
// an interrupted candidate is never promoted to a completed result.
const baselineArtifact=process.env.STEWARD_CONTENTION_BASELINE;
if(baselineArtifact){
 const previous=JSON.parse(await readFile(baselineArtifact,'utf8'));
 assert.equal(previous.taskId,'sustained-defense-full-round-cadence');
 assert.equal(previous.baselineCommit,baselineCommit);assert.equal(previous.duration,duration);
 const row=previous.results.find((r:any)=>r.policy==='baseline');
 assert.ok(row?.deleted&&row.final&&row.finalTick-row.initialTick===windowTicks,'completed baseline with exact requested window');
 assert.ok(row.actions.every((a:any)=>a.results.every((r:any)=>r.ok)));
 start=row.initialTick;until=row.finalTick;results.push(row);
}
const output=run+'/defense-contention-comparison.json';
const save=(passed=false,error?:string)=>writeFile(output,JSON.stringify({taskId:'sustained-defense-full-round-cadence',baselineCommit,baselineArtifact,baselineReceipts:baselineArtifact?dirname(baselineArtifact)+'/sandbox-events.jsonl':undefined,duration,start,until,passed,error,
 verdict:!passed?'inconclusive':results[1].cohortsCompleted>results[0].cohortsCompleted&&results[1].queueBusyTicks>results[0].queueBusyTicks?'supports-change':'rejects-change',cadence:'One tick / one second at actionable ticks. Forced waits skip only to the nearest authoritative queue event while construction blocks commands and every training lane is occupied or fixed-blocked. No resource or game simulation.',
 limitations:`Controlled resource-contention fixture, ${windowTicks} ticks at representative cadence. Full-round throughput and combat value remain unmeasured; infrastructure delay and recruitment spending must be compared explicitly.`,results},null,2));
let interrupted=false;process.once('SIGTERM',()=>{interrupted=true;});
try{
 for(const policy of baselineArtifact?['candidate']:['baseline','candidate']){
  const box=new PrivateSandbox(73430,duration),row:any={policy,worldId:box.world.id,setup:[],actions:[],samples:[],forcedWaits:[],queueBusyTicks:0,eligibleTicks:0,commandOpenTicks:0,cycles:0};results.push(row);
  try{
   let state=box.join(),now=0;const rules=box.rules();
   const step=(tick:number)=>{while(tick>state.world.tick)state=sandbox<StateResponse>({op:'step',world:box.world.id,ticks:Math.min(3600,tick-state.world.tick)});};
   const setupAct=(action:Action)=>{
    if(interrupted)throw new Error('Bounded experiment interrupted during setup');
    const before=structuredClone(state.villages[0].resourcesMilli),response=box.act([action]);assert.ok(response.results[0].ok,JSON.stringify(response.results));state=response.state!;
    row.setup.push({tick:state.world.tick,action,results:response.results,spend:Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,(before[r]-state.villages[0].resourcesMilli[r])/1000]))});
   };
   const build=(building:Extract<Action,{type:'build'}>['building'])=>{
    const o=state.villages[0].options.build.find(o=>o.building===building)!;
    step(Math.max(state.world.tick,state.player.nextActTick??0,o.affordableAtTick??0));setupAct({type:'build',village:state.villages[0].id,building});
    step(Math.max(state.world.tick,...state.villages[0].buildQueue.map(q=>q.endTick)));
   };
   for(let n=0;n<4;n++)for(const b of ['lumberyard','quarry','mine'] as const)build(b);
   for(let n=0;n<4;n++)build('hall');build('barracks');build('smithy');build('smithy');
   for(const [unit,count] of [['pikeman',10],['shieldman',5],['raider',10]] as const){
    const v=state.villages[0],o=v.options.train.find(o=>o.unit===unit)!;
    const wait=Math.max(0,...(['timber','stone','iron'] as const).map(r=>Math.ceil((o.cost[r]*count*1000-v.resourcesMilli[r])/v.productionPerTickMilli[r])));
    step(Math.max(state.world.tick+wait,state.player.nextActTick??0));setupAct({type:'train',village:v.id,unit,count});
    step(Math.max(state.world.tick,...state.villages[0].training.barracks.map(q=>q.endTick)));
   }
   // Ordinary paid protection/population setup removes higher-priority opening work.
   build('storehouse');build('storehouse');build('cellar');build('farm');
   for(let n=0;n<4;n++)build('wall');
   // A Barracks upgrade competes with training. Ensure funding for the complete
   // current cohort, without projecting any server outcomes or altering stocks.
   const v0=state.villages[0], p0=v0.options.train.find(o=>o.unit==='pikeman')!, s0=v0.options.train.find(o=>o.unit==='shieldman')!;
   const bundles=Math.ceil(61/(3*p0.ticksEach+s0.ticksEach));
   const need=Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,bundles*(3*p0.cost[r]+s0.cost[r])]));
   const wait=Math.max(0,...(['timber','stone','iron'] as const).map(r=>Math.ceil((need[r]*1000-v0.resourcesMilli[r])/v0.productionPerTickMilli[r])));
   step(state.world.tick+wait);
   start=state.world.tick;until=start+windowTicks;
   assert.ok(until<duration);

   row.initial=structuredClone(state.villages[0]);row.initialTick=state.world.tick;
   row.clockStatus=state.world.status;row.planningWorldStatus='running';
   assert.equal(state.world.actIntervalTicks,null,'forced queue waits assume this no-Council-interval round');
   const settings={serverUrl:'https://sandbox.invalid',worldId:box.world.id,apiKey:'sandbox-no-credential'};
   let saved:SavedControl={settings,pending:null,automatic:false,decisions:[]};
   const storage={load:async()=>structuredClone(saved),save:async(v:SavedControl)=>{saved=structuredClone(v);}};
   const planning=()=>({...state,world:{...state.world,status:state.world.status==='ended'?'ended' as const:'running' as const}});
   const remote:Remote=async<T>(_s:unknown,path:string,body?:unknown):Promise<T>=>{
    if(path==='/me')return {account:{id:state.player.id},worlds:[],sandboxes:[]} as T;
    if(path==='/worlds')return [planning().world] as T;
    if(path.endsWith('/state'))return planning() as T;
    if(path.endsWith('/rules'))return rules as T;
    if(path.endsWith('/history'))return {samples:[]} as T;
    if(path.endsWith('/reports'))return sandbox<ReportsResponse>({op:'read',world:box.world.id,resource:'reports'}) as T;
    if(path.endsWith('/map'))return privateRead(box,'/map') as T;
    if(path.includes('/reports/'))return privateRead(box,path.slice(path.indexOf('/reports/'))) as T;
    if(path.endsWith('/simulate/battle'))return privateRead(box,'/simulate/battle',body) as T;
    assert.ok(path.endsWith('/actions'),path);
    const action=(body as {actions:Action[]}).actions[0];assert.deepEqual(saved.pending!.action,action,'journal before write');
    const before=structuredClone(state.villages[0].resourcesMilli),response=box.act([action]);
    row.actions.push({tick:state.world.tick,action,proposal:structuredClone(saved.pending!.proposal),results:response.results,
     spend:Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,(before[r]-response.state!.villages[0].resourcesMilli[r])/1000]))});
    assert.ok(response.results[0].ok,JSON.stringify(response.results));state=response.state!;return response as T;
   };
   const Factory=policy==='baseline'?BaselineController:Controller;
   const c:Controller=await Factory.create(storage,settings,remote,()=>now);await c.cycle();await c.setAutomatic(true);
   const units=rules.rules.UNITS as Record<string,{building:keyof StateResponse['villages'][0]['training'];buildingLevel:number;smithyLevel:number}>;
   while(state.world.tick<until){
    await new Promise<void>(resolve=>setImmediate(resolve));
    if(interrupted)throw new Error('Bounded experiment interrupted');
    now=state.world.tick*1000+1000;await c.cycle();row.cycles++;assert.equal(c.snapshot().error,null);
    const v=state.villages[0],view=c.snapshot();
    // Queue events can unlock units or change the home force. Stop at the FIRST unit,
    // construction or command event, even if its queue remains occupied afterwards.
    const events=[until,...v.buildQueue.map(q=>q.endTick),...Object.values(v.training).flat().map(q=>q.nextTick??q.endTick),...state.commands.outgoing.map(q=>q.arrivalTick)]
      .filter(t=>t>state.world.tick);
    const noTrainLane=Object.entries(units).every(([id,u])=>{
     if(v.buildings[u.building]<u.buildingLevel||v.buildings.smithy<u.smithyLevel)return true;
     if(v.training[u.building].length)return true;
     // A newly available starter unit could appear as the current cohort completes;
     // that is why every training nextTick is included in events above.
     const proposals=view.proposals.filter(p=>p.action.type==='train'&&p.action.unit===id);
     return proposals.length===0||proposals.every(p=>p.blockers.some(b=>['POPULATION_CAPACITY','STORAGE_CAPACITY','ROUND_END_TOO_SOON','PREREQUISITE'].includes(b)));
    });
    const forced=v.buildQueue.length>0&&noTrainLane&&!saved.pending&&
     !view.proposals.some(p=>p.action.type==='train'&&p.status==='ready');
    const next=forced?Math.min(...events):state.world.tick+1,delta=next-state.world.tick;
    if(delta>1)row.forcedWaits.push({from:state.world.tick,to:next,reason:'Construction occupied; every training lane occupied, locked, capped or fixed-blocked; commands defer to construction.'});
    if(v.training.barracks.length)row.queueBusyTicks+=delta;
    if((v.units.home.pikeman??0)>=10&&(v.units.home.shieldman??0)>=5&&(v.units.home.raider??0)>=10)row.eligibleTicks+=delta;
    if(!v.buildQueue.length&&(v.units.home.scout??0)>=2)row.commandOpenTicks+=delta;
    if(row.cycles%50===0||row.actions.at(-1)?.tick===state.world.tick){
     row.samples.push({tick:state.world.tick,units:structuredClone(v.units),training:structuredClone(v.training),buildings:structuredClone(v.buildings),stocks:structuredClone(v.resourcesMilli),selected:view.selection.selected?.action});
    }
    if(row.cycles%25===0){await save();console.log(JSON.stringify({policy,tick:state.world.tick,cycles:row.cycles,actions:row.actions.length}));}
    state=sandbox<StateResponse>({op:'step',world:box.world.id,ticks:delta});
   }
   now=until*1000+1000;await c.setAutomatic(false);await c.cycle();assert.equal(c.snapshot().error,null);
   row.final=structuredClone(state.villages[0]);row.finalTick=state.world.tick;
   const cohorts=row.actions.filter((a:any)=>a.proposal.defenseBatch&&a.action.unit==='pikeman');
   row.cohortsStarted=cohorts.length;
   row.cohortsCompleted=cohorts.filter((a:any)=>row.final.units.home.pikeman>=a.proposal.defenseBatch.baselinePikemen+a.proposal.defenseBatch.pikemen&&row.final.units.home.shieldman>=a.proposal.defenseBatch.baselineShieldmen+a.proposal.defenseBatch.shieldmen).length;
   row.firstCohortTick=cohorts[0]?.tick;
   row.spend=Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,row.actions.reduce((n:number,a:any)=>n+a.spend[r],0)]));
   row.recruitmentSpend=Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,row.actions.filter((a:any)=>a.action.type==='train').reduce((n:number,a:any)=>n+a.spend[r],0)]));
   row.retainedProduction=Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,(row.final.resourcesMilli[r]-row.initial.resourcesMilli[r])/1000+row.spend[r]]));
   row.commands=row.actions.filter((a:any)=>a.action.type==='send').length;
   row.utilisation=row.queueBusyTicks/(until-row.initialTick);
   console.log(JSON.stringify({policy,finalTick:row.finalTick,cohortsCompleted:row.cohortsCompleted,utilisation:row.utilisation,units:row.final.units,stocks:row.final.resourcesMilli}));
  }finally{box.close();row.deleted=true;await save();}
 }
 const [a,b]=results;assert.equal(a.initialTick,b.initialTick);for(const key of ['buildings','resourcesMilli','population','units'])assert.deepEqual(a.initial[key],b.initial[key]);
 assert.ok(results.every(r=>r.finalTick===until&&r.deleted));
 assert.ok(results.every(r=>r.actions.every((a:any)=>a.results.every((x:any)=>x.ok))),'every ordinary action succeeds');
 await save(true);console.log('Matched scarce-input construction comparison completed.');
}catch(error){await save(false,String(error));throw error;}
