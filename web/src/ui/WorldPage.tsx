// A world: the map fills the screen; the bar, alerts, sandbox controls and the side panel float over it.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApiKey } from "../lib/keyStore";
import { formatInt, formatTicksAsTime } from "../lib/format";
import { colorsForPlayer, GOLD } from "../lib/palette";
import { homeHref } from "../lib/router";
import { MapController, MapView } from "../map/MapView";
import { backend } from "../world/backend";
import { isFlowing, paceOf, useLiveTick } from "../world/clock";
import type { WorldClient } from "../world/types";
import { Countdown, Link } from "./common";
import { Panel } from "./panel/Panel";
import { TownView } from "./town/TownView";
import { SandboxControls } from "./SandboxControls";
import {
  selectClock,
  selectConnection,
  selectFatal,
  selectMap,
  selectNotice,
  selectPlayerId,
  selectState,
  selectSummary,
  useWorld,
  useWorldContext,
  WorldContext,
  type WorldContextValue,
} from "./worldContext";

export function WorldPage({ worldId }: { worldId: string }) {
  const key = useApiKey();
  const [townOpen, setTownOpen] = useState(() => location.hash === "#town");
  const [client, setClient] = useState<WorldClient | null>(null);
  const controller = useMemo(() => new MapController(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const c = backend().worldClient(worldId, key);
    c.start();
    setClient(c);
    return () => c.stop();
  }, [worldId, key]);

  useEffect(() => {
    controller.overlay.selectedId = selectedId;
  }, [controller, selectedId]);

  const select = useCallback(
    (id: string | null, focus = false) => {
      setSelectedId(id);
      if (focus && id && client) {
        const v = client.store.get().map.villages.get(id);
        if (v) controller.focus(v.x, v.y);
      }
    },
    [client, controller],
  );

  const context = useMemo<WorldContextValue | null>(
    () => (client ? { client, map: controller, selectedId, select, townOpen, setTownOpen } : null),
    [client, controller, selectedId, select, townOpen],
  );

  if (!context) return <div className="world" />;
  return (
    <WorldContext.Provider value={context}>
      <WorldBody />
    </WorldContext.Provider>
  );
}

function WorldBody() {
  const { client, map, select, townOpen, setTownOpen } = useWorldContext();
  const state = useWorld(selectState);
  const showTown = townOpen && !!state?.villages.length;
  const closeTown = useCallback(() => setTownOpen(false), [setTownOpen]);
  const fatal = useWorld(selectFatal);
  const onSelect = useCallback((id: string | null) => select(id), [select]);

  useEffect(() => {
    const summary = client.store.get().summary;
    document.title = summary ? `${summary.name} · Norn Steward` : "Norn Steward";
    return client.store.subscribe(() => {
      const name = client.store.get().summary?.name;
      const title = name ? `${name} · Norn Steward` : "Norn Steward";
      if (document.title !== title) document.title = title;
    });
  }, [client]);

  if (fatal && !client.store.get().summary) {
    return (
      <div className="world world-fatal">
        <div className="card">
          <h2>This world can't be shown</h2>
          <p className="muted">{fatal}</p>
          <Link href={homeHref()} className="btn">
            ← All worlds
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`world${showTown ? " town-is-open" : ""}`}>
      <MapView store={client.store} controller={map} onSelect={onSelect} />
      <div className="world-top">
        <WorldBar />
        <IncomingAlert />
      </div>
      <Notice />
      <div className="world-tools">
        <SandboxControls />
        <ZoomControls />
      </div>
      <SelectedCard />
      <Panel />
      {showTown && <TownView onClose={closeTown} />}
    </div>
  );
}

function WorldBar() {
  const { setTownOpen } = useWorldContext();
  const summary = useWorld(selectSummary);
  const clock = useWorld(selectClock);
  const connection = useWorld(selectConnection);
  const state = useWorld(selectState);
  const tick = useLiveTick(clock);
  if (!summary) {
    return (
      <div className="world-bar">
        <Link href={homeHref()} className="back" title="All worlds">
          ←
        </Link>
        <span className="muted">Opening the world…</span>
      </div>
    );
  }
  const left = summary.endsAtTick - tick;
  return (
    <div className="world-bar">
      <Link href={homeHref()} className="back" title="All worlds">
        ←
      </Link>
      <div className="world-bar-title">
        <h1>{summary.name}</h1>
        <span className="world-bar-sub">
          {summary.kind} · round {summary.round}
        </span>
      </div>
      <div className="world-bar-stat stat-tick">
        <span className="mono">{formatInt(tick)}</span>
        <small>tick</small>
      </div>
      <div className="world-bar-stat stat-left">
        <span>{clock.status === "ended" ? "ended" : clock.lockstep ? formatInt(Math.max(0, left)) : formatTicksAsTime(left, clock.speed)}</span>
        <small>{clock.status === "paused" ? "paused" : clock.lockstep && clock.status !== "ended" ? "ticks left" : "left"}</small>
      </div>
      <div className="world-bar-stat stat-speed">
        {clock.lockstep ? <span>lockstep</span> : <span>{clock.speed}×</span>}
        <small>{clock.lockstep ? "clock" : "speed"}</small>
      </div>
      {state && (
        <div className="world-bar-you">
          <span className="swatch" style={{ background: GOLD }} />
          <span>{state.player.name}</span>
          <span className="muted">
            #{state.player.rank} · {formatInt(state.player.score)}
          </span>
        </div>
      )}
      {!!state?.villages.length && <button className="btn btn-small" aria-haspopup="dialog" onClick={() => setTownOpen(true)}>Town view</button>}
      <span className={`conn conn-${connection}`} title={connection === "live" ? "Live" : connection} />
    </div>
  );
}

