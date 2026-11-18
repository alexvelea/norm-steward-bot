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

### Interpreting review status

Check the timer, latest service journal and pause file together. `state.json` retains the latest
substantive run: early returns for `paused`, `backoff` or `overlap-skipped` do not update it. A saved
`timeout` can therefore coexist with a later successful oneshot invocation that skipped work. Exit
status zero means the wrapper handled the invocation, not that a review completed or shipped code.
Some timestamp fields can also remain from earlier runs; compare `startedAt`, the run directory and
the journal rather than treating every field as one coherent latest-run record.

`review.py status` overlays the current pause-file value as `paused`. Its absence now does not
contradict a journal entry that found it present earlier. A backoff is separate from an operator
pause, and an enabled timer does not imply a Codex process is running. Inactive oneshot review and
experiment services are normal between timer activations. Inspect the experiment queue to distinguish
idle work from a failed worker. See the [dated operations snapshot](operations.md) for an example.

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

## Single-version sandbox runs

Run a committed policy immediately on the configured host:

```bash
npm run sandbox -- --ref HEAD --hours 1 --snapshot-ticks 300 --seed 73430
# For uncommitted policy edits in the current dedicated worktree:
npm run sandbox -- --working-tree --hours 1
npm run sandbox -- --ref HEAD --hours 1 --house-bots none
npm run sandbox -- --ref HEAD --hours 1 --house-bots warden=1,reaver=1
```

Sandbox runs default to blitz opponents (2 wardens, 2 reavers, 2 sovereigns). House bots attack
after new-player protection ends at 900 ticks, so results are no longer comparable to earlier
zero-bot runs.

The default ref is HEAD. The runner creates a detached Git worktree for a ref, links the existing
node_modules, runs the real Controller with a sandbox-only transport, then removes that worktree.
--working-tree uses the current directory as-is without creating/removing it; do not edit it during
the run. No gameplay execution preference is changed.

The printed directory under `$STEWARD_REVIEW_DIR/experiments/runs/<id>/` contains run.json
(revision, policy fingerprint, seed, horizon and completion status), worker.log, result.json,
controller.json, snapshots.jsonl, checkpoints.md and sandbox ownership/action/step/delete receipts.
Every 300 ticks (five game-minutes) by default, including tick zero and the endpoint, the worker
visits the exact snapshot boundary and appends/fsyncs every owned city's ID/name, buildings,
home/away units, stationed/abroad support, resources, production, queues and commands.
result.json contains the same checkpoints. --snapshot-ticks changes cadence; --hours supports
600–10800 ticks (up to three game hours). Construction and arrival events still bound decisions.

There is no paired runner, comparison.json, comparison.md, durable queue or experiment timer.
To compare versions, run each independently with the same seed/horizon/cadence and read their
snapshots. A peaceful seed is not survival evidence. Scheduled reviews invoke this same foreground
runner within their bounded time budget; partial runs are retained but cannot authorize activation.
A policy activation requires two completed runs with matching seed, horizon and rules, including
the current candidate fingerprint, successful ordinary actions and a supports-change verdict.
The reviewer—not generated comparison code—interprets the tradeoffs.

The experiment.lock serializes runs across manual commands and review children, independently
of the review.lock already held by a scheduled review. The persisted review pause prevents new
runs; a running measurement may finish. Broker calls use the dedicated sandbox quota constants:
dashboard 100/s with burst 500, calls 500/s with burst 1000, actions 625/s with burst 5000.
These per-account sandbox buckets are separate from live-world quotas.
Backoff prefers `retryAfterMs` over Retry-After; per-action `RATE_LIMITED` results are retried with
the same journaled IDs, using the live executor's ten-second minimum backoff and server hint.
Steps use `wait:true` and return state directly. Incomplete waiting responses fall back to state
polling with quick bounded backoff. Receipts count HTTP attempts and incomplete step waits.
If the round ends before the requested horizon (for example, by dominance), the runner preserves
its terminal state and snapshot, stops writes, and reports an incomplete run rather than inventing
the remaining game time.
Cached in-process ownership verification is invalidated/rechecked on
403/404 or mismatched ownership. One long-lived TypeScript broker handles newline-delimited JSON
requests over stdin/stdout per run; only that child reads credentials. Child environments use an
allowlist of runtime paths and STEWARD directory settings, never keys or NODE_OPTIONS. Shared pacing
state persists across brokers. Pacing locks record their holder PID and acquisition time and recover
automatically when the holder exits or the lock exceeds ten seconds. Locks cover only bucket
read/update; throttle sleeps happen after release. Credentials stay in `$STEWARD_CONTROL_DIR/control.json`
(default /var/lib/norm-steward-bot); review data defaults to /var/lib/norm-steward-review.
The runner requires installed Node dependencies and a configured authorized connection.

When upgrading an installation that had the retired queue, an operator should disable and remove
the old units (this repository does not change running hosts):

