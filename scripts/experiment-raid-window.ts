/** Earlier ordinary-action fixture: overlap independent queues and scout actual outposts before buying siege. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PrivateSandbox, sandbox } from '../src/review/sandbox-client.js';
import { privateRead } from './experiment-raids.js';
import type { Action, StateResponse, ReportsResponse, Report, MapResponse, SimulateBattleResponse } from '../src/shared/api.js';

export function earlyClearingSetup(s: PrivateSandbox, row: Record<string,any>) {
 let state=s.join();const rules=s.rules();
 const sizing=privateRead<SimulateBattleResponse>(s,'/simulate/battle',{attacker:{raider:40,ram:12,trebuchet:24,scout:10},defender:{pikeman:24},wall:3,aim:'barracks',aimLevel:5,resources:{timber:1000,stone:1000,iron:1000},hidden:0});
 row.sizing={kind:'historical-outpost-sizing-only',battle:sizing};
 assert.ok(sizing.winner==='attacker' && sizing.wall.after===0 && sizing.building?.after===0,'Size the ordinary clearing fixture before purchases');
 const step=(tick:number)=>{while(tick>state.world.tick && state.world.status!=='ended')state=sandbox<StateResponse>({op:'step',world:s.world.id,ticks:Math.min(3600,tick-state.world.tick)});};
 const act=(a:Action)=>{const response=s.act([a]);assert.ok(response.results[0].ok,JSON.stringify(response.results));state=response.state??s.state();row.steps.push({tick:state.world.tick,action:a});return response;};
 const build=(building:Extract<Action,{type:'build'}>['building'])=>{const v=state.villages[0],o=v.options.build.find(o=>o.building===building)!;step(Math.max(state.world.tick,state.player.nextActTick??0,o.affordableAtTick??0));act({type:'build',village:v.id,building});step(Math.max(...state.villages[0].buildQueue.map(q=>q.endTick)));};
 const train=(unit:Extract<Action,{type:'train'}>['unit'],count:number)=>{const v=state.villages[0],o=v.options.train.find(o=>o.unit===unit)!;const wait=Math.max(0,...(['timber','stone','iron'] as const).map(r=>Math.ceil((o.cost[r]*count*1000-v.resourcesMilli[r])/v.productionPerTickMilli[r])));step(Math.max(state.world.tick+wait,state.player.nextActTick??0));act({type:'train',village:v.id,unit,count});};
 // Production first makes a much earlier fixture than the saved serial military setup.
 for(let n=0;n<6;n++)for(const b of ['lumberyard','quarry','mine'] as const)build(b);
 for(let n=0;n<3;n++)build('lumberyard');
 for(let n=0;n<2;n++)build('quarry');
 for(let n=0;n<6;n++)build('storehouse');
 for(const b of ['hall','hall','barracks','hall','hall','smithy','wall','wall','wall','farm','farm','farm','farm','farm','farm','farm','farm'] as const)build(b);
 train('pikeman',40);for(let n=0;n<5;n++)build('hall');
 for(let n=0;n<4;n++)build('barracks');
 step(Math.max(state.world.tick,...state.villages[0].training.barracks.map(q=>q.endTick)));train('shieldman',15);
 build('smithy');
 step(Math.max(state.world.tick,...state.villages[0].training.barracks.map(q=>q.endTick)));train('raider',50);
 for(let n=0;n<3;n++)build('smithy');build('stable');
 train('scout',12);for(let n=0;n<5;n++)build('smithy');build('workshop');build('workshop');
 train('ram',process.argv.includes('--early-conquest') ? 10 : process.argv.includes('--multi-diversion') ? 17 : process.argv.includes('--diversion') ? 13 : 12);step(Math.max(...state.villages[0].training.workshop.map(q=>q.endTick)));train('trebuchet',process.argv.includes('--early-conquest') ? 10 : 24);
 while(state.villages[0].hidden<Math.max(...Object.values(state.villages[0].productionPerTickMilli))*300/1000)build('cellar');
 step(Math.max(state.world.tick,...Object.values(state.villages[0].training).flat().map(q=>q.endTick)));

 return {get state(){return state;}, rules, act, step, stepTo:step, build, train, refresh(){state=s.state();return state;}};
}

import { Controller } from '../src/control/controller.js';
import { RemoteError, type Remote } from '../src/control/remote.js';
import type { SavedControl } from '../src/control/types.js';
import { evaluateEconomy } from '../src/advisors/economic.js';
import { militaryAdvisor } from '../src/advisors/military.js';
import { evaluateScoutDispatch } from '../src/advisors/scout-dispatch.js';
import { selectProposal } from '../src/advisors/president.js';

const run=process.env.STEWARD_REVIEW_RUN!;
const seed=Number(process.argv.find(a=>a.startsWith('--seed='))?.split('=')[1] ?? 73421);
assert.ok(Number.isSafeInteger(seed) && seed >= 0);
const output=run+(process.argv.includes('--early-conquest') ? '/raid-early-conquest-comparison.json' : process.argv.includes('--multi-diversion') ? '/raid-multi-diversion-comparison.json' : process.argv.includes('--diversion') ? '/raid-diversion-comparison.json' : '/raid-window-comparison.json');
const referencePath=process.argv.find(a=>a.startsWith('--baseline-from='))?.slice('--baseline-from='.length);
if(referencePath) assert.equal(dirname(resolve(referencePath)),resolve(run),'Candidate probe must belong to this managed run');
const rows:Record<string,any>[]=referencePath ? JSON.parse(await readFile(referencePath,'utf8')).results.filter((r:any)=>r.policy==='candidate') : [];
if(referencePath) assert.ok(rows.length===1 && rows[0].passed && rows[0].deleted && rows[0].seed===seed && rows[0].pausedRestartConfirmed && rows[0].lostResponseSuppressed,'Reuse only a completed matching candidate probe from this run');
const save=(passed=false,error?:string)=>writeFile(output,JSON.stringify({taskId:'risk-gated-raid-execution',baseline:'deployed-no-raid-policy',candidate:'risk-gated-raid-execution',candidateSource:referencePath,passed,error,results:rows},null,2));
try {
 for(const policy of (referencePath ? ['baseline'] : process.argv.includes('--candidate-only') ? ['candidate'] : ['candidate','baseline'])){
  const s=new PrivateSandbox(seed,10800,{warden:0,reaver:0,sovereign:1});
  const row:Record<string,any>={policy,seed,worldId:s.world.id,steps:[]};rows.push(row);
  try {
   const x=earlyClearingSetup(s,row);row.ready=structuredClone(x.state);await save();console.log(JSON.stringify({policy,readyTick:x.state.world.tick,units:x.state.villages[0].units}));
   const mapCadence=(x.rules.rules.SCORING as {publicSnapshotTicks:number}).publicSnapshotTicks;
   x.step(Math.ceil(Math.max(process.argv.includes('--early-conquest') ? 5400 : 7000,x.state.world.tick)/mapCadence)*mapCadence);
   let map=privateRead<MapResponse>(s,'/map');const bot=map.players.find(p=>p.houseBot==='sovereign')!;
   let targets=map.villages.filter(v=>v.ownerId===bot.id);
   while(process.argv.includes('--early-conquest') && targets.length<2 && x.state.world.tick<7500){x.step(x.state.world.tick+mapCadence);map=privateRead<MapResponse>(s,'/map');targets=map.villages.filter(v=>v.ownerId===bot.id);}
   const target=targets.filter(v=>v.points<Math.max(...targets.map(v=>v.points))).sort((a,b)=>a.points-b.points || Math.hypot(a.x-x.state.villages[0].x,a.y-x.state.villages[0].y)-Math.hypot(b.x-x.state.villages[0].x,b.y-x.state.villages[0].y))[0];
   assert.ok(target,'Ordinary acquired outpost required');row.target=target;
   const speed=(x.rules.rules.UNITS as Record<string,{speed:number}>);const distance=Math.hypot(target.x-x.state.villages[0].x,target.y-x.state.villages[0].y);
   const travel=Math.ceil(distance*speed.scout.speed);const siegeTravel=Math.ceil(distance*speed.ram.speed);const raidTravel=Math.ceil(distance*speed.raider.speed);
   const cadence=(x.rules.rules.SCORING as {publicSnapshotTicks:number}).publicSnapshotTicks;
   const scout=()=>{const arrival=Math.ceil((x.state.world.tick+travel+1)/cadence)*cadence;x.step(arrival-travel);const r=x.act({type:'send',village:x.state.villages[0].id,target:target.id,kind:'attack',units:{scout:2}}).results[0];assert.ok(r.ok&&'command' in r.data);const command=r.data.command;x.step(command.arrivalTick);const summary=sandbox<ReportsResponse>({op:'read',world:s.world.id,resource:'reports'}).reports.find(r=>r.commandId===command.id)!;const detail=privateRead<Report>(s,'/reports/'+summary.id);return {command,summary,detail};};
   const before=scout();row.before=before;await save();assert.ok(before.detail.intel,'Full current intelligence before a clearing action');
   const units={raider:40,ram:process.argv.includes('--early-conquest') ? 10 : process.argv.includes('--multi-diversion') ? 15 : 12,trebuchet:process.argv.includes('--early-conquest') ? 10 : 24,scout:Math.min(10,x.state.villages[0].units.home.scout??0)};
   row.prediction=privateRead<SimulateBattleResponse>(s,'/simulate/battle',{fromReport:before.summary.id,attacker:units,aim:'barracks'});await save();
   console.log(JSON.stringify({policy,tick:x.state.world.tick,target,prediction:row.prediction}));
   assert.ok(row.prediction.winner==='attacker'&&row.prediction.wall.after===0&&row.prediction.building?.after===0,'Current authoritative prediction must clear wall and Barracks');
   if(process.argv.includes('--diversion') || process.argv.includes('--multi-diversion')) {
    row.diversions=[];
    row.beforeDiversionLog=sandbox({op:'read',world:s.world.id,resource:'log'});
    for(const capital of (process.argv.includes('--multi-diversion') ? targets.filter(t=>t.id!==target.id) : [targets.sort((a,b)=>b.points-a.points)[0]])) {
    assert.notEqual(capital.id,target.id);
    const diversion=x.act({type:'send',village:x.state.villages[0].id,target:capital.id,kind:'attack',units:{pikeman:10,ram:1}}).results[0];
    assert.ok(diversion.ok && 'command' in diversion.data);
    row.diversions.push({purpose:'Ordinary simultaneous threat to divert reinforcement from the clearing target',command:diversion.data.command});await save();
    }
   }
   // Use observed home Scouts: enemy reconnaissance may remove some during setup.
   // Send immediately; snapshot alignment needlessly ages the prediction.
   const r=x.act({type:'send',village:x.state.villages[0].id,target:target.id,kind:'attack',units,aim:'barracks'}).results[0];assert.ok(r.ok&&'command' in r.data);const clearing=r.data.command;
   x.step(clearing.arrivalTick);const summary=sandbox<ReportsResponse>({op:'read',world:s.world.id,resource:'reports'}).reports.find(r=>r.commandId===clearing.id)!;
   row.clearing={command:clearing,detail:privateRead<Report>(s,'/reports/'+summary.id)};row.afterClearingLog=sandbox({op:'read',world:s.world.id,resource:'log'});await save();
   assert.equal(row.clearing.detail.outcome,'won');assert.equal(row.clearing.detail.wall.after,0);assert.equal(row.clearing.detail.building.after,0);
   x.step(clearing.arrivalTick+siegeTravel);
   // Shared headroom prevents capacity protection from masking the raid choice and
   // permits exact credited-loot accounting without storage overflow.
   x.build('storehouse');x.build('storehouse');x.build('storehouse');
   const observation=scout();row.observation=observation;await save();
   assert.ok(observation.detail.intel && observation.detail.intel.buildings.wall===0,'Fresh ordinary scouting must establish a wall-free target');
   const scope=JSON.stringify(['https://sandbox.invalid',x.state.player.id,s.world.id,x.state.world.epoch]);
   const linked={scope,villageId:x.state.villages[0].id,targetId:target.id,targetOwnerId:target.ownerId!,commandId:observation.command.id,sentTick:observation.command.sentTick,report:observation.summary};
   const settings={serverUrl:'https://sandbox.invalid',worldId:s.world.id,apiKey:'sandbox-adapter-no-credential'};
   let saved:SavedControl={settings,pending:null,automatic:false,decisions:[],scouting:[linked]};
   const storage={load:async()=>structuredClone(saved),save:async(v:SavedControl)=>{saved=structuredClone(v);}};
   let now=0,lose=false;const charges:Record<string,any>[]=[];
   const planning=()=>({...x.state,world:{...x.state.world,status:'running' as const}});
   const remote:Remote=async<T>(_s:unknown,path:string,body?:unknown):Promise<T>=>{
    if(path==='/me')return {account:{id:x.state.player.id},worlds:[],sandboxes:[]} as T;
    if(path==='/worlds')return [planning().world] as T;
    if(path.endsWith('/state')){x.refresh();return planning() as T;}
    if(path.endsWith('/rules'))return x.rules as T;
    if(path.endsWith('/history'))return {samples:[]} as T;
    if(path.endsWith('/map'))return privateRead<MapResponse>(s,'/map') as T;
    if(path.endsWith('/reports'))return sandbox<ReportsResponse>({op:'read',world:s.world.id,resource:'reports'}) as T;
    if(path.includes('/reports/'))return privateRead<Report>(s,path.slice(path.indexOf('/reports/'))) as T;
    if(path.endsWith('/simulate/battle'))return privateRead<SimulateBattleResponse>(s,'/simulate/battle',body) as T;
    assert.ok(path.endsWith('/actions'));const action=(body as {actions:Action[]}).actions[0];assert.deepEqual(saved.pending!.action,action,'journal before write');
    const before=structuredClone(x.state);const response=sandbox<import('../src/shared/api.js').ActionsResponse>({op:'act',world:s.world.id,requestId:action.clientId,actions:[action]});assert.ok(response.results[0].ok,JSON.stringify(response.results));x.refresh();
    charges.push({action,results:response.results,spend:Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,(before.villages[0].resourcesMilli[r]-x.state.villages[0].resourcesMilli[r])/1000]))});
    if(lose)throw new RemoteError(0,5000,'Controlled successful private response loss');return response as T;
   };
   row.initial=structuredClone(x.state.villages[0]);row.initialTick=x.state.world.tick;row.clockStatus=x.state.world.status;row.planningWorldStatus='running';row.charges=charges;
   if(policy==='candidate'){
    const c=await Controller.create(storage,settings,remote,()=>now);await c.cycle();row.selected=c.snapshot().selection.selected;row.snapshot=c.snapshot();await save();assert.equal(row.selected?.action.type,'send','President must choose useful raid');assert.equal(row.selected.action.units.raider,10);
    await c.setAutomatic(true);await c.cycle();assert.equal(charges.length,1);assert.equal(saved.pending?.phase,'accepted');const command=charges[0].results[0].data.command;row.command=command;
    await c.setAutomatic(false);x.step(command.arrivalTick);const restart=await Controller.create(storage,settings,remote,()=>now);await restart.cycle();assert.equal(restart.snapshot().automatic,false);assert.equal(saved.pending,null);assert.equal(charges.length,1);row.pausedRestartConfirmed=true;
    const battleSummary=sandbox<ReportsResponse>({op:'read',world:s.world.id,resource:'reports'}).reports.find(r=>r.commandId===command.id)!;row.battle=privateRead<Report>(s,'/reports/'+battleSummary.id);assert.equal(row.battle.attackerUnits.lost.raider??0,0);assert.ok(Object.values(row.battle.loot as Record<string,number>).reduce((a,b)=>a+b,0)>=60);
   }else{
    map=privateRead<MapResponse>(s,'/map');const ctx={state:planning(),rules:x.rules};row.selected=selectProposal([...evaluateEconomy(ctx),...militaryAdvisor.evaluate(ctx),...evaluateScoutDispatch(ctx,{scope,map,observations:[linked]})]).selected;
    if(row.selected){assert.notEqual(row.selected.action.type,'send');const before=structuredClone(x.state);const response=x.act(row.selected.action);charges.push({action:row.selected.action,results:response.results,spend:Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,(before.villages[0].resourcesMilli[r]-x.state.villages[0].resourcesMilli[r])/1000]))});}
   }
   x.step(row.initialTick+2*raidTravel+1);row.comparisonTick=x.state.world.tick;row.final=structuredClone(x.state.villages[0]);await save();
   if(policy==='candidate'){
    assert.ok((x.state.villages[0].units.home.raider??0)>=row.initial.units.home.raider,'All Raiders returned');
    const loot=row.battle.loot as Record<string,number>;row.returnedLoot=Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,(row.final.resourcesMilli[r]-row.initial.resourcesMilli[r]-(row.comparisonTick-row.initialTick)*row.initial.productionPerTickMilli[r])/1000]));assert.deepEqual(row.returnedLoot,loot);
    x.step(Math.max(x.state.world.tick,row.initialTick+600));const fresh=scout();saved.scouting=[{...linked,commandId:fresh.command.id,sentTick:fresh.command.sentTick,report:fresh.summary}];
    const recovery=await Controller.create(storage,settings,remote,()=>now);await recovery.cycle();row.recoverySelection=recovery.snapshot().selection.selected;await save();assert.equal(row.recoverySelection?.action.type,'send');assert.equal(row.recoverySelection.action.units.raider,10);
    lose=true;await recovery.setAutomatic(true);await recovery.cycle();assert.equal(saved.pending?.phase,'uncertain');const count=charges.length;await recovery.setAutomatic(false);now+=10000;
    const afterLoss=await Controller.create(storage,settings,remote,()=>now);await afterLoss.cycle();assert.equal(charges.length,count);assert.equal(saved.pending,null);assert.equal(afterLoss.snapshot().automatic,false);row.lostResponseSuppressed=true;
   }
   row.passed=true;await save();
  }finally{try{row.lastState=s.state();}finally{s.close();row.deleted=true;await save();}}
 }
 if(process.argv.includes('--candidate-only')) {
  await save(false,'Candidate-only probe; matched baseline remains required before activation');
 } else {
 const a=rows.find(r=>r.policy==='baseline')!,b=rows.find(r=>r.policy==='candidate')!;
 assert.equal(a.initialTick,b.initialTick);assert.equal(a.comparisonTick,b.comparisonTick);for(const key of ['buildings','resourcesMilli','population','units'])assert.deepEqual(a.initial[key],b.initial[key]);
 assert.equal(b.pausedRestartConfirmed,true);assert.equal(b.lostResponseSuppressed,true);await save(true);console.log(JSON.stringify({passed:true,results:rows.map(r=>({policy:r.policy,initialTick:r.initialTick,comparisonTick:r.comparisonTick,selected:r.selected,returnedLoot:r.returnedLoot,deleted:r.deleted}))}));
 }
}catch(error){await save(false,String(error));throw error;}
