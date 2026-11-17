/** Controlled paid-queue late-round regression through the complete President/executor. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname} from 'node:path';
import {PrivateSandbox,sandbox} from '../src/review/sandbox-client.js';
import {Controller} from '../src/control/controller.js';
import {defenseBudget} from '../src/advisors/defense-budget.js';
import type {Remote} from '../src/control/remote.js';
import type {SavedControl} from '../src/control/types.js';
import type {Action,StateResponse} from '../src/shared/api.js';
const run=process.env.STEWARD_REVIEW_RUN!,base=process.env.STEWARD_BASELINE_COMMIT??'fa8f754';assert.ok(run);
const root=run+'/farm-baseline-src';
for(const path of execFileSync('git',['ls-tree','-r','--name-only',base,'src'],{encoding:'utf8'}).trim().split('\n')){
 const target=root+'/'+path.slice(4);await mkdir(dirname(target),{recursive:true});await writeFile(target,execFileSync('git',['show',base+':'+path]));
}
const {Controller:BaselineController}=await import(root+'/control/controller.ts');
const results:any[]=[];
const save=(passed=false,error?:string)=>writeFile(run+'/recruitment-farm-window-comparison.json',JSON.stringify({taskId:'phased-economy-full-round-allocation',baselineCommit:base,passed,error,verdict:passed?'supports-change':'inconclusive',limitations:'Controlled late-round paid-queue regression; the setup queue intentionally extends beyond round end. No combat benefit claimed.',results},null,2));
let interrupted=false;process.once('SIGTERM',()=>{interrupted=true;});
try{
 for(const policy of ['baseline','candidate']){
  const box=new PrivateSandbox(73430,10800),row:any={policy,worldId:box.world.id,setup:[],actions:[]};results.push(row);
  try{
   let state=box.join();const rules=box.rules();
   const step=(to:number)=>{while(state.world.tick<to){assert.ok(!interrupted);state=sandbox<StateResponse>({op:'step',world:box.world.id,ticks:Math.min(3600,to-state.world.tick)});}};
   const act=(action:Action)=>{const response=box.act([action]);assert.ok(response.results.every(r=>r.ok),JSON.stringify(response.results));state=response.state!;return response;};
   const build=(building:Extract<Action,{type:'build'}>['building'])=>{
    const o=state.villages[0].options.build.find(o=>o.building===building)!;
    step(Math.max(state.world.tick,state.player.nextActTick??0,o.affordableAtTick??0));
    row.setup.push({tick:state.world.tick,action:{type:'build',building},results:act({type:'build',village:state.villages[0].id,building}).results});
    step(Math.max(...state.villages[0].buildQueue.map(q=>q.endTick)));
   };
   for(let n=0;n<9;n++)for(const b of ['lumberyard','quarry','mine'] as const)build(b);
   for(let n=0;n<4;n++)build('hall');for(let n=0;n<3;n++)build('barracks');build('smithy');
   build('farm');build('storehouse');for(let n=0;n<3;n++)build('cellar');
   const v=state.villages[0],budget=defenseBudget(v)!,farm=v.options.build.find(o=>o.building==='farm')!;
   const start=10800-farm.ticks-budget.ticks-61;assert.ok(state.world.tick<start);step(start);
   const count=v.population.max-v.population.used-Math.max(50,Math.ceil(v.population.max*.2))-4;
   assert.ok(count>0);const p=Math.floor(count*.75),s=count-p;
   for(const [unit,n] of [['pikeman',p],['shieldman',s]] as const)row.setup.push({tick:state.world.tick,action:{type:'train',unit,count:n},results:act({type:'train',village:v.id,unit,count:n}).results});
   row.initial=structuredClone(state.villages[0]);row.startTick=state.world.tick;row.worldStatus=state.world.status;row.planningStatus='running';
   const settings={serverUrl:'https://sandbox.invalid',worldId:box.world.id,apiKey:'sandbox-no-credential'};
   let saved:SavedControl={settings,pending:null,automatic:false,decisions:[]};
   const storage={load:async()=>structuredClone(saved),save:async(v:SavedControl)=>{saved=structuredClone(v);}};
   const planning=()=>({...state,world:{...state.world,status:state.world.status==='ended'?'ended' as const:'running' as const}});
   const remote:Remote=async<T>(_s:unknown,path:string,body?:unknown):Promise<T>=>{
    if(path==='/me')return {account:{id:state.player.id},worlds:[],sandboxes:[]} as T;
    if(path==='/worlds')return [planning().world] as T;
    if(path.endsWith('/state'))return planning() as T;if(path.endsWith('/rules'))return rules as T;
    if(path.endsWith('/history'))return {samples:[]} as T;if(path.endsWith('/reports'))return {reports:[],next:null} as T;
    assert.ok(path.endsWith('/actions'),path);const action=(body as {actions:Action[]}).actions[0];assert.deepEqual(saved.pending!.action,action);
    const before=structuredClone(state.villages[0].resourcesMilli),response=act(action);
    row.actions.push({tick:state.world.tick,action,results:response.results,spend:Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,(before[r]-state.villages[0].resourcesMilli[r])/1000]))});return response as T;
   };
   const Factory=policy==='baseline'?BaselineController:Controller;
   const c:Controller=await Factory.create(storage,settings,remote,()=>state.world.tick*1000+1000);await c.cycle();
   row.farmProposal=c.snapshot().proposals.find(p=>p.action.type==='build'&&p.action.building==='farm');
   await c.setAutomatic(true);await c.cycle();assert.equal(c.snapshot().error,null);
   await c.setAutomatic(false);step(10800);await c.cycle();assert.equal(c.snapshot().error,null);
   const restart=await Factory.create(storage,settings,remote,()=>state.world.tick*1000+1000);await restart.cycle();assert.equal(restart.snapshot().automatic,false);
   row.final=structuredClone(state.villages[0]);row.finalTick=state.world.tick;
   if(policy==='baseline')assert.ok(row.actions.some((a:any)=>a.action.type==='build'&&a.action.building==='farm'));
   else assert.equal(row.actions.length,0,'candidate preserves the budget when no complete new cohort fits');
  }finally{box.close();row.deleted=true;await save();}
 }
 const [a,b]=results;for(const key of ['buildings','resourcesMilli','population','units','training']){
  const normalize=(v:any)=>JSON.parse(JSON.stringify(v,(k,x)=>k==='id'?undefined:x));assert.deepEqual(normalize(a.initial[key]),normalize(b.initial[key]));
 }
 assert.deepEqual(a.final.units,b.final.units);assert.ok(results.every(r=>r.deleted&&r.finalTick===10800));
 await save(true);console.log('Late-round Farm regression passed.');
}catch(error){await save(false,String(error));throw error;}