```bash
systemctl disable --now norm-steward-experiments.timer
systemctl stop norm-steward-experiments.service
rm /etc/systemd/system/norm-steward-experiments.timer /etc/systemd/system/norm-steward-experiments.service
systemctl daemon-reload
```

Existing queued jobs are not migrated or silently executed. Their old artifacts remain readable.

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

## Work contracts and anti-stall repair (2026-11-15)

The initial schedule produced 17 reviews, six reporting deployments and zero scheduled gameplay
changes. It repeatedly waited for sandbox evidence rather than obtaining it. This is now explicitly
an implementation loop, with one pinned work item in `work.json`: stable ID, acceptance criteria,
required delivery paths, stage, next action, attempts and a consecutive no-progress counter.
Reordering or rephrasing the backlog cannot silently abandon an unfinished task.

Each result includes taskId, outcome, artifacts, experiment verdict, completion claim and a concrete
blocker (or null). The wrapper classifies actual changes and managed experiment receipts instead
of treating a self-reported successful review as gameplay progress. Reporting-only work is credited
at most once per task. An unchanged snapshot/test replay is no progress. After a no-progress result,
a corrective Codex attempt runs immediately within the SAME 15-minute total budget; another deferral
becomes visibly `stalled`, retains its task and resumes on the next tick. No arbitrary code change is
required: a genuinely new, reproducible negative experiment is useful, and incomplete implementation
can remain safely unactivated. Missing input is an instruction to collect/test, not a blocker.

Gameplay tasks are only complete after a verified policy/executor change is deployed and their
required paths are present. UI/reporting changes cannot complete a gameplay task. History labels
`gameplay-shipped`, `ui-shipped`, `instrumentation-published`, `experiment`, or `no-progress`.
Reporting-only commits are checked and pushed but do not restart the gameplay service. The dashboard
shows active work, attempts/stalls, the last gameplay shipment and recent review history.

### Credential-safe experiments

The reviewer is authorized to create its own experiments. It uses `PrivateSandbox` from
`src/review/sandbox-client.ts`, backed by trusted `scripts/sandbox-broker.mts`. The broker reads configured
credentials internally; callers see no key and cannot write to a live or foreign world. Each run
has a durable registry of worlds it created, ownership checks at creation/first use with in-process caching and invalidation, stable action IDs,
HTTP-429 backoff, and an fsynced `sandbox-events.jsonl`. At most eight worlds can be created per run
(the upstream account allows ten non-ended sandboxes). Cleanup runs in the worker's finally and on broker stdin EOF; a credential-free Python recovery
bridge invokes the same TS implementation only if registry entries remain undeleted. No Python
sandbox API implementation remains. Cleanup errors are visible. Expired worlds can be inspected in their registry.

The wrapper supplies the trusted tool checkout and private artifact paths. Use the single-version
runner above for sandbox evidence; no one-off comparison scripts are required. The broker and
reviewer control scripts remain protected against unattended modifications. Testing later edits
requires new run evidence matching the candidate fingerprint.

`python3 scripts/review.py collect --output <run>/evidence --details` fetches up to five retained
battle detail reports as well as snapshots; reading an owner's battle detail marks it read. Normal
reviews request these automatically. Unknown live enemy strength is not a prerequisite for a
controlled sandbox test of basic military infrastructure. The default model uses high reasoning
within the existing ChatGPT login; there is still no additional paid model or credential switching.

### First repaired delivery

The stalled construction guard is now implemented in the Economic Advisor and therefore in fresh
executor revalidation. On an idle queue, it rejects the earliest live-duration completion when it
falls AFTER the round end, accounting for known affordability and Council cooldown. Existing queued
work remains tracked; queued Hall changes are reevaluated on completion rather than projected as an
execution guarantee. Snapshot/network races remain subject to the upstream server's final decision.

Six managed private sandboxes compare the exact old evaluator at 03a2a89 with the candidate at
completion end-1, end, and end+1. The engine confirmed that exact end-tick completion DOES complete,
so equality is allowed. The old evaluator spent 160 resources on an end+1 Cellar which never
completed; the new evaluator spent zero. Both still build successfully at end-1 and end. Results
are in `/var/lib/norm-steward-review/repair-completion-equality/`. The one-off harness was retired;
these are historical receipts, not a command to reproduce with the current runner.

Implementation readiness and publication are separate protocol states. The model returns
`implementationComplete` for code/tests/experiment acceptance; it does not wait for its own commit
or deployment (both belong to the wrapper). Only after successful publication and healthy activation
does the wrapper close that task, also checking its required paths. A partial implementation remains
pinned. A legacy `taskComplete` value is accepted for saved reports. The first repaired unattended
run shipped the Military Advisor, four actual sandbox comparisons and 109 checks; its post-deploy
acceptance was audited during this protocol migration. Subsequent runs use the unambiguous field.
Failed comparison artifacts and rejected/inconclusive verdicts cannot authorize policy activation.
