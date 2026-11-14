// Steward: what the bot is actually doing. Its notes and each village's standing orders on top, then
// the live log of every call it made (REST, MCP and standing orders), newest first.
import { useMemo, useState } from "react";
import type { Action, ActivityEntry, StandingOrders, StateResponse } from "../../contract";
import { BUILDINGS, UNITS } from "../../contract";
import { formatClock, formatResources, formatUnits } from "../../lib/format";
import { isFlowing, paceOf, useLiveTick } from "../../world/clock";
import { Countdown, Empty, Section } from "../common";
import { selectActivity, selectClock, selectMap, selectState, useWorld } from "../worldContext";

type Filter = "all" | "rest" | "mcp" | "orders" | "failed";
const FILTERS: Filter[] = ["all", "rest", "mcp", "orders", "failed"];
const PAGE = 120;

export function StewardTab() {
  const state = useWorld(selectState);
  if (!state) return <Empty>No steward here.</Empty>;
  return (
    <div className="tab-page">
      <Notes text={state.notes} />
      <Orders state={state} />
      <Scheduled state={state} />
      <ActivityLog />
    </div>
  );
}

function Notes({ text }: { text: string }) {
  return (
    <Section title="Notes">
      {text.trim() ? <pre className="notes">{text}</pre> : <Empty>The steward has left no notes.</Empty>}
    </Section>
  );
}

