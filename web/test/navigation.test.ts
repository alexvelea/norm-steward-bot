import assert from "node:assert/strict";
import { test } from "node:test";
import { linkedTab, TABS } from "../src/ui/panel/navigation";
import { actionFeedback } from "../src/ui/panel/useManualActions";

test("world navigation preserves legacy links and keeps the log secondary", () => {
  assert.equal(linkedTab("command"), "orders");
  assert.equal(linkedTab("holding"), "holding");
  assert.equal(linkedTab("steward"), "steward");
  assert.equal(linkedTab(""), null);
  assert.equal(linkedTab("unknown"), null);
  assert.deepEqual(TABS.map((t) => t.label), ["Holdings", "Army", "Orders", "Reports", "Chronicle", "Standings"]);
});

test("manual actions report accepted, missing and per-action failures", () => {
  assert.deepEqual(actionFeedback({ tick: 10, results: [] }, 1), { failed: true, message: "Missing action results." });
  const accepted = actionFeedback({ tick: 10, results: [{ ok: true, type: "build", data: { cancelled: "q1" } }] }, 1);
  assert.equal(accepted.failed, false);
  assert.match(accepted.message, /accepted at tick 10/);
  const failed = actionFeedback({ tick: 10, results: [{ ok: false, type: "build", error: { code: "NO_RESOURCES", message: "Not enough" } }] }, 1);
  assert.equal(failed.failed, true);
  assert.match(failed.message, /NO_RESOURCES.*Not enough/);
});
