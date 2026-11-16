# Current strategy and implementation work

The control service continuously plays through deterministic advisors and the President. Codex is
an autonomous developer, not the gameplay loop. One source of resource allocation and one durable
executor; no separate military spender or second live bot.

## Active queue and military-development policy (2026-11-16)

The recruitment/command overlap candidate removes the empty-training-queue requirement from
Scout dispatch and risk-checked raids. It uses only home troops and retains construction,
standing-order, incoming-attack, intelligence, simulation, return deadline and storage guards.
The President and durable executor remain the only allocator and writer. Reproduce its matched
comparison against deployed `e346af8` with
`node --import tsx scripts/experiment-raid-generalization.ts --training-overlap` in the managed
review environment. Both clocks stay paused between steps and both controllers plan as running.
The ordinary paid fixture includes an existing force, a recent clearing and one 9Pi3Sh cohort;
its acquisition expense and clearing losses are separate accounting views, not live profitability.
The matched seed-73424 run starts at tick 10200 and ends at 10318. Candidate Scouts leave at
10200 and Lancers at 10218 while that cohort is training; both reports are confirmed through
the executor. The raid returns 850 of each resource with no losses, versus no commands from
the deployed baseline. Both end with identical buildings and troops (19 Pikemen/8 Shieldmen,
plus the common force), so final stocks differ by exactly that returned loot. Both worlds are
deleted. Raw comparison and current-code broker receipts remain in
`/var/lib/norm-steward-review/runs/20261116T103017Z/raid-training-overlap-comparison.json` and
`sandbox-events.jsonl` in the same private directory. This verifies the overlap path with an
existing force; it does not establish profitable acquisition or full-round live raid throughput.

Construction and recruitment now overlap. The executor keeps one durable in-flight request plus
accepted operations keyed by construction/training building/command lane; each confirms separately.
Legacy accepted pending work migrates into that tracking. Unknown requests still serialize writes,
manual queues and population/resource reservations remain authoritative, and restarts preserve pauses.

After the production opening, build toward Barracks 10, Smithy 5 and Stable 3 through live
prerequisites. Normal recruitment keeps running. The Stable can independently train an initial
30-Lancer force in roughly minute-long batches, while existing scouting/risk checks own dispatch.

Each new defensive cohort is an exact whole-number multiple of 3Pi1Sh:
`ceil(61 / (3*pikemanTicks + shieldmanTicks))` bundles. Barracks 1: 6 Pikemen + 2 Shieldmen,
70 ticks; Barracks 5: 9 + 3, 81 ticks. Both parts enter the queue, then no new Barracks recruitment
is added until the cohort drains. Complete-cohort funding/population is checked before starting;
the journalled complement receives priority over discretionary new spending. Existing force ratios
do not change the new cohort's 3:1 mix. Construction can finish or accelerate training alongside it.

Walls compare their full marginal static defence, including base/flat/multiplier and home/support
units, with buying more 3Pi1Sh at the current wall. Require at least 10% better defence per resource
for every attack type. This avoids a fixed Wall/army ratio. Away troops are excluded; attacking
Rams and combat outcomes remain unmodelled by this static comparison.

A matched 1800-tick owner-only comparison at seed 73430 started with identical ordinary paid
setup (producers 7/7/7, Hall 5, Barracks 1, Smithy 2, starter 10/5/10 troops). Baseline 99bc3b0
finished at Barracks 1/Wall 0 and 152 Pikemen/50 Shieldmen. The parallel prototype finished at
Barracks 7/Wall 7 with 138/46, demonstrating overlapping queues and reinvestment in military
infrastructure. It spent 17,490 on recruitment versus 19,435, including queued work. It retained
producers 11/11/7 versus 7/7/7, so this is not a controlled combat or equal-production comparison.
That prototype corrected the initial force ratio in its first cohort; final policy instead always
uses exact new 3:1 bundles, verified separately with the current controller and tests. Raw reports:
`/var/lib/norm-steward-review/owner-parallel-military-20261116/` and
`/var/lib/norm-steward-review/owner-parallel-batch-final-20261116/`. All created worlds are cleaned
up. Reproduce with `STEWARD_BASELINE_COMMIT=99bc3b0 STEWARD_REVIEW_RUN=<private-review-subdirectory> node --import tsx scripts/experiment-parallel-military.ts`; `--batch-only` verifies the final exact-cohort policy in a short candidate run.

