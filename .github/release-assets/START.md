# open-graph server — how to run it

You have `open-graph-server-<tag>.tar.gz` — the actual MCP server, meant to
run **on your own machine, for as long as you want**, not something someone
else hosts for you during a session window.

## 1. Install

```sh
tar -xzf open-graph-server-<tag>.tar.gz
cd open-graph-server-<tag>
./setup.sh
```

`setup.sh` just runs `bun install` (needs [Bun](https://bun.sh) — if you
don't have it: `curl -fsSL https://bun.sh/install | bash`, then open a new
terminal). This package includes `mcp-server` and `graph-core` — the latter
pulls in tree-sitter parsers (Go, Python, Rust, TypeScript) for source
indexing. If `bun install` fails or asks for a C++ toolchain on your
machine, stop and tell whoever gave you this bundle exactly what it printed
— that's a real installation blocker, not something to work around
silently.

## 2. Run it

```sh
bun mcp-server/src/index.ts
```

The server listens on `http://localhost:8787` by default (`POST /mcp` is
the JSON-RPC endpoint). Useful environment variables:

- `PORT` — override the port (default `8787`).
- `STATE_DIR` — where the server keeps its durable state: a SQLite database
  plus a JSONL mirror per tenant. Default `.graph-server`, created next to
  wherever you run the command from. Delete it to start clean.
- `ALLOWED_ORIGINS` — comma-separated Origin allowlist (default: open, `*`).
  Leave unset unless you know you need it.
- `LOG_FILE` — see Logs below.

There is no separate build step — you run the TypeScript source directly
with `bun`.

## 3. Point it at your own repo

The server doesn't index anything on boot by itself. Once it's running,
register a session and call `graph.bootstrap` with the path to the repo you
want indexed:

```sh
curl -s http://localhost:8787/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"session.register","arguments":{"name":"Your Name"}}}'
```

Copy the `token` from the response, then:

```sh
curl -s http://localhost:8787/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"graph.bootstrap","arguments":{"token":"<TOKEN>","repoPath":"/absolute/path/to/your/repo"}}}'
```

That indexes the repo and writes a fresh graph for your tenant into
`STATE_DIR`. `graph.query` (no token needed) is the fastest way to check it
worked:

```sh
curl -s http://localhost:8787/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"graph.query","arguments":{"terms":["your search term"]}}}'
```

## 4. Connect Claude Code

Verified for real against a local instance on 2026-07-16 (see
`docs/roadmap-integrations/quickstart.md` §2.1 in the main repo):

```sh
claude mcp add --transport http open-graph http://localhost:8787/mcp
```

(swap the port if you overrode `PORT`). `claude mcp list` should show
`open-graph` connected. Other MCP clients (Cursor, Windsurf, opencode,
etc.) can point at the same `http://localhost:8787/mcp` endpoint — see the
quickstart doc above for client-specific config.

## Logs — please send these back with your feedback

The server writes a structured log to `<STATE_DIR>/server.log` by default
(so, `.graph-server/server.log` unless you set `STATE_DIR` elsewhere). Set
`LOG_FILE` to send it somewhere else instead:

```sh
LOG_FILE=/tmp/open-graph.log bun mcp-server/src/index.ts
```

When you report a bug or anything that felt off, **attach this log file**
(or the relevant tail of it) along with what you were doing at the time —
it's the fastest way for us to see what actually happened on your machine.

## Troubleshooting

- **`bun: command not found`** — install Bun (see step 1), then open a
  *new* terminal.
- **`bun install` fails on tree-sitter / asks for a C++ compiler** — this is
  the known risk with this bundle (native parser bindings). Tell us the
  exact error and your OS/Bun version; don't try to work around it
  silently, it's exactly the kind of thing we need to hear about.
- **`graph.bootstrap: repoPath não existe...`** — use an absolute path, and
  make sure the server process can actually read it.
