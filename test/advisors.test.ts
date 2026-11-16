import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateEconomy } from "../src/advisors/economic.js";
import { selectProposal } from "../src/advisors/president.js";
import { context } from "./control-fixtures.js";

test("economic scores are deterministic, explain production bottlenecks and cover exactly seven buildings", () => {
  const c = context();
  c.state.villages[0].production.iron = 20;
  c.state.villages[0].productionPerTickMilli.iron = 333;
  c.state.villages[0].resourcesMilli.iron = 0;
  const first = evaluateEconomy(c);
  assert.deepEqual(first, evaluateEconomy(c));
  assert.equal(first.length, 7);
  assert.ok(
    first.every(
      (p) => p.importance >= 0 && p.importance <= 100 && p.reason.length > 30,
    ),
  );
  assert.ok(
    first.find((p) => p.action.building === "mine")!.importance >
      first.find((p) => p.action.building === "lumberyard")!.importance,
  );
  assert.match(
    first.find((p) => p.action.building === "mine")!.reason,
    /3 minutes/,
  );
});
test("population exhaustion and storage limits outrank discretionary growth", () => {
  const c = context();
  const v = c.state.villages[0];
  v.population.used = v.population.max;
  let ranked = evaluateEconomy(c);
  assert.equal(ranked[0].action.building, "farm");
  assert.equal(ranked[0].importance, 100);
  v.population.used = 30;
  v.resourcesMilli.timber = v.storage * 1000;
  ranked = evaluateEconomy(c);
  assert.equal(ranked[0].action.building, "storehouse");
  assert.ok(ranked[0].importance >= 90);
});
test("queued builds, standing build orders and Council cooldown are explicit blockers", () => {
  const c = context();
  const v = c.state.villages[0];
  v.buildQueue = [
    {
      id: "q1",
      building: "hall",
      level: 2,
      startTick: 100,
      endTick: 125,
      cost: { timber: 1, stone: 1, iron: 1 },
    },
  ];
  let proposals = evaluateEconomy(c);
  assert.equal(
    proposals.find((p) => p.action.building === "hall")!.status,
    "queued",
  );
  assert.equal(selectProposal(proposals).selected, null);
  v.buildQueue = [];
  v.orders.build = [{ building: "farm", toLevel: 3 }];
  assert.equal(selectProposal(evaluateEconomy(c)).selected, null);
  v.orders.build = [];
  c.state.player.nextActTick = 105;
  assert.ok(
    evaluateEconomy(c).every((p) => p.blockers.includes("COUNCIL_COOLDOWN")),
  );
});
test("President saves for important affordable-in-principle work instead of spending on lower priorities", () => {
  const proposals = evaluateEconomy(context());
  const high = {
    ...proposals[0],
    importance: 95,
    status: "waiting" as const,
    blockers: ["INSUFFICIENT_RESOURCES"],
  };
  const low = {
    ...proposals[1],
    importance: 50,
    status: "ready" as const,
    blockers: [],
  };
  const selected = selectProposal([low, high]);
  assert.equal(selected.selected, null);
  assert.equal(selected.reservations[0].proposalId, high.id);
  assert.equal(
    selectProposal([{ ...high, importance: 60 }, low]).selected,
    null,
  );
  assert.equal(
    selectProposal([{ ...high, blockers: ["REQUIREMENTS_NOT_MET"] }, low])
      .selected,
    null,
  );
  const independent = { ...low, villageId: "v2", id: "v2-low" };
  assert.equal(
    selectProposal([high, low, independent]).selected!.id,
    independent.id,
  );
});
test("maximum levels are omitted and mismatched live rule versions stop evaluation", () => {
  const c = context();
  c.state.villages[0].buildings.cellar = 10;
  assert.ok(!evaluateEconomy(c).some((p) => p.action.building === "cellar"));
  c.rules.version++;
  assert.throws(() => evaluateEconomy(c), /rules/);
});

const proposal = (c: ReturnType<typeof context>, building: string) =>
  evaluateEconomy(c).find((p) => p.action.building === building)!;
