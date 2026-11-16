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
assert.ok(run&&base);
const root=run+'/baseline-src';
for(const path of execFileSync('git',['ls-tree','-r','--name-only',base,'src'],{encoding:'utf8'}).trim().split('\n')){
 const target=root+'/'+path.slice(4);await mkdir(dirname(target),{recursive:true});await writeFile(target,execFileSync('git',['show',base+':'+path]));
}
const {Controller:BaselineController}=await import(root+'/control/controller.ts');
const results:any[]=[];
const batchOnly=process.argv.includes("--batch-only"),endTick=batchOnly?2000:3600;
const save=(passed=false,error?:string)=>writeFile(run+(batchOnly?'/batch-verification.json':'/parallel-military-comparison.json'),JSON.stringify({baselineCommit:base,passed,error,verdict:passed?'supports-change':'inconclusive',evaluation:'event boundaries; one shared executor; paused lockstep; no opponents',results},null,2));
try{
 for(const policy of (batchOnly?['candidate']:['baseline','candidate'])){
  const box=new PrivateSandbox(73430,10800), row:any={policy,world:box.world,charges:[],milestones:[]};results.push(row);
  try{
   let state=box.join(), now=0;const rules=box.rules();
   const advance=(tick:number)=>{if(tick>state.world.tick)state=box.step(tick-state.world.tick);};
   const build=(building:Extract<Action,{type:"build"}>["building"])=>{
    const o=state.villages[0].options.build.find(o=>o.building===building)!;
    advance(Math.max(state.world.tick,state.player.nextActTick??0,o.affordableAtTick??0));
    const response=box.act([{type:"build",village:state.villages[0].id,building}]);assert.ok(response.results[0].ok,JSON.stringify(response.results));state=response.state!;
    advance(Math.max(state.player.nextActTick??0,...state.villages[0].buildQueue.map(q=>q.endTick)));
   };
   for(let n=0;n<6;n++)for(const b of ["lumberyard","quarry","mine"] as const)build(b);
   build("hall");build("hall");build("hall");build("hall");build("barracks");build("smithy");build("smithy");
   for(const [unit,count] of [["pikeman",10],["shieldman",5],["raider",10]] as const){
    const v=state.villages[0],o=v.options.train.find(o=>o.unit===unit)!;
    advance(Math.max(state.world.tick,state.player.nextActTick??0,...(["timber","stone","iron"] as const).map(r=>state.world.tick+Math.max(0,Math.ceil((o.cost[r]*count*1000-v.resourcesMilli[r])/v.productionPerTickMilli[r])))));
    const response=box.act([{type:"train",village:v.id,unit,count}]);assert.ok(response.results[0].ok,JSON.stringify(response.results));state=response.state!;
    advance(Math.max(state.player.nextActTick??0,...state.villages[0].training.barracks.map(q=>q.endTick)));
   }
   advance(1800);row.initial=structuredClone(state.villages[0]);row.initialTick=state.world.tick;
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
    if(path.endsWith('/reports'))return {reports:[],next:null} as T;
    if(path.endsWith('/map'))return privateRead(box,'/map') as T;
    assert.ok(path.endsWith('/actions'),path);
    const action=(body as {actions:Action[]}).actions[0];assert.deepEqual(saved.pending!.action,action,'journal before write');
    const before=state.villages[0].resourcesMilli;
    const response=box.act([action]);assert.ok(response.results[0].ok,JSON.stringify(response.results));state=response.state!;
    row.charges.push({tick:state.world.tick,action,spend:Object.fromEntries(['timber','stone','iron'].map(r=>[r,(before[r as 'timber']-state.villages[0].resourcesMilli[r as 'timber'])/1000]))});return response as T;
   };
   const Factory=policy==='baseline'?BaselineController:Controller;
   const c=await Factory.create(storage,settings,remote,()=>now);await c.cycle();await c.setAutomatic(true);
   for(let iteration=0;iteration<500&&state.world.tick<=endTick;iteration++){
    now+=10000;await c.cycle();assert.equal(c.snapshot().error,null);
    const v=state.villages[0];
    if(v.buildQueue.length && Object.values(v.training).some(q=>q.length)) row.overlapObserved=true;
    if(state.world.tick===endTick)break;
    const events=[...v.buildQueue.map(q=>q.endTick),...Object.values(v.training).flat().map(q=>q.endTick),state.player.nextActTick??0];
    const selected=c.snapshot().selection.selected;
    if(!saved.pending&&!selected){for(const o of v.options.build)if(o.affordableAtTick)events.push(o.affordableAtTick);}
    const next=Math.min(...events.filter(t=>t>state.world.tick),Math.min(endTick,state.world.tick+30));
    state=box.step(next-state.world.tick);
   }
   row.final=state.villages[0];row.finalTick=state.world.tick;
   row.trainingSpend=row.charges.filter((x:any)=>x.action.type==="train").reduce((sum:number,x:any)=>sum+Object.values(x.spend).reduce((n:number,v:any)=>n+v,0),0);
   assert.equal(state.world.tick,endTick);row.passed=true;console.log(JSON.stringify({policy,initialTick:row.initialTick,finalTick:row.finalTick,units:row.final.units,buildings:row.final.buildings,trainingSpend:row.trainingSpend}));
  }finally{box.close();row.deleted=true;await save();}
 }
 if(!batchOnly)for(const k of ['buildings','resourcesMilli','population','units'])assert.deepEqual(results[0].initial[k],results[1].initial[k]);
 const count=(r:any)=>(r.final.units.home.pikeman??0)+(r.final.units.home.shieldman??0);
 if(!batchOnly)assert.ok(results[1].overlapObserved,"candidate runs construction and recruitment concurrently");
 if(!batchOnly)assert.ok(results[1].final.buildings.barracks>results[0].final.buildings.barracks,"candidate improves recruitment infrastructure");
 if(!batchOnly)assert.ok(count(results[1])>15,"candidate continues producing defence while constructing");
 if(batchOnly){
  const trains=results[0].charges.filter((x:any)=>x.action.type==="train");
  assert.ok(trains.some((x:any)=>x.action.unit==="pikeman")&&trains.some((x:any)=>x.action.unit==="shieldman"));
  const firstP=trains.find((x:any)=>x.action.unit==="pikeman").action.count;
  const firstS=trains.find((x:any)=>x.action.unit==="shieldman").action.count;
  assert.equal(firstP,3*firstS,"exact whole 3Pi1Sh cohorts");
  assert.ok(results[0].overlapObserved);
 }
 assert.ok(results.every(r=>r.deleted));
 await save(true);console.log('Matched comparison passed.');
}catch(error){await save(false,String(error));throw error;}
