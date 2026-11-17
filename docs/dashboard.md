# The dashboard

Where people watch their stewards and optionally give orders themselves. Hybrid mode uses the
player's configured key and the existing gameplay API. The local control process serves the UI
and proxies game traffic; the central game server continues to own all simulation and game state.

## What it shows

**Site access** (`/access/login`)
- Token-only private-site sign-in; no username. All app assets and transports are behind this gate.
- The game-key sign-in remains a separate inner layer. Lock signs out both layers.

**Personal control center** (`/`)
- Existing player only: no public pitch, signup, key generation or onboarding cards.
- Navigation is **Bot**, **Map & commands**, and **Settings**. Bot tabs are **Plan**, **Advisors**,
  **Budgets**, **Execution**, and **Reviews**. The selected tab, plan node, and village are addressed
  by the URL query parameters `tab`, `node`, and `village`.
- Account, selected world, villages, last evaluation and connection status.
- Economic Advisor proposals ranked by score, with reasons, costs, blockers and readiness.
- President's selection/reservation and recent recommendation/submission/outcome history.
- Bot status and automatic execution by the persistent service. Browser tabs never execute advisor loops.
- Estimated cumulative gross production and per-village three-minute supply/cost coverage.
- **Settings** (`/settings`): server origin, selected world and masked key. Reveal/edit are explicit;
  saving changes revalidates the connection and preserves the execution preference; it does not resume
  paused gameplay. Private routes require the configured owner key.
- See [control-center.md](control-center.md) for policy, authentication and persistent execution.

**A world** (`/w/<id>`)
- **Unified main navbar:** Bot, Map & commands and Settings share one full-width bar with
  world and round, tick, time left, speed, connection status and **Town**, **Holdings**, **Army**, **Orders**, **Reports**,
  **Chronicle** and **Standings**. Navigation wraps at narrow widths rather than scrolling
  horizontally. Branding and app links share fixed positions, dimensions and styling with Bot
  and Settings; Lock stays at the far right. Account/player names, village counts and Log are omitted. Steward remains
  accessible through `#steward`. Panel content
  starts directly below the bar. Legacy `#holding` and `#steward` links still work;
  `#command` resolves to Orders (`#orders`).
- **The map fills the screen.** A drawn parchment land (procedural from a hash of the world id and
  round, never the game seed), every
  village as a keep that grows with its points, in its owner's colour. Pan and zoom by mouse, wheel and
  touch. Hover a village for its name, owner and points.
- **Your armies march on it:** attacks, support, returns and merchants move along their routes in
  real time, with the countdown to arrival. **Attacks on you** come in as red arrows from the moment
  they're sent, with the watchtower's sighting once there is one.
- **Battles and conquests** flash where they happen: yours, and every conquest in the world.
- **Town view:** toggled by Town in the top bar, docked below it to the left of the side panel.
  The panel stays visible and usable, including when switching its tabs. Producers form the
  **Fields** district, Storehouse/Cellar/Market form **Stores**, and training buildings and Smithy
  form **Military**. Great Hall is central; Wall and Watchtower sit at the bottom edge. Ground
  shapes, labels, paths and SVG buildings distinguish the districts without external art. Grounds
  fit the column width, capped at 58% of its height, with an undistorted 800:520 map pinned to
  the top and no vertical letterboxing. Building art and labels scale moderately with the map.
  Construction stays beneath it; the combined training queue uses the remaining space and
  scrolls internally when long. Click an
  illustrated building to inspect it in a separate details panel; there is no scrolling building
  strip. A combined training queue below Construction shows all batches across all four training
  buildings, with progress, countdowns and × cancellation regardless of the selected building. Each
  plot shows its current level and active construction progress. The construction bar shows active
  work and waiting orders. Details show the next queueable level, each resource cost and shortfall,
  current and future benefits, requirements only for unconstructed buildings, and a scrollable level table with separate resource,
  time and benefit columns. Each level shows its total effect and marginal improvement from the
  previous level. The compact upgrade card combines next level, costs with highlighted shortfalls,
  time, gain and an Upgrade button. It states the gain for that specific step, even when earlier levels
  are queued. Great Hall details include exact before/after construction times for every building,
  with tick rounding reflected in the savings. Benefits and progression use the live server's public rule tables.
  Barracks, Stable, Siege Workshop and Court details also offer **Train**: each matching unit's
  home count, cost, count input and Train button use the village's training options. That building's
  training queue uses the same compact rows as the build queue: unit, completed/total, inline
  progress, completion countdown and × cancellation. Holdings and the combined Town queue reuse
  the same row component; no Next/Waiting labels hang outside the row.
  Market details reuse the Orders **Send resources** form: own other villages only, merchant
  availability/capacity, resource availability, max helpers and stock/capacity clamping. Outgoing
  trades from this village show their destination, cargo and arrival/return countdown.
  Queue and cancel upgrades or training through the same gameplay API; bots continue running. On phones,
  choosing a building scrolls to its details; a back button returns to the village grounds.
  The window closes with its close button or Escape and is available only for your own villages.
