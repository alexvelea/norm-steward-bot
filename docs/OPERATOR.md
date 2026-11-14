# Personal game operator handoff

Use this file as instructions for an agent handling Alex's explicit, ad hoc game commands.
Read AGENTS.md, docs/api.md and the current control-center status before acting.
This repository is a client of the remote game, not its engine.

## Authority and boundaries

- Follow Alex's current request: scouting, recalling support, or moving a specified army is not
  permission to attack with combat troops, spend resources, enable automation, or run indefinitely.
- The President owns automated economic construction. Do not start a starter bot or a second
  economic loop. Manual orders share resources, troops, queues and Council turns with it.
- Read fresh state before each action. Match names to IDs, check ownership and available home
  troops, and resolve ambiguous targets before sending anything.
- Keep credentials out of commands, chat, logs, repository files and commits. On this machine the
  persistent connection is in /var/lib/norm-steward-bot/control.json under settings (serverUrl,
  worldId, apiKey). Read it privately inside a script, never print its credentials. /root/key.txt is
  the bootstrap fallback only; it may differ after a Settings edit. Do not assume a world or round.
- Use the existing REST action endpoint with a unique clientId per intended action. Persist the
  intended request privately before sending. Retry an uncertain result with exactly the same ID
  and payload; do not issue a new order just because a network request timed out.
- HTTP 200 does not imply success: inspect every results[].ok and its error. Respect Retry-After,
  nextActTick and per-action errors. Do not guess that an order succeeded.
- Never infer hidden troops from the map. Reports are snapshots, not live truth.

## Read / act / report

1. GET /api/v1/me and /worlds to verify the account and selected world.
2. GET /worlds/{w}/state and /map. For mechanics, GET /rules; use live options and tables.
3. POST /worlds/{w}/actions with {actions:[...],returnState:true,note:"Manual operator: ..."}.
   Authenticate with Authorization: Bearer <key>. Reads may carry X-Steward-Client: dashboard;
   writes must never carry that header.
4. Record accepted command IDs and arrival ticks. Wait using /events with after, wait<=25 and
   untilTick; then read /reports, matching commandId, and fetch the matching full reports.
5. Tell Alex what was accepted, losses, findings and arrival times. Distinguish dispatched,
   arrived, reported and returned. If a timing window was missed, say so; do not pretend otherwise.

## Recipes (fields inside actions[])

Scout a village (scout-only attack performs scouting):
    {type:"send",village:HOME_ID,target:TARGET_ID,kind:"attack",units:{scout:COUNT},clientId:ID}

Recall all of our support stationed elsewhere:
    {type:"recall",village:HOST_ID,home:HOME_ID,clientId:ID}
The village field is where the troops are stationed; home is their original village.

Send specified troops as support:
    {type:"send",village:HOME_ID,target:OWNED_TARGET_ID,kind:"support",units:{...},clientId:ID}
Confirm the destination is appropriate: supporting an enemy strengthens that enemy after arrival.
Unowned hamlets are not safe support destinations.

Timed dodge before an incoming attack:
- Check incoming arrivalTick immediately; a scouting command is also labelled "attack".
- Schedule support using atTick: arrivalTick-5, only if that tick is still in the future.
- Explicitly choose a valid destination. Never substitute a combat attack for support.
- Scheduled unit counts are fixed. Include only troops available at departure; account for
  training completions and do not silently leave part of the requested force behind.
- Once impact has passed, cancel the travelling support command while cancellableUntilTick allows
  it, or recall after arrival. Check all attack waves before bringing troops back.
- Do not wait on unrelated long polls while a departure deadline is imminent.

Raiding assessment:
- Scout first; walls are not the only defence. Unowned hamlets have base defence plus regenerating
  militia, even when the report shows zero troops. Militia resets after a lost combat battle.
- Use /simulate/battle. A fromReport simulation does not automatically account for hamlet militia:
  pass an explicit conservative baseDefense from the live rules. State assumptions and losses.
- A scouting request does not authorize a raid.

## Suggested task prompt

"Read docs/OPERATOR.md in /root/norm-steward-bot. Use the configured account and selected world.
[Describe the exact command and targets.] Verify state first, perform only that operation, wait
for the relevant result, and report what actually happened. Do not enable economic automation."


## Model choice (reviewed 2026-11-14)

Start with GPT-6 Luna for bounded operator commands such as scouting named targets and recalling
support. Use GPT-6.1 Sol for more involved tactical coordination and interpreting ambiguous state.
This is a workload recommendation, not a guarantee: test the agent on synthetic requests first,
and leave exact timing to the game's scheduled-action fields instead of model response latency.
Official model guide: https://developers.openai.com/api/docs/models
No model is used by the Economic Advisor or President.
