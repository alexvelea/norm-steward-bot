/** Reconstruct a completed worker's paid traces, verify its endpoint exactly,
 * then measure only the missing capture tail. Does not replace worker verification. */
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {PrivateSandbox, sandbox} from '../src/review/sandbox-client.js';
import {privateRead} from './experiment-raids.js';
const run=process.env.STEWARD_REVIEW_RUN!;
const job=process.env.STEWARD_CONQUEST_WORKER_JOB??'/var/lib/norm-steward-review/experiments/jobs/20261117T041041Z-f97e00';
const spec=JSON.parse(await readFile(job+'/job.json','utf8'));
assert.equal(spec.status,'complete');assert.equal(spec.ticks,6000);
const result:any={taskId:'conquest-transition-economics',workerJob:job,seed:spec.seed,start:6000,rows:[],passed:false,
 limitations:'Paid worker trace reconstruction and short tail, not a completed terminal-aware worker comparison. No enemies; capture feasibility does not prove survival.'};
let interrupted=false;process.once('SIGTERM',()=>{interrupted=true;});process.once('SIGINT',()=>{interrupted=true;});
const save=()=>writeFile(run+'/conquest-worker-tail.json',JSON.stringify(result,null,2),{mode:0o600});
try {
 let endpoint=7200;
 for(const policy of ['candidate','baseline']) {
  const prior=JSON.parse(await readFile(job+'/'+policy+'/result.json','utf8'));
  const row:any={policy,executorFingerprint:spec[policy+'Fingerprint'],actions:[],replayed:0,deleted:false,checkpoints:[]};result.rows.push(row);
  const box=new PrivateSandbox(spec.seed,10800);row.worldId=box.world.id;
  try {
   let state:any=box.join();const rules=box.rules();assert.equal(rules.version,prior.rulesVersion);row.rulesVersion=rules.version;
   const step=(tick:number)=>{if(tick>state.world.tick){assert.notEqual(state.world.status,'ended');state=sandbox({op:'step',world:box.world.id,ticks:tick-state.world.tick});}};
   for(const old of prior.actions) {
    assert.ok(!interrupted,'Interrupted during reconstruction');step(old.tick);
    const {clientId:_,...action}=old.action;const response=box.act([action]);
    assert.ok(response.results[0]?.ok,JSON.stringify(response.results));state=response.state??box.state();row.replayed++;
    if(row.replayed%25===0){await save();console.log(JSON.stringify({policy,replayed:row.replayed,tick:state.world.tick}));}
   }
   step(6000);row.initial=structuredClone(state);
   for(const k of ['buildings','population','resourcesMilli','units','productionPerTickMilli','buildQueue','training'])
    assert.deepEqual(state.villages[0][k],prior.final.villages[0][k],policy+' worker endpoint '+k);
   row.workerEndpointMatched=true;await save();
   let saved=JSON.parse((await readFile(job+'/'+policy+'/controller.json','utf8')).replaceAll(prior.worldId,box.world.id));
   const settings=saved.settings;let now=6000000;
   const storage={load:async()=>structuredClone(saved),save:async(v:any)=>{saved=structuredClone(v);}};
   const planning=()=>({...state,world:{...state.world,status:state.world.status==='ended'?'ended':'running'}});
   const remote=async(_s:any,path:string,body?:any):Promise<any>=>{
    if(path==='/me')return {account:{id:state.player.id},worlds:[],sandboxes:[]};
    if(path==='/worlds')return [planning().world];
    if(path.endsWith('/state'))return planning();if(path.endsWith('/rules'))return rules;
    if(path.endsWith('/history'))return {samples:[]};
    if(path.endsWith('/map'))return privateRead(box,'/map');
    if(path.endsWith('/reports'))return sandbox({op:'read',world:box.world.id,resource:'reports'});
    if(path.includes('/reports/'))return privateRead(box,path.slice(path.indexOf('/reports/')));
    if(path.endsWith('/simulate/battle'))return privateRead(box,'/simulate/battle',body);
    assert.ok(path.endsWith('/actions'),path);assert.notEqual(state.world.status,'ended');
    const action=body.actions[0];assert.deepEqual(saved.pending.action,action,'journal before write');
    const response=box.act([action]);row.actions.push({tick:state.world.tick,action,proposal:saved.pending.proposal,result:response.results[0]});
    assert.ok(response.results[0]?.ok,JSON.stringify(response.results));state=response.state??box.state();await save();return response;
   };
   const {Controller}=await import(job+'/'+policy+'/source/src/control/controller.ts');
   const c=await Controller.create(storage,settings,remote,()=>now);await c.cycle();assert.equal(c.snapshot().automatic,false);await c.setAutomatic(true);
   let nextCheckpoint=6000;
   for(let cycles=0;cycles<2000;cycles++) {
    assert.ok(!interrupted,'Interrupted during tail');
    if(state.world.tick===nextCheckpoint||state.world.status==='ended') {
     row.checkpoints.push(structuredClone(state));nextCheckpoint+=600;await save();
    }
    if(state.world.status==='ended'||state.world.tick===endpoint)break;
    now=state.world.tick*1000;const before=row.actions.length;await c.cycle();const view=c.snapshot();assert.equal(view.error,null);
    const tick=state.world.tick,events=[endpoint,nextCheckpoint,tick+30];
    if(row.actions.length>before||view.selection.selected)events.push(tick+1);
    if(state.player.nextActTick>tick)events.push(state.player.nextActTick);
    for(const v of state.villages){for(const q of v.buildQueue)events.push(q.endTick);for(const q of Object.values(v.training).flat() as any[])events.push(q.nextTick,q.endTick);}
    for(const cmd of [...state.commands.outgoing,...state.commands.incoming])events.push(cmd.arrivalTick);
    for(const p of view.proposals)if(p.affordableAtTick>tick)events.push(p.affordableAtTick);
    step(Math.min(...events.filter(n=>Number.isFinite(n)&&n>tick)));
   }
   row.final=structuredClone(state);row.conquest=saved.conquest;
   if(policy==='candidate') {
    const target=saved.conquest.targetId;
    row.captureTick=state.villages.some((v:any)=>v.id===target)?state.world.tick:null;
    assert.ok(row.captureTick,'Capture not observed in the 20-minute tail');
    assert.equal(state.world.status,'ended');assert.ok(state.villages[0].units.home.pikeman>=150);
    assert.equal(state.villages[0].units.home.shieldman,51);endpoint=state.world.tick;
    row.battleReports=sandbox({op:'read',world:box.world.id,resource:'reports'});
   } else assert.equal(state.world.tick,endpoint);
   console.log(JSON.stringify({policy,endpoint:state.world.tick,captureTick:row.captureTick,actions:row.actions.length}));
  } finally {box.close();row.deleted=true;await save();}
 }
 assert.equal(result.rows[0].final.world.tick,result.rows[1].final.world.tick);
 result.passed=true;result.endpoint=result.rows[0].final.world.tick;
} catch(error) {result.error=String(error);throw error;}
finally {await save();}
