// The home page's backdrop: a small invented land drawn by the same renderer as the worlds, with
// made-up banners marching between made-up keeps. Pure decoration; it shows no world's data.
import { useEffect, useRef } from "react";
import type { GodMovement, MapPlayer, MapVillage } from "../contract";
import { hashString, seededRandom } from "../lib/noise";
import { Store } from "../lib/store";
import { MapRenderer } from "../map/renderer";
import { distance } from "../world/movements";
import { emptyView, pruneEffects, type WorldView } from "../world/types";
import { EMBER } from "../lib/palette";

const LAND = 150;
const KEEPS = 230;
const BANNERS = 9;
const SPEED = 6;
const TICKS_PER_FIELD = 14;
const DRIFT_FIELDS_PER_SECOND = 0.35;

function inventLand(): { villages: MapVillage[]; players: MapPlayer[] } {
  const random = seededRandom(hashString("norn-steward:home"));
  const players: MapPlayer[] = Array.from({ length: BANNERS }, (_, i) => ({
    id: `p_home${i}`,
    name: `Banner ${i + 1}`,
    houseBot: null,
    points: 0,
    villages: 0,
    protectedUntilTick: null,
  }));
  const villages: MapVillage[] = [];
  for (let tries = 0; villages.length < KEEPS && tries < KEEPS * 20; tries++) {
    const x = Math.round(6 + random() * (LAND - 12));
    const y = Math.round(6 + random() * (LAND - 12));
    if (villages.some((v) => distance(v.x, v.y, x, y) < 4)) continue;
    const owned = random() > 0.3;
    const owner = owned ? players[Math.floor(random() * players.length)]! : null;
    villages.push({
      id: `v_home${villages.length}`,
      x,
      y,
      name: "",
      ownerId: owner?.id ?? null,
      ownerName: owner?.name ?? null,
      points: owned ? Math.round(60 + random() ** 2.4 * 9000) : 40,
    });
  }
  return { villages, players };
}

export function HeroMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const land = inventLand();
    const random = seededRandom(hashString("norn-steward:marches"));
    const start = performance.now();
    const store = new Store<WorldView>({
      ...emptyView("norn-steward-home"),
      map: {
        size: LAND,
        snapshotTick: 0,
        villages: new Map(land.villages.map((v) => [v.id, v])),
        players: new Map(land.players.map((p) => [p.id, p])),
      },
      clock: { tick: 0, receivedAt: start, speed: SPEED, status: "running" },
      god: { tick: 0, movements: [], battles: [] },
    });
    const renderer = new MapRenderer(canvas, store.get, { selectedId: null, hoveredId: null, godView: true });
    renderer.frameManually();
    const fit = () => renderer.resize(canvas.clientWidth, canvas.clientHeight);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    renderer.camera.setMapSize(LAND);
    renderer.camera.jumpTo({ cx: LAND / 2, cy: LAND / 2, zoom: 14 }, renderer.viewport);

    const owned = land.villages.filter((v) => v.ownerId);
    let serial = 0;
    const march = (tick: number): GodMovement => {
      const from = owned[Math.floor(random() * owned.length)]!;
      const near = land.villages
        .filter((v) => v !== from)
        .sort((a, b) => distance(from.x, from.y, a.x, a.y) - distance(from.x, from.y, b.x, b.y))
        .slice(0, 6);
      const to = near[Math.floor(random() * near.length)]!;
      const roll = random();
      const travel = Math.ceil(distance(from.x, from.y, to.x, to.y) * TICKS_PER_FIELD);
      const sentTick = tick - Math.floor(random() * travel * 0.8);
      return {
        id: `m_home${serial++}`,
        kind: roll < 0.55 ? "attack" : roll < 0.8 ? "support" : "trade",
        ownerId: from.ownerId!,
        fromXY: [from.x, from.y],
        toXY: [to.x, to.y],
        sentTick,
        arrivalTick: sentTick + travel,
        returning: false,
        pop: 0,
      };
    };
    const initial = Array.from({ length: 14 }, () => march(0));
    store.update({ god: { tick: 0, movements: initial, battles: [] } });

    // A slow clock: arrivals become bursts, and new banners set out.
    const clock = setInterval(() => {
      const now = performance.now();
      const tick = ((now - start) / 1000) * SPEED;
      const view = store.get();
      const movements = view.god?.movements ?? [];
      const arrived = movements.filter((m) => m.arrivalTick <= tick);
      const effects = [...pruneEffects(view.effects, now)];
      for (const m of arrived) {
        if (m.kind === "attack") {
          effects.push({ id: m.id, kind: "battle", x: m.toXY[0], y: m.toXY[1], startedAt: now, color: EMBER, strong: random() > 0.5 });
        }
      }
      const kept = movements.filter((m) => m.arrivalTick > tick);
      while (kept.length < 14) kept.push(march(tick));
      store.update({
        clock: { tick, receivedAt: now, speed: SPEED, status: "running" },
        god: { tick, movements: kept, battles: [] },
        effects,
      });
    }, 250);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    let direction = 1;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // Drift, turning back before the land's edge shows.
      const view = renderer.camera.view;
      const marginX = renderer.viewport.width / 2 / view.zoom + 3;
      const marginY = renderer.viewport.height / 2 / view.zoom + 3;
      if (!still) {
        view.cx += DRIFT_FIELDS_PER_SECOND * dt * direction;
        view.cy += DRIFT_FIELDS_PER_SECOND * 0.4 * dt * direction;
        if (view.cx > LAND - marginX) direction = -1;
        if (view.cx < marginX) direction = 1;
      }
      view.cx = Math.min(Math.max(view.cx, marginX), Math.max(marginX, LAND - marginX));
      view.cy = Math.min(Math.max(view.cy, marginY), Math.max(marginY, LAND - marginY));
      renderer.frame(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(clock);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="hero-map" aria-hidden="true" />;
}
