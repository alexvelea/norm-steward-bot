import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateHall } from "../src/advisors/hall.js";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { context } from "./control-fixtures.js";

function scenario() {
  const c = structuredClone(context()),
    v = c.state.villages[0];
  v.storage = v.hidden = v.population.max = 1_000_000;
  v.resourcesMilli = { timber: 1_000_000, stone: 1_000_000, iron: 1_000_000 };
  v.resources = { timber: 1000, stone: 1000, iron: 1000 };
  v.productionPerTickMilli = { timber: 1000, stone: 1000, iron: 1000 };
  for (const p of c.rules.tables.production) p.perTickMilli = 1000;
  for (const id of ["lumberyard", "quarry", "mine"] as const) {
    for (const row of c.rules.tables.buildings[id]) {
      row.cost = { timber: 100, stone: 100, iron: 100 };
      row.ticksByHall[1] = 100;
      row.ticksByHall[2] = 80;
      row.pop = 1;
    }
    Object.assign(
      v.options.build.find((o) => o.building === id)!,
      { cost: { timber: 100, stone: 100, iron: 100 }, ticks: 100, pop: 0 },
    );
  }
  Object.assign(
    v.options.build.find((o) => o.building === "hall")!,
    { cost: { timber: 100, stone: 100, iron: 100 }, ticks: 50, pop: 0 },
  );
  return { c, v, estimate: () => estimateHall(v, c.rules, c.state.world) };
}
test("Hall first repays its own construction on a busy affordable useful sequence", () => {
  const { c, estimate } = scenario();
  const h = estimate();
  assert.equal(h.sequence.length, 8);
  assert.equal(h.baselineTicks, 800);
  assert.equal(h.hallFirstTicks, 690);
  assert.equal(h.savingTicks, 110);
  assert.equal(h.needed, true);
  assert.ok(h.importance > 60 && h.importance < 80);
  assert.match(h.reason, /including its 50-tick build and all resource costs/);
  assert.deepEqual(estimate(), h);
  const proposal = evaluateEconomy(c).find(
    (p) => p.action.building === "hall",
  )!;
  assert.equal(proposal.status, "ready");
  assert.equal(proposal.reason, h.reason);
});
test("Hall resource cost and wait reverse a superficially profitable speed upgrade", () => {
  const { v, estimate } = scenario();
  v.options.build.find((o) => o.building === "hall")!.cost = {
    timber: 3000,
    stone: 3000,
    iron: 3000,
  };
  const h = estimate();
  assert.equal(h.needed, false);
  assert.equal(h.hallFirstWaitTicks, 2190);
  assert.equal(h.hallFirstTicks, 2880);
  assert.equal(h.savingTicks, -2080);
});
test("resource-starved plans avoid hypothetical savings from unaffordable distant upgrades", () => {
  const { v, estimate } = scenario();
  v.resourcesMilli = { timber: 0, stone: 0, iron: 0 };
  v.productionPerTickMilli = { timber: 1, stone: 1, iron: 1 };
  const h = estimate();
  assert.equal(h.needed, false);
  assert.equal(h.sequence.length, 0);
  assert.match(h.reason, /No feasible useful upgrade sequence/);
});
test("Hall comparison respects individual resource bottlenecks rather than total income", () => {
  const { v, estimate } = scenario();
  v.productionPerTickMilli.iron = 1;
  v.options.build.find((o) => o.building === "hall")!.cost.iron = 1010;
  assert.equal(estimate().needed, false);
  assert.equal(estimate().hallFirstTicks, null);
});
test("storage and population prevent impossible Hall spending", () => {
  const { v, estimate } = scenario();
  v.options.build.find((o) => o.building === "hall")!.cost.timber = 1_000_001;
  assert.equal(estimate().hallFirstTicks, null);
  v.options.build.find((o) => o.building === "hall")!.cost.timber = 100;
  v.options.build.find((o) => o.building === "hall")!.pop = 1_000_000;
  assert.equal(estimate().hallFirstTicks, null);
});
test("short remaining round time and maxed producers prevent imaginary payback", () => {
  const { c, v, estimate } = scenario();
  c.state.world.endsAtTick = c.state.world.tick + 120;
  assert.equal(estimate().needed, false);
  c.state.world.endsAtTick = c.state.world.tick + 10000;
  for (const id of ["lumberyard", "quarry", "mine"] as const)
    v.buildings[id] = 30;
  assert.equal(estimate().sequence.length, 0);
  assert.equal(estimate().needed, false);
});
test("existing queues and standing orders defer Hall planning", () => {
  const { v, estimate } = scenario();
  v.orders.build = [{ building: "farm", toLevel: 3 }];
  assert.equal(estimate().needed, false);
  v.orders.build = [];
  v.buildQueue = [
    {
      id: "manual",
      building: "quarry",
      level: 2,
      cost: { timber: 1, stone: 1, iron: 1 },
      startTick: 100,
      endTick: 200,
    },
  ];
  assert.equal(estimate().sequence.length, 0);
});
test("planned sequence includes needed capacity and does not presume fixed producer counts", () => {
  const { v, estimate } = scenario();
  v.population = { used: 151, max: 200 };
  const h = estimate();
  assert.equal(h.sequence[0].building, "farm");
  assert.ok(h.sequence.some((s) => s.building === "lumberyard"));
});
test("a small apparent gain must exceed the uncertainty margin", () => {
  const { v, estimate } = scenario();
  v.options.build.find((o) => o.building === "hall")!.ticks = 155;
  const h = estimate();
  assert.equal(h.savingTicks, 5);
  assert.equal(h.needed, false);
});

test("Council action cadence removes speed benefits when construction already fits between actions", () => {
  const { c, estimate } = scenario();
  c.state.world.actIntervalTicks = 200;
  const h = estimate();
  assert.equal(h.needed, false);
  assert.ok(h.hallFirstTicks! > h.baselineTicks);
});
