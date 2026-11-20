# Reproducing this installation

This is the complete setup entry point for the personal client on Alex's Linux machine.
For a code-only architectural review, use [the architect handoff](ARCHITECT_REVIEW.md): credentials,
services and a game account are not required to read the code or run the ordinary checks.

## What is versioned

| Concern | Source of truth in Git |
|---|---|
| Ownership and agent instructions | `AGENTS.md` |
| Browser/UI, hosting and authentication | `web/`, `scripts/serve.mjs`, `src/control/access.ts` |
| Deterministic advisors and allocation | `src/advisors/` |
| Authoritative executor and persistence | `src/control/controller.ts`, `src/control/storage.ts` |
| Review prompt | `scripts/review/prompt.md` |
| Structured review/backlog contract | `scripts/review/result.schema.json` |
| Review scheduler, usage, evidence and deployment | `scripts/review.py`, `scripts/review/` |
| Single-version sandbox runner | `scripts/sandbox/run.py`, `scripts/sandbox/runner.mts` |
| Private-world ownership/action broker | `scripts/sandbox/broker-cli.mts`, `scripts/sandbox/broker.ts`, `scripts/sandbox/client.ts` |
| Control service and review service/timer | `deploy/norm-steward-*.service`, `deploy/norm-steward-*.timer` |
| HTTPS reverse proxy | `web/Caddyfile` |
| Fresh backlog seed | `deploy/review-backlog.example.json` |
| Current strategy and prior reasoning | `docs/strategy.md`, `docs/strategy-history.md` |

Private settings, game/site keys, Codex authentication, SSH keys, runtime journals, sandbox results,
release directories and usage logs stay on the machine. They are not setup source and must not be
copied into Git. Their formats and locations are documented below and in [architecture](architecture.md).

## 1. Checkout and checks

Prerequisites: Linux with systemd, Python 3.11+, Git/SSH access to this private GitHub repository,
Node.js 20+ with npm, Caddy for HTTPS, and an installed Codex CLI for scheduled reviews.
The installed units target `/root/norm-steward-bot`, Node at `/usr/local/bin/node` and Python at
`/usr/bin/python3`. Check `command -v node codex python3 caddy` and adapt units before installation
if these paths differ. Relocating the repository also requires reviewing the defaults in the Python
review/deployment helpers; this is a machine-specific setup, not a portable installer.

```bash
cd /root
git clone git@github.com:alexvelea/norm-steward-bot.git
cd /root/norm-steward-bot
npm ci
npm run typecheck
npm test
npm run build:web
```

These checks need no gameplay credentials. The Python review/worker tests are included by `npm test`;
they can also run with `python3 -m unittest discover -s scripts/review -p 'test_*.py'` (and the same
for `scripts/sandbox`).
No GitHub Actions or paid model service is required.

On macOS, ensure `python3` on PATH meets the prerequisite too; Node's review-runner test invokes
that executable. An older Python can fail on `tarfile.extractall(..., filter='data')`. The rollback
test also compares resolved temporary paths, so use a canonical temporary directory to avoid the
`/var` → `/private/var` alias. With Homebrew Python installed, for example:

```bash
env PATH="/opt/homebrew/bin:$PATH" TMPDIR=/private/tmp npm test
```

## 2. Private connection and site access

Put the existing player's key in `/root/key.txt`, mode 0600. Create private runtime directories and
initialize the separate site access token once:

```bash
install -d -m 0700 /var/lib/norm-steward-bot /var/lib/norm-steward-review /var/lib/norm-steward-deploy
STEWARD_CONTROL_DIR=/var/lib/norm-steward-bot npm run access:init
```

Store the generated site token in the owner's password manager. The application authenticates site
access with that token, then unlocks the control center with the game key. They serve different purposes.
Never rerun token initialization or overwrite `control.json` as part of an ordinary update.
The control service bootstraps server/world/key from its unit only when no saved configuration exists;
subsequent connection changes belong in Settings. `.env` files are not automatically loaded.

A fresh configured executor starts gameplay automatically. If moving an existing account to another
machine, stop the old executor before starting this one. The port-8790 lease prevents duplicates on
one host; it is not a cross-machine account lock. Existing persisted execution pauses survive restarts.
Do not run another client on this player's key alongside this control center.

## 3. Start the control center

On a fresh machine only, bootstrap the release link; do not replace an existing deployment link:

```bash
ln -s /root/norm-steward-bot /var/lib/norm-steward-deploy/current
install -m 0644 deploy/norm-steward-control.service /etc/systemd/system/
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/norm-steward-control.service
systemctl enable --now norm-steward-control.service
python3 scripts/review.py deploy
```

