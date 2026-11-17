import type { Action, TrainBatch } from "../../contract";
import { TrainingQueueRow } from "../panel/QueueRow";

export function TownTrainingQueue({ batches, villageId, blocked, act, tick, speed, paused }: {
  batches: TrainBatch[]; villageId: string; blocked: boolean; act(action: Action): Promise<void>;
  tick: number; speed: number; paused: boolean;
}) {
  if (!batches.length) return <p className="muted small">No troops in training here.</p>;
  return <ol className="queue town-training-batches">
    {batches.map((batch) => <TrainingQueueRow key={batch.id} batch={batch} tick={tick} speed={speed} paused={paused} disabled={blocked}
      cancel={() => void act({ type: "cancel_train", village: villageId, batch: batch.id })} />)}
  </ol>;
}
