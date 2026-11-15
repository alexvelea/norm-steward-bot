# Current strategy and implementation work

The control service continuously plays through deterministic advisors and the President. Codex is
an autonomous developer, not the gameplay loop. One source of resource allocation and one durable
executor; no separate military spender or second live bot.

## What is shipped

- Economic production/capacity policy, Hall-first payback over useful future construction, and
  automatic round joining. The Hall has no forced ratio to producer levels.
- Round completion guard: with a fresh idle queue, reject builds whose earliest live-duration
  completion is AFTER round end. Real private experiments confirmed equality completes, so equality
  is allowed. Resource affordability and Council cooldown are included; queued Hall changes are
  revalidated after completion. See scripts/experiment-completion.ts and docs/reviews.md.
- A managed owner-only sandbox helper and explicit work contract. Reviews must actively obtain
  evidence, implement a vertical step and test it. Repeated reporting is not gameplay delivery.

## First military infrastructure candidate

The Military Advisor now proposes only an unlocked first Barracks through the existing President
and durable construction executor. Score 79 leaves urgent capacity and Cellar protection first,
then enables a training path ahead of discretionary economic investment. Impossible prerequisites,
storage and population constraints cannot reserve the economy. The live completion window must
leave a 300-tick use horizon, extended for a longer Council interval plus one recruit's training.
It does not buy Hall prerequisites or upgrade existing military facilities. Recruitment is evaluated separately after completion.
Reproduce the economic-only versus candidate server comparison with
`node --import tsx scripts/experiment-military.ts` using the managed review environment.
Activation and deployment verification remain the review wrapper's responsibility. Barracks completion alone is not a measured combat gain.

## Initial defensive recruitment candidate

The Military Advisor also proposes Pikemen through the same President and durable executor, at
score 78. Buy only a currently affordable batch of at most five toward ten owned Pikemen per
village, counting home, away and queued troops. Preserve the economic population buffer
(maximum of 50 or 20% of capacity), live prerequisites/costs/storage, idle construction and training
queues, standing orders, Council cooldown and a 60-tick use window after the entire batch finishes.
Unavailable recruitment never reserves resources. Capacity and Cellar protection retain priority.

The executor journals training action IDs before POST, tracks accepted batch IDs, counts away
troops during completion reconciliation, and suppresses uncertain replay after observed troop or
queue changes. Restarts retain the same action payload and ID; an expired uncertain idempotency
window pauses execution. Reproduce baseline/candidate and lost-response recovery with
`node --import tsx scripts/experiment-recruitment.ts`. This initial force is an enabling defensive
capability, not evidence of fewer battle losses. Composition and combat effectiveness remain to test.

Four matched owner-only server cases verified this candidate. From tick 86 to 166, the candidate
trained two batches of five for 450 timber, 350 stone and 150 iron, with population rising from
41 to 51 of 200. The baseline instead completed Lumberyard 2 and Cellar 3 and recruited no troops.
Both policies avoided recruitment when the full batch would leave only 59 ticks for use. A restart
before submission retained the exact batch payload; a lost successful response was reconciled from
the observed training queue without another submission. Actual battle losses were not measured.

## Bounded defensive composition candidate

Keep the initial ten owned Pikemen and, only after they exist, allow at most five owned
Shieldmen where Barracks/Smithy prerequisites are already satisfied. Count home, away and queued
units separately for each cap. Recruitment itself buys no infrastructure or Hall prerequisites.
The same President priority, durable training journal, population buffer, affordability,
queue/order and full-batch round deadline checks apply. Lost Pikemen are replenished before adding
Shieldmen. A village without Smithy 1 continues its existing Pikeman/economic policy.

Reproduce the private baseline/candidate executor comparison and controlled server combat probes
with `node --import tsx scripts/experiment-composition.ts`. The extra troops cost resources and
population; distinguish isolated server simulations from battles containing a Warden's own defenders.
This bounded complement is not a claim of improved live battle results or an optimal force size.

The matched private comparison trained five Shieldmen from tick 800 to 855 for 175 timber,
150 stone, 325 iron and five population; the baseline built Lumberyard 2. Journal-before-write
and restart completion confirmation succeeded without duplicate submission. Both supported-village
battles at tick 5255 lost zero of our defenders, so that fixture showed no casualty benefit.
Isolated authoritative server probes against ten Raiders left two Pikemen and one Shieldman alive,
where ten or sixteen Pikemen were wiped out. Against four Lancers, sixteen Pikemen lost fewer
resources than the mixed force. The twelve-case matrix, including the rejected five-and-five
replacement, is reproduced by `node --import tsx scripts/experiment-composition-matrix.ts`.
Aggregate resource totals are comparisons, not exchange rates between timber, stone and iron.

## Bounded defensive Smithy unlock

