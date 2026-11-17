import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyConquest, conquestCaptureTick, conquestScope, type ConquestContext} from '../src/advisors/conquest.js';
import {selectProposal} from '../src/advisors/president.js';
import type {AdvisorContext, Proposal} from '../src/advisors/types.js';
import {developedContext} from './control-fixtures.js';
import {Controller} from '../src/control/controller.js';
import {RemoteError, type Remote} from '../src/control/remote.js';
import type {SavedControl, Settings} from '../src/control/types.js';
import type {Action, Report} from '../src/shared/api.js';

function fixture(){
 const context:AdvisorContext=developedContext(),v=context.state.villages[0];
 Object.assign(v.buildings,{lumberyard:15,quarry:15,mine:15,hall:13,barracks:10,smithy:10,market:5,storehouse:5,court:1});
 v.population={max:10000,used:500};v.storage=100000;
 v.resources={timber:50000,stone:50000,iron:50000};v.resourcesMilli={timber:50000000,stone:50000000,iron:50000000};
 v.units.home={pikeman:153,shieldman:51,raider:140,envoy:1};
 v.options.train=['raider','envoy'].map(unit=>({unit:unit as 'raider'|'envoy',cost:{timber:55,stone:35,iron:45},ticksEach:4,pop:1,maxCount:1000,ok:true,blockers:[],affordableAtTick:null}));
 const c:ConquestContext={plan:{scope:conquestScope('https://sandbox.invalid','p1',context),villageId:v.id,startedTick:100,status:'preparing',waves:0,targetId:'t',escort:140},
  map:{tick:100,snapshotTick:100,size:100,players:[],villages:[{id:'t',x:2,y:1,name:'Target',ownerId:null,ownerName:null,points:0}]},
  assessment:{tick:100,raiders:140,battle:{winner:'attacker',attackerSurvivors:{raider:114,envoy:1},attackerLost:{}} as any}};
 return {context,v,c};
}
test('conquest retains paid defence, requires fresh neutral ownership and a surviving Envoy',()=>{
 const {context,v,c}=fixture();
 let p=selectProposal(applyConquest(context,[],c)).selected;
 assert.equal(p?.action.type,'send');if(p?.action.type==='send')assert.deepEqual(p.action.units,{raider:140,envoy:1});
 c.map!.tick--;assert.equal(applyConquest(context,[],c).length,0);c.map!.tick++;
 c.map!.villages[0].ownerId='enemy';assert.equal(applyConquest(context,[],c).length,0);c.map!.villages[0].ownerId=null;
 c.assessment!.battle.attackerSurvivors.envoy=0;assert.equal(applyConquest(context,[],c).length,0);
 c.assessment!.battle.attackerSurvivors.envoy=1;v.units.home.pikeman=149;
 assert.equal(selectProposal(applyConquest(context,[],c)).selected,null);
});
test('conquest reuses surviving escort without buying replacements after the first wave',()=>{
 const {context,v,c}=fixture();c.plan.waves=1;v.units.home.raider=114;c.assessment!.raiders=114;
 const proposals=applyConquest(context,[],c);
 assert.ok(!proposals.some(p=>p.action.type==='train'));
 assert.equal(selectProposal(proposals).selected?.action.type,'send');
});
test('an impossible capture deadline, external orders, incoming attacks and six waves prevent dispatch',()=>{
 const {context,v,c}=fixture();assert.equal(conquestCaptureTick(context,c),250);
 context.state.world.endsAtTick=309;assert.equal(selectProposal(applyConquest(context,[],c)).selected,null);
 context.state.world.endsAtTick=10800;c.plan.waves=6;assert.equal(selectProposal(applyConquest(context,[],c)).selected,null);c.plan.waves=0;
 v.orders.build=[{building:'wall',toLevel:2}];assert.equal(applyConquest(context,[],c).length,0);v.orders.build=[];
 context.state.commands.incoming=[{kind:'attack',to:{id:v.id}} as any];assert.equal(applyConquest(context,[],c).length,0);
});
test('transition funds producer 15 before the Court path and saves through the President',()=>{
 const {context,v,c}=fixture();v.buildings.mine=14;
 const o=v.options.build.find(o=>o.building==='mine')!;o.level=15;o.cost={timber:500,stone:500,iron:500};o.ok=false;o.blockers=['INSUFFICIENT_RESOURCES'];
 v.resourcesMilli={timber:0,stone:0,iron:0};
 const proposals=applyConquest(context,[],c),selection=selectProposal(proposals);
 assert.equal(selection.selected,null);assert.equal(selection.reservations.length,1);
 assert.equal(proposals[0].action.type,'build');if(proposals[0].action.type==='build')assert.equal(proposals[0].action.building,'mine');
 assert.ok(!proposals.some(p=>p.action.type==='train'));
});
test('transition keeps an already-paid cohort complement, suppressing discretionary origin spending',()=>{
 const {context,c}=fixture();
 const paid={id:'paid',villageId:'v1',action:{type:'train',village:'v1',unit:'shieldman',count:3},defenseBatch:{pikemen:9,shieldmen:3}} as Proposal;
 const routine={...paid,id:'new',action:{type:'train',village:'v1',unit:'pikeman',count:9}} as Proposal;
 context.activeProposals=[paid];
 const result=applyConquest(context,[paid,routine],c);
 assert.ok(result.includes(paid));assert.ok(!result.includes(routine));
 c.plan.status='captured';assert.deepEqual(applyConquest(context,[routine],c),[routine]);
});