Next measure live construction/training overlap, minute-batch utilisation, cavalry unlock costs,
and actual defensive/raid outcomes. Keep producer payback and the level-20 new-upgrade ceiling.

## Active spending policy: recurring 3Pi1Sh (2026-11-16)

After the level-5 producer opening, unlock the first Barracks/defensive Smithy through their
live Hall prerequisites. Preserve the existing starter force, then continuously propose small
3Pi1Sh defensive batches with no fixed total troop cap. Population, resources, external orders,
queued work and round deadline still constrain execution. Scouting and validated raids retain
priority over routine recruitment. Military units are not automatically dispatched by this step.

Discretionary Hall investment drops below repeatable defensive spending once its training path
is unlocked. Producer upgrades below level 20 take priority over recruitment only when their
resource cannot sustain the live mix and less than a two-minute deficit buffer (or one bundle
cost) remains. Existing total-resource payback and round completion gates still apply. Level 20
is an owner-directed strategy ceiling, not a claim of proven economic optimality. Farm keeps
room for another bundle above the normal population buffer, preventing a stall at exact equality.

Matched owner-only server sandboxes, seed 73430, no opponents, start tick 1800 and finish tick
3600. Both paid for identical common setup through ordinary server actions: producers 7/7/7,
Hall 5, Barracks 1, Smithy 2, and 10 Pikemen/5 Shieldmen/10 Raiders. Both used the same evaluation
schedule, one President and the durable journal-before-write executor. The baseline is ccbd86a.

- Baseline: final 10 Pikemen, 5 Shieldmen and 10 Raiders; no policy recruitment spending;
  final producers 16/14/14, Hall 9, Farm 4, Storehouse 6, Cellar 5.
- Candidate: final 152 Pikemen, 50 Shieldmen and 10 Raiders; 19,435 total resources spent on
  policy recruitment (including still-queued work at the cutoff); producers 7/7/7, Hall 5,
  Farm 6, Storehouse 5, Cellar 1.

This demonstrates conversion of income into a growing defensive force and continued population
expansion. It does not establish combat effectiveness, threat adequacy or superiority over retained
future production. The worlds were paused lockstep, so these are 1800 game ticks (30 minutes at
live speed 1); metadata speed 5 did not advance time automatically. Both worlds were deleted.
An earlier invalid fixture attempted Smithy before Hall 5; it was rejected and deleted, then
corrected before the matched comparison. Raw comparison/receipts stay in
`/var/lib/norm-steward-review/owner-spending-policy-20261116/`.
Reproduce with `STEWARD_BASELINE_COMMIT=ccbd86a STEWARD_REVIEW_RUN=<private-review-subdirectory> node --import tsx scripts/experiment-spending-policy.ts`.

The queue serialization limitation of this first spending version is superseded by the active
queue policy above. Army sizing remains an
explicit 3:1 spending policy, not yet a model of actual nearby threats.

## Owner priority update: production-first opening and smaller Cellar (2026-11-16)

Cellar now targets one minute (60 ticks) of the fastest resource production, per resource,
independent of inventory. Producers below level 5 score 83–85, above Cellar/Hall/starter military
and below necessary Farm/Storehouse capacity. Existing live affordability, prerequisites, round
completion and total-resource payback gates still apply. At level 5 ordinary producer priorities
resume. The Hall's projected pipeline follows the same opening and protection policy.

