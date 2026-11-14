# Runs Claude Code shifts on one Norn Steward world, back to back, until its round ends.
# Each shift is a fresh `claude -p` with a fresh context; the steward carries its plan between
# shifts in its notes (get_briefing / set_notes). See docs/mcp.md § Playing a whole round.
#
# Usage:  pwsh bots/llm/shift.ps1 -World <world> [-Minutes 30]
#
# Environment (used when the matching parameter isn't given):
#   STEWARD_WORLD      the world
#   STEWARD_URL        the server, for the status check (default http://localhost:8787)
#   STEWARD_KEY        your key; sent with the status check, so your own sandboxes work too
#   SHIFT_MINUTES      minutes per shift (default 30)
#   SHIFT_MAX_TURNS    --max-turns for each shift (default 400)
#   SHIFT_PAUSE        seconds between shifts (default 5)
#
# The `steward` MCP server must already be added to Claude Code (README: "MCP for LLMs").
param(
  [string]$World = $env:STEWARD_WORLD,
  [int]$Minutes = $(if ($env:SHIFT_MINUTES) { [int]$env:SHIFT_MINUTES } else { 30 }),
  [string]$Url = $(if ($env:STEWARD_URL) { $env:STEWARD_URL } else { "http://localhost:8787" }),
  [int]$MaxTurns = $(if ($env:SHIFT_MAX_TURNS) { [int]$env:SHIFT_MAX_TURNS } else { 400 }),
  [int]$Pause = $(if ($env:SHIFT_PAUSE) { [int]$env:SHIFT_PAUSE } else { 5 })
)
$ErrorActionPreference = "Stop"

if (-not $World) {
  Write-Error "usage: shift.ps1 -World <world> [-Minutes 30]   (or set STEWARD_WORLD)"
  exit 2
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Error "claude (Claude Code) isn't on PATH"
  exit 2
}

# The world's status (running, paused or ended), or $null if the server can't be reached.
function Get-WorldStatus {
  $headers = @{}
  if ($env:STEWARD_KEY) { $headers["Authorization"] = "Bearer $($env:STEWARD_KEY)" }
  try {
    $world = Invoke-RestMethod -Uri "$($Url.TrimEnd('/'))/api/v1/worlds/$([uri]::EscapeDataString($World))" -Headers $headers
    return $world.status
  } catch {
    return $null
  }
}

$prompt = "Play one $Minutes-minute shift of Norn Steward on world $World. Follow the steward server's instructions and use the steward prompt's loop."
$shift = 0
while ($true) {
  $status = Get-WorldStatus
  if ($status -eq "ended") {
    Write-Host "$(Get-Date -Format HH:mm:ss) world $World has ended after $shift shift(s)"
    break
  }
  if (-not $status) {
    Write-Warning "$(Get-Date -Format HH:mm:ss) can't read world $World from $Url; trying again in 30 s"
    Start-Sleep -Seconds 30
    continue
  }
  $shift++
  Write-Host "$(Get-Date -Format HH:mm:ss) shift $shift on $World ($status)"
  & claude -p $prompt --allowedTools mcp__steward --max-turns $MaxTurns
  if ($LASTEXITCODE -ne 0) { Write-Warning "$(Get-Date -Format HH:mm:ss) shift $shift exited with status $LASTEXITCODE" }
  Start-Sleep -Seconds $Pause
}
