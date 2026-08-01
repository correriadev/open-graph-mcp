#!/usr/bin/env bun
/**
 * presence-load.ts — Fase 3 §11 / DoD §1: "50 usuários simultâneos conectados, 10 abrindo turno
 * concorrentemente, todos recebem seus eventos < 500ms (85% < 250ms)." Also QA-5 (roadmap-qa):
 * sustained soak + broadcast-storm scenarios (the burst above only measures ONE moment in time).
 *
 * NOT a `bun test` file on purpose (filename doesn't match `*.test.ts`) — this is a load/latency
 * measurement, not a correctness assertion suite; it's slower and more environment-sensitive than the
 * rest of the suite (real wall-clock timing over 50 real HTTP/SSE connections) and shouldn't gate normal
 * `bun test` runs. Run explicitly:
 *
 *   bun run test:load                              (default burst scenario)
 *   bun run test:soak                               (QA-5: 10 min sustained — 50 sessions, beat/claims/focus churn)
 *   bun test/load/presence-load.ts --storm          (QA-5: broadcast storm — typing_state coalescence under fan-out)
 *   bun test/load/presence-load.ts                  (direct, same as test:load)
 *
 * Scenario (default, no flag): 50 sessions open an unfiltered SSE connection (each observes every
 * broadcast — the broadest/heaviest fan-out the affinity router can produce, spec §6). 10 of those
 * sessions then call `changeset.open` on 10 DISTINCT cells, all fired concurrently (Promise.all —
 * genuinely simultaneous, not 10 sequential opens). For every (session × opened-changeset) pair we
 * measure the wall-clock delay between issuing the batch of `changeset.open` calls and that session's
 * SSE stream observing the corresponding `changeset.opened` frame. That's 50 × 10 = 500 latency samples.
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

/**
 * Lightweight SSE connection for the soak scenario — captures the session's `sessionId` from the
 * first frame, then DISCARDS every subsequent frame instead of accumulating it.
 *
 * `openSse` (helpers.ts) keeps every received event forever in an `events: any[]` array — correct for
 * short-lived correctness tests that need to assert on history, but a real memory leak of its own when
 * used for a 10-minute soak: 50 unfiltered connections receiving every commit/open/focus broadcast in
 * the tenant accumulate thousands of retained JS objects in the SAME process as the server under test
 * (`startServer` runs in-process, not out-of-process), which drowns out whatever RSS signal the soak is
 * actually trying to measure. Soak doesn't need event history — latency is sampled via HTTP RPC
 * round-trip, not SSE arrival (see `runSoak`) — so discarding is correct, not a shortcut.
 */
async function openSseDiscard(base: string, token: string): Promise<{ sessionId: string; close: () => void }> {
  const controller = new AbortController()
  const res = await fetch(`${base}/events?${new URLSearchParams({ since: "0", token })}`, { signal: controller.signal })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  let resolveSessionId!: (id: string) => void
  const sessionIdPromise = new Promise<string>((resolve) => {
    resolveSessionId = resolve
  })
  let gotSessionId = false
  const pump = async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buf += decoder.decode(value, { stream: true })
      let cut: number
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, cut)
        buf = buf.slice(cut + 2)
        if (!gotSessionId) {
          const dataLine = raw.split("\n").find((l) => l.startsWith("data: "))
          if (dataLine) {
            const evt = JSON.parse(dataLine.slice(6))
            if (evt.sessionId) {
              gotSessionId = true
              resolveSessionId(evt.sessionId)
            }
          }
        }
        // everything else: parsed and dropped, on purpose — see doc comment above.
      }
    }
  }
  pump().catch(() => {})
  const sessionId = await sessionIdPromise
  return {
    sessionId,
    close: () => {
      controller.abort()
      reader.cancel().catch(() => {})
    },
  }
}

const N_SESSIONS = 50
const N_OPENERS = 10

