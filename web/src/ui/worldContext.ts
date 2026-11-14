// What every part of the world page shares: the client feeding it, the map's controller, and which
// village is selected.
import { createContext, useContext } from "react";
import { useStore } from "../lib/store";
import type { MapController } from "../map/MapView";
import type { WorldClient, WorldView } from "../world/types";

export interface WorldContextValue {
  client: WorldClient;
  map: MapController;
  selectedId: string | null;
  townOpen: boolean;
  setTownOpen(open: boolean): void;
  select(villageId: string | null, focus?: boolean): void;
}

export const WorldContext = createContext<WorldContextValue | null>(null);

export function useWorldContext(): WorldContextValue {
  const value = useContext(WorldContext);
  if (!value) throw new Error("useWorldContext outside a world page");
  return value;
}

/** Subscribes to one slice of the world view. Pass a module-level selector so it stays stable. */
export function useWorld<S>(select: (view: WorldView) => S): S {
  return useStore(useWorldContext().client.store, select);
}

export const selectState = (v: WorldView) => v.state;
export const selectClock = (v: WorldView) => v.clock;
export const selectSummary = (v: WorldView) => v.summary;
export const selectMap = (v: WorldView) => v.map;
export const selectActivity = (v: WorldView) => v.activity;
export const selectReports = (v: WorldView) => v.reports;
export const selectReportsNext = (v: WorldView) => v.reportsNext;
export const selectHistory = (v: WorldView) => v.history;
export const selectLeaderboard = (v: WorldView) => v.leaderboard;
export const selectPlayerId = (v: WorldView) => v.playerId;
export const selectIsCreator = (v: WorldView) => v.isCreator;
export const selectConnection = (v: WorldView) => v.connection;
export const selectAuthenticated = (v: WorldView) => v.authenticated;
export const selectNotice = (v: WorldView) => v.notice;
export const selectFatal = (v: WorldView) => v.fatal;
