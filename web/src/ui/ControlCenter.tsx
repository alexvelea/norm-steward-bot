import { ReviewPanel } from "./ReviewPanel";
import { useEffect, useState } from "react";
import {
  controlRequest,
  loginCurrentKey,
  useControl,
  type ControlView,
} from "../lib/control";
import { setApiKey, useApiKey } from "../lib/keyStore";
import { navigate, useRoute, worldHref, isMock } from "../lib/router";
import { formatResources } from "../lib/format";
import { Link } from "./common";
import { WorldPage } from "./WorldPage";

export function ControlCenter() {
  const route = useRoute();
  const key = useApiKey();
  const [authenticated, setAuthenticated] = useState(false),
    [checking, setChecking] = useState(true),
    [loginError, setLoginError] = useState("");
  useEffect(() => {
    let active = true;
    setChecking(true);
    loginCurrentKey()
      .then(() => {
        if (active) {
          setAuthenticated(true);
          setLoginError("");
        }
      })
      .catch((e) => {
        if (active) {
          setAuthenticated(false);
          setLoginError(key ? e.message : "");
        }
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [key]);
  if (checking)
    return (
      <div className="cc-unlock">
        <h1>Steward Control</h1>
        <p className="muted">Connecting to your personal control service…</p>
      </div>
    );
  if (!authenticated) return <Unlock error={loginError} />;
  return (
    <ConnectedCenter
      onLogout={async () => {
        await controlRequest("/logout", "POST", {});
        setApiKey(null);
        setAuthenticated(false);
        await fetch("/access/logout", { method: "POST" });
        location.assign("/");
      }}
    />
  );
}
function Unlock({ error }: { error: string }) {
  const [draft, setDraft] = useState(""),
    [show, setShow] = useState(false);
  return (
    <div className="cc-unlock">
      <div className="eyebrow">Personal bot control center</div>
      <h1>Steward Control</h1>
      <p className="muted">
        Unlock with the player key configured on this machine.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setApiKey(draft.trim());
        }}
      >
        <label className="field">
          <span>Player API key</span>
          <input
            autoComplete="off"
            type={show ? "text" : "password"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            required
          />
        </label>
        <div className="row gap">
          <button type="button" className="btn" onClick={() => setShow(!show)}>
            {show ? "Hide key" : "Reveal key"}
          </button>
          <button className="btn btn-gold">Unlock control center</button>
        </div>
      </form>
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}
      <p className="small muted">
        The persistent service must be running. There is no public signup here.
      </p>
    </div>
  );
}
function ConnectedCenter({ onLogout }: { onLogout(): Promise<void> }) {
  const { view, error, refresh, setView } = useControl();
  const route = useRoute();
  const settings = route.name === "settings";
  const map = route.name === "world";
  if (!view)
    return (
      <div className="cc-unlock">
        <h1>Control service</h1>
        <p role="alert">{error || "Loading your account…"}</p>
        <button className="btn" onClick={() => void refresh()}>
          Retry
        </button>
        <button className="btn" onClick={() => void onLogout()}>
          Lock
        </button>
      </div>
    );
  return (
    <div className="cc-shell">
      <header className="cc-nav">
        <Link href="/" className="cc-brand">
          Steward <span>Control</span>
        </Link>
        <nav aria-label="Control center">
          <Link href="/" className={!settings && !map ? "is-active" : ""}>
            Advisors
          </Link>
          <Link
            href={worldHref(view.settings.worldId)}
            className={map ? "is-active" : ""}
          >
            Map & commands
          </Link>
          <Link href="/settings" className={settings ? "is-active" : ""}>
            Settings
          </Link>
        </nav>
        <div className="cc-identity">
          <strong>{view.account?.name || "Account unavailable"}</strong>
          <span>
            {view.world?.name || view.settings.worldId} · {view.villages.length}{" "}
            {view.villages.length === 1 ? "village" : "villages"}
          </span>
        </div>
        <button className="btn btn-small" onClick={() => void onLogout()}>
          Lock
        </button>
      </header>
      {error && (
        <div className="cc-service-error" role="alert">
          {error}{" "}
          <button className="linkish" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      {map && route.worldId !== view.settings.worldId && (
        <div className="cc-service-error">
          Viewing {route.worldId}; the advisor manages {view.settings.worldId}.
          Change the selected world in Settings to manage this one.
        </div>
      )}
      {map ? (
        <WorldPage
          key={`${route.worldId}:${view.settings.serverUrl}:${view.account?.id}`}
          worldId={route.worldId}
        />
      ) : settings ? (
        <SettingsPage view={view} onChange={setView} />
      ) : (
        <AdvisorPage view={view} onChange={setView} />
      )}
    </div>
  );
}
function AdvisorPage({
  view,
  onChange,
}: {
  view: ControlView;
  onChange(view: ControlView): void;
}) {
  const [error, setError] = useState(""),
    [inspected, setInspected] = useState(false);
  return (
    <main className="cc-main">
      <div className="cc-page-heading">
        <div>
          <p className="eyebrow">Your deterministic council</p>
          <h1>Economic Advisor</h1>
          <p className="muted">
            Short-term upgrades, ranked by need. The President chooses one
            affordable action at a time.
          </p>
        </div>
        <span className={`cc-mode ${view.automatic ? "is-auto" : ""}`}>
          {view.automatic ? "Bot running" : "Needs attention"}
        </span>
      </div>
      <section className="cc-stats">
        <div>
          <span>Connection</span>
          <strong>{view.connection}</strong>
          <small>{view.settings.serverUrl}</small>
        </div>
        <div>
          <span>Managing</span>
          <strong>{view.account?.name || "—"}</strong>
          <small>
            {view.world?.name || view.settings.worldId} · round{" "}
            {view.world?.round ?? "—"} · tick {view.world?.tick ?? "—"}
          </small>
        </div>
        <div>
          <span>Last evaluation</span>
          <strong>
            {view.lastEvaluatedAt
              ? new Date(view.lastEvaluatedAt).toLocaleTimeString()
              : "Waiting"}
          </strong>
          <small>
            {view.busy
              ? "Evaluation in progress"
              : "Persistent service · every 10 seconds"}
          </small>
        </div>
      </section>
      <section className="cc-card cc-president">
        <div>
          <p className="eyebrow">President · coordinator</p>
          <h2>
            {view.selection.selected
              ? `${view.selection.selected.buildingName} → ${view.selection.selected.targetLevel}`
              : "Wait & preserve resources"}
          </h2>
          <p>{view.selection.reason}</p>
          {view.nextAttemptAt && (
            <p className="warn-line small">
              Retry/backoff until{" "}
              {new Date(view.nextAttemptAt).toLocaleTimeString()}.
            </p>
          )}
        </div>
        <div className="cc-execution">
          <strong>Targets</strong>
          <p className="small muted">
            Storage: stock + 5 minutes. Cellar: 5 minutes of production. Farm:
            max(50, 20%) free capacity.
          </p>
          <p className="small muted">
            Production: lowest projected 3-minute supply relative to the cost of
            the next producer upgrades.
          </p>
        </div>
      </section>
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}
      {view.error && (
        <p className="error-line" role="alert">
          {view.error}
        </p>
      )}
      {view.conflicts.map((c) => (
        <p className="warn-line" key={c}>
          {c}
        </p>
      ))}
      <div className="cc-villages">
        {view.villages.map((v) => (
          <Link href={worldHref(view.settings.worldId)} key={v.id}>
            {v.name} <span>{v.points} points</span>
          </Link>
        ))}
      </div>
      <ReviewPanel />
      <section className="cc-card cc-production">
        <h2>Total production</h2>
        {view.production ? (
          <>
            <p>
              {formatResources(view.production.produced)} ·{" "}
              <strong>
                {Math.round(
                  Object.values(view.production.produced).reduce(
                    (sum, n) => sum + n,
                    0,
                  ),
                ).toLocaleString()}{" "}
                total
              </strong>
            </p>
            <p className="small muted">
              Estimated gross production from tick {view.production.fromTick} to{" "}
              {view.production.toTick}, across all managed villages. Includes
              production lost to overflow; spending does not reduce this
              counter.
            </p>
          </>
        ) : (
          <p className="muted">Waiting for production samples.</p>
        )}
        {view.economicForecasts.map((f) => (
          <details key={f.villageId}>
            <summary>{f.villageName} · projected resources</summary>
            <div className="cc-forecast-scroll">
              <table className="cc-forecast">
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th>Stock</th>
                    <th>In 3 min</th>
                    <th>Producer upgrade costs</th>
                    <th>Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {(["timber", "stone", "iron"] as const).map((r) => (
                    <tr key={r}>
                      <th>{r}</th>
                      <td>{Math.round(f.stock[r]).toLocaleString()}</td>
                      <td>{Math.round(f.threeMinutes[r]).toLocaleString()}</td>
                      <td>{f.producerDemand[r].toLocaleString()}</td>
                      <td>{f.coverage[r].toFixed(2)}×</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted">
              Free population {f.freePopulation} / target{" "}
              {Math.ceil(f.requiredFreePopulation)} · storage{" "}
              {f.storage.toLocaleString()} per resource · protected{" "}
              {f.hidden.toLocaleString()} per resource.
            </p>
          </details>
        ))}
      </section>
      <div className="cc-columns">
        <section>
          <div className="cc-section-heading">
            <h2>Ranked recommendations</h2>
            <button
              className="btn btn-small"
              onClick={async () => {
                try {
                  onChange(
                    await controlRequest<ControlView>("/evaluate", "POST", {}),
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Refresh evaluation
            </button>
          </div>
          <p className="small muted">
            90–100 capacity · 70–89 protection/speed · 40–69 production.
            Not-needed upgrades are never built. Ties are deterministic.
          </p>
          <div className="cc-proposals">
            {view.proposals.map((p, i) => (
              <article
                key={p.id}
                className={`cc-proposal ${view.selection.selected?.id === p.id ? "is-selected" : ""}`}
              >
                <div className="cc-proposal-top">
                  <span className="cc-rank">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>
                      {p.buildingName} <span>→ {p.targetLevel}</span>
                    </h3>
                    <small>{p.villageName} · Economic Advisor</small>
                  </div>
                  <div className="cc-score">
                    <strong>{p.importance}</strong>
                    <small>/100</small>
                  </div>
                  <span className={`cc-status status-${p.status}`}>
                    {p.status}
                  </span>
                </div>
                <p>{p.reason}</p>
                <div className="cc-proposal-cost">
                  {formatResources(p.requirements)}
                </div>
                {p.blockers.length > 0 && (
                  <p className="cc-blockers">
                    {p.blockers
                      .map((b) => b.toLowerCase().replaceAll("_", " "))
                      .join(" · ")}
                    {p.affordableAtTick !== null
                      ? ` · resources at tick ${p.affordableAtTick}`
                      : ""}
                  </p>
                )}
                {view.selection.reservations.some(
                  (r) => r.proposalId === p.id,
                ) && (
                  <p className="cc-saving">
                    Saving for this upgrade; lower-priority spending is held.
                  </p>
                )}
              </article>
            ))}
            {!view.proposals.length && (
              <p className="cc-card muted">
                No proposals yet. Check the connection and selected world in
                Settings.
              </p>
            )}
          </div>
        </section>
        <aside>
          <h2>Recent decisions</h2>
          <p className="small muted">Submitted ≠ accepted ≠ confirmed built.</p>
          <div className="cc-decisions">
            {view.decisions.map((d) => (
              <article key={d.id}>
                <div>
                  <span className={`cc-decision-kind kind-${d.kind}`}>
                    {d.kind}
                  </span>
                  <time>{new Date(d.at).toLocaleTimeString()}</time>
                </div>
                <p>{d.text}</p>
                {d.tick !== undefined && <small>tick {d.tick}</small>}
                {d.clientId && (
                  <details>
                    <summary>Request ID</summary>
                    <code>{d.clientId}</code>
                  </details>
                )}
              </article>
            ))}
          </div>
          {view.pending && (
            <div className="cc-card">
              <h3>Tracked operation</h3>
              <p>
                {view.pending.proposal.buildingName} →{" "}
                {view.pending.proposal.targetLevel}
              </p>
              <span className="cc-status">{view.pending.phase}</span>
              <p className="small muted">
                Tracked until the game confirms completion. Retries reuse the
                original request ID.
              </p>
              {view.pending.phase !== "accepted" && !view.automatic && (
                <>
                  <label className="cc-check">
                    <input
                      type="checkbox"
                      checked={inspected}
                      onChange={(e) => setInspected(e.target.checked)}
                    />
                    I inspected game activity and understand this outcome may be
                    unknown.
                  </label>
                  <button
                    className="btn btn-small"
                    disabled={!inspected}
                    onClick={async () => {
                      try {
                        onChange(
                          await controlRequest<ControlView>(
                            "/pending/resolve",
                            "POST",
                            { acknowledged: inspected },
                          ),
                        );
                        setInspected(false);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Resolve uncertain operation
                  </button>
                </>
              )}
            </div>
          )}
          <div className="cc-card cc-policy">
            <h3>Allocation policy</h3>
            <p>
              The highest needed upgrade reserves this village’s resources until
              affordable. Lower priorities wait; upgrades marked not-needed
              never consume resources.
            </p>
            <p>
              One queued build per village, one new advisor action per cycle.
              Existing build orders block advisor construction. No army or war
              automation.
            </p>
            <Link href="/settings">Connection settings →</Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
function SettingsPage({
  view,
  onChange,
}: {
  view: ControlView;
  onChange(view: ControlView): void;
}) {
  const [url, setUrl] = useState(view.settings.serverUrl),
    [world, setWorld] = useState(view.settings.worldId),
    [draft, setDraft] = useState(""),
    [editing, setEditing] = useState(false),
    [revealed, setRevealed] = useState<string | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await controlRequest<ControlView>("/settings", "PUT", {
        serverUrl: url,
        worldId: world,
        ...(editing ? { apiKey: draft.trim() } : {}),
      });
      if (editing && draft.trim()) setApiKey(draft.trim());
      setDraft("");
      setEditing(false);
      setRevealed(null);
      onChange(next);
      setMessage("Connection updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="cc-main cc-settings">
      <p className="eyebrow">Personal configuration</p>
      <h1>Settings</h1>
      <p className="muted">
        The local service stores your connection privately. The remote server
        remains authoritative for game state.
      </p>
      <section className="cc-card">
        <h2>Game connection</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="field">
            <span>Game server URL</span>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <small>Server origin only, without an API path.</small>
          </label>
          <label className="field">
            <span>Selected world</span>
            <input
              required
              list="cc-worlds"
              value={world}
              onChange={(e) => setWorld(e.target.value)}
            />
            <datalist id="cc-worlds">
              {view.worlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Player API key</span>
            <input
              aria-label="Player API key"
              autoComplete="off"
              type={revealed !== null ? "text" : "password"}
              readOnly={!editing}
              value={editing ? draft : (revealed ?? view.settings.keyHint)}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <div className="row gap wrap">
            <button
              type="button"
              className="btn"
              onClick={async () => {
                try {
                  setRevealed(
                    revealed === null
                      ? editing
                        ? ""
                        : (
                            await controlRequest<{ apiKey: string }>(
                              "/key",
                              "POST",
                              {},
                            )
                          ).apiKey
                      : null,
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {revealed === null ? "Reveal key" : "Hide key"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setEditing(!editing);
                setDraft("");
                setRevealed(null);
              }}
            >
              {editing ? "Cancel key edit" : "Edit key"}
            </button>
          </div>
          <button
            className="btn btn-gold"
            disabled={busy || (editing && !draft.trim())}
          >
            {busy ? "Saving…" : "Save connection"}
          </button>
        </form>
        {message && (
          <p className="command-success" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="error-line" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="cc-card">
        <h2>Connection status</h2>
        <dl className="cc-settings-facts">
          <dt>Status</dt>
          <dd>{view.connection}</dd>
          <dt>Account</dt>
          <dd>{view.account?.name || "Unavailable"}</dd>
          <dt>World</dt>
          <dd>{view.world?.name || view.settings.worldId}</dd>
          <dt>Villages</dt>
          <dd>{view.villages.map((v) => v.name).join(", ") || "None"}</dd>
          <dt>Execution</dt>
          <dd>{view.automatic ? "Bot running" : "Needs attention"}</dd>
        </dl>
        {view.error && <p className="error-line">{view.error}</p>}
      </section>
    </main>
  );
}
