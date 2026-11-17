# Bot plan

Generated from `src/bot/plan/graph.ts` by `npm run plan:doc`.

## Changing the plan

Propose changes as edits to the nodes and edges in `src/bot/plan/graph.ts`. Update the diagram first by running `npm run plan:doc`, then make advisors and the evaluator match the graph.

Node kinds: objective is the top-level outcome; mission is durable strategic intent; group organizes work; task is continuous actionable work; milestone is a measured goal; policy describes a decision rule; capability marks supported or unavailable behavior.

Edges: contains organizes the plan tree; requires gates a dependent on a prerequisite and points from prerequisite (`from`) to dependent (`to`); contributesTo links work that contributes to an outcome without defining containment or a gate.

```mermaid
flowchart TD
  classDef objective fill:#dbeafe,stroke:#475569,color:#0f172a;
  classDef mission fill:#e0e7ff,stroke:#475569,color:#0f172a;
  classDef group fill:#f3e8ff,stroke:#475569,color:#0f172a;
  classDef task fill:#dcfce7,stroke:#475569,color:#0f172a;
  classDef milestone fill:#fef3c7,stroke:#475569,color:#0f172a;
  classDef policy fill:#ffedd5,stroke:#475569,color:#0f172a;
  classDef capability fill:#fee2e2,stroke:#475569,color:#0f172a;
  n0["Complete the round<br/><small>round · objective</small>"]
  n1["Develop the economy<br/><small>economy · mission</small>"]
  n2["Resource producers<br/><small>economy.producers · group</small>"]
  n3["Lumberyard<br/><small>economy.lumberyard · task</small>"]
  n4["Quarry<br/><small>economy.quarry · task</small>"]
  n5["Iron mine<br/><small>economy.mine · task</small>"]
  n6["Resource balance<br/><small>economy.balance · policy</small>"]
  n7["Producers at level 5<br/><small>economy.producers.5 · milestone</small>"]
  n8["Producers at level 8<br/><small>economy.producers.8 · milestone</small>"]
  n9["Producers at level 10<br/><small>economy.producers.10 · milestone</small>"]
  n10["Producers at level 15<br/><small>economy.producers.15 · milestone</small>"]
  n11["Producers at level 20<br/><small>economy.producers.20 · milestone</small>"]
  n12["Capacity and protection<br/><small>economy.capacity · group</small>"]
  n13["Farm capacity<br/><small>economy.farm · task</small>"]
  n14["Storehouse overflow<br/><small>economy.storehouse · task</small>"]
  n15["Cellar protection<br/><small>economy.cellar · task</small>"]
  n16["Great Hall<br/><small>economy.hall · task</small>"]
  n17["Early-build successor window<br/><small>economy.successor-window · policy</small>"]
  n18["Production payback<br/><small>economy.payback · policy</small>"]
  n19["Round-end completion<br/><small>economy.round-end · policy</small>"]
  n20["Great Hall push<br/><small>economy.hall-push · policy</small>"]
  n21["Military<br/><small>defense · mission</small>"]
  n22["First Barracks<br/><small>defense.barracks1 · task</small>"]
  n23["Defensive Smithy<br/><small>defense.smithy1 · task</small>"]
  n24["Military development work<br/><small>defense.development · task</small>"]
  n25["Barracks 3<br/><small>defense.barracks3 · task</small>"]
  n26["Garrison<br/><small>military.garrison · group</small>"]
  n27["250 Pikemen per city<br/><small>military.pikemen-baseline · task</small>"]
  n28["Capital holds 3× any city<br/><small>military.defence-scale · policy</small>"]
  n29["Barracks grows when troops lag<br/><small>military.barracks-growth · task</small>"]
  n30["Attack force<br/><small>military.army · group</small>"]
  n31["Raider force<br/><small>military.raiders · task</small>"]
  n32["Scouts<br/><small>military.scouts · task</small>"]
  n33["Wall capped at 10<br/><small>military.wall-cap · policy</small>"]
  n34["Workshop siege<br/><small>military.workshop · capability</small>"]
  n35["Enable conquest<br/><small>first-conquest · mission</small>"]
  n36["Conquest infrastructure<br/><small>conquest.infrastructure · group</small>"]
  n37["Great Hall 13<br/><small>conquest.hall13 · task</small>"]
  n38["Barracks 10<br/><small>conquest.barracks10 · task</small>"]
  n39["Smithy 10<br/><small>conquest.smithy10 · task</small>"]
  n40["Market 5<br/><small>conquest.market5 · task</small>"]
  n41["Court<br/><small>conquest.court · task</small>"]
  n42["Conquest capacity prerequisite<br/><small>conquest.capacity · task</small>"]
  n43["Producer funding fallback<br/><small>conquest.producer-funding · policy</small>"]
  n44["Conquest producer investment<br/><small>conquest.producer-investment · task</small>"]
  n45["Conquest enabled<br/><small>conquest.enabled · milestone</small>"]
  n46["Expansion<br/><small>expansion · mission</small>"]
  n47["Prepare Raider escort<br/><small>conquest.escort · task</small>"]
  n48["Prepare Envoy<br/><small>conquest.envoy · task</small>"]
  n49["Dispatch conquest wave<br/><small>conquest.dispatch · task</small>"]
  n50["Target owned<br/><small>conquest.target-owned · milestone</small>"]
  n51["First city captured<br/><small>conquest.first-achieved · milestone</small>"]
  n52["Recall the escort<br/><small>expansion.recall · task</small>"]
  n53["Parallel mission budgets<br/><small>capability.parallel-budgets · capability</small>"]
  n54["Multiple submissions per cycle<br/><small>capability.multi-submit · capability</small>"]
  n55["City roles<br/><small>roles · policy</small>"]
  n56["Supply economic cities<br/><small>logistics · mission</small>"]
  n57["Fulfil requests<br/><small>logistics.fulfil · task</small>"]
  n58["Economic city<br/><small>economic-city · mission</small>"]
  n59["Build order<br/><small>econ.build-order · group</small>"]
  n60["1. Cellar 3<br/><small>econ.cellar3 · task</small>"]
  n61["2. Great Hall 5<br/><small>econ.hall5 · task</small>"]
  n62["3. Cellar covers requested stock<br/><small>econ.cellar-cover · task</small>"]
  n63["4. Great Hall 13<br/><small>econ.hall13 · task</small>"]
  n64["5. Cellar 10<br/><small>econ.cellar10 · task</small>"]
  n65["6. Storehouse 3<br/><small>econ.storehouse3 · task</small>"]
  n66["Setup done<br/><small>econ.setup-done · milestone</small>"]
  n67["Producers<br/><small>econ.producers · group</small>"]
  n68["Lumberyard<br/><small>econ.lumberyard · task</small>"]
  n69["Quarry<br/><small>econ.quarry · task</small>"]
  n70["Iron mine<br/><small>econ.mine · task</small>"]
  n71["Resource balance<br/><small>econ.balance · policy</small>"]
  n72["Producers at level 5<br/><small>econ.producers.5 · milestone</small>"]
  n73["Producers at level 10<br/><small>econ.producers.10 · milestone</small>"]
  n74["Producers 11–25<br/><small>econ.producers-late · group</small>"]
  n75["Lumberyard<br/><small>econ.lumberyard25 · task</small>"]
  n76["Quarry<br/><small>econ.quarry25 · task</small>"]
  n77["Iron mine<br/><small>econ.mine25 · task</small>"]
  n78["Producers at level 25<br/><small>econ.producers.25 · milestone</small>"]
  n79["Farm when blocked<br/><small>econ.farm · task</small>"]
  n80["Storage grows when needed<br/><small>econ.storage-growth · policy</small>"]
  n81["Storehouse<br/><small>econ.storehouse · task</small>"]
  n82["Cellar follows storage<br/><small>econ.cellar · task</small>"]
  n83["Market grows when needed<br/><small>econ.market-growth · policy</small>"]
  n84["No military<br/><small>econ.no-military · policy</small>"]
  n85["Market<br/><small>econ.market · task</small>"]
  n86["Market grows when needed<br/><small>logistics.market-growth · task</small>"]
  n87["Requests to the capital<br/><small>econ.requests · group</small>"]
  n88["Request resources<br/><small>econ.request-resources · task</small>"]
  n89["Request defenders<br/><small>econ.request-defenders · task</small>"]
  n90["Request scouts<br/><small>econ.request-scouts · task</small>"]
  n91["Fulfil capital overflow requests<br/><small>econ.overflow · capability</small>"]
  n92["Wall 10<br/><small>econ.wall10 · task</small>"]
  n93["Next cities<br/><small>expansion.next · group</small>"]
  n94["Expansion readiness<br/><small>expansion.readiness · policy</small>"]
  n95["Train next Envoy<br/><small>expansion.envoy · task</small>"]
  n96["Escort army at home<br/><small>expansion.escort · task</small>"]
  n97["Dispatch waves<br/><small>expansion.dispatch · task</small>"]
  n98["Target captured<br/><small>expansion.captured · milestone</small>"]
  n99["4 cities owned<br/><small>expansion.cities4 · milestone</small>"]
  n100["Enemy conquest<br/><small>expansion.enemy · group</small>"]
  n101["Close and big<br/><small>expansion.enemy-target · policy</small>"]
  n102["Scout the target<br/><small>expansion.enemy-scout · task</small>"]
  n103["Attack at 2×<br/><small>expansion.decisive · policy</small>"]
  n104["Dispatch conquest<br/><small>expansion.enemy-dispatch · task</small>"]
  n0 -->|contains| n1
  n0 -->|contains| n21
  n0 -->|contains| n35
  n0 -->|contains| n53
  n0 -->|contains| n54
  n0 -->|contains| n55
  n0 -->|contains| n56
  n0 -->|contains| n58
  n56 -->|contains| n57
  n58 -->|contains| n59
  n59 -->|contains| n60
  n59 -->|contains| n61
  n59 -->|contains| n62
  n59 -->|contains| n63
  n59 -->|contains| n64
  n59 -->|contains| n65
  n59 -->|contains| n66
  n58 -->|contains| n67
  n67 -->|contains| n68
  n67 -->|contains| n69
  n67 -->|contains| n70
  n67 -->|contains| n71
  n67 -->|contains| n72
  n67 -->|contains| n73
  n58 -->|contains| n92
  n58 -->|contains| n74
  n74 -->|contains| n75
  n74 -->|contains| n76
  n74 -->|contains| n77
  n74 -->|contains| n78
  n58 -->|contains| n79
  n58 -->|contains| n80
  n80 -->|contains| n81
  n80 -->|contains| n82
  n58 -->|contains| n83
  n58 -->|contains| n84
  n83 -->|contains| n85
  n56 -->|contains| n86
  n58 -->|contains| n87
  n87 -->|contains| n88
  n87 -->|contains| n89
  n87 -->|contains| n90
  n58 -->|contains| n91
  n93 -->|contains| n94
  n94 -->|contains| n95
  n93 -->|contains| n96
  n93 -->|contains| n97
  n93 -->|contains| n98
  n46 -->|contains| n52
  n46 -->|contains| n99
  n46 -->|contains| n100
  n100 -->|contains| n101
  n100 -->|contains| n102
  n100 -->|contains| n103
  n100 -->|contains| n104
  n60 -.->|requires| n61
  n61 -.->|requires| n62
  n62 -.->|requires| n63
  n63 -.->|requires| n64
  n64 -.->|requires| n65
  n65 -.->|requires| n66
  n66 -.->|requires| n67
  n66 -.->|requires| n80
  n66 -.->|requires| n83
  n72 -.->|requires| n85
  n73 -.->|requires| n92
  n92 -.->|requires| n74
  n92 -.->|requires| n89
  n85 -.->|requires| n91
  n40 -.->|requires| n56
  n88 ==>|contributesTo| n57
  n89 ==>|contributesTo| n57
  n90 ==>|contributesTo| n57
  n57 ==>|contributesTo| n58
  n51 -.->|requires| n93
  n95 -.->|requires| n97
  n96 -.->|requires| n97
  n97 ==>|contributesTo| n98
  n98 ==>|contributesTo| n58
  n1 -->|contains| n2
  n2 -->|contains| n3
  n2 -->|contains| n4
  n2 -->|contains| n5
  n2 -->|contains| n6
  n2 -->|contains| n7
  n2 -->|contains| n8
  n2 -->|contains| n9
  n2 -->|contains| n10
  n2 -->|contains| n11
  n1 -->|contains| n12
  n12 -->|contains| n13
  n12 -->|contains| n14
  n12 -->|contains| n15
  n1 -->|contains| n16
  n1 -->|contains| n17
  n1 -->|contains| n18
  n1 -->|contains| n19
  n1 -->|contains| n20
  n21 -->|contains| n22
  n21 -->|contains| n23
  n21 -->|contains| n24
  n21 -->|contains| n25
  n21 -->|contains| n26
  n26 -->|contains| n27
  n26 -->|contains| n28
  n26 -->|contains| n29
  n21 -->|contains| n30
  n30 -->|contains| n31
  n21 -->|contains| n32
  n21 -->|contains| n33
  n21 -->|contains| n34
  n35 -->|contains| n36
  n36 -->|contains| n37
  n36 -->|contains| n38
  n36 -->|contains| n39
  n36 -->|contains| n40
  n36 -->|contains| n41
  n36 -->|contains| n42
  n35 -->|contains| n43
  n35 -->|contains| n45
  n0 -->|contains| n46
  n46 -->|contains| n47
  n46 -->|contains| n48
  n46 -->|contains| n49
  n46 -->|contains| n50
  n46 -->|contains| n51
  n46 -->|contains| n93
  n99 -.->|requires| n100
  n102 -.->|requires| n104
  n43 -->|contains| n44
  n7 -.->|requires| n8
  n8 -.->|requires| n9
  n8 -.->|requires| n16
  n11 -.->|requires| n28
  n11 -.->|requires| n20
  n9 -.->|requires| n22
  n22 -.->|requires| n25
  n25 -.->|requires| n23
  n23 -.->|requires| n32
  n10 -.->|requires| n36
  n47 -.->|requires| n49
  n48 -.->|requires| n49
  n37 -.->|requires| n45
  n38 -.->|requires| n45
  n39 -.->|requires| n45
  n40 -.->|requires| n45
  n41 -.->|requires| n45
  n45 -.->|requires| n46
  n45 -.->|requires| n49
  n49 ==>|contributesTo| n50
  n50 -.->|requires| n51
  n50 -.->|requires| n52
  class n0 objective;
  class n1,n21,n35,n46,n56,n58 mission;
  class n2,n12,n26,n30,n36,n59,n67,n74,n87,n93,n100 group;
  class n3,n4,n5,n13,n14,n15,n16,n22,n23,n24,n25,n27,n29,n31,n32,n37,n38,n39,n40,n41,n42,n44,n47,n48,n49,n52,n57,n60,n61,n62,n63,n64,n65,n68,n69,n70,n75,n76,n77,n79,n81,n82,n85,n86,n88,n89,n90,n92,n95,n96,n97,n102,n104 task;
  class n7,n8,n9,n10,n11,n45,n50,n51,n66,n72,n73,n78,n98,n99 milestone;
  class n6,n17,n18,n19,n20,n28,n33,n43,n55,n71,n80,n83,n84,n94,n101,n103 policy;
  class n34,n53,n54,n91 capability;
  linkStyle 0 stroke:#2563eb,stroke-width:2px;
  linkStyle 1 stroke:#2563eb,stroke-width:2px;
  linkStyle 2 stroke:#2563eb,stroke-width:2px;
  linkStyle 3 stroke:#2563eb,stroke-width:2px;
  linkStyle 4 stroke:#2563eb,stroke-width:2px;
  linkStyle 5 stroke:#2563eb,stroke-width:2px;
  linkStyle 6 stroke:#2563eb,stroke-width:2px;
  linkStyle 7 stroke:#2563eb,stroke-width:2px;
  linkStyle 8 stroke:#2563eb,stroke-width:2px;
  linkStyle 9 stroke:#2563eb,stroke-width:2px;
  linkStyle 10 stroke:#2563eb,stroke-width:2px;
  linkStyle 11 stroke:#2563eb,stroke-width:2px;
  linkStyle 12 stroke:#2563eb,stroke-width:2px;
  linkStyle 13 stroke:#2563eb,stroke-width:2px;
  linkStyle 14 stroke:#2563eb,stroke-width:2px;
  linkStyle 15 stroke:#2563eb,stroke-width:2px;
  linkStyle 16 stroke:#2563eb,stroke-width:2px;
  linkStyle 17 stroke:#2563eb,stroke-width:2px;
  linkStyle 18 stroke:#2563eb,stroke-width:2px;
  linkStyle 19 stroke:#2563eb,stroke-width:2px;
  linkStyle 20 stroke:#2563eb,stroke-width:2px;
  linkStyle 21 stroke:#2563eb,stroke-width:2px;
  linkStyle 22 stroke:#2563eb,stroke-width:2px;
  linkStyle 23 stroke:#2563eb,stroke-width:2px;
  linkStyle 24 stroke:#2563eb,stroke-width:2px;
  linkStyle 25 stroke:#2563eb,stroke-width:2px;
  linkStyle 26 stroke:#2563eb,stroke-width:2px;
  linkStyle 27 stroke:#2563eb,stroke-width:2px;
  linkStyle 28 stroke:#2563eb,stroke-width:2px;
  linkStyle 29 stroke:#2563eb,stroke-width:2px;
  linkStyle 30 stroke:#2563eb,stroke-width:2px;
  linkStyle 31 stroke:#2563eb,stroke-width:2px;
  linkStyle 32 stroke:#2563eb,stroke-width:2px;
  linkStyle 33 stroke:#2563eb,stroke-width:2px;
  linkStyle 34 stroke:#2563eb,stroke-width:2px;
  linkStyle 35 stroke:#2563eb,stroke-width:2px;
  linkStyle 36 stroke:#2563eb,stroke-width:2px;
  linkStyle 37 stroke:#2563eb,stroke-width:2px;
  linkStyle 38 stroke:#2563eb,stroke-width:2px;
  linkStyle 39 stroke:#2563eb,stroke-width:2px;
  linkStyle 40 stroke:#2563eb,stroke-width:2px;
  linkStyle 41 stroke:#2563eb,stroke-width:2px;
  linkStyle 42 stroke:#2563eb,stroke-width:2px;
  linkStyle 43 stroke:#2563eb,stroke-width:2px;
  linkStyle 44 stroke:#2563eb,stroke-width:2px;
  linkStyle 45 stroke:#2563eb,stroke-width:2px;
  linkStyle 46 stroke:#2563eb,stroke-width:2px;
  linkStyle 47 stroke:#2563eb,stroke-width:2px;
  linkStyle 48 stroke:#2563eb,stroke-width:2px;
  linkStyle 49 stroke:#2563eb,stroke-width:2px;
  linkStyle 50 stroke:#2563eb,stroke-width:2px;
  linkStyle 51 stroke:#2563eb,stroke-width:2px;
  linkStyle 52 stroke:#2563eb,stroke-width:2px;
  linkStyle 53 stroke:#2563eb,stroke-width:2px;
  linkStyle 54 stroke:#2563eb,stroke-width:2px;
  linkStyle 55 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 56 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 57 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 58 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 59 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 60 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 61 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 62 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 63 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 64 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 65 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 66 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 67 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 68 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 69 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 70 stroke:#7c3aed,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 71 stroke:#7c3aed,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 72 stroke:#7c3aed,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 73 stroke:#7c3aed,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 74 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 75 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 76 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 77 stroke:#7c3aed,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 78 stroke:#7c3aed,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 79 stroke:#2563eb,stroke-width:2px;
  linkStyle 80 stroke:#2563eb,stroke-width:2px;
  linkStyle 81 stroke:#2563eb,stroke-width:2px;
  linkStyle 82 stroke:#2563eb,stroke-width:2px;
  linkStyle 83 stroke:#2563eb,stroke-width:2px;
  linkStyle 84 stroke:#2563eb,stroke-width:2px;
  linkStyle 85 stroke:#2563eb,stroke-width:2px;
  linkStyle 86 stroke:#2563eb,stroke-width:2px;
  linkStyle 87 stroke:#2563eb,stroke-width:2px;
  linkStyle 88 stroke:#2563eb,stroke-width:2px;
  linkStyle 89 stroke:#2563eb,stroke-width:2px;
  linkStyle 90 stroke:#2563eb,stroke-width:2px;
  linkStyle 91 stroke:#2563eb,stroke-width:2px;
  linkStyle 92 stroke:#2563eb,stroke-width:2px;
  linkStyle 93 stroke:#2563eb,stroke-width:2px;
  linkStyle 94 stroke:#2563eb,stroke-width:2px;
  linkStyle 95 stroke:#2563eb,stroke-width:2px;
  linkStyle 96 stroke:#2563eb,stroke-width:2px;
  linkStyle 97 stroke:#2563eb,stroke-width:2px;
  linkStyle 98 stroke:#2563eb,stroke-width:2px;
  linkStyle 99 stroke:#2563eb,stroke-width:2px;
  linkStyle 100 stroke:#2563eb,stroke-width:2px;
  linkStyle 101 stroke:#2563eb,stroke-width:2px;
  linkStyle 102 stroke:#2563eb,stroke-width:2px;
  linkStyle 103 stroke:#2563eb,stroke-width:2px;
  linkStyle 104 stroke:#2563eb,stroke-width:2px;
  linkStyle 105 stroke:#2563eb,stroke-width:2px;
  linkStyle 106 stroke:#2563eb,stroke-width:2px;
  linkStyle 107 stroke:#2563eb,stroke-width:2px;
  linkStyle 108 stroke:#2563eb,stroke-width:2px;
  linkStyle 109 stroke:#2563eb,stroke-width:2px;
  linkStyle 110 stroke:#2563eb,stroke-width:2px;
  linkStyle 111 stroke:#2563eb,stroke-width:2px;
  linkStyle 112 stroke:#2563eb,stroke-width:2px;
  linkStyle 113 stroke:#2563eb,stroke-width:2px;
  linkStyle 114 stroke:#2563eb,stroke-width:2px;
  linkStyle 115 stroke:#2563eb,stroke-width:2px;
  linkStyle 116 stroke:#2563eb,stroke-width:2px;
  linkStyle 117 stroke:#2563eb,stroke-width:2px;
  linkStyle 118 stroke:#2563eb,stroke-width:2px;
  linkStyle 119 stroke:#2563eb,stroke-width:2px;
  linkStyle 120 stroke:#2563eb,stroke-width:2px;
  linkStyle 121 stroke:#2563eb,stroke-width:2px;
  linkStyle 122 stroke:#2563eb,stroke-width:2px;
  linkStyle 123 stroke:#2563eb,stroke-width:2px;
  linkStyle 124 stroke:#2563eb,stroke-width:2px;
  linkStyle 125 stroke:#2563eb,stroke-width:2px;
  linkStyle 126 stroke:#2563eb,stroke-width:2px;
  linkStyle 127 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 128 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 129 stroke:#2563eb,stroke-width:2px;
  linkStyle 130 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 131 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 132 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 133 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 134 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 135 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 136 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 137 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 138 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 139 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 140 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 141 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 142 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 143 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 144 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 145 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 146 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 147 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 148 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 149 stroke:#7c3aed,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 150 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
  linkStyle 151 stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5;
```

