# Norm Steward Bot

Personal hybrid UI and autonomous bots for the existing Norn Steward game at
https://norn-steward.velea.cc. Imported from Alex's machine, preserving the manual Command tab,
illustrated Town view, building details, and other dashboard changes.

This repository is a client setup. The central game server runs the simulation, validates actions,
maintains accounts and worlds, and saves progress. There is no game engine or game server here.
The local Node process serves the personal UI, coordinates advisors and proxies API/WebSocket/MCP traffic to the game.

For the complete machine setup, see [setup](docs/setup.md). For an external engineering review,
start with [the architect handoff](docs/ARCHITECT_REVIEW.md) and [architecture/state map](docs/architecture.md).
For the verified host inventory and status checks, see [operations](docs/operations.md).
Review instructions are versioned in [the agent prompt](scripts/review/prompt.md).

## Personal control center

The root page is your Economic Advisor dashboard, not a public landing/signup page. Settings holds
server origin, masked player key and selected world. Map, Town, manual commands and game activity
are preserved under **Map & commands**. Read [the policy and execution design](docs/control-center.md)
for the scoring scale, save-versus-spend policy, safety checks and local control API.

### Start locally

Requires Node.js 20+ and npm. Initialize the owner key locally (never commit it):

```bash
npm ci
export STEWARD_KEY_FILE=/absolute/path/to/your/private-key.txt
export STEWARD_URL=https://norn-steward.velea.cc
export STEWARD_WORLD=blitz-1
npm run access:init
npm run dev
```

Open http://127.0.0.1:8788 and first enter the separate site access token (no username).
`access:init` saves it in private `data/control/access-token.txt` by default; read it locally into
your password manager. Then unlock the application with the player key. A browser that already stores that key
connects automatically. `npm run dev` builds/watches UI files and starts the single control process;
refresh the browser after a rebuild. For built files use `npm run build:web` then `npm start`.
`HOST` defaults to loopback and `PORT` to 8788. A second process is refused by a loopback executor
lease on port 8790, even if it chooses another UI port. No game engine runs here.

The Economic Advisor runs automatically when a valid connection is configured, including after
restarts while preserving a persisted operator pause. It automatically joins the selected world when a new round starts, and refounds if all
villages are lost. It never switches to unrelated world IDs. The persistent service owns execution; browsers only display its state. Existing server
standing build orders make this advisor wait in that village. Do not run another client on the same account alongside this executor.

`STEWARD_CONTROL_DIR` defaults to ignored `data/control`. The service stores the game key and its
request/decision journal in mode-0600 `control.json`; keep machine access private. Environment values
bootstrap a fresh configuration, not overwrite saved Settings. `.env` is not automatically loaded.
Session cookies protect private settings and the game proxy; the reveal button is explicit.
Synthetic `/?mock=1` remains separate and cannot enable advisors or mix mock data with live state.

### Persistent hosting on Alex's machine

The production process is a systemd service behind Caddy. The included unit assumes this checkout
at `/root/norm-steward-bot` and the existing private credential source `/root/key.txt`:

```bash
npm ci
npm run build:web
# First install only: bootstrap the release path; subsequent reviews switch immutable releases.
sudo mkdir -p /var/lib/norm-steward-deploy
sudo ln -s /root/norm-steward-bot /var/lib/norm-steward-deploy/current
sudo install -m 0644 deploy/norm-steward-control.service /etc/systemd/system/
sudo systemctl daemon-reload
# First install only; skip token initialization on later updates.
sudo env STEWARD_CONTROL_DIR=/var/lib/norm-steward-bot npm run access:init
sudo systemctl enable --now norm-steward-control
sudo install -m 0644 web/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy supplies HTTPS at https://alex.norn-steward.velea.cc and forwards to the loopback control
process. The Node service serves the active immutable release's `web/dist`; copying files to the old
static directory is no longer the deployment path. Pulling or rebuilding the source checkout does not
update that release, and restarting alone runs the same release again. After checks and the UI build
pass for the intended commit, follow the [update procedure](docs/setup.md#5-operations-and-recovery)
to activate it. A restart preserves the saved execution preference and reconciles tracked operations.
Use `systemctl status norm-steward-control` and `journalctl -u norm-steward-control` to inspect it.
Adapt paths and hostname for another machine; merge Caddy blocks if it hosts other sites.

## Scheduled reviews

Codex reviews strategy about every 30 minutes through a bounded systemd service, separately from
continuous deterministic gameplay. See [review status, pause, logs and recovery](docs/reviews.md).

## Operator handoff

Give another agent [docs/OPERATOR.md](docs/OPERATOR.md) for explicitly requested scouting, support
recalls and troop movement. It includes a copyable task prompt and must not start another economic
loop. The advisor and President themselves are deterministic scripts, with **no LLM calls**.

## Repository layout

| Path | Purpose |
|---|---|
| web/ | Imported dashboard, mock demo, build script, UI tests, Caddy hosting config |
| src/shared/api.ts | Public API type snapshot used by the UI |
| src/rules/ | Rule constants and derived tables needed by UI and tests; no engine |
| scripts/serve.mjs | Personal UI hosting, authenticated control API and transport proxy |
| src/advisors/ | Shared proposal interface, Economic Advisor and President |
| src/control/ | Persistent client executor, private configuration and execution journal |
| docs/ | Dashboard documentation and upstream API/game references |

The original engine, house bots, backend, persistence, MCP implementation, and server-only tests
were intentionally omitted. Those services remain on the central game machine. This repository
now owns the personal control service and UI deployed on Alex's machine.

## Checks

```bash
npm run typecheck
npm test
npm run build:web
```

Rules in this repository are a client snapshot. Update src/shared/ and src/rules/ together when
upstream contracts change, and check the live server's rules/options before making strategy assumptions.

## Private token-only site access

The entire site is gated before static files, control routes, API/MCP traffic and WebSocket upgrades.
Only `/access/login` is public. Paste the separate access token; no username is required. The game
API key remains the second layer, and existing browsers can reuse their saved game key.

Production access token: `/var/lib/norm-steward-bot/access-token.txt` (mode 0600). The service reads
only its SHA-256 digest from `access-token.sha256`. Both live in a mode-0700 private directory and
must never be committed. The generated token has 256 random bits; it is not a user-chosen password.
Access sessions are opaque, HttpOnly, SameSite=Strict, Secure over HTTPS, and expire after seven days
or service restart. The Lock button logs out both layers. Token values are submitted in a POST body,
never in a URL. Wrong tokens are throttled; existing authenticated streams stop forwarding after
access revocation or expiry. The service refuses to start without an initialized digest.

Rotate from this checkout, then restart to invalidate every existing access session:

```bash
sudo env STEWARD_CONTROL_DIR=/var/lib/norm-steward-bot npm run access:init -- --rotate
sudo systemctl restart norm-steward-control
```

Do not rerun initialization as a routine deployment step when a token already exists. Restarting
preserves the saved gameplay execution preference. For non-default directories, set
STEWARD_CONTROL_DIR and optionally STEWARD_ACCESS_TOKEN_HASH_FILE consistently for init and service.
