# Norm Steward Bot

This is a personal client repository: a hybrid dashboard and autonomous API bots for a remote Norn Steward game.

- Read README.md and docs/README.md first. UI behaviour is described in docs/dashboard.md.
- Keep src/rules/ and src/shared/ as compatible snapshots of the upstream public contract. Do not change game balance here; the remote server is authoritative.
- Do not add a game engine, account store, world clock, game server, or server-side MCP implementation.
- Browser reads use the dashboard header; gameplay writes must use normal authenticated API limits and report per-action failures.
- Preserve player visibility. Mock mode is synthetic and must not be mixed with live state.
- Never commit credentials, API keys, .env files, game saves, or installed dependencies.
- Keep private bot strategy changes in this repository. Shared game rules belong upstream.
- Do not add CI triggered by push, pull request, or schedule.
- Verify with npm run typecheck, npm test, and npm run build:web. For UI changes, also run and visually inspect the dashboard.
