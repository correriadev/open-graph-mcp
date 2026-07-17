# open-graph (Claude Code plugin)

Wires a Claude Code session up to an `open-graph-mcp` server: `graph.query`,
`presence.who`, `changeset.open`, and the rest of the MCP tool surface,
plus a live-layer session (presence/beat) via the stdio proxy's `--live`
mode.

On enable, Claude Code prompts for the two `userConfig` fields declared in
`.claude-plugin/plugin.json` — `server` (defaults to
`http://localhost:8787`) and `name` (required, no default). No manual
`settings.json`/`.mcp.json` edit is needed for those two values.

## Interim wiring note (pre-INT-6)

`@open-graph-mcp/stdio` (`packages/stdio-proxy/`) is not yet published to
npm — that's INT-6, out of scope here. The eventual target invocation is
`bunx @open-graph-mcp/stdio ...`, but that doesn't work today. Until
INT-6 ships, `plugin.json`'s `mcpServers.open-graph.command` instead runs
the local checkout's TypeScript directly:

```
bun ${CLAUDE_PLUGIN_ROOT}/../stdio-proxy/src/cli.ts --server ... --name ... --live --agent-kind claude-code
```

`${CLAUDE_PLUGIN_ROOT}` resolves to this plugin's own directory
(`packages/claude-plugin/`), so `../stdio-proxy/src/cli.ts` reaches the
sibling package correctly — but only as long as this plugin stays
co-located inside the `open-graph-mcp` monorepo. Once INT-6 publishes
`@open-graph-mcp/stdio` to npm, this should switch to `bunx
@open-graph-mcp/stdio`, dropping the relative-path dependency on the
monorepo layout.
