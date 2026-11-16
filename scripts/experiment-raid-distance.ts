/** Find a shorter ordinary-action outpost fixture; this survey never authorizes a raid. */
import { writeFile } from 'node:fs/promises';
import { PrivateSandbox } from '../src/review/sandbox-client.js';
import { privateRead } from './experiment-raids.js';
import type { MapResponse } from '../src/shared/api.js';
const results: Record<string, any>[] = [];
for (const seed of [73422, 73423, 73424]) {
  const s = new PrivateSandbox(seed, 10800, {warden: 0, reaver: 0, sovereign: 1});
  const row: Record<string, any> = {seed, worldId: s.world.id}; results.push(row);
  try {
    const initial = s.join(); s.step(7000);
    const map = privateRead<MapResponse>(s, '/map');
    const origin = initial.villages[0];
    row.origin = {x: origin.x, y: origin.y}; row.map = map;
    row.targets = map.villages.filter(v => v.ownerId && v.ownerId !== initial.player.id)
      .map(v => ({...v, distance: Math.hypot(v.x-origin.x, v.y-origin.y)}))
      .sort((a,b) => a.distance-b.distance);
    console.log(JSON.stringify({seed, targets: row.targets}));
  } finally {
    s.close(); row.deleted = true;
    await writeFile(process.env.STEWARD_REVIEW_RUN!+'/raid-distance.json', JSON.stringify({taskId:'risk-gated-raid-execution', limitation:'Public geography survey only; no hidden target strength inferred.', results}, null, 2));
  }
}
