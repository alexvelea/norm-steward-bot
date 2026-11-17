# Current strategy and implementation work


## Current policy: staged growth, no starter quotas, sustainable military budget

Owner direction on 2026-11-16 supersedes the historical Barracks-10 rush and starter-force
policies below. All-producer milestones mean Lumberyard/Quarry/Mine, not Cellar/Storehouse/Farm.
Reach 5 first; use need-based capacity/protection while growing to 8; then Hall toward 5 and
producers toward 10. At producer minimum 10, establish Barracks 3 and Smithy 1, then directly
queue minute-long 3Pi1Sh cohorts. There are no 10-Pikeman, 5-Shieldman or 10-Raider prerequisites
or a separate Raider recruitment path. Historical scripts import archived baselines explicitly.

Recruit only when each resource's full-time troop demand consumes at most 80% of its gross
production, and the full cohort is currently funded. Reserve at least 20% income for construction.
This is a transparent initial planning allowance, not optimised economic theory. Use net income
after the training reserve for production coverage, resource funding waits and storage forecasting;
retain gross marginal production for payback gains and the lifetime production ledger. Display
phase, target/reserved troop burn and net construction income in the advisor view.

Do not confuse a remaining stockpile with sustainable troop income. Build deficient production
when the sustained mix cannot be funded. Further military technology must support its intended
training throughput, rather than consume the money needed for current troops. Existing accepted
work remains tracked; existing higher building levels are not undone. Keep the producer-20 ceiling,
round-end payback, population buffer, one President, parallel server queues and durable retries.

A matched fresh-world comparison uses the pre-change 61d2d2a policy and the phased candidate,
seed 73430, no house bots, identical 1000/1000/1000 initial stocks and ordinary server actions.
The 2400-tick prototype comparison reached all producers >=10 at tick 1218 versus 1954
for the baseline. It finished at 87 Pikemen/28 Shieldmen, Barracks 3 and producers 12/12/10,
versus baseline 19 Pikemen/8 Shieldmen/10 Raiders, Barracks 8 and producers 12/11/10.
Net stock and retained assets differ; this is a peaceful flow comparison, not combat validation.
The final implementation additionally exposes the net budget and uses it for storage projections.
The comparison verifies every candidate troop submission starts after all three
producers reach 10, with exact 3:1 cohort metadata and no Raider submissions. Private receipts:
`/var/lib/norm-steward-review/owner-phased-economy-20261116/`. Reproduce with
`STEWARD_BASELINE_COMMIT=61d2d2a STEWARD_REVIEW_RUN=<private-review-subdirectory> node --import tsx scripts/experiment-phased-economy.ts`.

Next reviews should measure full-round delivered troops, production and retained assets, resource
spending shares and idle queues under this policy. Old experiments starting at producer 7 are now
intentionally in the economy-only stage; do not call that recruitment starvation. Seed military
throughput tests at producer >=10 with income sufficient for the live Barracks speed and the
construction allowance. Threat response, opportunity cost and the 20% allowance remain to evaluate.

## Hybrid opening and gameplay-led research (2026-11-16 owner direction)

Keep sustainable 3Pi1Sh recruitment from producer minimum 10. Delay discretionary Walls until
Lumberyard, Quarry and Iron Mine each reach 13; then retain the existing garrison/value, funding,
queue and round-time checks. This is a construction opportunity-cost gate, not an emergency
threat-response policy. It does not cancel previously accepted construction.

The owner's matched two-hour peaceful comparisons found that removing Walls at the existing
military start preserved 627 versus 637 infantry while increasing production by 16.5%. Delaying
military to producer 13 instead reached 485 infantry and another 10.4% production gain. These
measurements motivated retaining the earlier army while delaying fortification. They do not prove
survival against an attacker. The new hybrid was deployed with owner approval after matched
first-hour private evidence under rules version 3; the owner waived the remaining two-hour comparison.
Both policies began training at tick 1441 (24:01). The baseline first submitted a Wall at tick 1728
(28:48), with producers 12/11/10; the hybrid waited until tick 3142 (52:22), with producers 15/14/13.
These verify the gate, not full-round economic superiority or combat survival. Remaining simulation
was stopped and all registered private worlds deleted. Do not restart the waived comparison.
Historical version-2 outcome numbers above are context, not directly comparable to version 3.
Raw owner evidence: `/var/lib/norm-steward-review/experiments/army-no-walls-comparison-20261116T175413Z/`.

Reviews should ask a gameplay question, state a hypothesis, compare representative timelines,
and explain the tradeoff before editing policy. Long simulations now run in a persistent private
experiment worker outside the 15-minute Codex budget. A negative result can complete research;
implementation tasks remain subject to exact tested-code evidence, checks and deployment gates.
Next measure: observe the approved hybrid in the next live world, including production, delivered
troops, Wall timing, spending and building-queue occupancy. Later test threats and the upstream training-speed changes only
after live rules actually expose them. The verified Farm deadline candidate below is ready for wrapper activation.

## Sandbox-tested expansion proposal (2026-11-16)

The owner requested a transition after at least 150 Pikemen and producer minimum 15: pause
routine production investment, push Hall 13, Barracks 10, Smithy 10, Market 5 and Court, and take
an unowned town using Raiders plus one Envoy. A paid seed-73430 rules-v3 private prototype
succeeded at tick 6656 (110:56), preserving 153 Pikemen/51 Shieldmen at home. It trained 140
Raiders alongside infrastructure; one Envoy made four successful attacks, with loyalty regen
requiring the fourth. Conquest consumed the Envoy; 108 Raiders remained as support at the new town.