// QA-5 soak knobs. SOAK_DURATION_MS is an escape hatch for a quick dry run of the harness itself
// (e.g. `SOAK_DURATION_MS=15000 bun run test:soak`) — the DoD number (and what perf-log.md records)
// is always the untouched 10-minute default.
const SOAK_DURATION_MS = Number(process.env.SOAK_DURATION_MS ?? 10 * 60_000)
const SOAK_SESSIONS = 50
const SOAK_HOLDERS = 10
const SOAK_BEAT_INTERVAL_MS = 15_000
const SOAK_FOCUS_CHURN_MS = 30_000
const SOAK_MEASURE_INTERVAL_MS = 60_000
const SOAK_CELL_POOL = 8 // small pool → focus churn actually collides/rotates instead of each session owning its own cell forever

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

// ── QA-5: soak (sustained 10 min) ───────────────────────────────────────────────────────────────
/**
 * 50 SSE sessions stay connected for SOAK_DURATION_MS: all 50 heartbeat every 15s (presence.beat),
 * all 50 churn their focus cell every ~30s, and 10 designated "holders" claim continuously (one
 * `changeset.claim` per second each, on a changeset opened once up front — real sustained authoring,
 * not a burst). Measures, once per minute: RSS and the latency of the focus-churn RPC itself.
 *
 * Latency here is the presence.focus HTTP round-trip, NOT SSE fan-out arrival like the burst
 * scenario above — correlating 50 observers × every churn over 10 minutes is a heavier, different
 * metric than "is the server still responsive under sustained load", which is what soak needs.
 */
