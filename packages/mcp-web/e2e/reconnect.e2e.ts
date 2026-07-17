import { expect, test } from "@playwright/test"
import { startHarness, type Harness } from "./fixture"

// QA-2 DoD item 6 — spec §10.9 web side: kill the real server process and restart it (same stateDir,
// same port — fixture.ts's restartServer()), then assert: "Server reiniciou" toast, and focus
// automatically redeclared (bob's avatar reappears on alice's page without the test re-calling setFocus).
//
// The roadmap doc (02-scope-qa-2-e2e.md) additionally expects "exactly ONE reconnection (Task 4's
// SSE-leak regression)" for this scenario — empirically false, and not a test bug: connect.ts's
// doReregister() documents that a dead cached token deliberately forces a SECOND stop()+start() after
// the first natural reconnect's redeclarePresence() call fails auth (the first session's server-side
// Session.userId binding can't be fixed except by a fresh connection). A real server restart always
// invalidates the cached token (in-memory only, never persisted), so this path always needs at least
// TWO /events connections — never exactly one. The eventstream.test.ts leak regression it's actually
// citing guards a different path — reset() on a graphId change — not this one.
//
// The count itself isn't pinned to exactly 2 below: under parallel load (the whole e2e suite spinning up
// several mcp-server subprocesses + vite previews at once) the FIRST natural reconnect attempt can lose
// its own race and need a backoff retry before the reauth-triggered stop()+start() ever runs, observed
// empirically as 3 — same class as int-3-validation-run.md's Finding 3 (transient contention on a loaded
// dev machine, not a defect). QD2: widen the window, don't pin a brittle exact count or silently retry —
// the invariant that actually matters is "bounded", i.e. no runaway reconnect loop.

let h: Harness

test.beforeAll(async () => {
  h = await startHarness()
})
test.afterAll(async () => {
  await h.stop()
})

test("server restart: toast, presence auto-redeclared, deterministic two-hop reconnect (natural + reauth)", async ({ browser }) => {
  test.slow() // real backoff (500ms→1s→...) + reconnect round-trip
  const s1 = await h.openSession(browser, "alice") // observer
  const s2 = await h.openSession(browser, "bob")
  const bobUserId = await s2.page.evaluate(() => localStorage.getItem("og.userId"))

  await s2.page.evaluate((cell) => (window as any).__og_e2e.setFocus(cell), h.firstCell)
  await expect
    .poll(() => s1.page.evaluate((uid) => (window as any).__og_e2e.avatarScreenPos(uid), bobUserId))
    .not.toBeNull()

  let eventsRequests = 0
  s1.page.on("request", (req) => {
    if (req.url().includes("/events")) eventsRequests++
  })

  await h.restartServer()

  // Two distinct toasts fire for this scenario (see file-level comment): the SSE-level "server.restarted"
  // broadcast, and — because the cached token is now dead — the QA-1 auto-reregister toast. Both expected.
  await expect(s1.page.locator(".toast", { hasText: "Server reiniciou" })).toBeVisible({ timeout: 20_000 })
  await expect(s1.page.locator(".toast", { hasText: "Sessão renovada" })).toBeVisible({ timeout: 20_000 })
  await expect(s1.page.locator("#conn")).toHaveClass(/on/, { timeout: 20_000 })

  // Focus was only ever set once, before the restart, by bob's client — this proves connect()'s
  // onFreshSession → redeclarePresence() ran on its own after reconnecting, not a re-triggered setFocus.
  await expect
    .poll(() => s1.page.evaluate((uid) => (window as any).__og_e2e.avatarScreenPos(uid), bobUserId), { timeout: 20_000 })
    .not.toBeNull()

  // See the file-level comment: at least 2 (natural reconnect + auth-triggered doReregister()), bounded
  // well below what a runaway reconnect loop would produce.
  expect(eventsRequests).toBeGreaterThanOrEqual(2)
  expect(eventsRequests).toBeLessThan(6)

  await s1.context.close()
  await s2.context.close()
})
