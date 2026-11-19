# Norn Steward: the design

**Norn Steward** (working title) is a medieval village-and-war strategy game played through an API.
Each player can write a **steward** (a program or an AI over MCP), issue manual orders through the
hybrid dashboard, or do both. You build villages, gather timber, stone and iron, train armies, raid and conquer,
and every order goes through the same API. The game you're really playing is making a better
steward.

This doc owns the product and the mechanics. Every number lives in
[`src/rules/config.ts`](../src/rules/config.ts) and nowhere else; this page names the keys and the
formulas that use them. `round(x)` always means `floor(x + 0.5)`. The API is in [api.md](api.md),
the MCP tools in [mcp.md](mcp.md), the dashboard in [dashboard.md](dashboard.md).

## The pitch, and what follows from it

1. **API-first, with hybrid control.** Everything a player can do is an API call. The dashboard
   can watch or issue manual commands with the player's key, using the same checks as any bot.
2. **Fast.** A public round lasts hours, not months. A practice sandbox runs as fast as you like.
3. **Exact rules.** Every number is published (`GET /worlds/{w}/rules`, with per-level tables) and
   every formula is on this page. Combat has **no luck**: the battle simulator gives the exact result.
   What you don't know is the other side: what's in their village, what's marching, what they'll do.
4. **A level field for code and for LLMs.** The REST API is shaped for programs; MCP is shaped for
   language models; **standing orders** let either hand routine work to the server. All of them go
   through the same `World.apply()` with the same checks, and so do the house bots.
5. **Watching is half the fun.** The dashboard shows your steward working: armies marching, queues,
   the economy over time, and every call it made.

## Worlds and time

- **A world** is one map, one set of players and one round. The server hosts several at once.
- **A tick is one second of game time.** Every duration is in ticks. A world's **speed** is how many
  ticks pass per real second. Speed changes the clock, never the rules.
- **World kinds** (`WORLD_KINDS`, `SANDBOX`, `MAP.size`):

  | Kind | For |
  |---|---|
  | **Blitz** (public) | Coded bots. Real time; a new round starts `SERVER.nextRoundDelayMs` after one ends |
  | **Council** (public) | LLMs over MCP, and anyone else: a slow clock, and every player gets **one batch of actions per `actIntervalTicks`**, so thinking time isn't what decides it. Standing orders are exempt |
  | **Sandbox** (private) | Developing a bot against house bots. Only its creator joins and sees it. The creator controls the clock: pause, step, run until a tick or an event, change speed, or **lockstep** (the clock only moves while the creator waits for events) |

- **Joining** founds one village. A player who loses every village keeps their player id, renown and
  leaderboard row, and may join again: a new village at the next spawn slot, with fresh protection
  and no new hamlets.
- **A round ends** after its last tick (`durationTicks`) is processed, or early when one player holds
  `SCORING.dominanceShare` of all villages, hamlets included. Whatever is still marching or queued
  never resolves. After that, actions answer `WORLD_NOT_RUNNING` and reads show the frozen state. A
  public world's next round is a fresh map under the same world id with `round + 1`; everyone joins
  again. Rules are frozen for a round and change only between rounds. Past rounds' leaderboards are
  kept.
- **Seeds:** a world's map and house bots come from its seed. A public world's seed is secret (the
  server derives it from a server secret, the world id and the round) and never appears in any view.
  A sandbox's creator may choose its seed.

## The tick

`world.tick` is the last tick fully processed. An action applied between ticks sees that state and
is stamped with that tick: a command sent then has `sentTick = tick`, and with travel time `t` it
resolves while tick `sentTick + t` is processed. Every applied action and every command gets the next
number of a world-wide sequence (`seq`), so "the order they were sent" is defined across all players.

Each `advance()` processes tick `T = tick + 1`, in this order:

1. **Production:** every village, hamlets included, adds its per-tick production of each resource
   (integer milli-units, `ECONOMY` comment), capped at storage.
2. **Construction** ending at T completes. The next queued item starts at T, timed with the hall level
   after this step.
3. **Training:** units finishing at T join their village; the next unit starts.
4. **Arrivals at T**, in three groups, each in `seq` order: (a) support arriving and every command
   coming home; (b) merchants, arriving or coming home; (c) attacks. So a support that lands in the
   same tick as an attack is already in the village when the attack hits.
