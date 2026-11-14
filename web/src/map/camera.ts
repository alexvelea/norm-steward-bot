// The view onto the map: a centre in fields and a zoom in CSS pixels per field. Wheel and pinch zoom
// around the pointer, a click on a village flies there, a released drag glides to a stop.

export interface View {
  cx: number;
  cy: number;
  zoom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const ZOOM_MAX = 72;
const ZOOM_EASE = 14;
const FLY_EASE = 6;
const GLIDE_DECAY = 5;

export function toScreen(view: View, vp: Viewport, x: number, y: number): [number, number] {
  return [(x - view.cx) * view.zoom + vp.width / 2, (y - view.cy) * view.zoom + vp.height / 2];
}

export function toWorld(view: View, vp: Viewport, sx: number, sy: number): [number, number] {
  return [(sx - vp.width / 2) / view.zoom + view.cx, (sy - vp.height / 2) / view.zoom + view.cy];
}

type Motion =
  | { kind: "still" }
  | { kind: "zoom"; target: number; anchorX: number; anchorY: number; screenX: number; screenY: number }
  | { kind: "fly"; to: View }
  | { kind: "glide"; vx: number; vy: number };

export class Camera {
  view: View = { cx: 0, cy: 0, zoom: 8 };
  private motion: Motion = { kind: "still" };
  private mapSize = 100;

  /** The smallest zoom shows the whole map with a margin. */
  minZoom(vp: Viewport): number {
    return Math.max(0.5, (Math.min(vp.width, vp.height) / this.mapSize) * 0.7);
  }

  setMapSize(size: number): void {
    this.mapSize = Math.max(1, size);
  }

  clampZoom(zoom: number, vp: Viewport): number {
    return Math.min(ZOOM_MAX, Math.max(this.minZoom(vp), zoom));
  }

  jumpTo(view: View, vp: Viewport): void {
    this.view = { ...view, zoom: this.clampZoom(view.zoom, vp) };
    this.motion = { kind: "still" };
    this.keepOnMap();
  }

  flyTo(x: number, y: number, zoom: number | null, vp: Viewport): void {
    this.motion = { kind: "fly", to: { cx: x, cy: y, zoom: this.clampZoom(zoom ?? this.view.zoom, vp) } };
  }

  /** Zooms by `factor` keeping the field under (sx, sy) where it is. */
  zoomAt(factor: number, sx: number, sy: number, vp: Viewport): void {
    const current = this.motion.kind === "zoom" ? this.motion.target : this.view.zoom;
    const target = this.clampZoom(current * factor, vp);
    const [ax, ay] = toWorld(this.view, vp, sx, sy);
    this.motion = { kind: "zoom", target, anchorX: ax, anchorY: ay, screenX: sx, screenY: sy };
  }

  /** Pinch: zoom immediately around a point (the fingers are the animation). */
  pinch(factor: number, sx: number, sy: number, vp: Viewport): void {
    const [ax, ay] = toWorld(this.view, vp, sx, sy);
    this.view.zoom = this.clampZoom(this.view.zoom * factor, vp);
    this.view.cx = ax - (sx - vp.width / 2) / this.view.zoom;
    this.view.cy = ay - (sy - vp.height / 2) / this.view.zoom;
    this.motion = { kind: "still" };
    this.keepOnMap();
  }

  panBy(dx: number, dy: number): void {
    this.view.cx -= dx / this.view.zoom;
    this.view.cy -= dy / this.view.zoom;
    this.motion = { kind: "still" };
    this.keepOnMap();
  }

  /** Velocity in CSS px per second at release. */
  release(vx: number, vy: number): void {
    if (Math.hypot(vx, vy) > 60) this.motion = { kind: "glide", vx, vy };
  }

  stop(): void {
    this.motion = { kind: "still" };
  }

  get moving(): boolean {
    return this.motion.kind !== "still";
  }

  /** Advances any motion by dt seconds. */
  step(dt: number, vp: Viewport): void {
    const m = this.motion;
    if (m.kind === "zoom") {
      const k = 1 - Math.exp(-ZOOM_EASE * dt);
      const logZoom = Math.log(this.view.zoom) + (Math.log(m.target) - Math.log(this.view.zoom)) * k;
      this.view.zoom = Math.exp(logZoom);
      this.view.cx = m.anchorX - (m.screenX - vp.width / 2) / this.view.zoom;
      this.view.cy = m.anchorY - (m.screenY - vp.height / 2) / this.view.zoom;
      if (Math.abs(this.view.zoom / m.target - 1) < 0.002) this.motion = { kind: "still" };
    } else if (m.kind === "fly") {
      const k = 1 - Math.exp(-FLY_EASE * dt);
      this.view.cx += (m.to.cx - this.view.cx) * k;
      this.view.cy += (m.to.cy - this.view.cy) * k;
      this.view.zoom = Math.exp(Math.log(this.view.zoom) + (Math.log(m.to.zoom) - Math.log(this.view.zoom)) * k);
      if (Math.hypot(m.to.cx - this.view.cx, m.to.cy - this.view.cy) * this.view.zoom < 0.5 && Math.abs(this.view.zoom / m.to.zoom - 1) < 0.003) {
        this.view = { ...m.to };
        this.motion = { kind: "still" };
      }
    } else if (m.kind === "glide") {
      this.view.cx -= (m.vx * dt) / this.view.zoom;
      this.view.cy -= (m.vy * dt) / this.view.zoom;
      const decay = Math.exp(-GLIDE_DECAY * dt);
      m.vx *= decay;
      m.vy *= decay;
      if (Math.hypot(m.vx, m.vy) < 8) this.motion = { kind: "still" };
    }
    this.view.zoom = this.clampZoom(this.view.zoom, vp);
    this.keepOnMap();
  }

  /** The centre never leaves the map, so the land can't be lost off-screen. */
  private keepOnMap(): void {
    this.view.cx = Math.min(this.mapSize, Math.max(0, this.view.cx));
    this.view.cy = Math.min(this.mapSize, Math.max(0, this.view.cy));
  }
}
