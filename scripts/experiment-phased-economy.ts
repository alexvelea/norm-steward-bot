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
const save=(passed=false,error?:string)=>writeFile(run+'/phased-economy-comparison.json',JSON.stringify({baselineCommit:base,passed,error,verdict:passed?'supports-change':'inconclusive',evaluation:'event boundaries; one shared executor; paused lockstep; no opponents',results},null,2));
try{
 for(const policy of ['baseline','candidate']){
  const box=new PrivateSandbox(73430,10800), row:any={policy,world:box.world,charges:[],milestones:[]};results.push(row);
  try{
   let state=box.join(), now=0;const rules=box.rules();row.initial=structuredClone(state.villages[0]);
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
    row.charges.push({minimumProducer:Math.min(...["lumberyard","quarry","mine"].map(b=>state.villages[0].buildings[b as "mine"])),batch:saved.pending!.proposal.defenseBatch,tick:state.world.tick,action,spend:Object.fromEntries(['timber','stone','iron'].map(r=>[r,(before[r as 'timber']-state.villages[0].resourcesMilli[r as 'timber'])/1000]))});return response as T;
   };
   const Factory=policy==='baseline'?BaselineController:Controller;
   const c=await Factory.create(storage,settings,remote,()=>now);await c.cycle();await c.setAutomatic(true);
   for(let iteration=0;iteration<500&&state.world.tick<=2400;iteration++){
    now+=10000;await c.cycle();assert.equal(c.snapshot().error,null);
    const v=state.villages[0];
    for(const target of [5,8,10])if(!row.milestones.some((m:any)=>m.target===target)&&['lumberyard','quarry','mine'].every(b=>v.buildings[b as 'mine']>=target)){
     row.milestones.push({target,tick:state.world.tick,village:structuredClone(v),spending:row.charges.reduce((sum:any,x:any)=>Object.fromEntries(['timber','stone','iron'].map(r=>[r,sum[r]+x.spend[r]])),{timber:0,stone:0,iron:0})});await save();console.log(JSON.stringify({policy,target,tick:state.world.tick}));
    }
    if(state.world.tick===2400)break;
    const events=[...v.buildQueue.map(q=>q.endTick),...Object.values(v.training).flat().map(q=>q.endTick),state.player.nextActTick??0];
    const selected=c.snapshot().selection.selected;
    if(!saved.pending&&!selected){for(const o of v.options.build)if(o.affordableAtTick)events.push(o.affordableAtTick);}
    const next=Math.min(...events.filter(t=>t>state.world.tick),Math.min(2400,state.world.tick+30));
    state=box.step(next-state.world.tick);
   }
   row.final=state.villages[0];assert.equal(state.world.tick,2400);row.passed=true;
  }finally{box.close();row.deleted=true;await save();}
 }
 for(const k of ['buildings','resourcesMilli','population','units'])assert.deepEqual(results[0].initial[k],results[1].initial[k]);
 const candidate=results[1],trains=candidate.charges.filter((x:any)=>x.action.type==="train");
 assert.ok(trains.length>0,"candidate reaches sustainable recruitment");
 assert.ok(trains.every((x:any)=>x.minimumProducer>=10&&x.batch&&x.batch.pikemen===3*x.batch.shieldmen));
 assert.ok(!candidate.charges.some((x:any)=>x.action.type==="train"&&x.action.unit==="raider"));
 assert.ok(candidate.charges.filter((x:any)=>x.action.type==="build"&&["barracks","smithy"].includes(x.action.building)).every((x:any)=>x.minimumProducer>=10));
 assert.ok(candidate.final.buildings.barracks>=3&&candidate.final.buildings.smithy>=1);
 assert.ok(results.every((r:any)=>r.deleted));

 await save(true);console.log('Matched comparison passed.');
}catch(error){await save(false,String(error));throw error;}
