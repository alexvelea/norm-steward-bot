import { useEffect, useState } from "react";
import type { Action, UnitCounts, UnitId } from "../../contract";
import { BUILDINGS, UNITS, UNIT_IDS } from "../../contract";
import { useManualActions } from "./useManualActions";
import { Empty, Section } from "../common";
import { selectClock, selectMap, selectPlayerId, selectState, useWorld, useWorldContext } from "../worldContext";
import { SendResources } from "./SendResources";
import { VillagePicker } from "./VillagePicker";

export function CommandTab({ villageId, onVillage }: { villageId: string; onVillage(id: string): void }) {
  const state = useWorld(selectState);
  const clock = useWorld(selectClock);
  const worldMap = useWorld(selectMap);
  const playerId = useWorld(selectPlayerId);
  const { selectedId } = useWorldContext();
  const village = state?.villages.find((v) => v.id === villageId);
  const { busy, message, failed, retry, setRetry, submit } = useManualActions();
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<"attack" | "support">("attack");
  const [troops, setTroops] = useState<UnitCounts>({});
  useEffect(() => {
    if (selectedId && selectedId !== villageId) setTarget(selectedId);
  }, [selectedId, villageId]);
  useEffect(() => {
    setTroops({});
  }, [villageId]);
  if (!state || !village) return <Empty>No village to command.</Empty>;
  const cooldown = state.player.nextActTick !== null && state.player.nextActTick > clock.tick;
  const unavailable = busy || !!retry || clock.status === "ended" || cooldown;
  const targets = [...worldMap.villages.values()]
    .filter((v) => v.id !== villageId)
    .sort((a, b) => Math.hypot(a.x - village.x, a.y - village.y) - Math.hypot(b.x - village.x, b.y - village.y));

  const ownIds = new Set(state.villages.map((v) => v.id));
  const allied = (v: typeof targets[number]) => ownIds.has(v.id) || (!!playerId && v.ownerId === playerId);
  const command = (a: Action) => void submit([a]);
  const targetField = (
    <label className="field">
      <span>Target village · or click it on the map</span>
      <select value={target} onChange={(e) => setTarget(e.target.value)} required>
        <option value="">Choose a target</option>
        {[{ label: "Allied", villages: targets.filter(allied) }, { label: "Enemy & hamlets", villages: targets.filter((v) => !allied(v)) }].map((group) => (
          <optgroup label={group.label} key={group.label}>
            {group.villages.map((v) => <option value={v.id} key={v.id}>{v.name} ({v.x}|{v.y}) · {Math.hypot(v.x - village.x, v.y - village.y).toFixed(1)} fields · {v.ownerName ?? "unowned"}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );

  return (
    <div className="tab-page command-page">
      <VillagePicker state={state} value={villageId} onChange={onVillage} />
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
        <SendResources key={village.id} village={village} villages={state.villages} disabled={unavailable} command={command} />
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
      </fieldset>
    </div>
  );
}
