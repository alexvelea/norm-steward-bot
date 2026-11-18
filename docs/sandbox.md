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
# A commit that already has a stored run with the same seed and settings is reused, not run again,
# so the baseline costs nothing the second time.
npm run sandbox -- --ref master my-branch --seed 73430 73431 73432 --hours 2

# Run again even though a stored run exists.
npm run sandbox -- --ref my-branch --rerun

# Uncommitted edits in the current dedicated worktree (do not edit it during the run).
npm run sandbox -- --working-tree --hours 1

# Leave the world paused at the last tick to look at it in the dashboard, then delete it.
npm run sandbox -- --ref my-branch --hours 3 --keep
npm run sandbox -- --delete <run id>

# Rebuild the comparison table for finished runs.
npm run sandbox -- --compare <run id> <run id>

# Remove stored runs of commits that are not on master (optionally only those ended N days ago).
npm run sandbox -- --prune
npm run sandbox -- --prune 7

# From a checkout on another machine: push HEAD to the server, run it there, copy its results back.
SANDBOX_HOST=root@host scripts/sandbox/remote.sh --hours 1 --seed 73430 73431

# Copy stored results into ./sandbox-results/<commit>/<run id>/ (all commits, or the refs named).
SANDBOX_HOST=root@host scripts/sandbox/fetch.sh master HEAD
```

Other options: `--house-bots none` or `--house-bots warden=1,reaver=1` (default
`warden=2,reaver=2,sovereign=2`, at most 12), `--snapshot-ticks N` (default 300) and `--hours`
(600–10800 ticks, up to three game hours). The default ref is HEAD and the default seed is 73430.

A one-hour run takes roughly 25 seconds and a two-hour run under two minutes. Run the command in
the foreground and read its output; do not wrap it in polling loops. Runs are serialized by
`experiment.lock`; a matrix simply runs its cells in order and keeps going if one fails. Runs are
not parallel on purpose: the time is local CPU in the Controller, and four at once on the
one-CPU server took four times as long and nearly all its memory.

## Strategy variants

A variant is a code revision: one branch or commit per variant, compared with `--ref a b c`. The
runner creates a detached worktree per ref, links the existing node_modules, and removes the
worktree afterwards. There is no overrides file and no scenario flags. Branches cost nothing;
delete them when the comparison is done.

## Where runs live

All runs go to one shared store, by commit:

```
/var/lib/norm-steward-sandbox/experiments/runs/<commit hash>/<UTC time>-s<seed>-t<ticks>-<random>/
```

The last directory name is the run id used by `--compare` and `--delete`. Everything a run
produced is kept there, so read an existing result before running anything: the baseline for
`master` is `runs/$(git rev-parse master)/`. To analyse results on another machine, copy them
with `fetch.sh` and read the files below; do not add analysis output to the store.

A stored run is reused when the commit, seed, horizon, snapshot cadence and house bots all match
and the run completed with its world deleted. `--keep` and `--working-tree` runs are stored under
their HEAD commit but never reused. `--prune` removes runs of commits that are not ancestors of
`master`; runs still in progress and worlds still kept are left alone. Do not use private data
directories or delete the shared store by hand.

Scheduled reviews keep their own store, lock and pause under `/var/lib/norm-steward-review`
(the reviewer sets `STEWARD_SANDBOX_DIR` to it and always passes `--rerun`), so the review pause
does not block the shared store. Credentials are always read by the broker from
`STEWARD_CONTROL_DIR`; the store only holds run output, the lock and pacing state.

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
