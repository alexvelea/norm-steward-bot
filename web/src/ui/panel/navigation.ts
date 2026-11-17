export const TABS = [
  { id: "holding", label: "Holdings" },
  { id: "army", label: "Army" },
  { id: "orders", label: "Orders" },
  { id: "reports", label: "Reports" },
  { id: "chronicle", label: "Chronicle" },
  { id: "standings", label: "Standings" },
] as const;

export type TabId = typeof TABS[number]["id"] | "steward";
export function linkedTab(value: string): TabId | null {
  if (value === "command") return "orders";
  return value === "steward" || TABS.some((t) => t.id === value) ? value as TabId : null;
}
export function rememberedTab(): TabId {
  const linked = linkedTab(location.hash.slice(1));
  if (linked) return linked;
  try {
    return linkedTab(localStorage.getItem("norn-steward.panelTab") ?? "") ?? "holding";
  } catch {
    return "holding";
  }
}
export function rememberTab(tab: TabId) {
  try { localStorage.setItem("norn-steward.panelTab", tab); } catch { /* Storage is optional. */ }
}
