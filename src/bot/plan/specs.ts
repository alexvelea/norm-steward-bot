/** Written rules per plan node: what an action under this node may do and why.
 * Agents audit journalled actions against this text; code should follow it. */
export interface NodeSpec {
  intent: string;
  eligible?: readonly string[];
  priority?: readonly string[];
  never?: readonly string[];
}

export const SPECS: Readonly<Record<string, NodeSpec>> = {
  "economy.lumberyard": {
    intent: "Grow timber production in the capital.",
    eligible: ["Below the producer policy ceiling.", "Production payback holds before round end."],
    priority: [
      "Below the next milestone (5, 8, 10): 85 before level 5, else 75, minus 1 per producer with lower coverage ranked ahead.",
      "At or above the milestone: 60 minus 10 per rank.",
      "82 minus rank when the 3Pi1Sh cohort needs more of this resource than 80% of production.",
    ],
  },
  "economy.balance": {
    intent: "Keep the three resources balanced so one shortage does not stall every build.",
    eligible: [
      "For each resource: stock minutes = stock / production per minute.",
      "A resource lags when its stock minutes are 5 or more below the average of the other two.",
    ],
    priority: ["The lagging resource's producer scores 90, plus 1 per further 5 minutes of lag, up to 99 (the higher of this and its normal score)."],
  },
  "economy.farm": {
    intent: "Keep enough free population for queued work and the defence cohort.",
    eligible: ["Free population below max(50, 20% of the limit), or a cohort would not fit after the Farm completes."],
    priority: ["100 when no population is free.", "95 when below the buffer.", "20 otherwise (not executed)."],
  },
  "economy.storehouse": {
    intent: "Avoid wasting income on full storage.",
    eligible: ["Stock plus up to 300 ticks of income (after troop burn) exceeds storage for any resource."],
    priority: ["90 plus up to 9 by how far the forecast exceeds storage.", "25 otherwise (not executed)."],
  },
  "economy.cellar": {
    intent: "Hide one minute (60 ticks) of production from raids.",
    eligible: ["All producers at least level 5.", "Cellar hides less than 60 ticks of the largest production."],
    priority: ["80 when eligible.", "25 otherwise (not executed)."],
  },
  "economy.hall": {
    intent: "Buy construction speed only when it pays back.",
    eligible: [
      "Producers at level 8 or more; Hall below 5 is a fixed milestone.",
      "Beyond that, the simulated build plan finishes sooner with the Hall first.",
    ],
    priority: ["86 for the Hall 5 milestone.", "70 to 79 by the share of build time saved.", "At most 69 while the defence cohort is active.", "30 when it does not pay back."],
    never: ["Never deferred because an attack is incoming."],
  },
  "defense.cohort": {
    intent: "Keep training 3 Pikemen and 1 Shieldman per batch once defence is ready.",
    priority: ["100 while a paid cohort is in progress.", "70 to start a new one."],
    never: ["Never replace troops lost in battle."],
  },
  "first-conquest": {
    intent: "Meet every building requirement for conquest in the capital.",
    eligible: ["Producers at level 15."],
    priority: ["Mission tasks compete with every other task through the President (88 to 96); the capital saves for them when they are its top need."],
    never: ["Never pause or exclude the capital's other tasks; conquest is an operation on top of normal production."],
  },
  "conquest.enabled": {
    intent: "Hall 13, Barracks 10, Smithy 10, Market 5 and Court all built; the Envoy can be trained.",
  },
  "conquest.dispatch": {
    intent: "Capture the nearest unowned village with the Envoy and escort.",
    eligible: ["Escort and Envoy at home.", "Fresh ownership and battle simulation show the Envoy survives."],
    priority: ["94."],
    never: ["Never more than six waves.", "Never reuse the Envoy before the previous battle is confirmed."],
  },
  roles: {
    intent: "Give every city a role without any operator input.",
    eligible: [
      "Capital: the origin of the first conquest; if it is lost, the oldest remaining city.",
      "Economic: every other city, from the tick it is captured.",
    ],
    never: ["Never change a role manually or from the dashboard."],
  },
  logistics: {
    intent: "Fulfil what economic cities request; they decide what they need and how urgent it is.",
    eligible: ["Capital has Market 5 (13 merchants of 1,000 each)."],
  },
  "logistics.fulfil": {
    intent: "Turn open requests into trades, one resource per trade, so a shortage of one resource never blocks the others.",
    eligible: ["An open request for that resource.", "No trade from the capital to that city already carrying that resource."],
    priority: [
      "Uses the request's own score.",
      "Competes with the capital's builds through the President: if the capital's top need scores higher and is short on resources, the capital saves and the request waits.",
    ],
    never: ["Never ship from the capital's saving reservation.", "Never send more than the receiver can store."],
  },
  "economic-city": {
    intent: "Turn a captured city into an economy as fast as possible by pulling resources from the capital.",
    eligible: ["City role is economic."],
    never: ["Never run the capital's economy, defence or conquest branches in this city."],
  },
  "econ.build-order": {
    intent: "Fixed build order; resources come from requests, so the Hall can be built nearly continuously.",
    eligible: ["Each step starts only after the previous step is done.", "Farm and Storehouse may interrupt only when they block the next step."],
    never: ["Never skip ahead to a later step."],
  },
  "econ.cellar3": { intent: "Cheap first protection: Cellar 3 hides 796 of each resource.", priority: ["Step 1."] },
  "econ.hall5": { intent: "First construction speed-up.", priority: ["Step 2."] },
  "econ.cellar-cover": {
    intent: "Raise the Cellar until it hides the stock the requests keep: Cellar 7 hides 2,491, above the 2,000 top-up.",
    eligible: ["A larger top-up level (Request L2) raises the target."],
    priority: ["Step 3."],
  },
  "econ.hall13": {
    intent: "Build the Hall continuously with pulled resources up to 13: about 47% faster construction.",
    priority: ["Step 4.", "Stop at 13: Hall 15 adds only about 9% more for roughly 4,000 extra of each resource."],
  },
  "econ.cellar10": { intent: "Cellar 10 hides 5,860 of each resource.", priority: ["Step 5, after Hall 13."] },
  "econ.storehouse3": { intent: "Storehouse 3 holds 5,358 of each resource.", priority: ["Step 6, after Cellar 10."] },
  "econ.storage-growth": {
    intent: "Grow storage with the city's needs once the build order is done.",
    eligible: [
      "Stock plus shipments in flight plus 300 ticks of income would exceed storage, or the next build does not fit.",
      "Cellar: raise it whenever protection falls below the stock the city keeps.",
    ],
    never: ["Never grow storage ahead of need."],
  },
  "econ.market-growth": {
    intent: "Merchant capacity follows shipping demand.",
    eligible: ["Market 1 once producers reach level 5.", "Further levels only once this city fulfils overflow requests (later)."],
  },
  "logistics.market-growth": {
    intent: "Raise the capital's Market when merchants are the bottleneck for fulfilling requests.",
    eligible: ["The open requests together need more merchants than the Market has in total."],
    priority: ["Scored like the highest open request it unblocks."],
  },
  "econ.balance": {
    intent: "Same balance rule as the capital, once setup is done.",
    priority: ["The boost (90 to 99) is not capped by the economic-city producer score of 65."],
  },
  "econ.setup-done": {
    intent: "Marks the end of the build order; producers, storage growth and Market growth start here.",
    eligible: ["Every build-order step has reached its level."],
  },
  "econ.producers": {
    intent: "After the build order, grow all three producers using the capital's payback rule.",
    eligible: ["Setup done."],
  },
  "econ.farm": { intent: "Only unblock population.", eligible: ["Free population is too low for the next step."] },
  "econ.storehouse": {
    intent: "Only unblock storage during the build order; afterwards follow the storage policy.",
    eligible: ["The next step's cost or the request's top-up level does not fit in storage."],
  },
  "econ.no-military": {
    intent: "Spend economic cities' resources only on the economy.",
    never: ["Never build Barracks, Smithy, Stable or Walls.", "Never train troops."],
  },
  "econ.market": {
    intent: "Prepare to fulfil the capital's overflow requests later.",
    eligible: ["All three producers at level 5."],
  },
  "econ.requests": {
    intent: "The economic city publishes what it needs; the capital fulfils it. The game only allows pushing, so requests live only inside the bot.",
    never: ["A request never submits an action by itself."],
  },
  "econ.request-resources": {
    intent: "Ask the capital for each resource separately, with a buffer that grows with the city's stage.",
    eligible: [
      "Setup (build order not done): a resource below 1,000 is topped up to 2,000.",
      "Growth (setup done, producers below 10): a resource below 2,000 is topped up to 4,000.",
      "Developed (producers 10 or more): same buffer as growth.",
      "Top-ups never exceed storage; nothing is requested for a resource already in flight from the capital.",
    ],
    priority: ["Setup 95 (as soon as possible).", "Growth 85.", "Developed 40: only when the capital has nothing more important.", "With several economic cities, the youngest wins."],
  },

  expansion: {
    intent: "Conquer cities one at a time: first the nearest unowned village, then the next ones once existing cities are developed.",
    eligible: ["Conquest enabled.", "No other conquest in progress."],
    never: ["Never hold the capital's production while waves are prepared or in flight."],
  },
  "expansion.next": {
    intent: "Repeat the capture for the next city.",
    eligible: ["First city captured."],
  },
  "expansion.readiness": {
    intent: "Only start the next conquest once existing cities are developed.",
    eligible: [
      "The previous conquest has ended (captured or stopped).",
      "Every economic city has Great Hall 10.",
      "Capital has a Court and 150 Pikemen at home; no standing orders.",
    ],
    never: ["Never train an Envoy for the next city before these hold."],
  },
  "expansion.escort": {
    intent: "The simulated escort must be at home; before the first wave, train only the missing Raiders (survivors from earlier conquests count).",
    never: ["Never send troops the defence cohort counts as home defence."],
  },
  "expansion.dispatch": {
    intent: "Same dispatch rules as the first conquest.",
    priority: ["94."],
    never: ["Never more than six waves per target.", "Never target an owned village."],
  },
  "expansion.captured": {
    intent: "Fresh ownership of the target completes the instance; the city is tagged economic.",
  },
};
