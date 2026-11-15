# Norm Steward Bot

This is a personal client repository: a hybrid dashboard and autonomous API bots for a remote Norn Steward game.

- Read README.md and docs/README.md first. Advisor policy and execution are in docs/control-center.md; ad hoc game commands follow docs/OPERATOR.md. UI behaviour is described in docs/dashboard.md.
- Keep src/rules/ and src/shared/ as compatible snapshots of the upstream public contract. Do not change game balance here; the remote server is authoritative.
- Do not add a game engine, account store, world clock, game server, or server-side MCP implementation.
- Browser reads use the dashboard header; gameplay writes must use normal authenticated API limits and report per-action failures.
- Preserve player visibility. Mock mode is synthetic and must not be mixed with live state.
- Never commit credentials, API keys, .env files, game saves, or installed dependencies.
- Keep private bot strategy changes in this repository. Shared game rules belong upstream.
- Do not add CI triggered by push, pull request, or schedule.
- Verify with npm run typecheck, npm test, and npm run build:web. For UI changes, also run and visually inspect the dashboard.

The persistent control service owns the only advisor executor. Run the configured economic policy on startup while respecting its persisted pause, journal action IDs before writes, and never add browser execution loops. Local private connection settings are client configuration, not a game account store.

Scheduled reviews use docs/reviews.md and docs/strategy.md. Preserve the persisted gameplay execution setting during reviews, Settings changes and deployment; never silently resume an operator pause. The review timer and its pause switch are independent of gameplay. Compare strategy changes in owner-created private sandboxes before automatic activation. Keep review logs and credentials outside Git.

Scheduled work is pinned in work.json. The reviewer owns obtaining missing evidence: use the managed PrivateSandbox helper without reading credentials. Repeated offline reports or unchanged checks do not complete gameplay tasks. Follow docs/reviews.md work-contract and experiment receipt requirements; keep the President as the only allocator.
