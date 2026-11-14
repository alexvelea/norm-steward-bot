// The parchment land: procedural from a hash of the world id and round (never the game seed), so it is
// pure decoration and reveals nothing. Ground colour comes from two noise fields (elevation and
// moisture); lakes sit in the low ground, rivers run downhill, forests grow where it's wet and hills
// where it's high. It is painted into tiles cached per zoom bucket, over a whole-map overview that
// stands in while tiles are still being painted.
import { fbm, hash2, hashString, seededRandom } from "../lib/noise";

export const WATER_LEVEL = 0.35;
const SHORE_BAND = 0.02;
/** The inked line at the water's edge, as a band of elevation. */
const COAST_INK = 0.0045;
const FOREST_MOISTURE = 0.575;
const HILL_LEVEL = 0.63;
const PEAK_LEVEL = 0.73;

/** Device pixels per tile side. */
export const TILE_PX = 256;
const SAMPLE_PX = 4;
const OVERVIEW_PX_PER_FIELD = 4;
const MAX_TILES = 220;

type RGB = [number, number, number];

const PARCHMENT: RGB = [234, 215, 172];
const PARCHMENT_WET: RGB = [214, 207, 156];
const PARCHMENT_HIGH: RGB = [208, 184, 140];
const ROCK: RGB = [190, 171, 141];
const SAND: RGB = [238, 222, 182];
const WATER_SHALLOW: RGB = [168, 189, 178];
const WATER_DEEP: RGB = [118, 147, 152];
const COAST: RGB = [96, 84, 62];
const FOREST_FLOOR: RGB = [200, 198, 142];
const EDGE_SHADE: RGB = [120, 96, 64];

const INK = "rgba(62, 45, 28, 0.78)";
const INK_SOFT = "rgba(62, 45, 28, 0.42)";
const TREE_FILL = "rgb(132, 136, 84)";
const TREE_FILL_DARK = "rgb(104, 112, 70)";
const HILL_FILL = "rgba(176, 148, 104, 0.55)";
const RIVER = "rgb(122, 146, 148)";

const EDGE_BURN_FIELDS = 7;

function set(out: RGB, from: RGB): void {
  out[0] = from[0];
  out[1] = from[1];
  out[2] = from[2];
}

