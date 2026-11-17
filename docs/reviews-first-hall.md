# First strategic review: Hall pipeline cutoff

> Historical experiment commands marked `retired-harness:` are archival evidence, not executable commands. Use the single-version sandbox runner documented in docs/reviews.md for new runs.

Observed 2026-11-15, Blitz round 7: Hall 6, lumberyard 19, quarry/mine 18, 5,194 round ticks
remaining, 25k/23k/15k stock, no troops/training, two incoming attacks. The retained activity had
104 entries and no per-action failures. Recent reports included 21 defensive losses out of 26.
That makes defence/recruitment the next priority; pure growth gains are not military outcomes.

The reproducible sandbox trace exposes the cutoff directly: at tick 2,517 of 7,200, the old
planner examined only 721 ticks of work across eight upgrades. Hall-first took 709 ticks, a
12-tick saving below its 20-tick margin, despite 4,683 round ticks remaining. The fixed action-count
cutoff hid much of the remaining productive pipeline. This is an actual sandbox decision; the live
observation above had an in-flight Mine upgrade and was not treated as an actionable empty queue.

The revised policy examines up to 24 useful upgrades over at most 7,200 ticks, always capped by
remaining round time. It still compares the exact same useful work with and without one Hall
upgrade, charges the Hall's own resources/time, uses exact rounded live tables, waits per resource,
and keeps the existing uncertainty margin. Projected population/storage/prerequisites are checked
after hypothetical capacity upgrades rather than being blocked by stale next-level options.
Near-term incoming attacks defer Hall spending. Actual newly enabled buildings are explained,
without inventing military value when no recruitment plan exists. No Hall-to-Mine level target.

## Reproducible private-sandbox comparison

```bash
STEWARD_BENCHMARK_BASE=96cabfa node --import tsx retired-harness:benchmark-hall.ts
```

This reads the existing owner's private connection, creates owner-only seeded sandboxes and deletes
each in finally. It cannot target a live world for writes. Baseline Hall code is loaded directly
from Git commit 96cabfa, not reimplemented. Both branches use the same President/Economic Advisor
apart from the Hall policy. Seed 73421, no house bots, fresh stock/levels, 7,200- and 1,800-tick rounds.
The private lockstep clock stays paused between decisions, but planning status is set to running
for **both** policies so the Hall's running-round guard is exercised as in gameplay. Actual server
construction/actions/queues/resources and clock steps decide the outcomes; no engine is copied here.
The script polls asynchronous step completion. There is no claim of combat validation.

| Scenario | Policy | Hall | Lumberyard / Quarry / Mine | Final total production/min | Points |
|---|---|---:|---|---:|---:|
| 7,200 ticks | Previous | 7 | 21 / 20 / 20 | 6,453.34 | 4,340 |
| 7,200 ticks | Revised | 12 | 23 / 22 / 19 | 7,741.48 | 5,546 |
| 1,800 ticks | Previous | 1 | 12 / 12 / 11 | 1,717.60 | 776 |
| 1,800 ticks | Revised | 1 | 12 / 12 / 11 | 1,717.60 | 776 |

Measured: +19.96% final production rate and +27.79% points in the two-hour growth scenario. The
revised branch spent more and retained less stock; one resource producer ended a level lower.
The short scenario had no Hall overinvestment or outcome regression. Unit scenarios also cover
late-round rejection, individual resource starvation, Hall costs, action cadence, population/storage
feasibility and an imminent attack. These results justify activation as a growth improvement, not
a guarantee under raids or evidence of optimality across every seed.

Raw input/output, exact live rules, action traces and server logs are private in
`/var/lib/norm-steward-review/first/benchmark/`. Initial observation is in first/evidence. The durable
first report and operational backlog are outside Git. Subsequent reviews must measure round-scoped
Hall spend and construction/resource waits, production, storage overflow and battle losses. Distinguish
round resets and attacks from policy effects. Add military infrastructure/recruitment through central
President allocation; do not claim existing army automation where none exists.
