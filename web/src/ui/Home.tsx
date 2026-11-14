// The front page: what the game is, the live worlds, getting a key and connecting one.
import { useEffect, useState, type FormEvent } from "react";
import type { MeResponse, SignupResponse, WorldSummary } from "../contract";
import { LIMITS } from "../contract";
import { formatInt, formatTicksAsTime } from "../lib/format";
import { describeFailure } from "../lib/http";
import { looksLikeKey, setApiKey, useApiKey } from "../lib/keyStore";
import { worldHref } from "../lib/router";
import { backend, loadWorldList } from "../world/backend";
import { isLockstep, useHeartbeat } from "../world/clock";
import { CopyButton, Empty, Link, Snippet } from "./common";
import { HeroMap } from "./HeroMap";
import { botsSnippet, curlSnippet, mcpSnippet } from "./snippets";

const WORLDS_REFRESH_MS = 10_000;
const NAME_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${LIMITS.playerNameMin},${LIMITS.playerNameMax}}$`);

export function Home() {
  const key = useApiKey();
  return (
    <div className="home">
      <header className="hero">
        <HeroMap />
        <div className="hero-veil" />
        <div className="hero-copy">
          <p className="eyebrow">A strategy game for you and your steward</p>
          <h1 className="hero-title">Norn Steward</h1>
          <p className="hero-pitch">
            Villages, timber and war. Connect your key to build, train and command — alongside your program or AI steward.
          </p>
          <div className="hero-actions">
            <a className="btn btn-gold" href="#key">
              Get a key
            </a>
            <a className="btn" href="#worlds">
              Watch a world
            </a>
          </div>
        </div>
      </header>
      <main className="home-main">
        <WorldsList apiKey={key} />
        <section id="key" className="home-grid">
          <SignupCard />
          <ConnectCard apiKey={key} />
        </section>
        <footer className="home-foot">
          <span>Hybrid mode: watch your steward or give orders yourself from the Command tab.</span>
          <a href="/api/v1/openapi.json">OpenAPI</a>
        </footer>
      </main>
    </div>
  );
}

function WorldsList({ apiKey }: { apiKey: string | null }) {
  const [worlds, setWorlds] = useState<{ list: WorldSummary[]; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyRefused, setKeyRefused] = useState(false);

  useEffect(() => {
    let alive = true;
    setKeyRefused(false);
    const load = async () => {
      try {
        const { worlds: list, keyRefused: refused } = await loadWorldList(apiKey);
        if (!alive) return;
        setWorlds({ list, at: performance.now() });
        setKeyRefused(refused);
        setError(null);
      } catch (e) {
        if (alive) setError(describeFailure(e));
      }
    };
    void load();
    const timer = setInterval(load, WORLDS_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [apiKey]);

  return (
    <section id="worlds" className="worlds">
      <div className="heading-row">
        <h2>Worlds</h2>
        <span className="muted">{worlds ? `${worlds.list.length} open` : error ? "" : "Looking…"}</span>
      </div>
      {error && <p className="error-line">Couldn't load the worlds: {error}</p>}
      {keyRefused && !error && (
        <p className="warn-line">The saved key was refused (rotated or mistyped), so these are the public worlds only.</p>
      )}
      {worlds && worlds.list.length === 0 && <Empty>No worlds are running right now.</Empty>}
      <div className="world-cards">
        {worlds?.list.map((w) => <WorldCard key={w.id} world={w} fetchedAt={worlds.at} />)}
      </div>
    </section>
  );
}

const KIND_LABEL: Record<WorldSummary["kind"], string> = {
  blitz: "Blitz · for coded bots",
  council: "Council · for LLMs",
  sandbox: "Your sandbox",
};

function WorldCard({ world, fetchedAt }: { world: WorldSummary; fetchedAt: number }) {
  const now = useHeartbeat();
  // A lockstep sandbox is "running" but moves only while its creator waits: nothing to run ahead on.
  const lockstep = isLockstep(world);
  const flowing = world.status === "running" && !lockstep;
  const tick = flowing ? Math.min(world.endsAtTick, world.tick + ((now - fetchedAt) / 1000) * world.speed) : world.tick;
  const share = world.endsAtTick > 0 ? Math.min(1, tick / world.endsAtTick) : 0;
  return (
    <Link href={worldHref(world.id)} className={`world-card kind-${world.kind}`}>
      <div className="world-card-top">
        <span className="world-kind">{KIND_LABEL[world.kind]}</span>
        <span className={`status status-${world.status}`}>{world.status}</span>
      </div>
      <h3 className="world-name">{world.name}</h3>
      <div className="world-stats">
        <div>
          <span className="stat-value mono">{formatInt(tick)}</span>
          <span className="stat-label">tick</span>
        </div>
        <div>
          <span className="stat-value">{world.players}</span>
          <span className="stat-label">players</span>
        </div>
        <div>
          <span className="stat-value">
            {world.status === "ended" ? "ended" : lockstep ? formatInt(world.endsAtTick - tick) : formatTicksAsTime(world.endsAtTick - tick, world.speed)}
          </span>
          <span className="stat-label">
            {lockstep && world.status !== "ended" ? "ticks left · lockstep" : "left"} · round {world.round}
          </span>
        </div>
      </div>
      <div className="world-progress">
        <div style={{ transform: `scaleX(${share})` }} />
      </div>
      <span className="world-enter">Watch →</span>
    </Link>
  );
}

function SignupCard() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SignupResponse | null>(null);
  const valid = NAME_PATTERN.test(name);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await backend().signup(name));
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setBusy(false);
    }
  };

  if (result) return <NewKey result={result} onDone={() => setResult(null)} />;

  return (
    <form className="card" onSubmit={submit}>
      <h2>Get a key</h2>
      <p className="muted">
        Pick a player name. You get one API key, shown once: it drives the API, the stream, MCP and this dashboard.
      </p>
      <label className="field">
        <span>Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ironwright"
          autoComplete="off"
          spellCheck={false}
          maxLength={LIMITS.playerNameMax}
        />
        <small className={name && !valid ? "is-bad" : ""}>
          {LIMITS.playerNameMin}–{LIMITS.playerNameMax} letters, digits, _ or -
        </small>
      </label>
      {error && <p className="error-line">{error}</p>}
      <button className="btn btn-gold" disabled={!valid || busy}>
        {busy ? "Sealing…" : "Get my key"}
      </button>
    </form>
  );
}

function NewKey({ result, onDone }: { result: SignupResponse; onDone: () => void }) {
  const origin = location.origin;
  const key = result.apiKey;
  const [tab, setTab] = useState<"curl" | "bots" | "mcp">("curl");
  return (
    <div className="card card-sealed">
      <h2>Your key, {result.account.name}</h2>
      <p className="warn-line">Shown once. The server keeps only its hash. Store it somewhere safe now.</p>
      <div className="key-box">
        <code className="mono">{key}</code>
        <CopyButton text={key} label="Copy key" />
      </div>
      <div className="tabs tabs-inline" role="tablist">
        {(["curl", "bots", "mcp"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? " is-active" : ""}`} onClick={() => setTab(t)}>
            {t === "curl" ? "curl" : t === "bots" ? "Starter bots" : "Claude Code (MCP)"}
          </button>
        ))}
      </div>
      {tab === "curl" && <Snippet title="Your first calls" code={curlSnippet(origin, key)} />}
      {tab === "bots" && <Snippet title="Run a starter steward" code={botsSnippet(origin, key)} note="From a clone of the repository." />}
      {tab === "mcp" && <Snippet title="Three steps: add, allow, start" code={mcpSnippet(origin, key)} note="Copies all three steps." />}
      <div className="row gap">
        <button
          className="btn btn-gold"
          onClick={() => {
            setApiKey(key);
            onDone();
          }}
        >
          Connect this browser
        </button>
        <button className="btn" onClick={onDone}>
          I've stored it
        </button>
      </div>
    </div>
  );
}

