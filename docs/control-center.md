# Personal control center: first iteration

This process is a client of the existing game. It contains no authoritative simulation, game clock, game account
store or game persistence. The private file is local client configuration and execution bookkeeping.
No LLM, model key, prompt or inference service participates in economic decisions.

## Current phased economy and recruitment policy

The three producer levels (Lumberyard, Quarry, Iron Mine) define the stages; Farm, Cellar and
Storehouse do not have forced level milestones. This section supersedes earlier experimental
military targets described later in this document.

1. Bring all three producers to 5. Defer Cellar and military investment; necessary population or
   storage capacity remains allowed.
2. Grow them toward 8, expanding Storehouse only for projected overflow and Cellar only for one
   minute of gross production. No initial troop quotas.
3. Once all three reach 8, bring Great Hall toward 5; continue producers to 10.
4. At all three producers >=10, unlock Barracks 3 and Smithy 1. Start direct whole 3Pi1Sh cohorts
   when income sustains them with construction headroom. No preliminary 10 Pikemen, 5 Shieldmen
   or 10 Raiders; no automatic Raider recruitment or Raider-specific Smithy unlock.

For each resource, full-time training demand must be <=80% of gross production: at least 20%
of income remains for construction. One full cohort must also be affordable and fit the population
reserve. This headroom is an explicit initial policy setting, not a proven optimum. At Barracks 3,
one 3Pi1Sh takes 31 ticks and the queued cohort is 6 Pikemen + 2 Shieldmen over 62 ticks.

The advisor page shows phase, gross income/min, target troop burn/min, reserved burn/min and net
income left for construction. Producer coverage forecasts and Storehouse forecasts use income
remaining after reserved training. Producer payback uses that net income for funding waits but
keeps the actual gross marginal output for the upgrade's return; soldier spending does not make a
producer magically less productive. The total-production ledger remains gross.

If sustainable funding is missing, the resource producers needed to restore it outrank routine
recruitment. Recruitment waits rather than spending down a stockpile on an unsustainable flow.
Accepted cohort complements still finish safely. Existing buildings and troops are preserved;
this policy only changes new proposals. New producer upgrades retain the level-20 policy ceiling
and round-end payback test. Farm retains its capacity/bundle population policy.

Stable/cavalry development requires income for both the defensive mix and cavalry with the same
construction allowance. Finite cavalry recruitment remains independently bounded; movement risk
checks are separate from training quotas. Historical starter policies live only under
`scripts/legacy-advisors/` for reproducible old experiments, never in the live council.

## Advisor contract and President

`src/advisors/types.ts` defines a small synchronous interface: evaluate live state and rules, return
proposals. Each proposal names its advisor, village, action, target level, importance (0–100),
reason, per-resource requirements, blockers, affordability tick, and ready/waiting/queued/not-needed status.
The Economic and Military Advisors are registered with the same President.
The President is a sorted filter, not a planner. It submits at most one build, training batch or bounded scouting command per one-second cycle.
The single executor journals one in-flight write at a time and tracks accepted operations in independent
per-village construction and per-training-building queues. Construction, Barracks and Stable work
can overlap. Each occupied queue is excluded from normal allocation until its work completes.

Scouting and risk-checked raids can use troops already at home while recruitment continues.
Queued troops never count toward a dispatch or its home garrison. Scouts may also travel during
already-paid construction when every queued item has a valid end tick at or before Scout arrival. Standing orders still defer dispatch. Raids wait for an empty
construction queue and fresh production/storage state before checking loot headroom. The President
allocates commands through the same durable executor and command lane.

The Economic Advisor considers Great Hall, lumberyard, quarry, mine, storehouse, cellar and farm.
The server's build options determine cost, prerequisites, affordability and next level. The live
rules tables determine hall time savings (excluding the hall upgrade itself and maxed buildings); no game rule is changed in this repository.

Scores are deterministic integers:

