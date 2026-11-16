/** Earlier ordinary-action fixture: overlap independent queues and scout actual outposts before buying siege. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { PrivateSandbox, sandbox } from '../src/review/sandbox-client.js';
import { privateRead } from './experiment-raids.js';
import type { Action, StateResponse, ReportsResponse, Report, MapResponse, SimulateBattleResponse } from '../src/shared/api.js';
const run=process.env.STEWARD_REVIEW_RUN!;
const s=new PrivateSandbox(73421,10800,{warden:0,reaver:0,sovereign:1});
const row:Record<string,any>={taskId:'risk-gated-raid-execution',worldId:s.world.id,steps:[],observations:[]};
const save=()=>writeFile(run+'/raid-early-probe.json',JSON.stringify(row,null,2));
try {
 let state=s.join();const rules=s.rules();
 const step=(tick:number)=>{while(tick>state.world.tick && state.world.status!=='ended')state=sandbox<StateResponse>({op:'step',world:s.world.id,ticks:Math.min(3600,tick-state.world.tick)});};
 const act=(a:Action)=>{const response=s.act([a]);assert.ok(response.results[0].ok,JSON.stringify(response.results));state=response.state??s.state();row.steps.push({tick:state.world.tick,action:a});return response;};
 const build=(building:Extract<Action,{type:'build'}>['building'])=>{const v=state.villages[0],o=v.options.build.find(o=>o.building===building)!;step(Math.max(state.world.tick,state.player.nextActTick??0,o.affordableAtTick??0));act({type:'build',village:v.id,building});step(Math.max(...state.villages[0].buildQueue.map(q=>q.endTick)));};
 const train=(unit:Extract<Action,{type:'train'}>['unit'],count:number)=>{const v=state.villages[0],o=v.options.train.find(o=>o.unit===unit)!;const wait=Math.max(0,...(['timber','stone','iron'] as const).map(r=>Math.ceil((o.cost[r]*count*1000-v.resourcesMilli[r])/v.productionPerTickMilli[r])));step(Math.max(state.world.tick+wait,state.player.nextActTick??0));act({type:'train',village:v.id,unit,count});};
 // Production first makes a much earlier fixture than the saved serial military setup.
 for(let n=0;n<6;n++)for(const b of ['lumberyard','quarry','mine'] as const)build(b);
 for(let n=0;n<4;n++)build('storehouse');
 for(const b of ['hall','hall','barracks','hall','hall','smithy','wall','wall','wall','farm','farm','farm','farm','farm','farm'] as const)build(b);
 train('pikeman',40);for(let n=0;n<5;n++)build('hall');
 for(let n=0;n<4;n++)build('barracks');
 step(Math.max(state.world.tick,...state.villages[0].training.barracks.map(q=>q.endTick)));train('shieldman',15);
 for(let n=0;n<4;n++)build('smithy');build('stable');
 train('scout',12);for(let n=0;n<5;n++)build('smithy');build('workshop');build('workshop');
 step(Math.max(state.world.tick,...state.villages[0].training.barracks.map(q=>q.endTick)));train('raider',50);
 for(let n=0;n<4;n++)build('cellar');
 step(Math.max(state.world.tick,...Object.values(state.villages[0].training).flat().map(q=>q.endTick)));
 row.ready=structuredClone(state);await save();console.log(JSON.stringify({readyTick:state.world.tick,units:state.villages[0].units,map:privateRead<MapResponse>(s,'/map')}));
 const map=privateRead<MapResponse>(s,'/map');const bot=map.players.find(p=>p.houseBot==='sovereign')!;const targets=map.villages.filter(v=>v.ownerId===bot.id).sort((a,b)=>a.points-b.points);
 for(const target of targets.slice(0,3)){
  const travel=Math.ceil(Math.hypot(target.x-state.villages[0].x,target.y-state.villages[0].y)*(rules.rules.UNITS as any).scout.speed);
  const cadence=(rules.rules.SCORING as any).publicSnapshotTicks;const arrival=Math.ceil((state.world.tick+travel+1)/cadence)*cadence;
  step(arrival-travel);const response=act({type:'send',village:state.villages[0].id,target:target.id,kind:'attack',units:{scout:2}});const r=response.results[0];assert.ok(r.ok&&'command' in r.data);const c=r.data.command;step(c.arrivalTick);
  const summary=sandbox<ReportsResponse>({op:'read',world:s.world.id,resource:'reports'}).reports.find(r=>r.commandId===c.id)!;const detail=privateRead<Report>(s,'/reports/'+summary.id);const obs:Record<string,any>={target,detail};row.observations.push(obs);await save();
  if(detail.intel){for(const units of [{raider:40,ram:6,trebuchet:12},{raider:40,ram:8,trebuchet:20}]){const battle=privateRead<SimulateBattleResponse>(s,'/simulate/battle',{fromReport:detail.id,attacker:units,aim:'barracks'});(obs.plans??=[]).push({units,battle});await save();console.log(JSON.stringify({tick:state.world.tick,target,units,battle}));}}
  step(c.arrivalTick+travel);
 }
 row.passed=true;
} catch(error){row.error=String(error);throw error;}
finally{try{row.lastState=s.state();}finally{s.close();row.deleted=true;await save();}}