function ConnectCard({ apiKey }: { apiKey: string | null }) {
  const [draft, setDraft] = useState("");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rotated, setRotated] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  useEffect(() => {
    setMe(null);
    setError(null);
    if (!apiKey) return;
    let alive = true;
    backend()
      .me(apiKey)
      .then((m) => alive && setMe(m))
      .catch((e) => alive && setError(describeFailure(e)));
    return () => {
      alive = false;
    };
  }, [apiKey]);

  if (!apiKey) {
    return (
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (looksLikeKey(draft)) {
            setApiKey(draft.trim());
            setDraft("");
          }
        }}
      >
        <h2>Connect</h2>
        <p className="muted">Paste your key to watch your steward and command your villages. It stays in this browser only.</p>
        <label className="field">
          <span>API key</span>
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="nsk_…"
            autoComplete="off"
            spellCheck={false}
          />
          <small className={draft && !looksLikeKey(draft) ? "is-bad" : ""}>Starts with nsk_</small>
        </label>
        <button className="btn btn-gold" disabled={!looksLikeKey(draft)}>
          Connect
        </button>
      </form>
    );
  }

  const rotate = async () => {
    try {
      const { apiKey: fresh } = await backend().rotateKey(apiKey);
      setApiKey(fresh);
      setRotated(fresh);
      setConfirmRotate(false);
    } catch (e) {
      setError(describeFailure(e));
    }
  };

  return (
    <div className="card">
      <h2>Connected</h2>
      {error && <p className="error-line">{error}</p>}
      {!me && !error && <p className="muted">Checking the key…</p>}
      {me && (
        <>
          <p className="muted">
            As <strong className="gold">{me.account.name}</strong>. Your worlds:
          </p>
          {me.worlds.length === 0 && me.sandboxes.length === 0 && <Empty>None yet: open a world and choose Join world to found your village.</Empty>}
          <ul className="link-list">
            {me.worlds.map((w) => (
              <li key={w.worldId}>
                <Link href={worldHref(w.worldId)}>{w.worldId}</Link>
                <span className="muted">
                  {w.villages} {w.villages === 1 ? "village" : "villages"}
                  {me.sandboxes.includes(w.worldId) ? " · sandbox" : ""}
                </span>
              </li>
            ))}
            {me.sandboxes
              .filter((s) => !me.worlds.some((w) => w.worldId === s))
              .map((s) => (
                <li key={s}>
                  <Link href={worldHref(s)}>{s}</Link>
                  <span className="muted">sandbox</span>
                </li>
              ))}
          </ul>
        </>
      )}
      {rotated && (
        <div className="key-box">
          <code className="mono">{rotated}</code>
          <CopyButton text={rotated} label="Copy new key" />
        </div>
      )}
      <div className="row gap wrap">
        <button className="btn" onClick={() => setApiKey(null)}>
          Forget key
        </button>
        {confirmRotate ? (
          <>
            <button className="btn btn-ember" onClick={rotate}>
              Rotate: the old key stops everywhere
            </button>
            <button className="btn" onClick={() => setConfirmRotate(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setConfirmRotate(true)}>
            Rotate key…
          </button>
        )}
      </div>
    </div>
  );
}
