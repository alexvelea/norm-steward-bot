// The pasted API key lives in this browser only. Storage can be missing or throw (private windows,
// blocked site data), so every access is guarded and the dashboard works without it.
import { Store, useStore } from "./store";

const STORAGE_KEY = "norn-steward.apiKey";

function read(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function write(key: string | null): void {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Kept for this page only.
  }
}

export const apiKey = new Store<string | null>(read());

export function setApiKey(key: string | null): void {
  write(key);
  apiKey.set(key);
}

const identity = (key: string | null) => key;
export function useApiKey(): string | null {
  return useStore(apiKey, identity);
}

/** Keys look like `nsk_` + 43 base62 chars (SignupResponse.apiKey). */
export function looksLikeKey(text: string): boolean {
  return /^nsk_[0-9A-Za-z]{20,}$/.test(text.trim());
}

if (typeof window !== "undefined") window.addEventListener("storage", event => { if (event.key === STORAGE_KEY) apiKey.set(read()); });
