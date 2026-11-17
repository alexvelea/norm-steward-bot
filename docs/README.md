# Documentation

- [Complete machine setup](setup.md): services, credentials boundaries, review/worker installation and recovery.
- [Architecture](architecture.md): execution paths, deployment and durable state.
- [Bot plan](plan.md): generated mission/task graph, dependencies and gating thresholds.
- [Bot refactor design](bot-refactor-design.md): implemented mission graph, world adapters, execution boundaries and remaining design work.
- [Operations](operations.md): verified host inventory, dated runtime observations and status interpretation.
- [Architect review handoff](ARCHITECT_REVIEW.md): a copyable GitHub-only review prompt.
- [Setup and hosting](../README.md): install, run, configure, and publish this client.
- [Scheduled reviews](reviews.md): Codex timer, usage/backoff, durable backlog and deployment recovery.
- [Unit stats and recruitment budgets](unit-stats.md): combat stats, training times and continuous resource demand.
- [Strategy](strategy.md): priorities and next measurements.
- [Conquest experiment](experiments/conquest-opening.md): producer-15 / Hall-13 / Barracks-10 opening and confirmed private capture.
- [Control center](control-center.md): deterministic advisors, scoring, allocation, execution and credentials.
- [Operator handoff](OPERATOR.md): instructions for an ad hoc scouting/troop agent.
- [Dashboard](dashboard.md): imported hybrid UI, manual commands, town view, and visibility rules.
- [Bots](../bots/README.md): starter bot configuration and strategy.
- [API reference](api.md): upstream REST endpoints used by the client.
- [Game design](design.md): upstream mechanics reference, not a local game implementation.
- [MCP reference](mcp.md): upstream service and optional Claude runner reference. This repository does not host MCP.

src/shared/api.ts and src/rules/ are snapshots imported from Alex's project. Keep them compatible with the remote server; read live rules and options for authoritative gameplay values. References in the upstream docs to engine/server source refer to the original game repository.
