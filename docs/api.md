# The steward API

Everything a player does goes through this API. It's built for programs first: one call to read the
whole state, one call to act (in batches), retries that are safe, scheduled actions for exact timing,
and errors that say exactly what's missing and when it won't be.

The wire shapes are in [`src/shared/api.ts`](../src/shared/api.ts). The mechanics behind every action
are in [design.md](design.md). The quota values on this page come from the upstream game server's
configuration. This repo's [`src/rules/config.ts`](../src/rules/config.ts) is a client snapshot and can
lag upstream. The server publishes a machine-readable description at `GET /api/v1/openapi.json`.

## Basics

- **Base URL:** `/api/v1`. JSON in and out, UTF-8.
- **Auth:** `Authorization: Bearer <apiKey>` on every call except signup, the world list, a public
  world's map, leaderboard and rules, and the simulators.
- **Time:** every game time is a **tick** (one second of game time). Responses carry the current
  `tick`; `speed` says how many ticks pass per real second, and it can change (sandboxes). The tick
  rules (when an action applies, when a command arrives) are in
  [design.md § The tick](design.md#the-tick).
- **Ids** are opaque strings with a type prefix (`p_`, `v_`, `c_`, `t_`, `b_`, `q_`, `r_`, `s_`),
  unique within a world, deterministic for replays but not sequential. Keep them, don't parse them.
- **Not yours is not found.** An id that exists but isn't yours answers exactly like one that doesn't
  exist (404, or `NOT_FOUND` in an action result). A sandbox is invisible to everyone but its creator.
- **Errors:** any non-2xx response is an `ErrorResponse`: `{ "error": { "code", "message", "details" } }`.
  `code` is stable and machine-readable (`ErrorCode`); `message` is for people.

| Status | When |
|---|---|
| 400 `VALIDATION` | The body or query doesn't match the shape: a field it doesn't know is refused, never ignored, and an empty query value (`?after=`) is refused, never read as 0. `details.issues` lists each problem with its path |
| 401 `UNAUTHORIZED` | Missing or wrong key |
| 403 `FORBIDDEN` | A non-`GET` REST request marked `X-Steward-Client: dashboard` |
| 404 `NOT_FOUND` | No such world, village, report… or not yours |
| 409 | `NOT_IN_WORLD`, `WORLD_NOT_RUNNING` (the round is over), `NAME_TAKEN`, `LIMIT_REACHED` |
| 429 `RATE_LIMITED` | A request was rate-limited. See [Limits](#limits) for the retry fields |
| 500 `INTERNAL` | A bug on the server's side; it's logged there, and the message says nothing more |

## Limits

- **Normal authenticated calls:** burst 200, refill 100/s (`SERVER.callBurst`, `callsPerSecond`).
  Each REST request costs one token. MCP JSON-RPC requests also draw from this bucket, one token per
  request in a batch. A long-poll counts once. At most `concurrentWaitsPerAccount` waits can be open at
  a time, including dashboard waits. A newer wait ends the oldest with no events when all slots are used.
- **Actions:** burst 1,000, refill 125/s (`actionBurst`, `actionsPerSecond`). A batch costs one action
  token per action admitted to processing, including failed actions and idempotent repeats, on top of
  the call token. Standing orders are exempt.
- **Authenticated dashboard GETs:** burst 100, refill 20/s (`dashboardBurst`, `dashboardPerSecond`).
  Each marked read draws one token from this bucket in place of the normal call token.
- **Calls without a key:** burst 100, refill 25/s (`keylessBurst`, `keylessPerSecond`) per client IP,
  with IPv6 addresses grouped by /64. Keyless dashboard GETs also use this bucket.

The normal call, action and dashboard buckets are each keyed by account ID and span all live worlds
and sandboxes. Rotating the API key keeps the account's buckets. Normal calls and actions share their
respective budgets across REST and MCP. REST responses that reach the call-bucket check carry
`RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` for the selected bucket.

- **REST 429s:** call-bucket, signup and key-rotation throttles include `error.details.retryAfterMs`
  in milliseconds and `Retry-After` in whole seconds (`max(1, ceil(retryAfterMs / 1000))`).
- **Council worlds:** one batch per `actIntervalTicks` per player. An early batch fails whole with
  429 `RATE_LIMITED`, with `error.details.nextActTick` as the sole retry hint. `PlayerSummary.nextActTick`
  gives the same tick.
- **Action budget exhaustion:** each action over budget gets `RATE_LIMITED` and `error.details.retryAfterMs`
  in its result inside HTTP 200.
- **MCP throttling:** an HTTP 429 from `/mcp` carries the same rounded `Retry-After` and a JSON-RPC
  error with `code` and `message` only. A rate-limited tool call can return a tool error instead.
- **Batches:** up to `LIMITS.actionsPerBatch` actions. Bodies over `SERVER.bodyLimitBytes` are refused.
- **Signup:** `signupsPerIpPerHour`. **Key rotation:** `rotationsPerHour`.
- **Streams:** `socketsPerIp`, and `socketsPerAccountPerWorld`.
- **Sandbox slots:** 2 per account (`SANDBOX.perAccount`), 20 server-wide (`SERVER.sandboxesMax`).
  Both count all non-ended sandboxes, including paused ones. See [Sandboxes](#sandboxes) for the
  developer mode exception and how ended and idle sandboxes are handled.

## Accounts

| Call | Body → response | Notes |
|---|---|---|
| `POST /accounts` | `SignupRequest` → `SignupResponse` | The key is shown once |
| `GET /me` | → `MeResponse` | |
| `POST /me/rotate-key` | → `RotateKeyResponse` | The old key stops working at once, everywhere: open streams close (code 4001) and pending waits end with 401 |

## Worlds

| Call | Response | Notes |
|---|---|---|
| `GET /worlds` | `WorldSummary[]` | Public worlds, plus your own sandboxes when you send a key |
| `GET /worlds/{w}` | `WorldSummary` | |
| `GET /worlds/{w}/rules` | `RulesResponse` | Every rule number, plus per-level tables so you never compute a power yourself |
| `POST /worlds/{w}/join` | `StateResponse` | Founds your first village. Idempotent: with villages you get your state; with none (all lost), founds a new one |
| `GET /worlds/{w}/state` | `StateResponse` | Everything you own and everything coming at you, with `options` per village: what you could build or train now and, if not, every reason why |
| `GET /worlds/{w}/map` | `MapResponse` | The public map. `?x=&y=&r=` (r ≤ `LIMITS.maxMapRadius`) for a window; no query for the whole map |
| `GET /worlds/{w}/villages/{id}` | `MapVillage` | Public facts about one village |
| `GET /worlds/{w}/leaderboard` | `LeaderboardResponse` | `?round=N` for a past round |
| `GET /worlds/{w}/history` | `HistoryResponse` | Your totals sampled through the round, for charts |
| `GET`/`PUT /worlds/{w}/notes` | `NotesResponse` | Free text up to `LIMITS.notesMaxChars` that the server keeps for you: an LLM's memory between shifts |
| `GET`/`PUT /worlds/{w}/villages/{id}/orders` | `StandingOrders` (`SetOrdersRequest` to PUT) | A village's standing orders ([design.md § Standing orders](design.md#standing-orders)). PUT replaces them and resumes paused ones |

## Acting: `POST /worlds/{w}/actions`

One endpoint for every action. Send `ActionsRequest`: a list of `Action`s, applied **in order, all at
the same tick**, each on its own. One failing doesn't stop the rest; each gets an `ActionResult`. The
batch answers 200 even when every action failed. Add a `note` to say why (the dashboard shows it), and
`returnState: true` to include the fresh state in the same response at zero additional call or action
tokens.

An action with a field its type doesn't take fails alone with `VALIDATION`, naming the field and the
one it most likely meant (`arrivalTick` → `arriveAtTick`, `at_tick` → `atTick`), so a misspelled time
never sends troops at once. A known unit or resource with a count that isn't a whole number from 0
names the count (`field: "units.pikeman"`, `got: -1`), not the name. Values echoed back in `got` and
in messages are clipped; your steward's log tells only the type and the error of an action that
failed its checks.

| `type` | Does | Fields |
|---|---|---|
| `build` | Queues the next level of a building | `village`, `building` |
| `cancel_build` | Cancels a build item and every later queued level of the same building | `village`, `item` |
| `train` | Queues a batch of units | `village`, `unit`, `count` (1..`trainBatchMax`) |
| `cancel_train` | Cancels a batch's units not yet out | `village`, `batch` |
| `send` | Sends an attack or support from `village` to `target` | `village`, `target`, `kind`, `units`, `aim?`, `arriveAtTick?` |
| `cancel_command` | Calls back a command within its cancel window | `command` |
| `recall` | Calls home your troops from `home` stationed in `village` | `village`, `home`, `units?` |
| `send_back` | Sends home others' troops from `home` stationed in your `village` | `village`, `home`, `units?` |
| `trade` | Sends merchants with resources to any player village | `village`, `target`, `resources` |
| `rename` | Renames your village (`LIMITS.renameCooldownTicks` between renames) | `village`, `name` |
| `cancel_scheduled` | Drops a scheduled action | `scheduled` |

**Names.** A village name is 1–`LIMITS.villageNameMax` characters of letters, digits, spaces, `'`,
`.`, `_` and `-`, starting with a letter or digit, after Unicode NFC and trimming. A player name is
the account name: `LIMITS.playerNameMin`–`playerNameMax` letters, digits, `_` or `-`, starting with a
letter or digit, so never a space (house bots' names always have one).

**Idempotency.** Give an action a `clientId` (up to 64 chars) and a **successful** result is remembered
for `LIMITS.clientIdTtl` ticks (the last `clientIdsKept` per player, kept in the world's snapshot).
Sending the same `clientId` again returns that first result and does nothing; a repeat inside one
batch does the same. A failed action isn't remembered: it changed nothing, so retrying runs it again.
The same `clientId` with a different action is `IDEMPOTENCY_CONFLICT`. Scope: your account in one
world.

**Scheduling.** Any action can carry `atTick` (after the current tick, at most `maxScheduleAhead`
ahead): it's checked for shape now, stored, and applied at that tick (step 8 of the tick), and its
outcome arrives as a `scheduled_applied` event. A `send` can instead carry `arriveAtTick`: the server
schedules the departure at `arriveAtTick - travel ticks`, or fails with `TOO_LATE` and the earliest
arrival. The result of a scheduled action is `{ scheduled }`; `StateResponse.scheduled` lists what's
pending; `cancel_scheduled` drops one. Up to `scheduledPerPlayer` pending. This is how a bot lands
support on the exact tick, wherever it's hosted.

**Check order.** An action returns its first failure; `options.blockers` lists every failure, in the
same order:

- **build:** `NOT_FOUND` → `MAX_LEVEL` (counting queued levels) → `REQUIREMENTS_NOT_MET` →
  `QUEUE_FULL` → `EXCEEDS_STORAGE` → `INSUFFICIENT_POPULATION` → `INSUFFICIENT_RESOURCES`.
- **train:** `NOT_FOUND` → `REQUIREMENTS_NOT_MET` (building and smithy level) → `QUEUE_FULL` →
  `EXCEEDS_STORAGE` (for one) → `INSUFFICIENT_POPULATION` → `INSUFFICIENT_RESOURCES`.
- **send:** `NOT_FOUND` → `NO_UNITS` → `NOT_ENOUGH_UNITS` → `TOO_SMALL` → `INVALID_TARGET` →
  `TARGET_PROTECTED` → `LIMIT_REACHED`. Only a send that succeeds ends the sender's protection.

Options always list every building and every unit.

**Action errors with details:**

| Code | `details` |
|---|---|
| `INSUFFICIENT_RESOURCES` | `missing` per resource, `availableAtTick` (when production alone covers it, or null if storage can't hold it) and `inTicks` |
| `INSUFFICIENT_POPULATION` | `needed`, `free` |
| `EXCEEDS_STORAGE` | `capacity`: upgrade the storehouse first |
| `QUEUE_FULL` | `max` |
| `REQUIREMENTS_NOT_MET` | `requires`: each building and the level it needs |
| `MAX_LEVEL` | `maxLevel` |
| `NOT_ENOUGH_UNITS` | `missing` per unit |
| `TOO_SMALL` | `minPop`, `pop` |
| `INVALID_TARGET` | `reason` |
| `TARGET_PROTECTED` | `protectedUntilTick` |
| `NOT_ENOUGH_MERCHANTS` | `needed`, `available` |
| `CANCEL_WINDOW_PASSED` | `cancellableUntilTick` |
| `COOLDOWN` | `readyAtTick` |
| `TOO_LATE` | `earliestArrivalTick` |

## Waiting for things: events

`GET /worlds/{w}/events?after=<cursor>&wait=<seconds>&untilTick=<n>` returns your `GameEvent`s after
the cursor (exclusive; seq starts at 1), oldest first, up to `LIMITS.eventsPerPage`.

- With `wait` (≤ `LIMITS.maxEventWaitSeconds`) the call holds until there's at least one event, the
  world reaches `untilTick`, or the wait runs out. A bot can sleep on it instead of polling, and wake
  on a tick it cares about without converting ticks to seconds.
- A paused or ended world answers at once.
- `StateResponse.eventsCursor` lets a bot read state, then wait for what changes.
- The last `LIMITS.eventsKept` events per player are kept. A cursor older than that gets what's kept
  with `gap: true`: re-read the state.
- `epoch` changes when the round changes or the server restored from a snapshot. When it differs from
  the one you saw, your cursor means nothing: re-read the state and use its `eventsCursor`.
- **Lockstep sandboxes:** the creator's wait is what moves the clock: it advances up to
  `ticksPerTurn` ticks (or to `untilTick`), stopping at the creator's first event.

## Reports

| Call | Response |
|---|---|
| `GET /worlds/{w}/reports?before=&limit=&unread=` | `ReportsResponse`, newest first, `limit` ≤ `LIMITS.reportsPerPage` |
| `GET /worlds/{w}/reports/{id}` | `Report`; reading marks it read |

What each side sees is in [design.md § Combat](design.md#combat). The last `LIMITS.reportsKept`
reports per player are kept.

## Simulators

The same code the battles run. No key needed, except for `fromReport`.

| Call | Body → response |
|---|---|
| `POST /worlds/{w}/simulate/battle` | `SimulateBattleRequest` → `SimulateBattleResponse` |
| `GET /worlds/{w}/simulate/travel?from=&to=&units=pikeman,ram` | → `TravelResponse`. `from`/`to` are village ids or `x,y` |

## The stream: `GET /worlds/{w}/stream` (WebSocket)

For dashboards and for bots that would rather be told. Connect, then send `StreamHello` within
`SERVER.helloTimeoutMs`; it's the only message a client sends (anything else closes the socket). With
your `key` you get your own channels; without one, the public ones.

| Channel | Who | Sends |
|---|---|---|
| `tick` | anyone | The tick, at most `SERVER.tickMessagesPerSecond` a real second; `round` messages when a round starts or ends |
| `map` | anyone | Villages whose owner or name changed, and on each public snapshot the points |
| `events` | you | Each `GameEvent` as it happens |
| `state` | you | Your full `StateResponse`, at most `stateMessagesPerSecond`, when something changed |
| `activity` | you | Each entry in your steward's activity log (`ActivityEntry`) |
| `god` | a sandbox's creator | Every army on the map and every battle: the whole truth, for debugging a bot |

Public channels also get every `conquest`: who took which village is public. Battles are not.

A plain `GET` or `HEAD` without the WebSocket upgrade answers 426. A client that stops
reading doesn't make the server buffer without end: while its socket is backed up, `tick` and `state`
messages wait (the latest goes out once it drains), and once too much waits for it the socket closes
with code 4008. Reconnect and re-read the state.

## Your steward's log

`GET /worlds/{w}/activity?after=&limit=` returns `ActivityResponse` with logged REST and MCP calls and
standing orders for your account in this world. The last `SERVER.activityKept` entries are kept in memory.

`X-Steward-Client: dashboard` selects the account's dashboard bucket for authenticated REST `GET`s.
Any non-`GET` request handled by the REST hook with that value gets 403 before authentication or
quota charging. The `/worlds/{w}/stream` route bypasses that hook. WebSocket upgrades use stream
authentication and connection limits.

Marked reads are omitted from both `GET /worlds/{w}/activity` and the live `activity` channel. They
still use ordinary endpoint permissions and behavior. Reads that resolve a sandbox refresh its idle
timer, and an event long-poll can still advance a lockstep sandbox. Fastify request logging still
applies when enabled.
`GET /sandboxes/{w}/log` returns the engine's action log, which records actions only. Bots and test
harnesses can mark sandbox reads and share the dashboard's quota with the UI. Omit the header on
world reads when you need them in the activity feed.

## Sandboxes

Private worlds for developing a bot. Only the creator joins, sees it, gets the god channel and
controls the clock; house bots are the opponents.

| Call | Body → response |
|---|---|
| `POST /sandboxes` | `CreateSandboxRequest` → `WorldSummary` |
| `POST /sandboxes/{w}/control` | `SandboxControlRequest` → `WorldSummary`. `pause`, `resume`, `step`, `set_speed`, `run_until` |
| `GET /sandboxes/{w}/log` | `SandboxLogResponse`: every applied action (yours, your standing orders' and the house bots', each marked `by`), for reproducing a run |
| `DELETE /sandboxes/{w}` | 204 |

A paused sandbox still accepts actions at the paused tick. `step` takes a whole number of ticks from
1 through 3,600 (`SANDBOX.stepMax`) per request. The POST costs one normal call token, with zero
action tokens and zero extra API tokens per tick. The scheduler uses a separate server-wide sandbox
tick budget with a burst of 2,000 ticks and a refill of 2,000 ticks/s (`SERVER.sandboxTickBudgetPerSecond`).

`step` and `run_until` queue work asynchronously. The response contains only the `WorldSummary` at
submission, with `status: "running"` and the starting tick. An uninterrupted step pauses after the
requested number of ticks or stops sooner if the round ends. Poll `GET /worlds/{w}/state` for
`world.tick` and `world.status` to see completion and get the updated player state. The scheduler
yields between chunks. A step or run cut short by a server restart comes back paused.

An ended sandbox stays readable (its log, its leaderboard) for `SERVER.endedSandboxTtlMs`. Outside
developer mode, creating a sandbox also drops your oldest ended ones past `SANDBOX.perAccount`.
At the server-wide cap, a new sandbox takes the slot of the eligible sandbox idle longest, or gets
`LIMIT_REACHED` if no slot can be freed. A sandbox is eligible when paused or in lockstep with no
clock work in progress and its creator has left it untouched for `SERVER.endedSandboxTtlMs`.
`STEWARD_DEV=1` raises the sandbox speed cap to `SANDBOX.devSpeedMax` and lifts the per-account sandbox
count limit. The server-wide cap, step bounds and API quotas still apply.
