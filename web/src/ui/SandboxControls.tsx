// The sandbox clock, for its creator only: pause, resume, step, speed, run until, and the god view.
// Each button is one POST /sandboxes/{w}/control; the dashboard writes nothing else.
import { useState } from "react";
import type { SandboxControlRequest } from "../contract";
import { SANDBOX } from "../contract";
import { describeFailure } from "../lib/http";
import { selectClock, selectIsCreator, selectSummary, useWorld, useWorldContext } from "./worldContext";

const SPEED_STEPS = [SANDBOX.speedMin, 1, 2, SANDBOX.speedDefault, 10, 25, SANDBOX.speedMax].filter(
  (s, i, all) => s >= SANDBOX.speedMin && s <= SANDBOX.speedMax && all.indexOf(s) === i,
).sort((a, b) => a - b);

export function SandboxControls() {
  const isCreator = useWorld(selectIsCreator);
  const summary = useWorld(selectSummary);
  const clock = useWorld(selectClock);
  const { client, map } = useWorldContext();
  const [god, setGod] = useState(map.overlay.godView);
  // Folded by default on a phone, where it would cover the map.
  const [open, setOpen] = useState(() => !window.matchMedia("(max-width: 760px)").matches);
  const [steps, setSteps] = useState(10);
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isCreator || summary?.kind !== "sandbox") return null;

  const send = async (request: SandboxControlRequest) => {
    setBusy(true);
    setError(null);
    try {
      await client.control(request);
    } catch (e) {
      setError(describeFailure(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleGod = () => {
    map.overlay.godView = !god;
    setGod(!god);
  };

  const ended = clock.status === "ended";
  // A lockstep sandbox is "running" on the server, but it moves only while you wait for events.
  const shownStatus = clock.lockstep && clock.status === "running" ? "lockstep" : clock.status;
  const speeds = SPEED_STEPS.includes(clock.speed) ? SPEED_STEPS : [...SPEED_STEPS, clock.speed].sort((a, b) => a - b);
  const untilTick = Number(until);

  return (
    <div className={`sandbox${open ? " is-open" : ""}`}>
      <button className="sandbox-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="sandbox-title">Sandbox clock</span>
        <span className={`status status-${clock.lockstep && !ended ? "paused" : clock.status}`}>{shownStatus}</span>
      </button>
      {open && (
        <div className="sandbox-body">
          <div className="row gap">
            {clock.status === "paused" ? (
              <button className="btn btn-gold btn-small" disabled={busy || ended} onClick={() => send({ action: "resume" })}>
                ▶ Resume
              </button>
            ) : (
              <button className="btn btn-small" disabled={busy || ended} onClick={() => send({ action: "pause" })}>
                ❚❚ Pause
              </button>
            )}
            <label className="inline-field">
              <span>Speed</span>
              <select value={clock.speed} disabled={busy || ended} onChange={(e) => send({ action: "set_speed", speed: Number(e.target.value) })}>
                {speeds.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row gap">
            <input
              className="num"
              type="number"
              min={1}
              max={SANDBOX.stepMax}
              value={steps}
              onChange={(e) => setSteps(Math.max(1, Math.min(SANDBOX.stepMax, Math.floor(Number(e.target.value) || 1))))}
              aria-label="Ticks to step"
            />
            <button className="btn btn-small" disabled={busy || ended} onClick={() => send({ action: "step", ticks: steps })}>
              Step {steps}
            </button>
          </div>
          <div className="row gap">
            <input
              className="num"
              type="number"
              min={clock.tick + 1}
              max={summary.endsAtTick}
              placeholder={`tick > ${clock.tick}`}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              aria-label="Run until tick"
            />
            <button
              className="btn btn-small"
              disabled={busy || ended || !(untilTick > clock.tick)}
              onClick={() => send({ action: "run_until", tick: Math.floor(untilTick) })}
            >
              Run until
            </button>
            <button className="btn btn-small" disabled={busy || ended} onClick={() => send({ action: "run_until", untilEvent: true })} title="Run until your next event">
              Next event
            </button>
          </div>
          <label className="switch">
            <input type="checkbox" checked={god} onChange={toggleGod} />
            <span className="switch-track" />
            <span>God view: every army on the map</span>
          </label>
          {summary.seed !== undefined && <div className="muted small mono">seed {summary.seed}</div>}
          {error && <p className="error-line small">{error}</p>}
        </div>
      )}
    </div>
  );
}
