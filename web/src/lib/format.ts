// Formatting for people: numbers, game time and real time.
import type { Resources, UnitCounts } from "../contract";
import { UNITS, UNIT_IDS } from "../contract";

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatInt(value: number): string {
  return integer.format(Math.floor(value));
}

export function formatCompact(value: number): string {
  return Math.abs(value) < 10_000 ? formatInt(value) : compact.format(value);
}

/** Seconds as "0:42", "12:05" or "3h 04m". */
export function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Ticks until something, shown as real time at the world's speed (ticks per real second); with no pace (0), as ticks. */
export function formatTicksAsTime(ticks: number, speed: number): string {
  if (speed > 0) return formatSeconds(ticks / speed);
  const whole = Math.max(0, Math.ceil(ticks));
  return `${formatInt(whole)} ${whole === 1 ? "tick" : "ticks"}`;
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

export function formatResources(resources: Partial<Resources> | null | undefined): string {
  if (!resources) return "nothing";
  const parts = (["timber", "stone", "iron"] as const)
    .filter((r) => (resources[r] ?? 0) > 0)
    .map((r) => `${formatCompact(resources[r] ?? 0)} ${r}`);
  return parts.length ? parts.join(" · ") : "nothing";
}

export function unitEntries(units: UnitCounts | null | undefined): [keyof typeof UNITS, number][] {
  if (!units) return [];
  return UNIT_IDS.filter((u) => (units[u] ?? 0) > 0).map((u) => [u, units[u] ?? 0]);
}

export function formatUnits(units: UnitCounts | null | undefined): string {
  const entries = unitEntries(units);
  return entries.length ? entries.map(([u, n]) => `${formatCompact(n)} ${UNITS[u].name.toLowerCase()}`).join(", ") : "none";
}

export function unitPop(units: UnitCounts | null | undefined): number {
  return unitEntries(units).reduce((sum, [u, n]) => sum + UNITS[u].pop * n, 0);
}

export function titleCase(text: string): string {
  return text.replace(/(^|_)(\w)/g, (_, gap: string, c: string) => (gap ? " " : "") + c.toUpperCase());
}