A separate Military Advisor proposal at score 77 enables Smithy 1 after ten owned Pikemen when
Hall 5 and Barracks 1 already exist under live prerequisites. It buys no Hall levels or further
Smithy levels. Current resources must cover both the Smithy and the entire remaining complement
of at most five Shieldmen, with the recruitment population buffer preserved after both. An
unfunded or impossible path is not-needed and never reserves the economy. Urgent capacity and
Cellar protection keep priority; busy queues, standing orders, pause and Council cooldown defer
submission. Construction must leave 300 ticks, or enough for a longer Council interval plus full
complement training and 60 ticks for use. The existing President/executor revalidates recruitment
after construction, so this is a bounded enabling purchase rather than an irrevocable troop plan.

Reproduce the matched baseline/candidate useful and too-late cases with
`node --import tsx scripts/experiment-smithy.ts` in the managed review environment. The comparison
allows two President decisions per policy, then observes at an equal clock tick. From tick 800
to 894, the candidate built Smithy 1 and trained five Shieldmen for 395 timber, 330 stone and
565 iron, using 25 population (54 to 79 of 200). The baseline instead built two Lumberyard levels
for 141 timber, 169 stone and 113 iron and retained ten Pikemen without Shieldmen. Both actions
in the candidate were journalled before submission and confirmed after paused restarts without
duplicate writes. The late case rejected the Smithy with only 299 ticks after its completion.
These results demonstrate the additional troop path and its economic cost, not improved live
battle losses or an optimal allocation.

## Priority: create useful military capability

### Bounded raiding-force step

The next enabling purchase is Smithy 2 (score 75), only after ten owned Pikemen and five
owned Shieldmen exist, Smithy 1 is complete and the complete remaining force of at most ten
Raiders is funded from current stock. Preserve max(50, 20% of capacity) free population
after construction and recruitment. Buy no earlier Smithy levels, Hall prerequisites or
further military upgrades for this proposal. Unavailable or unfunded paths never reserve
the economy. Construction must leave at least 600 ticks, extended for the complete force's
training, multiple Council intervals and 300 ticks for use.

Recruitment is a separate President decision at score 76, at most five Raiders per batch
toward ten home + away + queued. It requires the completed defensive complement, existing
live prerequisites, current affordability, the population buffer, idle queues and no competing
standing orders. Before starting a partial batch, current funding and population must fit
the entire remaining force, whose training plus Council intervals must leave 300 ticks for use.
The normal durable executor
journals and reconciles construction and training. It sends no attacks.

Run `node --import tsx scripts/experiment-raiding.ts` for matched useful/late private cases
and restart reconciliation. `scripts/experiment-raiding-risk.ts` tests explicit scouting and
combat fixtures using the authoritative non-mutating server simulator. These fixtures are
not current enemy intelligence and do not establish profitable live raids. Live rules require
Hall 10, Barracks 5 and Smithy 5 for Stable 1; this policy does not buy that prerequisite chain.
Scouting, report freshness, target-risk evaluation and durable command execution remain
subsequent steps under the pinned raiding workstream.

Four matched final-source private cases verified the step. From tick 1200 to 1347,
the useful candidate built Smithy 2 and trained two five-Raider batches for 827 timber,
577 stone and 752 iron, increasing population from 79 to 92 of 200. The baseline spent
239/286/191 on three Lumberyard upgrades and trained no Raiders. With only 599 ticks
after the prospective Smithy completion, both policies retained Smithy 1 and no Raiders,
making identical economic purchases. Candidate actions were journalled before writes and
confirmed after paused restarts without duplicate submissions. Isolated server simulations
showed ten Raiders surviving an undefended target with 120 total loot, but losing all ten
against ten Pikemen and five Shieldmen. Those are explicit fixtures, not observed live targets.

The observed land had no troops/training, no military infrastructure, repeated raids and 21/26
retained defensive reports lost. The initial 17 scheduled reviews shipped only reports. Historical
absence of battle details is not a reason to defer a controlled infrastructure/recruitment experiment.

The pinned work.json defines the next acceptance criteria. Start with one bounded first military
infrastructure step through the shared President, then add recruitment through the same durable
executor. An unlocked Barracks 1 is an enabling step, not a measured combat improvement. Keep spending
bounded and never reserve the whole economy for an impossible prerequisite. Use live options/rules,
respect population/storage/queues and remaining round time, and revalidate before any live write.
Then evaluate useful troop composition and recruitment in owner-created private sandboxes. Raiding
comes after a usable force and scout-informed target/risk estimates exist.

## How to make progress

Use src/review/sandbox-client.ts: PrivateSandbox creates an owner-only world, joins, reads rules/state,
submits normal test actions, steps the clock and cleans up without exposing credentials. The wrapper
injects the run/tool paths and records signed-in owner checks and exact code fingerprints in receipts.
Do not wait for supplied sandbox evidence: create the experiment yourself. Keep incomplete code and
experiments in the worktree/private run artifacts for the next review. Read work.json, previous report
and actual usage; no invented token bank. Measured negative experiments are useful; repeating an
unchanged offline audit is not. Do not change runtime policy without baseline/candidate sandbox
comparison and meaningful checks. The wrapper handles commit/push/activation and rollback.

