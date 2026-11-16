/** Authoritative sizing and live-table resource bounds from the latest rejected outpost fixture.
 * Historical scenarios do not authorize a policy raid or predict future garrisons.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PrivateSandbox } from '../src/review/sandbox-client.js';
import { privateRead } from './experiment-raids.js';
import type { SimulateBattleResponse, UnitId } from '../src/shared/api.js';
const run = process.env.STEWARD_REVIEW_RUN!;
const sourcePath = run + '/raid-window-rejected.json';
const source = JSON.parse(await readFile(sourcePath, 'utf8')).results[0];
const intel = source.before.detail.intel;
const s = new PrivateSandbox(73421, 10800);
const result: Record<string, any> = { taskId: 'risk-gated-raid-execution', worldId: s.world.id,
  source: sourcePath, observationTick: source.before.detail.tick,
  limitation: 'Retained explicit defender scenario for sizing only. Future garrisons and building levels require fresh ordinary scouting. No policy activation comparison or combat gain is claimed.', plans: [] };
try {
  const state = s.join(); const rules = s.rules();
  const action = s.act([{ type: 'build', village: state.villages[0].id, building: 'cellar' }]);
  assert.ok(action.results[0].ok); s.step(20);
  const defender = { ...intel.unitsHome };
  for (const [unit, n] of Object.entries(intel.supportTotal)) defender[unit] = (defender[unit] ?? 0) + (n as number);
  for (const [raider, ram, trebuchet] of [[70,8,20],[70,12,24],[40,12,24],[20,12,24],[40,10,26],[40,12,26],[40,16,24],[40,16,26]]) {
    const units = { raider, ram, trebuchet, scout: 10 };
    const battle = privateRead<SimulateBattleResponse>(s, '/simulate/battle', { attacker: units, defender,
      wall: intel.buildings.wall, aim: 'barracks', aimLevel: intel.buildings.barracks, resources: intel.resources, hidden: 0 });
    const ready = source.ready.villages[0];
    const extra: Record<string, number> = Object.fromEntries(Object.entries(units).map(([unit, n]) => [unit, Math.max(0, n + (unit === 'raider' ? 10 : unit === 'scout' ? 2 : 0) - (ready.units.home[unit] ?? 0))]));
    const cost = { timber: 0, stone: 0, iron: 0 }; let workshopTicks = 0;
    for (const [unit, count] of Object.entries(extra)) {
      const option = ready.options.train.find((o: any) => o.unit === unit)!;
      for (const r of ['timber','stone','iron'] as const) cost[r] += option.cost[r] * count;
      if (['ram','trebuchet'].includes(unit)) workshopTicks += option.ticksEach * count;
    }
    const resourceWait = Math.max(0, ...(['timber','stone','iron'] as const).map(r => Math.ceil((cost[r]*1000-ready.resourcesMilli[r])/ready.productionPerTickMilli[r])));
    const origin = source.ready.villages[0]; const target = source.target;
    const travel = Math.ceil(Math.hypot(target.x-origin.x,target.y-origin.y) * (rules.rules.UNITS as Record<UnitId,{speed:number}>).ram.speed);
    const row = { units, battle, clearsObservedBuildings: battle.winner === 'attacker' && battle.wall.after === 0 && battle.building?.after === 0,
      extraFromPreparedForce: extra, extraCost: cost, resourceWait, workshopTicks,
      optimisticReadyTick: source.ready.world.tick + Math.max(resourceWait, workshopTicks),
      conservativeReadyTick: source.ready.world.tick + resourceWait + workshopTicks,
      conservativeClearingReturnTick: source.ready.world.tick + resourceWait + workshopTicks + 2*travel,
      caveat: 'Tick bounds exclude scouting, capacity construction, Council cooldown and enemy growth; training remains serial within the Workshop.' };
    result.plans.push(row); console.log(JSON.stringify(row));
  }
  result.passed = true;
} finally { s.close(); result.deleted = true; await writeFile(run+'/raid-frontier.json',JSON.stringify(result,null,2)); }