Matched server-hosted private worlds, seed 73430, no house bots, identical initial resources
(1000 each), existing Hall/Farm/Storehouse 1 and producers 1: the deployed 0c01fe6 baseline reached
all producers >=5 at tick 397 and >=7 at 777. Candidate reached them at 196 and 735. At the first
milestone Cellar was 5 versus 0; at the second it was 6 versus 1. Candidate's second-milestone
Lumberyard/Quarry/Mine were 9/9/7 versus baseline 8/8/7. Milestone spending differs because the
assets differ; this is not a claim of equal inventories or long-run/combat superiority.

Both complete controllers used the same event-boundary evaluation schedule and ordinary actions
through the President and durable executor. Worlds were paused lockstep (metadata speed 5);
reported durations are ticks, equivalent to seconds in the live speed-1 world. No opponents or
threats were tested. Both worlds were deleted. Raw receipts and comparison live outside Git in
`/var/lib/norm-steward-review/owner-opening-policy-20261116/`. Reproduce with
`STEWARD_BASELINE_COMMIT=0c01fe6fe89e4b5c9e243f19e25eeacc35f38faa STEWARD_REVIEW_RUN=<private-review-subdirectory> node --import tsx scripts/experiment-opening-policy.ts`.
The separate production-only feasibility script reaches levels 5/7 in 196/520 ticks; its 520-tick
result is not the new controller's measured milestone.

Historical limitation (superseded by the active spending policy above): military sizing was a starter cap.
With a long productive window remaining, continue producer upgrades that repay before round end;
compare useful military allocation against further growth and measure defended losses/raid return.
Do not justify expensive force acquisition using tests that start with a free prebuilt army.

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

## Risk-gated raid execution (implementation verified; wrapper activation pending)

The candidate collects full scouting detail only for a fresh, journal-linked successful report,
checks it against the summary, command, village, owner and account/server/world/epoch scope, and
persists valid intel. A summary alone cannot authorize a raid. Score 71 proposes exactly ten
Raiders only against an unprotected house bot with no observed home/support defenders or wall.
Keep ten Pikemen and five Shieldmen home, reject busy queues/orders/incoming attacks, permit
one combat command globally, and require the intel to remain at most 300 ticks old on arrival.
The round must leave the full return trip plus 60 ticks. A server simulation using `fromReport`
must predict zero losses, at least 60 loot and a twofold attack/defense margin at the current tick.
The executor revalidates state and map/intel/assessment before submission; map reads and immutable
report-based simulations are reused only within the same account/world/epoch and exact tick.
Historical intel still cannot
guarantee arrival conditions.

The existing President and executor journal the exact command before writing, consume the report
on accepted or observably uncertain sends, retain IDs for safe retries, and reconcile matching
battle reports across paused restarts. A report authorizes one raid; each origin waits 600 ticks
between attempts. Changed troops/commands suppress uncertain replay; expired uncertainty pauses
execution. The gameplay pause is preserved. This candidate adds no other executor.

`scripts/experiment-raids.ts --compare` uses managed owner-only worlds and the existing trusted
read-only evidence helper for maps, full reports and non-mutating report-based simulations. The
Warden scenario is deliberately a negative case: full intel reveals substantial defenders and a
wall, and ten Raiders are predicted to die. The private unsafe alternative is tested separately
from the policy comparison. The favorable real-server dispatch, returned loot and recovery are
now verified by the matched cleared-hamlet comparison below. The house-bot experiments establish
rejection of unsafe targets; unit fixtures cover the house-bot dispatch and recovery path.

The first comparison attempt exposed a fixture error: hardcoded 120-tick alignment left the real
public map older than the 30-tick limit, so the candidate correctly skipped detail use and the
experiment's assertion failed. The script now aligns using live `SCORING.publicSnapshotTicks` and
retains the returned map in the artifact. The corrected pair passed: both policies bought Storehouse
2 at tick 5100 for 76 timber, 63 stone and 51 iron and were observed at tick 5160. The candidate
retrieved full intel, rejected the dangerous raid and preserved pause across restart. A separate
unsafe private attack actually lost all ten Raiders, agreeing with the server prediction. This
negative comparison establishes rejection and its opportunity cost, not a profitable raid.

