#!/usr/bin/env bash
# Runs Claude Code shifts on one Norn Steward world, back to back, until its round ends.
# Each shift is a fresh `claude -p` with a fresh context; the steward carries its plan between
# shifts in its notes (get_briefing / set_notes). See docs/mcp.md § Playing a whole round.
#
# Usage:  bots/llm/shift.sh <world> [minutes]
#
# Environment:
#   STEWARD_WORLD      the world, when not given as the first argument
#   STEWARD_URL        the server, for the status check (default http://localhost:8787)
#   STEWARD_KEY        your key; sent with the status check, so your own sandboxes work too
#   SHIFT_MINUTES      minutes per shift, when not given as the second argument (default 30)
#   SHIFT_MAX_TURNS    --max-turns for each shift (default 400)
#   SHIFT_PAUSE        seconds between shifts (default 5)
#
# The `steward` MCP server must already be added to Claude Code (README: "MCP for LLMs").
set -euo pipefail

WORLD="${1:-${STEWARD_WORLD:-}}"
MINUTES="${2:-${SHIFT_MINUTES:-30}}"
URL="${STEWARD_URL:-http://localhost:8787}"
MAX_TURNS="${SHIFT_MAX_TURNS:-400}"
PAUSE="${SHIFT_PAUSE:-5}"

if [ -z "$WORLD" ]; then
  echo "usage: $0 <world> [minutes]   (or set STEWARD_WORLD)" >&2
  exit 2
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "claude (Claude Code) isn't on PATH" >&2
  exit 2
fi

# Prints the world's status (running, paused or ended), or nothing if the server can't be reached.
world_status() {
  local auth=()
  if [ -n "${STEWARD_KEY:-}" ]; then auth=(-H "Authorization: Bearer ${STEWARD_KEY}"); fi
  curl -fsS ${auth[@]+"${auth[@]}"} "${URL%/}/api/v1/worlds/${WORLD}" 2>/dev/null \
    | grep -o '"status" *: *"[a-z]*"' | head -n 1 | sed 's/.*"\([a-z]*\)"$/\1/' || true
}

PROMPT="Play one ${MINUTES}-minute shift of Norn Steward on world ${WORLD}. Follow the steward server's instructions and use the steward prompt's loop."

shift_no=0
while :; do
  status="$(world_status)"
  if [ "$status" = "ended" ]; then
    echo "$(date +%H:%M:%S) world ${WORLD} has ended after ${shift_no} shift(s)"
    break
  fi
  if [ -z "$status" ]; then
    echo "$(date +%H:%M:%S) can't read world ${WORLD} from ${URL}; trying again in 30 s" >&2
    sleep 30
    continue
  fi
  shift_no=$((shift_no + 1))
  echo "$(date +%H:%M:%S) shift ${shift_no} on ${WORLD} (${status})"
  claude -p "$PROMPT" --allowedTools mcp__steward --max-turns "$MAX_TURNS" \
    || echo "$(date +%H:%M:%S) shift ${shift_no} exited with status $?" >&2
  sleep "$PAUSE"
done
