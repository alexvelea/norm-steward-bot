// The side panel (a bottom sheet at phone width). Its tabs follow docs/dashboard.md; a spectator, who
// has no steward here, sees only the standings.
import { useEffect, useRef, useState } from "react";
import { homeHref } from "../../lib/router";
import { Link } from "../common";
import { selectAuthenticated, selectPlayerId, selectState, useWorld, useWorldContext } from "../worldContext";
import { CommandTab } from "./Command";
import { useApiKey } from "../../lib/keyStore";
import { describeFailure } from "../../lib/http";
import { ArmyTab } from "./Army";
import { ChronicleTab } from "./Chronicle";
import { HoldingTab } from "./Holding";
import { ReportsTab } from "./Reports";
import { StandingsTab } from "./Standings";
import { StewardTab } from "./Steward";

import type { TabId } from "./navigation";

export function Panel({ tab, choose, open, setOpen }: { tab: TabId; choose(tab: TabId): void; open: boolean; setOpen(open: boolean): void }) {
  const state = useWorld(selectState);
  const playerId = useWorld(selectPlayerId);
  const { selectedId } = useWorldContext();
  const [villageId, setVillageId] = useState<string | null>(null);

  const ownIds = state?.villages.map((v) => v.id) ?? [];
  const activeVillage = villageId && ownIds.includes(villageId) ? villageId : (ownIds[0] ?? null);

  // Clicking one of your villages on the map opens it here.
  // Only a new selection does this; state updates arrive twice a second and must not yank the tab.
  const ownRef = useRef(ownIds);
  ownRef.current = ownIds;
  useEffect(() => {
    if (!selectedId || !ownRef.current.includes(selectedId)) return;
    setVillageId(selectedId);
    if (tab !== "holding" && tab !== "army" && tab !== "orders") choose("holding");
    setOpen(true);
  }, [selectedId]);

  const steward = !!state && !!playerId;
  const shown = steward ? tab : "standings";

  return (
    <aside className={`panel${open ? " is-open" : ""}`}>
      <button className="panel-handle" onClick={() => setOpen(!open)} aria-label={open ? "Hide the panel" : "Show the panel"}>
        <span />
      </button>
      <button className="panel-toggle btn btn-small" aria-label={open ? "Hide panel" : "Show panel"} onClick={() => setOpen(!open)}>{open ? "›" : "‹"}</button>
      {open && (
        <div className="panel-body" role="tabpanel">
          {!steward && <SpectatorNote />}
          {shown === "orders" && activeVillage && <CommandTab key={clientKey(state)} villageId={activeVillage} onVillage={setVillageId} />}
          {shown === "holding" && activeVillage && <HoldingTab villageId={activeVillage} onVillage={setVillageId} />}
          {shown === "army" && activeVillage && <ArmyTab villageId={activeVillage} onVillage={setVillageId} />}
          {shown === "steward" && <StewardTab />}
          {shown === "reports" && <ReportsTab />}
          {shown === "chronicle" && <ChronicleTab />}
          {shown === "standings" && <StandingsTab />}
        </div>
      )}
    </aside>
  );
}

function clientKey(state: ReturnType<typeof selectState>) {
  return state?.world.epoch ?? "";
}

function SpectatorNote() {
  const { client } = useWorldContext();
  const key = useApiKey();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const authenticated = useWorld(selectAuthenticated);
  return (
    <div className="spectator">
      {authenticated ? (
        <div>
          <p>Your key hasn't joined this world yet. Found a village to start playing.</p>
          <button
            className="btn btn-gold"
            disabled={busy || !key}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await client.join();
              } catch (e) {
                setError(describeFailure(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Joining…" : "Join world"}
          </button>
          {error && (
            <p className="error-line" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <p>
          Watching as a spectator: the public map, the standings and every conquest. <Link href={homeHref()}>Connect a key</Link> to see
          your own steward at work.
        </p>
      )}
    </div>
  );
}
