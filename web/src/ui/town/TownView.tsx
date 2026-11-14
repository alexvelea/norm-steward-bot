import { useEffect, useRef, useState } from "react";
import type { Action, BuildingId, RulesTables, RulesResponse, VillageState } from "../../contract";
import { BUILDINGS, BUILDING_IDS, RESOURCES } from "../../contract";
import { apiGet, ApiFailure, describeFailure } from "../../lib/http";
import { useApiKey } from "../../lib/keyStore";
import { formatInt, formatTicksAsTime } from "../../lib/format";
import { isFlowing, paceOf, useLiveTick } from "../../world/clock";
import { Countdown, Meter } from "../common";
import { selectClock, selectState, useWorld, useWorldContext } from "../worldContext";
import { BuildingArt } from "./BuildingArt";
import { buildingBenefit, buildingImprovement, buildingUnlocks, buildProgress } from "./buildings";

// Positions are presentation only; the village's actual world coordinates remain on the world map.
const PLOTS: Record<BuildingId, [number, number]> = {
  lumberyard: [13, 18],
  farm: [14, 76],
  quarry: [84, 18],
  mine: [87, 44],
  hall: [49, 39],
  storehouse: [31, 22],
  cellar: [31, 70],
  barracks: [12, 47],
  smithy: [68, 25],
  stable: [70, 70],
  workshop: [86, 76],
  market: [50, 72],
  wall: [50, 91],
  watchtower: [50, 10],
  court: [30, 47],
};

export function TownView({ onClose }: { onClose(): void }) {
  const state = useWorld(selectState);
  const { selectedId } = useWorldContext();
  const village = state?.villages.find((v) => v.id === selectedId) ?? state?.villages[0];
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      previous?.focus();
    };
  }, [onClose]);
  if (!state || !village) return null;
  return (
    <div ref={dialog} className="town-window" role="dialog" aria-label="Town view" tabIndex={-1}>
      <TownBody key={`${state.world.id}:${state.world.epoch}:${village.id}`} village={village} onClose={onClose} />
    </div>
  );
}

