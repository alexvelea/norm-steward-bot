import assert from 'node:assert/strict';
import {readFile,writeFile,rename,open} from 'node:fs/promises';
// Run the selected detached policy, never the live executor.
const source=process.env.STEWARD_EXPERIMENT_SOURCE!;
const tools=process.env.STEWARD_REVIEW_TOOLS!;
const {Controller}=await import(source+'/src/control/controller.ts');
const {PrivateSandbox,sandbox:rawSandbox,shutdownSandbox}=await import(tools+'/scripts/sandbox/client.ts');
const {privateRead}=await import(tools+'/scripts/sandbox/read.ts');
const {retrySandboxAction}=await import(tools+'/scripts/sandbox/actions.ts');
const {Timeline,LABELS:labels}=await import(tools+'/scripts/sandbox/timeline.ts');
const timeline=new Timeline();
const keep=process.env.STEWARD_EXPERIMENT_KEEP==='1';
const run=process.env.STEWARD_REVIEW_RUN!;
const snapshotTicks=Number(process.env.STEWARD_EXPERIMENT_SNAPSHOT_TICKS??300);
assert.ok(Number.isSafeInteger(snapshotTicks)&&snapshotTicks>0);
const result:any={seed:Number(process.env.STEWARD_EXPERIMENT_SEED??73430),roundTicks:Number(process.env.STEWARD_EXPERIMENT_ROUND_TICKS??10800),stopTick:Number(process.env.STEWARD_EXPERIMENT_TICKS??7200),houseBots:JSON.parse(process.env.STEWARD_EXPERIMENT_HOUSE_BOTS??'{"warden":2,"reaver":2,"sovereign":2}'),clock:'paused lockstep',evaluation:'one-tick action follow-up; authoritative queue/funding events; max 30 idle ticks',startedAt:new Date().toISOString(),checkpoints:[],actions:[],passed:false,deleted:false};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function cool(error:unknown,attempt:number){
 if(!/429|Rate limited/.test(String(error)))throw error;
 let hint=1;try{const rows=(await readFile(run+'/sandbox-events.jsonl','utf8')).trim().split('\n').reverse();for(const line of rows){const e=JSON.parse(line);if(e.op==='rate-limit'){hint=e.retryAfterSeconds??1;break;}}}catch{}
 const ms=Math.max(hint*1000,Math.min(30000,1000*2**Math.min(attempt,5)));
 (result.retries??=[]).push({at:new Date().toISOString(),delayMs:ms});console.log(JSON.stringify({rateLimitBackoffSeconds:ms/1000}));await sleep(ms);
}
async function retry<T>(fn:()=>T|Promise<T>,kind='read'):Promise<T>{for(let n=0;n<30;n++){try{return await fn();}catch(e){await cool(e,n);}}throw new Error('Rate limit retry bound exceeded: '+kind);}
const call=(request:any)=>retry(()=>rawSandbox(request),request.op);
async function advanceTo(target:number){
 let current=state;
 for(let n=0;n<30;n++){
  assert.ok(current.world.tick<=target,'Clock overshoot');if(current.world.tick===target)return current;
  try{return await rawSandbox({op:'step',world:box.world.id,ticks:target-current.world.tick});}
  catch(e){await cool(e,n);current=await call({op:'read',world:box.world.id,resource:'state'});}
 }
 throw new Error('Clock retry bound exceeded');
}
const save=async()=>{
 result.timeline=timeline.rows(false);result.incoming=timeline.incoming;
 await writeFile(run+'/result.json.tmp',JSON.stringify(result,null,2),{mode:0o600});await rename(run+'/result.json.tmp',run+'/result.json');
 const lines=['| Minute | Village | Buildings (completed levels only) | Army (trained, home + away) |','|---:|---|---|---|'];
 for(const row of result.checkpoints)for(const v of row.villages){lines.push(`| ${row.minute} | ${v.name.replaceAll('|','\\|')} | ${Object.entries(v.buildings).map(([b,n])=>`${labels[b]??b} ${n}`).join(', ')} | ${Object.entries(v.army).map(([u,n])=>`${n} ${labels[u]??u}`).join(', ')||'—'} |`);}
 await writeFile(run+'/checkpoints.md',lines.join('\n')+'\n',{mode:0o600});
 await writeFile(run+'/timeline.md',timeline.markdown(),{mode:0o600});
};
let box:any,state:any,saved:any;
let interrupted=false;process.on('SIGTERM',()=>{interrupted=true;});process.on('SIGINT',()=>{interrupted=true;});
try{
 box=await retry(()=>PrivateSandbox.create(result.seed,result.roundTicks,result.houseBots),"create");result.worldId=box.world.id;
 state=await retry(()=>box.join());const rules=await retry(()=>box.rules());result.rulesVersion=rules.version;result.initial=structuredClone(state);assert.equal(state.world.tick,0);timeline.observe(state);
 const settings={serverUrl:'https://sandbox.invalid',worldId:box.world.id,apiKey:'sandbox-adapter-no-credential'};
 saved={settings,pending:null,active:[],automatic:false,decisions:[]};
 const storage={load:async()=>structuredClone(saved),save:async(value:any)=>{saved=structuredClone(value);await writeFile(run+'/controller.json',JSON.stringify(saved,null,2),{mode:0o600});}};
 let clockMs=0,cycles=0,failures=0;
 const planning=()=>({...state,world:{...state.world,status:state.world.status==='ended'?'ended':'running'}});
 const remote=async(_s:any,path:string,body?:any)=>{
  if(path==='/me')return {account:{id:state.player.id},worlds:[],sandboxes:[]};
  if(path==='/worlds')return [planning().world];
  if(path.endsWith('/state'))return planning();
  if(path.endsWith('/rules'))return rules;
  if(path.endsWith('/history'))return {samples:[]};
  if(path.endsWith('/map'))return retry(()=>privateRead(box,'/map'));
  if(path.endsWith('/reports'))return call({op:'read',world:box.world.id,resource:'reports'});
  if(path.includes('/reports/'))return retry(()=>privateRead(box,path.slice(path.indexOf('/reports/'))));
  if(path.endsWith('/simulate/battle'))return retry(()=>privateRead(box,'/simulate/battle',body));
  assert.ok(path.endsWith('/actions'),path);const action=body.actions[0];assert.deepEqual(saved.pending.action,action,'journal before write');
  assert.equal(body.actions.length,1);
  const response:any=await retrySandboxAction(()=>call({op:'act',world:box.world.id,requestId:action.clientId,actions:[action]}),(attempt:any)=>{
   result.actions.push({tick:state.world.tick,action,result:attempt.results[0],proposal:saved.pending.proposal});
  },sleep);
  state=response.state??await retry(()=>box.state());timeline.observe(state);if(!response.results[0]?.ok)failures++;assert.ok(failures<5,'Repeated action failures');return response;
 };
 let nextCheckpoint=0;
 async function capture(){
   const row:any={minute:state.world.tick/60,tick:state.world.tick,villages:state.villages.map((v:any)=>{
    const army:any={};for(const group of [v.units.home,v.units.away])for(const [u,n] of Object.entries(group))if(Number(n)>0)army[u]=(army[u]??0)+Number(n);
    return {id:v.id,name:v.name,buildings:v.buildings,units:v.units,supportHere:v.supportHere,supportAbroad:v.supportAbroad,army,resources:v.resources,resourcesMilli:v.resourcesMilli,population:v.population,production:v.production,queuedConstruction:v.buildQueue,queuedTraining:v.training};
   }),commands:state.commands};
   const file=await open(run+'/snapshots.jsonl','a',0o600);
   try{await file.writeFile(JSON.stringify(row)+'\n');await file.sync();}finally{await file.close();}
   result.checkpoints.push(row);result.lastTick=state.world.tick;await save();console.log(JSON.stringify({checkpoint:row.minute,villages:row.villages.length,elapsedSeconds:Math.round((Date.now()-Date.parse(result.startedAt))/1000)}));nextCheckpoint=Math.min(result.stopTick,nextCheckpoint+snapshotTicks);
 }
 const c=await Controller.create(storage,settings,remote,()=>clockMs);await c.cycle();await c.setAutomatic(true);

 while(state.world.tick<=result.stopTick){
  assert.ok(!interrupted,'Experiment interrupted; checkpoints preserved');assert.ok(++cycles<=20000,'Experiment cycle bound exceeded');
  if(state.world.tick===nextCheckpoint){
   await capture();
  }
  if(state.world.tick===result.stopTick)break;
  if(state.world.status==='ended'){
   result.final=state;result.lastTick=state.world.tick;result.cycles=cycles;
   if(result.checkpoints.at(-1)?.tick!==state.world.tick)await capture();
   throw new Error(`Sandbox ended at tick ${state.world.tick} before requested horizon ${result.stopTick}`);
  }
  clockMs=state.world.tick*1000;
  const before=result.actions.length;await c.cycle();const view=c.snapshot();
  if(view.error){result.lastControllerError=view.error;await save();throw new Error(view.error);}
  const tick=state.world.tick,events:number[]=[nextCheckpoint,result.stopTick,tick+30];
  if(result.actions.length>before||view.selection.selected)events.push(tick+1);
  if(state.player.nextActTick>tick)events.push(state.player.nextActTick);
  for(const v of state.villages){
   for(const q of v.buildQueue)events.push(q.endTick);
   for(const q of Object.values(v.training).flat() as any[])events.push(q.nextTick,q.endTick);
   for(const o of v.options.build)if(o.affordableAtTick>tick)events.push(o.affordableAtTick);
  }
  for(const p of view.proposals)if(p.affordableAtTick>tick)events.push(p.affordableAtTick);
  for(const command of [...state.commands.outgoing,...state.commands.incoming])if(command.arrivalTick>tick)events.push(command.arrivalTick);
  const next=Math.min(...events.filter(n=>Number.isFinite(n)&&n>tick));assert.ok(next>tick&&next<=result.stopTick);
  state=await advanceTo(next);timeline.observe(state);
 }
 await c.setAutomatic(false);result.final=state;result.lastTick=state.world.tick;result.cycles=cycles;assert.equal(state.world.tick,result.stopTick);assert.equal(result.checkpoints.at(-1).tick,result.stopTick);result.passed=true;
}catch(error){result.error=String(error);throw error;}
finally{
 result.finishedAt=new Date().toISOString();
 // Battle and scouting reports, paged to the end; best effort so a failed read never hides the run.
 if(box&&state)try{
  const summaries:any[]=[];let before:string|null|undefined;
  for(let page=0;page<50;page++){const data:any=await call({op:'read',world:box.world.id,resource:'reports',...(before?{before}:{})});if(!Array.isArray(data?.reports))break;summaries.push(...data.reports);before=data.next;if(!before)break;}
  const reports=[];for(const summary of summaries.slice(0,500))reports.push(await retry(()=>privateRead(box,'/reports/'+summary.id)));
  await writeFile(run+'/reports.json',JSON.stringify(reports,null,2),{mode:0o600});result.reports=summaries.length;
 }catch(error){result.reportsError=String(error);}
 if(keep&&result.passed&&box)try{await call({op:'keep',world:box.world.id});result.kept=true;}catch(error){result.cleanupError=String(error);}
 if(!result.kept){
  if(box){try{await retry(()=>box.close(),"delete");result.deleted=true;}catch(error){result.cleanupError=String(error);}}
  try{await call({op:'cleanup'});}catch(error){result.cleanupError=String(error);}
 }
 await shutdownSandbox();
 await save();console.log(JSON.stringify({finished:true,passed:result.passed,lastTick:result.lastTick,deleted:result.deleted,error:result.error,output:run+'/checkpoints.md'}));
}
