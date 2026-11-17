import {test} from 'node:test';
import assert from 'node:assert/strict';
import {developedContext} from './control-fixtures.js';
import {evaluateEconomy} from '../src/advisors/economic.js';
import {prioritizeFarmRunway} from '../src/advisors/farm-runway.js';
import {selectProposal} from '../src/advisors/president.js';
import {Controller} from '../src/control/controller.js';
import type {Remote} from '../src/control/remote.js';
import type {SavedControl, Settings} from '../src/control/types.js';
import type {Action, BuildQueueItem} from '../src/shared/api.js';

function fixture(){
 const c=developedContext(),v=c.state.villages[0];
 v.buildings.barracks=3;v.buildings.smithy=1;v.hidden=1000;
 v.population={used:125,max:200};v.resources={timber:1000,stone:1000,iron:1000};
 v.options.train=[{unit:'pikeman',cost:{timber:45,stone:35,iron:15},pop:1,ticksEach:6,maxCount:100,ok:true,blockers:[],affordableAtTick:null},
 {unit:'shieldman',cost:{timber:35,stone:30,iron:65},pop:1,ticksEach:9,maxCount:100,ok:true,blockers:[],affordableAtTick:null}];
 v.options.build.find(o=>o.building==='farm')!.ticks=50;
 for(const o of v.options.build.filter(o=>['lumberyard','quarry','mine'].includes(o.building)))o.ticks=200;
 v.training.barracks=[{id:'paid',unit:'shieldman',count:3,remaining:3,costEach:{timber:35,stone:30,iron:65},nextTick:109,endTick:127}];
 return c;
}
test('Farm precedes a long build when paid training masks a future population gap',()=>{
 const c=fixture(),proposals=evaluateEconomy(c);
 assert.equal(proposals.find(p=>p.action.building==='farm')!.status,'not-needed');
 assert.notEqual(selectProposal(proposals).selected?.action.building,'farm');
 prioritizeFarmRunway(c,proposals);
 assert.equal(selectProposal(proposals).selected?.action.building,'farm');
 assert.match(proposals.find(p=>p.action.building==='farm')!.reason,/Recruitment runway/);
});
test('sufficient runway and unsustainable income retain the ordinary allocation',()=>{
 for(const enough of [true,false]){
  const c=fixture(),v=c.state.villages[0];
  if(enough)v.population.used=30;else v.productionPerTickMilli.timber=1;
  const proposals=evaluateEconomy(c),before=structuredClone(proposals);
  prioritizeFarmRunway(c,proposals);assert.deepEqual(proposals,before);
 }
});
test('runway does not bypass the whole-cohort deadline or external orders',()=>{
 for(const kind of ['deadline','orders','busy','blocked'] as const){
  const c=fixture(),v=c.state.villages[0];
  if(kind==='deadline')c.state.world.endsAtTick=250; // Farm 50 + cohort 81 + useful life 60 cannot fit.
  if(kind==='orders')v.orders.build=[{building:'quarry',toLevel:12}];
  if(kind==='busy')v.buildQueue=[{id:'paid-build',building:'mine',level:11,cost:{timber:0,stone:0,iron:0},startTick:90,endTick:200}];
  const proposals=evaluateEconomy(c);
  if(kind==='blocked')proposals.find(p=>p.action.building==='farm')!.blockers.push('PREREQUISITE');
  const before=structuredClone(proposals);prioritizeFarmRunway(c,proposals);assert.deepEqual(proposals,before);
 }
});

/** Exercise the actual allocator and durable executor; the server comparison tests outcomes. */
async function executorFixture() {
 const c=fixture(),settings:Settings={serverUrl:'https://game.test',worldId:'test',apiKey:'synthetic-test-key'};
 let saved:SavedControl={settings,pending:null,active:[],automatic:false,decisions:[]};
 const writes:Extract<Action,{type:'build'}>[]=[];
 let stateReads=0,changeOnRead:(read:number)=>void=()=>{},reject=false;
 const storage={load:async()=>structuredClone(saved),save:async(value:SavedControl)=>{saved=structuredClone(value);}};
 const request:Remote=async<T>(_settings:Settings,path:string,body?:unknown)=>{
  if(path==='/me')return {account:{id:c.state.player.id},worlds:[],sandboxes:[]} as T;
  if(path==='/worlds')return [c.state.world] as T;
  if(path.endsWith('/history'))return {samples:[]} as T;
  if(path.endsWith('/rules'))return structuredClone(c.rules) as T;
  if(path.endsWith('/state')){changeOnRead(++stateReads);return structuredClone(c.state) as T;}
  assert.ok(path.endsWith('/actions'),path);
  const action=(body as {actions:Action[]}).actions[0];
  assert.deepEqual(saved.pending?.action,action,'persist exact request before POST');
  assert.equal(saved.pending?.phase,'prepared');
  assert.ok(action.clientId);
  assert.equal(action.type,'build');
  if(action.type!=='build')throw new Error('Expected construction');
  writes.push(action);
  if(reject)return {tick:c.state.world.tick,results:[{ok:false,type:'build',error:{code:'QUEUE_FULL',message:'Manual construction won the race'}}]} as T;
  const v=c.state.villages[0],option=v.options.build.find(o=>o.building===action.building)!;
  const item:BuildQueueItem={id:'accepted-farm',building:action.building,level:option.level,cost:option.cost,startTick:c.state.world.tick,endTick:c.state.world.tick+option.ticks};
  v.buildQueue.push(item);
  return {tick:c.state.world.tick,results:[{ok:true,type:'build',clientId:action.clientId,data:{item}}],state:structuredClone(c.state)} as T;
 };
 const create=()=>Controller.create(storage,settings,request,()=>0);
 const controller=await create();
 return {c,controller,create,writes,get saved(){return saved;},get reads(){return stateReads;},onRead:(change:typeof changeOnRead)=>{changeOnRead=change;},rejectNext:()=>{reject=true;}};
}

