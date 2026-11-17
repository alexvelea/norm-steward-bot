// Holding: one village's resources against storage, production, population, buildings by level, the
// build queue as a timeline, and each training queue. Resources tick up live between state messages
// from the village's own production figures, capped at storage, as the server will.
import { useState } from "react";
import { blockerMessage, buildingNeeds, unitNeeds } from "./requirements";
import type { Action, UnitId, BuildQueueItem, Resource, TrainingBuilding, VillageState } from "../../contract";
import { BUILDINGS, BUILDING_IDS, RESOURCES, UNITS, UNIT_IDS } from "../../contract";
import { formatCompact, formatInt, formatResources, formatTicksAsTime } from "../../lib/format";
import { isFlowing, paceOf, useLiveTick } from "../../world/clock";
import type { Clock } from "../../world/types";
import { Empty, Meter, Section } from "../common";
import { selectClock, selectState, useWorld } from "../worldContext";
import { useManualActions } from "./useManualActions";
import { unitInventory, validTrainCount } from "./holdings";
import { QueueRow, TrainingQueueRow } from "./QueueRow";
import { UnitIcon } from "./UnitIcon";
import { VillagePicker } from "./VillagePicker";

const TRAINING_BUILDINGS: TrainingBuilding[] = ["barracks", "stable", "workshop", "court"];
const MILLI = 1000;

export function HoldingTab({ villageId, onVillage }: { villageId: string; onVillage: (id: string) => void }) {
  const state = useWorld(selectState);
  const clock = useWorld(selectClock);
  const tick = useLiveTick(clock);
  const { busy, message, failed, retry, setRetry, submit, act } = useManualActions();
  const village = state?.villages.find((v) => v.id === villageId);
  if (!state || !village) return <Empty>No village to show.</Empty>;
  const cooldown = state.player.nextActTick !== null && state.player.nextActTick > tick;
  const blocked = busy || !!retry || cooldown || clock.status === "ended";
  const command = (action: Action) => { if (!blocked) void act(action); };
  const elapsed = Math.max(0, tick - state.world.tick);

  return (
    <div className="tab-page holding-page">
      <VillagePicker state={state} value={villageId} onChange={onVillage} />
      <VillageHeader village={village} />
      {cooldown && <p className="warn-line">Next Council turn: tick {state.player.nextActTick}.</p>}
      {clock.status === "ended" && <p className="warn-line">This round has ended.</p>}
      {message && <p className={failed ? "error-line" : "command-success"} role="status">{message}</p>}
      {retry && <div className="command-retry">
        <button className="btn btn-small" disabled={busy} onClick={() => void submit(retry, true)}>Retry same order</button>
        <button className="btn btn-small" disabled={busy} onClick={() => setRetry(null)}>Dismiss uncertain result</button>
      </div>}
      <fieldset className="command-fieldset" disabled={blocked} aria-busy={busy}>
      <Section title="Stores" aside={<span className="muted small">cellar hides {formatInt(village.hidden)}</span>}>
        {RESOURCES.map((r) => (
          <ResourceRow key={r} resource={r} village={village} elapsed={elapsed} speed={paceOf(clock)} />
        ))}
        <div className="stat-row">
          <span className="stat-name">Population</span>
          <Meter value={village.population.used} max={village.population.max} tone={village.population.used >= village.population.max ? "ember" : "steel"} />
          <span className="stat-num mono">
            {formatInt(village.population.used)} / {formatInt(village.population.max)}
          </span>
        </div>
        <div className="stat-row">
          <span className="stat-name">Merchants</span>
          <Meter value={village.merchants.available} max={village.merchants.total} tone="amber" />
          <span className="stat-num mono">
            {village.merchants.available} / {village.merchants.total}
          </span>
        </div>
      </Section>
      <Buildings village={village} command={command} />
      <Units key={village.id} village={village} command={command} />
      <BuildQueue village={village} tick={tick} clock={clock} command={command} />
      <Training village={village} tick={tick} clock={clock} command={command} />
      </fieldset>
    </div>
  );
}

function VillageHeader({ village }: { village: VillageState }) {
  return (
    <div className="village-head">
      <div>
        <h2 className="village-name">{village.name}</h2>
        <span className="muted mono small">
          {village.x}|{village.y}
        </span>
      </div>
      <div className="village-head-stats">
        <div>
          <span className="big">{formatInt(village.points)}</span>
          <small>points</small>
        </div>
        <div title="Loyalty: envoys lower it; at zero the village changes hands">
          <span className={`big${village.loyalty < 100 ? " ember" : ""}`}>{village.loyalty}</span>
          <small>loyalty</small>
        </div>
      </div>
    </div>
  );
}