function TownBody({ village, onClose }: { village: VillageState; onClose(): void }) {
  const state = useWorld(selectState)!;
  const clock = useWorld(selectClock);
  const tick = useLiveTick(clock);
  const { client, select } = useWorldContext();
  const key = useApiKey();
  const [building, setBuilding] = useState<BuildingId>(village.buildQueue[0]?.building ?? "hall");
  const [tables, setTables] = useState<RulesTables | null>(null);
  const [rulesError, setRulesError] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<Action | null>(null);
  const lock = useRef(false);
  const details = useRef<HTMLElement>(null);
  const grounds = useRef<HTMLDivElement>(null);
  const levels = useRef<HTMLDivElement>(null);
  const chooseBuilding = (id: BuildingId) => {
    setBuilding(id);
    if (matchMedia("(max-width: 800px)").matches) details.current?.scrollIntoView({ block: "start" });
  };
  useEffect(() => {
    const abort = new AbortController();
    apiGet<RulesResponse>(`/worlds/${encodeURIComponent(state.world.id)}/rules`, key, abort.signal)
      .then((r) => {
        if (!abort.signal.aborted) setTables(r.tables);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setRulesError(describeFailure(e));
      });
    return () => abort.abort();
  }, [state.world.id, key]);
  const rule = BUILDINGS[building];
  const level = village.buildings[building];
  useEffect(() => {
    const container = levels.current;
    const row = container?.querySelector<HTMLElement>("tr.is-current");
    if (container) container.scrollTop = row ? Math.max(0, row.offsetTop - 80) : 0;
  }, [building, level, tables]);
  const option = village.options.build.find((o) => o.building === building);
  const queued = village.buildQueue.filter((q) => q.building === building);
  const next = option?.level ?? level;
  const atMax = level + queued.length >= rule.maxLevel;
  const turnBlocked = state.player.nextActTick !== null && state.player.nextActTick > tick;
  const blocked = busy || !!retry || clock.status === "ended" || turnBlocked;
  const unlocks = buildingUnlocks(building, next - 1, next);
  const active = village.buildQueue[0];

  async function act(action: Action, reuse = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    const request = reuse ? action : { ...action, clientId: `ui-${crypto.randomUUID()}` };
    try {
      const response = await client.act([request]);
      const result = response.results[0];
      setRetry(null);
      if (!result?.ok) {
        setFailed(true);
        setMessage(result && !result.ok ? `${result.error.code}: ${result.error.message}` : "No action result returned.");
      } else
        setMessage(
          request.type === "build"
            ? `${BUILDINGS[request.building].name} upgrade queued.`
            : "Construction cancelled. Later queued levels of the same building may also be removed.",
        );
    } catch (e) {
      const uncertain = e instanceof ApiFailure && (e.status === 0 || e.status >= 500);
      setRetry(uncertain ? request : null);
      setFailed(true);
      setMessage(describeFailure(e) + (uncertain ? " Outcome unknown. Retry safely with the same command ID." : ""));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <header className="town-header">
        <div className="town-heading">
          <span className="eyebrow">Your holding</span>
          <h2>{village.name}</h2>
          <span className="muted small">
            {village.x}|{village.y} · {formatInt(village.points)} points
          </span>
        </div>
        <div className="town-resources">
          {RESOURCES.map((r) => {
            const amount = Math.min(
              village.storage,
              village.resourcesMilli[r] / 1000 + (Math.max(0, tick - state.world.tick) * village.productionPerTickMilli[r]) / 1000,
            );
            return (
              <div key={r}>
                <span className={`res res-${r}`}>{r}</span>
                <strong>{formatInt(amount)}</strong>
                <small>+{formatInt(village.production[r])}/min</small>
              </div>
            );
          })}
        </div>
        {state.villages.length > 1 && (
          <label className="town-village">
            <span className="sr-only">Town village</span>
            <select value={village.id} onChange={(e) => select(e.target.value, true)}>
              {state.villages.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="icon-btn town-close" onClick={onClose} aria-label="Close town view">
          ×
        </button>
      </header>
      <div className="town-content">
        <main className="town-overview">
          <div className="town-scene" ref={grounds}>
            <div className="town-scene-caption">
              <span className="eyebrow">Village grounds</span>
              <span>Choose a building to inspect & upgrade</span>
            </div>
            <svg className="town-land" viewBox="0 0 800 520" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <radialGradient id="town-meadow">
                  <stop stopColor="#7b8460" />
                  <stop offset="1" stopColor="#384c3d" />
                </radialGradient>
                <pattern id="town-fields" width="12" height="12" patternTransform="rotate(24)" patternUnits="userSpaceOnUse">
                  <path d="M0 0V12" stroke="#c3ab6c" strokeWidth="5" opacity=".35" />
                </pattern>
              </defs>
              <path d="M0 0H800V520H0Z" fill="url(#town-meadow)" />
              <path d="M-20 375Q90 302 166 371T355 395T540 443T820 402" stroke="#415f5c" strokeWidth="33" fill="none" opacity=".7" />
              <path d="m72 330 130-17 42 125-140 19Z" fill="#a99b57" opacity=".3" />
              <path d="m72 330 130-17 42 125-140 19Z" fill="url(#town-fields)" />
              <path
                d="M397 37V466M93 242Q400 180 710 220M111 100 644 384M689 82 251 372M239 112 246 373M565 106 557 384"
                stroke="#a39b7b"
                strokeWidth="14"
                fill="none"
                opacity=".4"
                strokeLinecap="round"
              />
              <path
                d="M397 37V466M93 242Q400 180 710 220M111 100 644 384M689 82 251 372M239 112 246 373M565 106 557 384"
                stroke="#c9bb91"
                strokeWidth="2"
                strokeDasharray="2 7"
                fill="none"
                opacity=".3"
              />
              <ellipse cx="395" cy="247" rx="69" ry="43" fill="#b5a684" opacity=".25" />
              <path d="M62 88 385 19 737 92 765 410 401 497 40 414Z" stroke="#afaa8e" strokeWidth="5" fill="none" opacity=".25" />
              {Array.from({ length: 26 }, (_, i) => {
                const left = i < 13;
                const x = left ? 17 + (i % 3) * 13 : 758 + (i % 3) * 13;
                const y = 18 + (i % 13) * 38;
                return (
                  <g key={i}>
                    <ellipse cx={x} cy={y + 21} rx="14" ry="6" fill="#1e3429" opacity=".2" />
                    <path d={`M${x} ${y - 10}l-15 29h30Z`} fill={i % 2 ? "#2d4937" : "#3e5b40"} />
                    <path d={`M${x} ${y + 13}v13`} stroke="#4d4836" strokeWidth="3" />
                  </g>
                );
              })}
            </svg>
            {BUILDING_IDS.map((id) => {
              const items = village.buildQueue.filter((q) => q.building === id);
              const current = items.find((q) => q.startTick !== null);
              const built = village.buildings[id] > 0;
              return (
                <button
                  key={id}
                  className={`town-plot${building === id ? " is-selected" : ""}${!built ? " is-unbuilt" : ""}${current ? " is-building" : ""}`}
                  style={{ left: `${PLOTS[id][0]}%`, top: `${PLOTS[id][1]}%` }}
                  onClick={() => chooseBuilding(id)}
                  aria-label={`${BUILDINGS[id].name}, level ${village.buildings[id]}${items.length ? `, ${items.length} queued` : ""}`}
                  aria-pressed={building === id}
                >
                  <BuildingArt id={id} />
                  <span className="town-plot-label">
                    {BUILDINGS[id].name}
                    <b>{village.buildings[id]}</b>
                  </span>
                  {current && (
                    <span className="town-plot-work">
                      <span style={{ width: `${buildProgress(current, tick) * 100}%` }} />
                    </span>
                  )}
                  {!current && items.length > 0 && <span className="town-plot-queued">Queued +{items.length}</span>}
                </button>
              );
            })}
          </div>
          <nav className="town-building-bar" aria-label="Village buildings">
            {BUILDING_IDS.map((id) => (
              <button
                key={id}
                className={building === id ? "is-selected" : ""}
                onClick={() => chooseBuilding(id)}
                aria-pressed={building === id}
                title={`${BUILDINGS[id].name}: ${BUILDINGS[id].description}${tables && village.buildings[id] < BUILDINGS[id].maxLevel ? ` · Next level: ${buildingImprovement(id, village.buildings[id], village.buildings[id] + 1, tables)}` : ""}`}
              >
                <BuildingArt id={id} />
                <span>{BUILDINGS[id].name}</span>
                <b>
                  {village.buildings[id]}
                  <small>/{BUILDINGS[id].maxLevel}</small>
                </b>
              </button>
            ))}
          </nav>
          <section className="town-queue" aria-label="Construction queue">
            <header>
              <h3>Construction</h3>
              <span>{village.buildQueue.length} queued</span>
            </header>
            {active ? (
              <>
                <div className="town-queue-active">
                  <strong>
                    {BUILDINGS[active.building].name} <span className="gold">→ {active.level}</span>
                  </strong>
                  <Countdown until={active.endTick} tick={tick} speed={paceOf(clock)} paused={!isFlowing(clock)} />
                </div>
                <div
                  role="progressbar"
                  aria-label="Current construction progress"
                  aria-valuenow={Math.round(buildProgress(active, tick) * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <Meter value={buildProgress(active, tick)} max={1} />
                </div>
                <div className="town-queue-chips">
                  {village.buildQueue.map((q, i) => (
                    <button key={q.id} onClick={() => chooseBuilding(q.building)} className={i === 0 ? "is-active" : ""}>
                      {i === 0 ? "Building" : "Waiting"} · {BUILDINGS[q.building].name} {q.level}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted small">Your builders are idle. Select a building to queue an upgrade.</p>
            )}
          </section>
        </main>
        <aside className="town-details" aria-label="Building details" ref={details}>
          <button className="btn btn-small town-back" onClick={() => grounds.current?.scrollIntoView({ block: "start" })}>
            ↑ Village grounds
          </button>
          <header className="town-detail-heading">
            <BuildingArt id={building} />
            <div>
              <span className="eyebrow">Building details</span>
              <h3>{rule.name}</h3>
              <span className="muted small">
                Level {level} / {rule.maxLevel}
                {queued.length > 0 ? ` · ${queued.length} queued` : ""}
              </span>
            </div>
          </header>
          <p className="town-description">{rule.description}</p>
          <div className="town-level-track" aria-label={`Building level ${level} of ${rule.maxLevel}`}>
            <Meter value={level} max={rule.maxLevel} />
          </div>
          {tables && (
            <div className="town-effect">
              <div>
                <span>Current</span>
                <strong>{buildingBenefit(building, level, tables)}</strong>
              </div>
              {!atMax && (
                <div>
                  <span>
                    At level {next}
                    {queued.length > 0 ? " · after queue" : ""}
                  </span>
                  <strong>{buildingBenefit(building, next, tables)}</strong>
                </div>
              )}
            </div>
          )}
          {tables && !atMax && (
            <div className="town-upgrade-gain">
              <span>
                This upgrade · level {next - 1} → {next}
              </span>
              <strong>{buildingImprovement(building, next - 1, next, tables)}</strong>
              {building === "hall" && (
                <small>Time saved relative to the previous hall level. Individual build times are rounded to whole ticks.</small>
              )}
            </div>
          )}
          {!atMax && option && (
            <section className="town-upgrade">
              <header>
                <h4>
                  {level === 0 && queued.length === 0 ? "Construct" : "Upgrade to"} level {next}
                </h4>
                <span>
                  {formatTicksAsTime(option.ticks, paceOf(clock))}
                  {clock.lockstep ? "" : " build time"}
                </span>
              </header>
              <div className="town-costs">
                {RESOURCES.map((r) => (
                  <div key={r} className={village.resources[r] < option.cost[r] ? "is-short" : ""}>
                    <span className={`res res-${r}`}>{r}</span>
                    <strong>{formatInt(option.cost[r])}</strong>
                    <small>
                      {village.resources[r] < option.cost[r]
                        ? `${formatInt(option.cost[r] - village.resources[r])} short`
                        : `${formatInt(village.resources[r])} available`}
                    </small>
                  </div>
                ))}
              </div>
              <p className="muted small">
                +{option.pop} population used{tables ? ` · +${tables.buildings[building][next - 1]?.points ?? 0} points` : ""}
              </p>
              <button
                className="btn btn-gold town-upgrade-button"
                disabled={blocked || !option.ok}
                onClick={() => void act({ type: "build", village: village.id, building })}
              >
                {busy ? "Sending order…" : `Queue ${level === 0 && queued.length === 0 ? "construction" : "upgrade"} · level ${next}`}
              </button>
              {!option.ok && (
                <p className="town-blockers">
                  {option.blockers.map((b) => b.toLowerCase().replaceAll("_", " ")).join(" · ")}
                  {option.affordableAtTick !== null ? ` · affordable at tick ${option.affordableAtTick}` : ""}
                </p>
              )}
            </section>
          )}
          {atMax && <p className="town-max">{level >= rule.maxLevel ? "Maximum level reached." : "Maximum level already queued."}</p>}
          {turnBlocked && <p className="warn-line small">Next Council turn: tick {state.player.nextActTick}.</p>}
          {clock.status === "ended" && <p className="warn-line small">This round has ended.</p>}
          {message && (
            <p role="status" className={failed ? "error-line" : "command-success"}>
              {message}
            </p>
          )}
          {retry && (
            <div className="command-retry">
              <button className="btn btn-small" disabled={busy} onClick={() => void act(retry, true)}>
                Retry same order
              </button>
              <button className="btn btn-small" disabled={busy} onClick={() => setRetry(null)}>
                Dismiss
              </button>
            </div>
          )}
          {queued.length > 0 && (
            <section className="town-detail-section">
              <h4>Queued for this building</h4>
              {queued.map((q) => (
                <div className="town-queued-item" key={q.id}>
                  <span>
                    Level {q.level} · {q.startTick === null ? "waiting" : `${Math.round(buildProgress(q, tick) * 100)}% built`}
                    <small>
                      Done <Countdown until={q.endTick} tick={tick} speed={paceOf(clock)} paused={!isFlowing(clock)} />
                    </small>
                  </span>
                  <button
                    className="btn btn-small"
                    disabled={blocked}
                    onClick={() => void act({ type: "cancel_build", village: village.id, item: q.id })}
                  >
                    Cancel
                  </button>
                </div>
              ))}
              <p className="muted small">
                In-progress work gets a partial refund. Cancelling also removes later queued levels of this building.
              </p>
            </section>
          )}
          {Object.keys(rule.requires).length > 0 && (
            <section className="town-detail-section">
              <h4>Requirements</h4>
              <div className="town-requirements">
                {Object.entries(rule.requires).map(([id, needed]) => (
                  <button
                    key={id}
                    className={village.buildings[id as BuildingId] >= needed ? "is-met" : ""}
                    onClick={() => chooseBuilding(id as BuildingId)}
                  >
                    {village.buildings[id as BuildingId] >= needed ? "✓" : "○"} {BUILDINGS[id as BuildingId].name} {needed}
                  </button>
                ))}
              </div>
            </section>
          )}
          {unlocks.length > 0 && !atMax && (
            <p className="town-unlocks">
              <strong>Opens the path to:</strong> {unlocks.join(", ")}. Other requirements still apply.
            </p>
          )}
          {tables && building === "hall" && !atMax && (
            <section className="town-detail-section town-hall-impact">
              <h4>Construction impact</h4>
              <p className="muted small">
                Exact rounded times at hall {level} → {next}. Active construction keeps its existing timer.
              </p>
              <div className="town-level-table">
                <table>
                  <thead>
                    <tr>
                      <th>Building · target level</th>
                      <th>Hall {level}</th>
                      <th>Hall {next}</th>
                      <th>Saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {village.options.build
                      .filter((o) => village.buildings[o.building] < BUILDINGS[o.building].maxLevel)
                      .map((o) => {
                        const row = tables.buildings[o.building][o.level - 1];
                        const before = row.ticksByHall[level];
                        const after = row.ticksByHall[next];
                        return (
                          <tr key={o.building}>
                            <th scope="row">
                              {BUILDINGS[o.building].name} · {o.level}
                            </th>
                            <td>{formatTicksAsTime(before, paceOf(clock))}</td>
                            <td>{formatTicksAsTime(after, paceOf(clock))}</td>
                            <td>{formatTicksAsTime(before - after, paceOf(clock))}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <section className="town-detail-section">
            <h4>Level progression</h4>
            <p className="muted small">Costs per level · benefits at that level. Build times use your current hall.</p>
            {tables ? (
              <div className="town-level-table" ref={levels} tabIndex={0} aria-label="Building level costs and benefits">
                <table>
                  <thead>
                    <tr>
                      <th>Level</th>
                      <th>Timber</th>
                      <th>Stone</th>
                      <th>Iron</th>
                      <th>Time</th>
                      <th>Effect / improvement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.buildings[building].map((row) => (
                      <tr
                        key={row.level}
                        className={
                          row.level === level
                            ? "is-current"
                            : queued.some((q) => q.level === row.level)
                              ? "is-queued"
                              : row.level === next && !atMax
                                ? "is-next"
                                : ""
                        }
                      >
                        <th scope="row">
                          {row.level}
                          <small>
                            {row.level === level
                              ? "current"
                              : queued.some((q) => q.level === row.level)
                                ? "queued"
                                : row.level === next && !atMax
                                  ? "next"
                                  : ""}
                          </small>
                        </th>
                        {RESOURCES.map((r) => (
                          <td key={r}>{formatInt(row.cost[r])}</td>
                        ))}
                        <td>{formatTicksAsTime(row.ticksByHall[village.buildings.hall], paceOf(clock))}</td>
                        <td>
                          <span>{buildingBenefit(building, row.level, tables)}</span>
                          <small className="town-row-gain">{buildingImprovement(building, row.level - 1, row.level, tables)}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small">{rulesError ? `Level tables unavailable: ${rulesError}` : "Loading live level tables…"}</p>
            )}
          </section>
          <p className="town-footnote">Orders go to the live engine. Your steward and standing orders continue alongside you.</p>
        </aside>
      </div>
    </>
  );
}