5. **Loyalty:** if `T % loyaltyRegenTicks == 0`, every village below `loyaltyMax` gains 1.
6. **Sightings:** an incoming attack not yet sighted is sighted at T if its distance still to cover,
   `distance * (arrivalTick - T) / (arrivalTick - sentTick)`, is within the target's watchtower radius
   (read at T's level).
7. **Protection** ending at T ends (`protection_ended`).
8. **Scheduled actions** due at T apply, in the order they were submitted, stamped with tick T.
9. **Standing orders** apply, player by player in a seeded order, each through `World.apply()`.
10. **House bots** act, through `World.apply()`.
11. **History:** if `T % HISTORY.sampleEveryTicks == 0`, each player's totals are sampled. If
    `T % publicSnapshotTicks == 0`, the public numbers (map points, leaderboard) refresh.
12. **Round end:** the round checks whether it has ended.

Everything is deterministic: the same seed and the same actions at the same ticks in the same order
give the same world.

## Villages and the economy

- **Resources:** timber, stone and iron, made by the lumberyard, quarry and mine. Production per
  minute at level L is `productionBase * productionGrowth^(L-1)`, or `productionAtZero` at level 0.
  The balance snapshot uses 80/minute at level 1 and 14/minute at level 0, with growth 1.165.
  Internally resources are integer milli-units; the API shows whole units rounded down, plus the exact
  figures for bots that want them.
- **Storage:** the storehouse caps each resource at `storageBase * storageGrowth^(L-1)`. Anything that
  arrives (production, loot coming home, trades, refunds) is added and then capped; the excess is lost.
- **Population is computed, never stored.** `used` is: for every building, its total population at
  `n` = built level plus its levels in the build queue (`round(basePop * popGrowth^(n-1))`, 0 at
  n = 0); plus the population of every unit of this village's own, wherever it is (home, marching,
  coming home, stationed elsewhere, still in a training queue). Troops from other villages stationed
  here don't count. `max` is the farm limit at the farm's built level
  (`farmBase * farmGrowth^(L-1)`); queued farm levels don't count. Something can be queued only if
  `used + added ≤ max`. If `used` ends up above `max` (a farm knocked down, a conquest), nothing dies;
  nothing new can be queued until it fits.
- **Building:** one build queue per village, up to `buildQueueMax` items. Queuing pays the cost at
  once; items build one after another. Ticks for level L are
  `max(1, round(baseTime * timeGrowth^(L-1) * HALL_SPEED_BASE^hallLevel))` with the hall level when the
  item **starts**; once started, its `endTick` is fixed. Base times for all buildings, including the
  Hall, are halved relative to the previous balance; whole-tick rounding (minimum 1), per-level
  growth and Hall speed remain unchanged. Queuing a building that's already queued
  queues the level after. Each item builds `current level + 1` when it completes, so if trebuchets
  knock a building down while levels are queued, the items rebuild from the new level. Requirements
  are checked only when something is queued.
- **Cancelling a build item** also cancels every later queued level of the same building. Items that
  hadn't started are refunded in full; the running one is refunded `floor(cost * refundInProgress)`,
  and the next item starts at once.
- **Requirements:** each building lists the buildings it needs. A building can't go past `maxLevel`,
  and a cost of one level above the storehouse's capacity can never be paid (`EXCEEDS_STORAGE`).
- **The cellar** hides `cellarBase * cellarGrowth^(L-1)` of each resource from raiders.
- **Training:** the barracks, stable, workshop and court each have a queue of up to `trainQueueMax`
  batches of up to `trainBatchMax` units. A batch pays for every unit up front. Units come out one at
  a time, each taking `max(1, round(trainTime * 1000 * speedBase^(max(1, level)-1))) / 1000` ticks
  at the producing building's level when that unit starts. Unit base times are halved; speedBase
  remains 0.94. Training uses integer milli-tick precision, so several units can finish during one
  tick; unused time carries into the next unit and batch. Completions become visible at the next
  integer processing tick. Each unit locks its speed when it starts, even across upgrades.
  Training carries on if the building is knocked down.
  Cancelling a batch refunds every unit not yet out, the one in progress included, in full.
- **The market** has `round(merchantsA*L^2 + merchantsB*L)` merchants, each carrying `merchantCarry`
  of any mix of resources to any village (not a hamlet) at `merchantSpeed` ticks per field each way.
  Merchants are busy until they're home. A player can trade only to their own villages until their
  protection has ended.

