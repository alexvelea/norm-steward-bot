# Norm Steward Bot

Personal hybrid UI and autonomous bots for the existing Norn Steward game at
https://norn-steward.velea.cc. Imported from Alex's machine, preserving the manual Command tab,
illustrated Town view, building details, and other dashboard changes.

This repository is a client setup. The central game server runs the simulation, validates actions,
maintains accounts and worlds, and saves progress. There is no game engine or game server here.
The small local Node process serves UI files and proxies API/WebSocket/MCP traffic to the game.

## Local setup

Requires Node.js 20 or newer and npm. Python 3.10+ is optional for the Python bot.

```bash
npm ci
npm run dev
```

Open http://127.0.0.1:8788. The UI builds and watches for changes; refresh after a rebuild.
By default it connects to https://norn-steward.velea.cc. To use another game server:

```bash
STEWARD_URL=https://your-game.example npm run dev
```

`STEWARD_URL` must be an origin without an API path. `PORT` defaults to 8788 and `HOST` to
127.0.0.1. Environment files are not automatically loaded: export variables in your shell.
You can inspect the synthetic offline demo at http://127.0.0.1:8788/?mock=1.
Mock games do not affect your live account.

In the live UI, use **Connect** with your existing player key or register a new account.
Open a world and join it if needed. **Command** submits manual actions; **Town** opens the
illustrated village and building details. Bots and manual commands share the same resources and
queues. There is no arbitration that reserves resources for one or the other.
Player keys are stored by the browser and forwarded to the selected game server; they are not
embedded in the build. Never commit them. Changing UI hostname uses a separate browser storage area.

## Run your bot

Use the same game account/key as the dashboard if you want to control the same villages.
In a second terminal, choose the TypeScript or Python starter:

```bash
export STEWARD_URL=https://norn-steward.velea.cc
read -r -s STEWARD_KEY
export STEWARD_KEY
export STEWARD_WORLD=your-world-id
npm run bot
# Or: python3 bots/python/starter.py
```

The read command prompts silently for your key in bash/zsh. Paste it and press Enter.
For a new account and a private sandbox, instead of supplying a key:

```bash
STEWARD_URL=https://norn-steward.velea.cc STEWARD_NAME=your_unique_name STEWARD_SANDBOX=1 npm run bot
```

The starter prints the new key once; save it privately. The bots read live rules/options and
play on their own. Their fallback URL is localhost:8787, so always set STEWARD_URL for the live game.
See [bots/README.md](bots/README.md) for strategy and environment options. The optional LLM shift
runner is preserved and targets Claude Code; it is not a Codex runner.

On a remote machine, use separate tmux windows for UI development and the bot. For an already
created session: `tmux attach -t codex`. Detach with Ctrl+B, then D. tmux survives SSH disconnects,
but not reboots; use a service manager if you need the bot to restart after reboot.

## Static hosting on Alex's machine

The existing [web/Caddyfile](web/Caddyfile) serves alex.norn-steward.velea.cc and proxies API,
WebSocket, and MCP requests to norn-steward.velea.cc. Caddy handles HTTPS. Node is needed to build,
not to serve this production setup. Caddy must already be installed; DNS and ports 80/443 must be ready.
After copying this repo onto that machine, run there:

```bash
npm ci
npm run build:web
sudo mkdir -p /srv/norn-steward-ui
sudo rsync -a web/dist/ /srv/norn-steward-ui/
sudo install -m 0644 web/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

This Caddyfile is for a dedicated UI machine. If Caddy already hosts other sites, merge this site
block instead of replacing its configuration. Adjust the hostname, upstream, and Host header if
hosting elsewhere. On later updates, rebuild and copy web/dist/ again. No game saves are needed.

For a built local preview, use `npm run build:web` then `npm start`; it uses the same local proxy
as development, without watching. This does not deploy or start a bot automatically.

## Repository layout

| Path | Purpose |
|---|---|
| web/ | Imported dashboard, mock demo, build script, UI tests, Caddy hosting config |
| bots/ | Standalone TypeScript/Python starters and optional Claude shift runner |
| src/shared/api.ts | Public API type snapshot used by the UI |
| src/rules/ | Rule constants and derived tables needed by UI and tests; no engine |
| scripts/serve.mjs | Local static hosting and API/WebSocket/MCP proxy |
| docs/ | Dashboard documentation and upstream API/game references |

The original engine, house bots, backend, persistence, MCP implementation, and server-only tests
were intentionally omitted. Their services remain on the central game machine. The source on Alex's
machine was only read; this import does not redeploy or modify the running UI.

## Checks

```bash
npm run typecheck
npm test
npm run build:web
```

Rules in this repository are a client snapshot. Update src/shared/ and src/rules/ together when
upstream contracts change, and check the live server's rules/options before making strategy assumptions.
