# open-graph beta — install guide

Welcome! You received a shared Google Drive folder link containing:

- `open-graph-server-<tag>.tar.gz` — the MCP server itself
- `open-graph-proxy-<tag>.tar.gz` — stdio proxy + client (for MCP clients
  that only speak stdio)
- `open-graph-plugin-<tag>.tar.gz` — the same proxy bundle, plus the Claude
  Code plugin
- `INSTALL.md` (this file)

`<tag>` in the file names (e.g. `beta-v1`) is the release version — always
use the files from the Drive folder for THIS release.

**You run the server yourself, on your own machine, for as long as you're
testing** — there is no facilitator hosting it for you and no session
window. Once it's up it keeps running until you stop it.

Pick your path:

| You want to...                                 | Do section |
|--------------------------------------------------|------------|
| Run the server and try it via `curl`             | 1, then 2  |
| Connect Claude Code to it                        | 1, 2, then 3 |
| Connect another MCP client (Cursor, etc.)        | 1, 2, then 4 |

---

## 0. Prerequisite: Bun

Every section below needs the [Bun](https://bun.sh) runtime
(macOS/Linux/WSL):

```sh
curl -fsSL https://bun.sh/install | bash
```

Then open a **new terminal** and verify:

```sh
bun --version
```

Any recent version works (this release was built with 1.3.x).

## 1. Run the server

1. Download `open-graph-server-<tag>.tar.gz` from the Drive folder.
2. Extract and run setup (replace `<tag>` with the real version):

   ```sh
   tar -xzf open-graph-server-<tag>.tar.gz
   cd open-graph-server-<tag>
   ./setup.sh
   ```

3. Start it, and (optionally) point it at a repo to index. See
   `START.md` inside the extracted folder for the full walkthrough —
   `bun install` details, environment variables (`PORT`, `STATE_DIR`,
   `LOG_FILE`), how to run `graph.bootstrap` against your own repo, and
   where the log file ends up.

**Native dependency note:** `graph-core` (which the server depends on)
pulls in tree-sitter parser packages with native bindings. If
`bun install` in step 2 fails, or asks for a C++ build toolchain, **that is
important information for us** — stop, copy the exact error, and send it
along with your OS/Bun version instead of trying to force it through.

Once it's running you'll have a local URL like `http://localhost:8787` —
use that (not a URL from anyone else) in the sections below.

## 2. Verify the server responds

```sh
curl -s http://localhost:8787/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"install-check","version":"0.1"}}}'
```

Expected: a JSON response with `"result":{"protocolVersion":...}`. If
instead the connection is refused, the server isn't running — go back to
section 1.

## 3. Claude Code plugin

1. Download `open-graph-plugin-<tag>.tar.gz` from the Drive folder.
2. Extract and run setup (replace `<tag>` with the real version):

   ```sh
   tar -xzf open-graph-plugin-<tag>.tar.gz
   cd open-graph-plugin-<tag>
   ./setup.sh
   ```

3. In Claude Code, add the plugin (setup.sh prints the exact path):

   ```
   /plugin marketplace add /full/path/to/open-graph-plugin-<tag>/claude-plugin
   ```

4. Install/enable the `open-graph` plugin when prompted, and fill in the
   two settings it asks for:
   - **server URL** — `http://localhost:8787` (or whatever you started the
     server on in section 1);
   - **your name** — how you'll appear to everyone on the graph.

Keep the extracted `open-graph-plugin-<tag>` folder where it is — the
plugin runs the proxy from it.

Alternatively, Claude Code speaks HTTP directly, so you can skip the plugin
entirely and connect straight to the server you started in section 1:

```sh
claude mcp add --transport http open-graph http://localhost:8787/mcp
```

(verified against a local instance on 2026-07-16 — see
`docs/CHANGELOG.md` §2.1 in the main repo.)

## 4. Other MCP clients (stdio proxy)

1. Download `open-graph-proxy-<tag>.tar.gz` from the Drive folder.
2. Extract and run setup:

   ```sh
   tar -xzf open-graph-proxy-<tag>.tar.gz
   cd open-graph-proxy-<tag>
   ./setup.sh
   ```

3. Add this to your MCP client's server config (adjust the path and your
   name; the server URL is the one your own server is listening on from
   section 1):

   ```json
   {
     "mcpServers": {
       "open-graph": {
         "command": "bun",
         "args": [
           "/full/path/to/open-graph-proxy-<tag>/stdio-proxy/src/cli.ts",
           "--server", "http://localhost:8787",
           "--name", "Your Name"
         ]
       }
     }
   }
   ```

## 5. Verify a client connects (sections 3 and 4)

From the extracted proxy/plugin folder, with your own server running from
section 1:

```sh
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"session.register","arguments":{"name":"Your Name"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"graph.query","arguments":{"terms":["game"]}}}' \
  | bun stdio-proxy/src/cli.ts --server http://localhost:8787
```

Expected: two JSON lines — the first containing a `token`, the second
containing `candidates` (possibly empty, until you've run
`graph.bootstrap` against a repo — see `START.md` in the server bundle).
That's register + query working end to end. If instead you see `proxy:
failed to reach server`, see troubleshooting below.

## Feedback: send us the log

The server writes a log to `<STATE_DIR>/server.log` (default
`.graph-server/server.log`, next to wherever you ran it from), or wherever
`LOG_FILE` points if you set it. **Please attach this log (or the relevant
part of it)** whenever you report a bug or anything unexpected — see
`START.md` in the server bundle for details.

## Troubleshooting

- **`bun: command not found`** — do section 0, then open a NEW terminal
  (the installer edits your shell profile).
- **`bun install` fails building tree-sitter, or asks for a C++
  compiler** — this is a known risk area for the server bundle (native
  parser bindings in `graph-core`). Don't try to force it through — send us
  the exact error plus your OS and Bun version.
- **`proxy: failed to reach server`** — is the server from section 1 still
  running? Double-check the URL and port you started it on (include
  `http://`, no trailing path).
- **`invalid or expired token`** — the server restarted (tokens are
  in-memory); the proxy re-registers automatically on your next tool call.
  If it persists, check the server's terminal/log for errors.
