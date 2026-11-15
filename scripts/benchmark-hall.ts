/** Real upstream private-sandbox A/B experiment; no live-world write path. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { selectProposal } from "../src/advisors/president.js";
import type {
  StateResponse,
  RulesResponse,
  WorldSummary,
  MeResponse,
  ActionsResponse,
} from "../src/shared/api.js";
const dataDir = process.env.STEWARD_CONTROL_DIR || "/var/lib/norm-steward-bot";
const { settings } = JSON.parse(
  await readFile(dataDir + "/control.json", "utf8"),
);
async function call<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(settings.serverUrl + "/api/v1" + path, {
      method,
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
        ...(method === "GET" ? { "X-Steward-Client": "dashboard" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    if (response.status === 429) {
      await new Promise((r) =>
        setTimeout(
          r,
          Math.min(
            10000,
            Math.max(
              1000,
              Number(response.headers.get("Retry-After") || 1) * 1000,
            ),
          ),
        ),
      );
      continue;
    }
    if (!response.ok)
      throw new Error(
        `Sandbox request ${path}: ${response.status}: ${(await response.text()).slice(0, 400)}`,
      );
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T);
  }
  throw new Error("Sandbox rate limit persisted");
}
const baselineCommit = process.env.STEWARD_BENCHMARK_BASE || "96cabfa";
const temp = await mkdtemp(tmpdir() + "/steward-hall-baseline-");
await writeFile(
  temp + "/hall.ts",
  execFileSync("git", ["show", baselineCommit + ":src/advisors/hall.ts"]),
);
const { estimateHall: oldEstimate } = await import(
  pathToFileURL(temp + "/hall.ts").href
);
const me = await call<MeResponse>("/me");
const output = process.env.STEWARD_BENCHMARK_DIR || "data/hall-benchmark";
await mkdir(output, { recursive: true, mode: 0o700 });
const results = [];
for (const duration of [7200, 1800])
  for (const policy of ["legacy", "candidate"] as const) {
    const world = await call<WorldSummary>("/sandboxes", {
      name: `hall-${policy}-${duration}`,
      seed: 73421,
      durationTicks: duration,
      clock: "lockstep",
      paused: true,
      houseBots: { warden: 0, reaver: 0, sovereign: 0 },
    });
    if (world.kind !== "sandbox" || world.ownerId !== me.account.id)
      throw new Error("Refusing experiment outside our own sandbox");
    const prefix = `/worlds/${encodeURIComponent(world.id)}`;
    const trace: unknown[] = [];
    let spent = { timber: 0, stone: 0, iron: 0 };
    let produced = { timber: 0, stone: 0, iron: 0 };
    try {
      let state = await call<StateResponse>(prefix + "/join", {});
      const rules = await call<RulesResponse>(prefix + "/rules");
      while (state.world.tick < duration - 1 && trace.length < 250) {
        const planningState = {
          ...state,
          world: { ...state.world, status: "running" as const },
        };
        const proposals = evaluateEconomy({ state: planningState, rules });
        if (policy === "legacy")
          for (const p of proposals)
            if (p.action.building === "hall") {
              const h = oldEstimate(
                state.villages.find((v) => v.id === p.villageId)!,
                rules,
                planningState.world,
              );
              p.importance = h.importance;
              p.reason = h.reason;
              p.status = h.needed
                ? p.blockers.filter((b) => b !== "NOT_NEEDED").length
                  ? "waiting"
                  : "ready"
                : "not-needed";
              p.blockers = p.blockers.filter((b) => b !== "NOT_NEEDED");
              if (!h.needed) p.blockers.push("NOT_NEEDED");
            }
        const selection = selectProposal(proposals),
          v = state.villages[0];
        const hall = proposals.find((p) => p.action.building === "hall");
        let target = Math.min(duration, state.world.tick + 30);
        if (selection.selected) {
          const p = selection.selected;
          const response = await call<ActionsResponse>(prefix + "/actions", {
            actions: [{ ...p.action, clientId: `hall-bench-${randomUUID()}` }],
            returnState: true,
          });
          if (!response.results[0]?.ok)
            throw new Error(
              `Sandbox action rejected: ${JSON.stringify(response.results)}`,
            );
          for (const r of ["timber", "stone", "iron"] as const)
            spent[r] += p.requirements[r];
          state = response.state!;
          target = state.villages[0].buildQueue[0].endTick;
          trace.push({
            tick: state.world.tick,
            building: p.action.building,
            level: p.targetLevel,
            hallReason: hall?.reason,
          });
        } else if (v.buildQueue.length) target = v.buildQueue[0].endTick;
        else {
          const resourceTick = proposals.find(
            (p) => p.id === selection.reservations[0]?.proposalId,
          )?.affordableAtTick;
          if (resourceTick) target = resourceTick;
          trace.push({
            tick: state.world.tick,
            wait: selection.reason,
            hallReason: hall?.reason,
          });
        }
        target = Math.min(duration, Math.max(state.world.tick + 1, target));
        const delta = Math.min(3600, target - state.world.tick);
        for (const r of ["timber", "stone", "iron"] as const)
          produced[r] +=
            (delta * state.villages[0].productionPerTickMilli[r]) / 1000;
        await call(`/sandboxes/${world.id}/control`, {
          action: "step",
          ticks: delta,
        });
        const startTick = state.world.tick;
        for (let poll = 0; poll < 100; poll++) {
          state = await call<StateResponse>(prefix + "/state");
          if (
            state.world.tick >= startTick + delta ||
            state.world.status === "ended"
          )
            break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (
          state.world.tick < startTick + delta &&
          state.world.status !== "ended"
        )
          throw new Error("Sandbox step timed out");
      }
      const v = state.villages[0];
      const result = {
        policy,
        baselineCommit,
        decisionClock:
          "running decisions; private lockstep clock stepped between completions",
        duration,
        seed: 73421,
        worldId: world.id,
        tick: state.world.tick,
        buildings: v.buildings,
        production: v.production,
        resources: v.resources,
        points: v.points,
        spent,
        estimatedGrossProduction: produced,
        actions: trace.length,
        trace,
      };
      results.push(result);
      await writeFile(
        `${output}/${policy}-${duration}.json`,
        JSON.stringify(
          {
            result,
            rules,
            finalState: state,
            log: await call(`/sandboxes/${world.id}/log`),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      console.log(JSON.stringify({ ...result, trace: undefined }));
    } finally {
      await call(`/sandboxes/${world.id}`, undefined, "DELETE");
    }
  }
await writeFile(
  output + "/comparison.json",
  JSON.stringify(
    results.map(({ trace, ...r }) => r),
    null,
    2,
  ),
  { mode: 0o600 },
);
