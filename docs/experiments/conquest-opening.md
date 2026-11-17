# First unowned-town conquest: rules v3

> Historical experiment commands marked `retired-harness:` are archival evidence, not executable commands. Use the single-version sandbox runner documented in docs/reviews.md for new runs.

Status: **successful private sandbox prototype, not a deployed conquest advisor**.
Run: 2026-11-16, seed 73430, zero house bots, fresh 1000/1000/1000 stocks, normal paid actions,
10800-tick round. The private clock was paused between steps. Times below are game minutes:seconds.
The production bot and its execution preference were unchanged.

## Tested strategy

Run the deployed hybrid Controller until at least 150 Pikemen are home. Finish already-paid
construction and training; retain the resulting 153 Pikemen/51 Shieldmen. Pause further defensive
cohorts and discretionary Walls for this controlled test. Bring Lumberyard/Quarry/Mine to 15.
Then follow Hall 13 → Barracks 10 → Smithy 10 → Market 5 → Court 1, following actual live prerequisites.
Train the Raider escort once Barracks 10/Smithy 2 are available, overlapping the remaining construction.
Train one Envoy at the Court. Keep necessary Farm and Storehouse expansion available.

During the military push, do not buy routine producer upgrades. For a funding shortage, compare
waiting with an affordable producer upgrade, including its resource bill, construction time and
new live production rate. Buy it only if it advances funding of the next desired bill. This is a
short-term funding heuristic, not a full future-pipeline optimizer. None were justified in this run.
The two funding waits after the all-15 milestone were 209 and 22 ticks.

The first phase uses the current Controller/President. The conquest extension is a **scripted
experimental plan**, journaling stable IDs through the owned-world broker. It is not integrated into
the live President and does not claim to validate production automation, threat response or restarts
of a future conquest advisor. No live account actions were submitted by this experiment.

## Observed milestones

| Game time | Outcome |
|---|---|
| 53:28 | First observed 150 Pikemen threshold |
| 54:13 | Already-paid work drained: 153 Pikemen, 51 Shieldmen retained |
| 60:12 | All three resource producers reached 15 |
| 68:52 | Hall 13 completed |
| 73:46 | Barracks 10 completed |
| 79:21 | 140 Raiders queued, while the Smithy/Court path continued |
| 88:41 | Raider batch completed |
| 90:11 | Smithy 10 completed |
| 93:14 | Market 5 completed |
| 98:31 | Court completed |
| 101:01 | One Envoy completed; conquest force ready |
| 110:56 | Nearby unowned town captured; 108 Raiders survived |

The origin remained at producers 15/15/15, Hall 13, Barracks 10, Smithy 10, Market 5, Court 1,
Farm 11, Storehouse 5, Cellar 4 and Wall 2. Its 153 Pikemen/51 Shieldmen stayed home throughout.
The captured town had Hall 1, producers 2/2/4, Farm 2, Storehouse 4 and Wall 3. The surviving Raiders
were stationed there as support from the origin; they were not new home-owned units in that town.

## Militia, Envoy survival and loyalty

Select the nearest unowned target and recheck ownership before every dispatch. This fixture had
no enemy players/support. Select the escort using the real server simulator against maximum hamlet
militia and maximum possible hamlet Wall (3), not the assumption that an unowned town is defenceless.
The tested limit was at most 20% Raider casualties and survival of the sole Envoy in the first attack.
The smallest tested multiple of 20 meeting that limit was 140 Raiders.

| Attack arrival | Loyalty before → after | Raider losses | Envoy |
|---|---|---:|---|
| 102:26 | 100 → 66 | 26 | Returned |
| 105:16 | 67 → 33 | 2 | Returned |
| 108:06 | 35 → 1 | 2 | Returned |
| 110:56 | 2 → 0 | 2 | Consumed by conquest |

One surviving Envoy removes 34 loyalty. Regeneration between trips meant three attacks were
insufficient; the fourth captured the town. Three Envoys in one successful attack could remove 102
at once, but would cost more and were not tested here. Raiders clear the defence; they cannot
capture a village without Envoys. One Envoy can be reused until a successful conquest consumes it.

## Spending and throughput

Paid **after the defensive transition**, including catching the producers up to 15:

| Category | Total timber + stone + iron |
|---|---:|
| Producer catch-up to 15 | 13,185 |
| Hall 6–13 | 15,692 |
| Barracks 4–10 | 14,304 |
| Smithy 2–10 | 21,726 |
| Market 1–5 | 2,511 |
| Court | 10,000 |
| Additional Farm/Storehouse | 5,150 |
| 140 Raiders | 18,900 |
| One Envoy | 20,000 |
| **Total** | **121,468** |

Per-resource totals: 44,113 timber / 40,284 stone / 37,071 iron. This excludes the normal opening
that produced the retained defensive army. Buildings and surviving troops remain assets; this is
not a casualty-only cost or a demonstrated economic payback from the captured low-level village.

The observed Barracks-10 Raider batch took 560 ticks: **4 seconds per Raider**. Continuous Raider
training at that level requires **825 timber / 525 stone / 675 iron per minute**. Producers at 15
provide approximately 950 per resource/minute. That funds the stream, but leaves relatively little
timber income for construction; the experiment funded a bounded escort using stocks as well.

Hall 11–13 cost 9,315 resources and 262 construction ticks. Live rounded time tables show 245 ticks
saved on the subsequently built chain compared with holding Hall at 10. This is construction-time-only
accounting, not a matched Hall-10 strategy simulation: funding and future building decisions would
also differ. Hall 13 was feasible, but its superiority for the first capture is unproven. Additional
future construction can benefit from the retained speed.

## Reproduce and inspect

Requires this machine's configured game connection and sandbox permissions. Coordinate with
scheduled experiments so the account's two private-world slots and API limits are respected.
Use a fresh private run directory; never point the script at a live world:

The specialized fixture was retired. For current full-policy runs use
`npm run sandbox -- --ref <git-ref> --hours 1 --seed 73430`; see [reviews](../reviews.md).


The script creates its own owner-only world and deletes it in `finally`. Logs preserve partial
progress on interruption. `result.json` includes initial/final state, live rules, all accepted actions,
phase milestones, funding waits/upgrades, the escort simulation and actual battle reports. Existing
checkpoints cover the Controller opening; milestones cover the scripted extension. This stops on
confirmed ownership, not after an arbitrary two-hour interval. No engine code or free-asset injection
is used.

Original private evidence: `/var/lib/norm-steward-review/owner-conquest-opening/`. The initial runner
fixture correction is retained separately at `owner-conquest-opening-fixture-fix/`; its world was
also deleted. Ordinary checks cover prerequisite sequencing, exact loyalty-regeneration boundaries,
Envoy survival and whether a producer purchase improves funding time.

Next implementation work would put this phase behind the existing President and durable executor,
with per-village/round state, fresh target/intelligence checks, resource reservations, deadline checks
for the complete capture sequence, and pause/retry/reconciliation tests. One peaceful seed proves
feasibility, not safety against another player's army or optimal Hall/escort/phase thresholds.
