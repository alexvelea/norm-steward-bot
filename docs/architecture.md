# Architecture and state boundaries

This repository contains a personal client. The central engine, world clock, accounts and other
players live on the remote server and are outside this repository. Start with [setup](setup.md),
[control-center policy](control-center.md), and [review operation](reviews.md).

```mermaid
flowchart TD
  Browser[Owner browser] --> Caddy[Caddy: HTTPS and origin]
  Caddy --> Control[Persistent control service: UI, access, API proxy]
  Control --> Advisors[Deterministic advisors]
  Advisors --> President[President: shared allocation]
  President --> Journal[Single executor: journal, refresh, reconcile]
  Journal --> Game[Remote game API]
  Control -->|manual commands and proxied reads| Game
  Timer[30-minute systemd review timer] --> Reviewer[Bounded noninteractive Codex review]
  Reviewer --> Worktree[Dedicated review worktree and pinned task]
  Worktree --> Worker[Immediate single-version sandbox runner]
  Worker --> Sandboxes[Owner-only paused private worlds on remote game server]
  Worktree --> Checks[Evidence gates, tests, commit and push]
  Checks --> Release[Immutable release, health check and rollback]
  Release --> Control
```

Manual commands use the authenticated local proxy and the remote game API. They do not pass
through the President. They consume the same remote resources/queues, so the executor must refresh
and reconcile rather than assume it owns all activity. Browser requests never bypass site access.

## Continuous gameplay

`scripts/serve.mjs` starts the one Controller with a durable FileControlStorage and obtains the
kernel lease at loopback port 8790. Economic/Military Advisor proposals go through the President.
The Controller refreshes live state/options, accounts for independent construction/training/command
lanes, journals stable IDs before writes, and reconciles unknown/accepted outcomes. Browser tabs
render state; they do not own gameplay loops. A server restart reloads existing queues and IDs.
The current cadence is one second. Missing Codex access does not stop this path.

The lease is host-local. Running the starter bot or a second machine with this player's key can
still compete; coordination with external/manual actions is a limitation to evaluate, not a distributed
lock guarantee. The server remains the final validator of resources, limits and prerequisites.

## Bot core and planning

`src/bot/` separates the declarative plan (`plan/graph.ts`, `plan/evaluate.ts`), live and scripted
world adapters, serialized runner, President allocation wrapper, mission/commitment strategy,
execution journal, persistence schema, and planning diagnostics. The Controller remains the HTTP
facade and composes these parts; the generated graph is documented in [plan.md](plan.md).

Automated scouting and raid advisors, dispatchers, and experiment runners were removed. Manual map
commands and the public battle/scouting reports remain separate dashboard capabilities.

## Versioned control state

The private control store uses envelope version 2. Startup migrates the legacy control file while
preserving execution preference and supported active state, writes a private mode-0600 legacy
backup, and continues with the versioned store. An unsupported store version sets
`recoveryRequired` and blocks execution rather than overwriting state. The original private
connection settings and access-token boundaries remain outside Git.

## Strategic review and experimental learning

`scripts/review.py` owns the review lock, actual usage/auth checks, current evidence collection,
15-minute Codex budget, protected-file gates, structured report, checks, publishing and deployment.
Its prompt and report schema are versioned files, not hidden text in a timer or tmux session.
`progress.py` distinguishes research, experiments and deployed gameplay delivery. Stable work IDs
prevent silent task reshuffling; a verified negative comparison can complete a research question.

A sandbox run selects one Git ref in a detached worktree, or explicitly uses uncommitted policy
edits in the dedicated working tree. `scripts/sandbox-runner.mts` runs that policy through the real
Controller with a sandbox-only transport. The server clock is paused between bounded steps;
action follow-ups use one game tick, queue/funding events wake decisions, and idle steps are capped
at 30 ticks. Five-minute snapshots include every owned city's state and are durable as they are taken.

The runner is foreground-only, serialized by experiment.lock, and respects the persisted review
pause. There is no experiment queue or timer. Scheduled reviews must budget their own runtime.
Each run has its own seed, horizon, revision/fingerprint and artifacts; reviewers compare separate
runs by reading snapshots. Fresh peaceful worlds do not measure survival; threat tests need an
appropriately controlled scenario. Interrupted runs preserve partial artifacts but do not count
as completed evidence, and retries start a new run. Temporary ref worktrees are removed afterward.

Policy activation requires matched evidence for the actual candidate fingerprint and current rules
version, plus checks. Then the wrapper commits/pushes, atomically switches the release, restarts the
single executor and checks connection/execution preference. Push failures retain commits; failed
health restores the prior release. Source HEAD and the active release can therefore differ.

## Durable runtime state (private, not Git)

| Location | Purpose and recovery |
|---|---|
| `/var/lib/norm-steward-bot/control.json` | Connection key/settings, execution preference, pending/active action journal, decisions, production and cohort memory. Preserve across deployments. |
| Same directory: `access-token.txt`, `access-token.sha256` | Separate site credential and digest. Initialize once; rotate explicitly. |
| `/root/key.txt` | First-install player-key source used by the unit; saved Settings take precedence later. |
| `/var/lib/norm-steward-review/state.json` | Review status, usage observation/backoff, latest report and deployment metadata. |
| `.../work.json`, `.../backlog.json` | Active work contract and priorities; seeded from the committed example only on a fresh install. |
| `.../paused`, `.../installed.json` | Separate review pause and installation marker. |
| `.../worktree/` | Dedicated Git branch with durable unfinished prototypes. Never reset it to discard progress. |
| `.../runs/<UTC>/` | Redacted agent logs, evidence, sandbox ownership receipts, checks and reports. |
| `.../experiments/runs/<id>/` | Single-run manifest, JSONL snapshots, result, checkpoint tables and receipts; ref worktree removed after execution. |
| `.../review.lock`, `.../experiment.lock` | Kernel flocks; stale files alone do not mean a lock is held. |
| `/var/lib/norm-steward-deploy/current` | Symlink to active immutable release. |
| `.../deployment.json`, `.../releases/<commit>/` | Actual release, prior release and rollback record. Runtime settings are shared, source is immutable. |
| Codex home and `/root/.ssh/` | Existing CLI authentication and Git transport credentials; provision separately, never export to Git. |

Logs and sandbox results can contain private strategy and account/world identifiers even after
credentials are redacted. The repository keeps reproducible harnesses, policy descriptions and
summarized findings, not production dumps. Read setup/health state locally when auditing deployment;
a GitHub-only reviewer should explicitly mark runtime facts it cannot verify.
