#!/usr/bin/env bun
/**
 * mcp-client-contract.ts — QA-3 DoD item 3: speaks the wire protocol the way a real generic MCP client
 * (opencode et al.) would — raw JSON-RPC over POST /mcp, no test helpers wrapping tool results — and
 * validates response SHAPES against what §8.2 says a non-canvas agent depends on: `presence.who`'s
 * per-user fields (an agent formats these as a table) and `graph://history`'s durable, gap-free replay.
 *
 * NOT a `bun test` file on purpose (filename doesn't match `*.test.ts`) — same reasoning as
 * presence-load.ts: this asserts a protocol CONTRACT surface external clients depend on, worth running
 * explicitly/separately rather than folding into the fast unit suite. Run via:
 *
 *   bun run test:client-contract                    (from packages/mcp-server)
 *   bun test/mcp-client-contract.ts                  (direct)
 *
 * Exits non-zero (and prints which check failed) if the contract isn't met.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { startServer } from "../src/index"

const failures: string[] = []
function check(label: string, cond: boolean): void {
  if (cond) console.log(`[contract] ok — ${label}`)
  else {
    console.error(`[contract] FAIL — ${label}`)
    failures.push(label)
  }
}

async function rpc(base: string, method: string, params?: unknown): Promise<any> {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const body = await res.json()
  if (body.error) throw new Error(`${method} → RPC error: ${body.error.message}`)
  return body.result
}

async function toolCall(base: string, name: string, args: Record<string, unknown>): Promise<any> {
  const result = await rpc(base, "tools/call", { name, arguments: args })
  if (result.isError) throw new Error(`${name} → tool error: ${result.content?.[0]?.text}`)
  return result.structuredContent
}

async function main() {
  const stateDir = mkdtempSync(path.join(tmpdir(), "og-contract-"))
  const s = startServer({ stateDir })
  try {
    // ── initialize ────────────────────────────────────────────────────────
    const init = await rpc(s.url, "initialize", { protocolVersion: "2025-06-18" })
    check("initialize returns a protocolVersion string", typeof init.protocolVersion === "string")
    check("initialize declares tools + resources capabilities", !!init.capabilities?.tools && !!init.capabilities?.resources)
    check("initialize declares serverInfo.name", init.serverInfo?.name === "open-graph-mcp")

    // ── tools/list ────────────────────────────────────────────────────────
    const toolsList = await rpc(s.url, "tools/list")
    check("tools/list returns a non-empty tools array", Array.isArray(toolsList.tools) && toolsList.tools.length > 0)
    const byName = new Map<string, any>(toolsList.tools.map((t: any) => [t.name, t]))
    for (const name of ["presence.who", "graph.query", "changeset.open", "session.register"]) {
      const t = byName.get(name)
      check(`tools/list includes "${name}" with name/description/inputSchema`, !!t && typeof t.description === "string" && !!t.inputSchema)
    }

    // ── session.register (a real client's very first call) ──────────────────
    const creds = await toolCall(s.url, "session.register", { name: "contract-agent" })
    check("session.register returns token/userId/tenantId", !!creds.token && !!creds.userId && !!creds.tenantId)

    // A tools-only client (no SSE — ID2: the live layer is never a requirement) mints its own opaque
    // local sessionId and declares itself via presence.beat, same as @open-graph-mcp/client's polling
    // mode — presence.who otherwise has nothing to show for a session that never called beat/focus.
    await toolCall(s.url, "presence.beat", { token: creds.token, sessionId: `contract-${creds.userId}`, agentKind: "opencode" })

    // ── presence.who: shape an agent formats as a table (§8.2) — every row needs the same columns ──
    const who = await toolCall(s.url, "presence.who", { token: creds.token })
    check("presence.who returns { users: [...] }", Array.isArray(who.users))
    check("presence.who lists the caller's own session", who.users.some((u: any) => u.id === creds.userId))
    const fields = ["id", "name", "agentKind", "focusCell", "openCount", "lastSeen"]
    check(
      "every presence.who row has the full field set a table-formatter depends on",
      who.users.every((u: any) => fields.every((f) => f in u)),
    )

    // ── graph.history: durable, gap-free replay ──────────────────────────
    const opened = await toolCall(s.url, "changeset.open", { token: creds.token, cells: ["contract:4"], intent: "history replay check" })
    check("changeset.open succeeded (setup for the history check)", !!opened.csId)
    await toolCall(s.url, "changeset.commit", { token: creds.token, csId: opened.csId })

    const h1 = await rpc(s.url, "resources/read", { uri: "graph://history?since=0" })
    const events1: any[] = JSON.parse(h1.contents[0].text).events
    check("graph://history?since=0 replays at least the open+commit we just made", events1.length >= 2)
    const seqs = events1.map((e) => e.seq)
    check("history is strictly increasing by seq (no reordering)", seqs.every((n, i) => i === 0 || n > seqs[i - 1]))

    const lastSeq = seqs[seqs.length - 1]
    const h2 = await rpc(s.url, "resources/read", { uri: `graph://history?since=${lastSeq}` })
    const events2: any[] = JSON.parse(h2.contents[0].text).events
    check("re-reading since the last seen seq returns nothing already seen (no duplicate replay)", events2.length === 0)

    // A second full replay from 0 must be byte-identical to the first — durability, not a one-shot tail.
    const h3 = await rpc(s.url, "resources/read", { uri: "graph://history?since=0" })
    const events3: any[] = JSON.parse(h3.contents[0].text).events
    check("replaying since=0 again returns the identical event set (durable, not ephemeral)", JSON.stringify(events3) === JSON.stringify(events1))
  } catch (e) {
    console.error(`[contract] FATAL: ${(e as Error).message}`)
    failures.push(`fatal: ${(e as Error).message}`)
  } finally {
    s.stop()
    rmSync(stateDir, { recursive: true, force: true })
  }

  if (failures.length) {
    console.error(`[contract] FAIL: ${failures.length} check(s) failed:\n  - ${failures.join("\n  - ")}`)
    process.exitCode = 1
  } else {
    console.log("[contract] PASS: MCP client contract holds (initialize/tools.list/presence.who shape/graph.history replay)")
  }
}

if (import.meta.main) main()
