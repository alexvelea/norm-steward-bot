import { useEffect, useState } from "react";
import type { ControlView } from "../../../src/control/types";
import { apiKey } from "./keyStore";
export type { ControlView };
export type {
  PlanningAllocation,
  PlanningBlocker,
  PlanningCandidate,
  PlanningNode,
  PlanningNodeState,
  PlanningOperation,
  PlanningMission,
  PlanningProjection,
  PlanningReservation,
  PlanningVillage,
  TaskState,
} from "../../../src/bot/diagnostics/planning";
export async function controlRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch("/control" + path, {
    method,
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || `Control service HTTP ${r.status}`);
  return json as T;
}
export function useControl() {
  const [view, setView] = useState<ControlView | null>(null),
    [error, setError] = useState("");
  const refresh = async () => {
    try {
      setView(await controlRequest<ControlView>("/state"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await controlRequest<ControlView>("/state");
        if (active) {
          setView(value);
          setError("");
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
      if (active) timeout = setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, []);
  return { view, error, refresh, setView };
}
export async function loginCurrentKey(): Promise<void> {
  const key = apiKey.get();
  if (!key) throw new Error("Enter your existing player key to unlock this control center.");
  await controlRequest("/session", "POST", { apiKey: key });
}