async function runSoak() {
  const stateDir = mkdtempSync(path.join(tmpdir(), "og-soak-"))
  const s = startServer({ stateDir })
  const clients: { sessionId: string; close: () => void }[] = []
  try {
    const nMinutes = Math.ceil(SOAK_DURATION_MS / SOAK_MEASURE_INTERVAL_MS)
    console.log(`[soak] duration=${(SOAK_DURATION_MS / 60_000).toFixed(1)}min sessions=${SOAK_SESSIONS} holders=${SOAK_HOLDERS}`)

    const users = await Promise.all(Array.from({ length: SOAK_SESSIONS }, (_, i) => register(s.url, `soak-user-${i}`)))
    clients.push(...(await Promise.all(users.map((u) => openSseDiscard(s.url, u.token)))))
    const sessionIds = clients.map((c) => c.sessionId)

    // 10 holders open a changeset on their own cell, then claim continuously for the whole run —
    // unique claim id per call (the gate rejects duplicate ids; this IS continuous authoring, not a
    // workaround). Every SOAK_CLAIMS_PER_CYCLE claims they commit and reopen: real authors don't keep
    // one changeset open with thousands of uncommitted deltas forever, and an ever-growing single
    // open cs_deltas list would confound the RSS-leak signal below with plain linear data growth —
    // bounding the working set is what makes "monotonic RSS growth" actually mean "leak" instead of
    // "the holder kept writing".
    const holders = users.slice(0, SOAK_HOLDERS)
    const holderCells = holders.map((_, i) => `soak-holder:${i}`)
    const SOAK_CLAIMS_PER_CYCLE = 5

    let stopped = false
    let claimCount = 0
    const claimLoops = holders.map(async (u, i) => {
      let n = 0
      let csId: string = await callTool(s.url, "changeset.open", { token: u.token, cells: [holderCells[i]], intent: `soak-${i}` }).then((r: any) => r.csId)
      while (!stopped) {
        await callTool(s.url, "changeset.claim", {
          token: u.token,
          csId,
          delta: { kind: "claim.add", payload: { id: `soak-${i}-${n}`, subject: "s", domain: "soak", level: 1, refs: [] } },
        }).catch(() => {})
        claimCount++
        n++
        if (n % SOAK_CLAIMS_PER_CYCLE === 0) {
          await callTool(s.url, "changeset.commit", { token: u.token, csId, intent: `soak-${i}-${n}` }).catch(() => {})
          csId = await callTool(s.url, "changeset.open", { token: u.token, cells: [holderCells[i]], intent: `soak-${i}-${n}` })
            .then((r: any) => r.csId)
            .catch(() => csId)
        }
        await new Promise((r) => setTimeout(r, 1_000))
      }
    })

    let beatCount = 0
    const beatTimer = setInterval(() => {
      for (let i = 0; i < clients.length; i++) {
        callTool(s.url, "presence.beat", { token: users[i].token, sessionId: sessionIds[i] })
          .then(() => beatCount++)
          .catch(() => {})
      }
    }, SOAK_BEAT_INTERVAL_MS)

    const t0 = performance.now()
    const latencyByMinute: number[][] = Array.from({ length: nMinutes }, () => [])
    const minuteOf = (elapsedMs: number) => Math.min(nMinutes - 1, Math.floor(elapsedMs / SOAK_MEASURE_INTERVAL_MS))

    const focusTimer = setInterval(() => {
      const churnStep = Math.floor((performance.now() - t0) / SOAK_FOCUS_CHURN_MS)
      for (let i = 0; i < clients.length; i++) {
        const cell = `soak-churn:${(i + churnStep) % SOAK_CELL_POOL}`
        const start = performance.now()
        callTool(s.url, "presence.focus", { token: users[i].token, sessionId: sessionIds[i], cell })
          .then(() => latencyByMinute[minuteOf(start - t0)].push(performance.now() - start))
          .catch(() => {})
      }
    }, SOAK_FOCUS_CHURN_MS)

    const rssByMinute: number[] = []
    for (let m = 0; m < nMinutes; m++) {
      // Last bucket may be shorter than SOAK_MEASURE_INTERVAL_MS when SOAK_DURATION_MS isn't an exact
      // multiple of it (only matters for the SOAK_DURATION_MS dry-run override — the real 10-minute
      // default always divides evenly).
      const waitMs = Math.min(SOAK_MEASURE_INTERVAL_MS, SOAK_DURATION_MS - m * SOAK_MEASURE_INTERVAL_MS)
      await new Promise((r) => setTimeout(r, waitMs))
      rssByMinute.push(process.memoryUsage().rss)
      console.log(
        `[soak] minute ${m + 1}/${nMinutes}: rss=${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)}MB claims=${claimCount} beats=${beatCount}`,
      )
    }

    stopped = true
    clearInterval(beatTimer)
    clearInterval(focusTimer)
    await Promise.all(claimLoops)

    const p95 = (xs: number[]) => {
      const sorted = [...xs].sort((a, b) => a - b)
      return sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0
    }
    const firstP95 = p95(latencyByMinute[0])
    const lastP95 = p95(latencyByMinute[latencyByMinute.length - 1])

    const warmed = rssByMinute[1] ?? rssByMinute[0]
    const final = rssByMinute[rssByMinute.length - 1]
    const rssGrowthPct = ((final - warmed) / warmed) * 100
    // Small epsilon so ordinary GC/heap jitter of a few KB doesn't read as "monotonic" — this is
    // looking for a leak SHAPE (every single minute strictly bigger), not noise.
    const monotonic = rssByMinute.length > 2 && rssByMinute.slice(1).every((v, i) => v > rssByMinute[i] * 1.001)

    console.log(`[soak] latency (presence.focus RPC) p95 first-min=${firstP95.toFixed(1)}ms last-min=${lastP95.toFixed(1)}ms`)
    console.log(`[soak] rss warmed(min2)=${(warmed / 1024 / 1024).toFixed(1)}MB final=${(final / 1024 / 1024).toFixed(1)}MB growth=${rssGrowthPct.toFixed(1)}%`)

    for (const c of clients) c.close()
    await new Promise((r) => setTimeout(r, 200)) // let SSE cancel() handlers drain state.sessions
    const orphanSessions = s.state.sessions.size
    console.log(`[soak] orphan sessions after close: ${orphanSessions}`)

    const failures: string[] = []
    if (firstP95 > 0 && !(lastP95 < 2 * firstP95)) failures.push(`latency degraded: last-min p95 ${lastP95.toFixed(1)}ms >= 2x first-min p95 ${firstP95.toFixed(1)}ms`)
    if (!(rssGrowthPct < 20)) failures.push(`rss grew ${rssGrowthPct.toFixed(1)}% (min2→final), need < 20%`)
    if (monotonic) failures.push(`rss grew monotonically every minute (leak signature): ${rssByMinute.map((v) => (v / 1024 / 1024).toFixed(1)).join(", ")}MB`)
    if (orphanSessions !== 0) failures.push(`${orphanSessions} orphan session(s) left in state.sessions after all clients closed`)

    if (failures.length) {
      console.error(`[soak] FAIL: ${failures.join("; ")}`)
      process.exitCode = 1
    } else {
      console.log("[soak] PASS")
    }
  } finally {
    s.stop()
    rmSync(stateDir, { recursive: true, force: true })
  }
}