## Units

Ten units, defined in `UNITS`: pikeman, shieldman, raider, archer (barracks); scout, lancer, knight
(stable); ram, trebuchet (workshop); envoy (court). Each has a cost, population, an attack value and
type (infantry, cavalry or ranged), three defence values (one per attack type), a speed in ticks per
field, a carry capacity and a training time, and needs its building and the smithy at a level.

**Envoys** cost their listed cost times the number of villages you own when the batch is queued, so
conquering gets dearer the more you hold. A batch's price is fixed when it's queued.

## Moving armies

- **Distance** is Euclidean on whole-number coordinates, `sqrt(dx² + dy²)` fields. **Travel ticks**
  are `ceil(distance * slowest unit's speed)`. The trip home takes the same.
- **Commands** a village can send:
  - **attack:** fight, then loot, knock down the wall or a building, or lower loyalty; survivors come
    home with the loot. It must carry at least `COMBAT.minAttackPop` population. An attack of only
    scouts is a **scouting run**: it has no minimum and never fights beyond the scouts.
  - **support:** the troops stay in the target village and defend it until their owner recalls them or
    the host sends them back. They still count against their home village's population.
- **Invalid targets:** the sending village itself; an attack or scouting run at a village you own;
  support to a hamlet; a trade to a hamlet.
- **Calling back:** a command can be cancelled until `min(sentTick + cancelWindow, arrivalTick - 1)`.
  Cancelled at tick t, it reaches home at `t + (t - sentTick)`.
- **Limits:** a village has at most `LIMITS.outgoingCommandsPerVillage` commands out (marching,
  coming home, or stationed elsewhere as support).
- **Seeing it coming:** the defender learns of an attack the moment it's sent: its origin and its
  arrival tick, and nothing more. The slowest unit's speed is always inferable from the distance and
  the travel time, which is why the envoy marches at the siege engines' pace. A **watchtower**
  (level ≥ 1, radius `radiusBase + radiusPerLevel*L`) reveals more once the army comes within its
  radius: the army's size bucket and whether an envoy marches with it. A cancelled attack disappears
  from the defender's list with an `incoming_cancelled` event. Support coming to you shows its units.

## Combat

A battle is the attack against everyone in the village: the owner's troops at home plus every
support stationed there. Same inputs, same result, every time.

1. **Scouts first.** `a` = attacking scouts, `d` = every scout in the village, support included. If
   `a > d` the scouting succeeds: every defending scout dies and the attacker loses
   `round(a*(d/a)^1.5)`. Otherwise every attacking scout dies and the defender loses
   `round(d*(a/d)^1.5)`. A scouting run ends here. In a mixed attack, surviving scouts on both sides
   then fight as ordinary units.
2. **Attack strength** is summed by attack type: `A_inf`, `A_cav`, `A_rng`, total `A`. Each type's
   **share** is `w_t = A_t / A`. An attack with `A = 0` loses outright.
3. **Defence** of every defending unit is weighted by those shares:
   `D_units = Σ count * (w_inf*def_infantry + w_cav*def_cavalry + w_rng*def_ranged)`.
4. **Rams before the fight:** every ram in the attack counts against the wall's real level to give
   its **effective** level E for this battle. Knocking level L to L-1 takes `ceil(ramBase + ramPerLevel*L)`
   rams, level by level from the top, out of those not yet counted; when fewer are left than the next
   level needs, the rest do nothing. Rams are never used up by knocking; they fight and die as units.
5. **Defence total:** `D = (D_units + base + wallFlat*E) * wallMultBase^E`, where `base` is
   `villageBaseDefense` for a player village and, for a hamlet, `hamletBaseDefense` plus its militia
   (`MAP` comment).
6. **Result:** if `A > D` the attacker wins: every defender dies and each attacking unit type loses
   `round(count * (D/A)^1.5)`. Otherwise the defender wins: every attacker dies and each defending
   unit type loses `round(count * (A/D)^1.5)`. Ties go to the defender. When the attacker loses,
   nothing is knocked down or taken.
7. **After a win, siege:** the surviving rams knock the real wall down (same counting, from its real
   level). Then the surviving trebuchets knock down the building the attack aimed at
   (`ceil(trebuchetBase + trebuchetPerLevel*L)` per level, not below the building's `minLevel`; default
   aim the Great Hall). Aiming at a building at its minimum does nothing.
