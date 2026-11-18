import {test} from 'node:test';
import assert from 'node:assert/strict';
import {earlyBuildWindow,constructionContext} from '../src/advisors/build-queue.js';
import {developedContext} from './control-fixtures.js';
import {Controller} from '../src/control/controller.js';
import {conquestScope} from '../src/advisors/conquest.js';
import {conquestMission} from '../src/bot/strategy/missions/conquest.js';
import {RemoteError,type Remote} from '../src/control/remote.js';
import type {Action} from '../src/shared/api.js';
import type {SavedControl,Settings} from '../src/control/types.js';

function queued(){
 const c=developedContext(),v=c.state.villages[0];
 Object.assign(v.buildings,{hall:10,barracks:5,smithy:1,market:5,lumberyard:15,quarry:15,mine:15});
 v.population={max:10000,used:500};v.storage=100000;v.resources={timber:10000,stone:10000,iron:10000};v.resourcesMilli={timber:10000000,stone:10000000,iron:10000000};
 v.units.home={pikeman:250,raider:140,envoy:1};v.units.away={};v.buildQueue=[{id:'old',building:'smithy',level:2,startTick:90,endTick:108,cost:{timber:10,stone:10,iron:10}}];
 for(const o of v.options.build){o.level=v.buildings[o.building]+1;o.ok=true;o.blockers=[];o.cost={timber:100,stone:100,iron:100};o.ticks=20;}v.options.build.find(o=>o.building==='smithy')!.level=3;
 c.state.world.speed=1;return {c,v};
}
test('queue window is strictly under ten real seconds, scales by world speed and allows only one existing item',()=>{
 const {c,v}=queued();assert.equal(earlyBuildWindow(c.state,v)?.seconds,8);
 v.buildQueue[0].endTick=110;assert.equal(earlyBuildWindow(c.state,v),null);
 c.state.world.speed=2;v.buildQueue[0].endTick=119;assert.equal(earlyBuildWindow(c.state,v)?.seconds,9.5);
 v.buildQueue[0].endTick=120;assert.equal(earlyBuildWindow(c.state,v),null);
 v.buildQueue[0].endTick=108;v.buildQueue.push({...v.buildQueue[0],id:'second'});assert.equal(earlyBuildWindow(c.state,v),null);v.buildQueue.pop();
 v.orders.build=[{building:'hall',toLevel:15}];assert.equal(earlyBuildWindow(c.state,v),null);
});
test('build forecast respects paid levels and queued delay without changing real stocks or state',()=>{
 const {c,v}=queued();const p=constructionContext(c).state.villages[0];
 assert.equal(p.buildings.smithy,2);assert.equal(v.buildings.smithy,1);assert.equal(p.buildQueue.length,0);assert.equal(v.buildQueue.length,1);
 assert.equal(p.options.build.find(o=>o.building==='smithy')!.ticks,v.options.build.find(o=>o.building==='smithy')!.ticks+8);assert.deepEqual(p.resourcesMilli,v.resourcesMilli);
});
async function harness(stale=false,retrySameBuilding=false){
 const {c,v}=queued(),settings={serverUrl:'https://sandbox.invalid',worldId:c.state.world.id,apiKey:'test'};
 if(retrySameBuilding){v.buildings.smithy=0;v.buildQueue[0].level=1;v.options.build.find(o=>o.building==='smithy')!.level=2;}
 const scope=conquestScope(settings.serverUrl,c.state.player.id,c),writes:any[]=[];let reads=0,now=0,failed=false;
 let saved:SavedControl={settings,pending:null,decisions:[],automatic:true,missions:[conquestMission({scope,villageId:v.id,startedTick:90,status:'preparing',waves:0,targetId:'t',escort:140})],active:[{phase:'accepted',itemId:'old',serverUrl:settings.serverUrl,worldId:c.state.world.id,epoch:c.state.world.epoch,accountId:c.state.player.id,action:{type:'build',village:v.id,building:'smithy',clientId:'old-request'},proposal:{id:'old',task:'conquest.smithy10',villageId:v.id,buildingName:'Smithy',currentLevel:1,targetLevel:2,action:{type:'build',village:v.id,building:'smithy'}},createdTick:90,expiresTick:9999} as any]};
 if(retrySameBuilding){saved.active![0].proposal.currentLevel=0;saved.active![0].proposal.targetLevel=1;}
 const storage={load:async()=>structuredClone(saved),save:async(s:SavedControl)=>{saved=structuredClone(s);}};
 const remote:Remote=async<T>(_s:Settings,path:string,body?:unknown):Promise<T>=>{
  if(path==='/me')return {account:{id:c.state.player.id},worlds:[],sandboxes:[]} as T;
  if(path==='/worlds')return [c.state.world] as T;
  if(path.endsWith('/state')){if(++reads===2&&stale)v.buildQueue.push({...v.buildQueue[0],id:'manual'});return structuredClone(c.state) as T;}
  if(path.endsWith('/rules'))return c.rules as T;
  if(path.endsWith('/history'))return {samples:[]} as T;
  if(path.endsWith('/map'))return {tick:100,snapshotTick:100,size:100,players:[],villages:[{id:'t',ownerId:null,x:2,y:1}]} as T;
  if(path.endsWith('/simulate/battle'))return {winner:'defender',attackerSurvivors:{},attackerLost:{raider:140,envoy:1}} as T;
  assert.ok(path.endsWith('/actions'),path);const action=(body as {actions:Action[]}).actions[0];assert.equal(action.type,'build');if(action.type!=='build')throw new Error('Expected build');assert.deepEqual(saved.pending?.action,action);writes.push(action);if(retrySameBuilding&&!failed){failed=true;throw new RemoteError(429,1000,'retry');}
  const item={id:'new',building:action.building,level:Math.max(v.buildings[action.building],...v.buildQueue.filter(q=>q.building===action.building).map(q=>q.level))+1,startTick:108,endTick:128,cost:{timber:100,stone:100,iron:100}};v.buildQueue.push(item);
  return {tick:100,results:[{ok:true,type:'build',data:{item}}]} as T;
 };
 return {v,writes,getSaved:()=>saved,create:()=>Controller.create(storage,settings,remote,()=>now),advance:()=>{now+=2000;}};
}
test('executor queues conquest Smithy behind an existing build, never a third item, including after restart',async()=>{
 const h=await harness(),c=await h.create();await c.cycle();assert.equal(c.snapshot().error,null);assert.equal(h.writes.length,1);assert.equal(h.writes[0].building,'smithy');
 assert.equal(h.v.buildQueue.length,2);await c.cycle();const restarted=await h.create();await restarted.cycle();assert.equal(h.writes.length,1);assert.equal(h.getSaved().active?.length,2);
});
test('pre-submit refresh notices a manually added successor and refuses another queue item',async()=>{
 const h=await harness(true),c=await h.create();await c.cycle();assert.equal(c.snapshot().error,null);assert.equal(h.writes.length,0);
});

test('a failed append behind the same building retries its journalled ID, rather than confusing the predecessor for success',async()=>{
 const h=await harness(false,true),c=await h.create();await c.cycle();assert.equal(h.writes.length,1);
 h.advance();await c.cycle();assert.equal(c.snapshot().error,null);assert.equal(h.writes.length,2);
 assert.equal(h.writes[0].clientId,h.writes[1].clientId);assert.deepEqual(h.v.buildQueue.map(q=>q.level),[1,2]);
});