`scripts/experiment-raids.ts --favorable` constructs identical defended origins against a Reaver,
times real scouting arrivals to authoritative public snapshots, and compares the first President
decision and equal-tick outcome. Additional origin defenses are explicit test setup, not candidate
military purchases. The script requires actual zero-loss loot, paused restart confirmation and
lost-response suppression before it passes. Failed fixtures retain their per-action errors in
private run artifacts; they do not authorize activation.

The Reaver continuation exposed a reconnaissance constraint before any policy raid: two Scouts
were removed by repeated enemy scouting, while the origin's combat troops survived. A larger
private origin force reached tick 7330 with 90 Pikemen, 15 Shieldmen, 20 Raiders and 18 Scouts.
Its two-Scout attack at tick 7500 failed, so it supplied no usable full intel. The attempted
report-based simulation returned HTTP 400; the experiment now retains failed report detail before
attempting simulation and skips that invalid request. This is a reproducible negative scouting
result, not a profitable raid.

The Scout-clearing continuation succeeded: a larger reconnaissance command arrived one tick
before the two-Scout observation at tick 7500. Both observation Scouts survived and full intel
revealed Wall 6, 99 Pikemen, three Raiders and four Lancers. This rejects the fixture's assumption
that clearing Scouts exposes an undefended Reaver; the raid risk gate must remain intact.
Another ordinary-action fixture funded and trained 200 additional Raiders, but Workshop 1 failed
with `REQUIREMENTS_NOT_MET` because the live server requires Smithy 10. No siege or favorable
policy raid occurred. `--favorable --siege` now reads Workshop prerequisites from live rules,
funds shared economic setup, and raises Cellar protection for that production. Its corrected siege
path remains unverified. The actual tick-7841 state and authoritative durations put even its
optimistic full use horizon at tick 11229, beyond the 10800-tick round, before resource/population
waits. Do not rerun that 200-Raider fixture unchanged. Next test fresh scouting of a Sovereign's
newly acquired outpost as a different controlled target for the same pinned raid task. Preserve
the risk gate and require actual favorable dispatch, returned loot and recovery before activation.

The Sovereign outpost continuation also rejected an apparently weak public target. At tick 6149,
full scouting found Wall 2 and 24 Pikemen; the authoritative prediction killed all ten Raiders.
Enemy scouting removed the observation Scouts before the next outpost could be inspected. A separate
ordinary-action clearing fixture reached tick 7667 with a smaller siege force. Its tick-7999 win
cost 28 Raiders, two Rams, six Trebuchets and five Scouts, took 128 of each resource, and left Wall 2.
It did not establish a favorable raid target. Its second wave incorrectly reused original troop
counts and was rejected; the reproducer now uses observed survivors and preserves ten Raiders and
two Scouts. Do not repeat this expensive clearing setup unchanged. The saved raid candidate remains
unactivated until a genuine favorable President dispatch, returned loot and recovery pass. A matched
Sovereign outpost comparison is available with `scripts/experiment-raids.ts --compare --sovereign`;
it uses real map ownership and aligns scouting arrival to tick 6500, without changing intel dates.

The matched Sovereign pair passed at ticks 6600–6660 with equal initial buildings, resources,
population and units. Both policies spent 76 timber, 63 stone and 51 iron on Storehouse 2. Full
candidate intel showed Wall 3 and 24 Pikemen, so no raid was proposed; pause survived restart.
A separate unsafe private attack lost all ten Raiders, agreeing with the server prediction. All
four worlds created in this continuation were deleted. This verifies another dangerous-target
rejection, not the still-missing favorable dispatch, returned loot or raid recovery.