| Candidate | Importance policy |
|---|---|
| Farm | 100 if no free population, otherwise 95 **only** below max(50, 20% of capacity); sufficient buffer = not-needed (20) |
| Storehouse | 90–99 **only** if current stock + production over min(300, remaining round ticks) exceeds capacity for any resource; otherwise not-needed (25) |
| Cellar | 80 **only** if protection per resource is below the largest 60-tick production amount (one minute); otherwise not-needed (25) |
| First Barracks | 79 when unlocked and usable, below capacity/protection and ahead of discretionary Hall/production investment (ties prefer Barracks); no further military levels |
| First defensive Smithy | 77 after ten owned Pikemen, with existing Hall/Barracks prerequisites and enough current resources and population for Smithy 1 plus the remaining complement of at most five Shieldmen; no resource reservation |
| Sustained 3Pi1Sh | 70 after the starter force; repeat 3 Pikemen / 1 Shieldman by owned+away+queued counts, no fixed army cap; affordable small batches only |
| Military Hall unlock | 79 for currently affordable steps to the live first Barracks / defensive Smithy Hall prerequisite after the opening |
| Great Hall | At most 69 once the 3Pi1Sh training path is unlocked; otherwise 70–79 only when Hall-first finishes the same useful upgrade sequence sooner after resource costs/waits and a safety margin; otherwise not-needed (30) |
| Resource producer | Below level 5: 85 minus production rank (83–85), ahead of Cellar/Hall/starter military but below necessary capacity. From level 5: 60/50/40 by coverage; 80–82 for a recruitment-resource shortage; no producer upgrades beyond level 20 |

90–100 = capacity, 70–89 = opening production/protection/construction speed/military spending, 40–69 = production. Lower scores are
informational and never executed. Not-needed proposals remain visible at the bottom. Ties use
village ID then building ID. Population used includes reserved construction and training.

For each resource, producer coverage is `(current inventory + production over 180 ticks) / sum of
that resource's costs for the next lumberyard, quarry and mine upgrades`. Maxed producers are
excluded from the cost basket. The lowest coverage wins, so an apparently abundant resource can
still be most scarce relative to what production upgrades actually consume. Rates use live
per-tick milli-resource values; these horizons are game time (ticks), not browser wall time.
The displayed 3-/5-minute capacity forecasts ignore speculative future spending or uncompleted
production upgrades. The Hall comparison below separately estimates a bounded sequence.
Equality at a capacity target does not trigger an upgrade.

## Great Hall payback

`src/advisors/hall.ts` makes a bounded client-side projection: at most 24 useful upgrades within
7,200 game ticks, capped by the remaining round time. It does not submit or persist a build plan.
First construct a baseline sequence using the existing priorities: required farm/storage/cellar,
then the producer with the lowest projected supply/cost coverage. Recompute costs and coverage
after each hypothetical completion; do not assume three levels of every producer will be built.

Compare that exact sequence with building **one** Hall level first. Both paths start from live
per-resource stock and production. They wait for each individual resource, spend costs at the
start, cap accumulated stock at storage, update production only on completion, and account for
population, prerequisites, capacity upgrades and Council action intervals. The first next-level
cost/population requirement comes from live options; future levels and durations use live tables.
Hall-first includes its own build duration and resource cost, including delays that cost causes
for subsequent upgrades. Production multipliers observed in live state are held constant.

Recommend the Hall only if the net completion-time saving is at least the largest of **20 ticks,
10% of the Hall's build duration, and 2% of baseline completion time**. The margin avoids acting on
small estimates and polling jitter. A positive comparison receives 70–79 based on the percentage
of baseline time saved; urgent farm/storage and required protection still outrank it. The reason
shows the sequence, both completion times, resource waits and net saving. An infeasible Hall path,
maxed-out economy, short round horizon or resource starvation does not create a Hall recommendation.
Existing construction/standing orders defer the comparison until they finish. Incoming attacks
within 300 ticks defer Hall spending. The projected path rechecks resource, population, storage
and building prerequisites at each step instead of reusing stale next-level blockers after a
hypothetical capacity upgrade. Next-level Hall-gated unlocks are listed when other requirements
are already met; they get no arbitrary bonus without a concrete military plan.

This is a short-term estimate, not an engine or a search for the global optimum. It compares the
same work to make the opportunity cost explicit; resource changes can cause the real sequence to
change on the next evaluation. Other villages, future troop orders, trades, attacks, new bonuses
and exact executor polling delays are not projected. The single authoritative executor still
refreshes and reranks against live state before every write; it never blindly executes this sequence.

## Total production

