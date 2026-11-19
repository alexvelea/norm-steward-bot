import assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamMessage, UnitCounts, VillageState } from "../src/contract";
import { RULES_VERSION, SANDBOX, UNITS } from "../src/contract";
import { MockWorld } from "../src/dev/mockWorld";

test("synthetic training carries sub-ticks across batches and completes multiple units per tick", () => {
  const messages: StreamMessage[] = [];
  const mock = new MockWorld({ id: "milli", name: "Milli demo", kind: "sandbox", size: 100, players: 10, withYou: true }, message => messages.push(message));
  assert.equal(mock.summary().rulesVersion, RULES_VERSION);
  assert.equal(mock.summary().endsAtTick, SANDBOX.durationDefault);
  type Fixture = { buildings: VillageState["buildings"]; training: VillageState["training"]; home: UnitCounts };
  const village = [...(Reflect.get(mock, "own") as Map<string, Fixture>).values()][0];
  mock.tick = 2400;
  village.buildings.barracks = 25;
  const batch = (id: string, count: number) => ({ id, unit: "pikeman" as const, count,
    remaining: count, costEach: UNITS.pikeman.cost, nextTick: null as number | null, endTick: 0 });
  village.training.barracks = [ { ...batch("first", 1), nextTick: 2400.906, endTick: 2400.906 },
    { ...batch("second", 10), endTick: 2409.966 } ];
  const before = village.home.pikeman ?? 0;
  for (let tick = 0; tick < 10; tick++) mock.advance();
  assert.equal(village.home.pikeman, before + 11);
  assert.equal(village.training.barracks.length, 0);
  mock.advance();
  assert.equal(village.home.pikeman, before + 11);
});
