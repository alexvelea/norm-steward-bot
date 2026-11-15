# Strategy and durable backlog

Deterministic advisors and the President continuously play. Codex reviews one improvement at a time;
it is not required for game ticks, joining, queuing or idempotent recovery. No external paid model.

First review: Great Hall investment. Follow live exact time tables, own Hall costs, per-resource
waits, likely producer/capacity pipeline, actual Hall-gated unlocks and remaining round time. No
Hall-to-Mine level ratio. A Hall prerequisite alone has no military value until a concrete useful
recruitment/infrastructure plan exists. Incoming attacks within 300 ticks defer Hall investment.

The operational backlog is `/var/lib/norm-steward-review/backlog.json`, not an invented token bank.
Prioritize defence/infrastructure/recruitment given the observed undefended village and real raids.
A military advisor must participate in the shared President allocation. Do not start a second bot.
Then evaluate raiding with scouts and battle estimates when a usable force and safe targets exist.

Measure round-scoped gross production, construction idle/resource wait time, overflow, Hall spend,
producer levels, useful troop strength and losses. Distinguish expected benefit from observed
outcomes; never attribute round resets, attacks or manual commands to an advisor policy.

Defence work in progress: an offline readiness report now extracts current military prerequisites,
server build/training options, queue drain, population, incoming attack timing, and retained battle
outcomes from redacted evidence. Run it without a server or client credentials:

```bash
node --import tsx scripts/defence-readiness.ts /path/to/run/evidence > /path/outside/git/defence-readiness.json
```

The report reads only `state.json`, `rules.json` and `reports.json`. It makes no requests and does
not propose or execute spending. Preserve its limitations: the report page may be incomplete,
scouting is separate from defensive battles, summaries do not contain strength/loss/loot details,
and queue drain is not a readiness forecast. Missing collection data or mismatched rule versions
fail rather than imply safety. Next, obtain redacted battle detail and compare one bounded defence
policy to the current policy in owner-created private sandboxes. Recruitment still requires extending
the build-only proposal contract and durable executor through the President; this is unfinished.
