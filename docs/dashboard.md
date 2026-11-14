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
- Account, selected world, villages, last evaluation and connection status.
- Economic Advisor proposals ranked by score, with reasons, costs, blockers and readiness.
- President's selection/reservation and recent recommendation/submission/outcome history.
- Explicit automatic execution toggle, off by default. Browser tabs never execute advisor loops.
- **Settings** (`/settings`): server origin, selected world and masked key. Reveal/edit are explicit;
  saving changes pauses automatic execution. Private routes require the configured owner key.
- See [control-center.md](control-center.md) for policy, authentication and persistent execution.

**A world** (`/w/<id>`)
- **The map fills the screen.** A drawn parchment land (procedural from a hash of the world id and
  round, never the game seed), every
  village as a keep that grows with its points, in its owner's colour. Pan and zoom by mouse, wheel and
  touch. Hover a village for its name, owner and points.
- **Your armies march on it:** attacks, support, returns and merchants move along their routes in
  real time, with the countdown to arrival. **Attacks on you** come in as red arrows from the moment
  they're sent, with the watchtower's sighting once there is one.
- **Battles and conquests** flash where they happen: yours, and every conquest in the world.
- **Town view:** a floating village window opened from the world bar or the Town button. Click an
  illustrated building or its building-strip tile to inspect it in a separate details panel. Each
  plot shows its current level and active construction progress. The construction bar shows active
  work and waiting orders. Details show the next queueable level, each resource cost and shortfall,
  current and future benefits, requirements and a scrollable level table with separate resource,
  time and benefit columns. Each level shows its total effect and marginal improvement from the
  previous level. The upgrade card states the gain for that specific step, even when earlier levels
  are queued. Great Hall details include exact before/after construction times for every building,
  with tick rounding reflected in the savings. Benefits and progression use the live server's public rule tables.
  Queue and cancel upgrades through the same gameplay API; bots continue running. On phones,
  choosing a building scrolls to its details; a back button returns to the village grounds.
  The window closes with its close button or Escape and is available only for your own villages.
- **Join world:** an authenticated spectator can found a village through the usual join API.
- **The side panel** (tabs):
  - **Command:** queue building upgrades and training, send attacks/scouting/support, trade resources,
    rename, cancel builds/training/marches/scheduled actions, recall support and send it back. Costs,
    availability and blockers come from state options. A selected map village fills the mission target.
    Manual commands do not pause bots or standing orders; all share resources and Council turns.
    Every submission has unique client IDs; retries after uncertain transport failures reuse them.
    A 200 response is checked for per-action failures before showing success.
  - **Holding:** each village's resources against storage, production, population, buildings by
    level, the build queue as a timeline and each training queue.
  - **Army:** troops home and away, support in and out, every command with its countdown.
  - **Steward:** the live log of every call your bot made (REST, MCP and standing orders): time,
    call, status, latency, the batch's note in italics, and one line per action with its error code
    when it failed. Above it, the steward's **notes** and each village's **standing orders**. The best
    way to see what your code is actually doing.
  - **Reports:** battle and scouting reports, opened in full.
  - **Chronicle:** charts over the round: points, resources, production, army size, renown.
  - **Standings:** the leaderboard.
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
