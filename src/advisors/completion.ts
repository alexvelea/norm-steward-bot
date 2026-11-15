import type {
  BuildOption,
  StateResponse,
  VillageState,
} from "../shared/api.js";
/** Only approve against current live durations with an idle queue; reevaluate after queued Hall changes. */
export function completionWindow(
  state: StateResponse,
  village: VillageState,
  option: BuildOption,
) {
  if (village.buildQueue.length) return null;
  const tick = state.world.tick,
    end = state.world.endsAtTick;
  if (
    !Number.isSafeInteger(tick) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(option.ticks) ||
    option.ticks < 0
  )
    throw new Error("Invalid live construction timing");
  const start = Math.max(
    tick,
    state.player.nextActTick ?? tick,
    option.affordableAtTick ?? tick,
  );
  const completion = start + option.ticks;
  return {
    startTick: start,
    completionTick: completion,
    endsAtTick: end,
    fits: completion <= end,
  };
}
