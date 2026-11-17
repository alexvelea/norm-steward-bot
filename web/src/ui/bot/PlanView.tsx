import { Fragment, useMemo, useState } from "react";
import { PLAN } from "../../../../src/bot/plan/graph";
import type { PlanNode } from "../../../../src/bot/plan/graph";
import { effectiveRoles, isPlanned } from "../../../../src/bot/plan/evaluate";
import { SPECS, type NodeSpec } from "../../../../src/bot/plan/specs";
import type { Proposal } from "../../../../src/advisors/types";
import type { ControlView, PlanningNodeState, TaskState } from "../../lib/control";
import { formatResources } from "../../lib/format";
import { humanize, setQuery, useQuery } from "./query";

const nodes = PLAN.nodes as readonly PlanNode[];
const byKey = new Map(nodes.map((node) => [node.key, node]));
const children = new Map<string, string[]>();
const parent = new Map<string, string>();
for (const edge of PLAN.edges) {
  if (edge.kind !== "contains") continue;
  children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  parent.set(edge.to, edge.from);
}
const root = nodes.find((node) => !parent.has(node.key))!.key;
const prerequisites = (key: string) =>
  PLAN.edges.filter((e) => e.kind === "requires" && e.to === key).map((e) => e.from);
const unlocks = (key: string) =>
  PLAN.edges.filter((e) => e.kind === "requires" && e.from === key).map((e) => e.to);
const contributes = (key: string) =>
  PLAN.edges.filter((e) => e.kind === "contributesTo" && e.from === key).map((e) => e.to);

const STATUS_LABEL: Record<TaskState, string> = {
  ready: "Ready",
  waiting: "Waiting",
  running: "Running",
  satisfied: "Done",
  idle: "Idle",
  invalid: "Invalid",
  unavailable: "Unavailable",
};

