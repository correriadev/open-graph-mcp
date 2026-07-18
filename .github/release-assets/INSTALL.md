# open-graph beta — install guide

Welcome! You received a shared Google Drive folder link containing:

- `open-graph-proxy-<tag>.tar.gz`
- `open-graph-plugin-<tag>.tar.gz`
- `INSTALL.md` (this file)

`<tag>` in the file names (e.g. `beta-v1`) is the session version — always
use the files from the Drive folder for THIS session.

The session **server URL** and the **web session link** are sent to you by
the facilitator separately (private group channel). The server is only up
during the session window.

Pick your path:

| You use...                          | Do section |
|-------------------------------------|------------|
| Just a browser                      | 1 (nothing to install) |
| Claude Code                         | 0, then 2  |
| Another MCP client (Cursor, etc.)   | 0, then 3  |

---

## 0. Prerequisite: Bun

Sections 2 and 3 need the [Bun](https://bun.sh) runtime (macOS/Linux/WSL):

```sh
curl -fsSL https://bun.sh/install | bash
```

Then open a **new terminal** and verify:

```sh
bun --version
```

Any recent version works (the beta was built with 1.3.x).

## 1. Web UI (everyone — nothing to install)

Open the session link from the facilitator in your browser and register
with your name when asked. Done.

If a warning page ("You are about to visit...") appears first, click
**Visit Site** once — it's the tunnel provider's interstitial, not an error.

## 2. Claude Code plugin

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
   - **server URL** — the one from the facilitator;
   - **your name** — how you'll appear to everyone on the graph.

Keep the extracted folder where it is — the plugin runs the proxy from it.

## 3. Other MCP clients (stdio proxy)

1. Download `open-graph-proxy-<tag>.tar.gz` from the Drive folder.
2. Extract and run setup:

   ```sh
   tar -xzf open-graph-proxy-<tag>.tar.gz
   cd open-graph-proxy-<tag>
   ./setup.sh
   ```

3. Add this to your MCP client's server config (adjust the path, the
   server URL, and your name):

   ```json
   {
     "mcpServers": {
       "open-graph": {
         "command": "bun",
         "args": [
           "/full/path/to/open-graph-proxy-<tag>/stdio-proxy/src/cli.ts",
           "--server", "<SERVER_URL>",
           "--name", "Your Name"
         ]
       }
     }
   }
   ```

## 4. Verify it connects (sections 2 and 3)

From the extracted folder, with the server URL from the facilitator:

```sh
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"session.register","arguments":{"name":"Your Name"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"graph.query","arguments":{"terms":["game"]}}}' \
  | bun stdio-proxy/src/cli.ts --server <SERVER_URL>
```

Expected: two JSON lines — the first containing a `token`, the second
containing `candidates` (possibly empty). That's register + query working
end to end. If instead you see `proxy: failed to reach server`, see
troubleshooting below.

## Troubleshooting

- **`bun: command not found`** — do section 0, then open a NEW terminal
  (the installer edits your shell profile).
- **`proxy: failed to reach server`** — the server is only up during the
  session window, and the URL changes per session. Double-check the URL
  from the facilitator (include `https://`, no trailing path).
- **`proxy: invalid response from server`, or HTML in the output** — the
  tunnel's browser-warning interstitial got in the way. Non-browser
  requests avoid it by sending the header `ngrok-skip-browser-warning`
  (any value); tell the facilitator you're hitting this. In a browser,
  just click **Visit Site** once.
- **`invalid or expired token`** — the server restarted; the proxy
  re-registers automatically on your next tool call. If it persists, ping
  the facilitator.
