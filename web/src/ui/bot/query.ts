import { useRoute } from "../../lib/router";

export function useQuery(): URLSearchParams {
  useRoute();
  return new URLSearchParams(location.search);
}

/** Updates view-only query state (tab, node, village) without adding history entries for each click. */
export function setQuery(values: Record<string, string | null>, push = false): void {
  const query = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(values)) {
    if (value === null) query.delete(key);
    else query.set(key, value);
  }
  const search = query.toString();
  const href = location.pathname + (search ? `?${search}` : "");
  if (push) history.pushState(null, "", href);
  else history.replaceState(null, "", href);
  window.dispatchEvent(new Event("steward:navigate"));
}

export function humanize(code: string): string {
  const text = code.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replaceAll("-", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