export function PlanView({ view }: { view: ControlView }) {
  const query = useQuery();
  const planning = view.planning;
  const villages = planning?.villages ?? [];
  const villageId =
    villages.find((v) => v.id === query.get("village"))?.id ?? villages[0]?.id ?? null;
  const selectedKey = byKey.has(query.get("node") ?? "") ? query.get("node")! : root;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [allRoles, setAllRoles] = useState(false);
  const states = useMemo(() => {
    const map = new Map<string, PlanningNodeState>();
    for (const state of planning?.nodes ?? [])
      if (state.villageId === null || state.villageId === villageId) map.set(state.key, state);
    return map;
  }, [planning, villageId]);
  if (!planning)
    return <p className="cc-card muted">Waiting for the first planning evaluation.</p>;
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const select = (key: string) => setQuery({ node: key });
  const mismatches = [...states.values()]
    .filter(
      (st) =>
        st.applies === false &&
        (st.kind === "task" || st.kind === "milestone") &&
        (st.candidates.length > 0 || st.operations.length > 0),
    )
    .map((st) => st.key);
  return (
    <div className="bp-plan">
      <div className="bp-plan-bar">
        <div className="bp-villages" role="group" aria-label="Village">
          {villages.map((v) => (
            <button
              key={v.id}
              className={`btn btn-small ${v.id === villageId ? "is-active" : ""}`}
              aria-pressed={v.id === villageId}
              onClick={() => setQuery({ village: v.id })}
            >
              {v.name} · {humanize(v.role)}
            </button>
          ))}
          <label className="small muted bp-roles-toggle">
            <input type="checkbox" checked={allRoles} onChange={(e) => setAllRoles(e.target.checked)} />{" "}
            Show other roles' branches
          </label>
        </div>
        <p className="small muted">
          Decision revision {planning.revision} · observed tick {planning.observedTick} · rules v
          {planning.rulesVersion} · evaluated {new Date(planning.evaluatedAt).toLocaleTimeString()}
          {planning.wake !== null ? ` · next wake tick ${planning.wake}` : ""}
        </p>
      </div>
      <div className="bp-plan-grid">
        <section className="bp-tree" aria-label="Plan tree">
          {!allRoles && mismatches.length > 0 && (
            <div className="bp-mismatch" role="note">
              <strong>Plan mismatches</strong>
              <span className="small muted">
                {" "}
                · today's code acts on these here, but they are not in this city's role
              </span>
              <ul>
                {mismatches.map((key) => (
                  <li key={key}>
                    <button className="linkish" onClick={() => select(key)}>
                      {byKey.get(key)!.title}
                    </button>{" "}
                    <span className="small muted">in {byKey.get(parent.get(key) ?? root)!.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul role="tree">
            <TreeRow
              nodeKey={root}
              depth={0}
              states={states}
              selected={selectedKey}
              collapsed={collapsed}
              allRoles={allRoles}
              onToggle={toggle}
              onSelect={select}
            />
          </ul>
          <p className="small muted bp-legend">
            Tree = contains. “Needs” lists unmet prerequisites (requires edges). Only branches for
            the selected city's role are shown. “Planned” nodes are designed but not codified yet;
            the bot never acts on them. Several tasks can be ready at once; the bot still submits
            one action per cycle.
          </p>
        </section>
        <Inspector
          nodeKey={selectedKey}
          states={states}
          view={view}
          villageId={villageId}
          onSelect={select}
        />
      </div>
    </div>
  );
}

function TreeRow({
  nodeKey,
  depth,
  states,
  selected,
  collapsed,
  allRoles,
  onToggle,
  onSelect,
}: {
  nodeKey: string;
  depth: number;
  states: Map<string, PlanningNodeState>;
  selected: string;
  collapsed: Set<string>;
  allRoles: boolean;
  onToggle(key: string): void;
  onSelect(key: string): void;
}) {
  const node = byKey.get(nodeKey)!;
  const state = states.get(nodeKey);
  const kids = children.get(nodeKey) ?? [];
  const open = !collapsed.has(nodeKey);
  const unmet = prerequisites(nodeKey).filter((key) => states.get(key)?.status !== "satisfied");
  const offRole = state?.applies === false;
  const activeOffRole = offRole && !!state && (state.candidates.length > 0 || state.operations.length > 0);
  if (offRole && !allRoles) return null;
  return (
    <li
      role="treeitem"
      aria-expanded={kids.length ? open : undefined}
      aria-selected={selected === nodeKey}
    >
      <div
        className={`bp-row kind-${node.kind} ${selected === nodeKey ? "is-selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        {kids.length ? (
          <button
            className="bp-twisty"
            aria-label={open ? `Collapse ${node.title}` : `Expand ${node.title}`}
            onClick={() => onToggle(nodeKey)}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="bp-twisty" />
        )}
        <button className="bp-row-main" onClick={() => onSelect(nodeKey)}>
          <span className={`bp-kind kind-${node.kind}`}>{node.kind}</span>
          <span className="bp-title">{node.title}</span>
          {state?.progress.goal !== null && state?.progress.goal !== undefined && (
            <span className="bp-progress-text">
              {state.progress.observed ?? "?"}/{state.progress.goal}
            </span>
          )}
          {unmet.length > 0 && (
            <span className="bp-needs">
              needs {unmet.map((key) => byKey.get(key)!.title).join(", ")}
            </span>
          )}
          {state?.primaryBlocker && state.status !== "unavailable" && (
            <span className="bp-blocker">{humanize(state.primaryBlocker.reasonCode)}</span>
          )}
          {activeOffRole && <span className="bp-warn">acts here today; not in this role's plan</span>}
          {state && <StatusPill state={state} />}
        </button>
      </div>
      {kids.length > 0 && open && (
        <ul role="group">
          {kids.map((key) => (
            <TreeRow
              key={key}
              nodeKey={key}
              depth={depth + 1}
              states={states}
              selected={selected}
              collapsed={collapsed}
              allRoles={allRoles}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function StatusPill({ state }: { state: PlanningNodeState }) {
  const reason = state.primaryBlocker?.reasonCode;
  if (state.status === "unavailable" && (reason === "PLANNED" || reason === "NOT_FOR_ROLE"))
    return <span className="bp-status status-planned">Planned</span>;
  return <span className={`bp-status status-${state.status}`}>{STATUS_LABEL[state.status]}</span>;
}

function NodeLink({
  nodeKey,
  states,
  onSelect,
}: {
  nodeKey: string;
  states: Map<string, PlanningNodeState>;
  onSelect(key: string): void;
}) {
  const state = states.get(nodeKey);
  return (
    <li>
      <button className="linkish" onClick={() => onSelect(nodeKey)}>
        {byKey.get(nodeKey)!.title}
      </button>{" "}
      {state && <StatusPill state={state} />}
    </li>
  );
}

function Inspector({
  nodeKey,
  states,
  view,
  villageId,
  onSelect,
}: {
  nodeKey: string;
  states: Map<string, PlanningNodeState>;
  view: ControlView;
  villageId: string | null;
  onSelect(key: string): void;
}) {
  const node = byKey.get(nodeKey)!;
  const state = states.get(nodeKey);
  const planning = view.planning;
  const proposals = new Map<string, Proposal>(view.proposals.map((p) => [p.id, p]));
  const candidates = planning.candidates.filter((c) => state?.candidates.includes(c.id));
  const operations = planning.operations.filter((o) => state?.operations.includes(o.id));
  const excluded = new Map(planning.allocation.excluded.map((e) => [e.candidateId, e.reasonCode]));
  const reservations = planning.reservations.filter(
    (r) =>
      candidates.some((c) => c.id === r.ownerId) ||
      (r.kind === "exclusiveSpending" && r.villageId === villageId && nodeKey.startsWith("conquest")),
  );
  const path: string[] = [];
  for (let key: string | undefined = parent.get(nodeKey); key; key = parent.get(key)) path.unshift(key);
  const pre = prerequisites(nodeKey),
    next = unlocks(nodeKey),
    toward = contributes(nodeKey);
  const progress = state?.progress;
  return (
    <aside className="bp-inspector cc-card" aria-label="Selected plan node">
      <nav className="bp-crumbs small" aria-label="Plan path">
        {path.map((key) => (
          <span key={key}>
            <button className="linkish" onClick={() => onSelect(key)}>
              {byKey.get(key)!.title}
            </button>{" "}
            ›{" "}
          </span>
        ))}
      </nav>
      <div className="bp-inspector-head">
        <div>
          <span className={`bp-kind kind-${node.kind}`}>{node.kind}</span>
          <h2>{node.title}</h2>
          <code className="small">{node.key}</code>
        </div>
        {state && <StatusPill state={state} />}
      </div>
      <p>{node.summary}</p>
      {nodeKey === "roles" && (
        <section>
          <h3>Assigned roles</h3>
          <dl className="bp-facts">
            {planning.villages.map((v) => (
              <Fragment key={v.id}>
                <dt>{v.name}</dt>
                <dd>
                  <strong>{humanize(v.role)}</strong> · {v.roleReason}
                </dd>
              </Fragment>
            ))}
          </dl>
        </section>
      )}
      {SPECS[nodeKey] && <SpecView spec={SPECS[nodeKey]} />}
      <dl className="bp-facts">
        <dt>Scope</dt>
        <dd>
          {node.scope === "village"
            ? `Per village · showing ${planning.villages.find((v) => v.id === villageId)?.name ?? "—"}`
            : "Account"}
        </dd>
        <dt>Roles</dt>
        <dd>
          {effectiveRoles(nodeKey)?.map(humanize).join(", ") ?? "All cities"}
          {state?.applies === false ? " · not this city's role" : ""}
          {isPlanned(nodeKey) ? " · planned, not codified yet" : ""}
        </dd>
        {node.advisor && (
          <>
            <dt>Advisor</dt>
            <dd>{humanize(node.advisor)}</dd>
          </>
        )}
        {progress && progress.goal !== null && (
          <>
            <dt>Progress</dt>
            <dd>
              <span className="bp-meter">
                <span
                  style={{
                    width: `${Math.min(100, ((progress.observed ?? 0) / Math.max(1, progress.goal)) * 100)}%`,
                  }}
                />
              </span>
              {progress.observed === null ? "unknown" : progress.observed} of {progress.goal} (observed
              at tick {planning.observedTick})
            </dd>
          </>
        )}
        {node.thresholds && (
          <>
            <dt>Thresholds</dt>
            <dd>
              {Object.entries(node.thresholds)
                .map(([k, v]) => `${humanize(k)} ${v}`)
                .join(" · ")}
            </dd>
          </>
        )}
        {state?.primaryBlocker && (
          <>
            <dt>Blocked by</dt>
            <dd>
              {humanize(state.primaryBlocker.reasonCode)}
              {state.primaryBlocker.nodeKey && (
                <>
                  {" "}
                  ·{" "}
                  <button className="linkish" onClick={() => onSelect(state.primaryBlocker!.nodeKey!)}>
                    {byKey.get(state.primaryBlocker.nodeKey)?.title}
                  </button>
                </>
              )}
            </dd>
          </>
        )}
        {state?.wake !== null && state?.wake !== undefined && (
          <>
            <dt>Next wake</dt>
            <dd>tick {state.wake} (estimated affordability)</dd>
          </>
        )}
      </dl>
      {(planning.missions ?? [])
        .filter((m) => m.nodeKey === nodeKey && m.villageId === villageId)
        .map((m) => (
          <section key={m.id}>
            <h3>Persisted mission</h3>
            <dl className="bp-facts">
              <dt>Status</dt>
              <dd>
                {humanize(m.status)}
                {m.phase ? ` · ${humanize(m.phase)}` : ""}
              </dd>
              <dt>Started</dt>
              <dd>tick {m.startedTick}</dd>
              <dt>Target</dt>
              <dd>{m.targetId ?? "not chosen yet"}</dd>
              <dt>Escort</dt>
              <dd>{m.memory.escort ?? "not simulated yet"}</dd>
              <dt>Waves</dt>
              <dd>{m.memory.waves} of 6</dd>
              {m.memory.lastBattleOutcome && (
                <>
                  <dt>Last battle</dt>
                  <dd>{m.memory.lastBattleOutcome}</dd>
                </>
              )}
              {m.memory.reason && (
                <>
                  <dt>Reason</dt>
                  <dd>{m.memory.reason}</dd>
                </>
              )}
            </dl>
          </section>
        ))}
      {(planning.commitments ?? [])
        .filter((c) => c.nodeKey === nodeKey && c.villageId === villageId)
        .map((c) => (
          <section key={c.id}>
            <h3>Commitment</h3>
            <p className="small">
              {humanize(c.kind)} since tick {c.createdTick}: {c.targets.pikemen} Pikemen and{" "}
              {c.targets.shieldmen} Shieldmen remaining (baseline {c.baselines.pikemen} /{" "}
              {c.baselines.shieldmen}). Losses are not replaced.
            </p>
          </section>
        ))}
      {(pre.length > 0 || next.length > 0 || toward.length > 0) && (
        <div className="bp-links">
          {pre.length > 0 && (
            <div>
              <h3>Requires</h3>
              <ul>
                {pre.map((key) => (
                  <NodeLink key={key} nodeKey={key} states={states} onSelect={onSelect} />
                ))}
              </ul>
            </div>
          )}
          {next.length > 0 && (
            <div>
              <h3>Unlocks</h3>
              <ul>
                {next.map((key) => (
                  <NodeLink key={key} nodeKey={key} states={states} onSelect={onSelect} />
                ))}
              </ul>
            </div>
          )}
          {toward.length > 0 && (
            <div>
              <h3>Contributes to</h3>
              <ul>
                {toward.map((key) => (
                  <NodeLink key={key} nodeKey={key} states={states} onSelect={onSelect} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {(children.get(nodeKey) ?? []).length > 0 && (
        <div className="bp-links">
          <div>
            <h3>Contains</h3>
            <ul>
              {children.get(nodeKey)!.map((key) => (
                <NodeLink key={key} nodeKey={key} states={states} onSelect={onSelect} />
              ))}
            </ul>
          </div>
        </div>
      )}
      {node.kind === "task" && (
        <section>
          <h3>Candidate actions</h3>
          {candidates.length === 0 && (
            <p className="small muted">No advisor proposed an action for this task this cycle.</p>
          )}
          {candidates.map((c) => {
            const p = proposals.get(c.id);
            const selected = planning.allocation.selectedCandidateId === c.id;
            return (
              <article key={c.id} className={`bp-candidate ${selected ? "is-selected" : ""}`}>
                <div className="bp-candidate-top">
                  <strong>
                    {p ? p.action.type === "trade" ? p.buildingName : `${p.buildingName} → ${p.targetLevel}` : humanize(c.action.type)}
                  </strong>
                  <span className="small">importance {c.importance}</span>
                  <span className={`cc-status status-${c.status}`}>{c.status}</span>
                </div>
                {p && <p className="small">{p.reason}</p>}
                {p && <p className="small muted">Cost {formatResources(p.requirements)}</p>}
                {c.blockers.length > 0 && (
                  <p className="cc-blockers">{c.blockers.map(humanize).join(" · ")}</p>
                )}
                <p className="small bp-allocation">
                  President:{" "}
                  {selected
                    ? "selected this cycle"
                    : excluded.has(c.id)
                      ? humanize(excluded.get(c.id)!)
                      : "not considered (not ready)"}
                </p>
              </article>
            );
          })}
        </section>
      )}
      {operations.length > 0 && (
        <section>
          <h3>Linked requests</h3>
          <ul className="bp-ops">
            {operations.map((o) => (
              <li key={o.id}>
                <span className="cc-status">{o.status}</span> <code>{o.clientId ?? "no request ID"}</code>
                {o.itemId && <small> · item {o.itemId}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {reservations.length > 0 && (
        <section>
          <h3>Reservations</h3>
          <ul className="bp-ops">
            {reservations.map((r) => (
              <li key={r.id}>
                {humanize(r.kind)} · {humanize(r.reasonCode)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

function SpecView({ spec }: { spec: NodeSpec }) {
  const list = (title: string, items?: readonly string[]) =>
    items && items.length > 0 ? (
      <>
        <dt>{title}</dt>
        <dd>
          <ul className="bp-spec-list">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </dd>
      </>
    ) : null;
  return (
    <section className="bp-spec">
      <h3>Spec</h3>
      <dl className="bp-facts">
        <dt>Intent</dt>
        <dd>{spec.intent}</dd>
        {list("Eligible when", spec.eligible)}
        {list("Priority", spec.priority)}
        {list("Never", spec.never)}
      </dl>
    </section>
  );
}