test("farm only expands below max(50, 20% capacity), including equality boundaries", () => {
  const c = context(),
    v = c.state.villages[0];
  for (const [max, used, needed] of [
    [200, 150, false],
    [200, 151, true],
    [1000, 800, false],
    [1000, 801, true],
  ]) {
    v.population = { max: max as number, used: used as number };
    assert.equal(proposal(c, "farm").status !== "not-needed", needed);
  }
});
test("storehouse requires stock plus five-minute production to exceed capacity", () => {
  const c = context(),
    v = c.state.villages[0];
  v.productionPerTickMilli = { timber: 1000, stone: 1000, iron: 1000 };
  v.resourcesMilli = { timber: (v.storage - 300) * 1000, stone: 0, iron: 0 };
  assert.equal(proposal(c, "storehouse").status, "not-needed");
  v.resourcesMilli.timber++;
  assert.notEqual(proposal(c, "storehouse").status, "not-needed");
});
test("cellar protects one minute of the fastest production, independent of stock", () => {
  const c = context(),
    v = c.state.villages[0];
  v.buildings.lumberyard=v.buildings.quarry=v.buildings.mine=5;
  v.productionPerTickMilli = { timber: 1000, stone: 2000, iron: 3000 };
  v.hidden = 180;
  assert.equal(proposal(c, "cellar").status, "not-needed");
  v.hidden = 179;
  assert.notEqual(proposal(c, "cellar").status, "not-needed");
});
test("producer priority weights projected stock by the next producer upgrade basket", () => {
  const c = context(),
    v = c.state.villages[0];
  v.productionPerTickMilli = { timber: 1000, stone: 0, iron: 0 };
  v.resourcesMilli = { timber: 0, stone: 100000, iron: 100000 };
  for (const o of v.options.build.filter((o) =>
    ["lumberyard", "quarry", "mine"].includes(o.building),
  ))
    o.cost = { timber: 100, stone: 10, iron: 10 };
  assert.ok(
    proposal(c, "lumberyard").importance > proposal(c, "quarry").importance,
  );
  // Higher projected timber supply can still be scarcer relative to upgrade demand.
  v.resourcesMilli.timber = 1000000;
  v.resourcesMilli.stone = 90000;
  assert.ok(
    proposal(c, "quarry").importance > proposal(c, "lumberyard").importance,
  );
});
test("Bramwell regression: abundant farm and storage never become cheap filler upgrades", () => {
  const c = context(),
    v = c.state.villages[0];
  v.population = { used: 279, max: 2029 };
  v.storage = 71072;
  v.hidden = 100000;
  v.resources = { timber: 7000, stone: 7000, iron: 7000 };
  v.resourcesMilli = { timber: 7000000, stone: 7000000, iron: 7000000 };
  for (const o of v.options.build.filter((o) =>
    ["lumberyard", "quarry", "mine"].includes(o.building),
  )) {
    o.cost = { timber: 9000, stone: 9000, iron: 9000 };
    o.ok = false;
    o.blockers = ["INSUFFICIENT_RESOURCES"];
  }
  assert.equal(proposal(c, "farm").status, "not-needed");
  assert.equal(proposal(c, "storehouse").status, "not-needed");
  assert.equal(proposal(c, "cellar").status, "not-needed");
  const ps = evaluateEconomy(c).filter((p) => p.action.building !== "hall");
  for (let i = 0; i < 10; i++) {
    assert.equal(selectProposal(ps).selected, null);
    assert.equal(selectProposal(ps).reservations.length, 0);
    assert.ok(
      ps
        .filter((p) =>
          ["lumberyard", "quarry", "mine"].includes(p.action.building),
        )
        .every((p) => p.status === "not-needed"),
    );
  }
});

test("President skips storage for post-round production but preserves real overflow and equality", () => {
  const c = context(), v = c.state.villages[0];
  c.state.world.endsAtTick = c.state.world.tick + 100;
  v.hidden = 10000;
  v.productionPerTickMilli = { timber: 1000, stone: 1000, iron: 1000 };
  v.resourcesMilli = { timber: (v.storage - 100) * 1000, stone: 1000000, iron: 1000000 };
  assert.equal(proposal(c, "storehouse").status, "not-needed", "exact capacity at round end fits");
  assert.equal(selectProposal(evaluateEconomy(c)).selected, null, "no late capacity reservation or unprofitable producer");
  v.resourcesMilli.timber++;
  assert.equal(selectProposal(evaluateEconomy(c)).selected?.action.building, "storehouse", "one milli of actual overflow still needs capacity");
  c.state.world.endsAtTick += 300;
  v.resourcesMilli.timber = (v.storage - 300) * 1000;
  assert.equal(proposal(c, "storehouse").status, "not-needed", "normal horizon remains capped at 300 ticks");
});

test("production-first opening outranks Cellar, Hall and military until each producer reaches five", () => {
  const c = context(), v = c.state.villages[0];
  v.buildings.lumberyard = 5; v.buildings.quarry = 5; v.buildings.mine = 1;
  const ps = evaluateEconomy(c), p = ps.find(p => p.action.building === "mine")!;
  assert.ok(p.importance > ps.find(p => p.action.building === "cellar")!.importance);
  assert.equal(selectProposal(ps).selected?.id, p.id);
  assert.match(p.reason, /Production-first opening/);
  v.population.used = v.population.max;
  assert.equal(selectProposal(evaluateEconomy(c)).selected?.action.building, "farm");
  v.population.used = 30; v.buildings.mine = 5;
  assert.ok(evaluateEconomy(c).filter(p => ["mine", "lumberyard", "quarry"].includes(p.action.building)).every(p => p.importance < 80));
});