/** Moves `out` toward `to` by t, clamped to 0..1, in place. */
function blend(out: RGB, to: RGB, t: number): void {
  if (t <= 0) return;
  const k = t >= 1 ? 1 : t;
  out[0] += (to[0] - out[0]) * k;
  out[1] += (to[1] - out[1]) * k;
  out[2] += (to[2] - out[2]) * k;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

export class Terrain {
  readonly seed: number;
  private readonly rivers: Float32Array[];
  private overviewCanvas: HTMLCanvasElement | null = null;
  private readonly tiles = new Map<string, HTMLCanvasElement>();
  private grain: HTMLCanvasElement | null = null;

  constructor(
    worldId: string,
    round: number,
    readonly size: number,
  ) {
    this.seed = hashString(`${worldId}#${round}`);
    this.rivers = this.traceRivers();
  }

  elevation(x: number, y: number): number {
    // A light domain warp keeps coastlines from looking like blobs.
    const wx = x + (fbm(x / 20, y / 20, this.seed + 11, 2) - 0.5) * 9;
    const wy = y + (fbm(x / 20 + 40, y / 20, this.seed + 13, 2) - 0.5) * 9;
    return fbm(wx / 38, wy / 38, this.seed, 5);
  }

  moisture(x: number, y: number): number {
    return fbm(x / 24 + 300, y / 24, this.seed + 101, 4);
  }

  /**
   * Ground colour from the three fields at a point, written into `out` (no allocation: this runs for
   * every pixel of every tile). x, y are in fields, for the burnt map edge.
   */
  private groundColor(e: number, m: number, detail: number, x: number, y: number, coastBand: number, out: RGB): void {
    if (e < WATER_LEVEL) {
      set(out, WATER_SHALLOW);
      blend(out, WATER_DEEP, ((WATER_LEVEL - e) / WATER_LEVEL) * 3.2);
    } else if (e < WATER_LEVEL + coastBand) {
      // An inked coastline, as a cartographer would draw it.
      set(out, COAST);
    } else if (e < WATER_LEVEL + SHORE_BAND) {
      set(out, SAND);
    } else {
      set(out, PARCHMENT);
      blend(out, PARCHMENT_WET, (m - 0.45) * 4);
      if (m > FOREST_MOISTURE && e < PEAK_LEVEL) blend(out, FOREST_FLOOR, (m - FOREST_MOISTURE) * 9);
      blend(out, PARCHMENT_HIGH, (e - 0.55) * 5);
      blend(out, ROCK, (e - PEAK_LEVEL) * 7);
    }
    // Old maps darken toward their edges.
    const edge = Math.min(x, y, this.size - x, this.size - y);
    if (edge < EDGE_BURN_FIELDS) blend(out, EDGE_SHADE, (1 - edge / EDGE_BURN_FIELDS) ** 2 * 0.55);
    const shade = 1 + (detail - 0.5) * 0.09;
    out[0] *= shade;
    out[1] *= shade;
    out[2] *= shade;
  }

  // ---- Rivers ---------------------------------------------------------------------------------

  private traceRivers(): Float32Array[] {
    const random = seededRandom(this.seed ^ 0x9e3779b9);
    const rivers: Float32Array[] = [];
    const wanted = Math.max(2, Math.round(this.size / 28));
    for (let tries = 0; tries < wanted * 30 && rivers.length < wanted; tries++) {
      const x = random() * this.size;
      const y = random() * this.size;
      if (this.elevation(x, y) < HILL_LEVEL) continue;
      const path = this.flowFrom(x, y);
      if (path.length >= 40) rivers.push(Float32Array.from(path));
    }
    return rivers;
  }

  /** Walks downhill with a little meander until it reaches water or leaves the map. */
  private flowFrom(startX: number, startY: number): number[] {
    const points: number[] = [startX, startY];
    let x = startX;
    let y = startY;
    let heading = 0;
    for (let i = 0; i < 700; i++) {
      const e = this.elevation(x, y);
      if (e < WATER_LEVEL || x < 0 || y < 0 || x > this.size || y > this.size) break;
      const gx = this.elevation(x + 0.5, y) - this.elevation(x - 0.5, y);
      const gy = this.elevation(x, y + 0.5) - this.elevation(x, y - 0.5);
      const downhill = Math.atan2(-gy, -gx);
      const meander = (fbm(x / 6, y / 6, this.seed + 55, 2) - 0.5) * 1.6;
      const target = downhill + meander;
      heading = i === 0 ? target : heading + Math.atan2(Math.sin(target - heading), Math.cos(target - heading)) * 0.35;
      x += Math.cos(heading) * 0.45;
      y += Math.sin(heading) * 0.45;
      points.push(x, y);
    }
    return points;
  }

  private drawRivers(ctx: CanvasRenderingContext2D, originX: number, originY: number, pxPerField: number): void {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = RIVER;
    for (const river of this.rivers) {
      const count = river.length / 2;
      // Rivers widen as they run; draw in a few strokes of growing width.
      const segments = 4;
      for (let s = 0; s < segments; s++) {
        const from = Math.floor((count * s) / segments);
        const to = Math.min(count - 1, Math.floor((count * (s + 1)) / segments) + 1);
        ctx.lineWidth = Math.max(0.8, pxPerField * (0.07 + 0.05 * s));
        ctx.beginPath();
        for (let i = from; i <= to; i++) {
          const px = (river[i * 2]! - originX) * pxPerField;
          const py = (river[i * 2 + 1]! - originY) * pxPerField;
          if (i === from) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---- Paper ----------------------------------------------------------------------------------

  private grainTexture(): HTMLCanvasElement {
    if (this.grain) return this.grain;
    const side = 256;
    const canvas = makeCanvas(side, side);
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(side, side);
    const random = seededRandom(this.seed ^ 0x51ed27);
    for (let i = 0; i < side * side; i++) {
      const v = 255 - random() * random() * 70;
      image.data[i * 4] = v;
      image.data[i * 4 + 1] = v * 0.97;
      image.data[i * 4 + 2] = v * 0.9;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    // A few long fibres.
    ctx.strokeStyle = "rgba(120, 90, 50, 0.10)";
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 40; i++) {
      const x = random() * side;
      const y = random() * side;
      const a = random() * Math.PI;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9 + 3, x + Math.cos(a) * 18, y + Math.sin(a) * 18);
      ctx.stroke();
    }
    this.grain = canvas;
    return canvas;
  }

  private applyGrain(ctx: CanvasRenderingContext2D, width: number, height: number, offsetX: number, offsetY: number): void {
    const pattern = ctx.createPattern(this.grainTexture(), "repeat");
    if (!pattern) return;
    pattern.setTransform(new DOMMatrix().translate(-offsetX % 256, -offsetY % 256));
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  // ---- Painting -------------------------------------------------------------------------------

  /**
   * Paints ground colour for a region into ctx at `pxPerField`. The noise fields are sampled every
   * `step` pixels and interpolated per pixel, so coastlines stay crisp and smooth at any zoom while
   * the noise itself is evaluated only on the coarse grid.
   */
  private paintGround(ctx: CanvasRenderingContext2D, originX: number, originY: number, pxPerField: number, width: number, height: number, step: number): void {
    const cols = Math.ceil(width / step) + 2;
    const rows = Math.ceil(height / step) + 2;
    const elevation = new Float32Array(cols * rows);
    const moisture = new Float32Array(cols * rows);
    const detail = new Float32Array(cols * rows);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const fx = originX + (col * step) / pxPerField;
        const fy = originY + (row * step) / pxPerField;
        const i = row * cols + col;
        elevation[i] = this.elevation(fx, fy);
        moisture[i] = this.moisture(fx, fy);
        detail[i] = fbm(fx / 3.1, fy / 3.1, this.seed + 7, 2);
      }
    }
    const image = ctx.createImageData(width, height);
    const color: RGB = [0, 0, 0];
    // A coastline about a pixel or two wide whatever the zoom.
    const coastBand = Math.min(COAST_INK * 2, (COAST_INK * 12) / pxPerField);
    const lerp = (field: Float32Array, i: number, tx: number, ty: number) => {
      const a = field[i]!;
      const b = field[i + 1]!;
      const c = field[i + cols]!;
      const d = field[i + cols + 1]!;
      return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };
    for (let py = 0; py < height; py++) {
      const gy = py / step;
      const row = Math.floor(gy);
      const ty = gy - row;
      for (let px = 0; px < width; px++) {
        const gx = px / step;
        const col = Math.floor(gx);
        const tx = gx - col;
        const i = row * cols + col;
        this.groundColor(lerp(elevation, i, tx, ty), lerp(moisture, i, tx, ty), lerp(detail, i, tx, ty), originX + px / pxPerField, originY + py / pxPerField, coastBand, color);
        const o = (py * width + px) * 4;
        image.data[o] = color[0];
        image.data[o + 1] = color[1];
        image.data[o + 2] = color[2];
        image.data[o + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  /** The whole map at a few pixels per field. */
  overview(): HTMLCanvasElement {
    if (this.overviewCanvas) return this.overviewCanvas;
    const px = OVERVIEW_PX_PER_FIELD;
    const side = this.size * px;
    const canvas = makeCanvas(side, side);
    const ctx = canvas.getContext("2d")!;
    this.paintGround(ctx, 0, 0, px, side, side, 2);
    this.drawRivers(ctx, 0, 0, px);
    this.applyGrain(ctx, side, side, 0, 0);
    this.overviewCanvas = canvas;
    return canvas;
  }

  overviewScale(): number {
    return OVERVIEW_PX_PER_FIELD;
  }

  /** A cached tile, or null when it isn't painted yet (paint it with paintTile). */
  cachedTile(bucket: number, tx: number, ty: number): HTMLCanvasElement | null {
    const key = `${bucket}:${tx}:${ty}`;
    const tile = this.tiles.get(key);
    if (!tile) return null;
    // Refresh its place in the LRU order.
    this.tiles.delete(key);
    this.tiles.set(key, tile);
    return tile;
  }

  paintTile(bucket: number, tx: number, ty: number): HTMLCanvasElement {
    const canvas = makeCanvas(TILE_PX, TILE_PX);
    const ctx = canvas.getContext("2d")!;
    const span = TILE_PX / bucket;
    const originX = tx * span;
    const originY = ty * span;
    this.paintGround(ctx, originX, originY, bucket, TILE_PX, TILE_PX, SAMPLE_PX);
    this.drawRivers(ctx, originX, originY, bucket);
    if (bucket >= 6) this.drawFeatures(ctx, originX, originY, span, bucket);
    this.drawGrid(ctx, originX, originY, span, bucket);
    this.applyGrain(ctx, TILE_PX, TILE_PX, originX * bucket, originY * bucket);
    const key = `${bucket}:${tx}:${ty}`;
    this.tiles.set(key, canvas);
    while (this.tiles.size > MAX_TILES) this.tiles.delete(this.tiles.keys().next().value!);
    return canvas;
  }

  /** Trees, hills and peaks, one decision per field from its hash so tiles agree at their seams. */
  private drawFeatures(ctx: CanvasRenderingContext2D, originX: number, originY: number, span: number, px: number): void {
    const x0 = Math.floor(originX) - 1;
    const y0 = Math.floor(originY) - 1;
    const x1 = Math.ceil(originX + span) + 1;
    const y1 = Math.ceil(originY + span) + 1;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (let fy = y0; fy < y1; fy++) {
      for (let fx = x0; fx < x1; fx++) {
        if (fx < 0 || fy < 0 || fx >= this.size || fy >= this.size) continue;
        const cx = fx + 0.5;
        const cy = fy + 0.5;
        const e = this.elevation(cx, cy);
        if (e < WATER_LEVEL + SHORE_BAND * 1.5) continue;
        const m = this.moisture(cx, cy);
        const roll = hash2(fx, fy, this.seed);
        const sx = (cx - originX) * px;
        const sy = (cy - originY) * px;
        if (e > PEAK_LEVEL && roll < 0.5) this.drawPeak(ctx, sx, sy, px, roll);
        else if (e > HILL_LEVEL && roll < 0.3) this.drawHill(ctx, sx, sy, px, roll);
        else if (m > FOREST_MOISTURE && e < PEAK_LEVEL) {
          const density = Math.min(1, 0.35 + (m - FOREST_MOISTURE) * 7);
          this.drawGrove(ctx, fx, fy, sx, sy, px, density);
        } else if (roll < 0.015) this.drawGrove(ctx, fx, fy, sx, sy, px, 0.4);
      }
    }
    ctx.restore();
  }

  private drawGrove(ctx: CanvasRenderingContext2D, fx: number, fy: number, sx: number, sy: number, px: number, density: number): void {
    // Fewer, larger trees when zoomed out, so a forest reads as a forest and not as noise.
    const trees = Math.max(1, Math.round(density * (px >= 24 ? 3 : 2)));
    for (let i = 0; i < trees; i++) {
      const r1 = hash2(fx * 3 + i, fy * 7 - i, this.seed + 17);
      const r2 = hash2(fx * 5 - i, fy * 3 + i, this.seed + 23);
      if (r1 > 0.25 + density * 0.7) continue;
      const tx = sx + (r1 - 0.5) * px * 0.8;
      const ty = sy + (r2 - 0.5) * px * 0.8;
      const s = px * (0.26 + r2 * 0.12);
      if (r2 < 0.4) this.drawConifer(ctx, tx, ty, s);
      else this.drawBroadleaf(ctx, tx, ty, s, r1 < 0.5);
    }
  }

  private drawBroadleaf(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, dark: boolean): void {
    ctx.lineWidth = Math.max(0.5, s * 0.09);
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.15);
    ctx.lineTo(x, y + s * 0.62);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - s * 0.08, s * 0.38, 0, Math.PI * 2);
    ctx.fillStyle = dark ? TREE_FILL_DARK : TREE_FILL;
    ctx.fill();
    ctx.stroke();
  }

  private drawConifer(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    ctx.lineWidth = Math.max(0.5, s * 0.09);
    ctx.strokeStyle = INK;
    ctx.fillStyle = TREE_FILL_DARK;
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.62);
    ctx.lineTo(x + s * 0.3, y + s * 0.38);
    ctx.lineTo(x - s * 0.3, y + s * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.38);
    ctx.lineTo(x, y + s * 0.6);
    ctx.stroke();
  }

  private drawHill(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, roll: number): void {
    const w = px * (0.62 + roll * 0.4);
    const h = w * 0.42;
    ctx.lineWidth = Math.max(0.5, px * 0.035);
    ctx.fillStyle = HILL_FILL;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y + h / 2);
    ctx.quadraticCurveTo(x, y - h * 1.1, x + w / 2, y + h / 2);
    ctx.fill();
    ctx.stroke();
    // Hachures on the shaded side.
    ctx.strokeStyle = INK_SOFT;
    for (let i = 1; i <= 3; i++) {
      const t = 0.5 + i * 0.12;
      const hx = x - w / 2 + w * t;
      const hy = y + h / 2 - (1 - (2 * t - 1) ** 2) * h * 0.8;
      ctx.beginPath();
      ctx.moveTo(hx, hy + h * 0.15);
      ctx.lineTo(hx - w * 0.05, y + h / 2);
      ctx.stroke();
    }
  }

  private drawPeak(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, roll: number): void {
    const w = px * (0.72 + roll * 0.5);
    const h = w * 0.78;
    const top = y - h * 0.55;
    const base = y + h * 0.45;
    ctx.lineWidth = Math.max(0.5, px * 0.04);
    ctx.strokeStyle = INK;
    ctx.fillStyle = "rgba(226, 210, 176, 0.95)";
    ctx.beginPath();
    ctx.moveTo(x - w / 2, base);
    ctx.lineTo(x - w * 0.04, top);
    ctx.lineTo(x + w / 2, base);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(150, 122, 86, 0.55)";
    ctx.beginPath();
    ctx.moveTo(x - w * 0.04, top);
    ctx.lineTo(x + w / 2, base);
    ctx.lineTo(x + w * 0.08, base);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - w / 2, base);
    ctx.lineTo(x - w * 0.04, top);
    ctx.lineTo(x + w / 2, base);
    ctx.stroke();
  }

  private drawGrid(ctx: CanvasRenderingContext2D, originX: number, originY: number, span: number, px: number): void {
    const every = px >= 28 ? 1 : px >= 6 ? 10 : 0;
    if (!every) return;
    ctx.save();
    ctx.lineWidth = 1;
    const first = Math.ceil(originX / every) * every;
    const firstY = Math.ceil(originY / every) * every;
    for (let pass = 0; pass < 2; pass++) {
      const major = pass === 1;
      if (major && every === 10) continue;
      ctx.strokeStyle = major ? "rgba(70, 50, 28, 0.16)" : every === 1 ? "rgba(70, 50, 28, 0.07)" : "rgba(70, 50, 28, 0.13)";
      ctx.beginPath();
      for (let gx = first; gx <= originX + span; gx += every) {
        if (major && gx % 10 !== 0) continue;
        const sx = Math.round((gx - originX) * px) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, TILE_PX);
      }
      for (let gy = firstY; gy <= originY + span; gy += every) {
        if (major && gy % 10 !== 0) continue;
        const sy = Math.round((gy - originY) * px) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(TILE_PX, sy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}
