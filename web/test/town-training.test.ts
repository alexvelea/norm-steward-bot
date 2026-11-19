import assert from "node:assert/strict";
import { test } from "node:test";
import type { TrainBatch } from "../src/contract";
import { trainedUnits, trainingBuilding, trainingProgress } from "../src/ui/town/training";

test("Town training is restricted to the selected building's unit types", () => {
  assert.deepEqual(trainedUnits("stable"), ["scout", "lancer", "knight"]);
  assert.deepEqual(trainedUnits("court"), ["envoy"]);
  assert.deepEqual(trainedUnits("workshop"), ["ram", "trebuchet"]);
  assert.deepEqual(trainedUnits("lumberyard"), []);
  assert.equal(trainingBuilding("barracks"), "barracks");
  assert.equal(trainingBuilding("hall"), null);
});

test("Town training progress handles active, waiting, completed and invalid empty batches", () => {
  const batch: TrainBatch = { id: "b1", unit: "scout", count: 10, remaining: 6, nextTick: 20, endTick: 70, costEach: { timber: 1, stone: 1, iron: 1 } };
  assert.equal(trainingProgress(batch, 15), .45);
  assert.equal(trainingProgress({ ...batch, nextTick: null }, 15), 0);
  assert.equal(trainingProgress({ ...batch, remaining: 0 }, 100), 1);
  assert.equal(trainingProgress({ ...batch, count: 0 }, 15), 0);
});

test("Town training progress preserves sub-tick next and end times", () => {
  const batch: TrainBatch = { id: "milli", unit: "pikeman", count: 10, remaining: 6,
    nextTick: 20.453, endTick: 24.983, costEach: { timber: 45, stone: 35, iron: 15 } };
  assert.ok(Math.abs(trainingProgress(batch, 20) - 0.45) < 1e-12);
  assert.equal(trainingProgress({ ...batch, nextTick: null }, 20), 0);
});
