// Colours. The CSS custom properties in styles.css are the theme; the canvas needs the same values in
// code, so they are named once here. Player colours are stable per player id and keep clear of gold,
// which means "you".

export const INK = "#0e0c09";
export const GOLD = "#d4a24c";
export const GOLD_BRIGHT = "#f0c770";
export const EMBER = "#e0533d";
export const STEEL = "#5b8bd9";
export const AMBER = "#e6a23c";
export const PARCHMENT_INK = "#2b2116";
export const HAMLET = "#8d8169";

export interface PlayerColors {
  fill: string;
  dark: string;
  light: string;
}

const cache = new Map<string, PlayerColors>();

function idHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Hues from 0..360 with the gold band (35..60) cut out; lightness varies a little so neighbours differ. */
export function colorsForPlayer(id: string): PlayerColors {
  const hit = cache.get(id);
  if (hit) return hit;
  const h = idHash(id);
  const usable = 360 - 25;
  let hue = ((h % 3600) / 10) % usable;
  if (hue >= 35) hue += 25;
  const lightness = 44 + ((h >>> 12) % 3) * 6;
  const saturation = 52 + ((h >>> 16) % 4) * 7;
  const colors = {
    fill: `hsl(${hue.toFixed(0)} ${saturation}% ${lightness}%)`,
    dark: `hsl(${hue.toFixed(0)} ${saturation}% ${lightness - 22}%)`,
    light: `hsl(${hue.toFixed(0)} ${saturation + 10}% ${lightness + 22}%)`,
  };
  cache.set(id, colors);
  return colors;
}

export const OWN_COLORS: PlayerColors = { fill: GOLD, dark: "#7a5518", light: GOLD_BRIGHT };
export const HAMLET_COLORS: PlayerColors = { fill: HAMLET, dark: "#4d4536", light: "#b9ae94" };
