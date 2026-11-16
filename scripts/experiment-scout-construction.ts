/** Matched paid fixtures for scouting during construction and recruitment.
 * Uses the current phased-economy launch, real maps, server actions and durable executor.
 * This isolates command latency; it does not establish raid profitability or full-round throughput.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {PrivateSandbox,sandbox} from '../src/review/sandbox-client.js';
import {Controller} from '../src/control/controller.js';
import {defenseBudget,defenseReady,defenseSustainable} from '../src/advisors/defense-budget.js';
import {privateRead} from './experiment-raids.js';
import type {Remote} from '../src/control/remote.js';
import type {SavedControl} from '../src/control/types.js';
import type {Action,BuildingId,MapResponse,ReportsResponse,StateResponse} from '../src/shared/api.js';
const run=process.env.STEWARD_REVIEW_RUN!;assert.ok(run);
const baselineCommit=process.env.STEWARD_BASELINE_COMMIT??'82bce40399f01f37040b551319e3f82bfd5dc98c';
const root=run+'/scout-construction-baseline-src';
for(const path of execFileSync('git',['ls-tree','-r','--name-only',baselineCommit,'src'],{encoding:'utf8'}).trim().split('\n')){
 const target=root+'/'+path.slice(4);await mkdir(dirname(target),{recursive:true});await writeFile(target,execFileSync('git',['show',baselineCommit+':'+path]));
}
const {Controller:BaselineController}=await import(root+'/control/controller.ts');
const results:any[]=[];
const output=run+'/scout-construction-comparison.json';
const save=(passed=false,error?:string)=>writeFile(output,JSON.stringify({taskId:'raid-command-overlap-generalization',baselineCommit,passed,error,verdict:passed?'supports-change':'inconclusive',
 cadence:'One-second decisions until dispatch, then execution paused for report reconciliation and the matched final tick. Paused server clocks; running planning status for both policies.',
 limitation:'Common paid infrastructure and legacy home forces isolate command timing. No force acquisition recommendation, combat gain, raid profit or full-round allocation improvement is inferred.',results},null,2));
try{
 for(const policy of ['baseline','candidate']){
  const box=new PrivateSandbox(73421,10800,{warden:1,reaver:0,sovereign:0});
  const row:any={policy,worldId:box.world.id,setup:[],actions:[]};results.push(row);
  try{
   let state=box.join(),now=0;const rules=box.rules();
   const step=(tick:number)=>{while(tick>state.world.tick){state=sandbox<StateResponse>({op:'step',world:box.world.id,ticks:Math.min(3600,tick-state.world.tick)});assert.ok(state.world.tick<=10800);}};
   const act=(actions:Action[])=>{
    const before=structuredClone(state.villages[0].resourcesMilli),response=box.act(actions);assert.ok(response.results.every(r=>r.ok),JSON.stringify(response.results));state=response.state!;
    row.setup.push({tick:state.world.tick,actions,results:response.results,spend:Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,(before[r]-state.villages[0].resourcesMilli[r])/1000]))});return response;
   };
   const finish=()=>step(Math.max(state.world.tick,...state.villages[0].buildQueue.map(q=>q.endTick),...Object.values(state.villages[0].training).flat().map(q=>q.endTick)));
   const build=(building:BuildingId)=>{
    const requires=(rules.rules.BUILDINGS as Record<BuildingId,{requires:Partial<Record<BuildingId,number>>}>)[building].requires;
    for(const [b,n] of Object.entries(requires))while(state.villages[0].buildings[b as BuildingId]<n!)build(b as BuildingId);
    let v=state.villages[0],o=v.options.build.find(o=>o.building===building)!;
    if(building!=='farm'&&v.population.max-v.population.used<o.pop+60){build('farm');v=state.villages[0];o=v.options.build.find(o=>o.building===building)!;}
    if(building!=='storehouse'&&Object.values(o.cost).some(c=>c>v.storage)){build('storehouse');v=state.villages[0];o=v.options.build.find(o=>o.building===building)!;}
    assert.ok(o.affordableAtTick!==null||o.ok,JSON.stringify(o));
    step(Math.max(state.world.tick,state.player.nextActTick??0,o.affordableAtTick??0));act([{type:'build',village:v.id,building}]);finish();
   };
   for(let n=0;n<9;n++){
    if(n===4)while(state.villages[0].buildings.hall<5)build('hall');
    for(const b of ['lumberyard','quarry','mine'] as const)build(b);
   }
   while(state.villages[0].buildings.barracks<3)build('barracks');
   while(state.villages[0].buildings.smithy<2)build('smithy');build('stable');
   while(!defenseSustainable(state.villages[0])){
    const v=state.villages[0],b=defenseBudget(v)!;
    for(const [building,r] of [['lumberyard','timber'],['quarry','stone'],['mine','iron']] as const)if(v.productionPerTickMilli[r]/1000*.8<b.perTick[r])build(building);
   }
   const fund=(actions:Extract<Action,{type:'train'}>[])=>{
    const v=state.villages[0];
    const need=Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,actions.reduce((n,a)=>n+v.options.train.find(o=>o.unit===a.unit)!.cost[r]*a.count,0)]));
    assert.ok(Object.values(need).every(c=>c<=v.storage));
    const wait=Math.max(0,...(['timber','stone','iron'] as const).map(r=>Math.ceil((need[r]*1000-v.resourcesMilli[r])/v.productionPerTickMilli[r])));
    step(Math.max(state.world.tick+wait,state.player.nextActTick??0));act(actions);
   };
   for(const [unit,count] of [['pikeman',10],['shieldman',5],['raider',10],['scout',2]] as const){fund([{type:'train',village:state.villages[0].id,unit,count}]);finish();}
   // Fund measured queues and avoid incidental population/storage needs. No stock editing.
   build('farm');build('farm');build('storehouse');
   while(state.villages[0].hidden<Math.max(...Object.values(state.villages[0].productionPerTickMilli))*60/1000)build('cellar');
   step(Math.max(6000,Math.ceil((state.world.tick+300)/300)*300));
   const map=privateRead<MapResponse>(box,'/map'),v=state.villages[0];
   const target=map.villages.filter(t=>t.ownerId&&t.ownerId!==state.player.id).sort((a,b)=>Math.hypot(a.x-v.x,a.y-v.y)-Math.hypot(b.x-v.x,b.y-v.y))[0];assert.ok(target);
   const travel=Math.ceil(Math.hypot(target.x-v.x,target.y-v.y)*(rules.rules.UNITS as Record<string,{speed:number}>).scout.speed);
   assert.ok(travel>1&&travel<=300);row.target=target;row.travel=travel;
   const o=v.options.build.find(o=>o.building==='storehouse')!,overlap=Math.min(10,travel),start=Math.ceil((state.world.tick+o.ticks+300)/300)*300;
   assert.ok(start+2*travel+120<10800);
   step(start-o.ticks+overlap);act([{type:'build',village:v.id,building:'storehouse'}]);
   step(start-2);fund([{type:'train',village:v.id,unit:'pikeman',count:6},{type:'train',village:v.id,unit:'shieldman',count:2}]);
   step(start);assert.equal(state.world.tick,start);assert.ok(state.villages[0].buildQueue.length&&state.villages[0].training.barracks.length);
   assert.ok(defenseReady(state.villages[0])&&defenseSustainable(state.villages[0]));
   row.initialTick=start;row.initial=structuredClone(state.villages[0]);row.clockStatus=state.world.status;row.planningWorldStatus='running';
   row.constructionHeadroom=Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,1-defenseBudget(state.villages[0])!.perTick[r]/(state.villages[0].productionPerTickMilli[r]/1000)]));
   const settings={serverUrl:'https://sandbox.invalid',worldId:box.world.id,apiKey:'sandbox-no-credential'};
   let saved:SavedControl={settings,pending:null,automatic:false,decisions:[]};
   const storage={load:async()=>structuredClone(saved),save:async(s:SavedControl)=>{saved=structuredClone(s);}};
   const planning=()=>({...state,world:{...state.world,status:'running' as const}});
   const remote:Remote=async<T>(_s:unknown,path:string,body?:unknown):Promise<T>=>{
    if(path==='/me')return {account:{id:state.player.id},worlds:[],sandboxes:[]} as T;
    if(path==='/worlds')return [planning().world] as T;
    if(path.endsWith('/state'))return planning() as T;
    if(path.endsWith('/rules'))return rules as T;
    if(path.endsWith('/history'))return {samples:[]} as T;
    if(path.endsWith('/map'))return privateRead(box,'/map') as T;
    if(path.endsWith('/reports'))return sandbox<ReportsResponse>({op:'read',world:box.world.id,resource:'reports'}) as T;
    if(path.includes('/reports/'))return privateRead(box,path.slice(path.indexOf('/reports/'))) as T;
    if(path.endsWith('/simulate/battle'))return privateRead(box,'/simulate/battle',body) as T;
    assert.ok(path.endsWith('/actions'),path);
    const action=(body as {actions:Action[]}).actions[0];assert.deepEqual(saved.pending!.action,action,'journal before write');
    const before=structuredClone(state.villages[0]);const response=sandbox<any>({op:'act',world:box.world.id,requestId:action.clientId,actions:[action]});
    assert.ok(response.results[0].ok,JSON.stringify(response.results));state=response.state!;
    row.actions.push({tick:state.world.tick,action,results:response.results,construction:before.buildQueue,training:before.training,
     spend:Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,(before.resourcesMilli[r]-state.villages[0].resourcesMilli[r])/1000]))});return response as T;
   };
   const Factory=policy==='baseline'?BaselineController:Controller;
   let c=await Factory.create(storage,settings,remote,()=>now);await c.cycle();row.firstSelection=c.snapshot().selection;
   await c.setAutomatic(true);
   for(let tick=start;tick<=start+overlap;tick++){
    step(tick);now+=1000;await c.cycle();assert.equal(c.snapshot().error,null);
    if(row.actions.some((a:any)=>a.action.type==='send'))break;
   }
   const sent=row.actions.find((a:any)=>a.action.type==='send');assert.ok(sent,JSON.stringify(c.snapshot()));
   assert.equal(sent.action.units.scout,2);row.dispatchTick=sent.tick;
   await c.setAutomatic(false);const count=row.actions.length;
   // Restart with an operator pause and accepted command, then reconcile the real report.
   c=await Factory.create(storage,settings,remote,()=>now);await c.cycle();assert.equal(c.snapshot().automatic,false);
   const command=sent.results[0].data.command;step(command.arrivalTick);now+=10000;await c.cycle();assert.equal(c.snapshot().error,null);
   const reports=sandbox<ReportsResponse>({op:'read',world:box.world.id,resource:'reports'});
   row.report=reports.reports.find(r=>r.commandId===command.id);assert.ok(row.report);assert.equal(saved.pending,null);assert.equal(row.actions.length,count);
   row.pausedRestartConfirmed=true;
   step(start+2*travel+overlap+1);row.finalTick=state.world.tick;row.final=structuredClone(state.villages[0]);
   row.spend=Object.fromEntries((['timber','stone','iron'] as const).map(r=>[r,row.actions.reduce((n:number,a:any)=>n+a.spend[r],0)]));
   row.passed=true;console.log(JSON.stringify({policy,tick:state.world.tick,dispatchTick:row.dispatchTick,report:row.report,headroom:row.constructionHeadroom}));
  }finally{box.close();row.deleted=true;await save();}
 }
 const [a,b]=results;assert.equal(a.initialTick,b.initialTick);assert.equal(a.finalTick,b.finalTick);
 for(const key of ['buildings','resourcesMilli','population','units','buildQueue','training']){
  // Queue IDs differ across owned worlds; compare their gameplay values instead.
  if(['buildQueue','training'].includes(key))continue;assert.deepEqual(a.initial[key],b.initial[key]);
 }
 assert.ok(b.dispatchTick<a.dispatchTick);assert.equal(a.report.tick-b.report.tick,a.dispatchTick-b.dispatchTick);
 assert.ok(b.actions[0].construction.length&&b.actions[0].training.barracks.length);
 assert.deepEqual(a.spend,b.spend);assert.ok(results.every(r=>r.deleted&&r.pausedRestartConfirmed));
 await save(true);console.log('Matched construction/recruitment Scout comparison passed.');
}catch(error){await save(false,String(error));throw error;}