function ResourceRow({ resource, village, elapsed, speed }: { resource: Resource; village: VillageState; elapsed: number; speed: number }) {
  const perTick = village.productionPerTickMilli[resource] / MILLI;
  const live = Math.min(village.storage, village.resourcesMilli[resource] / MILLI + perTick * elapsed);
  const full = live >= village.storage;
  const ticksToFull = perTick > 0 ? (village.storage - live) / perTick : Infinity;
  return (
    <div className="stat-row">
      <span className={`stat-name res res-${resource}`}>{resource}</span>
      <Meter value={live} max={village.storage} tone={full ? "ember" : resource} marker={village.hidden} />
      <span className="stat-num mono">
        {formatInt(live)}
        <span className="muted"> / {formatCompact(village.storage)}</span>
      </span>
      <span className="stat-sub muted">
        +{formatInt(village.production[resource])}/min{" "}
        {full ? <span className="ember">full</span> : Number.isFinite(ticksToFull) ? `· full in ${formatTicksAsTime(ticksToFull, speed)}` : ""}
      </span>
    </div>
  );
}

type Commands = { command(action: Action): void };

function Buildings({ village, command }: { village: VillageState } & Commands) {
  const queued = new Map<string, number>();
  for (const item of village.buildQueue) queued.set(item.building, (queued.get(item.building) ?? 0) + 1);
  const options = new Map(village.options.build.map((o) => [o.building, o]));
  return (
    <Section title="Buildings">
      <div className="building-grid">
        {BUILDING_IDS.map((id) => {
          const rule = BUILDINGS[id];
          const level = village.buildings[id];
          const option = options.get(id);
          const atMax = level >= rule.maxLevel;
          const needs = buildingNeeds(id, village.buildings);
          const hint = atMax
            ? `${rule.name}: at its highest level`
            : option
              ? `${rule.name} ${option.level}: ${formatResources(option.cost)} · ${option.ticks} ticks · ${option.ok ? "can be queued now" : blockerMessage(option.blockers, needs)}`
              : rule.name;
          return (
            <button type="button" disabled={!option?.ok || atMax} onClick={() => command({ type: "build", village: village.id, building: id })} key={id} className={`building${level === 0 ? " is-unbuilt" : ""}${atMax ? " is-max" : ""}`} title={hint}>
              <span className="building-heading">
                <span className="building-name">{rule.name}</span>
                <span className="building-level">
                  {level}<small>/{rule.maxLevel}</small>
                  {queued.has(id) && <span className="building-queued">+{queued.get(id)}</span>}
                </span>
              </span>
              <div className="building-bar">
                <div style={{ transform: `scaleX(${level / rule.maxLevel})` }} />
              </div>
              {option?.ok && !atMax && <span className="building-ready" aria-label="can be queued now" />}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function Units({ village, command }: { village: VillageState } & Commands) {
  const [counts, setCounts] = useState<Partial<Record<UnitId, number>>>({});
  const [selected, setSelected] = useState<UnitId | null>(null);
  const option = village.options.train.find((o) => o.unit === selected);
  const count = selected ? counts[selected] ?? 1 : 1;
  return (
    <Section title="Units" aside={<span className="muted small">home/total · +training</span>}>
      <div className="holding-units">
        {UNIT_IDS.map((unit) => {
          const inventory = unitInventory(village, unit);
          const training = village.options.train.find((o) => o.unit === unit);
          const needs = unitNeeds(unit, village.buildings);
          const hint = training ? `${formatResources(training.cost)} · ${training.ticksEach} ticks each · max ${training.maxCount}${training.ok ? "" : ` · ${blockerMessage(training.blockers, needs)}`}` : "Training unavailable";
          return <button type="button" key={unit} disabled={!training?.ok} className={`holding-unit${selected === unit ? " is-selected" : ""}`} title={hint} aria-pressed={selected === unit} onClick={() => setSelected(selected === unit ? null : unit)}>
            <span className="holding-unit-line">
              <UnitIcon unit={unit} /><strong>{UNITS[unit].name}</strong>
              <span className="mono">{formatCompact(inventory.home)}/{formatCompact(inventory.total)}{inventory.training > 0 && <span className="gold"> +{formatCompact(inventory.training)}</span>}</span>
            </span>
          </button>;
        })}
      </div>
      {selected && <form className="holding-train-selection" onSubmit={(e) => {
        e.preventDefault();
        if (option?.ok && validTrainCount(count, option.maxCount)) command({ type: "train", village: village.id, unit: selected, count });
      }}>
        <span><strong>{UNITS[selected].name}</strong><small>{option ? `${formatResources(option.cost)} · ${option.ticksEach} ticks each · max ${option.maxCount}` : "Training unavailable"}</small>
        </span>
        <input type="number" aria-label={`${UNITS[selected].name} count`} min={1} max={option?.maxCount ?? 0} step={1} required disabled={!option?.ok} value={count} onChange={(e) => setCounts({ ...counts, [selected]: e.target.valueAsNumber })} />
        <button className="btn btn-small" disabled={!option?.ok || !validTrainCount(count, option.maxCount)}>Train</button>
      </form>}
    </Section>
  );
}

function BuildQueue({ village, tick, clock, command }: { village: VillageState; tick: number; clock: Clock } & Commands) {
  const queue = village.buildQueue;
  const paused = !isFlowing(clock);
  if (queue.length === 0) {
    return (
      <Section title="Build queue">
        <Empty>The builders are idle.</Empty>
      </Section>
    );
  }
  const last = queue[queue.length - 1]!.endTick;
  const span = Math.max(1, last - tick);
  return (
    <Section title="Build queue" aside={<span className="muted small">done in {formatTicksAsTime(last - tick, paceOf(clock))}</span>}>
      <div className="timeline" aria-hidden="true">
        {queue.map((item, i) => {
          const start = Math.max(tick, startOf(queue, i));
          const left = ((start - tick) / span) * 100;
          const width = Math.max(0.5, ((item.endTick - start) / span) * 100);
          return (
            <div key={item.id} className={`timeline-seg${i === 0 ? " is-active" : ""}`} style={{ left: `${left}%`, width: `${width}%` }}>
              <span>{BUILDINGS[item.building].name}</span>
            </div>
          );
        })}
      </div>
      <ol className="queue">
        {queue.map((item, i) => (
          <BuildRow key={item.id} item={item} start={startOf(queue, i)} tick={tick} speed={paceOf(clock)} paused={paused} active={i === 0} cancel={() => command({ type: "cancel_build", village: village.id, item: item.id })} />
        ))}
      </ol>
    </Section>
  );
}

/** A waiting item starts when the one before it ends. */
function startOf(queue: BuildQueueItem[], index: number): number {
  const item = queue[index]!;
  if (item.startTick !== null) return item.startTick;
  return index > 0 ? queue[index - 1]!.endTick : item.endTick;
}

function BuildRow({ item, start, tick, speed, paused, active, cancel }: { item: BuildQueueItem; start: number; tick: number; speed: number; paused: boolean; active: boolean; cancel(): void }) {
  const progress = item.endTick > start ? Math.min(1, Math.max(0, (tick - start) / (item.endTick - start))) : 0;
  return <QueueRow name={<>{BUILDINGS[item.building].name} <span className="gold">{item.level}</span></>}
    progress={active ? progress : 0} endTick={item.endTick} tick={tick} speed={speed} paused={paused}
    active={active} cancelLabel={`Cancel ${BUILDINGS[item.building].name} level ${item.level}`} cancel={cancel} />;
}

function Training({ village, tick, clock, command }: { village: VillageState; tick: number; clock: Clock } & Commands) {
  const busy = TRAINING_BUILDINGS.filter((b) => village.training[b].length > 0);
  return (
    <Section title="Training">
      {busy.length === 0 && <Empty>No troops in training.</Empty>}
      {busy.map((building) => (
        <div key={building} className="train-group">
          <div className="train-head">
            {BUILDINGS[building].name} <span className="muted">level {village.buildings[building]}</span>
          </div>
          <ol className="queue">
            {village.training[building].map((batch) => (
              <TrainingQueueRow key={batch.id} batch={batch} tick={tick} speed={paceOf(clock)} paused={!isFlowing(clock)} cancel={() => command({ type: "cancel_train", village: village.id, batch: batch.id })} />
            ))}
          </ol>
        </div>
      ))}
    </Section>
  );
}
