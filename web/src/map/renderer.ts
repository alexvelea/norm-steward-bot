// Draws the world every animation frame: parchment land, routes, villages, moving armies, incoming
// attacks, battle bursts and conquest shockwaves. It reads the WorldView store directly (no React in
// the frame loop) and only what the view holds, so it can never show more than the API gave.
import type { IncomingCommand, MapVillage } from "../contract";
import { formatTicksAsTime } from "../lib/format";
import { AMBER, colorsForPlayer, EMBER, GOLD, GOLD_BRIGHT, HAMLET_COLORS, INK, OWN_COLORS, STEEL, type PlayerColors } from "../lib/palette";
import { paceOf, TickSmoother } from "../world/clock";
import { commandLeg, godLeg, incomingLeg, legPoint, legProgress, tradeLeg, type Leg } from "../world/movements";
import { EFFECT_MS, type Effect, type WorldView } from "../world/types";
import { Camera, toScreen, toWorld, type Viewport } from "./camera";
import { footprint, glowSprite, spriteBucket, tierFor, villageSprite } from "./sprites";
import { Terrain, TILE_PX } from "./terrain";

export interface Overlay {
  selectedId: string | null;
  hoveredId: string | null;
  godView: boolean;
}

/** Sprite anchor: the village's field sits at this point of the 64-unit sprite box. */
const ANCHOR_X = 0.5;
const ANCHOR_Y = 44 / 64;
/** Below this zoom (CSS px per field) villages are drawn as marks, not sprites. */
const SPRITE_ZOOM = 5;
const LABEL_ZOOM = 15;
const HAMLET_LABEL_ZOOM = 30;
const PILL_ZOOM = 10;
/** Zoom the map flies to on your villages when it opens. */
const OWN_ZOOM = 20;
/** Width of the owner's colour wash around a village, in fields. */
const TERRITORY_FIELDS = 4.2;
const POINTS_ZOOM = 26;
/** Spend at most this much of a frame painting new terrain tiles. */
const TILE_BUDGET_MS = 7;
const MAX_DPR = 2;

interface Moving {
  id: string;
  leg: Leg;
  color: string;
  returning: boolean;
  label: boolean;
  /** God view of someone else's army: drawn smaller and thinner. */
  faint: boolean;
}