The next clearing continuation now sizes the force before buying it. Authoritative simulations of
real outpost intelligence showed that twelve Trebuchets leave Barracks 2, and sixteen leave
Barracks 1. A separate explicit historical server scenario predicts forty Raiders, eight Rams and
twenty Trebuchets remove Wall 3 and Barracks 5, losing two Raiders and one Trebuchet. This is a
fixture-sizing result, not fresh raid authorization or a measured profitable policy action.
`experiment-raid-plan.ts --outpost` collects the observation; `experiment-raid-budget.ts` reproduces
the smaller historical scenario. `experiment-raids.ts --favorable --planned --candidate-only`
continues the ordinary-action fixture while preserving every raid gate. A complete matched
baseline comparison remains required. Run managed experiments sequentially: concurrent broker
calls exposed a registry temporary-file collision; the failed world was deleted and the sequential
retry succeeded. Full-intel collections now reject scalar/array values instead of treating them
as empty troop collections.

The next earlier fixture reached tick 5,250 with production built first, but the Sovereign still
owned only its capital. Both simulated clearing forces were unsuitable: the smaller lost and the
larger left Wall 5 with substantial casualties. An overlapping-queue continuation prepared eighty
Raiders, eight Rams and twenty Trebuchets at tick 6,709. Fresh tick-6,900 scouting found a different
acquired outpost with Wall 4, Barracks 6 and 24 Pikemen. Its authoritative clearing prediction left
both buildings at level 1, so the fixture rejected the attack and deleted the world. The older
Wall-3/Barracks-5 observation is insufficient to size future clearing purchases.

Eight explicit historical server simulations of this new observation found that forty Raiders,
twelve Rams and twenty-four Trebuchets clear the observed buildings, losing two Raiders, one Ram
and one Trebuchet. The four additional Rams and Trebuchets would cost 2,440 timber, 2,400 stone and
1,240 iron and take 340 Workshop ticks from the prepared state. This does not predict future
building levels, guarantee arrival conditions or demonstrate a profitable raid. Reproduce sizing
with `scripts/experiment-raid-frontier.ts` using the run's retained rejected observation.

`scripts/experiment-raid-window.ts` now preserves this smaller-Raider alternative, fresh prediction
checks, shared storage headroom before measuring returned loot, and a candidate-only probe option.
Run its candidate probe before spending on a matched pair; revalidate actual outpost strength before
any clearing action. A favorable President dispatch, credited returned loot, lost-response recovery
and a matched baseline comparison are still required. Do not activate the raid candidate from these
negative clearing experiments or historical sizing results.

The next ordinary clearing attack confirmed why those predictions are historical: tick-7200
intel predicted Wall 4 and Barracks 6 would fall, but the tick-8100 battle encountered 47 Pikemen
and 19 Shieldmen instead of 24 Pikemen. It won while losing fourteen Raiders, three Scouts,
four Rams and eight Trebuchets, leaving Wall 1 and Barracks 3. No policy raid followed.
The window fixture now sends immediately after its prediction, selects the lowest-point acquired
outpost from a current public snapshot, accepts `--seed=73422`, and uses observed home Scouts
instead of assuming ten remain after enemy reconnaissance. A three-seed public geography survey
is reproduced by `scripts/experiment-raid-distance.ts`; geography alone establishes no hidden
strength. `--baseline-from=<same-run completed candidate JSON>` can complete a matched comparison
without repeating a successful candidate probe; it still checks equal starting state and ticks.

The corrected seed-73422 fixture reached the newly acquired Marshhaven and sent immediately at
tick 7500. The report-based prediction cleared Wall 3 and Barracks 3 against 28 Pikemen, but the
tick-7981 battle met 57 Pikemen and 26 Shieldmen with Wall 4 and Barracks 5. It lost twenty Raiders,
four Scouts, six Rams and twelve Trebuchets, leaving Wall 2 and Barracks 2. The predicted favorable
clearing state did not occur, so the President was never asked to raid. Do not repeat this siege
purchase unchanged or treat an even larger historical clearing prediction as arrival evidence.
The next fixture must control or divert the Sovereign's reinforcements through ordinary private
actions before clearing, or demonstrate an already undefended target; rescout before policy use.
Favorable dispatch, credited loot, recovery and the matched policy comparison remain unverified.

