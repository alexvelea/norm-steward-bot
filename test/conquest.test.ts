import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyConquest, conquestCaptureTick, conquestScope, evaluateRecall, type ConquestContext} from '../src/advisors/conquest.js';
import {selectProposal} from '../src/advisors/president.js';
import {allocateWithPresident} from '../src/bot/allocation/president.js';
import {economicAdvisor} from '../src/advisors/economic.js';
import type {AdvisorContext, Proposal} from '../src/advisors/types.js';
import {developedContext} from './control-fixtures.js';
import {Controller} from '../src/control/controller.js';
import {RemoteError, type Remote} from '../src/control/remote.js';
import type {SavedControl, Settings} from '../src/control/types.js';
import type {Action, Report} from '../src/shared/api.js';
import { conquestMission } from '../src/bot/strategy/missions/conquest.js';

function fixture(){
 const context:AdvisorContext=developedContext(),v=context.state.villages[0];
 Object.assign(v.buildings,{lumberyard:15,quarry:15,mine:15,hall:13,barracks:10,smithy:10,market:5,storehouse:5,court:1});
 v.population={max:10000,used:500};v.storage=100000;
 v.resources={timber:50000,stone:50000,iron:50000};v.resourcesMilli={timber:50000000,stone:50000000,iron:50000000};
 v.units.home={pikeman:153,raider:140,envoy:1};
 v.options.train=['raider','envoy'].map(unit=>({unit:unit as 'raider'|'envoy',cost:{timber:55,stone:35,iron:45},ticksEach:4,pop:1,maxCount:1000,ok:true,blockers:[],affordableAtTick:null}));
 const c:ConquestContext={plan:{scope:conquestScope('https://sandbox.invalid','p1',context),villageId:v.id,startedTick:100,status:'preparing',waves:0,targetId:'t',escort:140},
  map:{tick:100,snapshotTick:100,size:100,players:[],villages:[{id:'t',x:2,y:1,name:'Target',ownerId:null,ownerName:null,points:0}]},
  assessment:{tick:100,raiders:140,battle:{winner:'attacker',attackerSurvivors:{raider:114,envoy:1},attackerLost:{}} as any}};
 return {context,v,c};
}
test('conquest retains paid defence, requires fresh neutral ownership and a surviving Envoy',()=>{
 const {context,v,c}=fixture();
 let p=selectProposal(applyConquest(context,[],c)).selected;
 assert.equal(p?.action.type,'send');assert.equal(p?.importance,94);if(p?.action.type==='send')assert.deepEqual(p.action.units,{raider:140,envoy:1});
 c.map!.tick--;assert.equal(applyConquest(context,[],c).length,0);c.map!.tick++;
 c.map!.villages[0].ownerId='enemy';assert.equal(applyConquest(context,[],c).length,0);c.map!.villages[0].ownerId=null;
 c.assessment!.battle.attackerSurvivors.envoy=0;assert.equal(applyConquest(context,[],c).length,0);
 c.assessment!.battle.attackerSurvivors.envoy=1;v.units.home.pikeman=149;
 assert.equal(selectProposal(applyConquest(context,[],c)).selected,null);
});
test('conquest dispatches with 140 home Raiders during Pikeman training',()=>{
 const {context,v,c}=fixture();c.plan.waves=1;v.units.home.raider=140;c.assessment!.raiders=140;
 v.training.barracks=[{
  id:'queued-pikemen',unit:'pikeman',count:2,remaining:2,
  costEach:{timber:45,stone:35,iron:15},nextTick:101,endTick:109,
 }];
 const proposals=applyConquest(context,[],c);
 assert.ok(!proposals.some(p=>p.action.type==='train'));
 assert.equal(selectProposal(proposals).selected?.action.type,'send');
});
test('an impossible capture deadline, external orders and six waves prevent dispatch',()=>{
 const {context,v,c}=fixture();assert.equal(conquestCaptureTick(context,c),250);
 context.state.world.endsAtTick=309;assert.equal(selectProposal(applyConquest(context,[],c)).selected,null);
 context.state.world.endsAtTick=10800;c.plan.waves=6;assert.equal(selectProposal(applyConquest(context,[],c)).selected,null);c.plan.waves=0;
 v.orders.build=[{building:'wall',toLevel:2}];assert.equal(applyConquest(context,[],c).length,0);v.orders.build=[];

});
test('standing orders, scheduled actions and a non-running world preserve proposals unchanged',()=>{
 for(const block of [
  (x:ReturnType<typeof fixture>)=>{x.v.orders.build=[{building:'wall',toLevel:2}];},
  (x:ReturnType<typeof fixture>)=>{x.context.state.scheduled=[{} as any];},
  (x:ReturnType<typeof fixture>)=>{x.context.state.world.status='ended';},
 ]){
  const x=fixture(),proposals=[{id:'normal',task:'economy.storehouse',villageId:x.v.id,
   action:{type:'build',village:x.v.id,building:'storehouse'},importance:91} as Proposal];
  block(x);
  assert.strictEqual(applyConquest(x.context,proposals,x.c),proposals);
 }
});
test('conquest keeps only the more important proposal for a duplicate village build',()=>{
 const {context,v,c}=fixture();v.buildings.hall=12;
 const economyHall=economicAdvisor.evaluate(context).find(p=>p.villageId===v.id&&
  p.action.type==='build'&&p.action.building==='hall')!;
 economyHall.importance=95;
 let halls=applyConquest(context,[economyHall],c).filter(p=>p.villageId===v.id&&
  p.action.type==='build'&&p.action.building==='hall');
 assert.equal(halls.length,1);assert.equal(halls[0],economyHall);
 economyHall.importance=80;
 halls=applyConquest(context,[economyHall],c).filter(p=>p.villageId===v.id&&
  p.action.type==='build'&&p.action.building==='hall');
 assert.equal(halls.length,1);assert.equal(halls[0].advisor,'conquest');assert.equal(halls[0].importance,88);
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
test('conquest develops the producer with the least stock first',()=>{
 const {context,v,c}=fixture();
 for(const building of ['lumberyard','quarry','mine'] as const){
  v.buildings[building]=14;
  v.options.build.find(o=>o.building===building)!.level=15;
 }
 v.resources={timber:680,stone:19,iron:5556};
 const proposal=applyConquest(context,[],c).find(p=>p.advisor==='conquest');
 assert.equal(proposal?.action.type,'build');
 if(proposal?.action.type==='build')assert.equal(proposal.action.building,'quarry');
});
test('transition keeps normal proposals while conquest is preparing',()=>{
 const {context,c}=fixture();
 const routine={id:'new',task:'military.pikemen-baseline',villageId:'v1',action:{type:'train',village:'v1',unit:'pikeman',count:9}} as Proposal;
 const result=applyConquest(context,[routine],c);
 assert.ok(result.includes(routine));
 c.plan.status='captured';assert.deepEqual(applyConquest(context,[routine],c),[routine]);
});
test('conquest dispatch requires all 140 Raiders at home, not away',()=>{
 const {context,v,c}=fixture();
 v.units.home.raider=139;v.units.away.raider=1;
 assert.ok(!applyConquest(context,[],c).some(proposal=>proposal.action.type==='send'));
});
test('recall returns the capital-origin Raider stack after a city becomes economic',()=>{
 const context:AdvisorContext=developedContext(),capital=context.state.villages[0]!;
 const city=structuredClone(capital);city.id='captured';city.name='Captured';city.supportHere=[{
  home:{id:capital.id,name:capital.name},units:{raider:83,pikeman:250},
 }] as typeof city.supportHere;
 context.state.villages.push(city);
 context.cityRoles=new Map([
  [capital.id,{role:'capital',reason:'fixture'}],
  [city.id,{role:'economic',reason:'captured'}],
 ]);
 const recall=evaluateRecall(context)[0];
 assert.equal(recall?.task,'expansion.recall');
 assert.deepEqual(recall?.action,{type:'recall',village:city.id,home:capital.id,units:{raider:83}});
 assert.equal(recall?.importance,93);
});
test('first conquest Raider and Envoy proposals keep their existing importance',()=>{
 const {context,v,c}=fixture();v.units.home.raider=0;v.units.home.envoy=0;
 const proposals=applyConquest(context,[],c);
 const raider=proposals.find(p=>p.action.type==='train'&&p.action.unit==='raider');
 const envoy=proposals.find(p=>p.action.type==='train'&&p.action.unit==='envoy');
 assert.equal(raider?.importance,90);assert.equal(envoy?.importance,90);
});

/** Exercise the production Controller, including its second state read and durable journal. */
async function executor(mode: 'ok'|'lost'|'unapplied'|'reject' = 'ok') {
 const x=fixture(),writes:Action[]=[],reads:string[]=[];
 let now=0,first=true,stateReads=0,preflight: (()=>void)|undefined;
 const settings:Settings={serverUrl:'https://sandbox.invalid',worldId:x.context.state.world.id,apiKey:'test'};
 let saved:SavedControl={settings,pending:null,decisions:[],missions:[conquestMission(structuredClone(x.c.plan))]};
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
 assert.equal(x.writes.length,1);assert.equal(x.saved().missions?.[0]?.memory.waves,1);
 assert.equal(x.saved().pending?.missionId,x.saved().missions?.[0]?.id);
 await x.controller.setAutomatic(false);x.report(true);
 x.context.state.villages.push({...structuredClone(x.v),id:'t'});x.context.state.world.status='ended';
 const restarted=await x.create();await restarted.cycle();
 assert.equal(restarted.snapshot().error,null);assert.equal(restarted.snapshot().automatic,false);
 assert.equal(x.saved().missions?.[0]?.status,'completed');assert.equal(x.saved().missions?.[0]?.memory.capturedTick,110);
 assert.equal(x.saved().pending,null);assert.equal(x.saved().active?.length,0);assert.equal(x.writes.length,1);
 assert.equal(x.saved().missions?.[0]?.memory.lastBattle?.conquered,true);
 assert.ok(restarted.snapshot().decisions.some(d=>d.kind==='confirmed'&&d.text.includes('Conquest battle')));
});

test('uncertain conquest sends suppress applied replays and retry unapplied writes with the same ID',async()=>{
 const lost=await executor('lost');await lost.controller.cycle();lost.advance();
 await lost.controller.setAutomatic(false);const restarted=await lost.create();await restarted.cycle();
 assert.equal(lost.writes.length,1);assert.equal(lost.saved().pending,null);
 assert.equal(lost.saved().missions?.[0]?.status,'failed');assert.equal(restarted.snapshot().automatic,false);
 const retry=await executor('unapplied');await retry.controller.cycle();retry.advance();
 const next=await retry.create();await next.cycle();
 assert.equal(retry.writes.length,2);assert.deepEqual(retry.writes[0],retry.writes[1]);
 assert.equal(retry.saved().pending?.phase,'accepted');assert.equal(retry.saved().missions?.[0]?.memory.waves,1);
});

test('conquest expiry pauses execution, and a changed epoch never replays the old action',async()=>{
 const x=await executor('unapplied');await x.controller.cycle();
 x.context.state.world.tick=x.saved().pending!.expiresTick;x.advance();await x.controller.cycle();
 assert.equal(x.controller.snapshot().automatic,false);assert.equal(x.writes.length,1);
 x.context.state.world.epoch='next';x.advance();await x.controller.cycle();
 assert.equal(x.saved().pending,null);assert.equal(x.writes.length,1);
});

test('fresh ownership, home defence and external orders prevent conquest writes',async()=>{
 for(const mutate of [
  (x:Awaited<ReturnType<typeof executor>>)=>{x.c.map!.villages[0].ownerId='enemy';},
  (x:Awaited<ReturnType<typeof executor>>)=>{x.v.units.home.pikeman=149;},
  (x:Awaited<ReturnType<typeof executor>>)=>{x.v.orders.build=[{building:'wall',toLevel:2}];},
  (x:Awaited<ReturnType<typeof executor>>)=>{x.context.state.scheduled=[{} as any];},
 ]){
  const x=await executor();x.preflight(()=>mutate(x));await x.controller.cycle();
  assert.equal(x.controller.snapshot().error,null);assert.ok(!x.writes.some(a=>a.type==='send'),String(mutate));
 }
});

test('individual conquest rejection remains visible and does not count as an accepted wave',async()=>{
 const x=await executor('reject');await x.controller.cycle();
 assert.equal(x.writes.length,1);assert.equal(x.saved().pending,null);assert.equal(x.saved().missions?.[0]?.memory.waves,0);
 assert.ok(x.controller.snapshot().decisions.some(d=>d.kind==='rejected'&&d.text.includes('TARGET_PROTECTED')));
});

test('a failed battle or missing accepted command stops conquest without replacement troops',async()=>{
 for(const report of [false,true]){
  const x=await executor();await x.controller.cycle();await x.controller.setAutomatic(false);
  if(report){x.report().attackerUnits!.lost.envoy=1;}else{x.context.state.commands.outgoing=[];}
  const restarted=await x.create();await restarted.cycle();
  assert.equal(x.saved().missions?.[0]?.status,'failed');assert.equal(x.saved().pending,null);assert.equal(x.writes.length,1);
 }
});

test('authoritative capture survives a missing report or a lost final send response',async()=>{
 for(const mode of ['ok','lost'] as const){
  const x=await executor(mode);await x.controller.cycle();await x.controller.setAutomatic(false);x.advance();
  x.context.state.world.tick=110;x.context.state.world.status='ended';x.context.state.commands.outgoing=[];
  x.context.state.villages.push({...structuredClone(x.v),id:'t'});
  const restarted=await x.create();await restarted.cycle();
  assert.equal(restarted.snapshot().error,null);assert.equal(x.saved().missions?.[0]?.status,'completed');
  assert.equal(x.saved().pending,null);assert.equal(x.writes.length,1);assert.equal(restarted.snapshot().automatic,false);
  if(mode==='lost')assert.ok(restarted.snapshot().decisions.some(d=>d.kind==='uncertain'&&d.text.includes('final request attribution remains unknown')));
 }
});

test('incoming attacks leave affordable Hall construction eligible',()=>{
 const {context,v,c}=fixture();v.buildings.hall=11;
 const o=v.options.build.find(o=>o.building==='hall')!;o.level=12;o.ok=true;o.blockers=[];o.cost={timber:100,stone:100,iron:100};
 context.state.commands.incoming=[{kind:'attack',to:{id:v.id}} as any];
 const selected=selectProposal(applyConquest(context,[],c)).selected;
 assert.equal(selected?.action.type,'build');if(selected?.action.type==='build')assert.equal(selected.action.building,'hall');
 assert.ok(!applyConquest(context,[],c).some(p=>p.action.type==='send'));
});

test('incoming attacks do not hold a ready Raider and Envoy expedition at home',async()=>{
 const x=await executor();
 x.preflight(()=>{x.context.state.commands.incoming=[{kind:'attack',to:{id:x.v.id}} as any];});
 await x.controller.cycle();
 assert.equal(x.writes.length,1);assert.equal(x.writes[0].type,'send');
 if(x.writes[0].type==='send')assert.deepEqual(x.writes[0].units,{raider:140,envoy:1});
 assert.equal(x.v.units.home.pikeman,153);
});

test('incoming attacks do not prevent entering the conquest phase at 150 home Pikemen',async()=>{
 const x=await executor();x.saved().missions=[];
 x.context.state.commands.incoming=[{kind:'attack',to:{id:x.v.id}} as any];
 const c=await x.create();await c.setAutomatic(false);await c.cycle();
 assert.equal(x.saved().missions?.[0]?.status,'active');assert.equal(x.writes.length,0);
});

test('repeated cycles retain one first-conquest mission instance',async()=>{
 const x=await executor();x.saved().missions=[];
 const c=await x.create();await c.setAutomatic(false);await c.cycle();await c.cycle();
 assert.equal(x.saved().missions?.filter(mission=>mission.definition==='firstConquest').length,1);
 assert.equal(x.saved().missions?.[0]?.sequence,1);
});

test('recurring conquest tops up the surviving escort before dispatch',()=>{
 const {context,v,c}=fixture();
 c.plan.sequence=2;c.plan.escort=140;
 v.units.home.raider=110;v.units.home.envoy=0;
 v.options.train.find(option=>option.unit==='raider')!.ticksEach=2;
 let proposals=applyConquest(context,[],c);
 const escort=proposals.find(p=>p.action.type==='train'&&p.action.unit==='raider');
 assert.equal(escort?.task,'expansion.escort');
 if(escort?.action.type==='train')assert.equal(escort.action.count,30);
 else assert.fail('Missing Raider escort top-up');
 assert.ok(proposals.some(p=>p.task==='expansion.envoy'&&p.action.type==='train'&&p.action.unit==='envoy'));
 assert.ok(!proposals.some(p=>p.action.type==='send'));
 v.units.home.raider=140;v.units.home.envoy=1;
 c.assessment={tick:context.state.world.tick,raiders:140,battle:{winner:'attacker',attackerSurvivors:{raider:114,envoy:1},attackerLost:{}} as any};
 proposals=applyConquest(context,[],c);
 const dispatch=proposals.find(p=>p.action.type==='send');
 assert.equal(dispatch?.task,'expansion.dispatch');assert.equal(dispatch?.importance,94);
 assert.ok(!proposals.some(p=>p.action.type==='train'&&p.action.unit==='raider'));
 c.plan.waves=1;v.units.home.raider=110;c.assessment.raiders=110;
 const nextWave=applyConquest(context,[],c);
 assert.ok(nextWave.some(p=>p.action.type==='train'&&p.action.unit==='raider'));
 assert.ok(!nextWave.some(p=>p.action.type==='send'));
});

test('recurring conquest starts only after every capital and economic-city gate is met',async()=>{
 for(const block of ['hall','court','pikemen','orders','active'] as const){
  const x=await executor();
  const previous=structuredClone(x.c.plan);previous.status='captured';
  x.saved().missions=[conquestMission(previous)];
  const economic=structuredClone(x.v);economic.id='economic';economic.name='Economic';economic.buildings.hall=10;
  x.context.state.villages.push(economic);x.context.state.world.villages=2;
  if(block==='hall')economic.buildings.hall=9;
  if(block==='court')x.v.buildings.court=0;
  if(block==='pikemen')x.v.units.home.pikeman=149;
  if(block==='orders')x.v.orders.build=[{building:'wall',toLevel:2}];
  if(block==='active'){previous.status='preparing';x.saved().missions=[conquestMission(previous)];}
  const controller=await x.create();await controller.setAutomatic(false);await controller.cycle();
  assert.equal(x.saved().missions?.length,1,`gate ${block}`);
 }
});

test('a completed first conquest starts a sequenced recurring mission with a new identity',async()=>{
 const x=await executor();
 const previous=structuredClone(x.c.plan);previous.status='captured';
 x.saved().missions=[conquestMission(previous)];
 const economic=structuredClone(x.v);economic.id='economic';economic.name='Economic';economic.buildings.hall=10;
 x.context.state.villages.push(economic);x.context.state.world.villages=2;
 const controller=await x.create();await controller.setAutomatic(false);await controller.cycle();
 const recurring=x.saved().missions?.find(mission=>mission.definition==='conquest');
 assert.ok(recurring);
 assert.equal(recurring.sequence,2);
 assert.equal(recurring.id,`${recurring.scope}:conquest:${x.v.id}:${x.context.state.world.tick}`);
 assert.ok(controller.snapshot().proposals.some(proposal=>proposal.task==='expansion.dispatch'));
 assert.ok(!controller.snapshot().proposals.some(proposal=>
  proposal.action.type==='train'&&proposal.action.unit==='raider'
 ));
});

test('a recurring mission leaves capital economy selectable while waiting for its home escort',async()=>{
 const x=await executor();
 x.c.plan.sequence=2;x.c.plan.escort=200;
 x.v.units.home.raider=100;x.c.assessment!.raiders=100;
 x.saved().missions=[conquestMission(structuredClone(x.c.plan))];
 const controller=await x.create();await controller.setAutomatic(false);await controller.cycle();
 const view=controller.snapshot();
 const economy=view.proposals.filter(proposal=>
  proposal.villageId===x.v.id&&proposal.advisor==='economic'&&proposal.status==='ready');
 assert.ok(economy.length>0);
 assert.ok(allocateWithPresident(economy).selection.selected);
 assert.equal(view.planning.reservations.some(reservation=>reservation.kind==='exclusiveSpending'),false);
 assert.equal(x.writes.length,0);
});
test('a preparing first conquest keeps an overflowing capital Storehouse selectable',async()=>{
 const x=await executor();
 x.v.resourcesMilli.timber=x.v.storage*1000;
 const controller=await x.create();await controller.setAutomatic(false);await controller.cycle();
 const view=controller.snapshot();
 const economy=view.proposals.filter(proposal=>
  proposal.villageId===x.v.id&&proposal.advisor==='economic'&&proposal.status==='ready');
 const storehouse=economy.find(proposal=>
  proposal.action.type==='build'&&proposal.action.building==='storehouse');
 assert.ok(storehouse);
 assert.equal(allocateWithPresident(economy).selection.selected?.id,storehouse.id);
 assert.equal(view.planning.reservations.some(reservation=>reservation.kind==='exclusiveSpending'),false);
 assert.equal(x.writes.length,0);
});

test('Raider escort is funded in minute batches, letting affordable Smithy work proceed while training',()=>{
 const {context,v,c}=fixture();v.units.home.raider=0;v.units.home.envoy=0;v.buildings.smithy=5;v.buildings.court=0;
 v.resourcesMilli={timber:2000000,stone:2000000,iron:2000000};
 const o=v.options.build.find(o=>o.building==='smithy')!;o.level=6;o.ok=true;o.blockers=[];o.cost={timber:699,stone:572,iron:762};
 let proposals=applyConquest(context,[],c);let selected=selectProposal(proposals).selected;
 assert.equal(selected?.action.type,'train');if(selected?.action.type==='train')assert.equal(selected.action.count,16);
 v.training.barracks=[{id:'raiders',unit:'raider',count:16,remaining:16,costEach:{timber:55,stone:35,iron:45},nextTick:104,endTick:164}];
 v.resourcesMilli={timber:1120000,stone:1440000,iron:1280000};
 proposals=applyConquest(context,[],c);selected=selectProposal(proposals).selected;
 assert.equal(selected?.action.type,'build');if(selected?.action.type==='build')assert.equal(selected.action.building,'smithy');
 v.training.barracks=[];v.units.home.raider=132;
 const last=applyConquest(context,[],c).find(p=>p.action.type==='train'&&p.action.unit==='raider');if(last?.action.type==='train')assert.equal(last.action.count,8);else assert.fail('Missing final bounded batch');
});
