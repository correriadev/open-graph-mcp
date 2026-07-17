// ---------------------------------------------------------------------------
// Bun-only subprocess launcher for the mcp-server, spawned by fixture.ts (which
// runs inside Playwright's Node worker process). startServer() pulls in Bun-only
// APIs (bun:sqlite, Bun.serve) that plain Node cannot import — this script is
// the process boundary that keeps those out of Playwright's Node runtime.
//
// Also the right shape for reconnect.e2e.ts (§10.9 web): "kill the server,
// restart with the same stateDir" needs a real OS process to kill, not an
// in-process handle.
//
// Protocol: argv[2] is a JSON-encoded StartOptions. Prints exactly one line
// `READY <mcpUrl> <controlUrl>` once both servers are listening. The control
// server exposes the deterministic test-only hooks RunningServer has
// (sweepPresenceNow, tickTypingNow, tick, flush) as POST /control {action}
// — mirrors the knobs packages/mcp-server/test/*.test.ts use directly
// in-process, since e2e can't call RunningServer methods across the process
// boundary any other way.
// ---------------------------------------------------------------------------
import { startServer, type StartOptions } from "@open-graph-mcp/mcp-server/index"

const opts: StartOptions = JSON.parse(process.argv[2] ?? "{}")
const server = startServer(opts)

const actions: Record<string, () => unknown> = {
  tick: () => server.tick(),
  sweep: () => server.sweep(),
  flush: () => server.flush(),
  sweepPresenceNow: () => server.sweepPresenceNow(),
  tickTypingNow: () => server.tickTypingNow(),
}

const control = Bun.serve({
  port: 0,
  async fetch(req) {
    if (req.method !== "POST" || new URL(req.url).pathname !== "/control") return new Response("not found", { status: 404 })
    const { action } = (await req.json()) as { action: string }
    const fn = actions[action]
    if (!fn) return new Response(`unknown action: ${action}`, { status: 400 })
    await fn()
    return new Response("ok")
  },
})

process.stdout.write(`READY ${server.url} http://localhost:${control.port}\n`)

process.on("SIGTERM", () => {
  server.stop()
  control.stop()
  process.exit(0)
})
