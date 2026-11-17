import type { UnitId } from "../../contract";

const paths: Record<UnitId, string> = {
  pikeman: "M6 22 18 4m-4 2 4-2-1 5M5 15l5 3",
  shieldman: "M5 5 12 2l7 3v8q-1 6-7 9-6-3-7-9Zm7-1v15M6 10h12",
  raider: "M7 22 17 3m-3 3 6 2-2 7-7-4M5 17l5 2",
  archer: "M7 3q17 9 0 18L7 3m0 9h15m-4-3 4 3-4 3",
  scout: "M2 12q10-14 20 0-10 14-20 0Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  lancer: "M3 22 20 2m-4 2 4-2v5M4 17l4 3m-5-8 5-5 5 5-3 7H4Z",
  knight: "M5 21v-7l4-4-1-6 6 1 5 9-4 2-2-5-2 4v6Zm3-13 6-3m-3-3 3 3",
  ram: "M3 10h16v6H3Zm2 6v3m12-3v3M5 20h1m11 0h1M19 9l3 4-3 4M7 10V6h8v4",
  trebuchet: "M3 21h19M7 20 13 8l5 12M5 4l15 10M5 4v8h4V6m11 8v5m-1 1h3",
  envoy: "M7 23V2m0 1h13l-3 4 3 4H7M3 23h8",
};

export function UnitIcon({ unit }: { unit: UnitId }) {
  return <svg className="unit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[unit]} /></svg>;
}
