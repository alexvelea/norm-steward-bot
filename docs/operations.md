# Machine operations

This inventory was checked over SSH on **2026-11-17 at approximately 11:23 Europe/Bucharest
(09:23 UTC)**. It is a dated observation, not a live status page. Use the commands below to refresh it.
No credentials, private runtime dumps or experiment traces are included here.

## Hosts and execution paths

| Location | Role observed |
|---|---|
| Local Mac: `~/norn-steward/norm-steward-bot` | Development checkout; clean at `90dc349` after pulling. No bot/control process from this repo was observed running locally. |
| `alex.norn-steward.velea.cc`: `/root/norm-steward-bot` | Clean source checkout at `90dc349`, matching its recorded `origin/master`. |
| `/var/lib/norm-steward-deploy/current` | Active release link to `releases/90dc349071c63ac20dc9d29b6f6d32a898b36efb`. |
| `/var/lib/norm-steward-review/worktree` | Separate `review/continuous` branch at the same commit, with unfinished threat-experiment source/tests and strategy edits. Preserve this work. |
| `norn-steward.velea.cc` | Authoritative remote game API. Its public worlds endpoint responded; its internal services were not inspected. |

The live path is browser → Caddy → Node control service → remote game API. Caddy terminates HTTPS
on ports 80/443 and proxies the site to `127.0.0.1:8788`. Node serves the active release's UI,
enforces site/control authentication, bridges API/WebSocket traffic and owns the deterministic
advisor/executor. The same process holds the host-local executor lease on `127.0.0.1:8790`.

The older `/srv/norn-steward-ui`, `/srv/norn-steward-preview` and `/root/norn-steward` directories
are present, but are not the serving path in the installed Caddy/control-service configuration.
Do not copy a build there expecting a production update. tmux contains an interactive Codex session
and a shell; systemd owns continuous gameplay and scheduled reviews.

## Observed service state

| Component | Observation at audit |
|---|---|
| `caddy.service` | Running; public and loopback UI requests returned the private-access login page. |
| `norm-steward-control.service` | Running from the active release, with restart-on-failure enabled. |
| Gameplay executor | Saved automatic execution enabled for `blitz-1`; recent accepted construction and fresh confirmations showed ongoing work. |
| `norm-steward-review.timer` | Enabled; schedules around UTC :00/:30. No scheduled reviewer was running at inspection. |
| Retired experiment timer | Historical inventory only; current sandbox runs are foreground commands. See reviews.md for unit removal. |

The last substantive review started at 10:00 Bucharest and timed out at 10:15. The 10:30 invocation
reported `backoff`; the 11:00 invocation reported `paused`. At inspection, the pause file was absent,
while saved review status still said `timeout`. These observations do not establish an active pause
or a scheduler failure: skipped invocations do not refresh the saved run status. Preserve operator
settings and inspect the next timer result before deciding whether recovery is necessary. See
[review status interpretation](reviews.md#interpreting-review-status). Gameplay continued independently.

## Refreshing the inventory

Run on Alex's host:

```bash
git -C /root/norm-steward-bot status --short
git -C /root/norm-steward-bot log -1 --oneline
git -C /var/lib/norm-steward-review/worktree status --short
readlink -f /var/lib/norm-steward-deploy/current
systemctl status norm-steward-control caddy --no-pager
systemctl list-timers norm-steward-review.timer --no-pager
journalctl -u norm-steward-review.service -n 30 --no-pager
python3 /root/norm-steward-bot/scripts/review.py status
ls /var/lib/norm-steward-review/experiments/runs  # reviewer runs, by commit
ls /var/lib/norm-steward-sandbox/experiments/runs # shared sandbox store, by commit
ss -lntp
```

Review status and logs are private operational output; inspect them on the host without committing
raw captures. The [architecture state map](architecture.md#durable-runtime-state-private-not-git)
identifies credential/journal locations and the [setup guide](setup.md#5-operations-and-recovery)
describes release activation. Source HEAD, review worktree and active release are separate states;
check all three rather than assuming a pull or push deployed anything.
