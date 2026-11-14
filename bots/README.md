# Starter stewards

Three ways to put a steward in charge of a holding. Each one is a starting point, meant to be copied
and changed: the game you're really playing is making a better one.

| Steward | Run it | Needs |
|---|---|---|
| [`typescript/starter.ts`](typescript/starter.ts) | `npx tsx bots/typescript/starter.ts` | Node 20+, nothing else |
| [`python/starter.py`](python/starter.py) | `python bots/python/starter.py` | Python 3.10+, standard library only |
| [`llm/shift.sh`](llm/shift.sh), [`llm/shift.ps1`](llm/shift.ps1) | `bash bots/llm/shift.sh <world>` | [Claude Code](https://claude.com/claude-code) with the `steward` MCP server added |

The TypeScript and Python stewards are the same bot, function for function, in one file each with
no imports from this repo, so you can lift either one out and run it anywhere.

## Running the coded stewards

Both read the same environment:

| Variable | Means | Default |
|---|---|---|
| `STEWARD_URL` | The server | `http://localhost:8787` |
| `STEWARD_KEY` | Your API key | none |
| `STEWARD_NAME` | With no key: sign up under this name and print the new key once | none |
| `STEWARD_WORLD` | The world to play | your first sandbox, else the first public world |
| `STEWARD_SANDBOX` | `1`: create a fresh sandbox (speed 10) and play there | off |

First run, against the existing remote game server:

```bash
STEWARD_URL=https://norn-steward.velea.cc STEWARD_NAME=ironwill STEWARD_SANDBOX=1 npx tsx bots/typescript/starter.ts
```

It prints your key once. Keep it, and from then on:

```bash
export STEWARD_URL=https://norn-steward.velea.cc
export STEWARD_KEY=nsk_...
python bots/python/starter.py                      # your sandbox, or the first public world
STEWARD_WORLD=<world> npx tsx bots/typescript/starter.ts
```

On Windows PowerShell, set variables with `$env:STEWARD_KEY = "nsk_..."` first.

Every decision is one line of log, stamped with the tick:

```
19:02:11 t1372 act: Oakridge train 1 raider (raiding force 45/70 pop)
19:02:13 t1391 Oakridge: farming Ashby: 46 raider
19:02:17 t1462 Oakridge: battle attacker vs Ashby: won, lost 9/46 pop loot 148/148/148
19:04:07 t1712 Oakridge: holds against ~120 raider (slowest: pikeman/raider/archer) at t1903
```

The same calls show in the dashboard's **Steward** tab, each batch under the `note` the bot sent with
it.

## How the starter thinks

One loop: act, then long-poll `GET /events?wait=20` with `untilTick` set to the next tick it cares
about (when a wanted building becomes affordable, when a defended attack has landed, and at least
every 60 ticks), then re-read `/state`.

- **Raiders first.** A village with no raids going (the opening, or after losses broke up its
  parties) builds only what it needs (a farm, a storehouse), its resource buildings up to level 7,
  and the road to raiders (hall 5, barracks, smithy 2), and puts every troop it trains past a core of
  five pikemen into raiders, until it has a party that can farm a hamlet. In a speed-20 sandbox
  against the default house bots its first raid wins around tick 1,450.
- **Building.** It never computes a cost. Each village's `options.build` already says what can be
  queued now and, if not, every reason why and when production covers it. In order it wants: a farm
  when the population is nearly full, a storehouse before the stores fill, the scarcest resource
  building, then the next step toward its goals (walking each building's `requires` from the rules),
  then the Great Hall. It keeps at most two items queued and saves for a wanted building that's
  affordable soon instead of buying something lesser.
- **Training.** Once raids are going: whichever of defence (pikemen, shieldmen, archers, whichever it
  has fewest of, up to a fifth of the farm's population) and offence (lancers once it can, else
  raiders, up to 35%) is further below its target. Troops more than half short of target come before
  building. It spends half of what a batch could buy, so the economy keeps growing.
- **Farming.** It reads the map around each village for hamlets. For each raiding unit (lancers
  first, then raiders at the hamlets left) and each of the five nearest hamlets, it halves its way with
  `POST /simulate/battle` to the smallest party that wins losing at most a fifth of itself and carries
  home more than its losses cost. A hamlet's defence is `hamletBaseDefense` plus the militia grown
  since our last win there (since tick 0 if we never beat it), behind its wall from our last report
  (the highest it can be drawn with, until then). A first raid on a hamlet may lose 40% and needn't
  pay, but its survivors must make a party that does. It farms the cheapest three, adds the rest of
  its raiders to those parties (a bigger party loses a smaller share), and hands them to the server
  as standing raid orders (`PUT /villages/{id}/orders`) that pause if a raid loses more than it was
  sized for. It re-plans when an order pauses, a raid is lost or first won, a party no longer fits
  the troops it has left, or its raiders and lancers have grown by a quarter.
- **Defence.** For each new or newly sighted attack it works out the slowest-unit candidates from
  the distance and the travel time, guesses the worst army that fits, and simulates the battle
  against what will be there: troops home or coming home by then, support on the road or timed to
  land by then, but not raiders whose standing orders would send them out again. If the village
  falls in the simulation, it stops its raids and calls back the ones that would be home in time,
  then sends support from its other villages timed with `arriveAtTick` (never troops already timed
  to leave on another send), and recalls that support once the attacks have landed.
- **Housekeeping.** Every action carries a `clientId`, so retries never act twice. It honours `429`
  with `Retry-After`, re-reads the state on a `gap` or a new `epoch`, waits for the next round on
  `WORLD_NOT_RUNNING`, and founds a new village if it loses them all.

Its taste lives in one `STRATEGY` table at the top of each file. Every rule number comes from
`GET /worlds/{w}/rules` at join, so the bot keeps working when the rules change between rounds.

## Iterating fast with a sandbox

A sandbox is a private world with house bots as opponents, and you hold its clock.

**Lockstep** is the fastest way to develop: the clock moves only while you wait for events, so the
bot runs as fast as it can think and never misses a tick because it was slow.

```bash
H="Authorization: Bearer $STEWARD_KEY"
curl -s -X POST ${STEWARD_URL}/api/v1/sandboxes -H "$H" -H 'content-type: application/json' \
  -d '{"clock":"lockstep","ticksPerTurn":20,"seed":42,"houseBots":{"warden":1,"reaver":2}}'
STEWARD_WORLD=<the id it returned> npx tsx bots/typescript/starter.ts
```

Each `GET /events?wait=` the bot makes advances up to `ticksPerTurn` ticks (at most 300) or to its
`untilTick`, stopping at its first event. The same `seed` gives the same map and house bots, so you
can compare two versions of your bot on the same ground.

**Realtime** sandboxes run on their own clock (speed 0.25 to 50 ticks a second; up to 1000 on a
server started with `STEWARD_DEV=1`). Drive it with `POST /sandboxes/{w}/control`:

```bash
C="${STEWARD_URL}/api/v1/sandboxes/<world>/control"
curl -s -X POST $C -H "$H" -H 'content-type: application/json' -d '{"action":"pause"}'
curl -s -X POST $C -H "$H" -H 'content-type: application/json' -d '{"action":"step","ticks":300}'
curl -s -X POST $C -H "$H" -H 'content-type: application/json' -d '{"action":"run_until","tick":3600,"untilEvent":true}'
curl -s -X POST $C -H "$H" -H 'content-type: application/json' -d '{"action":"set_speed","speed":50}'
```

`run_until` with `untilEvent: true` stops at your next event, which is how you jump straight to the
first attack on you. A paused sandbox still takes actions; they apply at the paused tick.

**The log.** `GET /sandboxes/{w}/log` returns every action applied in the sandbox, by everyone, with
its tick and order: with the seed, enough to reproduce a run. Your own calls, notes included, are in
`GET /worlds/{w}/activity`. And the dashboard at `/w/<world>` gives a sandbox's creator the **god
view**: every army on the map, every battle.

Two sandboxes per account at a time; delete one with `DELETE /sandboxes/{w}`.

## Strategy notes

Real numbers, from [`src/rules/config.ts`](../src/rules/config.ts). A tick is one second of game
time; a blitz round is 10,800 ticks (three hours at speed 1).

**The start.** A new village has the Great Hall, farm, storehouse, lumberyard, quarry and mine at
level 1 and 1,000 of each resource. A level-1 resource building makes 112 a minute, and each level
multiplies that by 1.165 (206 at level 5, 443 at level 10). The storehouse holds 3,600 of each at
level 1, ×1.22 a level (7,975 at level 5); anything over is lost. The farm feeds 200 at level 1,
×1.18 a level, and buildings eat population too, so a stalled queue is usually a farm you didn't
build.

**The hall pays for itself.** Every build takes `0.952^hall` of its base time: at hall 10, 61%.

**The unlock path.** Barracks needs hall 3. Shieldmen need smithy 1, raiders smithy 2. The smithy
needs hall 5 and barracks 1. Lancers need stable 3 and smithy 3, and the stable needs hall 10,
barracks 5 and smithy 5, so lancers are a mid-round unit.

**Protection.** A new player can't be attacked for 900 ticks (plus a quarter of the tick they joined
at, at most 2,700). Attacking another player, house bots included, ends your own protection at once.
Hamlets belong to no one; raiding them doesn't.

**Hamlets are the early economy.** Three around every player's first village, 2 to 5 fields out,
with walls of 1 to 3 and half-full storehouses. Their defence is 150 plus a militia of 0.25 a tick
since they last lost a battle, up to 1,500 (reached after 6,000 ticks untouched). So an untouched
hamlet with wall 2 at tick 2,000 defends at `(150 + 500 + 25·2) · 1.04² ≈ 757`: that takes 82
raiders losing 8, or 30 lancers losing 3. Farm the same hamlet every round trip and it stays weak:
lancers 3 fields away travel 30 ticks each way, the militia regrows only 15, and the defence stays
near 233.

**Losses.** The loser loses everything; the winner loses `round(count · (D/A)^1.5)` of each unit
type. Twice the strength costs 35%, three times 19%, four times 12.5%, five times 9%. Rounding is
half up, so a small party loses one unit until `count · (D/A)^1.5` drops below 0.5: 26 lancers lose
nobody against that 233. A raid order pauses on its own if it loses more than 20% of what it sent.

**Farming on foot.** Losses fall only with the square root of the party's size, so against a hamlet
a raider party loses about the same few raiders whatever its size, and each survivor carries 12.
Against a wall-3 hamlet farmed every round trip from 3 fields (defence 283), 20 raiders lose 4, 36
lose 3 and bring home 396 (less than the 405 those three cost), 37 lose 3 and bring home 408. Small
raider parties farm at a loss; that's why the starter's first party is about 46 raiders (the first
raid loses 7 to 10 to the militia grown since tick 0, and what's left farms at a profit). Lancers
carry 85 each: 10 of them lose one and bring home 765.

**Walls.** Defence is `(troops + 20 + 25·wall) · 1.04^wall`: wall 10 adds 250 flat and multiplies
the lot by 1.48. Rams knock levels off before the fight, so a wall is worth most against raiders
who bring none.

**Defensive troops.** The pikeman (45 defence against cavalry, 20 against infantry) is the cheap
answer to horsemen; the shieldman (50 against infantry, 40 against ranged) to foot and bows. Raiders
hit hard (42) but defend at 8 or less: never count them as a garrison.

**Reading an attack.** You see an attack's origin and arrival tick the moment it's sent. Its travel
time is `ceil(distance · speed of the slowest unit)`, so the units whose speed fits are the only
possibilities: 18 ticks a field is pikemen, raiders or archers, 22 shieldmen, 9 scouts, 10
lancers, 11 knights, 30 siege engines or envoys. A watchtower (radius
`3 + 1.5·level` fields) adds the army's size and whether an envoy marches with it.

**Calling back.** A command can be cancelled for 30 ticks after it's sent (never after it would
arrive); cancelled at tick `t`, it's home at `t + (t − sentTick)`. Support that lands on the same
tick as an attack is already in the village when the attack hits.

**Conquest.** Each surviving envoy in a winning attack takes 34 loyalty, so three take a village at
full loyalty (100). A conquered village restarts at 25 and regains 1 every 120 ticks. The court needs
hall 10, smithy 10 and market 5, and an envoy costs 6,000 timber, 7,500 stone and 6,500 iron times
the villages you own: a level-5 storehouse just holds the stone for one.

**Score** is points plus twice your renown (the population you've killed, attacking and defending),
so fighting well counts as much as building well.

**Limits.** 40 calls in a burst, refilling 20 a second; 200 actions in a burst, 25 a second; up to
50 actions in one batch. A long-poll counts as one call. Standing orders count against neither,
which is why the starter hands its raids to them.
