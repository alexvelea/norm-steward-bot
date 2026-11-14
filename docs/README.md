# Documentation

- [Setup and hosting](../README.md): install, run, configure, and publish this client.
- [Dashboard](dashboard.md): imported hybrid UI, manual commands, town view, and visibility rules.
- [Bots](../bots/README.md): starter bot configuration and strategy.
- [API reference](api.md): upstream REST endpoints used by the client.
- [Game design](design.md): upstream mechanics reference, not a local game implementation.
- [MCP reference](mcp.md): upstream service and optional Claude runner reference. This repository does not host MCP.

src/shared/api.ts and src/rules/ are snapshots imported from Alex's project. Keep them compatible with the remote server; read live rules and options for authoritative gameplay values. References in the upstream docs to engine/server source refer to the original game repository.
