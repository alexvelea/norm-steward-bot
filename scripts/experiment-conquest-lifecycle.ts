/** Replay a verified paid worker trace, then run the missing terminal Controller cycle.
 * This complements the matched opening comparison; it is not another economics test. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {PrivateSandbox,sandbox} from '../src/review/sandbox-client.js';
import {Controller} from '../src/control/controller.js';
import {privateRead} from './experiment-raids.js';
import type {SavedControl} from '../src/control/types.js';
import type {Remote} from '../src/control/remote.js';
const run=process.env.STEWARD_REVIEW_RUN!;assert.ok(run);
const job=process.env.STEWARD_CONQUEST_WORKER_JOB??'/var/lib/norm-steward-review/experiments/jobs/20261117T050825Z-398f24';
const spec=JSON.parse(await readFile(job+'/job.json','utf8'));
const prior=JSON.parse(await readFile(job+'/candidate/result.json','utf8'));
const {Controller:PreviousController}=await import(job+'/candidate/source/src/control/controller.ts');
assert.equal(spec.status,'complete');assert.equal(prior.passed,true);
const result:any={taskId:'conquest-transition-gameplay-delivery',workerJob:job,seed:spec.seed,
 baselineSource:job+'/candidate/source',candidateSource:process.cwd(),
 hypothesis:'Authoritative target ownership remains captured across a paused restart, including a missing final report or uncertain final send, without another gameplay write.',
 metric:'Exact paid endpoint equality; persisted captured status, matching battle provenance, cleared command journal, zero post-capture writes and preserved pause.',
 limitations:'Shared real-server captured endpoint reconstructed from the verified worker paid trace. Missing-report and uncertain-response journals are controlled failure injections. This is a lifecycle regression, not a new opening allocation comparison or survival test.',replayed:0,comparisons:[],deleted:false,passed:false};
const save=()=>writeFile(run+'/conquest-lifecycle.json',JSON.stringify(result,null,2),{mode:0o600});
let interrupted=false;process.once('SIGTERM',()=>{interrupted=true;});process.once('SIGINT',()=>{interrupted=true;});
const box=new PrivateSandbox(spec.seed,10800);result.worldId=box.world.id;
try{
 let state=box.join();const rules=box.rules();result.rulesVersion=rules.version;assert.equal(rules.version,prior.rulesVersion);
 const step=(tick:number)=>{if(tick>state.world.tick){assert.notEqual(state.world.status,'ended');state=box.step(tick-state.world.tick);}};
 for(const old of prior.actions){
  assert.ok(!interrupted,'Interrupted during paid reconstruction');step(old.tick);
  const {clientId:_,...action}=old.action;
  const response=box.act([action]);assert.ok(response.results[0]?.ok,JSON.stringify(response.results));
  state=response.state??box.state();result.replayed++;
  if(result.replayed%20===0){await save();console.log(JSON.stringify({replayed:result.replayed,tick:state.world.tick}));}
 }
 step(spec.ticks);assert.equal(state.world.status,'ended');assert.equal(state.world.tick,spec.ticks);
 for(let i=0;i<prior.final.villages.length;i++)for(const k of ['buildings','population','resourcesMilli','units','productionPerTickMilli','buildQueue','training'] as const)
  assert.deepEqual(state.villages[i][k],prior.final.villages[i][k],'worker endpoint '+i+' '+k);
 result.endpointMatched=true;
 let saved:SavedControl=JSON.parse((await readFile(job+'/candidate/controller.json','utf8')).replaceAll(prior.worldId,box.world.id));
 const terminalJournal=structuredClone(saved);
 assert.equal(saved.automatic,false);assert.equal(saved.conquest?.status,'preparing');
 const settings=saved.settings,storage={load:async()=>structuredClone(saved),save:async(v:SavedControl)=>{saved=structuredClone(v);}};
 let writes=0,missingReports=false;
 const remote:Remote=async <T>(_s,path,body):Promise<T>=>{
  if(path==='/me')return {account:{id:state.player.id},worlds:[],sandboxes:[]} as T;
  if(path==='/worlds')return [state.world] as T;
  if(path.endsWith('/state'))return state as T;if(path.endsWith('/rules'))return rules as T;
  if(path.endsWith('/history'))return {samples:[]} as T;
  if(path.endsWith('/map'))return privateRead(box,'/map');
  if(path.endsWith('/reports'))return missingReports?{reports:[],next:null} as T:sandbox({op:'read',world:box.world.id,resource:'reports'});
  if(path.includes('/reports/'))return privateRead(box,path.slice(path.indexOf('/reports/')));
  if(path.endsWith('/simulate/battle'))return privateRead(box,'/simulate/battle',body);
  writes++;throw new Error('Unexpected post-capture write: '+path);
 };
 const create=()=>Controller.create(storage,settings,remote,()=>spec.ticks*1000);
 let controller=await create();await controller.cycle();assert.equal(controller.snapshot().error,null);
 assert.equal(saved.conquest?.status,'captured');assert.equal(saved.conquest?.capturedTick,spec.ticks);
 assert.equal(saved.conquest?.lastBattle?.conquered,true);assert.equal(saved.pending,null);
 assert.ok(!saved.active?.some(p=>p.conquest));assert.equal(controller.snapshot().automatic,false);
 result.confirmed=controller.snapshot().decisions.filter(d=>d.kind==='confirmed'&&d.text.includes('Conquest battle'));
 assert.ok(result.confirmed.length);
 controller=await create();await controller.cycle();assert.equal(controller.snapshot().error,null);
 assert.equal(controller.snapshot().automatic,false);assert.equal(writes,0);
 result.final={tick:state.world.tick,status:state.world.status,villages:state.villages.length,conquest:saved.conquest,
  pending:saved.pending,activeConquest:saved.active?.filter(p=>p.conquest),automatic:saved.automatic,writes};
 // Both policies read the exact same authoritative endpoint. Only report availability and
 // the persisted final response state change; neither policy may make a gameplay write.
 missingReports=true;
 for(const failure of ['accepted-missing-report','uncertain-final-response']){
  for(const policy of ['baseline','candidate']){
   saved=structuredClone(terminalJournal);
   if(failure==='uncertain-final-response'){
    const p=saved.active!.find(p=>p.conquest)!;saved.active=saved.active!.filter(a=>a!==p);
    p.phase='uncertain';delete p.itemId;saved.pending=p;
   }
   const Factory=policy==='baseline'?PreviousController:Controller;
   const c=await Factory.create(storage,settings,remote,()=>spec.ticks*1000);await c.cycle();
   assert.equal(c.snapshot().error,null);assert.equal(c.snapshot().automatic,false);
   assert.equal(saved.pending,null);assert.ok(!saved.active?.some(p=>p.conquest));assert.equal(writes,0);
   result.comparisons.push({policy,failure,worldId:box.world.id,status:saved.conquest?.status,
    capturedTick:saved.conquest?.capturedTick,automatic:saved.automatic,writes,decisions:c.snapshot().decisions.slice(-4)});
   assert.equal(saved.conquest?.status,policy==='baseline'?'stopped':'captured');
  }
 }
 result.passed=true;console.log(JSON.stringify({capturedTick:saved.conquest?.capturedTick,writes,paused:saved.automatic===false}));
}catch(error){result.error=String(error);throw error;}
finally{try{box.close();result.deleted=true;}finally{await save();}}