The service persists estimated gross production for the current account/server/world/epoch.
It starts with the earliest available server history sample, then integrates live aggregate village
rates between evaluations. Rate changes use the average of adjacent observations. This is an
estimate: historical samples are sparse, downtime can hide rate changes, and overflow is included.
Spending and looting never decrease or inflate this counter. It is not an exact lifetime total or
net inventory change. Repeated observations at the same tick add nothing; restarts preserve totals.
A different account/world/epoch or backwards game clock starts a new ledger. The UI labels the
estimate and its tick range, and shows each village's inventory, projected supply and cost coverage.

## Allocation and waiting

The Military Advisor proposes only Barracks 1 in villages without an existing or queued Barracks,
Stable, Workshop or Court. It uses live build options and prerequisites; impossible prerequisites,
storage bills, or population requirements are not-needed and do not reserve resources. Population
must also leave room for one Pikeman under the live rules. A feasible resource-only wait can reserve
the village budget. Construction must finish with at least 300 ticks remaining for use (or a longer
live Council interval plus one recruit's training duration). The same completion window includes
affordability and Council cooldown. Busy queues, external build orders, cooldown and non-running
worlds prevent submission. Fresh executor revalidation applies both advisors again before writing.
After infrastructure completes, a separate Military Advisor proposal recruits an initial defensive
force: at most five Pikemen per batch toward ten owned per village (home + away + queued). Live
training options determine costs, batch affordability, duration and population. The population
buffer stays at max(50, 20% of capacity), queues stay shallow, external build/training orders prevent
recruitment, and the whole batch must finish at least 60 ticks before round end. Unavailable
recruitment is not-needed and never reserves the economy. No combat improvement is claimed.

After ten Pikemen are owned (home plus away), a separate score-77 proposal can build Smithy 1
when its Hall/Barracks prerequisites already exist. It funds the complete remaining Shieldman
complement from current stock without crediting future income, and preserves max(50, 20% of
capacity) free population after construction and those troops. It skips unavailable infrastructure
or training, caps the complement at five including home/away/queued units, and buys no Hall levels
or Smithy upgrades. Construction and training queues and standing orders defer it. Construction
must leave at least 300 ticks, extended when the Council interval plus full-batch training and
60 ticks for use need longer. Actual recruitment remains a separate fresh President decision;
the durable executor journals and reconciles both actions through its existing build/train paths.

- Affordability is per village. Resources are never pooled or automatically traded.
- Existing construction blocks additional advisor builds in that village. The first iteration keeps
  queues shallow rather than paying in advance for a long speculative plan. Existing queued levels
  are displayed as queued, not proposed again.
- Standing build orders block advisor construction in that village. The operator must choose which
  economic controller to run; this application never silently removes existing orders.
- The highest **needed** proposal in a village owns its budget, including score-40–60 production.
  If it only lacks resources, save until it is affordable; never spend on lower-ranked filler.
  If it has another blocker, wait and show that blocker rather than diverting its budget. Another
  village can still spend independently. This simple policy may stall on an impossible prerequisite
  (for example a producer bill larger than storage even though the five-minute storage target fits);
  it reports the constraint rather than overriding the explicit capacity policy.
- Council cooldown, ended rounds, missing prerequisites and full queues are explicit waiting states.
- Decisions are short-term heuristics, not ROI-optimal planning. Broader troop composition and market exchanges are not modelled yet. Manual orders and other clients can still consume resources.

## Execution and recovery

Only the persistent local Node service evaluates and executes. Browsers poll a read-only snapshot;
refreshing, multiple tabs and closing the browser do not create or stop executors. The loopback
executor lease (port 8790) prevents a second production process from starting, even at another HTTP
port, and is released by the OS after crashes. Do not override this port for another live executor.

Economic execution starts automatically for a fresh valid configuration. Its execution preference
is persisted; service restarts and Settings edits preserve an operator pause.
There is no browser execution toggle or prerequisite acknowledgement. The internal pause API remains
available for diagnostics; authentication failures and an expired uncertain idempotency window pause
submissions and show the actual error. Accepted construction continues in the game.

The persistent executor automatically joins the **selected** running world when `/state` reports
`NOT_IN_WORLD`, including after a round reset, or when state contains zero villages. It does not
join other world IDs, paused/ended worlds, or join while diagnostic execution is paused. The
upstream `/join` endpoint is idempotent: a retry returns existing holdings rather than founding a
second village. Each attempt checks fresh state first, respects rate-limit backoff and records
submission/confirmation in recent decisions. After joining it rereads state/rules; normal epoch
reconciliation discards obsolete pending economic requests before spending. Closing the browser
has no effect on joining. No additional browser executor or join loop is introduced.

Before POST, read state/rules again and rerank. A manual build inserted after the first evaluation
therefore stops or changes the selection. The remote engine remains the final arbiter; another
independent client can still act between revalidation and submission. There is no cross-client
resource reservation or atomic expected-level check in the upstream API.

Journal the exact action/clientId before POST. Never change its ID on an uncertain retry. A fresh
queue or changed level after an uncertain result suppresses replay without falsely claiming which
actor caused it. Expired idempotency windows pause automatic mode; inspect game activity before
resolving uncertain operations. A changed world epoch or account drops stale requests. On a 429,
respect Retry-After; per-action errors inside a 200 are rejected outcomes, not successes.

The history distinguishes recommendation, prepared (request ID journalled), submitted (API attempted), accepted, confirmed, rejected, uncertain,
waiting and cancelled. Accepted means queued. Construction is confirmed when fresh state reached the accepted level after
its queue item disappeared. Training is confirmed when its accepted batch disappears and owned
troops (home plus away) reach the pre-order count plus batch count. Missing troops are recorded as
cancellation/possible losses, not false confirmation. Uncertain training retries retain the exact
count and ID; observed troop or queue changes suppress replay without claiming attribution.
The last 100 decisions and any pending request survive restarts in `control.json` (mode 0600).

## Existing starter bots and operator agent

Stop `npm run bot`, the Python starter and LLM shift runners for this account before automatic mode.
Those independent processes can compete even if the browser is closed. A bot running on another
machine cannot be detected reliably. Current
server standing build orders are detected and block this advisor per village.
Manual gameplay remains available. Its writes use normal API limits and appear in the game's
activity stream; the President revalidates on the next cycle. Ad hoc operator instructions are in
[OPERATOR.md](OPERATOR.md); that agent must not launch another economic loop.

## Site gate and local control credentials

A separate high-entropy site token gates all app pages, static assets, control routes and game
transports. Only the token form is public. The service loads its digest, issues an opaque secure
cookie, and never logs or embeds the token. See README.md for generation, storage and rotation.
This does not change or replace the upstream game API key.

## Local control API and credentials

`POST /control/session` authenticates the configured player key and issues an HttpOnly,
SameSite=Strict session cookie. Settings/key/state endpoints are private. Mutations reject foreign
Origin headers. No key is embedded in assets or ordinary snapshots; Settings reveals it only on
an explicit authenticated POST. Existing browser key storage is preserved for compatibility.
The game proxy uses the configured server/key, including the WebSocket hello, so browser tabs do
not accidentally switch the service's account by forwarding an old Authorization header.

- GET /control/state: masked settings, advisor status, recommendations and journal.
- PUT /control/settings: origin, player key (optional replacement), world; revalidates while preserving the execution preference.
- PUT /control/automatic: enabled boolean; internal diagnostic pause/resume, no browser switch.
- POST /control/evaluate: request a bot cycle; this can execute the configured economic policy.
- POST /control/key: explicitly reveal the saved key to the authenticated operator.
- POST /control/pending/resolve: clear an uncertain request only while paused, after explicitly acknowledging activity-log inspection; resumes the bot without cancelling accepted work.
- POST /control/logout: invalidate this browser session.

Initialize the owner key locally using STEWARD_KEY_FILE or STEWARD_KEY. There is no public signup
or first-visitor claim flow. Local files are trusted operator storage, not encrypted at rest; protect
machine access. Keep credentials, runtime files, browser captures and logs out of Git.

## Production investment payback

Lumberyard, quarry and iron mine upgrades are eligible only if their **additional gross output**
can repay the sum of timber + stone + iron spent by the current world's round-end tick. All three
resource types count as one resource unit each. Existing production does not count as the return
on a new investment. Using live integer milli-resource rates and tables:

`repayment tick = earliest affordable/cooldown start + live build ticks + ceil(total cost × 1000 / additional milli-resources per tick)`

The start includes each resource's shortfall/production wait and any later server affordability or
Council tick. A zero/unknown increment or an unfundable cost does not establish payback. Equality
at round end is allowed. Resource multipliers observed in state are retained when projecting the
next level. Accepted construction is not cancelled; queued work is reevaluated after it finishes.
Fresh executor state is checked again before spending. Rejected investments are `not-needed` with
`NO_PAYBACK_BEFORE_ROUND_END`, so they do not reserve resources or block military proposals.

For example, Lumberyard 1→2 costs 63 + 75 + 50 = 188. Live rates rise from 1.867 to 2.175 timber/tick:
+0.308. Repayment takes 611 earning ticks after the 11-tick Hall-1 build, plus any funding delay.
Six owner-only sandbox cases test the exact old policy against the candidate one tick before,
exactly at, and one tick after the repayment deadline, verifying live cost and rate changes.
Run `scripts/experiment-payback.ts` with STEWARD_REVIEW_RUN pointing to a fresh private run directory.

Hall planning applies the same rule to projected producer upgrades, using projected stocks/rates
and live next-level costs, so it cannot justify a Hall using unprofitable future production work.
Hall itself retains its construction-time payback comparison. Farm, storehouse and cellar retain
their explicit capacity/protection rules: they do not directly generate a resource stream. This is
a gross-production estimate, not a guarantee of retained inventory: overflow, raids, trades, future
bonuses or later upgrades can change actual returns. No speculative future benefits are credited.

The service evaluates live state once per second. Account/world-list metadata is cached for at most
30 seconds; joining forces a refresh. Rules are cached by configuration revision, world, epoch and
rules version, and are fetched again immediately before an action. Idle cycles avoid a redundant
second state read. This stays within the upstream four-per-second dashboard read budget while the
browser polls the local snapshot every second. Rate-limit/error backoff remains in effect.

The bounded scouting readiness policy proposes Stable 1 (73) and up to two owned Scouts (74)
after the defensive complement and ten Raiders exist. It buys no Stable prerequisite levels and
requires current funding for infrastructure plus the entire missing Scout complement, the normal
population buffer and 600 ticks after full training. It shares the same President, queue/order
checks, persisted pause and durable build/train reconciliation. The separate bounded dispatch proposal (72) sends exactly two home Scouts to the nearest eligible
house-bot village within 300 travel ticks. It waits until our protection expires, rejects protected
or human targets, requires the existing defensive/raiding complement, idle queues and no standing
orders or incoming attack, and leaves the round-trip duration plus 60 ticks before round end.
One Scout command may be out globally, and each village waits 600 ticks between attempts.
The President retains capacity, protection and recruitment priorities. No combat troops are sent.

The same executor journals the exact send before POST and tracks the returned command ID until a
matching report or command disappearance. Paused restarts reconcile without sending; uncertain
Scout/command changes suppress replay, and expired uncertain IDs pause execution. Per-action errors
remain rejected decisions. Up to 32 command observations are persisted under account/server/world/
epoch scope. Only a successful attacker scouting summary linked to that command, from our village,
with matching target ownership, age at most 300 ticks and map observation/snapshot ages at most 30
ticks is usable as a historical scouting observation. Future timestamps, different epochs, failed
scouting and ownership changes fail closed. Summaries do not establish hidden troops, resources or
raid profitability; full intelligence collection and raid decisions remain separate work.
Reproduce the matched private executor comparison with scripts/experiment-scout-dispatch.ts.

## Income versus spending policy (2026-11-16)

After the level-5 production opening and existing starter force (10 Pikemen, 5 Shieldmen,
10 Raiders), the President can repeatedly recruit 3Pi1Sh defence. It counts owned, away and queued
units, then queues whole cohorts covering just over 60 ticks of training. There is no fixed total army cap; live affordability, population, queue limits, external
orders and a 60-tick post-completion use window bound recruitment. A rejected/unaffordable batch
never reserves resources. Recruitment itself dispatches no troops.

The economy computes this mix's average resource demand from live training costs and times.
For resource r, low runway means production is below demand AND current stock is less than
`max(one bundle's r cost, 120 × (r demand/tick − r production/tick))`. The corresponding producer
then scores 82 minus its usual coverage rank (80–82). It outranks routine recruitment, provided
its existing total-resource payback test passes and its current level is below 20. Otherwise
available troop spending outranks discretionary producer and Hall investment. Capacity and
Cellar protection, starter unlocks, scouting and validated raids retain their priorities.

The Farm also considers room for the next bundle above the usual free-population buffer, with
time left to construct and use it. This avoids stopping exactly at the reserve. The small Hall
unlock chain reaches only live Barracks/defensive Smithy prerequisites after the opening; it is
not an unrestricted military technology planner. Hall's projected producer sequence excludes
levels beyond the same producer ceiling.

Level 20 is an explicit owner-directed policy ceiling, not a proven mathematical optimum.
This iteration does not estimate the marginal combat value of another bundle versus a producer.
The executor now supports independent accepted queues; see the concurrency/cohort policy below.

## Parallel queues, military buildings and minute-long cohorts

One authoritative process remains. `pending` journals the single prepared/submitted/uncertain
network write; `active` durably records accepted queue items and commands until confirmed.
Legacy accepted `pending` entries migrate on reconciliation. Each operation is reconciled and
cleared separately, so a construction failure/restart cannot erase accepted training. Revalidation,
account/world/epoch scoping, request IDs and operator pauses apply to all tracked operations.
Known accepted costs are already deducted from live stocks; every new submission refreshes state.
The President skips candidates blocked by an occupied queue so other queues can use their budget.
Unknown requests still serialize further writes until safely resolved. Normal construction remains
one queued build per village, normal training one cohort per facility, and combat one command
lane globally. This is concurrency of server work, not concurrent duplicate network writers.

The military construction path is Barracks 3 -> Smithy 1, with later Stable prerequisites only when sustainable. It follows live missing
prerequisites one affordable step at a time, scores 76 and leaves 600 ticks after construction.
Existing Scout readiness funds Stable 1 and its Scouts; development then extends it to Stable 3.
The existing production opening, resource-deficit policy, capacity and population constraints remain. The scarce-resource candidate retains one complete next minute-long cohort’s funding for each resource whose production is below defensive training demand before allowing military development. This applies after the starter force, including while Barracks training is active, only with population and round time to use another cohort. It releases construction when the step and cohort are both funded; production upgrades remain eligible through the President. Manual training orders bypass this automatic recruitment buffer. A feasible unfunded sustained cohort is a resource-only waiting proposal, allowing the President to save at score 70 ahead of discretionary production. Full-cohort affordability, training and 60 ticks of use must fit before round end; zero income, storage, population, manual orders and hard server blockers release that reservation. Deficient income, capacity, protection and valuable Walls retain their higher scores.
Stable 3 enables minute-sized Lancer batches toward a first force of 30 owned/queued (score 72),
including away troops; no new movement policy is introduced. Barracks training does not block
Stable recruitment or construction. The initial Lancer cap remains deliberately bounded.

For 3Pi1Sh, `bundles = ceil(61 / (3*pikemanTicks + shieldmanTicks))`. A balanced Barracks 1 queues
6 Pikemen + 2 Shieldmen (70 ticks); Barracks 5 queues 9 + 3 (81 ticks). Each cohort contains exactly three Pikemen per Shieldman. The complete cohort must fit current funding and the
population buffer before starting. Its plan is journalled with the first request. The second unit
component uses that recorded plan and gets score 100 to reserve its funding before discretionary
spending. After both are queued, no further Barracks recruitment is proposed until the cohort
drains. A crash/unknown response retains request IDs; un-attributable changes suppress replay.
Final short cavalry batches may take under a minute when approaching the 30-unit limit.

If a pause or service downtime lets the Pikeman component finish before its Shieldmen are
queued, confirmation also saves the outstanding complement independently of the completed
operation. It retains the original cohort counts across paused reconciliation and restarts.
A persisted operator pause still requires an explicit resume before spending. The complement returns through the President with
the usual funding, population, manual-order and round-end checks; an unrelated Barracks queue
must drain first. Queued or owned Shieldmen satisfy the remembered target. Changed account,
server, world or epoch, a lost village, a finished round, or losses below the completed Pikeman
target discard this memory; it never authorizes replacement Pikemen.

Walls are ineligible until **all three resource producers reach level 13**. Recruitment remains
eligible from producer minimum 10, subject to sustainable income and prerequisites. After that gate,
Walls score 84 only when their marginal defence per resource is at least 1.10 times a new
3Pi1Sh for **every** attack type. Live wall flat/base/multiplier rules and actual home plus supporting
troops determine the gain; away troops are excluded. This static efficiency test includes base
defence, needs enough time to finish plus 120 ticks of use, and makes no claim about attacking
Rams or actual battle outcomes. It permits useful Wall growth without a fixed Wall/army ratio.
