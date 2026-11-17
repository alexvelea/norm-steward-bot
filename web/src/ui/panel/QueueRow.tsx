import type { ReactNode } from "react";
import type { TrainBatch } from "../../contract";
import { UNITS } from "../../contract";
import { Countdown, Meter } from "../common";
import { trainingProgress } from "../town/training";

export function QueueRow({ name, progress, endTick, tick, speed, paused, active, tone = "gold", cancelLabel, disabled = false, cancel }: {
  name: ReactNode; progress: number; endTick: number; tick: number; speed: number; paused: boolean;
  active: boolean; tone?: "gold" | "steel"; cancelLabel: string; disabled?: boolean; cancel(): void;
}) {
  return <li className={`queue-row${active ? " is-active" : ""}`}>
    <span className="queue-name">{name}</span>
    <Meter value={progress} max={1} tone={tone} />
    <Countdown until={endTick} tick={tick} speed={speed} paused={paused} />
    <button type="button" className="queue-cancel" aria-label={cancelLabel} disabled={disabled} onClick={cancel}>×</button>
  </li>;
}

export function TrainingQueueRow({ batch, tick, speed, paused, disabled, cancel }: {
  batch: TrainBatch; tick: number; speed: number; paused: boolean; disabled?: boolean; cancel(): void;
}) {
  return <QueueRow name={<>{UNITS[batch.unit].name} · <span className="muted mono">{batch.count - batch.remaining}/{batch.count}</span></>}
    progress={trainingProgress(batch, tick)} endTick={batch.endTick} tick={tick} speed={speed} paused={paused}
    active={batch.nextTick !== null} tone="steel" disabled={disabled} cancelLabel={`Cancel ${UNITS[batch.unit].name} training`} cancel={cancel} />;
}
