# Personal control center: first iteration

This process is a client of the existing game. It contains no simulation, game clock, game account
store or game persistence. The private file is local client configuration and execution bookkeeping.
No LLM, model key, prompt or inference service participates in economic decisions.

## Advisor contract and President

`src/advisors/types.ts` defines a small synchronous interface: evaluate live state and rules, return
proposals. Each proposal names its advisor, village, action, target level, importance (0–100),
reason, per-resource requirements, blockers, affordability tick, and ready/waiting/queued status.
Future army/war advisors can implement the same interface. Only Economic Advisor is registered.
The President is a sorted filter, not a planner. It submits at most one build per ten-second cycle.
This first executor tracks one global operation until completion, so multi-village construction is
conservative: an accepted advisor build finishes before another advisor build is submitted.

The Economic Advisor considers Great Hall, lumberyard, quarry, mine, storehouse, cellar and farm.
The server's build options determine cost, prerequisites, affordability and next level. The live
rules tables determine hall time savings (excluding the hall upgrade itself and maxed buildings); no game rule is changed in this repository.

Scores are deterministic integers:

| Candidate | Importance policy |
|---|---|
| Farm | 100 at no free population; 95 with <= max(10, 8% capacity) free; 75 with <=20% free; otherwise 20 |
| Storehouse | 99 when an economic upgrade exceeds capacity; 98 at >=95% full; 90 at >=85%; 86 if production fills a store within 120 ticks; 65 at >=65%; otherwise 25 |
| Resource producer | 40 + round(25 × production deficit relative to fastest resource) + round(14 × stock shortfall relative to largest economic upgrade bill), capped at 79 |
| Great Hall | 30 + min(45, round(35 × ticks saved across other non-maxed economic candidates / hall upgrade duration)) |
| Cellar | 85 when an incoming attack exists and resources are exposed; otherwise 40 if exposure exceeds half storage, else 25. Incoming scouting also counts as an attack in the available state |

90–100 = urgent; 70–89 = important, save resources; 40–69 = useful; 0–39 = discretionary.
Ties use village ID, then building ID. Every recommendation explains its numbers and tradeoff.
Population includes the server's reserved construction and training population.

## Allocation and waiting

- Affordability is per village. Resources are never pooled or automatically traded.
- Existing construction blocks additional advisor builds in that village. The first iteration keeps
  queues shallow rather than paying in advance for a long speculative plan. Existing queued levels
  are displayed as queued, not proposed again.
- Standing build orders block advisor construction in that village. The operator must choose which
  economic controller to run; this application never silently removes existing orders.
- If an important proposal (>=70) is blocked **only** by resources and no equal/higher-priority action
  is ready, reserve that village's resources. Do not buy a lower-priority upgrade. Another village
  may still spend its own resources.
- Below 70, the President may choose the highest-ranked affordable upgrade instead of waiting for
  an expensive discretionary one. It does not save indefinitely for impossible prerequisites.
- Council cooldown, ended rounds, missing prerequisites and full queues are explicit waiting states.
- Decisions are short-term heuristics, not ROI-optimal planning. Army needs and market exchanges are
  not modelled yet. Manual orders and other clients can still consume the same resources.

## Execution and recovery

Only the persistent local Node service evaluates and executes. Browsers poll a read-only snapshot;
refreshing, multiple tabs and closing the browser do not create or stop executors. The loopback
executor lease (port 8790) prevents a second production process from starting, even at another HTTP
port, and is released by the OS after crashes. Do not override this port for another live executor.

Recommendation-only is the startup default, including after restarts. Automatic execution requires
an explicit toggle and acknowledgement that competing economic bots have been stopped. Disabling
it stops new advisor submissions; accepted construction continues in the game.

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
waiting and cancelled. Accepted means queued. Confirmed means a fresh state reached the accepted
level after its queue item disappeared. If it disappears without that level, record cancellation.
The last 100 decisions and any pending request survive restarts in `control.json` (mode 0600).

## Existing starter bots and operator agent

Stop `npm run bot`, the Python starter and LLM shift runners for this account before automatic mode.
Those independent processes can compete even if the browser is closed. The acknowledgement is a
human assertion, not proof; a bot running on another machine cannot be detected reliably. Current
server standing build orders are detected and block this advisor per village.
Manual gameplay remains available. Its writes use normal API limits and appear in the game's
activity stream; the President revalidates on the next cycle. Ad hoc operator instructions are in
[OPERATOR.md](OPERATOR.md); that agent must not launch another economic loop.

## Local control API and credentials

`POST /control/session` authenticates the configured player key and issues an HttpOnly,
SameSite=Strict session cookie. Settings/key/state endpoints are private. Mutations reject foreign
Origin headers. No key is embedded in assets or ordinary snapshots; Settings reveals it only on
an explicit authenticated POST. Existing browser key storage is preserved for compatibility.
The game proxy uses the configured server/key, including the WebSocket hello, so browser tabs do
not accidentally switch the service's account by forwarding an old Authorization header.

- GET /control/state: masked settings, advisor status, recommendations and journal.
- PUT /control/settings: origin, player key (optional replacement), world; always pauses automation.
- PUT /control/automatic: enabled boolean; enabling also requires acknowledgeExclusive:true.
- POST /control/evaluate: refresh now; still no execution in recommendation-only mode.
- POST /control/key: explicitly reveal the saved key to the authenticated operator.
- POST /control/pending/resolve: clear an uncertain request only while paused, after explicitly acknowledging activity-log inspection; does not cancel accepted work.
- POST /control/logout: invalidate this browser session.

Initialize the owner key locally using STEWARD_KEY_FILE or STEWARD_KEY. There is no public signup
or first-visitor claim flow. Local files are trusted operator storage, not encrypted at rest; protect
machine access. Keep credentials, runtime files, browser captures and logs out of Git.
