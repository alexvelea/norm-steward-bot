/** Matched paid trace prefix, then ten minutes through the ordinary Controller. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {PrivateSandbox,sandbox} from '../src/review/sandbox-client.js';
import {Controller} from '../src/control/controller.js';
import type {StateResponse,Action} from '../src/shared/api.js';
const run=process.env.STEWARD_REVIEW_RUN!;assert.ok(run);
const baselineSource=process.env.STEWARD_BASELINE_SOURCE!;assert.ok(baselineSource);
const {Controller:BaselineController}=await import(baselineSource+'/src/control/controller.ts');
const prior=JSON.parse(await readFile(process.env.STEWARD_IDLE_TRACE??'/var/lib/norm-steward-review/experiments/jobs/20261116T230158Z-c3ddc0/candidate/result.json','utf8'));
const start=4266,until=4866,rows:any[]=[];
const output=run+'/farm-runway-mechanism.json';
let interrupted=false;process.once('SIGTERM',()=>{interrupted=true;});
try{
 for(const policy of ['baseline','candidate']){
  const box=new PrivateSandbox(prior.seed,prior.roundTicks,prior.houseBots);
  const row:any={policy,worldId:box.world.id,actions:[],samples:[],idleTicks:0,constructionBusyTicks:0,deleted:false};rows.push(row);
  try{
   let state=box.join();const rules=box.rules();assert.equal(rules.version,prior.rulesVersion);
   const step=(target:number)=>{if(target>state.world.tick)state=sandbox<StateResponse>({op:'step',world:box.world.id,ticks:target-state.world.tick});};
   for(const old of prior.actions.filter((a:any)=>a.tick<start)){
    assert.ok(!interrupted,'Interrupted during paid prefix');step(old.tick);
    const {clientId:_,...original}=old.action;
    const response=box.act([{...original,village:state.villages[0].id} as Action]);
    assert.ok(response.results[0].ok,JSON.stringify(response.results));state=response.state??box.state();
   }
   step(start);row.initial=structuredClone(state.villages[0]);
   const settings={serverUrl:'https://sandbox.invalid',worldId:box.world.id,apiKey:'sandbox-adapter-no-credential'};
   let saved:any={settings,pending:null,active:[],automatic:false,decisions:[]};
   const storage={load:async()=>structuredClone(saved),save:async(value:any)=>{saved=structuredClone(value);}};
   const planning=()=>({...state,world:{...state.world,status:'running' as const}});
   let now=0;
   const remote=async(_s:any,path:string,body?:any)=>{
    if(path==='/me')return {account:{id:state.player.id},worlds:[],sandboxes:[]};
    if(path==='/worlds')return [planning().world];
    if(path.endsWith('/state'))return planning();
    if(path.endsWith('/rules'))return rules;
    if(path.endsWith('/history'))return {samples:[]};
    assert.ok(path.endsWith('/actions'),path);
    const action=body.actions[0];assert.deepEqual(saved.pending.action,action,'journal before write');
    const before=structuredClone(state.villages[0].resourcesMilli),response=box.act([action]);
    row.actions.push({tick:state.world.tick,action,proposal:saved.pending.proposal,result:response.results[0],spend:Object.fromEntries(Object.keys(before).map(r=>[r,(before[r as keyof typeof before]-response.state!.villages[0].resourcesMilli[r as keyof typeof before])/1000]))});
    assert.ok(response.results[0].ok,JSON.stringify(response.results));state=response.state??box.state();return response;
   };
   const Factory=policy==='baseline'?BaselineController:Controller;
   const c=await Factory.create(storage,settings,remote,()=>now);await c.cycle();await c.setAutomatic(true);
   while(state.world.tick<until){
    assert.ok(!interrupted,'Interrupted during comparison');now=state.world.tick*1000;
    const before=row.actions.length;await c.cycle();const view=c.snapshot();assert.equal(view.error,null);
    const v=state.villages[0],tick=state.world.tick,events=[until,tick+30];
    if(row.actions.length>before||view.selection.selected)events.push(tick+1);
    for(const q of v.buildQueue)events.push(q.endTick);
    for(const q of Object.values(v.training).flat())events.push(q.nextTick??q.endTick,q.endTick);
    for(const p of view.proposals)if(p.affordableAtTick>tick)events.push(p.affordableAtTick);
    for(const o of v.options.build)if(o.affordableAtTick&&o.affordableAtTick>tick)events.push(o.affordableAtTick);
    const next=Math.min(...events.filter(t=>Number.isFinite(t)&&t>tick));
    if(!v.training.barracks.length)row.idleTicks+=next-tick;
    if(v.buildQueue.length)row.constructionBusyTicks+=next-tick;
    row.samples.push({tick,population:v.population,stocks:v.resources,buildings:v.buildings,training:v.training});
    step(next);
   }
   await c.setAutomatic(false);row.final=state.villages[0];row.rulesVersion=rules.version;
   row.spend=Object.fromEntries(['timber','stone','iron'].map(r=>[r,row.actions.reduce((n:number,a:any)=>n+a.spend[r],0)]));
   console.log(JSON.stringify({policy,idleTicks:row.idleTicks,units:row.final.units,output}));
  }finally{box.close();row.deleted=true;await writeFile(output,JSON.stringify({start,until,rows,passed:false},null,2),{mode:0o600});}
 }
 for(const key of ['buildings','population','resourcesMilli','units'])assert.deepEqual(rows[0].initial[key],rows[1].initial[key],`matched ${key}`);
 await writeFile(output,JSON.stringify({start,until,rows,passed:true,limitations:'Paid prefix to an observed bottleneck, ten-minute peaceful mechanism test; full-round economic and survival effects unmeasured.'},null,2),{mode:0o600});
}catch(error){await writeFile(output,JSON.stringify({start,until,rows,passed:false,error:String(error)},null,2),{mode:0o600});throw error;}
