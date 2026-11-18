#!/usr/bin/env bash
# Copy stored sandbox results from the server into ./sandbox-results/<commit>/<run id>/ (ignored by Git):
#   SANDBOX_HOST=root@host scripts/sandbox/fetch.sh              # every stored commit
#   SANDBOX_HOST=root@host scripts/sandbox/fetch.sh master HEAD  # only these commits
set -euo pipefail
host=${SANDBOX_HOST:?Set SANDBOX_HOST, for example root@host}
store=${STEWARD_SANDBOX_DIR:-/var/lib/norm-steward-sandbox}/experiments/runs
mkdir -p sandbox-results
if [ $# -eq 0 ]; then rsync -a "$host:$store/" sandbox-results/; exit; fi
for ref in "$@"; do
  commit=$(git rev-parse "$ref^{commit}")
  if ssh "$host" "test -d $(printf %q "$store/$commit")"; then rsync -a "$host:$store/$commit" sandbox-results/; echo "sandbox-results/$commit"
  else echo "No stored runs for $ref ($commit)" >&2; fi
done
