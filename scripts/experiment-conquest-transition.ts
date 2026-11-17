/** Paid historical prefix isolates the integrated one-Envoy capture mechanism.
 * The fresh-world whole-policy comparison belongs to the persistent worker. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {PrivateSandbox,sandbox} from '../src/review/sandbox-client.js';
import {Controller} from '../src/control/controller.js';
import {privateRead} from './experiment-raids.js';
import type {Action,StateResponse} from '../src/shared/api.js';
const run=process.env.STEWARD_REVIEW_RUN!;assert.ok(run);
const prior=JSON.parse(await readFile('/var/lib/norm-steward-review/owner-conquest-opening/result.json','utf8'));
const baseline=run+'/baseline-source';await mkdir(baseline,{recursive:true});
execFileSync('bash',['-c','git archive d054552 src | tar -x -C "$1"','_',baseline]);
await writeFile(baseline+'/package.json','{"type":"module"}');
const {Controller:Baseline}=await import(baseline+'/src/control/controller.ts');
const start=6061,until=6656,rows:any[]=[];
let interrupted=false;process.once('SIGTERM',()=>{interrupted=true;});
const output=run+'/conquest-mechanism.json';
const save=(passed=false,error?:string)=>writeFile(output,JSON.stringify({taskId:'conquest-transition-economics',start,until,seed:prior.seed,rows,passed,error,limitations:'Matched paid prefix, no enemy players or support. Isolates integrated dispatch/reconciliation, not whole-economy allocation or survival.'},null,2),{mode:0o600});
try{
 for(const policy of ['baseline','candidate']){
  const box=new PrivateSandbox(prior.seed,10800,prior.houseBots);
  const row:any={policy,worldId:box.world.id,actions:[],replayed:0,deleted:false};rows.push(row);
  try{
   let state=box.join();const rules=box.rules();row.rulesVersion=rules.version;assert.equal(rules.version,prior.rulesVersion);
   function step(tick:number){if(tick>state.world.tick)state=sandbox<StateResponse>({op:'step',world:box.world.id,ticks:tick-state.world.tick});}
   for(const old of prior.actions.filter((a:any)=>a.tick<start)){
    assert.ok(!interrupted,'Interrupted during paid prefix');step(old.tick);
    const {clientId:_,...a}=old.action;const response=box.act([{...a,village:state.villages[0].id} as Action]);
    assert.ok(response.results[0].ok,JSON.stringify(response.results));state=response.state??box.state();row.replayed++;
    if(row.replayed%25===0){await save();console.log(JSON.stringify({policy,replayed:row.replayed,tick:state.world.tick}));}
   }
   step(start);row.initial=structuredClone(state.villages[0]);
   const settings={serverUrl:'https://sandbox.invalid',worldId:box.world.id,apiKey:'sandbox-adapter-no-credential'};
   let saved:any={settings,pending:null,active:[],automatic:false,decisions:[]};let now=start*1000;
   const storage={load:async()=>structuredClone(saved),save:async(v:any)=>{saved=structuredClone(v);}};
   const planning=()=>({...state,world:{...state.world,status:state.world.status==='ended'?'ended' as const:'running' as const}});
   const remote=async(_s:any,path:string,body?:any):Promise<any>=>{
    if(path==='/me')return {account:{id:state.player.id},worlds:[],sandboxes:[]};
    if(path==='/worlds')return [planning().world];
    if(path.endsWith('/state'))return planning();if(path.endsWith('/rules'))return rules;
    if(path.endsWith('/history'))return {samples:[]};
    if(path.endsWith('/map'))return privateRead(box,'/map');
    if(path.endsWith('/reports'))return sandbox({op:'read',world:box.world.id,resource:'reports'});
    if(path.includes('/reports/'))return privateRead(box,path.slice(path.indexOf('/reports/')));
    if(path.endsWith('/simulate/battle'))return privateRead(box,'/simulate/battle',body);
    assert.ok(path.endsWith('/actions'),path);const action=body.actions[0];
    assert.deepEqual(saved.pending.action,action,'journal before write');
    const response=box.act([action]);row.actions.push({tick:state.world.tick,action,proposal:saved.pending.proposal,result:response.results[0]});
    assert.ok(response.results[0].ok,JSON.stringify(response.results));state=response.state??box.state();await save();return response;
   };
   const Factory=policy==='baseline'?Baseline:Controller;
   let c=await Factory.create(storage,settings,remote,()=>now);await c.cycle();await c.setAutomatic(true);
   let restarted=false;
   while(state.world.tick<until){
    assert.ok(!interrupted,'Interrupted during mechanism comparison');now=state.world.tick*1000;
    const before=row.actions.length;await c.cycle();const view=c.snapshot();assert.equal(view.error,null);
    if(!restarted&&row.actions.some((a:any)=>a.action.type==='send')){
     await c.setAutomatic(false);c=await Factory.create(storage,settings,remote,()=>now);await c.cycle();assert.equal(c.snapshot().automatic,false);
     row.pausedRestartPreserved=true;await c.setAutomatic(true);restarted=true;
    }
    row.conquest=structuredClone(saved.conquest);
    const tick=state.world.tick,events=[until,tick+30];
    if(row.actions.length>before||view.selection.selected)events.push(tick+1);
    for(const v of state.villages){for(const q of v.buildQueue)events.push(q.endTick);for(const q of Object.values(v.training).flat())events.push(q.nextTick,q.endTick);}
    for(const cmd of state.commands.outgoing)events.push(cmd.arrivalTick);
    for(const p of view.proposals)if(p.affordableAtTick>tick)events.push(p.affordableAtTick);
    step(Math.min(...events.filter(n=>Number.isFinite(n)&&n>tick)));
   }
   now=until*1000;await c.setAutomatic(false);await c.cycle();row.final=state;row.conquest=saved.conquest;
   assert.equal(state.world.tick,until,'Both mechanism cases must reach the same actual endpoint');
   row.captureTick=saved.conquest?.capturedTick??null;row.spending=row.actions.reduce((sum:number,a:any)=>sum+Object.values(a.proposal.requirements).reduce((n:number,x:any)=>n+x,0),0);
   console.log(JSON.stringify({policy,captureTick:row.captureTick,villages:state.villages.length,actions:row.actions.length}));
  }finally{box.close();row.deleted=true;await save();}
 }
 for(const k of ['buildings','population','resourcesMilli','units'])assert.deepEqual(rows[0].initial[k],rows[1].initial[k]);
 assert.equal(rows[0].final.villages.length,1);assert.equal(rows[1].final.villages.length,2);
 assert.ok(rows[1].pausedRestartPreserved);assert.equal(rows[1].actions.filter((a:any)=>a.action.type==='send').length,4);
 assert.equal(rows[1].final.villages[0].units.home.pikeman,153);assert.equal(rows[1].final.villages[0].units.home.shieldman,51);
 await save(true);console.log(output);
}catch(error){await save(false,String(error));throw error;}
