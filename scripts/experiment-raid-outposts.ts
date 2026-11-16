/** Discover Sovereign outposts using only public maps and ordinary owner-only actions. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { PrivateSandbox, sandbox } from "../src/review/sandbox-client.js";
import { privateRead, setup } from "./experiment-raids.js";
import type { MapResponse, Report, ReportsResponse } from "../src/shared/api.js";

const output = process.env.STEWARD_REVIEW_RUN! + "/raid-outpost-probe.json";
const s = new PrivateSandbox(73421, 10800, { warden: 0, reaver: 0, sovereign: 1 });
const row: Record<string, any> = { taskId: "risk-gated-raid-execution", worldId: s.world.id, maps: [], probes: [] };
const save = () => writeFile(output, JSON.stringify(row, null, 2));
try {
  const x = setup(s, 0);
  row.setupTick = x.state.world.tick; row.origin = x.state.villages[0];
  row.speeds = Object.fromEntries(Object.entries(x.rules.rules.UNITS as Record<string, { speed: number }>).map(([u, r]) => [u, r.speed]));
  const initial = privateRead<MapResponse>(s, "/map");
  const capital = initial.villages.find(v => v.ownerId && v.ownerId !== x.state.player.id)!;
  row.capital = capital;
  for (const tick of [x.state.world.tick, 4500, 6000, 7500, 9000]) {
    x.stepTo(tick);
    const cadence = (x.rules.rules.SCORING as { publicSnapshotTicks: number }).publicSnapshotTicks;
    x.stepTo(Math.ceil(x.state.world.tick / cadence) * cadence);
    const map = privateRead<MapResponse>(s, "/map"); row.maps.push(map); await save();
    console.log(JSON.stringify({ tick: x.state.world.tick, owned: map.villages.filter(v => v.ownerId && v.ownerId !== x.state.player.id), home: x.state.villages[0].units.home }));
    for (const target of map.villages.filter(v => v.ownerId === capital.ownerId && v.id !== capital.id)) {
      if ((x.state.villages[0].units.home.scout ?? 0) < 2 || row.probes.some((p: any) => p.target.id === target.id)) continue;
      const response = x.act({ type: "send", village: x.state.villages[0].id, target: target.id, kind: "attack", units: { scout: 2 } });
      const result = response.results[0]; assert.ok(result.ok && "command" in result.data);
      const command = result.data.command; x.stepTo(command.arrivalTick);
      const summary = sandbox<ReportsResponse>({ op: "read", world: s.world.id, resource: "reports" }).reports.find(r => r.commandId === command.id)!;
      assert.ok(summary); const detail = privateRead<Report>(s, `/reports/${summary.id}`);
      const probe: Record<string, any> = { target, command, detail };
      if (detail.intel) probe.prediction = privateRead(s, "/simulate/battle", { fromReport: summary.id, attacker: { raider: 10 } });
      row.probes.push(probe); await save(); console.log(JSON.stringify(probe));
      x.stepTo(command.arrivalTick + command.arrivalTick - command.sentTick);
    }
  }
} catch (error) { row.error = String(error); throw error; }
finally { try { row.final = s.state(); } finally { s.close(); row.deleted = true; await save(); } }
