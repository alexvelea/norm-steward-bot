// The copy-ready text shown with a new key: a curl call, the starter bots, and the Claude Code MCP
// setup in the three steps of docs/mcp.md § Connecting. The key goes into an environment variable,
// never into a file someone might commit.

function exportLine(key: string): string {
  return `export STEWARD_KEY="${key}"`;
}

export function curlSnippet(origin: string, key: string): string {
  return [
    exportLine(key),
    `curl -s ${origin}/api/v1/worlds`,
    `curl -s -X POST -H "Authorization: Bearer $STEWARD_KEY" ${origin}/api/v1/worlds/<world>/join`,
    `curl -s -H "Authorization: Bearer $STEWARD_KEY" ${origin}/api/v1/worlds/<world>/state`,
  ].join("\n");
}

export function botsSnippet(origin: string, key: string): string {
  return [
    exportLine(key),
    `export STEWARD_URL="${origin}"`,
    "# TypeScript (Node 20+)",
    "npx tsx bots/typescript/starter.ts",
    "# or Python (3.10+, standard library only)",
    "python bots/python/starter.py",
  ].join("\n");
}

export function mcpSnippet(origin: string, key: string): string {
  return [
    "# 1. Add the steward server, with the key in an environment variable",
    exportLine(key),
    `claude mcp add --transport http --scope user steward ${origin}/mcp --header "Authorization: Bearer \${STEWARD_KEY}"`,
    "",
    "# 2. Allow its tools so a turn never stops on a prompt: in .claude/settings.json",
    '#    "permissions": { "allow": ["mcp__steward"] }',
    "#    or, headless: --allowedTools mcp__steward",
    "",
    "# 3. Start a shift with the steward prompt",
    "/mcp__steward__steward",
  ].join("\n");
}