8. **Loot:** `left_r = max(0, floor(stock_r) - hidden)` per resource, and `C` = the survivors' total
   carry. While `C > 0` and some `left_r > 0`: let S be the resources with `left_r > 0` and
   `share = floor(C / |S|)`; if `share > 0` take `min(share, left_r)` of each resource in S; otherwise
   take 1 at a time from S in the order timber, stone, iron until C runs out. Loot leaves the village
   at the battle and arrives home with the survivors.
9. **Conquest:** each surviving envoy lowers loyalty by `envoyLoyaltyHit`. At 0 or below the village
   changes hands (next section).

**Renown** keeps the war score. The attacker earns the population of every defending unit killed,
scout phase included. The population of every attacker killed is split between the defending owner
and each supporter in proportion to their share of `D_units`, rounded down. Envoys used up in a
conquest aren't kills.

**Reports.** Every battle and scouting run makes reports. Hamlets get none.

| Who | Sees |
|---|---|
| **Attacker**, any unit survived | Own units sent and lost, scouts; the defenders present and lost (total), strength, wall, building, loyalty, loot carried against capacity; and, if the scouting succeeded, **intel**: resources left after the loot, building levels after the siege, the owner's surviving troops at home and the surviving support in total |
| **Attacker**, wiped out | Own units sent and lost, and the outcome. Nothing else |
| **Defending owner** | The attacking units sent and lost, own defenders present and lost (total), strength, wall, building, loyalty, loot taken. No intel |
| **Supporter** (had troops there) | Only their own stack, present and lost |

## When a village changes hands

1. **The conquering attack's survivors**, minus the envoys used up, stay in the village as a support
   stack from their home village. They take no loot.
2. **The village** keeps its buildings and resources; its loyalty restarts at `loyaltyAfterConquest`.
   Its build and training queues are lost without refund.
3. **The lost village's own troops that weren't in it** are orphaned: stacks stationed elsewhere are
   disbanded at once; commands still out carry on and resolve for their owner, and when they would
   reach home they vanish, with their loot. From the conquest they no longer count anywhere.
4. **Merchants** that are out deliver and come home to the village, for whoever owns it then. Trades
   arriving are delivered to the current owner.
5. **Arrivals are judged on arrival:** an attack reaching a village its sender now owns is stationed as
   support; a support reaching a village whose owner changed since it was sent turns round.
   Protection is checked only when a command is sent.
6. **Incoming commands** move to the new owner: the old owner gets `incoming_cancelled`, the new owner
   gets the incoming events, and sightings are recomputed from the village's watchtower.
7. **Envoys in training** elsewhere keep their price.

## Hamlets

Unowned villages, `MAP.hamletsPerPlayer` around each player's first village of a round, at a seeded
distance in `hamletDistance`. Their buildings are drawn from `MAP.hamletLevels`; they start with
`hamletStartFill` of their storage and full loyalty, and they have no troops. Their base defence is
`hamletBaseDefense` plus a **militia** that grows by `hamletMilitiaPerTick` every tick since the
hamlet last lost a battle, up to `hamletMilitiaCap`, and resets when it loses one. So farming is a
route-planning problem: raid often and the hamlet stays weak, leave it and it hardens. Hamlets
produce and store resources like any village, never grow, are never protected, and can be conquered.

## Protection

A new player's villages can't be attacked or scouted by other players for
`min(maxTicks, newPlayerTicks + floor(tickAtJoin * lateJoinFactor))` ticks, so a late joiner isn't
just farmland. A rejoin gets the same. Sending an attack or scouting run at another player (a house
bot counts) ends your own protection at once; a send that fails doesn't. Hamlets are never protected;
support is always allowed. Whether a player is protected, and until when, is public.

## Score and the leaderboard

A village's **points** are the sum, over every building level it has, of
`round(basePoints * pointsGrowth^(L-1))`. A player's points are their villages' points. **Score** is
`points + renownWeight * (attack renown + defence renown)`, so fighting well counts as much as
building well. The leaderboard ranks by score, then points, then who joined first. Public points and
the leaderboard refresh every `publicSnapshotTicks`; your own state shows yours live. A new village
founded in a round starts with `startResources` plus `lateJoinResourcesPerTick` per tick already
played, capped at storage.