// ── QA-5: broadcast storm ───────────────────────────────────────────────────────────────────────
/**
 * 50 sessions each focus their own cell, then fire CLAIMS_PER_USER rapid `changeset.claim` calls
 * concurrently (Promise.all across all 50 users at once — genuine concurrent pressure, not
 * sequential). Asserts `user.typing_state` stays a coalesced per-user TRANSITION signal (spec Fase 3
 * §5.1: broadcast only on quiet↔typing↔idle transition, never per-tick/per-claim) even under this
 * fan-out: event count must stay ≪ claim count.
 */
async function runStorm() {
  const stateDir = mkdtempSync(path.join(tmpdir(), "og-storm-"))
  const s = startServer({ stateDir })
  const clients: SseClient[] = []
  try {
    const N = 50
    const CLAIMS_PER_USER = 40
    console.log(`[storm] ${N} sessions, each focusing its own cell then firing ${CLAIMS_PER_USER} rapid claims concurrently…`)

    const users = await Promise.all(Array.from({ length: N }, (_, i) => register(s.url, `storm-user-${i}`)))
    const observerUser = await register(s.url, "storm-observer")
    const observer = await openSse(s.url, 0, observerUser.token) // unfiltered — sees every broadcast tenant-wide
    const actorClients = await Promise.all(users.map((u) => openSse(s.url, 0, u.token)))
    clients.push(observer, ...actorClients)
    await new Promise((r) => setTimeout(r, 100))

    const cells = users.map((_, i) => `storm:${i}`)
    const csIds = await Promise.all(
      users.map((u, i) => callTool(s.url, "changeset.open", { token: u.token, cells: [cells[i]], intent: `storm-${i}` }).then((r: any) => r.csId)),
    )
    const sessionIds = actorClients.map((c) => c.events[0].sessionId as string)
    await Promise.all(users.map((u, i) => callTool(s.url, "presence.focus", { token: u.token, sessionId: sessionIds[i], cell: cells[i] })))
    await new Promise((r) => setTimeout(r, 50)) // let the focus debounce settle before the claim storm starts

    let totalClaims = 0
    await Promise.all(
      users.map(async (u, i) => {
        for (let n = 0; n < CLAIMS_PER_USER; n++) {
          await callTool(s.url, "changeset.claim", {
            token: u.token,
            csId: csIds[i],
            delta: { kind: "claim.add", payload: { id: `storm-${i}-${n}`, subject: "s", domain: "storm", level: 1, refs: [] } },
          })
          totalClaims++
        }
      }),
    )

    // Give the real sweeper (default typingIntervalMs=500ms) a couple of ticks to catch the
    // quiet→typing transitions before we count — no manual s.tickTypingNow() here on purpose, this
    // script exercises the real background sweeper, not the unit-test shortcut.
    await new Promise((r) => setTimeout(r, 1_500))

    const typingEvents = observer.events.filter((e) => e.kind === "user.typing_state")
    const ratio = typingEvents.length / totalClaims

    console.log(`[storm] claims=${totalClaims} typing_state events=${typingEvents.length} (ratio=${(ratio * 100).toFixed(2)}%)`)

    const failures: string[] = []
    if (!(typingEvents.length <= 2 * N)) failures.push(`typing_state events ${typingEvents.length} too high for ${N} sessions (expected ~1 quiet→typing transition each, got > 2x)`)
    if (!(ratio < 0.1)) failures.push(`typing_state/claims ratio ${(ratio * 100).toFixed(2)}% too high (expected ≪ 1, coalescence broken)`)

    if (failures.length) {
      console.error(`[storm] FAIL: ${failures.join("; ")}`)
      process.exitCode = 1
    } else {
      console.log("[storm] PASS: user.typing_state stayed coalesced under concurrent claim storm")
    }
  } finally {
    for (const c of clients) c.close()
    s.stop()
    rmSync(stateDir, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.includes("--soak")) await runSoak()
  else if (args.includes("--storm")) await runStorm()
  else await main()
}