Contains edges are solid blue, requires edges are dashed red, and contributesTo edges are dashed purple.

| Key | Kind | Title | Summary | Gating thresholds | Requires |
| --- | --- | --- | --- | --- | --- |
| round | objective | Complete the round | Run the current policy in the selected world. | — | — |
| economy | mission | Develop the economy | Maintain capacity, protection, productive investment, and construction runway. | — | — |
| economy.producers | group | Resource producers | Develop lumberyard, quarry, and mine under the current producer policy. | — | — |
| economy.lumberyard | task | Lumberyard | Evaluate timber production and payback. | — | — |
| economy.quarry | task | Quarry | Evaluate stone production and payback. | — | — |
| economy.mine | task | Iron mine | Evaluate iron production and payback. | — | — |
| economy.balance | policy | Resource balance | Boost the producer of a resource whose stock (in minutes of its own production) lags the other two by 5 minutes or more. | lagMinutes=5, baseScore=90, maxScore=99 | — |
| economy.producers.5 | milestone | Producers at level 5 | All three resource producers reach level 5. | minimum=5 | — |
| economy.producers.8 | milestone | Producers at level 8 | All three resource producers reach level 8. | minimum=8 | economy.producers.5 |
| economy.producers.10 | milestone | Producers at level 10 | All three resource producers reach level 10. | minimum=10 | economy.producers.8 |
| economy.producers.15 | milestone | Producers at level 15 | All three resource producers reach level 15 for the first conquest transition. | minimum=15 | — |
| economy.producers.20 | milestone | Producers at level 20 | All three resource producers reach level 20. | minimum=20 | — |
| economy.capacity | group | Capacity and protection | Protect resources and maintain population and storage capacity. | — | — |
| economy.farm | task | Farm capacity | Keep free population for queued work and Pikeman training; before a long build, offer the Farm first if the batches trained meanwhile wouldn't fit. | — | — |
| economy.storehouse | task | Storehouse overflow | Prevent projected stock from exceeding storage. | — | — |
| economy.cellar | task | Cellar protection | Protect the existing 60-tick production threshold. | — | — |
| economy.hall | task | Great Hall | Use the existing bounded construction payback comparison. | — | economy.producers.8 |
| economy.successor-window | policy | Early-build successor window | Allow only the existing strict construction-successor window. | remainingRealSecondsExclusive=10 | — |
| economy.payback | policy | Production payback | Keep the existing round-end production return test and ceiling. | producerCeiling=20 | — |
| economy.round-end | policy | Round-end completion | Keep current affordability, construction, and use deadlines. | — | — |
| economy.hall-push | policy | Great Hall push | After producers 20 the capital keeps the Great Hall growing alongside military growth. | — | economy.producers.20 |
| defense | mission | Military | Build the Pikemen garrison, keep the Raider attack force trained, and station Scouts. | — | — |
| defense.barracks1 | task | First Barracks | Build Barracks 1 when currently permitted. | level=1 | economy.producers.10 |
| defense.smithy1 | task | Defensive Smithy | Unlock the first defensive Smithy under current prerequisites. | level=1 | defense.barracks3 |
| defense.development | task | Military development work | Fund intermediate military development steps under current prerequisites. | — | — |
| defense.barracks3 | task | Barracks 3 | Develop Barracks through the existing level-3 milestone. | level=3 | defense.barracks1 |
| military.garrison | group | Garrison | Organize the capital's garrison requirements and growth. | — | — |
| military.pikemen-baseline | task | 250 Pikemen per city | The capital keeps 250 Pikemen at home and trains 250 for each economic city's defender request. Pikemen only; no Shieldmen. | perCity=250 | — |
| military.defence-scale | policy | Capital holds 3× any city | Once the capital's producers reach 20, the capital's home Pikemen grow to 3× the strongest other city's; economic cities follow via their ÷3 defender target. | multiplier=3 | economy.producers.20 |
| military.barracks-growth | task | Barracks grows when troops lag | Raise Barracks when the Pikemen target or the 140 Raiders can't be trained fast enough; both train there. No level cap. | — | — |
| military.army | group | Attack force | The capital's Raider force and its size. | — | — |
| military.raiders | task | Raider force | Keep 140 Raiders trained at home; losses are retrained. An attack (hamlet or enemy) needs all 140 at home. | count=140 | — |
| military.scouts | task | Scouts | The capital keeps 20 Scouts at home per city it owns, and stations 20 in each economic city on request. The Stable is only for Scouts (Stable 1). | perCity=20 | defense.smithy1 |
| military.wall-cap | policy | Wall capped at 10 | Capital Walls stop at level 10. | maxLevel=10 | — |
| military.workshop | capability | Workshop siege | Skipped: we win on numbers, not Rams or Trebuchets. | — | — |
| first-conquest | mission | Enable conquest | Build everything the game requires before an Envoy can conquer: Hall 13, Barracks 10, Smithy 10, Market 5 and a Court. | originVillages=1, homePikemen=150, standingOrders=0 | — |
| conquest.infrastructure | group | Conquest infrastructure | Complete current building requirements and ordinary capacity prerequisites. | — | economy.producers.15 |
| conquest.hall13 | task | Great Hall 13 | Build the conquest Hall requirement. | level=13 | — |
| conquest.barracks10 | task | Barracks 10 | Build the conquest Barracks requirement. | level=10 | — |
| conquest.smithy10 | task | Smithy 10 | Build the conquest Smithy requirement. | level=10 | — |
| conquest.market5 | task | Market 5 | Build the conquest Market requirement. | level=5 | — |
| conquest.court | task | Court | Build the next conquest building returned by current rules. | level=1 | — |
| conquest.capacity | task | Conquest capacity prerequisite | Fund farm and storage capacity as ordinary paid prerequisites. | — | — |
| conquest.producer-funding | policy | Producer funding fallback | Compare the existing bounded producer investment against saving for the next conquest building. | — | — |
| conquest.producer-investment | task | Conquest producer investment | Build the selected producer when the bounded funding fallback applies. | — | — |
| conquest.enabled | milestone | Conquest enabled | Every conquest building requirement is met; the capital can train an Envoy. | — | conquest.hall13, conquest.barracks10, conquest.smithy10, conquest.market5, conquest.court |
| expansion | mission | Expansion | Conquer cities one at a time: the first capture, then the next ones once existing cities are developed. | — | conquest.enabled |
| conquest.escort | task | Prepare Raider escort | Prepare the simulated bounded escort without replacing surviving waves. | — | — |
| conquest.envoy | task | Prepare Envoy | Prepare one reusable Envoy for the bounded mission. | count=1 | — |
| conquest.dispatch | task | Dispatch conquest wave | Recheck ownership and simulation before each of at most six waves. | maximumWaves=6 | conquest.escort, conquest.envoy, conquest.enabled |
| conquest.target-owned | milestone | Target owned | Fresh village ownership completes the mission regardless of final response attribution. | — | — |
| conquest.first-achieved | milestone | First city captured | Retain evidence for the completed first conquest. | — | conquest.target-owned |
| expansion.recall | task | Recall the escort | After a capture, the conquering attack's survivors stay in the captured city as support; send every stationed Raider back home to the capital. Pikemen are left in place. | — | conquest.target-owned |
| capability.parallel-budgets | capability | Parallel mission budgets | Unavailable: no cross-mission parallel budget allocator. | — | — |
| capability.multi-submit | capability | Multiple submissions per cycle | Unavailable: one authorized submission per cycle remains. | — | — |
| roles | policy | City roles | Tag every city automatically: the conquest origin is the capital, every other city is economic. | — | — |
| logistics | mission | Supply economic cities | The capital fulfils requests published by economic cities: resources by trade, later defenders. | — | conquest.market5 |
| logistics.fulfil | task | Fulfil requests | Send each requested resource as its own trade, weighed against the capital's own builds; one shipment per resource in flight per city. | — | — |
| economic-city | mission | Economic city | Grow a captured city into an economy fed by capital shipments; no military. | — | — |
| econ.build-order | group | Build order | Fixed steps in order; each step starts only after the previous one is done. | — | — |
| econ.cellar3 | task | 1. Cellar 3 | Cheap first protection: hides 796 of each resource. | level=3 | — |
| econ.hall5 | task | 2. Great Hall 5 | First construction speed-up with shipped resources. | level=5 | econ.cellar3 |
| econ.cellar-cover | task | 3. Cellar covers requested stock | Raise the Cellar until it hides the requested stock: Cellar 7 hides 2,491, covering a 2,000 top-up. | level=7 | econ.hall5 |
| econ.hall13 | task | 4. Great Hall 13 | Keep building the Hall with pulled resources: about 47% faster construction at level 13. | level=13 | econ.cellar-cover |
| econ.cellar10 | task | 5. Cellar 10 | Hides 5,860 of each resource. | level=10 | econ.hall13 |
| econ.storehouse3 | task | 6. Storehouse 3 | Holds 5,358 of each resource, room for larger top-ups and for stock bound to the capital. | level=3 | econ.cellar10 |
| econ.setup-done | milestone | Setup done | Every build-order step is done; the city moves on to producers, storage growth and the Market. | — | econ.storehouse3 |
| econ.producers | group | Producers | Producers up to 10; above that is Producers 11–25, after Wall 10. | — | econ.setup-done |
| econ.lumberyard | task | Lumberyard | Grow timber production. | level=10 | — |
| econ.quarry | task | Quarry | Grow stone production. | level=10 | — |
| econ.mine | task | Iron mine | Grow iron production. | level=10 | — |
| econ.balance | policy | Resource balance | Same rule as the capital: boost the producer of a lagging resource; the boost is not capped by the economic-city producer score. | lagMinutes=5, baseScore=90, maxScore=99 | — |
| econ.producers.5 | milestone | Producers at level 5 | All three producers reach level 5. | minimum=5 | — |
| econ.producers.10 | milestone | Producers at level 10 | All three producers reach level 10. | minimum=10 | — |
| econ.producers-late | group | Producers 11–25 | Raise producers from level 11 through 25 after Wall 10. | — | econ.wall10 |
| econ.lumberyard25 | task | Lumberyard | Grow timber production. | level=25 | — |
| econ.quarry25 | task | Quarry | Grow stone production. | level=25 | — |
| econ.mine25 | task | Iron mine | Grow iron production. | level=25 | — |
| econ.producers.25 | milestone | Producers at level 25 | All three producers reach level 25. | minimum=25 | — |
| econ.farm | task | Farm when blocked | Build a Farm only when population blocks the next step. | — | — |
| econ.storage-growth | policy | Storage grows when needed | Raise the Storehouse when stock plus shipments in flight and income would overflow it; the Cellar follows so it keeps protecting the stock. | forecastTicks=300 | econ.setup-done |
| econ.storehouse | task | Storehouse | Storehouse upgrade chosen by the storage policy. | — | — |
| econ.cellar | task | Cellar follows storage | Keep Cellar protection at or above the stock the city holds. | — | — |
| econ.market-growth | policy | Market grows when needed | Market 1 after producers 5; further levels once this city fulfils overflow requests. | — | econ.setup-done |
| econ.no-military | policy | No military | Never builds Barracks, Smithy or Stable and never trains troops; the Wall up to 10 is the exception. Defenders and Scouts are stationed by the capital. | — | — |
| econ.market | task | Market | Build a Market once producers reach level 5, to fulfil the capital's overflow requests later; the market policy raises it further. | level=1 | econ.producers.5 |
| logistics.market-growth | task | Market grows when needed | Raise the capital's Market when open requests need more merchants than it has. | — | — |
| econ.requests | group | Requests to the capital | What this city asks the capital for; the capital decides whether it can afford it. | — | — |
| econ.request-resources | task | Request resources | Per resource, by stage: setup below 1,000 tops up to 2,000 (95); growth below 2,000 tops up to 4,000 (85); developed the same buffer at 40. | setupBelow=1000, setupTopUp=2000, setupScore=95, growthBelow=2000, growthTopUp=4000, growthScore=85, developedScore=40 | — |
| econ.request-defenders | task | Request defenders | Unlocked by Wall 10. Target Pikemen stationed = max(250, capital home Pikemen ÷ 3). Request a top-up to the target only when stationed Pikemen fall below 80% of it (for example, capital 600 → target 200, top-up when ≤160 (below 200×0.8)). Fulfilled by the capital. | baseline=250, capitalShare=3, triggerShare=0.8 | econ.wall10 |
| econ.request-scouts | task | Request scouts | Keep 20 Scouts stationed; support Scouts defend against enemy scouting. | — | — |
| econ.overflow | capability | Fulfil capital overflow requests | Later: when this city outproduces its construction, its Market fulfils requests from the capital. | — | econ.market |
| econ.wall10 | task | Wall 10 | Built after producers reach 10; the only military building an economic city builds. | level=10 | econ.producers.10 |
| expansion.next | group | Next cities | After the first capture, keep taking one new city at a time when existing cities are developed enough. | — | conquest.first-achieved |
| expansion.readiness | policy | Expansion readiness | The next conquest starts only once every economic city has reached Great Hall 10. | economicHall=10, homePikemen=150 | — |
| expansion.envoy | task | Train next Envoy | Train one Envoy for the next target once the next conquest has started. | — | — |
| expansion.escort | task | Escort army at home | Before every wave, train up to max(140, simulated escort) Raiders at home; earlier survivors count. | — | — |
| expansion.dispatch | task | Dispatch waves | Same rules as the first conquest: nearest unowned target, 140 Raiders at home, and recheck before each of at most six waves. | maximumWaves=6 | expansion.envoy, expansion.escort |
| expansion.captured | milestone | Target captured | The captured city is tagged economic and starts the economic-city flow. | — | — |
| expansion.cities4 | milestone | 4 cities owned | Own four cities before opening the enemy-conquest plan. | minimum=4 | — |
| expansion.enemy | group | Enemy conquest | Scout and simulate attacks on enemy player villages before dispatching conquest. | — | expansion.cities4 |
| expansion.enemy-target | policy | Close and big | Target enemy player villages, ranked by size (points) over distance. | — | — |
| expansion.enemy-scout | task | Scout the target | Send Scouts before any attack; use the report's intel for the battle simulation. | — | — |
| expansion.decisive | policy | Attack at 2× | Attack only with 140 Raiders at home, when our attack is at least 2× their defence and an Envoy is simulated to survive. Winner losses are (loser ÷ winner)^1.5, so a 2× edge costs about 35% of the army. | strengthRatio=2 | — |
| expansion.enemy-dispatch | task | Dispatch conquest | Dispatch the enemy conquest after scouting and a decisive battle simulation, with 140 Raiders at home. | — | expansion.enemy-scout |
