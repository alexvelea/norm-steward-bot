// Army: the village's troops at home and away, support in and out, and every command and merchant
// train on the road with its countdown. Incoming attacks show only what the API reveals: origin,
// arrival, and the watchtower's sighting once there is one.
import type { IncomingCommand, OutgoingCommand, StateResponse, SupportStack, Trade, UnitCounts } from "../../contract";
import { UNITS, UNIT_IDS } from "../../contract";
import { formatCompact, formatResources, formatUnits } from "../../lib/format";
import { isFlowing, paceOf, useLiveTick } from "../../world/clock";
import { Countdown, Empty, Section } from "../common";
import { selectClock, selectState, useWorld, useWorldContext } from "../worldContext";
import { VillagePicker } from "./VillagePicker";

export function ArmyTab({ villageId, onVillage }: { villageId: string; onVillage: (id: string) => void }) {
  const state = useWorld(selectState);
  const clock = useWorld(selectClock);
  const tick = useLiveTick(clock);
  const village = state?.villages.find((v) => v.id === villageId);
  if (!state || !village) return <Empty>No village to show.</Empty>;
  const timing = { tick, speed: paceOf(clock), paused: !isFlowing(clock) };

  return (
    <div className="tab-page">
      <VillagePicker state={state} value={villageId} onChange={onVillage} />
      <Section title={`Troops of ${village.name}`}>
        <UnitTable home={village.units.home} away={village.units.away} />
      </Section>
      <Section title="Support here">
        <Stacks stacks={village.supportHere} side="home" />
      </Section>
      <Section title="Support abroad">
        <Stacks stacks={village.supportAbroad} side="at" />
      </Section>
      <Incoming state={state} {...timing} />
      <Outgoing state={state} {...timing} />
      <Trades state={state} {...timing} />
    </div>
  );
}

