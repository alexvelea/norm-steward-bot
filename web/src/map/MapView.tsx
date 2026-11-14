// The full-screen map: a canvas the renderer draws every frame, mouse/touch/keyboard to pan and zoom,
// and a hover card. Panels steer it through a MapController (fly to a village, zoom, show all).
import { useEffect, useRef, useState } from "react";
import type { MapVillage } from "../contract";
import { formatInt } from "../lib/format";
import { colorsForPlayer, GOLD } from "../lib/palette";
import type { Store } from "../lib/store";
import type { WorldView } from "../world/types";
import { MapRenderer, type Overlay } from "./renderer";

const CLICK_SLOP_PX = 5;
const WHEEL_SENSITIVITY = 0.0016;
const FOCUS_ZOOM = 26;

export class MapController {
  renderer: MapRenderer | null = null;
  readonly overlay: Overlay = { selectedId: null, hoveredId: null, godView: false };

  focus(x: number, y: number, zoom: number | null = FOCUS_ZOOM): void {
    const r = this.renderer;
    if (!r) return;
    r.frameManually();
    r.flyToVisible(x, y, zoom === null ? null : Math.max(zoom, r.camera.view.zoom));
  }

  zoomBy(factor: number): void {
    const r = this.renderer;
    if (!r) return;
    r.frameManually();
    r.camera.zoomAt(factor, r.viewport.width / 2, r.viewport.height / 2, r.viewport);
  }

  showAll(size: number): void {
    const r = this.renderer;
    if (!r) return;
    r.frameManually();
    r.flyToVisible(size / 2, size / 2, 0);
  }
}

interface Hover {
  village: MapVillage;
}

export function MapView({
  store,
  controller,
  onSelect,
}: {
  store: Store<WorldView>;
  controller: MapController;
  onSelect: (villageId: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const canvas = canvasRef.current!;
    // Panels float over the map; framing keeps what matters out from under them.
    const insets = () => {
      const panel = canvas.closest(".world")?.querySelector(".panel");
      if (!panel) return { right: 0, bottom: 0 };
      const map = canvas.getBoundingClientRect();
      const rect = panel.getBoundingClientRect();
      const sheet = rect.width >= map.width * 0.9;
      return sheet ? { right: 0, bottom: Math.max(0, map.bottom - rect.top) } : { right: Math.max(0, map.right - rect.left), bottom: 0 };
    };
    const renderer = new MapRenderer(canvas, store.get, controller.overlay, insets);
    controller.renderer = renderer;
    const fit = () => renderer.resize(canvas.clientWidth, canvas.clientHeight);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);

    let raf = 0;
    const loop = (now: number) => {
      renderer.frame(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // ---- Pointer input: drag to pan, two fingers to pinch, a still click to select.
    const pointers = new Map<number, { x: number; y: number }>();
    let downAt: { x: number; y: number } | null = null;
    let moved = false;
    let pinchDistance = 0;
    let velocity = { x: 0, y: 0, at: 0 };

    const local = (e: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const setHovered = (village: MapVillage | null, x: number, y: number) => {
      const id = village?.id ?? null;
      if (tipRef.current) tipRef.current.style.transform = `translate(${Math.round(x + 16)}px, ${Math.round(y + 14)}px)`;
      if (controller.overlay.hoveredId === id) return;
      controller.overlay.hoveredId = id;
      canvas.style.cursor = id ? "pointer" : "grab";
      setHover(village ? { village } : null);
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      renderer.frameManually();
      const p = local(e);
      pointers.set(e.pointerId, p);
      renderer.camera.stop();
      if (pointers.size === 1) {
        downAt = p;
        moved = false;
        velocity = { x: 0, y: 0, at: performance.now() };
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        moved = true;
      }
    };

    const onMove = (e: PointerEvent) => {
      const p = local(e);
      const previous = pointers.get(e.pointerId);
      if (!previous) {
        if (e.pointerType === "mouse") setHovered(renderer.villageAt(p.x, p.y), p.x, p.y);
        return;
      }
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const midX = (a!.x + b!.x) / 2;
        const midY = (a!.y + b!.y) / 2;
        if (pinchDistance > 0) renderer.camera.pinch(distance / pinchDistance, midX, midY, renderer.viewport);
        renderer.camera.panBy((p.x - previous.x) / 2, (p.y - previous.y) / 2);
        pinchDistance = distance;
        return;
      }
      if (downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) > CLICK_SLOP_PX) moved = true;
      if (!moved) return;
      const dx = p.x - previous.x;
      const dy = p.y - previous.y;
      renderer.camera.panBy(dx, dy);
      canvas.style.cursor = "grabbing";
      const now = performance.now();
      const dt = Math.max(1, now - velocity.at) / 1000;
      // Smoothed release velocity, in px per second.
      velocity = { x: velocity.x * 0.6 + (dx / dt) * 0.4, y: velocity.y * 0.6 + (dy / dt) * 0.4, at: now };
      setHovered(null, p.x, p.y);
    };

    const onUp = (e: PointerEvent) => {
      const p = local(e);
      pointers.delete(e.pointerId);
      if (pointers.size > 0) return;
      if (!moved) {
        onSelectRef.current(renderer.villageAt(p.x, p.y)?.id ?? null);
      } else if (performance.now() - velocity.at < 80) {
        renderer.camera.release(velocity.x, velocity.y);
      }
      downAt = null;
      canvas.style.cursor = controller.overlay.hoveredId ? "pointer" : "grab";
    };

    const onLeave = () => {
      if (pointers.size === 0) setHovered(null, 0, 0);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      renderer.frameManually();
      const p = local(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      renderer.camera.zoomAt(Math.exp(-delta * WHEEL_SENSITIVITY), p.x, p.y, renderer.viewport);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "+" || e.key === "=") controller.zoomBy(1.4);
      else if (e.key === "-" || e.key === "_") controller.zoomBy(1 / 1.4);
      else if (e.key === "Escape") onSelectRef.current(null);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      controller.renderer = null;
    };
  }, [store, controller]);

  return (
    <div className="map">
      <canvas ref={canvasRef} className="map-canvas" aria-label="World map" />
      <div ref={tipRef} className={`map-tip${hover ? " is-on" : ""}`} aria-hidden={!hover}>
        {hover && <VillageTip village={hover.village} store={store} />}
      </div>
    </div>
  );
}

function VillageTip({ village, store }: { village: MapVillage; store: Store<WorldView> }) {
  const view = store.get();
  const player = village.ownerId ? view.map.players.get(village.ownerId) : undefined;
  const mine = !!view.playerId && village.ownerId === view.playerId;
  const swatch = mine ? GOLD : village.ownerId ? colorsForPlayer(village.ownerId).fill : "var(--hamlet)";
  const protectedUntil = player?.protectedUntilTick ?? null;
  return (
    <>
      <div className="map-tip-name">{village.name}</div>
      <div className="map-tip-owner">
        <span className="swatch" style={{ background: swatch }} />
        {village.ownerName ?? "Hamlet"}
        {mine && <span className="tag tag-gold">you</span>}
        {player?.houseBot && <span className="tag">house · {player.houseBot}</span>}
      </div>
      <div className="map-tip-meta">
        <span>{formatInt(village.points)} pts</span>
        <span>
          {village.x}|{village.y}
        </span>
        {protectedUntil !== null && protectedUntil > view.clock.tick && <span>protected</span>}
      </div>
    </>
  );
}