export class MapRenderer {
  readonly camera = new Camera();
  readonly viewport: Viewport = { width: 1, height: 1 };
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private terrain: Terrain | null = null;
  private terrainKey = "";
  private sorted: MapVillage[] = [];
  private sortedFrom: ReadonlyMap<string, MapVillage> | null = null;
  private readonly smoother = new TickSmoother();
  private lastFrame = 0;
  /** "map" once the land is framed; "own" once it has flown to your villages; "manual" when someone moved it. */
  private framing: "none" | "map" | "own" | "manual" = "none";
  tick = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly view: () => WorldView,
    private readonly overlay: Overlay,
    /** Screen space covered by panels (right on wide screens, bottom on phones), so framing avoids it. */
    private readonly insets: () => { right: number; bottom: number } = () => ({ right: 0, bottom: 0 }),
  ) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize(width: number, height: number): void {
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    this.viewport.width = width;
    this.viewport.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
  }

  /** The caller places the camera itself (the home page backdrop), or a person just did. */
  frameManually(): void {
    this.framing = "manual";
  }

  /** Flies so that (x, y) lands in the middle of the part of the map no panel covers. */
  flyToVisible(x: number, y: number, zoom: number | null): void {
    const target = this.camera.clampZoom(zoom ?? this.camera.view.zoom, this.viewport);
    const { right, bottom } = this.insets();
    this.camera.flyTo(x + right / 2 / target, y + bottom / 2 / target, target, this.viewport);
  }

  /** Frames the whole land first, then your villages once they're known, unless someone took the wheel. */
  private frameCamera(view: WorldView): void {
    if (this.framing === "manual" || this.framing === "own" || view.map.size === 0 || this.viewport.width <= 1) return;
    const own = view.state?.villages ?? [];
    if (this.framing === "none") {
      const { right, bottom } = this.insets();
      const fit = (Math.min(this.viewport.width - right, this.viewport.height - bottom) / view.map.size) * 0.92;
      const zoom = this.camera.clampZoom(fit, this.viewport);
      this.camera.jumpTo({ cx: view.map.size / 2 + right / 2 / zoom, cy: view.map.size / 2 + bottom / 2 / zoom, zoom }, this.viewport);
      this.framing = "map";
    }
    if (own.length > 0) {
      const cx = own.reduce((s, v) => s + v.x, 0) / own.length;
      const cy = own.reduce((s, v) => s + v.y, 0) / own.length;
      this.flyToVisible(cx, cy, OWN_ZOOM);
      this.framing = "own";
    }
  }

  private ensureTerrain(view: WorldView): Terrain | null {
    if (view.map.size === 0) return null;
    const round = view.summary?.round ?? 1;
    const key = `${view.worldId}#${round}#${view.map.size}`;
    if (key !== this.terrainKey) {
      this.terrainKey = key;
      this.terrain = new Terrain(view.worldId, round, view.map.size);
      this.camera.setMapSize(view.map.size);
    }
    return this.terrain;
  }

  private villagesByDepth(view: WorldView): MapVillage[] {
    if (this.sortedFrom !== view.map.villages) {
      this.sortedFrom = view.map.villages;
      this.sorted = [...view.map.villages.values()].sort((a, b) => a.y - b.y || a.x - b.x);
    }
    return this.sorted;
  }

  colorsFor(village: MapVillage, playerId: string | null): PlayerColors {
    if (!village.ownerId) return HAMLET_COLORS;
    if (village.ownerId === playerId) return OWN_COLORS;
    return colorsForPlayer(village.ownerId);
  }

  villageAt(sx: number, sy: number): MapVillage | null {
    const view = this.view();
    const zoom = this.camera.view.zoom;
    let best: MapVillage | null = null;
    let bestDistance = Infinity;
    for (const v of view.map.villages.values()) {
      const [x, y] = toScreen(this.camera.view, this.viewport, v.x, v.y);
      const reach = Math.max(9, footprint(tierFor(v.points), !v.ownerId) * zoom * 0.48);
      const d = Math.hypot(sx - x, sy - (y - (zoom >= SPRITE_ZOOM ? zoom * 0.1 : 0)));
      if (d < reach && d < bestDistance) {
        best = v;
        bestDistance = d;
      }
    }
    return best;
  }

  frame(now: number): void {
    const view = this.view();
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    // The terrain sets the camera's map size, which framing depends on.
    const terrain = this.ensureTerrain(view);
    this.frameCamera(view);
    this.camera.step(dt, this.viewport);
    this.tick = this.smoother.at(view.clock, now);

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);

    if (!terrain) return;
    this.drawLand(terrain, now);
    const moving = this.collectMovements(view);
    this.drawTerritory(view);
    this.drawRoutes(moving);
    this.drawVillages(view, now);
    this.drawIncoming(view.state?.commands.incoming ?? [], now, paceOf(view.clock));
    this.drawHeads(moving, paceOf(view.clock));
    this.drawEffects(view.effects, now);
    this.drawRings(view, now);
    this.drawLabels(view);
  }

  // ---- Land -----------------------------------------------------------------------------------

  private drawLand(terrain: Terrain, now: number): void {
    const ctx = this.ctx;
    const { zoom } = this.camera.view;
    const size = terrain.size;
    const [left, top] = toScreen(this.camera.view, this.viewport, 0, 0);
    const side = size * zoom;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, side, side);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(terrain.overview(), left, top, side, side);

    const devicePerField = zoom * this.dpr;
    if (devicePerField >= 6) {
      const bucket = 2 ** Math.round(Math.log2(devicePerField));
      const span = TILE_PX / bucket;
      const [wx0, wy0] = toWorld(this.camera.view, this.viewport, 0, 0);
      const [wx1, wy1] = toWorld(this.camera.view, this.viewport, this.viewport.width, this.viewport.height);
      const tx0 = Math.max(0, Math.floor(wx0 / span));
      const ty0 = Math.max(0, Math.floor(wy0 / span));
      const tx1 = Math.min(Math.ceil(size / span) - 1, Math.floor(wx1 / span));
      const ty1 = Math.min(Math.ceil(size / span) - 1, Math.floor(wy1 / span));
      const midX = (tx0 + tx1) / 2;
      const midY = (ty0 + ty1) / 2;
      const wanted: [number, number][] = [];
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) wanted.push([tx, ty]);
      wanted.sort((a, b) => Math.hypot(a[0] - midX, a[1] - midY) - Math.hypot(b[0] - midX, b[1] - midY));
      const deadline = now + TILE_BUDGET_MS;
      const tileSide = span * zoom;
      for (const [tx, ty] of wanted) {
        let tile = terrain.cachedTile(bucket, tx, ty);
        if (!tile && performance.now() < deadline) tile = terrain.paintTile(bucket, tx, ty);
        if (!tile) continue;
        const [sx, sy] = toScreen(this.camera.view, this.viewport, tx * span, ty * span);
        // A hair of overlap hides seams from fractional scaling.
        ctx.drawImage(tile, sx, sy, tileSide + 0.6, tileSide + 0.6);
      }
    }
    ctx.restore();

    // The map's frame: a brass rule with a fine inner line.
    ctx.save();
    ctx.strokeStyle = "rgba(212, 162, 76, 0.55)";
    ctx.lineWidth = 2;
    ctx.strokeRect(left - 4, top - 4, side + 8, side + 8);
    ctx.strokeStyle = "rgba(212, 162, 76, 0.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(left - 9, top - 9, side + 18, side + 18);
    ctx.restore();
  }

  // ---- Villages -------------------------------------------------------------------------------

  /** A soft wash of each owner's colour around their villages, so holdings read at a glance. */
  private drawTerritory(view: WorldView): void {
    const ctx = this.ctx;
    const { zoom } = this.camera.view;
    const reach = Math.max(16, zoom * TERRITORY_FIELDS);
    for (const v of this.villagesByDepth(view)) {
      if (!v.ownerId) continue;
      const [x, y] = toScreen(this.camera.view, this.viewport, v.x, v.y);
      if (x < -reach || y < -reach || x > this.viewport.width + reach || y > this.viewport.height + reach) continue;
      const mine = v.ownerId === view.playerId;
      ctx.globalAlpha = mine ? 0.5 : 0.3;
      ctx.drawImage(glowSprite(this.colorsFor(v, view.playerId).fill), x - reach / 2, y - reach / 2, reach, reach);
    }
    ctx.globalAlpha = 1;
  }

  private drawVillages(view: WorldView, now: number): void {
    const ctx = this.ctx;
    const { zoom } = this.camera.view;
    const playerId = view.playerId;
    const margin = zoom * 2 + 20;
    const glowPulse = 0.72 + 0.2 * Math.sin(now / 700);
    const ownGlow = glowSprite("rgba(240, 199, 112, 0.85)");

    for (const v of this.villagesByDepth(view)) {
      const [x, y] = toScreen(this.camera.view, this.viewport, v.x, v.y);
      if (x < -margin || y < -margin || x > this.viewport.width + margin || y > this.viewport.height + margin) continue;
      const hamlet = !v.ownerId;
      const mine = !!playerId && v.ownerId === playerId;
      const tier = tierFor(v.points);
      const colors = this.colorsFor(v, playerId);

      if (zoom < SPRITE_ZOOM) {
        // Marks grow with zoom, so a whole-map view stays a map and not confetti.
        const r = hamlet ? Math.min(3, 1.6 + zoom * 0.15) : Math.min(4 + tier * 0.6, 2.8 + zoom * 0.3 + tier * 0.35);
        if (mine) {
          ctx.globalAlpha = glowPulse;
          ctx.drawImage(ownGlow, x - r * 5, y - r * 5, r * 10, r * 10);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = colors.fill;
        ctx.strokeStyle = "rgba(20, 14, 8, 0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (mine) {
          ctx.moveTo(x, y - r * 1.4);
          ctx.lineTo(x + r * 1.4, y);
          ctx.lineTo(x, y + r * 1.4);
          ctx.lineTo(x - r * 1.4, y);
          ctx.closePath();
        } else ctx.rect(x - r, y - r, r * 2, r * 2);
        ctx.fill();
        if (!hamlet) ctx.stroke();
        continue;
      }

      const width = footprint(tier, hamlet) * zoom;
      // A cleared patch of ground under every settlement.
      ctx.fillStyle = "rgba(236, 220, 180, 0.55)";
      ctx.beginPath();
      ctx.ellipse(x, y + width * 0.1, width * 0.46, width * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      if (mine) {
        const g = width * 2.6;
        ctx.globalAlpha = glowPulse;
        ctx.drawImage(ownGlow, x - g / 2, y - g / 2, g, g);
        ctx.globalAlpha = 1;
      }
      const sprite = villageSprite(tier, hamlet, colors, spriteBucket(width * this.dpr));
      ctx.drawImage(sprite, x - width * ANCHOR_X, y - width * ANCHOR_Y, width, width);
    }
  }

  private drawRings(view: WorldView, now: number): void {
    const ctx = this.ctx;
    const { zoom } = this.camera.view;
    const ring = (id: string | null, selected: boolean) => {
      if (!id) return;
      const v = view.map.villages.get(id);
      if (!v) return;
      const [x, y] = toScreen(this.camera.view, this.viewport, v.x, v.y);
      const r = Math.max(10, footprint(tierFor(v.points), !v.ownerId) * zoom * 0.62);
      ctx.save();
      ctx.lineWidth = selected ? 2 : 1.25;
      ctx.strokeStyle = selected ? GOLD_BRIGHT : "rgba(240, 199, 112, 0.6)";
      if (selected) {
        ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = -now / 60;
      }
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };
    ring(this.overlay.hoveredId !== this.overlay.selectedId ? this.overlay.hoveredId : null, false);
    ring(this.overlay.selectedId, true);
  }

  private drawLabels(view: WorldView): void {
    const { zoom } = this.camera.view;
    if (zoom < LABEL_ZOOM) return;
    const ctx = this.ctx;
    const playerId = view.playerId;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    const nameSize = Math.min(13, 9 + zoom * 0.08);
    for (const v of this.villagesByDepth(view)) {
      const [x, y] = toScreen(this.camera.view, this.viewport, v.x, v.y);
      if (x < -80 || y < -40 || x > this.viewport.width + 80 || y > this.viewport.height + 40) continue;
      if (!v.ownerId && zoom < HAMLET_LABEL_ZOOM) continue;
      const mine = !!playerId && v.ownerId === playerId;
      const ly = y + footprint(tierFor(v.points), !v.ownerId) * zoom * 0.34 + 2;
      ctx.font = `${mine ? 600 : 500} ${nameSize}px Inter, system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(240, 226, 192, 0.88)";
      ctx.fillStyle = mine ? "#6b4710" : v.ownerId ? "#2b2116" : "#5d5442";
      ctx.strokeText(v.name, x, ly);
      ctx.fillText(v.name, x, ly);
      if (zoom >= POINTS_ZOOM) {
        ctx.font = `500 ${nameSize - 2}px "JetBrains Mono", ui-monospace, monospace`;
        const text = v.ownerName ? `${v.ownerName} · ${v.points}` : `hamlet · ${v.points}`;
        ctx.strokeText(text, x, ly + nameSize + 2);
        ctx.fillStyle = "rgba(43, 33, 22, 0.75)";
        ctx.fillText(text, x, ly + nameSize + 2);
      }
    }
    ctx.restore();
  }

  // ---- Armies and merchants --------------------------------------------------------------------

  private collectMovements(view: WorldView): Moving[] {
    const moving: Moving[] = [];
    const seen = new Set<string>();
    const state = view.state;
    if (state) {
      const few = state.commands.outgoing.length + state.trades.outgoing.length <= 40;
      for (const c of state.commands.outgoing) {
        seen.add(c.id);
        const color = c.kind === "attack" ? EMBER : STEEL;
        moving.push({ id: c.id, leg: commandLeg(c), color, returning: c.returning, label: few, faint: false });
      }
      for (const t of state.trades.outgoing) {
        seen.add(t.id);
        moving.push({ id: t.id, leg: tradeLeg(t), color: AMBER, returning: t.returning, label: few, faint: false });
      }
      for (const t of state.trades.incoming) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        moving.push({ id: t.id, leg: tradeLeg(t), color: AMBER, returning: t.returning, label: false, faint: true });
      }
    }
    if (this.overlay.godView && view.god) {
      for (const m of view.god.movements) {
        if (seen.has(m.id)) continue;
        const color = m.kind === "attack" ? EMBER : m.kind === "support" ? STEEL : AMBER;
        moving.push({ id: m.id, leg: godLeg(m), color, returning: m.returning, label: false, faint: true });
      }
    }
    return moving;
  }

  private drawRoutes(moving: Moving[]): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round";
    for (const m of moving) {
      const t = legProgress(m.leg, this.tick);
      const [hx, hy] = legPoint(m.leg, t);
      const [sx, sy] = toScreen(this.camera.view, this.viewport, hx, hy);
      const [ex, ey] = toScreen(this.camera.view, this.viewport, m.leg.toX, m.leg.toY);
      const [ox, oy] = toScreen(this.camera.view, this.viewport, m.leg.fromX, m.leg.fromY);
      // What's left of the road, dashed.
      ctx.setLineDash(m.faint ? [2, 5] : [5, 6]);
      ctx.globalAlpha = m.faint ? 0.3 : m.returning ? 0.35 : 0.55;
      ctx.strokeStyle = m.color;
      ctx.lineWidth = m.faint ? 1 : 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      // The road behind it, as a fading trail.
      ctx.setLineDash([]);
      const trail = Math.min(1, 46 / Math.max(1, Math.hypot(sx - ox, sy - oy)));
      const [tx, ty] = [sx + (ox - sx) * trail, sy + (oy - sy) * trail];
      const gradient = ctx.createLinearGradient(sx, sy, tx, ty);
      gradient.addColorStop(0, m.color);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = m.faint ? 0.45 : m.returning ? 0.5 : 0.9;
      ctx.strokeStyle = gradient;
      ctx.lineWidth = m.faint ? 1.5 : 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawHeads(moving: Moving[], speed: number): void {
    const ctx = this.ctx;
    const zoom = this.camera.view.zoom;
    for (const m of moving) {
      const t = legProgress(m.leg, this.tick);
      const [wx, wy] = legPoint(m.leg, t);
      const [x, y] = toScreen(this.camera.view, this.viewport, wx, wy);
      if (x < -40 || y < -40 || x > this.viewport.width + 40 || y > this.viewport.height + 40) continue;
      const angle = Math.atan2(m.leg.toY - m.leg.fromY, m.leg.toX - m.leg.fromX);
      const size = m.faint ? 3 : m.returning ? 4 : 5.5;
      ctx.save();
      ctx.globalAlpha = m.faint ? 0.75 : m.returning ? 0.6 : 1;
      if (!m.faint && !m.returning) {
        const glow = glowSprite(m.color);
        ctx.globalAlpha = 0.55;
        ctx.drawImage(glow, x - size * 3.5, y - size * 3.5, size * 7, size * 7);
        ctx.globalAlpha = 1;
      }
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(size * 1.5, 0);
      ctx.lineTo(-size * 0.9, size);
      ctx.lineTo(-size * 0.4, 0);
      ctx.lineTo(-size * 0.9, -size);
      ctx.closePath();
      ctx.fillStyle = m.color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(14, 12, 9, 0.85)";
      ctx.stroke();
      ctx.restore();
      if (m.label && !m.returning && zoom >= PILL_ZOOM) this.drawPill(formatTicksAsTime(m.leg.endTick - this.tick, speed), x, y - size - 13, m.color, 1);
    }
  }

  /** A small mono countdown on a dark pill. */
  private drawPill(text: string, x: number, y: number, color: string, alpha: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = "rgba(14, 12, 9, 0.82)";
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 7, w, 14, 7);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#f3e7cf";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  // ---- Incoming -------------------------------------------------------------------------------

  private drawIncoming(incoming: IncomingCommand[], now: number, speed: number): void {
    if (incoming.length === 0) return;
    const ctx = this.ctx;
    const zoom = this.camera.view.zoom;
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    const byTarget = new Map<string, IncomingCommand[]>();

    for (const c of incoming) {
      const list = byTarget.get(c.to.id) ?? [];
      list.push(c);
      byTarget.set(c.to.id, list);
      const leg = incomingLeg(c);
      const color = c.kind === "attack" ? EMBER : STEEL;
      const [ox, oy] = toScreen(this.camera.view, this.viewport, leg.fromX, leg.fromY);
      const [tx, ty] = toScreen(this.camera.view, this.viewport, leg.toX, leg.toY);
      const length = Math.hypot(tx - ox, ty - oy);
      if (length < 1) continue;
      const ux = (tx - ox) / length;
      const uy = (ty - oy) / length;
      const stop = Math.max(10, zoom * 0.7);
      const ax = tx - ux * stop;
      const ay = ty - uy * stop;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = c.kind === "attack" ? 0.55 + 0.35 * pulse : 0.6;
      ctx.lineWidth = c.kind === "attack" ? 2 : 1.5;
      ctx.setLineDash([9, 7]);
      // Dashes flow toward the target.
      ctx.lineDashOffset = -now / 40;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      ctx.setLineDash([]);
      const head = (c.kind === "attack" ? 9 : 7) * (1 + 0.15 * pulse);
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(ax + ux * head * 0.4, ay + uy * head * 0.4);
      ctx.lineTo(ax - ux * head + uy * head * 0.6, ay - uy * head - ux * head * 0.6);
      ctx.lineTo(ax - ux * head - uy * head * 0.6, ay - uy * head + ux * head * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(14, 12, 9, 0.8)";
      ctx.lineWidth = 1;
      ctx.stroke();
      // Where it should be by now: the route and the timing are known, so the position is too.
      const [px, py] = legPoint(leg, legProgress(leg, this.tick));
      const [mx, my] = toScreen(this.camera.view, this.viewport, px, py);
      ctx.beginPath();
      ctx.arc(mx, my, 4 + 2 * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    for (const list of byTarget.values()) {
      list.sort((a, b) => a.arrivalTick - b.arrivalTick || a.seq - b.seq);
      const first = list[0]!;
      const [tx, ty] = toScreen(this.camera.view, this.viewport, first.to.x, first.to.y);
      const shown = list.slice(0, 3);
      shown.forEach((c, i) => {
        const left = formatTicksAsTime(c.arrivalTick - this.tick, speed);
        const sight = c.kind === "support" ? "support" : c.sighted ? `${c.sighted.size}${c.sighted.envoy ? " · envoy" : ""}` : "unsighted";
        this.drawPill(`${c.kind === "attack" ? "⚔" : "⛨"} ${left} · ${sight}`, tx, ty - Math.max(18, zoom * 0.95) - i * 17, c.kind === "attack" ? EMBER : STEEL, 1);
      });
      if (list.length > shown.length) this.drawPill(`+${list.length - shown.length} more`, tx, ty - Math.max(18, zoom * 0.95) - shown.length * 17, EMBER, 0.8);
    }
  }

  // ---- Effects --------------------------------------------------------------------------------

  private drawEffects(effects: Effect[], now: number): void {
    const ctx = this.ctx;
    const zoom = this.camera.view.zoom;
    const scale = Math.min(1.6, Math.max(0.7, zoom / 14));
    for (const e of effects) {
      if (e.god && !this.overlay.godView) continue;
      const t = (now - e.startedAt) / EFFECT_MS[e.kind];
      if (t < 0 || t >= 1) continue;
      const [x, y] = toScreen(this.camera.view, this.viewport, e.x, e.y);
      if (x < -150 || y < -150 || x > this.viewport.width + 150 || y > this.viewport.height + 150) continue;
      const ease = 1 - (1 - t) ** 3;
      ctx.save();
      if (e.kind === "battle") {
        if (t < 0.18) {
          ctx.globalAlpha = 1 - t / 0.18;
          const flash = glowSprite("rgba(255, 236, 196, 0.95)");
          const f = 46 * scale;
          ctx.drawImage(flash, x - f / 2, y - f / 2, f, f);
        }
        ctx.globalAlpha = (1 - t) * (e.strong ? 1 : 0.8);
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2.5 * (1 - t) + 0.5;
        ctx.beginPath();
        ctx.arc(x, y, (6 + 30 * ease) * scale, 0, Math.PI * 2);
        ctx.stroke();
        // Sparks, at angles fixed by the effect's id so a burst looks the same each frame.
        let seed = 0;
        for (let i = 0; i < e.id.length; i++) seed = (seed * 31 + e.id.charCodeAt(i)) >>> 0;
        ctx.lineCap = "round";
        for (let i = 0; i < 9; i++) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          const a = (i / 9) * Math.PI * 2 + (seed / 4294967296) * 0.6;
          const r0 = (8 + 26 * ease) * scale;
          const r1 = r0 + (6 + 8 * (1 - t)) * scale;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
          ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
          ctx.stroke();
        }
      } else {
        for (let ring = 0; ring < 2; ring++) {
          const rt = Math.max(0, t - ring * 0.18) / (1 - ring * 0.18);
          if (rt <= 0) continue;
          const re = 1 - (1 - rt) ** 2;
          ctx.globalAlpha = (1 - rt) * 0.9;
          ctx.strokeStyle = ring === 0 ? e.color : GOLD;
          ctx.lineWidth = 3 * (1 - rt) + 0.75;
          ctx.beginPath();
          ctx.ellipse(x, y, (10 + 90 * re) * scale, (10 + 90 * re) * scale * 0.7, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = Math.max(0, 1 - t * 1.6);
        const glow = glowSprite(e.color);
        const g = 80 * scale;
        ctx.drawImage(glow, x - g / 2, y - g / 2, g, g);
      }
      ctx.restore();
    }
  }
}
