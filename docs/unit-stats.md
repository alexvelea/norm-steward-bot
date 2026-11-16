# Unit stats and continuous recruitment budget

Verified against the selected live world’s `/api/v1/worlds/{worldId}/rules` on **2026-11-16**, rules version **2**. These are recruitment costs, not recruitment-building construction costs.

## Level-1 training and resource demand

All times below are game ticks, equivalent to seconds in a speed-1 world. The baseline assumes the recruitment building is level 1, with no training speed bonus. Some units require a higher building level to unlock: their level-1 figures are a comparison baseline, not a recruitable configuration.

For one building training only this unit continuously:

- Units/minute = `60 / training ticks`.
- Each resource/minute = `unit resource cost × 60 / training ticks`.
- Total cost = timber + stone + iron; total/minute sums those three flows.
- At world speed `s`, real seconds/unit = `ticks / s` and real-minute resource demand is multiplied by `s`.

| Unit | Building | Base seconds/unit | Timber/unit | Stone/unit | Iron/unit | Total/unit | Units/min | Timber/min | Stone/min | Iron/min | Total/min |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Pikeman | Barracks | 8 | 45 | 35 | 15 | 95 | 7.5 | 337.5 | 262.5 | 112.5 | 712.5 |
| Shieldman | Barracks | 11 | 35 | 30 | 65 | 130 | 5.45 | 190.91 | 163.64 | 354.55 | 709.09 |
| Raider | Barracks | 10 | 55 | 35 | 45 | 135 | 6 | 330 | 210 | 270 | 810 |
| Archer | Barracks | 13 | 90 | 40 | 55 | 185 | 4.62 | 415.38 | 184.62 | 253.85 | 853.85 |
| Scout | Stable | 7 | 45 | 55 | 25 | 125 | 8.57 | 385.71 | 471.43 | 214.29 | 1,071.43 |
| Lancer | Stable | 14 | 120 | 110 | 240 | 470 | 4.29 | 514.29 | 471.43 | 1,028.57 | 2,014.29 |
| Knight | Stable | 28 | 210 | 160 | 580 | 950 | 2.14 | 450 | 342.86 | 1,242.86 | 2,035.71 |
| Ram | Workshop | 35 | 280 | 220 | 190 | 690 | 1.71 | 480 | 377.14 | 325.71 | 1,182.86 |
| Trebuchet | Workshop | 55 | 330 | 380 | 120 | 830 | 1.09 | 360 | 414.55 | 130.91 | 905.45 |
| Envoy | Court | 150 | 6,000 | 7,500 | 6,500 | 20,000 | 0.4 | 2,400 | 3,000 | 2,600 | 8,000 |

Envoy costs above assume **one owned village**. The server multiplies each resource cost by the number of owned villages when the batch is queued; multiply its resource-demand columns by that count. Training time does not receive that cost multiplier.

Rates are long-run averages, rounded to two decimals. Units complete discretely; “5.45 units/min” does not mean a fractional unit is trained.

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

## Higher-level buildings and actual available throughput

Live training rule: `ticks = max(1, round(baseTrainTime × 0.94^(max(1, buildingLevel) − 1)))`. Round the training time first, then calculate resource demand. The authoritative current-village value is `options.train[].ticksEach` in `/state`; use its `cost` too, especially for Envoys.

Units that cannot train at level 1 have these earliest-unlock training rates:

| Unit | Minimum recruitment building | Seconds/unit there | Total resources/min there |
|---|---|---:|---:|
| Archer | Barracks 5 | 10 | 1,110 |
| Lancer | Stable 3 | 12 | 2,350 |
| Knight | Stable 10 | 16 | 3,562.5 |
| Trebuchet | Workshop 2 | 52 | 957.69 |

## Using this for an economy budget

A level-1 Barracks continuously producing **Raiders** needs **330 timber + 210 stone + 270 iron per minute**, or **810 resources/minute total**, and creates six population worth of troops per minute. Having 810 total production is insufficient if iron production is below 270/minute.

At your observed **Barracks 5**, a Raider takes **8 ticks**, so continuous recruitment needs **412.5 timber + 262.5 stone + 337.5 iron/minute**, total **1,012.5/minute**, and 7.5 population/minute. Faster training increases the sustained resource requirement.

For a mix in the **same building**, weight resource flows by the fraction of training time assigned to each unit; do not add two full-time rows. For desired unit counts, calculate total cost divided by total training time instead. For **different buildings** running simultaneously (for example Barracks and Stable), add their resource flows.

Budget surplus production separately for buildings, other recruitment queues and replacements. These rates exclude unlock/building costs and losses. Stockpiles can fund a temporary deficit; approximate its duration as `stock / (recruitment demand − production)` per resource, taking the earliest positive deficit to run out.

Continuous recruitment also consumes population capacity: allow for Farm expansion and its resource/construction cost. Current server queue limits, prerequisites, action cooldowns, batch affordability and rounded training times still apply; these are ideal uninterrupted throughput budgets, not a promise of indefinite execution.

## Refreshing the numbers

Fetch the authenticated live `/rules` response, read `rules.UNITS` and `rules.TRAINING`, and apply the formulas above. No account key belongs in this document. Confirm current costs/times from the village’s `/state` training options before issuing orders.
