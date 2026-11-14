// A minimal external store for React's useSyncExternalStore. The map renderer reads `get()` every
// frame without subscribing; React components subscribe through useStore with a selector.
import { useCallback, useSyncExternalStore } from "react";

export class Store<T> {
  private listeners = new Set<() => void>();

  constructor(private value: T) {}

  get = (): T => this.value;

  set(next: T | ((current: T) => T)): void {
    const value = typeof next === "function" ? (next as (current: T) => T)(this.value) : next;
    if (Object.is(value, this.value)) return;
    this.value = value;
    for (const listener of this.listeners) listener();
  }

  update(patch: Partial<T>): void {
    this.set({ ...this.value, ...patch });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/** Subscribes to a slice. The selector must return something stable (a field, not a new object). */
export function useStore<T, S>(store: Store<T>, select: (value: T) => S): S {
  const getSnapshot = useCallback(() => select(store.get()), [store, select]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
