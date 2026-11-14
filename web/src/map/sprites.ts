// Villages drawn procedurally, once per (shape, colours, pixel size), into offscreen canvases that the
// renderer stamps every frame. A village is a keep that grows through six tiers with its points;
// hamlets are a couple of muted huts. Shapes are drawn on a 64-unit box with the ground line at 50.
import { PARCHMENT_INK, type PlayerColors } from "../lib/palette";

/** Points at which a village reaches each tier. Purely visual; not a game rule. */
const TIER_FLOOR_POINTS = [0, 120, 400, 1200, 3500, 8000];
export const TIER_COUNT = TIER_FLOOR_POINTS.length;

export function tierFor(points: number): number {
  let tier = 0;
  for (let i = 0; i < TIER_FLOOR_POINTS.length; i++) if (points >= TIER_FLOOR_POINTS[i]!) tier = i;
  return tier;
}

/** Width of the drawn village, in fields. Villages sit at least MAP.minSpacing apart, so this stays under 2. */
export function footprint(tier: number, hamlet: boolean): number {
  return hamlet ? 1.2 : 1.2 + tier * 0.12;
}

const STONE = "#e6d6b0";
const STONE_SHADE = "#c9b48a";
const TIMBER = "#d9c094";
const DOOR = "#3a2a1a";
const DESIGN = 64;

type Ctx = CanvasRenderingContext2D;

function outline(ctx: Ctx): void {
  ctx.strokeStyle = PARCHMENT_INK;
  ctx.lineWidth = 1.7;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function shadow(ctx: Ctx, rx: number): void {
  ctx.beginPath();
  ctx.ellipse(32, 51, rx, rx * 0.24, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(48, 32, 16, 0.28)";
  ctx.fill();
}

function cottage(ctx: Ctx, x: number, base: number, w: number, h: number, roof: string): void {
  ctx.beginPath();
  ctx.rect(x - w / 2, base - h, w, h);
  ctx.fillStyle = TIMBER;
  ctx.fill();
  outline(ctx);
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 2, base - h + 0.5);
  ctx.lineTo(x, base - h - w * 0.62);
  ctx.lineTo(x + w / 2 + 2, base - h + 0.5);
  ctx.closePath();
  ctx.fillStyle = roof;
  ctx.fill();
  outline(ctx);
  ctx.fillStyle = DOOR;
  ctx.fillRect(x - w * 0.12, base - h * 0.55, w * 0.24, h * 0.55);
}

function crenels(ctx: Ctx, left: number, top: number, width: number, merlon: number): void {
  const count = Math.max(2, Math.round(width / (merlon * 2)));
  const step = width / count;
  ctx.beginPath();
  for (let i = 0; i < count; i++) ctx.rect(left + i * step + step * 0.18, top - merlon, step * 0.64, merlon);
  ctx.fillStyle = STONE;
  ctx.fill();
  outline(ctx);
}

function tower(ctx: Ctx, x: number, base: number, w: number, h: number, roof: string | null): void {
  ctx.beginPath();
  ctx.rect(x - w / 2, base - h, w, h);
  ctx.fillStyle = STONE;
  ctx.fill();
  outline(ctx);
  // Shaded right face reads as volume at small sizes.
  ctx.fillStyle = STONE_SHADE;
  ctx.fillRect(x + w * 0.12, base - h + 1, w * 0.36, h - 2);
  ctx.fillStyle = DOOR;
  ctx.fillRect(x - w * 0.1, base - h * 0.62, w * 0.2, h * 0.16);
  if (roof) {
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 1.5, base - h);
    ctx.lineTo(x, base - h - w * 1.05);
    ctx.lineTo(x + w / 2 + 1.5, base - h);
    ctx.closePath();
    ctx.fillStyle = roof;
    ctx.fill();
    outline(ctx);
  } else {
    crenels(ctx, x - w / 2, base - h, w, 3);
  }
}

function curtainWall(ctx: Ctx, left: number, right: number, base: number, h: number): void {
  ctx.beginPath();
  ctx.rect(left, base - h, right - left, h);
  ctx.fillStyle = STONE;
  ctx.fill();
  outline(ctx);
  crenels(ctx, left, base - h, right - left, 2.6);
  ctx.beginPath();
  ctx.arc(32, base, 3.4, Math.PI, 0);
  ctx.fillStyle = DOOR;
  ctx.fill();
}