No additional producer upgrades were needed after 15/15/15. Funding gaps of 209 and 22 ticks
were handled by saving; the producer fallback was unit-checked but not exercised in this case.
This is a scripted sandbox extension, **not a deployed conquest advisor**. The existing live
advisor list has not changed. Detailed timing, costs, Hall-speed accounting, limits and reproduction
are in [the conquest experiment](experiments/conquest-opening.md). Preserve this evidence when
designing an integrated phase; do not infer combat safety or optimal thresholds from one peaceful seed.

## Verified recruitment-Farm deadline (2026-11-17)

The pinned `saved-farm-deadline` candidate has passed its exact-source worker comparison
and late-round regression. A Farm bought solely for
recruitment must leave time for the full minute-long 3Pi1Sh cohort and 60 useful ticks,
including its live construction funding/cooldown boundary and existing Barracks work.
The old check allowed only one 3:1 bundle, even when the cohort contains multiple bundles.
Basic population-buffer expansion remains independent of this recruitment-only gate.

A fresh matched owner-only regression against deployed hybrid `2ec95b6`, under rules v3,
starts at tick 10696 of 10800 with 54 free population slots and an already-paid training
queue. The full President/executor bought Farm 3 in the baseline, spending 76 timber /
68 stone / 51 iron and occupying construction for 16 ticks. The candidate bought nothing
and finished with exactly those additional stocks; both delivered 17 Pikemen. Production
was identical; the baseline instead retained 42 additional population capacity. Both
preserved a paused restart and both worlds were deleted. This measures avoided unusable
recruitment capacity, not combat value or a whole-economy gain. Reproduce with
`STEWARD_BASELINE_COMMIT=2ec95b6 node --import tsx scripts/experiment-recruitment-farm-window.ts`
in a managed review run. Results, receipts and the assessment are under
`/var/lib/norm-steward-review/runs/20261116T230021Z/`. Earlier prototype evidence remains
under `runs/20261116T173021Z`; its interrupted fresh-world prefixes are not completed comparisons.

The completed matched worker job is
`/var/lib/norm-steward-review/experiments/jobs/20261116T230158Z-c3ddc0/comparison.json`:
seed 73430, no enemies, 7200 ticks with 600-tick checkpoints in a standard 10800-tick world.
All 13 checkpoints match. Both finish with 526 Pikemen / 174 Shieldmen, producers 19/18/17,
Farm 13 and Wall 12; production and exact final stocks match. Each spends 155837 resources
on non-Wall construction, 9815 on Walls and 73455 on training. Construction occupies 6010
ticks and is idle for 1190; paid Barracks queues occupy 4722 ticks. All 219 policy actions
succeed in each world, and both worlds are deleted. Current policy source matches the worker
fingerprint; worker and fresh live rules are version 3. Required checks pass (200 tests).

The opening result is neutral. Combined with the late-round saving of 195 resources and
16 otherwise unusable construction ticks, it supports this narrow guard, not a whole-round
economic or survival gain. Baseline's additional 42 population capacity is the measured
tradeoff; the candidate's freed construction time stays idle. The preserved implementation
is ready for wrapper activation; deployment and gameplay pause remain wrapper responsibilities.
Assessment and reproducible receipt/source audit:
`/var/lib/norm-steward-review/runs/20261117T000021Z/farm-deadline-assessment.json`.

Next research should explain the 1037 Barracks-idle ticks after training first starts at
tick 1441, separating population, funding and executor cadence before selecting an intervention.
Compare any resulting candidate over a matched full round; do not count the opening's
1441 economy-only ticks as recruitment starvation or infer combat benefit from peaceful evidence.

## Scouting during paid construction (2026-11-16)

Scouts already at home may travel while construction and recruitment continue, provided every
paid construction item has a valid completion tick at or before Scout arrival. Standing orders
still defer dispatch. Raids retain their empty-construction-queue check and revalidate current
production/storage before spending intelligence. This uses the existing President and durable
executor; it adds no troop purchases or starter quotas.

The matched seed-73421 comparison used producers 11/10/10, Barracks 5, Smithy 5 and an existing
paid force (the live Stable prerequisite chain requires these higher military levels). Full-time
3Pi1Sh left 26.8%/32.2%/44.8% timber/stone/iron income for construction. Both worlds had the same
paid Storehouse upgrade and 6-Pikeman/2-Shieldman queue. With one-second decisions until dispatch, the candidate
dispatched at tick 6600 and received a successful report at 6728; baseline waited until 6610 and
received its report at 6738. Policy action spending was zero for both. Final resources, buildings,
population and troops were identical. Both preserved a paused restart and reconciled their reports.
All three worlds, including the initial fixture correction, were deleted.

Reproduce with `node --import tsx scripts/experiment-scout-construction.ts` in a managed review run.
The default baseline is `82bce40`; `STEWARD_BASELINE_COMMIT` can select it explicitly. Raw results,
current-code broker receipts and the initial fixture's failed comparison are under
`/var/lib/norm-steward-review/runs/20261116T160016Z/`. This establishes ten ticks less command/report
latency with existing forces. It does not measure combat gain or full-round allocation; the latter
remains the next measurement under the phased economy.

Older experiments and superseded policies are preserved in [Strategy history](strategy-history.md).
