/** Matched ordinary-action server comparison of a cohort interrupted by a persisted pause.
 * Both policies plan as running; sandbox clocks stay paused except explicit one-tick steps.
 * No live settings or services are touched. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {PrivateSandbox,sandbox} from '../src/review/sandbox-client.js';
import {Controller} from '../src/control/controller.js';
import type {Remote} from '../src/control/remote.js';
import type {SavedControl} from '../src/control/types.js';
import type {Action,StateResponse} from '../src/shared/api.js';
const run=process.env.STEWARD_REVIEW_RUN!;
assert.ok(run);
const baselineCommit=process.env.STEWARD_BASELINE_COMMIT??'1845dade26d94a67a3889df7b22b4cfb9908364c';
const root=run+'/defense-recovery-baseline-src';
for(const path of execFileSync('git',['ls-tree','-r','--name-only',baselineCommit,'src'],{encoding:'utf8'}).trim().split('\n')){
 const target=root+'/'+path.slice(4);await mkdir(dirname(target),{recursive:true});await writeFile(target,execFileSync('git',['show',baselineCommit+':'+path]));
}
const {Controller:BaselineController}=await import(root+'/control/controller.ts');
const results:any[]=[];
const save=(passed=false,error?:string)=>writeFile(run+'/defense-recovery-comparison.json',JSON.stringify({taskId:'sustained-defense-utilisation',baselineCommit,passed,error,verdict:passed?'supports-change':'inconclusive',evaluation:'one game tick and one second between decisions; same paid setup and pause; one durable executor per private world; both plan as running',results},null,2));
try{
 for(const policy of ['baseline','candidate']){
  const box=new PrivateSandbox(73430,10800),row:any={policy,worldId:box.world.id,setup:[],actions:[],samples:[]};results.push(row);
  try{
   let state=box.join(),now=0;const rules=box.rules();
   const step=(tick:number)=>{while(tick>state.world.tick)state=sandbox<StateResponse>({op:'step',world:box.world.id,ticks:Math.min(3600,tick-state.world.tick)});};
   const setupAct=(action:Action)=>{
    const before=structuredClone(state.villages[0].resourcesMilli),response=box.act([action]);
    assert.ok(response.results[0].ok,JSON.stringify(response.results));state=response.state!;
    row.setup.push({tick:state.world.tick,action,results:response.results,spend:Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,(before[r]-state.villages[0].resourcesMilli[r])/1000]))});
   };
   const build=(building:Extract<Action,{type:'build'}>['building'])=>{
    const o=state.villages[0].options.build.find(o=>o.building===building)!;
    step(Math.max(state.world.tick,state.player.nextActTick??0,o.affordableAtTick??0));setupAct({type:'build',village:state.villages[0].id,building});
    step(Math.max(state.world.tick,...state.villages[0].buildQueue.map(q=>q.endTick)));
   };
   for(let n=0;n<6;n++)for(const b of ['lumberyard','quarry','mine'] as const)build(b);
   for(let n=0;n<4;n++)build('hall');build('barracks');build('smithy');build('smithy');
   for(const [unit,count] of [['pikeman',10],['shieldman',5],['raider',10]] as const){
    const v=state.villages[0],o=v.options.train.find(o=>o.unit===unit)!;
    const wait=Math.max(0,...(['timber','stone','iron'] as const).map(r=>Math.ceil((o.cost[r]*count*1000-v.resourcesMilli[r])/v.productionPerTickMilli[r])));
    step(Math.max(state.world.tick+wait,state.player.nextActTick??0));setupAct({type:'train',village:v.id,unit,count});
    step(Math.max(state.world.tick,...state.villages[0].training.barracks.map(q=>q.endTick)));
   }
   step(1800);row.initial=structuredClone(state.villages[0]);row.initialTick=state.world.tick;
   const settings={serverUrl:'https://sandbox.invalid',worldId:box.world.id,apiKey:'sandbox-no-credential'};
   let saved:SavedControl={settings,pending:null,automatic:false,decisions:[]};
   const storage={load:async()=>structuredClone(saved),save:async(v:SavedControl)=>{saved=structuredClone(v);}};
   const planning=()=>({...state,world:{...state.world,status:'running' as const}});
   const remote:Remote=async<T>(_s:unknown,path:string,body?:unknown):Promise<T>=>{
    if(path==='/me')return {account:{id:state.player.id},worlds:[],sandboxes:[]} as T;
    if(path==='/worlds')return [planning().world] as T;
    if(path.endsWith('/state'))return planning() as T;
    if(path.endsWith('/rules'))return rules as T;
    if(path.endsWith('/history'))return {samples:[]} as T;
    if(path.endsWith('/reports'))return {reports:[],next:null} as T;
    // This paid fixture has no Scouts or dispatch force; no synthetic intelligence is supplied.
    assert.ok(path.endsWith('/actions'),path);
    const action=(body as {actions:Action[]}).actions[0];assert.deepEqual(saved.pending!.action,action,'journal before write');
    const before=structuredClone(state.villages[0].resourcesMilli),response=box.act([action]);
    assert.ok(response.results[0].ok,JSON.stringify(response.results));state=response.state!;
    row.actions.push({tick:state.world.tick,action,proposal:structuredClone(saved.pending!.proposal),results:response.results,spend:Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,(before[r]-state.villages[0].resourcesMilli[r])/1000]))});
    return response as T;
   };
   const Factory=policy==='baseline'?BaselineController:Controller;
   let controller=await Factory.create(storage,settings,remote,()=>now);
   const cycle=async()=>{now+=1000;await controller.cycle();assert.equal(controller.snapshot().error,null);row.samples.push({tick:state.world.tick,automatic:controller.snapshot().automatic,active:saved.active?.map(p=>({type:p.action.type,itemId:p.itemId})),units:structuredClone(state.villages[0].units),training:structuredClone(state.villages[0].training.barracks),buildQueue:structuredClone(state.villages[0].buildQueue)});};
   await cycle();await controller.setAutomatic(true);
   let first:any;
   for(let n=0;n<180;n++){
    await cycle();first=row.actions.find((a:any)=>a.proposal.defenseBatch&&a.action.unit==='pikeman');if(first)break;
    step(state.world.tick+1);
   }
   assert.ok(first,'first cohort starts through President');row.firstCohort=first.proposal.defenseBatch;row.pauseTick=state.world.tick;
   await controller.setAutomatic(false);
   const finish=state.villages[0].training.barracks.find(q=>q.unit==='pikeman')!.endTick;
   for(;state.world.tick<=finish+1;){await cycle();if(state.world.tick===finish+1)break;step(state.world.tick+1);}
   assert.equal(row.actions.filter((a:any)=>a.tick>=row.pauseTick).length,1,'pause prohibits further writes');
   // Reconcile while paused and restart twice: the memory must outlive the accepted operation.
   controller=await Factory.create(storage,settings,remote,()=>now);await cycle();
   assert.equal(controller.snapshot().automatic,false);row.pausedSaved=structuredClone(saved);
   controller=await Factory.create(storage,settings,remote,()=>now);await cycle();assert.equal(controller.snapshot().automatic,false);
   row.resumeTick=state.world.tick;row.beforeResume=structuredClone(state.villages[0]);
   await controller.setAutomatic(true);
   const until=row.resumeTick+first.proposal.defenseBatch.shieldmen*state.villages[0].options.train.find(o=>o.unit==='shieldman')!.ticksEach+1;
   for(;state.world.tick<=until;){await cycle();if(state.world.tick===until)break;step(state.world.tick+1);}
   row.final=structuredClone(state.villages[0]);row.finalTick=state.world.tick;row.decisions=structuredClone(saved.decisions);
   row.firstAfterResume=row.actions.find((a:any)=>a.tick>=row.resumeTick);
   row.trainingSpend=row.actions.filter((a:any)=>a.action.type==='train').reduce((sum:number,a:any)=>sum+Object.values(a.spend).reduce((n:number,x:any)=>n+x,0),0);
   row.overlapObserved=row.samples.some((s:any)=>s.training.length&&s.buildQueue.length);
   console.log(JSON.stringify({policy,pauseTick:row.pauseTick,resumeTick:row.resumeTick,firstAfterResume:row.firstAfterResume?.action,finalUnits:row.final.units,trainingSpend:row.trainingSpend,overlap:row.overlapObserved}));
  }finally{box.close();row.deleted=true;await save();}
 }
 const [baseline,candidate]=results;
 for(const key of ['buildings','resourcesMilli','population','units'])assert.deepEqual(baseline.initial[key],candidate.initial[key]);
 assert.equal(baseline.pauseTick,candidate.pauseTick);assert.equal(baseline.resumeTick,candidate.resumeTick);
 assert.equal(candidate.firstAfterResume.action.unit,'shieldman');assert.equal(candidate.firstAfterResume.action.count,candidate.firstCohort.shieldmen);
 assert.notEqual(baseline.firstAfterResume.action.unit,'shieldman','deployed controller loses interrupted complement');
 assert.equal(candidate.final.units.home.shieldman, candidate.initial.units.home.shieldman+candidate.firstCohort.shieldmen);
 assert.ok(candidate.decisions.some((d:any)=>d.kind==='confirmed'&&d.text.includes('shieldman')));
 assert.ok(results.every(r=>r.deleted));await save(true);console.log('Matched recovery comparison passed.');
}catch(error){await save(false,String(error));throw error;}
