/** Real owned-world queue append and restart check. No live actions. */
import assert from 'node:assert/strict';import {mkdir,writeFile,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {PrivateSandbox,sandbox} from '../src/review/sandbox-client.js';
const tools=process.env.STEWARD_REVIEW_TOOLS||process.cwd(),base=process.env.STEWARD_REVIEW_RUN!,cases:any[]=[];
assert.ok(base,'Set STEWARD_REVIEW_RUN to a fresh private review directory');
const baseline=base+'/baseline/source';await mkdir(baseline,{recursive:true});
execFileSync('tar',['-x','-C',baseline],{input:execFileSync('git',['archive',process.env.STEWARD_BASELINE_COMMIT||'7619a32','src'],{cwd:tools})});
await symlink(tools+'/node_modules',baseline+'/node_modules','dir');await writeFile(baseline+'/package.json','{"type":"module"}');
for(const policy of ['baseline','candidate']){
 const source=policy==='baseline'?baseline:tools;
 const dir=base+'/'+policy;await mkdir(dir,{recursive:true});process.chdir(source);process.env.STEWARD_REVIEW_RUN=dir;process.env.STEWARD_REVIEW_TOOLS=tools;
 const {Controller}=await import(source+'/src/control/controller.ts');const box=new PrivateSandbox(73430,10800,{warden:0,reaver:0,sovereign:0});
 const row:any={policy,worldId:box.world.id,passed:false};cases.push(row);
 try{
  let state=box.join();const rules=box.rules();row.rulesVersion=rules.version;row.initial=state.villages[0].resources;let saved:any=null;const writes:any[]=[];
  const settings={serverUrl:'https://sandbox.invalid',worldId:box.world.id,apiKey:'test'};
  const storage={load:async()=>structuredClone(saved),save:async(s:any)=>{saved=structuredClone(s);}};
  const planning=()=>({...state,world:{...state.world,status:'running'}});
  const remote=async(_s:any,path:string,body?:any)=>{
   if(path==='/me')return {account:{id:state.player.id},worlds:[],sandboxes:[]};if(path==='/worlds')return [planning().world];
   if(path.endsWith('/state'))return planning();if(path.endsWith('/rules'))return rules;if(path.endsWith('/history'))return {samples:[]};
   assert.ok(path.endsWith('/actions'),path);const action=body.actions[0];assert.deepEqual(saved.pending.action,action);
   const response:any=sandbox({op:'act',world:box.world.id,requestId:action.clientId,actions:[action]});assert.ok(response.results[0].ok,JSON.stringify(response));writes.push(action);state=response.state??box.state();return response;
  };
  let controller=await Controller.create(storage,settings,remote,()=>0);await controller.cycle();assert.equal(state.villages[0].buildQueue.length,1);
  const first=state.villages[0].buildQueue[0];row.remainingSeconds=(first.endTick-state.world.tick)/state.world.speed;assert.ok(row.remainingSeconds<10);
  await controller.cycle();assert.equal(state.villages[0].buildQueue.length,policy==='candidate'?2:1);
  await controller.cycle();controller=await Controller.create(storage,settings,remote,()=>0);await controller.cycle();assert.equal(writes.length,policy==='candidate'?2:1);
  row.queue=structuredClone(state.villages[0].buildQueue);row.writes=writes;state=box.step(Math.max(...row.queue.map((q:any)=>q.endTick))-state.world.tick);
  row.completed=state.villages[0].buildings;row.passed=true;
 }finally{box.close();row.deleted=true;await writeFile(base+'/comparison.json',JSON.stringify({passed:cases.length===2&&cases.every(c=>c.passed),cases},null,2));}
}
console.log(JSON.stringify(cases.map(c=>({policy:c.policy,remainingSeconds:c.remainingSeconds,queued:c.queue.length,passed:c.passed,deleted:c.deleted}))));
