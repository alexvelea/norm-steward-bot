# Sandbox runs

Read this before testing a strategy change. One command runs the real Controller against a
private, owner-created sandbox world and leaves everything needed to judge the result. Do not write
queue scripts, analysis scripts or patched copies of the runner; if something is missing, add it
to `scripts/sandbox/`.

## Commands

```bash
# One committed ref, one game hour, blitz house bots. Prints the run directory and its timeline.
npm run sandbox -- --ref my-branch --hours 1

# Compare: every ref runs on every seed, one after another, ending in one comparison table.
npm run sandbox -- --ref master my-branch --seed 73430 73431 73432 --hours 2

# Uncommitted edits in the current dedicated worktree (do not edit it during the run).
npm run sandbox -- --working-tree --hours 1

# Leave the world paused at the last tick to look at it in the dashboard, then delete it.
npm run sandbox -- --ref my-branch --hours 3 --keep
npm run sandbox -- --delete <run id>

# Rebuild the comparison table for finished runs.
npm run sandbox -- --compare <run id> <run id>

# From a checkout on another machine: push HEAD to the server and run it there.
SANDBOX_HOST=root@host scripts/sandbox/remote.sh --hours 1 --seed 73430 73431
```

Other options: `--house-bots none` or `--house-bots warden=1,reaver=1` (default
`warden=2,reaver=2,sovereign=2`, at most 12), `--snapshot-ticks N` (default 300) and `--hours`
(600–10800 ticks, up to three game hours). The default ref is HEAD and the default seed is 73430.

A one-hour run takes roughly half a minute. Runs are serialized by `experiment.lock`; a matrix
simply runs its cells in order and keeps going if one fails.

## Strategy variants

A variant is a code revision: one branch or commit per variant, compared with `--ref a b c`. The
runner creates a detached worktree per ref, links the existing node_modules, and removes the
worktree afterwards. There is no overrides file and no scenario flags. Branches cost nothing;
delete them when the comparison is done.

## Where runs live

Each run gets `$STEWARD_REVIEW_DIR/experiments/runs/<id>/` (default `/var/lib/norm-steward-review`).
When reviews are paused (`paused` exists in that directory) the runner refuses to start. Do not
remove the pause; use your own data directory and delete it when finished:

```bash
STEWARD_REVIEW_DIR=/root/nsb-<topic>-data npm run sandbox -- --ref my-branch
```

Credentials are always read by the broker from `STEWARD_CONTROL_DIR`; the data directory only
holds run output, the lock and pacing state.

| File | Contents |
|---|---|
| `run.json` | Ref, revision, policy fingerprint, seed, horizon, house bots, status, `keep` |
| `timeline.md` | First tick of each major milestone (see below) |
| `result.json` | Everything: `timeline` (all milestones), `incoming`, `actions`, `checkpoints`, `final` state, `worldId`, `passed`, `deleted`/`kept` |
| `reports.json` | Every battle and scouting report in full, all pages |
| `checkpoints.md`, `snapshots.jsonl` | Every owned city every `--snapshot-ticks`: buildings, units, support, resources, production, queues, commands |
| `controller.json` | Controller storage, including the action journal |
| `sandbox-events.jsonl` | Broker receipts: create, step, act, keep, delete |
| `worker.log` | Runner output; read this first when a run fails |

## Timeline

The runner inspects the state after every clock step and every action, so ticks are exact at the
resolution the run advances (construction, training, arrival and affordability events), not rounded
to snapshots. Recorded for the capital (the first village):

- every building level; levels 1, 5, 10, … are major
- each unit type at 1 and at every 50 (home plus away)
- `Village N held`, `First attack sent`, `First support sent`, `First Envoy sent`
- `First incoming attack seen`, `First incoming attack lands`, `First incoming support seen`

`timeline.md` and comparison tables show major milestones; `result.json` has all of them.
`result.incoming` lists every incoming command ever visible, with the tick it was first seen and
the latest sighting details. Milestones already true at tick 0 are omitted.

## Kept worlds

`--keep` stops one tick before the round ends when asked for the full three hours, because an ended
world cannot be opened. The world stays paused and counts against the account limit of ten
sandboxes, so delete it with `--delete <run id>` as soon as you are done. A failed `--keep` run is
cleaned up like any other.

## Rules

- Never patch the runner, broker or controller in a scratch copy to get evidence. Add the
  capability here, with a test.
- Never read credentials, and never point a run at a live world; the broker refuses worlds it did
  not create.
- Never touch the live deployment, the control service or the review pause for a sandbox run.
- Keep runs bounded and make sure worlds are deleted (`result.json` has `deleted: true`, or
  `kept: true` followed by `--delete`).
- A peaceful seed is not survival evidence; compare on several seeds.

## Internals

Broker calls use the dedicated sandbox quotas (dashboard 100/s burst 500, calls 500/s burst 1000,
actions 625/s burst 5000), separate from live-world quotas. Backoff prefers `retryAfterMs` over
Retry-After; per-action `RATE_LIMITED` results are retried with the same journaled IDs. Steps use
`wait:true` and return state directly, falling back to bounded state polling. The broker
(`scripts/sandbox/broker.ts`) keeps a per-run registry of worlds it created, verifies ownership,
and writes fsynced receipts; cleanup runs in the worker's `finally`, on broker stdin EOF, and again
from `run.py`. Scheduled reviews use this same runner; their activation rules are in
[reviews.md](reviews.md).
