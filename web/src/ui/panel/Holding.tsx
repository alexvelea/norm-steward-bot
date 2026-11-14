// Holding: one village's resources against storage, production, population, buildings by level, the
// build queue as a timeline, and each training queue. Resources tick up live between state messages
// from the village's own production figures, capped at storage, as the server will.
import type { BuildQueueItem, Resource, TrainBatch, TrainingBuilding, VillageState } from "../../contract";
import { BUILDINGS, BUILDING_IDS, RESOURCES, UNITS } from "../../contract";
import { formatCompact, formatInt, formatResources, formatTicksAsTime } from "../../lib/format";
import { isFlowing, paceOf, useLiveTick } from "../../world/clock";
import type { Clock } from "../../world/types";
import { Countdown, Empty, Meter, Section } from "../common";
import { selectClock, selectState, useWorld } from "../worldContext";
import { VillagePicker } from "./VillagePicker";

const TRAINING_BUILDINGS: TrainingBuilding[] = ["barracks", "stable", "workshop", "court"];
const MILLI = 1000;

export function HoldingTab({ villageId, onVillage }: { villageId: string; onVillage: (id: string) => void }) {
  const state = useWorld(selectState);
  const clock = useWorld(selectClock);
  const tick = useLiveTick(clock);
  const village = state?.villages.find((v) => v.id === villageId);
  if (!state || !village) return <Empty>No village to show.</Empty>;
  const elapsed = Math.max(0, tick - state.world.tick);

  return (
    <div className="tab-page">
      <VillagePicker state={state} value={villageId} onChange={onVillage} />
      <VillageHeader village={village} />
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
      <BuildQueue village={village} tick={tick} clock={clock} />
      <Buildings village={village} />
      <Training village={village} tick={tick} clock={clock} />
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

function Buildings({ village }: { village: VillageState }) {
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
          const hint = atMax
            ? `${rule.name}: at its highest level`
            : option
              ? `${rule.name} ${option.level}: ${formatResources(option.cost)} · ${option.ok ? "can be queued now" : option.blockers.join(", ")}`
              : rule.name;
          return (
            <div key={id} className={`building${level === 0 ? " is-unbuilt" : ""}${atMax ? " is-max" : ""}`} title={hint}>
              <span className="building-name">{rule.name}</span>
              <span className="building-level">
                {level}
                <small>/{rule.maxLevel}</small>
                {queued.has(id) && <span className="building-queued">+{queued.get(id)}</span>}
              </span>
              <div className="building-bar">
                <div style={{ transform: `scaleX(${level / rule.maxLevel})` }} />
              </div>
              {option?.ok && !atMax && <span className="building-ready" aria-label="can be queued now" />}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function BuildQueue({ village, tick, clock }: { village: VillageState; tick: number; clock: Clock }) {
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
          <QueueRow key={item.id} item={item} start={startOf(queue, i)} tick={tick} speed={paceOf(clock)} paused={paused} active={i === 0} />
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

function QueueRow({ item, start, tick, speed, paused, active }: { item: BuildQueueItem; start: number; tick: number; speed: number; paused: boolean; active: boolean }) {
  const progress = item.endTick > start ? Math.min(1, Math.max(0, (tick - start) / (item.endTick - start))) : 0;
  return (
    <li className={`queue-row${active ? " is-active" : ""}`}>
      <span className="queue-name">
        {BUILDINGS[item.building].name} <span className="gold">{item.level}</span>
      </span>
      <Meter value={active ? progress : 0} max={1} tone="gold" />
      <Countdown until={item.endTick} tick={tick} speed={speed} paused={paused} />
    </li>
  );
}

function Training({ village, tick, clock }: { village: VillageState; tick: number; clock: Clock }) {
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
              <BatchRow key={batch.id} batch={batch} tick={tick} speed={paceOf(clock)} paused={!isFlowing(clock)} />
            ))}
          </ol>
        </div>
      ))}
    </Section>
  );
}

function BatchRow({ batch, tick, speed, paused }: { batch: TrainBatch; tick: number; speed: number; paused: boolean }) {
  const done = batch.count - batch.remaining;
  return (
    <li className={`queue-row${batch.nextTick !== null ? " is-active" : ""}`}>
      <span className="queue-name">
        {UNITS[batch.unit].name} <span className="muted mono">{done}/{batch.count}</span>
      </span>
      <Meter value={done} max={batch.count} tone="steel" />
      <span className="queue-times">
        {batch.nextTick !== null && (
          <span className="muted small">
            next <Countdown until={batch.nextTick} tick={tick} speed={speed} paused={paused} /> ·{" "}
          </span>
        )}
        <Countdown until={batch.endTick} tick={tick} speed={speed} paused={paused} />
      </span>
    </li>
  );
}