- **Join world:** an authenticated spectator can found a village through the usual join API.
- **The side panel** (selected through the top bar):
  - **Orders:** send attacks/scouting/support and resources, cancel builds/training/marches/scheduled
    actions, recall support and send it back. Build, training and rename forms are not part of Orders.
    March targets are grouped into **Allied** and **Enemy & hamlets**, each sorted by distance.
    Resource targets are only your other villages; the form is shared with Town Market details.
    Available merchants, carry capacity, source
    resources and per-resource max helpers make transfer limits visible. A selected map village
    fills the mission target.
  - **Holdings:** village header, **Stores**, **Buildings**, **Units**, **Build queue**, then
    **Training**. Stores show resources against storage, production, population and merchants.
    Clicking a compact building tile queues its next level; hover for next level, costs, time and
    blockers. The four-column grid shows names, levels, queued levels and thin level bars.
    Unavailable tiles keep their name and level legible and use a not-allowed cursor.
    Every unit type has home/total/training counts, with away
    troops included in the total. Compact two-column unit tiles have small SVG icons and
    home/total plus training counts; select a tile to reveal its count input and Train button.
    Locked tiles are disabled; missing prerequisites stay in tooltips, not on tiles. Build and training queues
    sit at the bottom, each row offering × cancellation.
  - **Army:** troops home and away, support in and out, every command with its countdown.
  - **Steward (`#steward`):** the live log of every call your bot made (REST, MCP and standing orders): time,
    call, status, latency, the batch's note in italics, and one line per action with its error code
    when it failed. Above it, the steward's **notes** and each village's **standing orders**. The best
    way to see what your code is actually doing.
  - **Reports:** battle and scouting reports, opened in full.
  - **Chronicle:** charts over the round: points, resources, production, army size, renown.
  - **Standings:** the leaderboard.
- **Manual actions** in Orders, Holdings and Town share submission and feedback handling. Costs,
  availability and blockers come from state options. Council-turn cooldowns and ended rounds
  disable new actions. Commands do not pause bots or standing orders; all share resources and
  Council turns. Every submission has unique client IDs; retries after uncertain transport
  failures reuse them. A 200 response is checked for per-action failures before showing success.
  Town details name missing unit/building prerequisites inline with their required levels;
  Holdings keeps those requirements in tooltips. Other blockers remain visible.
- **Sandbox controls** for its creator: pause, resume, step N ticks, speed, and the **god view** that
  draws every army on the map. A **lockstep** sandbox moves only while its creator waits for events, so
  its clock shows as lockstep, never runs ahead of the server, and counts down in ticks, not time.

## The information rule

The dashboard shows exactly what the API would show the key it was given, and nothing more.

- **Without a key:** the public map, the leaderboard, conquests. No armies, no battles.
- **With a key:** that player's own world as the API shows it, plus the public layer.
- **God view:** only for a sandbox's creator.

A bot must never gain anything by reading the dashboard's traffic, so the dashboard only ever calls
public endpoints and the key's own. It marks only reads with `X-Steward-Client: dashboard`.
Manual writes omit that header, use the steward's normal rate limits, and appear in the activity log with a manual-command note.

**Names are text.** Player and village names are rendered as text only, never as HTML. The server
sends a Content-Security-Policy that allows scripts only from itself.

## How it looks

A night-time ledger: deep ink background, parchment map, gold for you, ember red for attacks, steel
blue for support, amber for merchants. Cinzel for headings, Inter for text, JetBrains Mono for the
steward log. Dark only. Works at phone width (the panel becomes a bottom sheet). Motion is smooth and
purposeful: armies glide, battles burst, nothing bounces. No art from anyone else's game.