The raid candidate now also requires per-resource storage room for its predicted returned loot
plus production over the entire round trip, using current live rates and no assumed intervening
spending. Exact capacity is allowed; one milli-resource of overflow rejects the proposal. This
prevents an apparently profitable raid whose return would be discarded at storage capacity.
This guard does not establish favorable combat or authorize activation by itself.

The seed-73422 simultaneous capital diversion was tested through ordinary private actions. A
20-Pikeman/one-Ram threat to the capital at tick 7500 did not prevent reinforcement of Marshhaven:
the tick-7981 clearing battle met 59 Pikemen and 23 Shieldmen, lost 19 Raiders, four Scouts, six
Rams and eleven Trebuchets, and left Wall 2 and Barracks 1. No policy raid followed. The saved
`--multi-diversion` variant threatens every other owned village and retains the managed action
log around the attack so reinforcement behavior can be distinguished from local recruitment.
`--early-conquest` preserves a smaller ten-Ram/ten-Trebuchet fixture that starts looking for the
first acquired outpost as soon as its force is ready. Neither option changes the policy's risk
gates; require actual favorable dispatch, credited return, recovery and matched baseline results.

The all-village diversion reduced the tick-7981 garrison to 56 Pikemen and 13 Shieldmen. The
ordinary clearing attack lost thirteen Raiders, three Scouts, four Rams and eight Trebuchets,
destroyed Barracks 5, and left Wall 1. The managed action log shows outgoing support at tick 7505,
then recalls at ticks 7890 and 7925 as the shorter diversion battles finish, as well as local
Pikeman recruitment. Thus a simultaneous dispatch does not keep all diversion threats active
until the more distant clearing arrival. The revised saved variant adds three clearing Rams
while preserving the tick-7500 dispatch; this remains fixture setup, not a policy purchase.
A future timing fixture should keep the other threats active through clearing arrival and
avoid unnecessary snapshot alignment before non-policy clearing reconnaissance.

The revised fifteen-Ram clearing wave succeeded at tick 7981: Wall 4 and Barracks 5 both fell
to zero, with thirteen Raiders, three Scouts, five Rams and eight Trebuchets lost. This establishes
a real cleared state, but not a useful raid window. By the next ordinary two-Scout observation,
the target had rebuilt Wall 4 and Barracks 6 and had 49 Pikemen home. The current return/build/
rescout sequence therefore cannot authorize a raid. Do not repeat this fixture with more siege
alone: the next controlled case must address rebuilding and arrival-time exposure, or use a
materially different naturally undefended target. Favorable execution, returned raid loot,
recovery and a matched baseline remain unverified; activation stays disabled.

A materially different continuation adds a conditional cleared-hamlet path: thirty already-owned
Lancers can raid a neutral target after our authoritative victory and fresh two-Scout observation.
The controller collects the account's own victory detail in the current world/epoch scope; a public
map or scouting alone cannot establish the militia reset. The live MAP militia rules are projected
through Lancer arrival, rounded upward, and sent as explicit baseDefense to the authoritative
report-based simulator. The assessment must match this arrival bound at the exact planning tick.
Zero predicted losses, the twofold margin, at least sixty loot, home defensive complement, storage
headroom, round deadline, one combat command and durable recovery requirements still apply.
Neutral scouting retains the same distance and deadline checks. No Lancer recruitment or siege
purchase is automated. Reproduce with `node --import tsx scripts/experiment-raid-hamlet.ts`.
Its common ordinary setup includes costly clearing troops; returned raid loot alone cannot establish
payback of those setup purchases or the usefulness of buying this force live.

