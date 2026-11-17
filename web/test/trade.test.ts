import assert from "node:assert/strict";
import { test } from "node:test";
import { clampCargo, resourceLimit, supplyTargets } from "../src/ui/panel/trade";

const available = { timber: 500, stone: 300, iron: 200 };
test("resource cargo respects stock and shared merchant capacity", () => {
  assert.deepEqual(clampCargo({ timber: 100, iron: 50 }, available, 1000), { timber: 100, stone: 0, iron: 50 });
  assert.deepEqual(clampCargo({ timber: 900, stone: 900, iron: 900 }, available, 650), { timber: 500, stone: 150, iron: 0 });
  assert.equal(resourceLimit("iron", { timber: 400, stone: 150, iron: 0 }, available, 650), 100);
  assert.deepEqual(clampCargo({}, available, 0), { timber: 0, stone: 0, iron: 0 });
  assert.deepEqual(clampCargo({ timber: NaN, stone: -5, iron: Infinity }, available, 100), { timber: 0, stone: 0, iron: 0 });
  assert.deepEqual(clampCargo({ timber: 4.9 }, available, 100), { timber: 4, stone: 0, iron: 0 });
});

test("supply targets exclude the source and sort owned villages by distance", () => {
  const source = { id: "home", name: "Home", x: 0, y: 0 };
  const far = { id: "far", name: "Far", x: 9, y: 0 };
  const near = { id: "near", name: "Near", x: 2, y: 0 };
  assert.deepEqual(supplyTargets(source, [far, source, near]), [near, far]);
  assert.deepEqual(supplyTargets(source, [source]), []);
});
