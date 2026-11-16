/** Controlled clearing fixture; no policy gates or authoritative state are edited. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { PrivateSandbox, sandbox } from '../src/review/sandbox-client.js';
import { privateRead, setup } from './experiment-raids.js';
import type { MapResponse, Report, ReportsResponse, Action } from '../src/shared/api.js';
const output = process.env.STEWARD_REVIEW_RUN! + '/raid-clearing-probe.json';
const s = new PrivateSandbox(73421, 10800, { warden: 0, reaver: 0, sovereign: 1 });
const row: Record<string, any> = { taskId: 'risk-gated-raid-execution', worldId: s.world.id, battles: [] };
const save = () => writeFile(output, JSON.stringify(row, null, 2));
try {
    const x = setup(s, 0, true, true);
    row.setupTick = x.state.world.tick;
    row.setup = x.state;
    await save();
    // Smaller force than the rejected Reaver fixture, against an acquired outpost.
    x.trainFunded('raider', 60);
    const buildings = x.rules.rules.BUILDINGS as Record<string, {
        requires: Record<string, number>;
    }>;
    for (const [b, level] of Object.entries(buildings.workshop.requires))
        while (x.state.villages[0].buildings[b as keyof typeof x.state.villages[0]['buildings']] < level)
            x.build(b as Extract<Action, {
                type: 'build';
            }>['building']);
    x.build('workshop');
    x.build('workshop');
    x.trainFunded('ram', 5);
    x.trainFunded('trebuchet', 12);
    x.trainFunded('scout', 20);
    row.readyTick = x.state.world.tick;
    row.ready = x.state;
    await save();
    const map = privateRead<MapResponse>(s, '/map');
    row.map = map;
    const bot = map.players.find(p => p.houseBot === 'sovereign')!;
    const target = map.villages.filter(v => v.ownerId === bot.id).sort((a, b) => Math.hypot(a.x - x.state.villages[0].x, a.y - x.state.villages[0].y) - Math.hypot(b.x - x.state.villages[0].x, b.y - x.state.villages[0].y))[0];
    row.target = target;
    await save();
    for (const aim of ['hall', 'barracks'] as const) {
        assert.ok((x.state.villages[0].units.home.raider ?? 0) > 10 && (x.state.villages[0].units.home.ram ?? 0) > 0 && (x.state.villages[0].units.home.trebuchet ?? 0) > 0, 'Stop after losses exhaust the clearing force; never reuse the original counts');
        const response = x.act({ type: 'send', village: x.state.villages[0].id, target: target.id, kind: 'attack', units: { raider: Math.min(60, (x.state.villages[0].units.home.raider ?? 0) - 10), ram: x.state.villages[0].units.home.ram ?? 0, trebuchet: x.state.villages[0].units.home.trebuchet ?? 0, scout: Math.min(10, (x.state.villages[0].units.home.scout ?? 0) - 2) }, aim });
        const result = response.results[0];
        assert.ok(result.ok && 'command' in result.data);
        const command = result.data.command;
        x.stepTo(command.arrivalTick);
        const summary = sandbox<ReportsResponse>({ op: 'read', world: s.world.id, resource: 'reports' }).reports.find(r => r.commandId === command.id)!;
        const detail = privateRead<Report>(s, `/reports/${summary.id}`);
        row.battles.push({ command, detail });
        await save();
        console.log(JSON.stringify({ tick: x.state.world.tick, aim, detail }));
        x.stepTo(command.arrivalTick + command.arrivalTick - command.sentTick);
    }
    const cadence = (x.rules.rules.SCORING as {
        publicSnapshotTicks: number;
    }).publicSnapshotTicks;
    const travel = Math.ceil(Math.hypot(target.x - x.state.villages[0].x, target.y - x.state.villages[0].y) * (x.rules.rules.UNITS as Record<string, { speed: number }>).scout.speed);
    const arrival = Math.ceil((x.state.world.tick + travel) / cadence) * cadence;
    x.stepTo(arrival - travel);
    const response = x.act({ type: 'send', village: x.state.villages[0].id, target: target.id, kind: 'attack', units: { scout: 2 } });
    const result = response.results[0];
    assert.ok(result.ok && 'command' in result.data);
    const command = result.data.command;
    x.stepTo(command.arrivalTick);
    const summary = sandbox<ReportsResponse>({ op: 'read', world: s.world.id, resource: 'reports' }).reports.find(r => r.commandId === command.id)!;
    row.scouting = { command, summary, detail: privateRead<Report>(s, `/reports/${summary.id}`) };
    if (row.scouting.detail.intel)
        row.prediction = privateRead(s, '/simulate/battle', { fromReport: summary.id, attacker: { raider: 10 } });
    await save();
    console.log(JSON.stringify({ tick: x.state.world.tick, scouting: row.scouting, prediction: row.prediction }));
}
catch (error) {
    row.error = String(error);
    throw error;
}
finally {
    try {
        row.final = s.state();
    }
    finally {
        s.close();
        row.deleted = true;
        await save();
    }
}
