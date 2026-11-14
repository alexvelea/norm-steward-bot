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

type TabId = "command" | "holding" | "army" | "steward" | "reports" | "chronicle" | "standings";

const TABS: { id: TabId; label: string }[] = [
  { id: "command", label: "Command" },
  { id: "holding", label: "Holding" },
  { id: "army", label: "Army" },
  { id: "steward", label: "Steward" },
  { id: "reports", label: "Reports" },
  { id: "chronicle", label: "Chronicle" },
  { id: "standings", label: "Standings" },
];

const TAB_STORAGE = "norn-steward.panelTab";

/** A tab can be linked to with #tab (e.g. /w/blitz-1#steward); otherwise the last one used. */
function rememberedTab(): TabId {
  const linked = location.hash.slice(1);
  if (TABS.some((t) => t.id === linked)) return linked as TabId;
  try {
    const saved = localStorage.getItem(TAB_STORAGE);
    if (saved && TABS.some((t) => t.id === saved)) return saved as TabId;
  } catch {
    // Storage is a convenience only.
  }
  return "holding";
}

function rememberTab(tab: TabId): void {
  try {
    localStorage.setItem(TAB_STORAGE, tab);
  } catch {
    // Storage is a convenience only.
  }
}

export function Panel() {
  const state = useWorld(selectState);
  const playerId = useWorld(selectPlayerId);
  const { selectedId, setTownOpen } = useWorldContext();
  const [tab, setTab] = useState<TabId>(rememberedTab);
  const [open, setOpen] = useState(true);
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
    setTab((t) => (t === "holding" || t === "army" || t === "command" ? t : "holding"));
    setOpen(true);
  }, [selectedId]);

  const choose = (t: TabId) => {
    setTab(t);
    rememberTab(t);
    setOpen(true);
  };

  const steward = !!state && !!playerId;
  const shown = steward ? tab : "standings";
  const incoming = state?.commands.incoming.filter((c) => c.kind === "attack").length ?? 0;

  return (
    <aside className={`panel${open ? " is-open" : ""}`}>
      <button className="panel-handle" onClick={() => setOpen(!open)} aria-label={open ? "Hide the panel" : "Show the panel"}>
        <span />
      </button>
      <nav className="tabs" role="tablist">
        {steward && <button className="tab gold" aria-haspopup="dialog" onClick={() => setTownOpen(true)}>Town</button>}
        {(steward ? TABS : TABS.filter((t) => t.id === "standings")).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={shown === t.id}
            className={`tab${shown === t.id ? " is-active" : ""}`}
            onClick={() => choose(t.id)}
          >
            {t.label}
            {t.id === "reports" && (state?.unreadReports ?? 0) > 0 && <span className="badge">{state!.unreadReports}</span>}
            {t.id === "army" && incoming > 0 && <span className="badge badge-ember">{incoming}</span>}
          </button>
        ))}
        <button className="tab tab-collapse" onClick={() => setOpen(!open)} aria-label={open ? "Hide the panel" : "Show the panel"}>
          {open ? "›" : "‹"}
        </button>
      </nav>
      {open && (
        <div className="panel-body" role="tabpanel">
          {!steward && <SpectatorNote />}
          {shown === "command" && activeVillage && <CommandTab key={clientKey(state)} villageId={activeVillage} onVillage={setVillageId} />}
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
