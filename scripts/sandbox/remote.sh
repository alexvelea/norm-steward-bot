#!/usr/bin/env bash
# Run the committed HEAD of a local checkout in a sandbox on the server, in one command:
#   SANDBOX_HOST=root@host scripts/sandbox/remote.sh --hours 1 --seed 73430 73431
# Pushes HEAD to branch sandbox/<local branch> in the server repository (never to master, never
# checked out there) and runs it through the normal runner, which uses its own temporary worktree.
set -euo pipefail
host=${SANDBOX_HOST:?Set SANDBOX_HOST, for example root@host}
repo=${SANDBOX_REPO:-/root/norm-steward-bot}
data=${STEWARD_REVIEW_DIR:-/root/nsb-sandbox-data}
[ -z "$(git status --porcelain --untracked-files=no)" ] || echo "Uncommitted changes are not included; only HEAD runs." >&2
branch=sandbox/$(git rev-parse --abbrev-ref HEAD | tr -c 'A-Za-z0-9._\n-' '-')
git push --quiet --force "ssh://$host$repo" "HEAD:refs/heads/$branch"
ssh "$host" "cd $(printf %q "$repo") && STEWARD_REVIEW_DIR=$(printf %q "$data") python3 scripts/sandbox/run.py --ref $(printf %q "$branch")$(printf ' %q' "$@")"
