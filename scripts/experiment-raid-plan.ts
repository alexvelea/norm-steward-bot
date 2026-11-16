/** Budget a clearing fixture with authoritative simulations before buying siege units. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { PrivateSandbox, sandbox } from '../src/review/sandbox-client.js';
import { privateRead, setup } from './experiment-raids.js';
import type { MapResponse, Report, ReportsResponse, SimulateBattleResponse } from '../src/shared/api.js';
const outpost = process.argv.includes('--outpost');
const output = process.env.STEWARD_REVIEW_RUN! + (outpost ? '/raid-outpost-plan.json' : '/raid-clearing-plan.json');
const s = new PrivateSandbox(73421, 10800, { warden: 0, reaver: 0, sovereign: 1 });
const row: Record<string, any> = { taskId: 'risk-gated-raid-execution', worldId: s.world.id, plans: [] };
const save = () => writeFile(output, JSON.stringify(row, null, 2));
try {
  const x = setup(s, 0, !outpost, !outpost); row.setupTick = x.state.world.tick;
  x.stepTo(outpost ? 6500 : 6000);
  const map = privateRead<MapResponse>(s, '/map'); row.map = map;
  const bot = map.players.find(p => p.houseBot === 'sovereign')!;
  const targets = map.villages.filter(v => v.ownerId === bot.id).sort((a,b) => Math.hypot(a.x-x.state.villages[0].x,a.y-x.state.villages[0].y)-Math.hypot(b.x-x.state.villages[0].x,b.y-x.state.villages[0].y));
  const target = outpost ? targets.filter(t => t.points < Math.max(...targets.map(v => v.points)))[0] : targets[0];
  assert.ok(target, "An acquired outpost must exist; do not substitute the capital"); row.target = target;
  const response = x.act({type:'send',village:x.state.villages[0].id,target:target.id,kind:'attack',units:{scout:2}});
  const result = response.results[0]; assert.ok(result.ok && 'command' in result.data);
  const command = result.data.command; x.stepTo(command.arrivalTick);
  const summary = sandbox<ReportsResponse>({op:'read',world:s.world.id,resource:'reports'}).reports.find(r=>r.commandId===command.id)!;
  const detail = privateRead<Report>(s, `/reports/${summary.id}`); row.scouting = {command,detail}; await save();
  assert.ok(detail.intel, 'Ordinary scouting must provide the planning intelligence');
  for (const [raider,ram,trebuchet] of [[40,12,12],[60,12,12],[60,20,16],[60,20,20],[80,16,16]]) {
    const units = {raider,ram,trebuchet,scout:4};
    const battle = privateRead<SimulateBattleResponse>(s,'/simulate/battle',{fromReport:detail.id,attacker:units,aim:'barracks'});
    row.plans.push({units,battle}); await save();
    console.log(JSON.stringify({units,battle}));
  }
  row.passed = true;
} catch(error) {row.error=String(error); throw error;}
finally {try {row.final=s.state();} finally {s.close();row.deleted=true;await save();}}
