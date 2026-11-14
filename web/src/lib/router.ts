// Client-side routing on the history API: `/` and `/w/<id>`. With ?mock=1 the dev mock world feeds the
// page, and world links use `?w=<id>` so a plain static file server (no SPA fallback) can reload them.
import { useSyncExternalStore } from "react";

export type Route = { name: "home" } | { name: "world"; worldId: string };

const CHANGE = "steward:navigate";

export function isMock(): boolean {
  return new URLSearchParams(location.search).has("mock");
}

function parse(): Route {
  const query = new URLSearchParams(location.search);
  const fromQuery = query.get("w");
  if (fromQuery) return { name: "world", worldId: fromQuery };
  const match = /^\/w\/([^/]+)\/?$/.exec(location.pathname);
  if (match) return { name: "world", worldId: decodeURIComponent(match[1]!) };
  return { name: "home" };
}

let current = parse();
let currentHref = location.href;

function snapshot(): Route {
  if (location.href !== currentHref) {
    currentHref = location.href;
    current = parse();
  }
  return current;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener(CHANGE, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(CHANGE, listener);
  };
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function homeHref(): string {
  return isMock() ? "/?mock=1" : "/";
}

export function worldHref(worldId: string): string {
  const id = encodeURIComponent(worldId);
  return isMock() ? `/?mock=1&w=${id}` : `/w/${id}`;
}

export function navigate(href: string): void {
  if (href === location.pathname + location.search) return;
  history.pushState(null, "", href);
  window.dispatchEvent(new Event(CHANGE));
  window.scrollTo(0, 0);
}

/** For <a onClick>: lets modified clicks open a new tab as usual. */
export function followLink(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault(): void }, href: string): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(href);
}