/** Exercise the production Controller, including its second state read and durable journal. */
async function executor(mode: 'ok'|'lost'|'unapplied'|'reject' = 'ok') {
 const x=fixture(),writes:Action[]=[],reads:string[]=[];
 let now=0,first=true,stateReads=0,preflight: (()=>void)|undefined;
 const settings:Settings={serverUrl:'https://sandbox.invalid',worldId:x.context.state.world.id,apiKey:'test'};
 let saved:SavedControl={settings,pending:null,decisions:[],conquest:structuredClone(x.c.plan)};
 const reports:Report[]=[];
 const storage={load:async()=>structuredClone(saved),save:async(s:SavedControl)=>{saved=structuredClone(s);}};
 const remote:Remote=async <T>(_s:Settings,path:string,body?:unknown):Promise<T>=>{
  reads.push(path);
  if(path==='/me')return {account:{id:x.context.state.player.id},worlds:[],sandboxes:[]} as T;
  if(path==='/worlds')return [x.context.state.world] as T;
  if(path.endsWith('/state')){if(++stateReads===2)preflight?.();return structuredClone(x.context.state) as T;}
  if(path.endsWith('/rules'))return x.context.rules as T;
  if(path.endsWith('/history'))return {samples:[]} as T;
  if(path.endsWith('/map'))return {...x.c.map,tick:x.context.state.world.tick,snapshotTick:x.context.state.world.tick} as T;
  if(path.endsWith('/reports'))return {reports,next:null} as T;
  if(path.includes('/reports/'))return structuredClone(reports.find(r=>path.endsWith('/'+r.id))) as T;
  if(path.endsWith('/simulate/battle'))return x.c.assessment!.battle as T;
  assert.ok(path.endsWith('/actions'),path);
  const action=(body as {actions:Action[]}).actions[0];
  assert.deepEqual(saved.pending?.action,action,'exact request is persisted before POST');
  assert.ok(['prepared','uncertain'].includes(saved.pending!.phase));
  writes.push(structuredClone(action));
  if(mode==='reject')return {tick:100,results:[{ok:false,type:'send',error:{code:'TARGET_PROTECTED',message:'Changed target'}}]} as T;
  if(mode==='unapplied'&&first){first=false;throw new RemoteError(429,5000,'backoff');}
  assert.equal(action.type,'send');if(action.type!=='send')throw new Error('Expected conquest send');
  const command={id:'command',kind:'attack' as const,from:{id:x.v.id},to:{id:'t'},units:action.units,sentTick:100,arrivalTick:110};
  x.context.state.commands.outgoing=[command as any];x.v.units.home.raider=0;x.v.units.home.envoy=0;
  if(mode==='lost')throw new RemoteError(0,5000,'lost successful response');
  return {tick:100,results:[{ok:true,type:'send',data:{command}}]} as T;
 };
 const create=()=>Controller.create(storage,settings,remote,()=>now);
 return {...x,writes,reads,reports,create,controller:await create(),saved:()=>saved,
  advance:()=>{now+=10000;},preflight:(f:()=>void)=>{preflight=f;},
  report:(conquered=false)=>{
   const r={id:'battle',commandId:'command',tick:110,kind:'battle',role:'attacker',
    attacker:{id:x.v.id,ownerId:x.context.state.player.id},defender:{id:'t',ownerId:null},
    outcome:'won',conquered,attackerUnits:{sent:{raider:140,envoy:1},lost:conquered?{raider:2,envoy:1}:{}},
    loyalty:{before:34,after:conquered?0:1}} as Report;
   reports.push(r);x.context.state.world.tick=110;x.context.state.commands.outgoing=[];
   return r;
  }};
}

