import { TABLES } from "../src/rules/tables.js";
import * as rules from "../src/rules/config.js";
import type { RulesResponse, StateResponse, VillageState } from "../src/shared/api.js";
export function context() {
  const buildings = Object.fromEntries(
    rules.BUILDING_IDS.map((b) => [
      b,
      ["hall", "farm", "storehouse", "lumberyard", "quarry", "mine"].includes(b) ? 1 : 0,
    ]),
  ) as VillageState["buildings"];
  const village: VillageState = {
    id: "v1",
    name: "Test Holding",
    x: 1,
    y: 1,
    points: 39,
    loyalty: 100,
    resources: { timber: 1000, stone: 1000, iron: 1000 },
    resourcesMilli: { timber: 1000000, stone: 1000000, iron: 1000000 },
    storage: 3600,
    hidden: 0,
    production: { timber: 112, stone: 112, iron: 112 },
    productionPerTickMilli: { timber: 1867, stone: 1867, iron: 1867 },
    population: { used: 30, max: 200 },
    buildings,
    buildQueue: [],
    training: { barracks: [], stable: [], workshop: [], court: [] },
    units: { home: {}, away: {} },
    supportHere: [],
    supportAbroad: [],
    merchants: { total: 0, available: 0 },
    renameReadyTick: null,
    orders: { build: [], train: [], raids: [], paused: [] },
    options: {
      build: rules.BUILDING_IDS.map((building) => {
        const row = TABLES.buildings[building][buildings[building]];
        return {
          building,
          level: row.level,
          cost: row.cost,
          ticks: row.ticksByHall[1],
          pop: 1,
          ok: true,
          blockers: [],
          affordableAtTick: null,
        };
      }),
      train: [],
    },
  };
  const state: StateResponse = {
    world: {
      id: "test",
      name: "Test World",
      kind: "blitz",
      status: "running",
      speed: 1,
      tick: 100,
      round: 1,
      endsAtTick: 10800,
      size: 100,
      players: 1,
      villages: 1,
      rulesVersion: rules.RULES_VERSION,
      epoch: "r1",
      actIntervalTicks: null,
    },
    serverTime: "2026-11-14T00:00:00Z",
    player: {
      id: "p1",
      name: "Tester",
      points: 39,
      score: 39,
      rank: 1,
      renown: { attack: 0, defense: 0 },
      villages: 1,
      protectedUntilTick: null,
      nextActTick: null,
    },
    villages: [village],
    commands: { incoming: [], outgoing: [] },
    trades: { incoming: [], outgoing: [] },
    scheduled: [],
    notes: "",
    unreadReports: 0,
    eventsCursor: 0,
  };
  return {
    state,
    rules: { version: rules.RULES_VERSION, rules: JSON.parse(JSON.stringify(rules)), tables: TABLES } as RulesResponse,
  };
}

/** A post-opening economy for military/executor tests, with matching live option rows. */
export function completeOpening(c: ReturnType<typeof context>) {
  for (const v of c.state.villages) for (const id of ["lumberyard", "quarry", "mine"] as const) {
    v.buildings[id] = 5;
    const row = TABLES.buildings[id][5];
    Object.assign(v.options.build.find(o => o.building === id)!, {level:row.level,cost:row.cost,ticks:row.ticksByHall[v.buildings.hall]});
  }
  return c;
}
export function developedContext() { return completeOpening(context()); }
