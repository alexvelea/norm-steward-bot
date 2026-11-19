# Unit stats and continuous recruitment budget

Balance reference: upstream server d4fadb0 (production 80/14, halved base build/train times, speedBase 0.94 and milli-tick training). These are recruitment costs, not recruitment-building construction costs. This is a local snapshot, not a fresh live-world verification.

## Level-1 training and resource demand

All times below are game ticks, equivalent to seconds in a speed-1 world. The baseline assumes the recruitment building is level 1, with no training speed bonus. Some units require a higher building level to unlock: their level-1 figures are a comparison baseline, not a recruitable configuration.

For one building training only this unit continuously:

- Units/minute = `60 / training ticks`.
- Each resource/minute = `unit resource cost × 60 / training ticks`.
- Total cost = timber + stone + iron; total/minute sums those three flows.
- At world speed `s`, real seconds/unit = `ticks / s` and real-minute resource demand is multiplied by `s`.

| Unit | Building | Base seconds/unit | Timber/unit | Stone/unit | Iron/unit | Total/unit | Units/min | Timber/min | Stone/min | Iron/min | Total/min |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Pikeman | Barracks | 4 | 45 | 35 | 15 | 95 | 15 | 675 | 525 | 225 | 1,425 |
| Shieldman | Barracks | 5.5 | 35 | 30 | 65 | 130 | 10.91 | 381.82 | 327.27 | 709.09 | 1,418.18 |
| Raider | Barracks | 5 | 55 | 35 | 45 | 135 | 12 | 660 | 420 | 540 | 1,620 |
| Archer | Barracks | 6.5 | 90 | 40 | 55 | 185 | 9.23 | 830.77 | 369.23 | 507.69 | 1,707.69 |
| Scout | Stable | 3.5 | 45 | 55 | 25 | 125 | 17.14 | 771.43 | 942.86 | 428.57 | 2,142.86 |
| Lancer | Stable | 7 | 120 | 110 | 240 | 470 | 8.57 | 1,028.57 | 942.86 | 2,057.14 | 4,028.57 |
| Knight | Stable | 14 | 210 | 160 | 580 | 950 | 4.29 | 900 | 685.71 | 2,485.71 | 4,071.43 |
| Ram | Workshop | 17.5 | 280 | 220 | 190 | 690 | 3.43 | 960 | 754.29 | 651.43 | 2,365.71 |
| Trebuchet | Workshop | 27.5 | 330 | 380 | 120 | 830 | 2.18 | 720 | 829.09 | 261.82 | 1,810.91 |
| Envoy | Court | 75 | 6,000 | 7,500 | 6,500 | 20,000 | 0.8 | 4,800 | 6,000 | 5,200 | 16,000 |
| 3Pi1Sh (3 Pikemen + 1 Shieldman) | Barracks | 17.5 | 170 | 135 | 110 | 415 | 3.43 | 582.86 | 462.86 | 377.14 | 1,422.86 |

“3Pi1Sh” is a planning bundle of **3 Pikemen + 1 Shieldman**, not an actual game unit. One level-1 Barracks trains the four troops sequentially in `3 × 4 + 5.5 = 17.5` ticks. Its Units/min column means **bundles/minute** (13.71 individual troops/minute); each bundle uses 4 population. Shieldmen require Smithy 1.

Envoy costs above assume **one owned village**. The server multiplies each resource cost by the number of owned villages when the batch is queued; multiply its resource-demand columns by that count. Training time does not receive that cost multiplier.

Rates are long-run averages, rounded to two decimals. Units complete discretely; “10.91 units/min” does not mean a fractional unit is trained.

## Combat, population, travel and unlocks

Defence columns correspond to the attacker’s infantry/cavalry/ranged type. Travel is ticks per map field: smaller is faster. Carry is the total loot capacity per unit. Smithy 0 means no unit-specific Smithy requirement; recruitment buildings have their own construction prerequisites.

