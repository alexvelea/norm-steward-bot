// Reports: battle and scouting reports, newest first, each opened in full. Opening one is a GET, and
// the server marks it read, as the API does for any reader.
import { useEffect, useState } from "react";
import type { Report, ReportSummary, UnitCounts } from "../../contract";
import { BUILDINGS, UNITS, UNIT_IDS } from "../../contract";
import { formatCompact, formatInt, formatResources } from "../../lib/format";
import { describeFailure } from "../../lib/http";
import { Empty, Section } from "../common";
import { selectReports, selectReportsNext, useWorld, useWorldContext } from "../worldContext";

const OUTCOME_LABEL: Record<ReportSummary["outcome"], string> = {
  won: "Won",
  lost: "Lost",
  scouted: "Scouted",
  failed: "Failed",
};

export function ReportsTab() {
  const reports = useWorld(selectReports);
  const next = useWorld(selectReportsNext);
  const { client } = useWorldContext();
  const [openId, setOpenId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  if (openId) return <ReportView id={openId} onBack={() => setOpenId(null)} />;

  return (
    <div className="tab-page">
      {reports.length === 0 && <Empty>No reports yet. Every battle and scouting run your villages see lands here.</Empty>}
      <ul className="report-list">
        {reports.map((r) => (
          <li key={r.id}>
            <button className={`report-row outcome-${r.outcome}${r.read ? "" : " is-unread"}`} onClick={() => setOpenId(r.id)}>
              <span className="report-outcome">{OUTCOME_LABEL[r.outcome]}</span>
              <span className="report-title">
                {r.attacker.name} <span className="muted">→</span> {r.defender.name}
                {r.conquered && <span className="tag tag-gold">conquered</span>}
              </span>
              <span className="report-meta muted">
                {r.kind} · {r.role} · t{r.tick}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {next && (
        <button
          className="btn btn-small btn-block"
          disabled={loadingMore}
          onClick={async () => {
            setLoadingMore(true);
            try {
              await client.fetchMoreReports();
            } finally {
              setLoadingMore(false);
            }
          }}
        >
          {loadingMore ? "Loading…" : "Older reports"}
        </button>
      )}
    </div>
  );
}

function ReportView({ id, onBack }: { id: string; onBack: () => void }) {
  const { client, map } = useWorldContext();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    client
      .fetchReport(id)
      .then((r) => alive && setReport(r))
      .catch((e) => alive && setError(describeFailure(e)));
    return () => {
      alive = false;
    };
  }, [client, id]);

  return (
    <div className="tab-page">
      <button className="btn btn-small" onClick={onBack}>
        ← All reports
      </button>
      {error && <p className="error-line">{error}</p>}
      {!report && !error && <p className="muted">Opening the report…</p>}
      {report && (
        <article className={`report outcome-${report.outcome}`}>
          <header className="report-head">
            <span className="report-outcome big">{OUTCOME_LABEL[report.outcome]}</span>
            <h2>
              <button className="linkish" onClick={() => map.focus(report.attacker.x, report.attacker.y, null)}>
                {report.attacker.name}
              </button>{" "}
              <span className="muted">→</span>{" "}
              <button className="linkish" onClick={() => map.focus(report.defender.x, report.defender.y, null)}>
                {report.defender.name}
              </button>
            </h2>
            <p className="muted small">
              {report.kind} at tick {report.tick} · you were the {report.role}
              {report.attacker.ownerName && ` · attacker ${report.attacker.ownerName}`}
              {report.defender.ownerName ? ` · defender ${report.defender.ownerName}` : " · a hamlet"}
            </p>
            {report.conquered && <p className="gold">The village changed hands.</p>}
          </header>

          {report.strength && (
            <div className="strength">
              <div>
                <span className="big ember">{formatCompact(report.strength.attack)}</span>
                <small>attack</small>
              </div>
              <div className="strength-bar">
                <div
                  className="strength-attack"
                  style={{ width: `${(100 * report.strength.attack) / Math.max(1, report.strength.attack + report.strength.defense)}%` }}
                />
              </div>
              <div>
                <span className="big steel">{formatCompact(report.strength.defense)}</span>
                <small>defence</small>
              </div>
            </div>
          )}

          {report.attackerUnits && (
            <Section title="Attacker">
              <Losses units={report.attackerUnits.sent} lost={report.attackerUnits.lost} first="Sent" />
            </Section>
          )}
          {report.defenderUnits && (
            <Section title={report.role === "supporter" ? "Your support" : "Defenders"}>
              <Losses units={report.defenderUnits.present} lost={report.defenderUnits.lost} first="Present" />
            </Section>
          )}
          {report.scouts && (
            <Section title="Scouts">
              <dl className="facts">
                <div>
                  <dt>Sent</dt>
                  <dd>
                    {report.scouts.sent} <span className="muted">lost {report.scouts.lost}</span>
                  </dd>
                </div>
                {report.scouts.defending !== null && (
                  <div>
                    <dt>Defending</dt>
                    <dd>
                      {report.scouts.defending} <span className="muted">lost {report.scouts.defendingLost ?? 0}</span>
                    </dd>
                  </div>
                )}
              </dl>
            </Section>
          )}
          <Siege report={report} />
          {report.intel && <Intel report={report} />}
        </article>
      )}
    </div>
  );
}

function Losses({ units, lost, first }: { units: UnitCounts; lost: UnitCounts; first: string }) {
  const ids = UNIT_IDS.filter((u) => (units[u] ?? 0) > 0 || (lost[u] ?? 0) > 0);
  if (ids.length === 0) return <Empty>None.</Empty>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Unit</th>
          <th className="num">{first}</th>
          <th className="num">Lost</th>
        </tr>
      </thead>
      <tbody>
        {ids.map((u) => (
          <tr key={u}>
            <td>{UNITS[u].name}</td>
            <td className="num mono">{formatInt(units[u] ?? 0)}</td>
            <td className={`num mono${(lost[u] ?? 0) > 0 ? " ember" : " muted"}`}>{formatInt(lost[u] ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Siege({ report }: { report: Report }) {
  const rows: [string, string][] = [];
  if (report.wall) rows.push(["Wall", `${report.wall.before} → ${report.wall.after} (fought at ${report.wall.effective})`]);
  if (report.building) rows.push([BUILDINGS[report.building.aim].name, `${report.building.before} → ${report.building.after}`]);
  if (report.loyalty) rows.push(["Loyalty", `${report.loyalty.before} → ${report.loyalty.after}`]);
  if (report.loot) rows.push(["Loot", formatResources(report.loot)]);
  if (report.carry) rows.push(["Carried", `${formatInt(report.carry.taken)} of ${formatInt(report.carry.capacity)}`]);
  if (rows.length === 0) return null;
  return (
    <Section title="Aftermath">
      <dl className="facts">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function Intel({ report }: { report: Report }) {
  const intel = report.intel!;
  const built = (Object.keys(intel.buildings) as (keyof typeof intel.buildings)[]).filter((b) => intel.buildings[b] > 0);
  return (
    <Section title="Intel">
      <p className="muted small">Left after the loot: {formatResources(intel.resources)}</p>
      <div className="intel-buildings">
        {built.map((b) => (
          <span key={b} className="chip chip-static">
            {BUILDINGS[b].name} <strong>{intel.buildings[b]}</strong>
          </span>
        ))}
      </div>
      <Losses units={intel.unitsHome} lost={{}} first="At home" />
      {UNIT_IDS.some((u) => (intel.supportTotal[u] ?? 0) > 0) && (
        <>
          <p className="muted small">Support stationed there, in total:</p>
          <Losses units={intel.supportTotal} lost={{}} first="Support" />
        </>
      )}
    </Section>
  );
}