The completed matched run is recorded in
`/var/lib/norm-steward-review/runs/20261116T053017Z/raid-hamlet-comparison.json`.
Both policies started with identical buildings, stocks, population and units at tick 8100, planned
with world status running while the private clock was paused, and were observed at tick 8159.
The President selected thirty already-owned Lancers for the candidate. The authoritative battle
lost none and returned 850 timber, 850 stone and 850 iron, confirmed from home stocks after
subtracting production. The baseline instead upgraded Mine 7 to 8 for 362 timber, 313 stone and
338 iron, retaining that productive asset. The comparison measures one allocation decision,
not long-term superiority over the economic investment.

Journal-before-write, accepted-command confirmation after a paused restart, and suppression of
replay after a deliberately lost successful response all passed. Both managed worlds were deleted;
their receipts match the current advisor/executor fingerprint. Typecheck, all 166 tests, the web
build and the experiment's separate TypeScript check passed. The saved implementation is ready
for wrapper publication and activation; gameplay's persisted execution preference was unchanged.
The common initial clearing lost nine Lancers and three Rams. This result supports conditional
use of an existing force and cleared target, and does not justify purchasing that setup live.

## Repeatable raid economics (implementation verified; wrapper activation pending)

Cleared neutral targets use a 120-tick retry interval. Fresh reconnaissance is allowed after a
neutral report has been durably consumed, and newer own victory reports retain the latest militia
reset instead of reloading an older victory. House-bot retries remain 600 ticks. Each raid still
requires a new full intelligence report, a current authoritative arrival-defense assessment, zero
predicted losses, home defence, storage headroom and the existing President/durable executor.
This step buys no forces or prerequisites and preserves the gameplay execution preference.

Reproduce with `node --import tsx scripts/experiment-repeatable-raids.ts` in the managed review
environment. It reconstructs the exact deployed baseline at
cd1f087715e6596e016bd927e4b1367963f78a82 into private run artifacts. Both policies plan with status
running while their private clocks are paused, receive the same 100-tick evaluations plus Scout
arrival evaluations, and finish at the same tick. `--coarse` reproduces the older sparse schedule,
which missed Scout-arrival map freshness windows and did not verify repeat raiding.

The corrected matched pair ran from tick 8100 to 10000. The candidate completed four raids against
the commonly cleared neutral target; the baseline completed one. Each used a distinct journalled
intelligence report. Actual raids lost zero troops, all commands returned, and a paused candidate
restart preserved the pause and continued without duplicate raids. Candidate raid loot was 3400
of each resource versus 850 for the baseline. Both owner-only worlds were deleted; broker receipts
match the tested advisor/executor fingerprint. Typecheck, all 169 tests, web build, experiment
TypeScript check and diff check passed.

Economic costs remain explicit. Candidate policy spend was 3700 timber, 4017 stone and 3122 iron,
versus baseline spend of 6003/6354/5193. Candidate home stocks finished higher by
4013.883/4964/1611.088, partly because it invested less. Retained production differed by
-839.117 timber, +77 stone and -3009.912 iron. Final candidate/baseline Lumberyard levels were
12/13, Mine 9/11 and Cellar 8/9; final timber production was 10.015/11.668 per tick and iron
6.334/8.597. These observations support the repeated-loot capability, while whole-economy
profitability and the value of future output remain unproven. Stocks do not refund building costs.

Common clearing returned 595 of each resource and lost nine Lancers and three Rams, with
replacement costs of 1920 timber, 1650 stone and 2730 iron. Candidate clearing-plus-raid loot
exceeded those casualty replacement costs by 2075/2345/1265; the baseline remained short by
475/205/1285. Full troop acquisition cost 11825/10200/17655 and was not repaid: candidate
clearing-plus-raid loot remained short by 7830/6205/13660. Acquisition and replacement losses
are separate views and must not be charged twice. Surviving troops and buildings remain assets.
This comparison supports conditional use of existing forces and a cleared target, without
justifying live acquisition of this expensive fixture or establishing live target availability.

## Full-round raid opportunity costs and round-bounded storage

