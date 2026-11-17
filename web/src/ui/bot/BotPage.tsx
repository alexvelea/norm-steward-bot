import type { ReactNode } from "react";
import type { ControlView } from "../../lib/control";
import { ReviewPanel } from "../ReviewPanel";
import { PlanView } from "./PlanView";
import { humanize, setQuery, useQuery } from "./query";

const TABS = [
  ["plan", "Plan"],
  ["advisors", "Advisors"],
  ["budgets", "Budgets"],
  ["execution", "Execution"],
  ["reviews", "Reviews"],
] as const;
type Tab = (typeof TABS)[number][0];

export function BotPage({ view, advisors }: { view: ControlView; advisors: ReactNode }) {
  const query = useQuery();
  const tab: Tab = TABS.some(([id]) => id === query.get("tab")) ? (query.get("tab") as Tab) : "plan";
  const recovery = view.error && /recovery|unsupported|persistence/i.test(view.error);
  return (
    <main className="cc-main">
      <div className="cc-page-heading">
        <div>
          <p className="eyebrow">Decision planning</p>
          <h1>Bot</h1>
        </div>
        <span
          className={`cc-mode ${view.automatic ? "is-auto" : ""}`}
          title="Paused, stale and recovery-required are reported separately below."
        >
          {recovery ? "Recovery required" : view.automatic ? "Bot running" : "Paused"}
        </span>
      </div>
      {view.error && (
        <p className="error-line" role="alert">
          {view.error}
        </p>
      )}
      <div className="bp-tabs" role="tablist" aria-label="Bot views">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "is-active" : ""}
            onClick={() => setQuery({ tab: id === "plan" ? null : id }, true)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "plan" && <PlanView view={view} />}
      {tab === "advisors" && advisors}
      {tab === "budgets" && <BudgetsView view={view} />}
      {tab === "execution" && <ExecutionView view={view} />}
      {tab === "reviews" && <ReviewPanel />}
    </main>
  );
}

function candidateLabel(view: ControlView, id: string): string {
  const p = view.proposals.find((value) => value.id === id);
  return p ? `${p.villageName}: ${p.buildingName} → ${p.targetLevel}` : id;
}

function BudgetsView({ view }: { view: ControlView }) {
  const { allocation, reservations } = view.planning;
  const byReason = new Map<string, string[]>();
  for (const e of allocation.excluded) byReason.set(e.reasonCode, [...(byReason.get(e.reasonCode) ?? []), e.candidateId]);
  return (
    <div className="bp-stack">
      <section className="cc-card cc-president">
        <div>
          <p className="eyebrow">President allocation · revision {view.planning.revision}</p>
          <h2>
            {allocation.selectedCandidateId
              ? candidateLabel(view, allocation.selectedCandidateId)
              : "No action this cycle"}
          </h2>
          <p>
            {humanize(allocation.reasonCode)}. {view.selection.reason}
          </p>
        </div>
        <div className="cc-execution">
          <strong>One shared budget</strong>
          <p className="small muted">
            All missions draw on each village’s stock. Mission order explains intent; it does not
            reserve separate budgets yet.
          </p>
        </div>
      </section>
      <section className="cc-card">
        <h2>Reservations</h2>
        {reservations.length === 0 && <p className="muted small">No resources are held.</p>}
        <table className="cc-forecast">
          <tbody>
            {reservations.map((r) => (
              <tr key={r.id}>
                <th>{humanize(r.kind)}</th>
                <td>{view.planning.villages.find((v) => v.id === r.villageId)?.name ?? r.villageId}</td>
                <td>{r.kind === "fundingGoal" ? candidateLabel(view, r.goal) : r.kind === "exclusiveSpending" ? `Excludes ${r.excludes.length} task types` : r.operationId}</td>
                <td>{humanize(r.reasonCode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="cc-card">
        <h2>Not selected</h2>
        {[...byReason].map(([reason, ids]) => (
          <details key={reason} open={ids.length < 6}>
            <summary>
              {humanize(reason)} · {ids.length}
            </summary>
            <ul className="bp-ops">
              {ids.map((id) => (
                <li key={id}>{candidateLabel(view, id)}</li>
              ))}
            </ul>
          </details>
        ))}
        {byReason.size === 0 && <p className="muted small">Every ready candidate was considered.</p>}
      </section>
    </div>
  );
}

function ExecutionView({ view }: { view: ControlView }) {
  const journal = [...(view.pending ? [view.pending] : []), ...(view.active ?? [])];
  return (
    <div className="bp-stack">
      <section className="cc-card">
        <h2>Journal</h2>
        <p className="small muted">
          Request IDs are written before any network write. Submitted ≠ accepted ≠ confirmed.{" "}
          {view.automatic ? "Automatic execution is on." : "Automatic execution is paused; nothing new is submitted."}
        </p>
        {journal.length === 0 && <p className="muted small">No tracked operations.</p>}
        <ul className="bp-ops">
          {journal.map((p) => (
            <li key={p.action.clientId ?? p.proposal.id}>
              <span className="cc-status">{p.phase}</span> {p.proposal.villageName}: {p.proposal.buildingName} →{" "}
              {p.proposal.targetLevel} · <code>{p.action.clientId}</code> · created tick {p.createdTick}, expires tick{" "}
              {p.expiresTick}
            </li>
          ))}
        </ul>
      </section>
      <section className="cc-card">
        <h2>History</h2>
        <div className="cc-decisions">
          {view.decisions.map((d) => (
            <article key={d.id}>
              <div>
                <span className={`cc-decision-kind kind-${d.kind}`}>{d.kind}</span>
                <time>{new Date(d.at).toLocaleTimeString()}</time>
              </div>
              <p>{d.text}</p>
              {d.tick !== undefined && <small>tick {d.tick}</small>}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
