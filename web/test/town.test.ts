import assert from "node:assert/strict";
import { test } from "node:test";
import { TABLES } from "../../src/rules/tables";
import { BUILDINGS, COMBAT, MARKET } from "../src/contract";
import type { BuildQueueItem } from "../src/contract";
import { buildingBenefit, buildingImprovement, buildingUnlocks, buildProgress } from "../src/ui/town/buildings";

test("town benefits use published level tables for economy, storage and training", () => {
  assert.match(buildingBenefit("lumberyard", 0, TABLES), /20 timber \/ min/);
  assert.match(buildingBenefit("lumberyard", 2, TABLES), /130\.5 timber \/ min/);
  assert.match(buildingBenefit("farm", 2, TABLES), new RegExp(String(TABLES.farm[2])));
  assert.match(buildingBenefit("storehouse", 2, TABLES), /4,392 storage per resource/);
  assert.match(buildingBenefit("cellar", 1, TABLES), /450 hidden per resource/);
  assert.match(buildingBenefit("watchtower", 1, TABLES), /4\.5 fields/);
  assert.match(buildingBenefit("market", 1, TABLES), new RegExp(`${TABLES.merchants[1]} merchants`));
  assert.match(buildingBenefit("market", 1, TABLES), new RegExp((TABLES.merchants[1] * MARKET.merchantCarry).toLocaleString("en-US")));
  assert.match(buildingBenefit("barracks", 2, TABLES), /training speed/);
  assert.match(buildingBenefit("wall", 1, TABLES), new RegExp(`\\+${COMBAT.wallFlat} base`));
  assert.equal(buildingBenefit("court", 0, TABLES), "Not built");
  assert.equal(buildingBenefit("court", 1, TABLES), "Enables envoy training");
});

test("town unlocks describe newly met prerequisites rather than claiming every requirement is satisfied", () => {
  assert.ok(buildingUnlocks("hall", 2, 3).includes(BUILDINGS.barracks.name));
  assert.ok(!buildingUnlocks("hall", 3, 4).includes(BUILDINGS.barracks.name));
  assert.ok(buildingUnlocks("smithy", 0, 1).includes("Shieldman"));
  assert.ok(buildingUnlocks("barracks", 0, 1).includes("Pikeman"));
});

test("construction progress advances only active work and is clamped at both ends", () => {
  const item: BuildQueueItem = { id: "q1", building: "hall", level: 2, cost: { timber: 1, stone: 1, iron: 1 }, startTick: 10, endTick: 30 };
  assert.equal(buildProgress(item, 0), 0);
  assert.equal(buildProgress(item, 20), 0.5);
  assert.equal(buildProgress(item, 40), 1);
  assert.equal(buildProgress({ ...item, startTick: null }, 20), 0);
});


test("upgrade improvements compare adjacent levels, including hall time reductions rather than percentage points", () => {
  assert.equal(buildingImprovement("hall", 8, 9, TABLES), "4.8% shorter construction times");
  assert.equal(buildingImprovement("hall", 1, 2, TABLES), "4.8% shorter construction times");
  assert.match(buildingImprovement("lumberyard", 1, 2, TABLES), /\+18\.5 timber \/ min \(\+16\.5%\)/);
  assert.equal(buildingImprovement("farm", 1, 2, TABLES), "+36 population capacity");
  assert.equal(buildingImprovement("storehouse", 1, 2, TABLES), "+792 storage per resource");
  assert.equal(buildingImprovement("barracks", 1, 2, TABLES), "6% shorter training times");
  assert.match(buildingImprovement("barracks", 0, 1, TABLES), /Unlocks/);
  assert.match(buildingImprovement("smithy", 0, 1, TABLES), /Shieldman/);
  assert.match(buildingImprovement("smithy", 1, 2, TABLES), /Raider/);
  assert.match(buildingImprovement("smithy", 2, 3, TABLES), /Lancer/);
  for (const id of Object.keys(BUILDINGS) as (keyof typeof BUILDINGS)[]) {
    assert.ok(buildingImprovement(id, 0, 1, TABLES).length > 0, id);
  }
});