function banner(ctx: Ctx, x: number, top: number, colors: PlayerColors): void {
  ctx.beginPath();
  ctx.moveTo(x, top + 11);
  ctx.lineTo(x, top);
  ctx.strokeStyle = PARCHMENT_INK;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x + 9, top + 1.5);
  ctx.lineTo(x + 6.5, top + 3.5);
  ctx.lineTo(x + 9, top + 5.5);
  ctx.lineTo(x, top + 5.5);
  ctx.closePath();
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawVillage(ctx: Ctx, tier: number, colors: PlayerColors): void {
  const roof = colors.fill;
  switch (tier) {
    case 0:
      shadow(ctx, 15);
      cottage(ctx, 25, 50, 12, 9, roof);
      cottage(ctx, 39, 50, 10, 7, colors.dark);
      banner(ctx, 25, 22, colors);
      break;
    case 1:
      shadow(ctx, 18);
      cottage(ctx, 18, 50, 11, 8, colors.dark);
      tower(ctx, 32, 50, 10, 20, roof);
      cottage(ctx, 46, 50, 11, 8, roof);
      banner(ctx, 32, 12, colors);
      break;
    case 2:
      shadow(ctx, 20);
      cottage(ctx, 15, 50, 10, 8, roof);
      tower(ctx, 32, 50, 16, 22, null);
      cottage(ctx, 49, 50, 10, 8, colors.dark);
      banner(ctx, 32, 14, colors);
      break;
    case 3:
      shadow(ctx, 23);
      tower(ctx, 32, 44, 16, 22, null);
      tower(ctx, 47, 44, 8, 16, roof);
      curtainWall(ctx, 12, 52, 50, 8);
      banner(ctx, 32, 8, colors);
      break;
    case 4:
      shadow(ctx, 26);
      tower(ctx, 32, 43, 18, 25, null);
      tower(ctx, 14, 46, 9, 20, roof);
      tower(ctx, 50, 46, 9, 20, roof);
      curtainWall(ctx, 14, 50, 50, 9);
      banner(ctx, 32, 4, colors);
      break;
    default:
      shadow(ctx, 29);
      tower(ctx, 32, 42, 20, 28, null);
      tower(ctx, 11, 46, 10, 22, roof);
      tower(ctx, 53, 46, 10, 22, roof);
      tower(ctx, 22, 40, 7, 14, colors.dark);
      curtainWall(ctx, 11, 53, 51, 10);
      banner(ctx, 32, 0, colors);
      banner(ctx, 11, 9, colors);
      break;
  }
}

function drawHamlet(ctx: Ctx, colors: PlayerColors): void {
  shadow(ctx, 14);
  const thatch = colors.light;
  cottage(ctx, 25, 50, 11, 7, thatch);
  cottage(ctx, 39, 50, 9, 6, colors.fill);
  // A fence line.
  ctx.beginPath();
  ctx.moveTo(14, 51);
  ctx.lineTo(50, 51);
  ctx.strokeStyle = PARCHMENT_INK;
  ctx.lineWidth = 1;
  ctx.stroke();
}

const cache = new Map<string, HTMLCanvasElement>();
const MAX_SPRITES = 600;

/** Sprite pixel sizes snap to a few buckets so the cache stays small while zooming. */
export function spriteBucket(devicePx: number): number {
  if (devicePx <= 24) return 24;
  if (devicePx <= 40) return 40;
  if (devicePx <= 64) return 64;
  if (devicePx <= 96) return 96;
  if (devicePx <= 144) return 144;
  return 208;
}

export function villageSprite(tier: number, hamlet: boolean, colors: PlayerColors, px: number): HTMLCanvasElement {
  const key = `${hamlet ? "h" : tier}:${colors.fill}:${px}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(px / DESIGN, px / DESIGN);
  if (hamlet) drawHamlet(ctx, colors);
  else drawVillage(ctx, tier, colors);
  cache.set(key, canvas);
  if (cache.size > MAX_SPRITES) cache.delete(cache.keys().next().value!);
  return canvas;
}

/** A soft radial glow, cached per colour. */
const glows = new Map<string, HTMLCanvasElement>();
export function glowSprite(color: string): HTMLCanvasElement {
  const hit = glows.get(color);
  if (hit) return hit;
  const side = 128;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(side / 2, side / 2, 0, side / 2, side / 2, side / 2);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, side, side);
  glows.set(color, canvas);
  return canvas;
}