Measure production, construction/resource waits, overflow, Hall spend, infrastructure, useful troop
strength and battle losses by world epoch. Separate expected effect from actual observation, and
separate round resets, manual activity and raids from policy effects. Older readiness/horizon reports
remain useful tools, not prerequisites that someone else must satisfy before implementation.

Production upgrades now have an additional deadline: marginal output must repay the complete
three-resource bill by round end, including funding waits and construction. The Hall's projected
producer pipeline applies this gate too. Farm/storage/protection remain separate necessity tests.
This avoids saving or spending for late investments whose gross return cannot cover their cost.

## Bounded scouting readiness

The Military Advisor can buy Stable 1 at score 73 and train up to two owned Scouts at score 74,
only after ten Pikemen, five Shieldmen and ten Raiders are owned (home plus away). Scouts at home,
away and queued all count toward the cap. Existing Stable levels also qualify for recruitment;
no Stable upgrades or prerequisite chains are purchased. In particular, the live Stable prerequisites
currently require Hall 10, Barracks 5 and Smithy 5, which this policy does not fund.

The entire missing Scout complement and, if needed, Stable 1 must be funded from current stock.
Keep the economic population buffer after construction and recruitment, respect live prerequisites,
options, storage, batch limits, queues, standing orders, pause and Council cooldown. Construction
must leave full-complement training, another Council interval and 600 ticks for use. Recruitment
rechecks live state and also leaves 600 ticks. Unavailable paths never reserve the village budget.
Both purchases use the existing President and durable build/train executor.

Reproduce the matched policy and restart comparison with `scripts/experiment-scouting.ts`, and
physical successful/failed scouting probes with `scripts/experiment-scouting-probes.ts`. These
probes are private test commands, not a second live executor. Bounded automatic dispatch and report-summary freshness checks are implemented below; full intelligence collection and risk-gated raids remain subsequent work. A retained success report
is an observation at its report tick; it cannot establish current troops, resources or ownership.

The useful matched private case completed Stable 1 and two Scouts in 63 ticks for 360 timber,
350 stone and 310 iron, using 12 additional population. The deployed-policy baseline instead
completed two Lumberyard upgrades for 141/169/113 at the same comparison tick. Both candidate
operations were journalled before submission and confirmed after a paused restart without another
POST. Separate physical probes returned a scouting success for two Scouts and a failed one-Scout
run against one supplied defending Scout. The successful report retained its observation tick
when read 814 ticks later; full intel details are not exposed by the managed sandbox read interface.
These observations establish readiness and report age, not profitable live target selection.
Both private policies rejected the new Scout path when full training would leave only 599 ticks
for use, and made identical economic purchases for 159 timber, 155 stone and 114 iron instead.


## Bounded scouting dispatch candidate

After the existing defensive and raiding complements exist, a score-72 proposal dispatches exactly
two home Scouts to the nearest unprotected house-bot village within 300 travel ticks. Preserve our
own protection, allow one Scout command globally, wait 600 ticks per village between attempts, and
leave the return trip plus 60 ticks before round end. Busy queues, standing orders, incoming attacks,
Council cooldown and insufficient home Scouts skip the path without reserving resources. No human
targets or combat troops are included. The President and existing persistent executor own the send.

Command IDs and scoped historical observations survive restart. The executor confirms only from a
matching report, suppresses uncertain duplicate sends after observed troop/command changes, retains
exact IDs for safe retries, and pauses on an expired uncertain window. Observation use requires a
successful attacker scouting report linked to the journalled command, matching owner and village,
current account/server/world/epoch, age at most 300 ticks, and a map snapshot at most 30 ticks old.
No report summary is treated as hidden troop/resource intelligence or evidence of a profitable raid.

Reproduce with `node --import tsx scripts/experiment-scout-dispatch.ts`. The managed broker exposes
report summaries and authoritative command refs but no map or full report detail; the experiment
explicitly supplies a public-map fixture derived from a server-returned support destination and the
configured Warden identity. All policy sends and reports are real private server results. This scope
verifies durable dispatch and historical observation guards; full intel retrieval is the next step.

The matched private pair started at tick 4882. At tick 5311 the candidate had obtained a successful
scouting report at tick 5010 (128 travel ticks), returned both Scouts and spent no resources on the
dispatch. The baseline completed Lumberyard 2 for 63 timber, 75 stone and 50 iron. A paused restart
confirmed the candidate's matching report without another POST. Reuse was rejected after 301 ticks,
a changed target owner or a different epoch scope. A second real send with a deliberately lost
successful response was suppressed after a paused restart, with zero duplicate sends. All created
worlds were deleted. These are reconnaissance/recovery results, not measured combat or loot gains.
