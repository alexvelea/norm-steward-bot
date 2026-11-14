import { useEffect, useRef, useState } from "react";
import type { Action, UnitCounts, UnitId, Resource } from "../../contract";
import { BUILDINGS, LIMITS, RESOURCES, UNITS, UNIT_IDS } from "../../contract";
import { formatResources } from "../../lib/format";
import { ApiFailure, describeFailure } from "../../lib/http";
import { Empty, Section } from "../common";
import { selectClock, selectMap, selectState, useWorld, useWorldContext } from "../worldContext";
import { VillagePicker } from "./VillagePicker";

export function CommandTab({ villageId, onVillage }: { villageId: string; onVillage(id: string): void }) {
  const state = useWorld(selectState);
  const clock = useWorld(selectClock);
  const worldMap = useWorld(selectMap);
  const { client, selectedId } = useWorldContext();
  const village = state?.villages.find((v) => v.id === villageId);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState<Action[] | null>(null);
  const [unit, setUnit] = useState<UnitId>("pikeman");
  const [count, setCount] = useState(1);
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<"attack" | "support">("attack");
  const [troops, setTroops] = useState<UnitCounts>({});
  const [cargo, setCargo] = useState<Partial<Record<Resource, number>>>({});
  const [name, setName] = useState("");
  useEffect(() => {
    if (selectedId && selectedId !== villageId) setTarget(selectedId);
  }, [selectedId, villageId]);
  useEffect(() => {
    setTroops({});
    setCargo({});
    setName("");
  }, [villageId]);
  if (!state || !village) return <Empty>No village to command.</Empty>;
  const training = village.options.train.find((o) => o.unit === unit);
  const cooldown = state.player.nextActTick !== null && state.player.nextActTick > clock.tick;
  const unavailable = busy || !!retry || clock.status === "ended" || cooldown;
  const targets = [...worldMap.villages.values()]
    .filter((v) => v.id !== villageId)
    .sort((a, b) => Math.hypot(a.x - village.x, a.y - village.y) - Math.hypot(b.x - village.x, b.y - village.y));

  async function submit(actions: Action[], isRetry = false) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    const request = isRetry ? actions : actions.map((a) => ({ ...a, clientId: `ui-${crypto.randomUUID()}` }));
    try {
      const response = await client.act(request);
      const errors = response.results.filter((r) => !r.ok);
      setRetry(null);
      setFailed(errors.length > 0);
      setMessage(
        response.results
          .map((r) => (r.ok ? `${r.type}: accepted at tick ${response.tick}.` : `${r.type}: ${r.error.code} — ${r.error.message}`))
          .join(" "),
      );
    } catch (error) {
      const uncertain = error instanceof ApiFailure && (error.status === 0 || error.status >= 500);
      setRetry(uncertain ? request : null);
      setFailed(true);
      setMessage(
        describeFailure(error) + (uncertain ? " The outcome is unknown. Retry uses the same command IDs to avoid duplicates." : ""),
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const command = (a: Action) => void submit([a]);
  const targetField = (
    <label className="field">
      <span>Target village · or click it on the map</span>
      <select value={target} onChange={(e) => setTarget(e.target.value)} required>
        <option value="">Choose a target</option>
        {targets.map((v) => (
          <option value={v.id} key={v.id}>
            {v.name} ({v.x}|{v.y}) · {v.ownerName ?? "unowned"}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="tab-page command-page">
      <VillagePicker state={state} value={villageId} onChange={onVillage} />
      <div className="command-intro">
        <p className="eyebrow">Hybrid command</p>
        <h2>{village.name}</h2>
        <p className="muted small">
          Give orders alongside your steward. Bots and standing orders keep running and share your resources, queues and Council turn.
        </p>
      </div>
      {cooldown && <p className="warn-line">Next Council turn: tick {state.player.nextActTick}.</p>}
      {clock.status === "ended" && <p className="warn-line">This round has ended.</p>}
      {message && (
        <div className={failed ? "error-line" : "command-success"} role="status">
          {message}
        </div>
      )}
      {retry && (
        <div className="command-retry">
          <button className="btn" disabled={busy} onClick={() => void submit(retry, true)}>
            Retry same command
          </button>
          <button className="btn" disabled={busy} onClick={() => setRetry(null)}>
            Dismiss uncertain result
          </button>
        </div>
      )}
      <fieldset disabled={unavailable} className="command-fieldset" aria-busy={busy}>
        <Section title="Build & upgrade" aside={<span className="muted small">{village.buildQueue.length} queued</span>}>
          <div className="command-builds">
            {village.options.build.map((o) => (
              <div className="command-build" key={o.building}>
                <div>
                  <strong>
                    {BUILDINGS[o.building].name} <span className="gold">→ {o.level}</span>
                  </strong>
                  <small>
                    {formatResources(o.cost)} · {o.ticks} ticks
                  </small>
                  {!o.ok && <small className="muted">{o.blockers.map((b) => b.toLowerCase().replaceAll("_", " ")).join(", ")}</small>}
                </div>
                <button
                  className="btn btn-small"
                  disabled={!o.ok}
                  onClick={() => command({ type: "build", village: villageId, building: o.building })}
                >
                  Queue
                </button>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Train troops">
          <form
            className="command-form"
            onSubmit={(e) => {
              e.preventDefault();
              command({ type: "train", village: villageId, unit, count });
            }}
          >
            <label className="field">
              <span>Unit</span>
              <select value={unit} onChange={(e) => setUnit(e.target.value as UnitId)}>
                {UNIT_IDS.map((id) => (
                  <option key={id} value={id}>
                    {UNITS[id].name}
                  </option>
                ))}
              </select>
            </label>
            {training && (
              <p className="muted small">
                Each: {formatResources(training.cost)} · {training.ticksEach} ticks. Available to train: {training.maxCount}.
                {!training.ok && ` ${training.blockers.join(", ")}`}
              </p>
            )}
            <label className="field">
              <span>Number</span>
              <input
                type="number"
                min={1}
                max={training?.maxCount || 1}
                step={1}
                required
                value={count}
                onChange={(e) => setCount(e.target.valueAsNumber)}
              />
            </label>
            <button className="btn" disabled={!training?.ok || !Number.isSafeInteger(count) || count < 1 || count > training.maxCount}>
              Queue training
            </button>
          </form>
        </Section>
        <Section title="March troops">
          <form
            className="command-form"
            onSubmit={(e) => {
              e.preventDefault();
              command({
                type: "send",
                village: villageId,
                target,
                kind,
                units: Object.fromEntries(Object.entries(troops).filter(([, n]) => n > 0)) as UnitCounts,
              });
            }}
          >
            {targetField}
            <label className="field">
              <span>Mission</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="attack">Attack / scout</option>
                <option value="support">Support</option>
              </select>
            </label>
            <div className="command-unit-grid">
              {UNIT_IDS.filter((id) => (village.units.home[id] ?? 0) > 0).map((id) => (
                <label className="field" key={id}>
                  <span>
                    {UNITS[id].name} · {village.units.home[id]} home
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={village.units.home[id]}
                    step={1}
                    required
                    value={troops[id] ?? 0}
                    onChange={(e) => setTroops({ ...troops, [id]: e.target.valueAsNumber })}
                  />
                </label>
              ))}
            </div>
            {!Object.values(village.units.home).some((n) => n > 0) && <Empty>Train troops before sending a march.</Empty>}
            {state.player.protectedUntilTick !== null && state.player.protectedUntilTick > clock.tick && (
              <p className="warn-line">A successful troop dispatch ends your beginner protection.</p>
            )}
            <button
              className="btn"
              disabled={
                !target ||
                !Object.values(troops).some((n) => n > 0) ||
                Object.entries(troops).some(([id, n]) => !Number.isSafeInteger(n) || n < 0 || n > (village.units.home[id as UnitId] ?? 0))
              }
            >
              Send {kind === "attack" ? "attack / scout" : "support"}
            </button>
          </form>
        </Section>
        <Section title="Send resources" aside={<span className="muted small">{village.merchants.available} merchants available</span>}>
          <form
            className="command-form"
            onSubmit={(e) => {
              e.preventDefault();
              command({ type: "trade", village: villageId, target, resources: cargo });
            }}
          >
            {targetField}
            <div className="command-unit-grid">
              {RESOURCES.map((r) => (
                <label className="field" key={r}>
                  <span>{r}</span>
                  <input
                    type="number"
                    min={0}
                    max={village.resources[r]}
                    step={1}
                    required
                    value={cargo[r] ?? 0}
                    onChange={(e) => setCargo({ ...cargo, [r]: e.target.valueAsNumber })}
                  />
                </label>
              ))}
            </div>
            <button
              className="btn"
              disabled={
                !target ||
                village.merchants.available === 0 ||
                !Object.values(cargo).some((n) => n > 0) ||
                Object.entries(cargo).some(([r, n]) => !Number.isSafeInteger(n) || n < 0 || n > village.resources[r as Resource])
              }
            >
              Send resources
            </button>
          </form>
        </Section>
        <Section title="Manage orders">
          <p className="muted small">Cancelling work in progress refunds only part of its cost. Standing orders may queue replacements.</p>
          {village.buildQueue.map((q) => (
            <div className="command-row" key={q.id}>
              <span>
                {BUILDINGS[q.building].name} → {q.level}
              </span>
              <button className="btn btn-small" onClick={() => command({ type: "cancel_build", village: villageId, item: q.id })}>
                Cancel build
              </button>
            </div>
          ))}
          {Object.values(village.training)
            .flat()
            .map((q) => (
              <div className="command-row" key={q.id}>
                <span>
                  {q.remaining} {UNITS[q.unit].name}
                </span>
                <button className="btn btn-small" onClick={() => command({ type: "cancel_train", village: villageId, batch: q.id })}>
                  Cancel training
                </button>
              </div>
            ))}
          {state.commands.outgoing
            .filter((c) => c.from.id === villageId && !c.returning)
            .map((c) => (
              <div className="command-row" key={c.id}>
                <span>
                  {c.kind} → {c.to.name}
                </span>
                <button
                  className="btn btn-small"
                  disabled={c.cancellableUntilTick === null || c.cancellableUntilTick < clock.tick}
                  onClick={() => command({ type: "cancel_command", command: c.id })}
                >
                  Cancel march
                </button>
              </div>
            ))}
          {village.supportAbroad.map((s) => (
            <div className="command-row" key={s.at.id}>
              <span>Support at {s.at.name}</span>
              <button className="btn btn-small" onClick={() => command({ type: "recall", village: s.at.id, home: villageId })}>
                Recall all
              </button>
            </div>
          ))}
          {village.supportHere.map((s) => (
            <div className="command-row" key={s.home.id}>
              <span>Support from {s.home.name}</span>
              <button className="btn btn-small" onClick={() => command({ type: "send_back", village: villageId, home: s.home.id })}>
                Send back
              </button>
            </div>
          ))}
          {state.scheduled.map((s) => (
            <div className="command-row" key={s.id}>
              <span>
                {s.action.type} at tick {s.atTick}
              </span>
              <button className="btn btn-small" onClick={() => command({ type: "cancel_scheduled", scheduled: s.id })}>
                Cancel scheduled
              </button>
            </div>
          ))}
          {!village.buildQueue.length && !Object.values(village.training).flat().length && (
            <Empty>No construction or training queued.</Empty>
          )}
        </Section>
        <Section title="Rename village">
          <form
            className="command-form"
            onSubmit={(e) => {
              e.preventDefault();
              command({ type: "rename", village: villageId, name: name.trim() });
            }}
          >
            <label className="field">
              <span>New village name</span>
              <input
                value={name}
                maxLength={LIMITS.villageNameMax}
                required
                onChange={(e) => setName(e.target.value)}
                placeholder={village.name}
              />
            </label>
            <button className="btn" disabled={!name.trim() || (village.renameReadyTick !== null && village.renameReadyTick > clock.tick)}>
              Rename
            </button>
          </form>
        </Section>
      </fieldset>
    </div>
  );
}
