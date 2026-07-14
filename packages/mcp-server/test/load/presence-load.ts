#!/usr/bin/env bun
/**
 * presence-load.ts — Fase 3 §11 / DoD §1: "50 usuários simultâneos conectados, 10 abrindo turno
 * concorrentemente, todos recebem seus eventos < 500ms (85% < 250ms)."
 *
 * NOT a `bun test` file on purpose (filename doesn't match `*.test.ts`) — this is a load/latency
 * measurement, not a correctness assertion suite; it's slower and more environment-sensitive than the
 * rest of the suite (real wall-clock timing over 50 real HTTP/SSE connections) and shouldn't gate normal
 * `bun test` runs. Run explicitly:
 *
 *   bun run test:load                              (from packages/mcp-server)
 *   bun test/load/presence-load.ts                  (direct)
 *
 * Scenario: 50 sessions open an unfiltered SSE connection (each observes every broadcast — the
 * broadest/heaviest fan-out the affinity router can produce, spec §6). 10 of those sessions then call
 * `changeset.open` on 10 DISTINCT cells, all fired concurrently (Promise.all — genuinely simultaneous,
 * not 10 sequential opens). For every (session × opened-changeset) pair we measure the wall-clock delay
 * between issuing the batch of `changeset.open` calls and that session's SSE stream observing the
 * corresponding `changeset.opened` frame. That's 50 × 10 = 500 latency samples.
 *
 * Exits non-zero (and prints which threshold failed) if the DoD isn't met — "don't fake the assertion":
 * this measures real localhost latency (Bun.serve + SQLite on the OS temp dir) and reports actual
 * numbers, it does not synthesize a passing result.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { startServer } from "../../src/index"
import { callTool, openSse, register, type SseClient } from "../helpers"

const N_SESSIONS = 50
const N_OPENERS = 10

async function main() {
  const stateDir = mkdtempSync(path.join(tmpdir(), "og-load-"))
  const s = startServer({ stateDir })
  const clients: SseClient[] = []
  try {
    console.log(`[load] registering ${N_SESSIONS} users + opening ${N_SESSIONS} unfiltered SSE sessions…`)
    const users = await Promise.all(Array.from({ length: N_SESSIONS }, (_, i) => register(s.url, `load-user-${i}`)))
    clients.push(...(await Promise.all(users.map((u) => openSse(s.url, 0, u.token)))))

    // Small settle margin: session registration (state.sessions.set) happens synchronously inside the
    // server's ReadableStream `start()`, which fires before the client's `fetch()` even resolves headers
    // — this is defensive slack, not a load-bearing wait.
    await new Promise((r) => setTimeout(r, 100))

    const openers = users.slice(0, N_OPENERS)
    const cells = openers.map((_, i) => `load:${i}`)

    // Attach one waiter PER (session, opener) BEFORE firing the batch, so the timer starts capturing
    // arrival the instant the event lands — not from whenever we got around to checking for it.
    const csIdBySlot: (string | null)[] = new Array(N_OPENERS).fill(null)
    const waiters: Promise<number>[] = []
    for (let slot = 0; slot < N_OPENERS; slot++) {
      for (const client of clients) {
        waiters.push(
          client
            .waitFor((e) => e.kind === "changeset.opened" && e.payload.cells?.[0] === cells[slot], 5_000)
            .then(() => performance.now()),
        )
      }
    }

    console.log(`[load] firing ${N_OPENERS} concurrent changeset.open calls on distinct cells…`)
    const t0 = performance.now()
    const opens = await Promise.all(
      openers.map((u, i) => callTool(s.url, "changeset.open", { token: u.token, cells: [cells[i]], intent: `load-${i}` })),
    )
    for (const o of opens) if (!o.ok && o.reason) throw new Error(`unexpected lock contention in load test: ${JSON.stringify(o)}`)

    const arrivals = await Promise.all(waiters)
    const latencies = arrivals.map((t) => t - t0).sort((a, b) => a - b)

    const p100 = latencies[latencies.length - 1]
    const under250 = latencies.filter((l) => l < 250).length
    const pctUnder250 = (under250 / latencies.length) * 100
    const p50 = latencies[Math.floor(latencies.length * 0.5)]
    const p95 = latencies[Math.floor(latencies.length * 0.95)]

    console.log(`[load] samples=${latencies.length} (${N_SESSIONS} sessions × ${N_OPENERS} opens)`)
    console.log(`[load] p50=${p50.toFixed(1)}ms  p95=${p95.toFixed(1)}ms  p100(max)=${p100.toFixed(1)}ms`)
    console.log(`[load] under 250ms: ${under250}/${latencies.length} (${pctUnder250.toFixed(1)}%)`)

    const failures: string[] = []
    if (!(p100 < 500)) failures.push(`p100 ${p100.toFixed(1)}ms >= 500ms`)
    if (!(pctUnder250 >= 85)) failures.push(`only ${pctUnder250.toFixed(1)}% < 250ms (need >= 85%)`)

    if (failures.length) {
      console.error(`[load] FAIL: ${failures.join("; ")}`)
      process.exitCode = 1
    } else {
      console.log("[load] PASS: p100 < 500ms and >= 85% < 250ms")
    }
  } finally {
    for (const c of clients) c.close()
    s.stop()
    rmSync(stateDir, { recursive: true, force: true })
  }
}

if (import.meta.main) main()