function Orders({ state }: { state: StateResponse }) {
  const map = useWorld(selectMap);
  // Raid targets can be anyone's village, so names come from the public map as well.
  const names = new Map<string, string>();
  for (const v of map.villages.values()) names.set(v.id, v.name);
  for (const v of state.villages) names.set(v.id, v.name);
  const withOrders = state.villages.filter((v) => hasOrders(v.orders));
  return (
    <Section title="Standing orders">
      {withOrders.length === 0 && <Empty>No standing orders: every move is the steward's own.</Empty>}
      {withOrders.map((v) => (
        <details key={v.id} className="orders" open={withOrders.length <= 2}>
          <summary>
            {v.name}
            <span className="muted small">
              {" "}
              {v.orders.build.length} build · {v.orders.train.length} train · {v.orders.raids.length} raids
            </span>
            {v.orders.paused.length > 0 && <span className="badge badge-ember">{v.orders.paused.length} paused</span>}
          </summary>
          <OrderList orders={v.orders} names={names} />
        </details>
      ))}
    </Section>
  );
}

function hasOrders(orders: StandingOrders): boolean {
  return orders.build.length + orders.train.length + orders.raids.length > 0;
}

function OrderList({ orders, names }: { orders: StandingOrders; names: Map<string, string> }) {
  const pausedTag = (kind: "build" | "train" | "raid", index: number) => {
    const p = orders.paused.find((o) => o.order === kind && o.index === index);
    return p ? (
      <span className="order-paused" title={`paused at tick ${p.atTick}`}>
        paused · {p.code}
      </span>
    ) : null;
  };
  return (
    <ul className="order-list">
      {orders.build.map((o, i) => (
        <li key={`b${i}`}>
          <span className="order-kind">build</span> {BUILDINGS[o.building].name} to {o.toLevel}
          {pausedTag("build", i)}
        </li>
      ))}
      {orders.train.map((o, i) => (
        <li key={`t${i}`}>
          <span className="order-kind">train</span> keep {o.keep} {UNITS[o.unit].name.toLowerCase()}
          {o.batch ? <span className="muted"> (batches of {o.batch})</span> : null}
          {pausedTag("train", i)}
        </li>
      ))}
      {orders.raids.map((o, i) => (
        <li key={`r${i}`}>
          <span className="order-kind">raid</span> {names.get(o.target) ?? o.target} with {formatUnits(o.units)}
          {o.stopIfLoss !== undefined && <span className="muted"> (stop past {Math.round(o.stopIfLoss * 100)}% lost)</span>}
          {pausedTag("raid", i)}
        </li>
      ))}
    </ul>
  );
}

function Scheduled({ state }: { state: StateResponse }) {
  const clock = useWorld(selectClock);
  const tick = useLiveTick(clock);
  if (state.scheduled.length === 0) return null;
  const names = new Map(state.villages.map((v) => [v.id, v.name]));
  const list = [...state.scheduled].sort((a, b) => a.atTick - b.atTick);
  return (
    <Section title="Scheduled" aside={<span className="muted small">{list.length} pending</span>}>
      <ul className="rows">
        {list.map((s) => (
          <li key={s.id} className="row-item">
            <div className="row-main">
              <span className="mono small muted">t{s.atTick}</span> {describeAction(s.action, names)}
              <Countdown until={s.atTick} tick={tick} speed={paceOf(clock)} paused={!isFlowing(clock)} />
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function describeAction(action: Action, names: Map<string, string>): string {
  const at = (id: string) => names.get(id) ?? id;
  switch (action.type) {
    case "build":
      return `build ${BUILDINGS[action.building].name} in ${at(action.village)}`;
    case "train":
      return `train ${action.count} ${UNITS[action.unit].name.toLowerCase()} in ${at(action.village)}`;
    case "send":
      return `${action.kind} ${at(action.village)} → ${at(action.target)} with ${formatUnits(action.units)}`;
    case "trade":
      return `trade ${formatResources(action.resources)} ${at(action.village)} → ${at(action.target)}`;
    case "recall":
      return `recall from ${at(action.village)} to ${at(action.home)}`;
    case "send_back":
      return `send back to ${at(action.home)} from ${at(action.village)}`;
    case "rename":
      return `rename ${at(action.village)}`;
    default:
      return action.type.replace(/_/g, " ");
  }
}

function matches(entry: ActivityEntry, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "failed") return entry.status >= 400 || (entry.actions?.some((a) => !a.ok) ?? false);
  return entry.via === filter;
}

function ActivityLog() {
  const activity = useWorld(selectActivity);
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  const shown = useMemo(() => activity.filter((e) => matches(e, filter)), [activity, filter]);
  return (
    <Section
      title="Activity"
      aside={
        <div className="filters" role="radiogroup" aria-label="Filter the log">
          {FILTERS.map((f) => (
            <button key={f} role="radio" aria-checked={filter === f} className={`filter${filter === f ? " is-active" : ""}`} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      }
    >
      {shown.length === 0 && <Empty>{activity.length === 0 ? "No calls yet. When the steward acts, every call shows here." : "Nothing matches."}</Empty>}
      <ol className="log">
        {shown.slice(0, limit).map((entry) => (
          <LogEntry key={entry.seq} entry={entry} />
        ))}
      </ol>
      {shown.length > limit && (
        <button className="btn btn-small btn-block" onClick={() => setLimit(limit + PAGE)}>
          Older calls ({shown.length - limit})
        </button>
      )}
    </Section>
  );
}

function LogEntry({ entry }: { entry: ActivityEntry }) {
  const failed = entry.status >= 400;
  return (
    <li className={`log-entry via-${entry.via}${failed ? " is-failed" : ""}`}>
      <div className="log-line">
        <span className="log-time">{formatClock(entry.at)}</span>
        <span className="log-tick">t{entry.tick}</span>
        <span className="log-call">{entry.call}</span>
        <span className={`log-status${failed ? " is-bad" : ""}`}>{entry.status}</span>
        <span className="log-ms">{entry.ms}ms</span>
        <span className="log-via">{entry.via}</span>
      </div>
      {entry.note && <div className="log-note">{entry.note}</div>}
      {entry.actions?.map((a, i) => (
        <div key={i} className={`log-action${a.ok ? "" : " is-bad"}`}>
          <span className="log-mark">{a.ok ? "✓" : "✗"}</span>
          <span className="log-type">{a.type}</span>
          {!a.ok && a.code && <span className="log-code">{a.code}</span>}
          <span className="log-summary">{a.summary}</span>
        </div>
      ))}
    </li>
  );
}
