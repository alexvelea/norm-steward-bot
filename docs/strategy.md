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

## Priority: create useful military capability

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
