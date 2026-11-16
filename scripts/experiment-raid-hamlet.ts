/** Matched ordinary-action cleared-hamlet raid, using only the managed owner sandbox. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {PrivateSandbox,sandbox} from '../src/review/sandbox-client.js';
import {privateRead} from './experiment-raids.js';
import {Controller} from '../src/control/controller.js';
import {RemoteError,type Remote} from '../src/control/remote.js';
import type {SavedControl} from '../src/control/types.js';
import {evaluateEconomy} from '../src/advisors/economic.js';
import {militaryAdvisor} from '../src/advisors/military.js';
import {evaluateScoutDispatch} from '../src/advisors/scout-dispatch.js';
import {selectProposal} from '../src/advisors/president.js';
import type {Action,ActionsResponse,MapResponse,Report,ReportsResponse,StateResponse} from '../src/shared/api.js';
const output=process.env.STEWARD_REVIEW_RUN!+'/raid-hamlet-comparison.json';
const rows:Record<string,any>[]=[];
const save=(passed=false,error?:string)=>writeFile(output,JSON.stringify({taskId:'risk-gated-raid-execution',baseline:'deployed-no-raid-policy',candidate:'arrival-militia-zero-loss-lancer-raid',passed,error,results:rows},null,2));
try {
 for(const policy of ['candidate','baseline']) {
  const s=new PrivateSandbox(73421,10800);
  const row:Record<string,any>={policy,worldId:s.world.id,setup:[]};rows.push(row);
  try {
   let state=s.join();const rules=s.rules();
   const step=(tick:number)=>{while(tick>state.world.tick && state.world.status!=='ended')state=sandbox<StateResponse>({op:'step',world:s.world.id,ticks:Math.min(3600,tick-state.world.tick)});};
   const act=(a:Action)=>{const r=s.act([a]);assert.ok(r.results[0].ok,JSON.stringify(r.results));state=r.state??s.state();row.setup.push({tick:state.world.tick,action:a,results:r.results});return r;};
   const complete=()=>step(Math.max(state.world.tick,...state.villages[0].buildQueue.map(q=>q.endTick),...Object.values(state.villages[0].training).flat().map(q=>q.endTick)));
   const build=(building:Extract<Action,{type:'build'}>['building'])=>{const o=state.villages[0].options.build.find(o=>o.building===building)!;step(Math.max(state.world.tick,state.player.nextActTick??0,o.affordableAtTick??0));act({type:'build',village:state.villages[0].id,building});complete();};
   const train=(unit:Extract<Action,{type:'train'}>['unit'],count:number)=>{const v=state.villages[0],o=v.options.train.find(o=>o.unit===unit)!;assert.ok(Object.values(o.cost).every(n=>n*count<=v.storage));const wait=Math.max(0,...(['timber','stone','iron'] as const).map(r=>Math.ceil((o.cost[r]*count*1000-v.resourcesMilli[r])/v.productionPerTickMilli[r])));step(Math.max(state.world.tick+wait,state.player.nextActTick??0));act({type:'train',village:v.id,unit,count});complete();};
   for(let n=0;n<6;n++)for(const b of ['lumberyard','quarry','mine'] as const)build(b);
   for(let n=0;n<7;n++)build('storehouse');
   for(let n=0;n<9;n++)build('farm');
   for(let n=0;n<2;n++)build('hall');build('barracks');for(let n=0;n<7;n++)build('hall');
   for(let n=0;n<4;n++)build('barracks');for(let n=0;n<10;n++)build('smithy');
   for(let n=0;n<3;n++)build('stable');build('workshop');
   train('pikeman',10);train('shieldman',5);train('raider',10);train('scout',2);
   train('lancer',30);train('lancer',30);train('ram',12);
   while(state.villages[0].hidden<Math.max(...Object.values(state.villages[0].productionPerTickMilli))*300/1000)build('cellar');
   // Extra storage is common fixture setup, not a raid-policy purchase.
   build('storehouse');build('storehouse');
   let map=privateRead<MapResponse>(s,'/map');const origin=state.villages[0];
   const target=map.villages.filter(t=>t.ownerId===null).sort((a,b)=>Math.hypot(a.x-origin.x,a.y-origin.y)-Math.hypot(b.x-origin.x,b.y-origin.y))[0];assert.ok(target);row.target=target;
   const clear=act({type:'send',village:origin.id,target:target.id,kind:'attack',units:{lancer:30,ram:12}}).results[0];assert.ok(clear.ok&&'command' in clear.data);const command=clear.data.command;
   step(command.arrivalTick);const summaries=()=>sandbox<ReportsResponse>({op:'read',world:s.world.id,resource:'reports'}).reports;
   const victory=summaries().find(r=>r.commandId===command.id)!;row.clearing=privateRead<Report>(s,'/reports/'+victory.id);await save();
   assert.equal(row.clearing.outcome,'won');assert.equal(row.clearing.wall.after,0);
   step(command.arrivalTick+(command.arrivalTick-command.sentTick));
   const scoutTravel=Math.ceil(Math.hypot(target.x-origin.x,target.y-origin.y)*(rules.rules.UNITS as any).scout.speed);
   const cadence=(rules.rules.SCORING as any).publicSnapshotTicks;const arrival=Math.ceil((state.world.tick+scoutTravel)/cadence)*cadence;step(arrival-scoutTravel);
   const scouting=act({type:'send',village:origin.id,target:target.id,kind:'attack',units:{scout:2}}).results[0];assert.ok(scouting.ok&&'command' in scouting.data);const scout=scouting.data.command;step(scout.arrivalTick);
   const report=summaries().find(r=>r.commandId===scout.id)!;row.scouting=privateRead<Report>(s,'/reports/'+report.id);assert.ok(row.scouting.intel);assert.equal(row.scouting.intel.buildings.wall,0);
   const scope=JSON.stringify(['https://sandbox.invalid',state.player.id,s.world.id,state.world.epoch]);
   const linked={scope,villageId:origin.id,targetId:target.id,targetOwnerId:null,commandId:scout.id,sentTick:scout.sentTick,report};
   const settings={serverUrl:'https://sandbox.invalid',worldId:s.world.id,apiKey:'sandbox-adapter-no-credential'};
   let saved:SavedControl={settings,pending:null,automatic:false,decisions:[],scouting:[linked]};let now=0,lose=false;
   const charges:Record<string,any>[]=[];row.charges=charges;
   const storage={load:async()=>structuredClone(saved),save:async(v:SavedControl)=>{saved=structuredClone(v);}};
   const planning=()=>({...state,world:{...state.world,status:'running' as const}});
   const remote:Remote=async<T>(_s:unknown,path:string,body?:unknown):Promise<T>=>{
    if(path==='/me')return {account:{id:state.player.id},worlds:[],sandboxes:[]} as T;
    if(path==='/worlds')return [planning().world] as T;
    if(path.endsWith('/state')){state=s.state();return planning() as T;}
    if(path.endsWith('/rules'))return rules as T;
    if(path.endsWith('/history'))return {samples:[]} as T;
    if(path.endsWith('/map'))return privateRead<MapResponse>(s,'/map') as T;
    if(path.endsWith('/reports'))return {reports:summaries(),next:null} as T;
    if(path.includes('/reports/'))return privateRead<Report>(s,path.slice(path.indexOf('/reports/'))) as T;
    if(path.endsWith('/simulate/battle')){row.assessments??=[];row.assessments.push(body);return privateRead(s,'/simulate/battle',body) as T;}
    assert.ok(path.endsWith('/actions'));const action=(body as {actions:Action[]}).actions[0];assert.deepEqual(saved.pending!.action,action,'journal before write');
    const before=structuredClone(state);const response=sandbox<ActionsResponse>({op:'act',world:s.world.id,requestId:action.clientId,actions:[action]});assert.ok(response.results[0].ok,JSON.stringify(response.results));state=s.state();
    charges.push({action,results:response.results,spend:Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,(before.villages[0].resourcesMilli[r]-state.villages[0].resourcesMilli[r])/1000]))});
    if(lose)throw new RemoteError(0,5000,'Controlled successful private response loss');return response as T;
   };
   row.initial=structuredClone(state.villages[0]);row.initialTick=state.world.tick;row.clockStatus=state.world.status;row.planningWorldStatus='running';
   const raidTravel=Math.ceil(Math.hypot(target.x-origin.x,target.y-origin.y)*(rules.rules.UNITS as any).lancer.speed);
   if(policy==='candidate'){
    const c=await Controller.create(storage,settings,remote,()=>now);await c.cycle();row.snapshot=c.snapshot();row.selected=c.snapshot().selection.selected;await save();
    assert.equal(saved.scouting?.some(o=>o.clearing?.id===row.clearing.id),true,'Controller must retrieve real clearing evidence');
    assert.equal(row.selected?.action.type,'send');assert.equal(row.selected.action.units.lancer,30);
    await c.setAutomatic(true);await c.cycle();assert.equal(charges.length,1);assert.equal(saved.pending?.phase,'accepted');row.command=charges[0].results[0].data.command;
    await c.setAutomatic(false);step(row.command.arrivalTick);const restart=await Controller.create(storage,settings,remote,()=>now);await restart.cycle();assert.equal(restart.snapshot().automatic,false);assert.equal(saved.pending,null);assert.equal(charges.length,1);row.pausedRestartConfirmed=true;
    const battle=summaries().find(r=>r.commandId===row.command.id)!;row.battle=privateRead<Report>(s,'/reports/'+battle.id);assert.equal(row.battle.attackerUnits.lost.lancer??0,0);assert.ok(Object.values(row.battle.loot as Record<string,number>).reduce((a,b)=>a+b,0)>=60);
   }else{
    map=privateRead<MapResponse>(s,'/map');const ctx={state:planning(),rules};row.selected=selectProposal([...evaluateEconomy(ctx),...militaryAdvisor.evaluate(ctx),...evaluateScoutDispatch(ctx,{scope,map,observations:[linked]})]).selected;
    if(row.selected){const before=structuredClone(state);const response=act(row.selected.action);charges.push({action:row.selected.action,results:response.results,spend:Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,(before.villages[0].resourcesMilli[r]-state.villages[0].resourcesMilli[r])/1000]))});}
   }
   step(row.initialTick+2*raidTravel+1);row.comparisonTick=state.world.tick;row.final=structuredClone(state.villages[0]);await save();
   if(policy==='candidate'){
    row.returnedLoot=Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,(row.final.resourcesMilli[r]-row.initial.resourcesMilli[r]-(row.comparisonTick-row.initialTick)*row.initial.productionPerTickMilli[r])/1000]));assert.deepEqual(row.returnedLoot,row.battle.loot);assert.equal(row.final.units.home.lancer,row.initial.units.home.lancer);
    // Reset militia with a second ordinary clearing action after the policy cooldown.
    const second=target;
    step(row.initialTick+600);const r=act({type:'send',village:origin.id,target:second.id,kind:'attack',units:{lancer:30,ram:state.villages[0].units.home.ram??0}}).results[0];assert.ok(r.ok&&'command' in r.data);const clear2=r.data.command;step(clear2.arrivalTick);step(clear2.arrivalTick+clear2.arrivalTick-clear2.sentTick);
    const t=Math.ceil(Math.hypot(second.x-origin.x,second.y-origin.y)*(rules.rules.UNITS as any).scout.speed);const a=Math.ceil((state.world.tick+t)/cadence)*cadence;step(a-t);const r2=act({type:'send',village:origin.id,target:second.id,kind:'attack',units:{scout:2}}).results[0];assert.ok(r2.ok&&'command' in r2.data);const c2=r2.data.command;step(c2.arrivalTick);
    saved.scouting=[{scope,villageId:origin.id,targetId:second.id,targetOwnerId:null,commandId:c2.id,sentTick:c2.sentTick,report:summaries().find(r=>r.commandId===c2.id)!}];
    const recovery=await Controller.create(storage,settings,remote,()=>now);await recovery.cycle();row.recoverySelection=recovery.snapshot().selection.selected;await save();assert.equal(row.recoverySelection?.action.units.lancer,30);
    lose=true;await recovery.setAutomatic(true);await recovery.cycle();assert.equal(saved.pending?.phase,'uncertain');const count=charges.length;await recovery.setAutomatic(false);now+=10000;const after=await Controller.create(storage,settings,remote,()=>now);await after.cycle();assert.equal(charges.length,count);assert.equal(saved.pending,null);assert.equal(after.snapshot().automatic,false);row.lostResponseSuppressed=true;
   }
   row.passed=true;await save();console.log(JSON.stringify({policy,initialTick:row.initialTick,comparisonTick:row.comparisonTick,returnedLoot:row.returnedLoot,selected:row.selected?.action}));
  }finally{try{row.lastState=s.state();}finally{s.close();row.deleted=true;await save();}}
 }
 const a=rows[0],b=rows[1];assert.equal(a.initialTick,b.initialTick);assert.equal(a.comparisonTick,b.comparisonTick);for(const k of ['buildings','resourcesMilli','population','units'])assert.deepEqual(a.initial[k],b.initial[k]);await save(true);
}catch(error){await save(false,String(error));throw error;}