test('conquest journals its send and reconciles terminal capture across a paused restart',async()=>{
 const x=await executor();await x.controller.cycle();
 assert.equal(x.writes.length,1);assert.equal(x.saved().conquest?.waves,1);
 assert.equal(x.saved().pending?.conquest,true);
 await x.controller.setAutomatic(false);x.report(true);
 x.context.state.villages.push({...structuredClone(x.v),id:'t'});x.context.state.world.status='ended';
 const restarted=await x.create();await restarted.cycle();
 assert.equal(restarted.snapshot().error,null);assert.equal(restarted.snapshot().automatic,false);
 assert.equal(x.saved().conquest?.status,'captured');assert.equal(x.saved().conquest?.capturedTick,110);
 assert.equal(x.saved().pending,null);assert.equal(x.saved().active?.length,0);assert.equal(x.writes.length,1);
 assert.equal(x.saved().conquest?.lastBattle?.conquered,true);
 assert.ok(restarted.snapshot().decisions.some(d=>d.kind==='confirmed'&&d.text.includes('Conquest battle')));
});

test('uncertain conquest sends suppress applied replays and retry unapplied writes with the same ID',async()=>{
 const lost=await executor('lost');await lost.controller.cycle();lost.advance();
 await lost.controller.setAutomatic(false);const restarted=await lost.create();await restarted.cycle();
 assert.equal(lost.writes.length,1);assert.equal(lost.saved().pending,null);
 assert.equal(lost.saved().conquest?.status,'stopped');assert.equal(restarted.snapshot().automatic,false);
 const retry=await executor('unapplied');await retry.controller.cycle();retry.advance();
 const next=await retry.create();await next.cycle();
 assert.equal(retry.writes.length,2);assert.deepEqual(retry.writes[0],retry.writes[1]);
 assert.equal(retry.saved().pending?.phase,'accepted');assert.equal(retry.saved().conquest?.waves,1);
});

test('conquest expiry pauses execution, and a changed epoch never replays the old action',async()=>{
 const x=await executor('unapplied');await x.controller.cycle();
 x.context.state.world.tick=x.saved().pending!.expiresTick;x.advance();await x.controller.cycle();
 assert.equal(x.controller.snapshot().automatic,false);assert.equal(x.writes.length,1);
 x.context.state.world.epoch='next';x.advance();await x.controller.cycle();
 assert.equal(x.saved().pending,null);assert.equal(x.writes.length,1);
});

test('fresh ownership, home defence, incoming attacks and external orders prevent conquest writes',async()=>{
 for(const mutate of [
  (x:Awaited<ReturnType<typeof executor>>)=>{x.c.map!.villages[0].ownerId='enemy';},
  (x:Awaited<ReturnType<typeof executor>>)=>{x.v.units.home.pikeman=149;},
  (x:Awaited<ReturnType<typeof executor>>)=>{x.v.orders.build=[{building:'wall',toLevel:2}];},
  (x:Awaited<ReturnType<typeof executor>>)=>{x.context.state.commands.incoming=[{kind:'attack',to:{id:x.v.id}} as any];},
  (x:Awaited<ReturnType<typeof executor>>)=>{x.context.state.scheduled=[{} as any];},
 ]){
  const x=await executor();x.preflight(()=>mutate(x));await x.controller.cycle();
  assert.equal(x.controller.snapshot().error,null);assert.ok(!x.writes.some(a=>a.type==='send'),String(mutate));
 }
});

test('individual conquest rejection remains visible and does not count as an accepted wave',async()=>{
 const x=await executor('reject');await x.controller.cycle();
 assert.equal(x.writes.length,1);assert.equal(x.saved().pending,null);assert.equal(x.saved().conquest?.waves,0);
 assert.ok(x.controller.snapshot().decisions.some(d=>d.kind==='rejected'&&d.text.includes('TARGET_PROTECTED')));
});

test('a failed battle or missing accepted command stops conquest without replacement troops',async()=>{
 for(const report of [false,true]){
  const x=await executor();await x.controller.cycle();await x.controller.setAutomatic(false);
  if(report){x.report().attackerUnits!.lost.envoy=1;}else{x.context.state.commands.outgoing=[];}
  const restarted=await x.create();await restarted.cycle();
  assert.equal(x.saved().conquest?.status,'stopped');assert.equal(x.saved().pending,null);assert.equal(x.writes.length,1);
 }
});

test('authoritative capture survives a missing report or a lost final send response',async()=>{
 for(const mode of ['ok','lost'] as const){
  const x=await executor(mode);await x.controller.cycle();await x.controller.setAutomatic(false);x.advance();
  x.context.state.world.tick=110;x.context.state.world.status='ended';x.context.state.commands.outgoing=[];
  x.context.state.villages.push({...structuredClone(x.v),id:'t'});
  const restarted=await x.create();await restarted.cycle();
  assert.equal(restarted.snapshot().error,null);assert.equal(x.saved().conquest?.status,'captured');
  assert.equal(x.saved().pending,null);assert.equal(x.writes.length,1);assert.equal(restarted.snapshot().automatic,false);
 }
});