The completed matched comparison ran the deployed repeat-raid controller and a priority-59
reconnaissance prototype from tick 8100 through round end at 10800, continuing ordinary economic
decisions. Lower scouting priority completed one raid versus four, returning 2550 less of each
resource. Earlier production increased retained timber/iron output, but final stocks differed by
-2654.615 timber, -4984.020 stone and +230.980 iron. This tradeoff does not support automatic
activation of that prototype. Scout dispatch retains score 72. Reproduce the isolated rejected
prototype with `scripts/experiment-full-round-raids.ts`, which snapshots the deployed controller
at `b584d621302cb75862db1578ed13939a6b5707a7` and changes its scouting priority explicitly.
The common expensive force and cleared target do not establish profitable live acquisition.

The comparison also exposed Storehouse spending at tick 10700 based on production extending
200 ticks beyond round end. The Economic Advisor now uses the smaller of 300 ticks and the
remaining round time for Storehouse need, priority and explanation. It keeps exact-capacity
equality, the normal full-horizon policy, completion checks, President allocation and durable
executor. Dashboard three-/five-minute forecasts retain their descriptive horizons. Raid loot
headroom remains separately checked by the raid policy.

`scripts/experiment-round-storage.ts` compares the deployed controller with the current candidate
in matched owner-only 1300- and 1600-tick rounds. Both plan as running while the private clock is
paused, and use the President and journal-before-write executor. From tick 1200, the short case
retained 76 timber, 63 stone and 51 iron by avoiding the Storehouse, without overflow. In the
longer case both policies built Storehouse 2 and finished with identical stocks. Accepted construction
was confirmed through the durable executor; every world was deleted. Raw results
and receipts stay outside Git.


## Reconnaissance requires a usable follow-up raid window

Scout dispatch now checks both its own return deadline and the earliest follow-up combat
round trip after the scouting report arrives, using live Scout and Raider/Lancer speeds and
the existing 60-tick raid margin. Exact equality remains usable. This only filters reconnaissance
that cannot lead to a timely raid; priorities, force purchases, intelligence requirements and
the President's durable executor remain the same.

Run `scripts/experiment-raid-generalization.ts --prepare-deadline`, then `--deadline-case`
sequentially in the managed review environment for the narrow deadline comparison. Run
`--seeds=73422` for another full-round existing-force comparison. Both controllers plan with
running status while the owner-only clocks are paused. The harness records setup and force
acquisition, clearing losses, policy spending, actual loot, retained production and final assets
separately. These costly common fixtures cannot establish profitable live force acquisition.


The matched seed-73424 boundary pair starts at tick 10200 in a 10296-tick round. Scouts
need 18 ticks outbound; Lancers need 20 each way. The old Scout-only return check permits
a dispatch, but a follow-up raid with the existing margin would require tick 10318. The
baseline sent one Scout pair and completed no raids; the candidate sent none. Both ended
with identical assets and stocks and retained 448.032 of each resource from production.
This verifies one avoided command, with no measured resource or combat gain. Common force
acquisition cost 11825/10200/17655 and clearing casualties cost 1920/1650/2730 to replace;
these are separate accounting views, and the fixture does not justify live acquisition.
The additional seed-73422 comparison now runs through tick 10800 from matched tick-8100
assets. Deployed `e346af8` completed no raids, spent 12077/10753/5178 on policy actions and
ended with Barracks 10, Wall 7 and 136 Pikemen/14 Shieldmen. Older `eecb7c7` completed four
zero-loss raids returning 3400 of each resource, spent 5126/5206/4073 and ended with higher
production and 10 Pikemen/5 Shieldmen. Common force acquisition was 11825/10200/17655;
clearing replacement losses were 1920/1650/2730, not an additional acquisition charge.
These controllers differ across multiple spending policies. The 100-tick polling schedule
also lets short recruitment parts finish between decisions, so it cannot establish live
one-second cohort utilisation or isolate a command-guard effect. Use the focused training
overlap pair for that guard; measure representative cadence separately. Raw results are in
`/var/lib/norm-steward-review/runs/20261116T103017Z/raid-generalization-comparison.json`.
All broker operations ran sequentially.
