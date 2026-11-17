import assert from "node:assert/strict";
import { test } from "node:test";
import type { TrainBatch, VillageState } from "../src/contract";
import { unitInventory, validTrainCount } from "../src/ui/panel/holdings";

function batch(unit: TrainBatch["unit"], remaining: number): TrainBatch {
  return { id: `${unit}-${remaining}`, unit, remaining, count: remaining + 3, costEach: { timber: 1, stone: 1, iron: 1 }, nextTick: null, endTick: 100 };
}

test("Holdings totals use authoritative away counts and remaining training across queues", () => {
  const village: Pick<VillageState, "units" | "training"> = {
    units: { home: { pikeman: 10 }, away: { pikeman: 7 } },
    training: { barracks: [batch("pikeman", 4), batch("pikeman", 2)], stable: [batch("scout", 5)], workshop: [], court: [] },
  };
  assert.deepEqual(unitInventory(village, "pikeman"), { home: 10, away: 7, training: 6, total: 23 });
  assert.deepEqual(unitInventory(village, "scout"), { home: 0, away: 0, training: 5, total: 5 });
  assert.deepEqual(unitInventory(village, "envoy"), { home: 0, away: 0, training: 0, total: 0 });
});

test("Holdings training count rejects empty, fractional, invalid and unaffordable counts", () => {
  assert.equal(validTrainCount(1, 5), true);
  assert.equal(validTrainCount(5, 5), true);
  for (const count of [0, -1, 6, 1.5, NaN, Infinity]) assert.equal(validTrainCount(count, 5), false);
  assert.equal(validTrainCount(1, 0), false);
});
