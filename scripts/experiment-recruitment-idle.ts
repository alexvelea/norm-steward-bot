/** Replay an existing paid trace on the server; attribute empty Barracks intervals
 * from fresh authoritative states. This does not simulate resources or game events. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {PrivateSandbox,sandbox} from '../src/review/sandbox-client.js';
import {evaluateEconomy} from '../src/advisors/economic.js';
import {militaryAdvisor} from '../src/advisors/military.js';
import {selectProposal} from '../src/advisors/president.js';
import {evaluateSustainedDefense} from '../src/advisors/sustained-defense.js';
import type {StateResponse,Action} from '../src/shared/api.js';

const run=process.env.STEWARD_REVIEW_RUN!;assert.ok(run);
const trace=process.env.STEWARD_IDLE_TRACE??'/var/lib/norm-steward-review/experiments/jobs/20261116T230158Z-c3ddc0/candidate/result.json';
const prior=JSON.parse(await readFile(trace,'utf8'));
const output=run+'/recruitment-idle-attribution.json';
const result:any={trace,method:'Replay ordinary actions at original ticks; classify fresh server states between queue and affordability events.',segments:[],actions:[],checkpoints:[],passed:false,deleted:false};
let box:PrivateSandbox|undefined,state:StateResponse;
let interrupted=false;process.once('SIGTERM',()=>{interrupted=true;});
try{
 box=new PrivateSandbox(prior.seed,prior.roundTicks,prior.houseBots);result.worldId=box.world.id;
 state=box.join();const rules=box.rules();result.rulesVersion=rules.version;assert.equal(rules.version,prior.rulesVersion);
 let index=0;const start=prior.actions.find((a:any)=>a.action.type==='train').tick;
 const fixed=new Set<number>([0,prior.stopTick,...prior.checkpoints.map((c:any)=>c.tick)]);
 for(const a of prior.actions){fixed.add(a.tick);const q=a.result.data.item??a.result.data.batch;if(q?.endTick<=prior.stopTick)fixed.add(q.endTick);}
 while(state.world.tick<=prior.stopTick){
  assert.ok(!interrupted,'Interrupted; partial evidence preserved');const tick=state.world.tick;
  const checkpoint=prior.checkpoints.find((c:any)=>c.tick===tick);
  if(checkpoint){
   const v=state.villages[0],old=checkpoint.villages[0];
   for(const key of ['resources','population','production'])assert.deepEqual(v[key as keyof typeof v],old[key],`Matched ${key} at ${tick}`);
   assert.deepEqual(Object.fromEntries(Object.entries(v.buildings).filter(([,n])=>n>0)),old.buildings);
   assert.deepEqual(v.units.home,old.army);result.checkpoints.push(tick);
  }
  if(tick===prior.stopTick)break;
  while(prior.actions[index]?.tick===tick){
   const old=prior.actions[index++];const {clientId:_,...original}=old.action;
   const action={...original,village:state.villages[0].id} as Action;
   const response=box.act([action]);result.actions.push({tick,action,result:response.results[0]});
   assert.ok(response.results[0]?.ok,JSON.stringify(response.results));state=response.state??box.state();
  }
  let next=Math.min(...[...fixed].filter(t=>t>tick));
  const v=state.villages[0];
  if(tick>=start&&!v.training.barracks.length){
   const context={state:{...state,world:{...state.world,status:'running' as const}},rules};
   const proposals=[...evaluateEconomy(context),...militaryAdvisor.evaluate(context)];
   const recruit=evaluateSustainedDefense(context)[0];const selection=selectProposal(proposals);
   if(recruit?.affordableAtTick&&recruit.affordableAtTick>tick)next=Math.min(next,recruit.affordableAtTick);
   const blockers=recruit?.blockers??[];
   const category=blockers.includes('POPULATION_CAPACITY')?'population':blockers.includes('INSUFFICIENT_RESOURCES')?'funding':selection.selected?.action.type==='build'?'construction-priority':'execution-cadence';
   result.segments.push({from:tick,to:next,ticks:next-tick,category,blockers,selection:selection.selected?.action,reservations:selection.reservations,population:v.population,resources:v.resources,buildQueue:v.buildQueue,recruit});
  }
  state=sandbox<StateResponse>({op:'step',world:box.world.id,ticks:next-tick});
  if(index%25===0)console.log(JSON.stringify({tick:state.world.tick,actions:index}));
 }
 result.totals=result.segments.reduce((a:any,s:any)=>(a[s.category]=(a[s.category]??0)+s.ticks,a),{});
 result.totalIdleTicks=result.segments.reduce((n:number,s:any)=>n+s.ticks,0);
 assert.equal(result.totalIdleTicks,1037);assert.equal(result.checkpoints.length,prior.checkpoints.length);
 result.passed=true;
}catch(error){result.error=String(error);throw error;}
finally{
 if(box){try{box.close();result.deleted=true;}catch(error){result.cleanupError=String(error);}}
 await writeFile(output,JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({output,passed:result.passed,totals:result.totals,deleted:result.deleted}));
}