function IncomingAlert() {
  const state = useWorld(selectState);
  const clock = useWorld(selectClock);
  const tick = useLiveTick(clock);
  const { map, select } = useWorldContext();
  const attacks = (state?.commands.incoming ?? []).filter((c) => c.kind === "attack").sort((a, b) => a.arrivalTick - b.arrivalTick);
  if (attacks.length === 0) return null;
  const first = attacks[0]!;
  return (
    <button
      className="alert"
      onClick={() => {
        select(first.to.id);
        map.focus(first.to.x, first.to.y);
      }}
    >
      <span className="alert-icon">⚔</span>
      <span>
        {attacks.length === 1 ? "An attack" : `${attacks.length} attacks`} incoming · first on <strong>{first.to.name}</strong> in{" "}
        <Countdown until={first.arrivalTick} tick={tick} speed={paceOf(clock)} paused={!isFlowing(clock)} />
        {first.sighted && (
          <span className="alert-sight">
            {" "}
            · {first.sighted.size}
            {first.sighted.envoy ? " with an envoy" : ""}
          </span>
        )}
      </span>
    </button>
  );
}

function Notice() {
  const notice = useWorld(selectNotice);
  const { client } = useWorldContext();
  if (!notice) return null;
  return (
    <div className="notice" role="status">
      <span>{notice}</span>
      <button className="btn btn-small" onClick={() => client.store.update({ notice: null })}>
        Dismiss
      </button>
    </div>
  );
}

function ZoomControls() {
  const { map } = useWorldContext();
  const size = useWorld(selectMap).size;
  return (
    <div className="zoom">
      <button className="icon-btn" onClick={() => map.zoomBy(1.5)} aria-label="Zoom in">
        +
      </button>
      <button className="icon-btn" onClick={() => map.zoomBy(1 / 1.5)} aria-label="Zoom out">
        −
      </button>
      <button className="icon-btn" onClick={() => map.showAll(size)} aria-label="Show the whole map" title="Whole map">
        ⤢
      </button>
    </div>
  );
}

/** Public facts about a selected village that isn't yours. */
function SelectedCard() {
  const { selectedId, select, map } = useWorldContext();
  const worldMap = useWorld(selectMap);
  const playerId = useWorld(selectPlayerId);
  const clock = useWorld(selectClock);
  const village = selectedId ? worldMap.villages.get(selectedId) : undefined;
  if (!village || (playerId && village.ownerId === playerId)) return null;
  const player = village.ownerId ? worldMap.players.get(village.ownerId) : undefined;
  const protectedUntil = player?.protectedUntilTick ?? null;
  return (
    <div className="selected-card">
      <button className="close" onClick={() => select(null)} aria-label="Close">
        ×
      </button>
      <div className="selected-name">{village.name}</div>
      <div className="selected-owner">
        <span className="swatch" style={{ background: village.ownerId ? colorsForPlayer(village.ownerId).fill : "var(--hamlet)" }} />
        {village.ownerName ?? "Hamlet (unowned)"}
        {player?.houseBot && <span className="tag">house · {player.houseBot}</span>}
      </div>
      <dl className="facts">
        <div>
          <dt>Points</dt>
          <dd>{formatInt(village.points)}</dd>
        </div>
        <div>
          <dt>Field</dt>
          <dd className="mono">
            {village.x}|{village.y}
          </dd>
        </div>
        {player && (
          <div>
            <dt>Holds</dt>
            <dd>
              {player.villages} {player.villages === 1 ? "village" : "villages"}
            </dd>
          </div>
        )}
        {protectedUntil !== null && protectedUntil > clock.tick && (
          <div>
            <dt>Protected</dt>
            <dd>
              <Countdown until={protectedUntil} tick={clock.tick} speed={paceOf(clock)} />
            </dd>
          </div>
        )}
      </dl>
      <button className="btn btn-small" onClick={() => map.focus(village.x, village.y)}>
        Centre on it
      </button>
    </div>
  );
}
