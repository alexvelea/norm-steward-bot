import assert from "node:assert/strict";
import { test } from "node:test";
import type { BuildingId } from "../src/contract";
import { BUILDING_IDS } from "../src/contract";
import { blockerMessage, buildingNeeds, unitNeeds } from "../src/ui/panel/requirements";

const levels = Object.fromEntries(BUILDING_IDS.map((id) => [id, 0])) as Record<BuildingId, number>;
test("missing prerequisites use rule levels and omit satisfied requirements", () => {
  assert.equal(unitNeeds("trebuchet", levels), "Needs Siege Workshop 2 · Smithy 5");
  assert.equal(unitNeeds("trebuchet", { ...levels, workshop: 2 }), "Needs Smithy 5");
  assert.equal(unitNeeds("trebuchet", { ...levels, workshop: 2, smithy: 5 }), "");
  assert.equal(buildingNeeds("lumberyard", levels), "");
  assert.equal(buildingNeeds("market", levels), "Needs Great Hall 3 · Storehouse 2");
  assert.equal(blockerMessage(["REQUIREMENTS_NOT_MET", "QUEUE_FULL"], "Needs Smithy 5"), "Needs Smithy 5 · queue full");
  assert.equal(blockerMessage(["REQUIREMENTS_NOT_MET"], ""), "requirements not met");
  assert.equal(blockerMessage([], ""), "");
});
