/** Matched paid opening, followed by uninterrupted control to the private round end.
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
const decisionTicks=Number(process.env.STEWARD_EXPERIMENT_CADENCE??1);
assert.ok(Number.isSafeInteger(decisionTicks)&&decisionTicks>=1&&decisionTicks<=10);
const duration=Number(process.env.STEWARD_EXPERIMENT_TICKS??2700);
const until=Number(process.env.STEWARD_EXPERIMENT_UNTIL??duration);
const contention=process.env.STEWARD_EXPERIMENT_FIXTURE==='contention';
let start=Number(process.env.STEWARD_EXPERIMENT_START??1800);
assert.ok(start<until&&until<=duration);
const root=run+'/defense-cadence-baseline-src';
for(const path of execFileSync('git',['ls-tree','-r','--name-only',baselineCommit,'src'],{encoding:'utf8'}).trim().split('\n')){
 const target=root+'/'+path.slice(4);await mkdir(dirname(target),{recursive:true});await writeFile(target,execFileSync('git',['show',baselineCommit+':'+path]));
}
const {Controller:BaselineController}=await import(root+'/control/controller.ts');
const prefix=process.argv.includes('--prefix');
const results:any[]=[];
if(prefix){
 const previous=JSON.parse(await readFile(run+'/defense-round-attempt.json','utf8'));
 const r=previous.results[0],sample=r.samples.find((s:any)=>s.tick===until);assert.ok(sample,'exact authoritative baseline endpoint');
 r.actions=r.actions.filter((a:any)=>a.tick<=until);r.samples=r.samples.filter((s:any)=>s.tick<=until);
 r.final={buildings:sample.buildings,units:sample.units,resourcesMilli:sample.stocks,training:sample.training};r.finalTick=until;
 const intervals=r.actions.filter((a:any)=>a.action.type==='train'&&['pikeman','shieldman','raider'].includes(a.action.unit)).map((a:any)=>[a.tick,Math.min(until,a.results[0].data.batch.endTick)]).sort((a:number[],b:number[])=>a[0]-b[0]);
 let end=start,busy=0;for(const [a,b] of intervals){busy+=Math.max(0,b-Math.max(end,a));end=Math.max(end,b);}
 r.queueBusyTicks=busy;r.utilisation=busy/(until-start);r.deleted=true;
 delete r.cycles;delete r.eligibleTicks;
 r.forcedWaits=r.forcedWaits.filter((w:any)=>w.from<until).map((w:any)=>({...w,to:Math.min(w.to,until)}));
 r.retainedProduction=Object.fromEntries((['timber','stone','iron'] as const).map(x=>[x,(r.final.resourcesMilli[x]-r.initial.resourcesMilli[x])/1000+r.actions.reduce((n:number,a:any)=>n+a.spend[x],0)]));r.exactEndpoint='Authoritative post-cycle sample from this run, including endpoint allocation';
 const cohorts=r.actions.filter((a:any)=>a.proposal.defenseBatch&&a.action.unit==='pikeman');
 r.cohortsStarted=cohorts.length;r.cohortsCompleted=cohorts.filter((a:any)=>r.final.units.home.pikeman>=a.proposal.defenseBatch.baselinePikemen+a.proposal.defenseBatch.pikemen&&r.final.units.home.shieldman>=a.proposal.defenseBatch.baselineShieldmen+a.proposal.defenseBatch.shieldmen).length;
 for(const [key,onlyTrain] of [['spend',false],['recruitmentSpend',true]] as const)r[key]=Object.fromEntries((['timber','stone','iron'] as const).map(x=>[x,r.actions.filter((a:any)=>!onlyTrain||a.action.type==='train').reduce((n:number,a:any)=>n+a.spend[x],0)]));
 results.push(r);
}
const output=run+(prefix?'/defense-prefix-comparison.json':'/defense-cadence-comparison.json');
const save=(passed=false,error?:string)=>writeFile(output,JSON.stringify({taskId:'sustained-defense-full-round-cadence',baselineCommit,duration,start,until,passed,error,
 verdict:!passed?'inconclusive':results[1].cohortsCompleted>results[0].cohortsCompleted&&results[1].queueBusyTicks>results[0].queueBusyTicks?'supports-change':'rejects-change',decisionTicks,cadence:`Decisions at most ${decisionTicks} ticks apart, stopping at every server queue event. When decisionTicks > 1 this is a bounded coarse-cadence comparison, not live one-second utilisation. Forced waits stop at the first authoritative queue event or conservative training funding boundary while construction blocks commands. No resource or game simulation.`,
 limitations:`Single seed, ${contention?'scarce-input':'production'} matched paid setup to tick ${start}, then continuous control to ${until} of ${duration}. Standard 10800-tick throughput remains unmeasured. No opponents: command availability does not establish targets, combat value or live raid profitability.`,results},null,2));
let interrupted=false;process.once('SIGTERM',()=>{interrupted=true;});
try{
 for(const policy of prefix?['candidate']:['baseline','candidate']){
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
   for(let n=0;n<(contention?4:6);n++)for(const b of ['lumberyard','quarry','mine'] as const)build(b);
   for(let n=0;n<4;n++)build('hall');build('barracks');build('smithy');build('smithy');
   for(const [unit,count] of [['pikeman',10],['shieldman',5],['raider',10]] as const){
    const v=state.villages[0],o=v.options.train.find(o=>o.unit===unit)!;
    const wait=Math.max(0,...(['timber','stone','iron'] as const).map(r=>Math.ceil((o.cost[r]*count*1000-v.resourcesMilli[r])/v.productionPerTickMilli[r])));
    step(Math.max(state.world.tick+wait,state.player.nextActTick??0));setupAct({type:'train',village:v.id,unit,count});
    step(Math.max(state.world.tick,...state.villages[0].training.barracks.map(q=>q.endTick)));
   }
   if(contention){
    build('storehouse');build('storehouse');build('cellar');build('farm');
    for(let n=0;n<4;n++)build('wall');
    const v=state.villages[0],p=v.options.train.find(o=>o.unit==='pikeman')!,s=v.options.train.find(o=>o.unit==='shieldman')!;
    const bundles=Math.ceil(61/(3*p.ticksEach+s.ticksEach));
    const wait=Math.max(0,...(['timber','stone','iron'] as const).map(r=>Math.ceil((bundles*(3*p.cost[r]+s.cost[r])*1000-v.resourcesMilli[r])/v.productionPerTickMilli[r])));
    step(state.world.tick+wait);start=state.world.tick;
   }else{step(start);assert.equal(state.world.tick,start);}
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
    // While construction blocks commands, resources are the only changing input
    // between server queue events. Stop at the earliest possible training funding
    // boundary, including the ENTIRE unqueued defensive cohort (not just this part).
    let trainingBoundary=Infinity;
    for(const [id,u] of Object.entries(units)){
     if(v.buildings[u.building]<u.buildingLevel||v.buildings.smithy<u.smithyLevel)continue;
     const proposals=view.proposals.filter(p=>p.action.type==='train'&&p.action.unit===id);
     for(const p of proposals){
      if(p.blockers.some(b=>['POPULATION_CAPACITY','POPULATION_OR_BATCH_CAPACITY','STORAGE_CAPACITY','ROUND_END_TOO_SOON','PREREQUISITE','EXTERNAL_ORDERS'].includes(b)))continue;
      if(v.training[u.building].length&&!p.defenseBatch)continue;
      // Fully queued cohorts have no proposal; an occupied lane cannot start a new one.
      if(p.blockers.some(b=>['TRAIN_QUEUE_BUSY','EXECUTOR_QUEUE_BUSY'].includes(b)))continue;
      const option=v.options.train.find(o=>o.unit===id)!;
      const cost={...option.cost}; // One recruit is a conservative lower bound for non-cohort proposals.
      if(p.defenseBatch){
       const plan=p.defenseBatch;
       const remaining=(unit:'pikeman'|'shieldman',baseline:number,count:number)=>Math.min(count,Math.max(0,baseline+count-(v.units.home[unit]??0)-(v.units.away[unit]??0)-v.training.barracks.filter(q=>q.unit===unit).reduce((n,q)=>n+q.remaining,0)));
       const rp=remaining('pikeman',plan.baselinePikemen,plan.pikemen),rs=remaining('shieldman',plan.baselineShieldmen,plan.shieldmen);
       const po=v.options.train.find(o=>o.unit==='pikeman')!,so=v.options.train.find(o=>o.unit==='shieldman')!;
       for(const r of ['timber','stone','iron'] as const)cost[r]=rp*po.cost[r]+rs*so.cost[r];
      }
      const wait=Math.max(0,...(['timber','stone','iron'] as const).map(r=>cost[r]*1000<=v.resourcesMilli[r]?0:v.productionPerTickMilli[r]>0?Math.ceil((cost[r]*1000-v.resourcesMilli[r])/v.productionPerTickMilli[r]):Infinity));
      trainingBoundary=Math.min(trainingBoundary,state.world.tick+Math.max(1,wait));
     }
    }
    const forced=v.buildQueue.length>0&&!saved.pending&&!view.proposals.some(p=>p.action.type==='train'&&p.status==='ready');
    const next=forced?Math.min(...events,trainingBoundary):Math.min(...events,state.world.tick+decisionTicks),delta=next-state.world.tick;
    if(forced&&delta>1)row.forcedWaits.push({from:state.world.tick,to:next,reason:'Construction occupied; stop at first server queue event or conservative training funding boundary; commands defer to construction.'});
    if(v.training.barracks.length)row.queueBusyTicks+=delta;
    if((v.units.home.pikeman??0)>=10&&(v.units.home.shieldman??0)>=5&&(v.units.home.raider??0)>=10)row.eligibleTicks+=delta;
    if(!v.buildQueue.length&&(v.units.home.scout??0)>=2)row.commandOpenTicks+=delta;
    if(row.cycles%50===0||row.actions.at(-1)?.tick===state.world.tick){
     row.samples.push({tick:state.world.tick,units:structuredClone(v.units),training:structuredClone(v.training),buildings:structuredClone(v.buildings),stocks:structuredClone(v.resourcesMilli),selected:view.selection.selected?.action});
    }
    if(row.cycles%25===0){await save();console.log(JSON.stringify({policy,tick:state.world.tick,cycles:row.cycles,actions:row.actions.length}));}
    state=sandbox<StateResponse>({op:'step',world:box.world.id,ticks:delta});
   }
   now=until*1000+1000;if(prefix)await c.cycle();await c.setAutomatic(false);await c.cycle();assert.equal(c.snapshot().error,null);
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
 const [a,b]=results;for(const key of ['buildings','resourcesMilli','population','units'])assert.deepEqual(a.initial[key],b.initial[key]);
 assert.ok(results.every(r=>r.finalTick===until&&r.deleted));
 assert.ok(results.every(r=>r.actions.every((a:any)=>a.results.every((x:any)=>x.ok))),'every ordinary action succeeds');
 await save(true);console.log(prefix?'Matched prefix comparison completed.':'Whole shortened-round comparison completed.');
}catch(error){await save(false,String(error));throw error;}