## Standing orders

Simple automation the server runs for every player who sets it, on every surface. It exists so an LLM
that thinks for a minute isn't beaten by an idle queue, and so a coded bot can hand off the routine
and spend its calls on what matters. Orders go through `World.apply()` like everything else, don't
count against rate limits or the Council action interval, and show in the activity log.

- **Build** (up to `ORDERS.maxBuild` entries `{ building, toLevel }`): whenever the build queue has
  room, the first entry not yet reached (counting queued levels) is queued if it's affordable now.
  An entry that fails for any reason other than resources, a full queue, or a prerequisite that's
  already queued pauses the build order (`order_paused`).
- **Train** (up to `ORDERS.maxTrain` entries `{ unit, keep, batch? }`): whenever the village's count of
  that unit (home, away and queued) is below `keep`, queue `min(batch, what's missing, what's
  affordable)`. It waits while the buildings it needs are queued or still ahead in the (unpaused)
  build order; any other failure but resources, population or a full queue pauses that entry.
- **Raids** (up to `ORDERS.maxRaids` entries `{ target, units, stopIfLoss? }`): whenever those units
  are all at home, send them as an attack on the target. A raid pauses after a lost battle, after
  losing more than `stopIfLoss` (default `raidStopLossDefault`) of what it sent (both pause with
  code `RAID_LOST`; the share is by population), or when the target becomes invalid or protected.

Orders apply each tick in step 9, player by player in a seeded order, and per village in the order
build, train, raids.

## House bots

Built-in stewards in the engine, acting through the same `World.apply()` as everyone else, so worlds
feel alive from the first minute and every new bot has something to beat. Public worlds seat
`WORLD_KINDS.*.houseBots` at tick 0; sandboxes seat what their creator asks for. Their names come from
a seeded list and always contain a space ("Warden Ashgrove"); player names can't, so the two never
clash. They see only what a player would see, are deterministic from the world seed, never rejoin and
are never protected. Each thinks every `HOUSE_BOTS.thinkEveryTicks`; on Council it too gets one batch
per `actIntervalTicks`, and doesn't think again until its next batch would be taken.

- **Warden** builds its economy and walls, trains defence, and never attacks first.
- **Reaver** raids hamlets and weak neighbours with fast cavalry and spends the loot on more.
- **Sovereign** balances economy and army, scouts, and conquers with envoys.

## What a steward sees

- **Its own everything:** villages, resources, queues, troops at home and away, every command it sent,
  every report it got, its standing orders and notes.
- **The public map:** every village's position, name, owner and points, whether each player is
  protected, the leaderboard (refreshed every `publicSnapshotTicks`), and every conquest.
- **Incoming attacks and support** on its villages, as described under *Seeing it coming*.
- **Nothing else.** No other player's troops, resources or commands except through a report. Troops
  stationed in someone else's village tell their owner only about themselves: no incoming warnings,
  no garrison, no wall. The dashboard follows the same rule ([dashboard.md](dashboard.md)).

## Accounts

An account is a name and an API key. The key is shown once at signup; the server stores only its
hash. One key drives the REST API, the stream and MCP, and logs into the dashboard. Rotating the key
ends the old one everywhere at once, open streams included. One account plays one set of villages per
world.

## Fair play

- **Every action goes through the API**, rate limited per account ([api.md § Limits](api.md#limits)).
- **A steward may be any program or any AI**, run anywhere.
- **One account per person per world.** Feeding a main account from others is against the rules.
- **No reading anything the API doesn't give you.** Bugs that leak hidden information get reported,
  not used.

## Later, not now

Ideas that aren't scheduled. Don't build them without a decision first.

- **Tribes:** alliances with shared intel, a tribe chat over the API, and tribe leaderboards.
- **An exchange:** a constant-product pool per resource pair, so prices move with every bot's trades.
- **OAuth for MCP**, so AI clients that only take OAuth connectors (claude.ai) can connect.
- **Replays and forks:** step through a finished round tick by tick; fork a sandbox from a snapshot to
  re-test one situation many times.
- **Seasons and ratings:** a rating per steward across rounds.
- **Dodging in standing orders:** move troops out of the way of an incoming attack.
- **Hosting:** where the public worlds run, and under which domain.