| Unit | Pop | Attack | Attack type | Def vs infantry | Def vs cavalry | Def vs ranged | Travel ticks/field | Carry | Required building level | Required Smithy |
|---|---:|---:|---|---:|---:|---:|---:|---:|---|---:|
| Pikeman | 1 | 10 | infantry | 20 | 45 | 15 | 18 | 25 | Barracks 1 | 0 |
| Shieldman | 1 | 22 | infantry | 50 | 20 | 40 | 22 | 15 | Barracks 1 | 1 |
| Raider | 1 | 42 | infantry | 8 | 5 | 8 | 18 | 12 | Barracks 1 | 2 |
| Archer | 1 | 18 | ranged | 45 | 35 | 10 | 18 | 10 | Barracks 5 | 5 |
| Scout | 2 | 0 | cavalry | 2 | 2 | 2 | 9 | 0 | Stable 1 | 0 |
| Lancer | 4 | 125 | cavalry | 25 | 35 | 25 | 10 | 85 | Stable 3 | 3 |
| Knight | 6 | 160 | cavalry | 190 | 90 | 170 | 11 | 50 | Stable 10 | 10 |
| Ram | 5 | 2 | infantry | 20 | 45 | 20 | 30 | 0 | Workshop 1 | 0 |
| Trebuchet | 8 | 90 | infantry | 100 | 50 | 100 | 30 | 0 | Workshop 2 | 5 |
| Envoy | 40 | 30 | infantry | 100 | 50 | 100 | 30 | 0 | Court 1 | 0 |
| 3Pi1Sh (3 Pikemen + 1 Shieldman) | 4 | 52 | infantry | 110 | 155 | 85 | 22 | 90 | Barracks 1 | 1 |

Bundle combat values and carrying capacity sum its members; travel uses the slowest member. These raw totals do not account for walls or other battle modifiers.

## Higher-level buildings and actual available throughput

Live training rule: `ticks = max(1, round(baseTrainTime × 1000 × 0.94^(max(1, buildingLevel) − 1))) / 1000`. Round to integer milli-ticks first, then calculate resource demand. The authoritative current-village value is `options.train[].ticksEach` in `/state`; use its `cost` too, especially for Envoys. Fractional `nextTick` and `endTick` retain the same units (ticks). The engine carries fractional completion times across units and batches; completed units appear on the integer tick that processes them. A unit's speed locks at its start.

Units that cannot train at level 1 have these earliest-unlock training rates:

| Unit | Minimum recruitment building | Seconds/unit there | Total resources/min there |
|---|---|---:|---:|
| Archer | Barracks 5 | 5.075 | 2187.19 |
| Lancer | Stable 3 | 6.185 | 4559.42 |
| Knight | Stable 10 | 8.022 | 7105.46 |
| Trebuchet | Workshop 2 | 25.850 | 1926.50 |

## Using this for an economy budget

A level-1 Barracks continuously producing **Raiders** needs **660 timber + 420 stone + 540 iron per minute**, or **1,620 resources/minute total**, and creates twelve population worth of troops per minute. Having 1,620 total production is insufficient if iron production is below 540/minute.

At **Barracks 5**, a Raider takes **3.904 ticks**, so continuous recruitment needs **845.29 timber + 537.91 stone + 691.60 iron/minute**, total **2074.80/minute**, and 15.37 population/minute. Faster training increases the sustained resource requirement.

For a mix in the **same building**, weight resource flows by the fraction of training time assigned to each unit; do not add two full-time rows. For desired unit counts, calculate total cost divided by total training time instead. For **different buildings** running simultaneously (for example Barracks and Stable), add their resource flows.

Budget surplus production separately for buildings, other recruitment queues and replacements. These rates exclude unlock/building costs and losses. Stockpiles can fund a temporary deficit; approximate its duration as `stock / (recruitment demand − production)` per resource, taking the earliest positive deficit to run out.

Continuous recruitment also consumes population capacity: allow for Farm expansion and its resource/construction cost. Current server queue limits, prerequisites, action cooldowns, batch affordability and rounded training times still apply; these are ideal uninterrupted throughput budgets, not a promise of indefinite execution.

## Recruitment cohorts

For the illustrative 3Pi1Sh mix, `ceil(61 / bundle training ticks)` bundles cover just over one game minute. At Barracks 1 that is **12 Pikemen + 4 Shieldmen in 70.000 ticks**; at Barracks 3 it is **12 + 4 in 61.848 ticks**; at Barracks 5 it is **15 + 5 in 68.315 ticks**. Round each unit duration to milli-ticks before summing. This mix is a comparison budget, not the current Pikeman-only advisor policy: current single-unit batches use `min(deficit, ceil(61 / live ticksEach), trainBatchMax, maxCount)` and drain before another batch starts.

## Refreshing the numbers

Fetch the authenticated live `/rules` response, read `rules.UNITS` and `rules.TRAINING`, and apply the formulas above. No account key belongs in this document. Confirm current costs/times from the village’s `/state` training options before issuing orders.
