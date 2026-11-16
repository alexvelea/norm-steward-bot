/** Owner-only live-rule comparison and production-only opening feasibility check. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PrivateSandbox } from '../src/review/sandbox-client.js';
import { evaluateEconomy } from '../src/advisors/economic.js';
import { selectProposal } from '../src/advisors/president.js';
const run = process.env.STEWARD_REVIEW_RUN!;
const base = process.env.STEWARD_BASELINE_COMMIT!;
assert.ok(run && base);
const root = run + '/baseline-src';
for (const path of execFileSync('git', ['ls-tree','-r','--name-only',base,'src'], {encoding:'utf8'}).trim().split('\n')) {
  const target = root + '/' + path.slice(4); await mkdir(dirname(target),{recursive:true});
  await writeFile(target,execFileSync('git',['show',base+':'+path]));
}
const { evaluateEconomy: baseline } = await import(root+'/advisors/economic.ts');
const results: any[] = [];
for (const policy of ['baseline','candidate']) {
  const box = new PrivateSandbox(73430,10800);
  const row: any = {policy,world:box.world.id}; results.push(row);
  try {
    let state = box.join(); const rules = box.rules();
    row.initial = state.villages[0];
    const context = {state:{...state,world:{...state.world,status:'running' as const}},rules};
    const proposals = (policy==='baseline'?baseline:evaluateEconomy)(context);
    row.cellar = proposals.find((p:any)=>p.action.building==='cellar');
    row.selection = selectProposal(proposals);
    // Exercise the changed proposal against the authoritative queue and costs.
    if (row.cellar.status==='ready') {
      const response=box.act([row.cellar.action]); assert.ok(response.results[0].ok);
      state=response.state!; row.cost=state.villages[0].buildQueue[0].cost;
      state=box.step(state.villages[0].buildQueue[0].endTick-state.world.tick);
      row.confirmedCellar=state.villages[0].buildings.cellar;
      row.afterCellar=(policy==='baseline'?baseline:evaluateEconomy)({state:{...state,world:{...state.world,status:'running' as const}},rules}).find((p:any)=>p.action.building==='cellar');
    } else state=box.step(1);
    row.passed=true;
  } finally { box.close(); row.deleted=true; }
}
// Production-only opening: spend/wait through live options; never build auxiliaries.
const box = new PrivateSandbox(73430,10800);
const opening:any={world:box.world.id, milestones:[], purchases:[]};
try {
 let state=box.join(); opening.initial=state.villages[0];
 for (const target of [5,7]) {
  while (['lumberyard','quarry','mine'].some(b=>state.villages[0].buildings[b as 'mine']<target)) {
   const v=state.villages[0];
   const options=v.options.build.filter(o=>['lumberyard','quarry','mine'].includes(o.building)&&v.buildings[o.building]<target);
   const option=options.sort((a,b)=>v.buildings[a.building]-v.buildings[b.building]||a.cost.timber+a.cost.stone+a.cost.iron-b.cost.timber-b.cost.stone-b.cost.iron)[0];
   const hard=option.blockers.filter(b=>!['INSUFFICIENT_RESOURCES','COUNCIL_COOLDOWN'].includes(b));
   if(hard.length){opening.blocked={target,building:option.building,blockers:hard};break;}
   const wait=Math.max(state.player.nextActTick??state.world.tick,option.affordableAtTick??state.world.tick)-state.world.tick;
   if(wait>0){state=box.step(wait);continue;}
   const response=box.act([{type:'build',village:v.id,building:option.building}]);
   assert.ok(response.results[0].ok,JSON.stringify(response.results));state=response.state!;
   opening.purchases.push({building:option.building,level:option.level,cost:option.cost});
   state=box.step(Math.max(...state.villages[0].buildQueue.map(q=>q.endTick),state.player.nextActTick??0)-state.world.tick);
  }
  if(opening.blocked)break;
  opening.milestones.push({target,tick:state.world.tick,village:state.villages[0]});
 }
} finally {box.close();opening.deleted=true;}
assert.deepEqual(results[0].initial.buildings,results[1].initial.buildings);
assert.ok(results.every(r=>r.passed&&r.deleted));
assert.notEqual(results[0].afterCellar.status,'not-needed');
assert.equal(results[1].afterCellar.status,'not-needed');
assert.equal(results[0].confirmedCellar,results[1].confirmedCellar);
await writeFile(run+'/cellar-opening-comparison.json',JSON.stringify({baselineCommit:base,passed:true,verdict:'supports-change',results,opening},null,2));
console.log(JSON.stringify({passed:true,cellar:results.map(r=>({policy:r.policy,status:r.cellar.status,reason:r.cellar.reason})),opening:opening.milestones.map((m:any)=>({target:m.target,tick:m.tick})),blocked:opening.blocked}));
