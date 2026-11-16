/** Compare repeated cleared-neutral raids with the deployed policy and its economic investment.
 * Ordinary actions only; complete acquisition expense and clearing losses remain explicit. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname} from 'node:path';
import {PrivateSandbox,sandbox} from '../src/review/sandbox-client.js';
import {privateRead} from './experiment-raids.js';
import {Controller} from '../src/control/controller.js';
import {type Remote} from '../src/control/remote.js';
import type {SavedControl} from '../src/control/types.js';
import type {Action,ActionsResponse,MapResponse,Report,ReportsResponse,StateResponse} from '../src/shared/api.js';
const coarse=process.argv.includes('--coarse');
const output=process.env.STEWARD_REVIEW_RUN!+(coarse?'/repeatable-raid-coarse.json':'/repeatable-raid-comparison.json');
const rows:Record<string,any>[]=[];
const baselineCommit='cd1f087715e6596e016bd927e4b1367963f78a82';
const baselineRoot=process.env.STEWARD_REVIEW_RUN!+'/baseline-src';
// Reproduce the exact deployed controller in private artifacts, without editing the worktree.
for(const path of execFileSync('git',['ls-tree','-r','--name-only',baselineCommit,'src'],{encoding:'utf8'}).trim().split('\n')){
 const target=baselineRoot+'/'+path.slice(4);await mkdir(dirname(target),{recursive:true});
 await writeFile(target,execFileSync('git',['show',baselineCommit+':'+path]));
}
const {Controller: BaselineController}=await import(baselineRoot+'/control/controller.ts');
const save=(passed=false,error?:string)=>writeFile(output,JSON.stringify({taskId:'repeatable-raid-economics',baselineCommit,evaluationSchedule:coarse?'100-tick polling':'100-tick polling plus Scout-arrival evaluation',baseline:'deployed-600-tick-scout-and-raid-policy',candidate:'120-tick-cleared-neutral-reconnaissance-and-raids',passed,verdict:!passed||coarse?'inconclusive':rows.length===2&&rows[0].raidCount>1&&rows[0].raidCount>rows[1].raidCount?'supports-change':'rejects-change',error,results:rows},null,2));
try {
 for(const policy of ['candidate','baseline']) {
  const s=new PrivateSandbox(73421,10800);
  const row:Record<string,any>={policy,worldId:s.world.id,setup:[]};rows.push(row);
  try {
   let state=s.join();const rules=s.rules();
   const step=(tick:number)=>{while(tick>state.world.tick && state.world.status!=='ended')state=sandbox<StateResponse>({op:'step',world:s.world.id,ticks:Math.min(3600,tick-state.world.tick)});};
   const act=(a:Action)=>{const before=structuredClone(state.villages[0]);const r=s.act([a]);assert.ok(r.results[0].ok,JSON.stringify(r.results));state=r.state??s.state();row.setup.push({tick:state.world.tick,action:a,results:r.results,spend:Object.fromEntries((["timber","stone","iron"] as const).map(k=>[k,(before.resourcesMilli[k]-state.villages[0].resourcesMilli[k])/1000]))});return r;};
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
   let saved:SavedControl={settings,pending:null,automatic:false,decisions:[],scouting:[linked]};let now=0;
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
    return response as T;
   };
   row.initial=structuredClone(state.villages[0]);row.initialTick=state.world.tick;row.clockStatus=state.world.status;row.planningWorldStatus='running';
   const Factory=policy==='candidate'?Controller:BaselineController;
   let c=await Factory.create(storage,settings,remote,()=>now);
   row.samples=[];
   await c.cycle();await c.setAutomatic(true);
   // Same evaluation schedule, paused clock, running planning status and ordinary executor.
   for(let tick=row.initialTick;tick<9900;tick+=100){
    step(tick);now+=10000;await c.cycle();
    row.samples.push({tick,selected:c.snapshot().selection.selected?.action,pending:saved.pending,proposals:c.snapshot().proposals.filter((p:any)=>p.action.type==='send'),decisions:c.snapshot().decisions.slice(0,3),error:c.snapshot().error});
    await save();
    assert.equal(c.snapshot().error,null);
    // The public map is fresh for only 30 ticks of its 300-tick cadence. A sparse
    // polling-only harness skips a Scout's usable arrival window. Both policies
    // receive the same event rule, representing the live one-second evaluator.
    const arrival=state.commands.outgoing.find(cmd=>!cmd.returning&&(cmd.units.scout??0)>0&&cmd.arrivalTick>state.world.tick&&cmd.arrivalTick<tick+100)?.arrivalTick;
    if(!coarse&&arrival!==undefined){
     step(arrival);now+=10000;await c.cycle();now+=1000;await c.cycle();
     row.samples.push({tick:arrival,event:'scout-arrival',selected:c.snapshot().selection.selected?.action,pending:saved.pending,error:c.snapshot().error});
     assert.equal(c.snapshot().error,null);await save();
    }
    if(policy==='candidate'&&tick===8500){
     await c.setAutomatic(false);c=await Factory.create(storage,settings,remote,()=>now);await c.cycle();
     assert.equal(c.snapshot().automatic,false);row.pausedRestartConfirmed=true;await c.setAutomatic(true);
    }
   }
   await c.setAutomatic(false);step(10000);now+=10000;await c.cycle();
   row.comparisonTick=state.world.tick;row.final=structuredClone(state.villages[0]);
   row.battles=[];
   for(const charge of charges){
    const command=charge.results[0].data.command;
    if(command?.units.lancer){
     const summary=summaries().find(r=>r.commandId===command.id);assert.ok(summary,'battle retained');
     const report=privateRead<Report>(s,'/reports/'+summary.id);row.battles.push(report);
     assert.equal(report.outcome,'won');assert.ok(Object.values(report.attackerUnits!.lost).every(n=>n===0),'zero actual raid losses');
    }
   }
   const sum=(items:any[],f:(x:any,r:string)=>number)=>Object.fromEntries(['timber','stone','iron'].map(r=>[r,items.reduce((n,x)=>n+f(x,r),0)]));
   row.economics={
    setupSpend:sum(row.setup,(x,r)=>x.spend[r]),
    troopAcquisition:sum(row.setup.filter((x:any)=>x.action.type==='train'),(x,r)=>x.spend[r]),
    policySpend:sum(charges,(x,r)=>x.spend[r]),
    raidLoot:sum(row.battles,(x,r)=>x.loot[r]),
    clearingLoot:row.clearing.loot,
    clearingLossReplacement: Object.fromEntries(['timber','stone','iron'].map(r=>[r,Object.entries(row.clearing.attackerUnits.lost).reduce((n,[u,count])=>n+Number(count)*(rules.rules.UNITS as any)[u].cost[r],0)])),
    homeStockChange:Object.fromEntries(['timber','stone','iron'].map(r=>[r,(row.final.resourcesMilli[r]-row.initial.resourcesMilli[r])/1000])),
    troopAssets:row.final.units,
    economicBuildings:row.final.buildings,
    limitation:'Matched comparison begins after common costly acquisition and clearing. Full acquisition expense is reported without also double-charging replacement losses. Remaining troops and buildings are assets, not refunded resources. No live profitability claim.'
   };
   assert.equal(state.commands.outgoing.length,0,'all loot must return before comparison');
   row.economics.retainedProduction=Object.fromEntries(['timber','stone','iron'].map(r=>[r,row.economics.homeStockChange[r]+row.economics.policySpend[r]-row.economics.raidLoot[r]]));
   row.economics.lootLessFullTroopAcquisition=Object.fromEntries(['timber','stone','iron'].map(r=>[r,row.economics.raidLoot[r]+row.economics.clearingLoot[r]-row.economics.troopAcquisition[r]]));
   row.raidCount=row.battles.length;
   row.passed=true;await save();console.log(JSON.stringify({policy,initialTick:row.initialTick,comparisonTick:row.comparisonTick,raidCount:row.raidCount,economics:row.economics}));
  }finally{try{row.lastState=s.state();}finally{s.close();row.deleted=true;await save();}}
 }
 const a=rows[0],b=rows[1];assert.equal(a.initialTick,b.initialTick);assert.equal(a.comparisonTick,b.comparisonTick);for(const k of ['buildings','resourcesMilli','population','units'])assert.deepEqual(a.initial[k],b.initial[k]);for(const row of rows){assert.equal(new Set(row.charges.filter((q:any)=>q.action.units?.lancer).map((q:any)=>q.results[0].data.command.id)).size,row.raidCount,'no duplicate raid commands');}
 await save(true);
}catch(error){await save(false,String(error));throw error;}
