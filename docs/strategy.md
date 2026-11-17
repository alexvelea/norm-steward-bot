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
after live rules actually expose them. The Farm deadline guard below is deployed. Population-runway
research and the Farm runway implementation review are complete; the unchanged tested policy is
ready for wrapper activation. Gameplay execution preference remains unchanged.

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

The `saved-farm-deadline` guard was deployed as `3977d0d` after its exact-source worker comparison
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
succeed in each world, and both worlds are deleted. The deployed guard matched the worker
fingerprint; worker and fresh live rules were version 3. Required checks passed (200 tests).

The opening result is neutral. Combined with the late-round saving of 195 resources and
16 otherwise unusable construction ticks, it supports this narrow guard, not a whole-round
economic or survival gain. Baseline's additional 42 population capacity is the measured
tradeoff; the candidate's freed construction time stays idle. The guard is deployed;
gameplay pause remains unchanged.
Assessment and reproducible receipt/source audit:
`/var/lib/norm-steward-review/runs/20261117T000021Z/farm-deadline-assessment.json`.

## Completed recruitment population runway research (2026-11-17)

Research task: `hybrid-recruitment-idle-economics`. An owner-only server replay of all 219
paid actions matched the previous experiment at all 13 checkpoints through tick 7200.
After recruitment starts at 1441, the 1037 idle ticks comprise 848 population-blocked ticks,
184 funding-only ticks and 5 ready-but-not-yet-executed ticks. Population and funding overlap
for 55 of the 848 ticks; these categories prioritize population and do not promise that all
848 ticks can be recovered. The initial 1441 economy-only ticks are excluded.

Long producer and Wall builds sometimes occupy construction before a Farm becomes necessary.
For example, Lumberyard 19 runs 6464–6672; Barracks becomes population-blocked at 6510,
and Farm 13 only finishes at 6770. This suggests anticipating capacity before committing
construction time, rather than tightening a cadence responsible for only five ticks here.
Further funding protection addresses a smaller measured cause and competes with growth.

The saved candidate offers a Farm through the existing President when its selected build
plus a subsequent Farm would exhaust population reserved for future whole cohorts. It uses
live build durations, paid training completion and population already booked by accepted work;
it preserves sustainable income, external-order and whole-cohort/use-deadline checks.
Earlier Farm spending and queue use can delay production and fortification. More troops also
consume resources. The candidate is **ready for wrapper activation**, with deployment still owned
by the wrapper.

A matched paid-prefix test at ticks 4266–4866 supports the mechanism: candidate delivers
89 infantry versus 67, with zero Barracks idle ticks versus 151. Final production matches;
retained timber production is 5.7 lower. Training spends 2490 additional resources, Farm
finishes at 11 versus 10, Storehouse at 7 versus 8, and Wall 10 starts 56 ticks later.
Both worlds are deleted. This ten-minute result cannot establish full-round superiority.

The completed matched peaceful worker comparison against deployed `3977d0d` supports the
continuous-defence hypothesis: seed 73430, rules v3, a full 10800-tick private round and 19
600-tick checkpoints. Both start training at 1441; the candidate never trails in delivered
infantry at a checkpoint. Server action costs and queue intervals give these final results:

| Metric | Baseline | Earlier Farm candidate |
|---|---:|---:|
| Delivered Pikemen / Shieldmen | 900 / 300 | 999 / 333 |
| Barracks busy ticks | 8100 | 8991 |
| Barracks idle ticks after training starts | 1259 | 368 |
| Construction busy / idle ticks | 8322 / 2478 | 8299 / 2501 |
| Training resource spend | 124500 | 138195 |
| Non-Wall construction / Wall spend | 193904 / 20289 | 193175 / 20289 |
| Final stock total | 250847 | 203400 |
| Retained production total | 586542.1 | 552060.4 |
| Final production total per game minute | 4830.8 | 4789.9 |
| Final Farm / Wall / Storehouse | 15 / 15 / 18 | 16 / 15 / 17 |

The 11% extra infantry costs 5.9% retained production and 18.9% final stocks; final production
is 0.85% lower. Final timber/stone production falls 14.2% each while iron rises 35.7%; resource
totals do not imply equal strategic value. Retained production is final milli-stocks plus paid
spending minus initial stocks, excluding overflow; it is separate from army and buildings.
Idle time includes the final recruitment/use-window tail, and is not a full-round attribution
of population blockers. The initial 1441 economy-only ticks are excluded from Barracks idle.

The first Wall submission moves from 3142 to 3413; at minute 60, Walls are 6 versus 3, though
both finish at 15. All producers reach 15 at 5507 versus 6400, a 893-tick delay relevant to
the owner's future expansion phase. Both tested policies continue defensive recruitment and
omit that phase. Earlier Farms support the measured continuous-defence objective; conquest
needs a matched comparison of its own. No survival or combat benefit was measured.

Research is complete with `supports-change`. Gameplay delivery review
(`farm-runway-gameplay-delivery`) verified the unchanged President/executor integration and added
regressions for journal-before-write, paused restart/reconciliation, fresh external orders,
income/population changes and per-action rejection. The implementation is ready for wrapper
activation; no reviewer live writes or preference changes are needed. The current policy
fingerprint exactly matches the tested candidate; policy edits require another comparison.
Next compare the owner-requested conquest transition, including the 893-tick delay in producer-15
readiness. It has greater strategic scope and a successful peaceful capture prototype. Extra
funding protection has less measured upside (184 funding-only ticks in the prior two-hour replay)
and competes with growth; defer it behind conquest research.
All 313 baseline and 334 candidate actions succeeded; both worlds were deleted. Source,
receipt and fresh-rules audits, per-resource accounting and checkpoints:
`/var/lib/norm-steward-review/runs/20261117T020001Z/farm-runway-full-round-assessment.json`.
Worker evidence:
`/var/lib/norm-steward-review/experiments/jobs/20261117T003859Z-ad4d13/comparison.json`.
Earlier bottleneck attribution and the focused mechanism test remain under
`/var/lib/norm-steward-review/runs/20261117T003007Z/`.

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
