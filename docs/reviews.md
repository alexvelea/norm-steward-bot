# Scheduled strategic reviewer

Installed services: `norm-steward-review.timer` starts `norm-steward-review.service` around UTC :00
and :30 (up to 30 seconds scheduling jitter). Persistent timers catch a missed activation after
boot. Gameplay remains in the single `norm-steward-control.service`, independent of Codex and quota.

The installed CLI is Codex 0.169.0. We inspected `codex exec --help`, `codex login status`, generated
its local app-server protocol, read `account/rateLimits/read`, and completed a noninteractive auth
probe using the existing ChatGPT login. No API key, account switch, additional paid model or purchased
quota is involved. Exec uses its installed default model with `--ignore-user-config` (avoids unrelated
MCP/hooks), JSON events and an output schema. It never types into tmux. Auth still uses the existing
Codex home. A changed CLI/auth provider must be checked before resuming.

## Run, pause and status

```bash
python3 /root/norm-steward-bot/scripts/review.py status
python3 /root/norm-steward-bot/scripts/review.py pause
python3 /root/norm-steward-bot/scripts/review.py resume
systemctl start norm-steward-review.service   # request a review now; respects pause/backoff
systemctl list-timers norm-steward-review.timer
journalctl -u norm-steward-review.service
python3 /root/norm-steward-bot/scripts/review.py usage
python3 /root/norm-steward-bot/scripts/review.py probe  # bounded auth-only probe; respects backoff
```

The authenticated dashboard has Strategic reviews and a separate Pause/Resume reviews control.
A pause is an atomic separate file; a running agent is terminated and activation is suppressed.
This does not pause gameplay. To stop scheduling entirely, `systemctl disable --now
norm-steward-review.timer`; stop the review service too if needed. Do not stop the gameplay service
unless intending to stop ordinary bot actions. Gameplay's automatic preference is now durable;
service restarts and Settings edits preserve an operator pause.

## Bounds and continuity

Private mode-0700 state directory `/var/lib/norm-steward-review` contains:

- `state.json`: latest review, usage, activation/error/backoff and run status.
- `backlog.json`: ordered ongoing work with effort estimates (not recoverable tokens).
- `paused`: review-only switch. `installed.json` records timer installation.
- `review.lock`: kernel flock; two reviews cannot overlap, even when started manually.
- `worktree/`: dedicated `review/continuous` Git worktree. Dirty and unpushed work survives interruption.
- `runs/<UTC>/`: evidence, actual quota snapshot, redacted JSONL, stderr, final report and check logs.
- `first/`: first-review evidence and sandbox experiment outputs.

Codex gets at most 15 minutes; instructions reserve time and scope to one improvement. Systemd
bounds the whole service to 25 minutes, kills its process group, and limits CPU/memory. Progress
stays on disk if timed out. The next run reads previous report, backlog, actual usage and gameplay
evidence before continuing. A 30-minute timer does not imply a 30-minute quota refill.

Quota data comes from the installed CLI's authenticated app-server. Preserve window durations,
percentages, explicit ordinary-usage permission and reset timestamps as reported. No remaining-token
count is invented. Explicit exhaustion pauses runs until the reported reset plus one minute, or a
conservative hour when no reset is available, then **rechecks**; reset is not proof of recovery.
Transport/model failures use exponential 30-minute to six-hour backoff. Authentication failure
pauses for an hour; fix the existing login interactively with `codex login`, then run a probe.
Never create credentials/accounts or buy capacity to evade a limit. Unknown usage remains unknown.
Per-run token usage from JSONL is recorded only when the CLI reports it.

No-change reviews are valid. Incomplete code is retained without activation. Larger projects can
span reviews. The wrapper rejects auto-deployment changes to scheduler, deployment, rules/contracts,
AGENTS.md and dependency manifests; these need an owner-driven maintenance review.

## Verified deployment and recovery

The wrapper checks the live source is clean, scans candidate files/diffs for configured secrets,
runs typecheck/tests/web build, commits verified changes, and pushes `HEAD:master` without force.
It fast-forwards the main checkout and creates an immutable release from that Git commit plus the
checked UI assets. Releases share only the existing dependency installation; automatic dependency
changes are prohibited. `/var/lib/norm-steward-deploy/current` points to the running release.
The service keeps the same private settings, journal, port and kernel executor lease.

Activation stops the one executor, atomically switches the release, restarts and checks game
connection and execution preference. A failed health check switches back and restarts the prior
release. `/var/lib/norm-steward-deploy/deployment.json` records the result. No failed tests are
activated. A failed push leaves the local commit and worktree intact with an error/backoff; fix
SSH/remote and retry, never force-push. A source commit may be newer than the active release after
rollback; inspect deployment.json rather than assuming HEAD is live.

To roll back manually, pause reviews, stop norm-steward-control, atomically point `current` at the
`previous` path in deployment.json, then start the gameplay service and check the dashboard. Do not
copy old control.json over current gameplay state: it contains durable request IDs and live queues.
If a worktree needs repair, preserve its diff and local commits first. The runner never hard-resets
progress. Resolve divergent Git branches manually, verify, then resume. Runtime secrets and captures
remain outside Git. Logs are private and known player/site tokens are redacted before retention.

## Install on this machine

Create the state directory mode 0700. Build/check/commit first. Bootstrap `current` to the verified
checkout before installing the service unit, then use `review.py deploy --commit <verified HEAD>`
to create the first release. Install the two review units and the gameplay unit from deploy/,
`systemctl daemon-reload`, verify with `systemd-analyze verify`, then enable/start the review timer.
Use `systemd-run --wait --pipe --collect -p WorkingDirectory=/var/lib/norm-steward-review
/usr/bin/python3 /root/norm-steward-bot/scripts/review.py probe` to check the real noninteractive
service environment. No enabled review timer requires an open browser or terminal.