`deploy` resolves the checked-out commit by default, creates an immutable release and verifies game
connection plus the previous execution preference. It restores the previous release if health fails.
Run it only after checks pass. Build artifacts come from the checked checkout; do not deploy a different
commit from the one used to build them. Confirm `systemctl status norm-steward-control` and inspect
`/var/lib/norm-steward-deploy/deployment.json` for the actual active commit.

Point DNS for `alex.norn-steward.velea.cc` to this machine, then merge `web/Caddyfile` into the host's
Caddy configuration, validate with `caddy validate --config /etc/caddy/Caddyfile`, and reload Caddy.
On Alex's current machine the committed file is the whole installed site configuration. Do not replace
unrelated virtual hosts on a different machine. The browser talks to this HTTPS origin; the local
control process proxies the authenticated game API to `norn-steward.velea.cc`.

## 4. Authenticate and enable reviews

Use the existing Codex account on this machine:

```bash
codex login
codex login status
codex exec --help
git ls-remote origin HEAD
```

Verify the installed CLI supports the flags used in `scripts/review.py`. The wrapper reads actual
usage via the CLI app-server and uses bounded noninteractive `codex exec`, not tmux. No additional
paid model or API key is configured. The service user must also have SSH permission to push this repo.
Authentication files and SSH private keys are machine-local prerequisites, never repository content.

Seed the backlog on a fresh installation only. Existing `work.json`, backlog and dirty review worktree
are durable progress and must not be overwritten:

```bash
cp deploy/review-backlog.example.json /var/lib/norm-steward-review/backlog.json
install -m 0644 deploy/norm-steward-review.service deploy/norm-steward-review.timer /etc/systemd/system/
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/norm-steward-review.service \
  /etc/systemd/system/norm-steward-review.timer
python3 scripts/review.py probe
printf '%s\n' '{"installed":true}' > /var/lib/norm-steward-review/installed.json
systemctl enable --now norm-steward-review.timer
```

The first review creates its dedicated Git worktree and `work.json` from the backlog. `probe` checks
unattended authentication without gameplay actions, respecting existing pause/quota backoff.
The installation marker tells the dashboard scheduling is installed. Actual timers remain authoritative.
For a systemd-environment probe, see [reviews](reviews.md#install-on-this-machine).

## 5. Operations and recovery

```bash
python3 scripts/review.py status
npm run sandbox -- --ref HEAD --hours 1  # optional foreground gameplay experiment
systemctl list-timers norm-steward-review.timer
journalctl -u norm-steward-control -u norm-steward-review
python3 scripts/review.py pause
python3 scripts/review.py resume
```

Sandbox runs default to blitz opponents (2 wardens, 2 reavers, 2 sovereigns); use
`--house-bots none` to disable them or `--house-bots warden=1,reaver=1` to customize the roster.
House bots attack after new-player protection ends at 900 ticks, so results are no longer comparable
to earlier zero-bot runs.

Reviews start around UTC :00/:30; the experiment queue is checked every two minutes. A shared review
lock prevents concurrent developer reviews and long sandbox jobs, while ordinary gameplay continues.
A quota pause stops model work, not deterministic gameplay or an already scheduled experiment.
Pause reviews blocks new experiment starts; an active measurement can finish. Stop the experiment
service/timer separately for an immediate experiment pause. Full backoff, cleanup and rollback commands
are in [reviews](reviews.md).

To update, first inspect both the source checkout and the separate review worktree. Preserve any
dirty/unpushed work and coordinate with an active review or experiment before changing shared source
or dependencies. Do not reset the review worktree to make an update succeed. In a clean source checkout:

```bash
cd /root/norm-steward-bot
git pull --ff-only
# Run npm ci if the dependency installation needs updating.
npm run typecheck
npm test
npm run build:web
python3 scripts/review.py deploy --commit "$(git rev-parse HEAD)"
readlink -f /var/lib/norm-steward-deploy/current
systemctl status norm-steward-control --no-pager
```

Build and deploy the same commit without intervening edits. The deployment command restarts the
executor, verifies connection and the persisted execution preference, and rolls back if health fails.
Pull/build/restart alone does not switch an existing immutable release. Documentation-only updates
can be committed and pushed without activating a new runtime release.

Reinstall/reload systemd units only if their source changed. Preserve the settings/journal directory
and the current gameplay execution preference. Preserve any existing review pause too; an update is
not a request to resume either loop. See [operations](operations.md) for the audited machine inventory.
The runtime state inventory and restart semantics are in [architecture](architecture.md).
