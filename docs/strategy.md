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
# Optional: compare two evidence snapshots from the same server.
node --import tsx scripts/defence-readiness.ts /path/to/current/evidence /path/to/previous/evidence > /path/outside/git/defence-comparison.json
```

The report reads only `state.json`, `rules.json` and `reports.json`. It makes no requests and does
not propose or execute spending. Preserve its limitations: the report page may be incomplete,
scouting is separate from defensive battles, summaries do not contain strength/loss/loot details,
and queue drain is not a readiness forecast. Missing collection data or mismatched rule versions
fail rather than imply safety. Next, obtain redacted battle detail and compare one bounded defence
policy to the current policy in owner-created private sandboxes. Recruitment still requires extending
the build-only proposal contract and durable executor through the President; this is unfinished.

Training readiness now also lists each offered unit's missing direct recruitment-building and
smithy levels from the supplied rules. It preserves server options and blockers, and fails on
missing or invalid unit prerequisites. This explains generic prerequisite rejections without
assuming an unlock is affordable or projecting a construction chain. For example, the r8.0 tick
5657 snapshot requires Barracks 1 for pikemen, and Barracks 1 plus Smithy 1 for shieldmen.

The optional comparison reads only the earlier `state.json`. It refuses different player/world/
epoch/round scopes and non-forward ticks, reports building changes and village turnover, and counts
unique defensive battle IDs in `(previous tick, current tick]`. Counts are observed lower bounds
unless the retained report page reaches the earlier tick or exhausts history. Scouting, other
villages and reports after the current snapshot tick are excluded. Inputs must come from the same
server; state evidence does not identify the origin. No comparison attributes changes to policy.

Review observation at r7.0 ticks 7535 to 9335: the page covers the interval and records 18 new
defensive battles, all losses. Lumberyard rose 20 to 23, quarry 20 to 22, farm 7 to 8 and storehouse
15 to 17; Hall stayed 6 and mine 20. No round reset occurred. The earlier readiness report helped
expose prerequisites and queue constraints, but no military policy was activated and no combat
benefit is measured. Raids, ordinary economic execution and snapshot timing confound policy
attribution. Battle details and reproducible owner-sandbox comparisons remain the next defence step.

The interval comparison also counts unique defensive scouting reports separately from battles.
At r8.0 ticks 5657 to 7473 the covered interval contains four scouting reports and zero defensive
battles. Enemy reconnaissance does not establish attack intent or strength. Hall stayed 14 and
military buildings, troops and training remained empty; no defence benefit is measured. The
scouting count uses the same scope, interval and pagination limitations as the battle count.

Attack timing now includes `globalConstructionDrainTicks`, the latest current construction end
across owned villages relative to the snapshot tick, clamped to zero. Each incoming attack's
`ticksAfterConstructionDrain` is arrival minus that global drain tick: negative means arrival
precedes drain; zero does not establish same-tick action ordering. This makes other villages'
construction visible alongside the executor's global construction constraint, but is a conservative
queue horizon rather than the executor's tracked-operation state. These observations
exclude new builds, recruitment, cooldown and polling; positive time does not establish readiness.
At r8.0 tick 9275, the known attack arrives in 10 ticks and current construction drains in 216,
giving -206 ticks. Military buildings, troops and training remain empty. This is timing evidence,
not a tested defence policy. Five further defensive scouting reports and zero battles were observed
since tick 7473 with complete interval coverage; no combat benefit is measured.
