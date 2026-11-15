import type { StateResponse } from "../shared/api.js";

function tickValue(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

/** Offline observations only. Never selects, blocks or submits a gameplay action. */
export function constructionHorizon(state: StateResponse) {
  const tick = tickValue(state.world.tick, "world tick");
  const end = state.world.endsAtTick === null ? null : tickValue(state.world.endsAtTick, "round end");
  const cooldown = state.player.nextActTick === null ? tick : tickValue(state.player.nextActTick, "Council tick");
  const drain = Math.max(tick, ...state.villages.flatMap(v => v.buildQueue.map(q => tickValue(q.endTick, "queue end"))));
  const relation = (completion: number | null) => end === null || completion === null ? "unknown"
    : completion > end ? "after-round-end" : completion === end ? "at-round-end" : "before-round-end";
  return {
    world: { id: state.world.id, epoch: state.world.epoch, round: state.world.round, tick,
      endsAtTick: end, remainingTicks: end === null ? null : Math.max(0, end - tick) },
    globalConstructionDrainTick: drain,
    limitations: [
      "Snapshot audit only; no action selection or execution approval. Server options and costs are preserved.",
      "Option completion is conditional on current server duration and affordability, after global construction drain and Council cooldown. Queued Hall or producer completions can change these inputs; this is not a guaranteed lower bound. Future spending, polling and standing orders are not projected.",
      "Null affordability with insufficient resources means unknown, not affordable now. Other blockers remain authoritative even when a projection is available.",
      "Completion before round end does not establish feasibility, payback or usefulness. Equality does not establish same-tick ordering or benefit.",
      "Queues belong to this state scope only. Historical activity without epoch and submission state is not attributed to this round.",
    ],
    villages: state.villages.map(v => ({
      villageId: v.id,
      standingBuildOrders: v.orders.build.length,
      queued: v.buildQueue.map(q => ({ ...q, roundRelation: relation(q.endTick),
        ticksBeyondRoundEnd: end === null ? null : Math.max(0, q.endTick - end) })),
      options: v.options.build.map(option => {
        const duration = tickValue(option.ticks, "build duration");
        const affordable = option.affordableAtTick === null ? null : tickValue(option.affordableAtTick, "affordability tick");
        const short = (["timber", "stone", "iron"] as const).some(r => {
          if (!Number.isFinite(option.cost[r]) || option.cost[r] < 0 || !Number.isFinite(v.resources[r]) || v.resources[r] < 0)
            throw new Error("Invalid resource evidence");
          return option.cost[r] > v.resources[r];
        });
        const unknownWait = (short || option.blockers.includes("INSUFFICIENT_RESOURCES")) && affordable === null;
        // MAX_LEVEL options often contain zero-cost, zero-duration placeholders.
        const start = unknownWait || option.blockers.includes("MAX_LEVEL") ? null : Math.max(tick, drain, cooldown, affordable ?? tick);
        const completion = start === null ? null : tickValue(start + duration, "completion tick");
        return { ...option, projectedStartTick: start, projectedCompletionTick: completion,
          roundRelation: relation(completion),
          projectedTicksBeyondRoundEnd: completion === null || end === null ? null : Math.max(0, completion - end) };
      }),
    })),
  };
}
