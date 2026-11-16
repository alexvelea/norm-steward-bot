import assert from 'node:assert/strict';
import {readFile,writeFile,rename} from 'node:fs/promises';
// Each case runs an immutable source snapshot, never the live executor.
const source=process.env.STEWARD_EXPERIMENT_SOURCE||process.cwd();
const tools=process.env.STEWARD_REVIEW_TOOLS||process.cwd();
const {nextConquestBuilding,safeEnvoyAttack,fundingUpgrade}=await import(tools+'/src/review/conquest-plan.ts');
const {Controller}=await import(source+'/src/control/controller.ts');
const {PrivateSandbox,sandbox:rawSandbox}=await import(tools+'/src/review/sandbox-client.ts');
const {privateRead}=await import(tools+'/scripts/experiment-raids.ts');
const run=process.env.STEWARD_REVIEW_RUN!;
const result:any={policy:process.env.STEWARD_EXPERIMENT_POLICY??'scripted-conquest',seed:Number(process.env.STEWARD_EXPERIMENT_SEED??73430),roundTicks:10800,stopTick:Number(process.env.STEWARD_EXPERIMENT_TICKS??10800),houseBots:{warden:0,reaver:0,sovereign:0},clock:'paused lockstep',evaluation:'one-tick action follow-up; authoritative queue/funding events; max 30 idle ticks',startedAt:new Date().toISOString(),checkpoints:[],actions:[],passed:false,deleted:false};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
let lastCall=0,paceMs=800;
async function paced<T>(fn:()=>T):Promise<T>{await sleep(Math.max(0,paceMs-(Date.now()-lastCall)));lastCall=Date.now();return fn();}
async function cool(error:unknown,attempt:number){
 if(!/429|Rate limited/.test(String(error)))throw error;
 let hint=1;try{const rows=(await readFile(run+'/sandbox-events.jsonl','utf8')).trim().split('\n').reverse();for(const line of rows){const e=JSON.parse(line);if(e.op==='rate-limit'){hint=e.retryAfterSeconds??1;break;}}}catch{}
 const ms=Math.max(hint*1000,Math.min(30000,1000*2**Math.min(attempt,5)));
 (result.retries??=[]).push({at:new Date().toISOString(),delayMs:ms});console.log(JSON.stringify({rateLimitBackoffSeconds:ms/1000}));await sleep(ms);
}
async function retry<T>(fn:()=>T,kind='read'):Promise<T>{for(let n=0;n<30;n++){try{return await paced(fn);}catch(e){await cool(e,n);}}throw new Error('Rate limit retry bound exceeded: '+kind);}
const call=(request:any)=>retry(()=>rawSandbox(request),request.op);
async function advanceTo(target:number){
 let current=state;
 for(let n=0;n<30;n++){
  assert.ok(current.world.tick<=target,'Clock overshoot');if(current.world.tick===target)return current;
  try{return await paced(()=>rawSandbox({op:'step',world:box.world.id,ticks:target-current.world.tick}));}
  catch(e){await cool(e,n);current=await call({op:'read',world:box.world.id,resource:'state'});}
 }
 throw new Error('Clock retry bound exceeded');
}
const save=async()=>{
 await writeFile(run+'/result.json.tmp',JSON.stringify(result,null,2),{mode:0o600});await rename(run+'/result.json.tmp',run+'/result.json');
 const lines=['| Minute | Buildings (completed levels only) | Army (trained, home + away) |','|---:|---|---|'];
 const labels:any={hall:'Hall',lumberyard:'Lumberyard',quarry:'Quarry',mine:'Iron Mine',farm:'Farm',storehouse:'Storehouse',cellar:'Cellar',barracks:'Barracks',smithy:'Smithy',stable:'Stable',workshop:'Workshop',market:'Market',wall:'Wall',watchtower:'Watchtower',court:'Court',pikeman:'Pikemen',shieldman:'Shieldmen',raider:'Raiders',archer:'Archers',scout:'Scouts',lancer:'Lancers',knight:'Knights',ram:'Rams',trebuchet:'Trebuchets',envoy:'Envoys'};
 for(const row of result.checkpoints)for(const v of row.villages){lines.push(`| ${row.minute} | ${Object.entries(v.buildings).map(([b,n])=>`${labels[b]??b} ${n}`).join(', ')} | ${Object.entries(v.army).map(([u,n])=>`${n} ${labels[u]??u}`).join(', ')||'—'} |`);}
 await writeFile(run+'/checkpoints.md',lines.join('\n')+'\n',{mode:0o600});
};
let box:any,state:any,saved:any;
let interrupted=false;process.on('SIGTERM',()=>{interrupted=true;});process.on('SIGINT',()=>{interrupted=true;});
try{
 box=await retry(()=>new PrivateSandbox(result.seed,result.roundTicks,result.houseBots),"create");result.worldId=box.world.id;
 state=await retry(()=>box.join());const rules=await retry(()=>box.rules());result.rulesVersion=rules.version;result.rules=rules;paceMs=Math.max(150,Math.ceil(2000/(.65*Number(rules.rules.SERVER.dashboardPerSecond))));result.apiPaceMs=paceMs;result.initial=structuredClone(state);assert.equal(state.world.tick,0);
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
  const response:any=await call({op:'act',world:box.world.id,requestId:action.clientId,actions:[action]});
  result.actions.push({tick:state.world.tick,action,result:response.results[0],proposal:saved.pending.proposal});
  state=response.state??await retry(()=>box.state());if(!response.results[0]?.ok)failures++;assert.ok(failures<5,'Repeated action failures');return response;
 };
 let nextCheckpoint=0;
 async function capture(){
   const row:any={minute:state.world.tick/60,tick:state.world.tick,villages:state.villages.map((v:any)=>{
    const army:any={};for(const group of [v.units.home,v.units.away])for(const [u,n] of Object.entries(group))if(Number(n)>0)army[u]=(army[u]??0)+Number(n);
    return {name:v.name,buildings:Object.fromEntries(Object.entries(v.buildings).filter(([,n])=>Number(n)>0)),army,resources:v.resources,population:v.population,production:v.production,queuedConstruction:v.buildQueue,queuedTraining:v.training};
   })};result.checkpoints.push(row);result.lastTick=state.world.tick;await save();console.log(JSON.stringify({checkpoint:row.minute,buildings:row.villages[0].buildings,army:row.villages[0].army,elapsedSeconds:Math.round((Date.now()-Date.parse(result.startedAt))/1000)}));nextCheckpoint=Math.min(result.stopTick,nextCheckpoint+600);
 }
 const c=await Controller.create(storage,settings,remote,()=>clockMs);await c.cycle();await c.setAutomatic(true);

 while(state.world.tick<=result.stopTick){
  assert.ok(!interrupted,'Experiment interrupted; checkpoints preserved');assert.ok(++cycles<=20000,'Experiment cycle bound exceeded');
  if(state.world.tick===nextCheckpoint){
   await capture();
  }
  if(state.world.tick===result.stopTick)break;
  clockMs=state.world.tick*1000;
  const before=result.actions.length;await c.cycle();const view=c.snapshot();
  if((state.villages[0].units.home.pikeman??0)>=150){result.defenseMilestone={tick:state.world.tick,village:structuredClone(state.villages[0])};break;}
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
  state=await advanceTo(next);
 }
 assert.ok(result.defenseMilestone,'150 Pikemen not reached');
 await c.setAutomatic(false);
 const origin=state.villages[0].id;
 const village=()=>state.villages.find((v:any)=>v.id===origin);
 let actionSequence=0;
 const mark=async(phase:string)=>{result.milestones??=[];result.milestones.push({phase,tick:state.world.tick,buildings:structuredClone(village().buildings),resources:structuredClone(village().resources),army:structuredClone(village().units.home)});await save();console.log(JSON.stringify(result.milestones.at(-1)));};
 async function step(target:number){
  assert.ok(!interrupted,'Experiment interrupted');assert.ok(target<state.world.endsAtTick,'Insufficient round time');
  while(target>state.world.tick)state=await advanceTo(Math.min(target,state.world.tick+3600));
 }
 async function act(action:any){
  const id='conquest-'+actionSequence++;
  await writeFile(run+'/phase-journal.json',JSON.stringify({id,tick:state.world.tick,action}),{mode:0o600});
  const response:any=await call({op:'act',world:box.world.id,requestId:id,actions:[action]});
  result.actions.push({tick:state.world.tick,action,result:response.results[0],phase:'conquest-prototype'});
  assert.ok(response.results[0]?.ok,JSON.stringify(response.results));state=response.state??await retry(()=>box.state());await save();return response;
 }
 async function finishBuild(){const end=Math.max(state.world.tick,...village().buildQueue.map((q:any)=>q.endTick),state.player.nextActTick??0);if(end>state.world.tick)await step(end);}
 async function fund(cost:any){
  for(let n=0;n<100;n++){
   const v=village();if(Object.values(cost).some((x:any)=>x>v.storage)){await build('storehouse');continue;}
   const wait=Math.max(0,...['timber','stone','iron'].map(r=>Math.ceil((cost[r]*1000-v.resourcesMilli[r])/v.productionPerTickMilli[r])));
   if(wait===0)return;
   // An upgrade is justified only if its exact cost/build delay brings the next bill forward.
   let better:any=null;
   for(const [building,resource] of [['lumberyard','timber'],['quarry','stone'],['mine','iron']]){
    const o=v.options.build.find((o:any)=>o.building===building);if(!o?.ok||o.level>20||o.cost[resource]*1000>v.resourcesMilli[resource]||v.population.max-v.population.used<o.pop)continue;
    if(['timber','stone','iron'].some(r=>o.cost[r]*1000>v.resourcesMilli[r]))continue;
    const prod=rules.tables.production?.[o.level]?.perTickMilli;
    if(typeof prod!=='number')continue;
    const forecast=fundingUpgrade({stockMilli:v.resourcesMilli,incomeMilli:v.productionPerTickMilli,bill:cost,upgradeCost:o.cost,ticks:o.ticks,resource:resource as any,newIncomeMilli:prod});
    if(forecast.improves&&(!better||forecast.upgradeTicks<better.total))better={building,total:forecast.upgradeTicks};
   }
   if(better){result.fundingUpgrades??=[];result.fundingUpgrades.push({tick:state.world.tick,building:better.building,waitWithout:wait,waitWith:better.total});await build(better.building);continue;}
   result.fundingWaits??=[];result.fundingWaits.push({tick:state.world.tick,ticks:wait,cost});await step(state.world.tick+wait);
  }
  throw new Error('Funding iteration bound');
 }
 async function population(need:number){
  while(village().population.max-village().population.used<need+Math.max(50,Math.ceil(village().population.max*.2)))await build('farm',true);
 }
 async function build(building:string,isFarm=false):Promise<void>{
  await finishBuild();
  for(const [b,level] of Object.entries(rules.rules.BUILDINGS[building].requires))while(village().buildings[b]<Number(level))await build(b);
  let o=village().options.build.find((o:any)=>o.building===building);assert.ok(o);
  if(!isFarm)await population(o.pop);
  await fund(o.cost);o=village().options.build.find((o:any)=>o.building===building);
  await act({type:'build',village:origin,building});await finishBuild();
 }
 async function train(unit:string,count:number){
  let o=village().options.train.find((o:any)=>o.unit===unit);assert.ok(o,unit);await population(o.pop*count);
  o=village().options.train.find((o:any)=>o.unit===unit);const cost=Object.fromEntries(['timber','stone','iron'].map(r=>[r,o.cost[r]*count]));await fund(cost);
  await act({type:'train',village:origin,unit,count});
 }
 await finishBuild();
 // Finish the already-paid defensive cohort; do not buy further 3Pi1Sh in this prototype.
 await step(Math.max(state.world.tick,...Object.values(village().training).flat().map((q:any)=>q.endTick)));
 await mark('150-Pikemen transition');
 while(Math.min(village().buildings.lumberyard,village().buildings.quarry,village().buildings.mine)<15){
  const b=['lumberyard','quarry','mine'].sort((a,b)=>village().buildings[a]-village().buildings[b]||a.localeCompare(b))[0];await build(b);
 }
 await mark('all producers 15');
 const map:any=await retry(()=>privateRead(box,'/map'));const v=village();
 const target=map.villages.filter((t:any)=>t.ownerId===null).sort((a:any,b:any)=>Math.hypot(a.x-v.x,a.y-v.y)-Math.hypot(b.x-v.x,b.y-v.y)||a.id.localeCompare(b.id))[0];assert.ok(target,'Nearby unowned target required');result.target=target;
 let escort=0,sim:any;
 for(let count=20;count<=1000;count+=20){
  sim=await retry(()=>privateRead(box,'/simulate/battle',{attacker:{raider:count,envoy:1},defender:{},wall:rules.rules.MAP.hamletLevels.wall[1],loyalty:100,baseDefense:rules.rules.MAP.hamletBaseDefense+rules.rules.MAP.hamletMilitiaCap}));
  if(safeEnvoyAttack(sim)){escort=count;break;}
 }
 assert.ok(escort,'No affordable bounded escort found');result.escort={count:escort,simulation:sim,assumptions:'Unowned hamlet, maximum live militia and wall, at most 20% escort casualties; only Envoy must survive.'};
 let raidersQueued=false;
 while(nextConquestBuilding(village().buildings,rules)){
  const b=nextConquestBuilding(village().buildings,rules);await build(b);
  if(!raidersQueued&&village().buildings.barracks>=10&&village().buildings.smithy>=2){await train('raider',escort);raidersQueued=true;await mark('Raiders queued alongside infrastructure');}
 }
 await mark('Court completed');await train('envoy',1);
 await step(Math.max(state.world.tick,...Object.values(village().training).flat().map((q:any)=>q.endTick)));
 await mark('conquest force ready');
 for(let wave=1;wave<=6&&!state.villages.some((v:any)=>v.id===target.id);wave++){
  const fresh:any=await retry(()=>privateRead(box,'/map'));assert.equal(fresh.villages.find((t:any)=>t.id===target.id)?.ownerId,null,'Never attack an occupied target');
  assert.ok(village().units.home.envoy>=1,'Envoy lost before conquest');
  const before=state.world.tick;await act({type:'send',village:origin,target:target.id,kind:'attack',units:{raider:village().units.home.raider,envoy:1}});
  for(let n=0;n<10&&state.commands.outgoing.length;n++)await step(Math.max(state.world.tick+1,Math.min(...state.commands.outgoing.map((c:any)=>c.arrivalTick))));
  const reports:any=await call({op:'read',world:box.world.id,resource:'reports'});
  const report=reports.reports.filter((r:any)=>r.kind==='battle'&&r.tick>=before).sort((a:any,b:any)=>b.tick-a.tick)[0];assert.ok(report,'Battle report missing');
  const detail:any=await retry(()=>privateRead(box,'/reports/'+report.id));result.battles??=[];result.battles.push({wave,report:detail,tick:state.world.tick});await save();console.log(JSON.stringify({wave,tick:state.world.tick,report:detail}));
 }
 assert.ok(state.villages.some((v:any)=>v.id===target.id),'No confirmed conquest within bounded waves');
 await mark('unowned village conquered');result.final=state;result.lastTick=state.world.tick;result.passed=true;

}catch(error){result.error=String(error);throw error;}
finally{
 result.finishedAt=new Date().toISOString();if(box){try{await retry(()=>box.close(),"delete");result.deleted=true;}catch(error){result.cleanupError=String(error);}}
 await save();console.log(JSON.stringify({finished:true,passed:result.passed,lastTick:result.lastTick,deleted:result.deleted,error:result.error,output:run+'/checkpoints.md'}));
}
