import { useState } from "react";
import type { Action, Resources, VillageState } from "../../contract";
import { MARKET, RESOURCES } from "../../contract";
import { Empty, Section } from "../common";
import { clampCargo, resourceLimit, supplyTargets } from "./trade";

export function SendResources({ village, villages, disabled, command }: {
  village: VillageState; villages: VillageState[]; disabled: boolean; command(action: Action): void;
}) {
  const [requested, setRequested] = useState<Partial<Resources>>({});
  const [target, setTarget] = useState("");
  const capacity = village.merchants.available * MARKET.merchantCarry;
  const cargo = clampCargo(requested, village.resources, capacity);
  const total = RESOURCES.reduce((sum, r) => sum + cargo[r], 0);
  const targets = supplyTargets(village, villages);
  const valid = !disabled && total > 0 && targets.some((v) => v.id === target);
  return (
    <Section title="Send resources" aside={<span className="muted small">{village.merchants.available}/{village.merchants.total} merchants</span>}>
      <fieldset disabled={disabled} className="command-fieldset">
        <form className="command-form" onSubmit={(e) => {
          e.preventDefault();
          if (valid) command({ type: "trade", village: village.id, target, resources: cargo });
        }}>
          <p className="muted small">Carry capacity: {capacity.toLocaleString()} resources · {total.toLocaleString()} selected.</p>
          <label className="field">
            <span>Your other villages</span>
            <select value={targets.some((v) => v.id === target) ? target : ""} onChange={(e) => setTarget(e.target.value)} required>
              <option value="">Choose your village</option>
              {targets.map((v) => <option value={v.id} key={v.id}>{v.name} · {Math.hypot(v.x - village.x, v.y - village.y).toFixed(1)} fields</option>)}
            </select>
          </label>
          {!targets.length && <Empty>No other villages to supply.</Empty>}
          <div className="command-unit-grid">
            {RESOURCES.map((r) => {
              const max = resourceLimit(r, cargo, village.resources, capacity);
              return <label className="field" key={r}>
                <span>{r} · {Math.floor(village.resources[r]).toLocaleString()} available <button className="btn btn-small" type="button" onClick={() => setRequested({ ...cargo, [r]: max })}>max</button></span>
                <input type="number" min={0} max={max} step={1} required value={cargo[r]} onChange={(e) => setRequested({ ...cargo, [r]: Math.max(0, Math.min(max, Number.isFinite(e.target.valueAsNumber) ? Math.floor(e.target.valueAsNumber) : 0)) })} />
              </label>;
            })}
          </div>
          <button className="btn" disabled={!valid}>Send resources</button>
        </form>
      </fieldset>
    </Section>
  );
}