test('Farm runway is journalled by the single executor and a paused restart only reconciles accepted work',async()=>{
 const x=await executorFixture();
 await x.controller.cycle();
 assert.deepEqual(x.controller.snapshot().selection.selected?.action,{type:'build',village:'v1',building:'farm'});
 const paused=await x.create();await paused.cycle();
 assert.equal(paused.snapshot().automatic,false);assert.equal(x.writes.length,0);
 await paused.setAutomatic(true);await paused.cycle();
 assert.equal(x.writes.length,1);assert.equal(x.writes[0].building,'farm');
 assert.match(x.saved.pending!.proposal.reason,/Recruitment runway/);
 assert.equal(x.saved.pending!.phase,'accepted');
 await paused.setAutomatic(false);
 const restarted=await x.create();await restarted.cycle();
 assert.equal(restarted.snapshot().automatic,false);assert.equal(x.writes.length,1);
 const v=x.c.state.villages[0],accepted=v.buildQueue[0];
 v.buildings.farm=accepted.level;v.buildQueue=[];x.c.state.world.tick=accepted.endTick;
 await restarted.cycle();
 assert.equal(x.writes.length,1);assert.equal(restarted.snapshot().pending,null);
 assert.equal(restarted.snapshot().active?.length,0);
 assert.ok(restarted.snapshot().decisions.some(d=>d.kind==='confirmed'&&d.proposalId?.includes(':farm:')));
 assert.equal(x.saved.automatic,false);
});

test('fresh Farm runway revalidation respects operator build and training orders',async()=>{
 for(const kind of ['build','train'] as const){
  const x=await executorFixture();await x.controller.cycle();
  assert.deepEqual(x.controller.snapshot().selection.selected?.action,{type:'build',village:'v1',building:'farm'});
  await x.controller.setAutomatic(true);const freshRead=x.reads+2;
  x.onRead(read=>{
   if(read!==freshRead)return;
   const v=x.c.state.villages[0];
   if(kind==='build')v.orders.build=[{building:'quarry',toLevel:12}];
   else v.orders.train=[{unit:'pikeman',keep:100}];
  });
  await x.controller.cycle();
  assert.equal(x.writes.some(a=>a.type==='build'&&a.building==='farm'),false);
  assert.equal(x.controller.snapshot().error,null);
  if(kind==='build')assert.equal(x.writes.length,0);
 }
});

test('fresh Farm runway revalidation releases capacity priority after income or population changes',async()=>{
 for(const kind of ['income','population'] as const){
  const x=await executorFixture();await x.controller.cycle();
  assert.deepEqual(x.controller.snapshot().selection.selected?.action,{type:'build',village:'v1',building:'farm'});
  await x.controller.setAutomatic(true);const freshRead=x.reads+2;
  x.onRead(read=>{
   if(read!==freshRead)return;
   if(kind==='income')x.c.state.villages[0].productionPerTickMilli.timber=1;
   else x.c.state.villages[0].population.used=30;
  });
  await x.controller.cycle();
  assert.equal(x.writes.some(a=>a.type==='build'&&a.building==='farm'),false);
  assert.equal(x.controller.snapshot().error,null);
 }
});

test('a rejected runway Farm is reported per action without claiming accepted construction',async()=>{
 const x=await executorFixture();await x.controller.cycle();
 x.rejectNext();await x.controller.setAutomatic(true);await x.controller.cycle();
 assert.equal(x.writes.length,1);assert.equal(x.writes[0].building,'farm');
 assert.equal(x.saved.pending,null);assert.equal(x.saved.active?.length,0);
 assert.ok(x.controller.snapshot().decisions.some(d=>d.kind==='rejected'&&d.text.includes('QUEUE_FULL')));
 assert.equal(x.controller.snapshot().decisions.some(d=>d.kind==='accepted'),false);
});