function UnitTable({ home, away }: { home: UnitCounts; away: UnitCounts }) {
  const units = UNIT_IDS.filter((u) => (home[u] ?? 0) > 0 || (away[u] ?? 0) > 0);
  if (units.length === 0) return <Empty>No troops yet.</Empty>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Unit</th>
          <th className="num">Home</th>
          <th className="num">Away</th>
        </tr>
      </thead>
      <tbody>
        {units.map((u) => (
          <tr key={u}>
            <td>
              <span className={`unit-dot type-${UNITS[u].attackType}`} />
              {UNITS[u].name}
            </td>
            <td className="num mono">{formatCompact(home[u] ?? 0)}</td>
            <td className="num mono muted">{formatCompact(away[u] ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Stacks({ stacks, side }: { stacks: SupportStack[]; side: "home" | "at" }) {
  if (stacks.length === 0) return <Empty>None.</Empty>;
  return (
    <ul className="rows">
      {stacks.map((s) => {
        const place = side === "home" ? s.home : s.at;
        return (
          <li key={`${s.home.id}>${s.at.id}`} className="row-item">
            <div className="row-main">
              <span>{side === "home" ? "From " : "In "}</span>
              <VillageName village={place} />
              {place.ownerName && <span className="muted"> · {place.ownerName}</span>}
            </div>
            <div className="row-sub">{formatUnits(s.units)}</div>
          </li>
        );
      })}
    </ul>
  );
}

function VillageName({ village }: { village: { id: string; name: string; x: number; y: number } }) {
  const { map, select } = useWorldContext();
  return (
    <button
      className="linkish"
      onClick={() => {
        select(village.id);
        map.focus(village.x, village.y, null);
      }}
    >
      {village.name}
    </button>
  );
}

interface Timing {
  tick: number;
  speed: number;
  paused: boolean;
}

function Incoming({ state, tick, speed, paused }: { state: StateResponse } & Timing) {
  const list = [...state.commands.incoming].sort((a, b) => a.arrivalTick - b.arrivalTick || a.seq - b.seq);
  return (
    <Section title="Incoming" aside={list.length > 0 && <span className="badge badge-ember">{list.length}</span>}>
      {list.length === 0 && <Empty>Nothing is coming at you.</Empty>}
      <ul className="rows">
        {list.map((c) => (
          <IncomingRow key={c.id} command={c} tick={tick} speed={speed} paused={paused} />
        ))}
      </ul>
    </Section>
  );
}

function IncomingRow({ command: c, tick, speed, paused }: { command: IncomingCommand } & Timing) {
  const attack = c.kind === "attack";
  return (
    <li className={`row-item move move-${attack ? "attack" : "support"} is-incoming`}>
      <div className="row-main">
        <span className="move-kind">{attack ? "Attack" : "Support"}</span>
        <VillageName village={c.from} />
        <span className="muted"> → </span>
        <VillageName village={c.to} />
        <Countdown until={c.arrivalTick} tick={tick} speed={speed} paused={paused} />
      </div>
      <div className="row-sub">
        {c.from.ownerName ?? "unknown"}
        {attack &&
          (c.sighted ? (
            <span className="sighted">
              {" "}
              · sighted: {c.sighted.size}
              {c.sighted.envoy ? ", an envoy marches with it" : ""}
            </span>
          ) : (
            <span className="muted"> · not yet sighted</span>
          ))}
        {!attack && c.units && <span> · {formatUnits(c.units)}</span>}
      </div>
    </li>
  );
}

function Outgoing({ state, tick, speed, paused }: { state: StateResponse } & Timing) {
  const list = [...state.commands.outgoing].sort((a, b) => a.arrivalTick - b.arrivalTick || a.seq - b.seq);
  return (
    <Section title="Commands" aside={<span className="muted small">{list.length} on the road</span>}>
      {list.length === 0 && <Empty>No commands out.</Empty>}
      <ul className="rows">
        {list.map((c) => (
          <OutgoingRow key={c.id} command={c} tick={tick} speed={speed} paused={paused} />
        ))}
      </ul>
    </Section>
  );
}

function OutgoingRow({ command: c, tick, speed, paused }: { command: OutgoingCommand } & Timing) {
  const cancellable = c.cancellableUntilTick !== null && c.cancellableUntilTick >= tick;
  return (
    <li className={`row-item move move-${c.kind}${c.returning ? " is-returning" : ""}`}>
      <div className="row-main">
        <span className="move-kind">{c.returning ? "Returning" : c.kind === "attack" ? "Attack" : "Support"}</span>
        <VillageName village={c.returning ? c.to : c.from} />
        <span className="muted"> → </span>
        <VillageName village={c.returning ? c.from : c.to} />
        <Countdown until={c.arrivalTick} tick={tick} speed={speed} paused={paused} />
      </div>
      <div className="row-sub">
        {formatUnits(c.units)}
        {c.aim && !c.returning && <span className="muted"> · aims at the {c.aim}</span>}
        {c.loot && <span className="amber"> · carrying {formatResources(c.loot)}</span>}
        {c.raidOrder !== null && <span className="muted"> · raid order {c.raidOrder + 1}</span>}
        {cancellable && <span className="muted"> · can be called back</span>}
      </div>
    </li>
  );
}

function Trades({ state, tick, speed, paused }: { state: StateResponse } & Timing) {
  const list: { trade: Trade; incoming: boolean }[] = [
    ...state.trades.outgoing.map((trade) => ({ trade, incoming: false })),
    ...state.trades.incoming.map((trade) => ({ trade, incoming: true })),
  ].sort((a, b) => a.trade.arrivalTick - b.trade.arrivalTick);
  if (list.length === 0) return null;
  return (
    <Section title="Merchants">
      <ul className="rows">
        {list.map(({ trade: t, incoming }) => (
          <li key={t.id} className={`row-item move move-trade${t.returning ? " is-returning" : ""}`}>
            <div className="row-main">
              <span className="move-kind">{t.returning ? "Coming home" : incoming ? "Arriving" : "Trade"}</span>
              <VillageName village={t.returning ? t.to : t.from} />
              <span className="muted"> → </span>
              <VillageName village={t.returning ? t.from : t.to} />
              <Countdown until={t.arrivalTick} tick={tick} speed={speed} paused={paused} />
            </div>
            <div className="row-sub">
              {t.returning ? "empty-handed" : formatResources(t.resources)} · {t.merchants} {t.merchants === 1 ? "merchant" : "merchants"}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
