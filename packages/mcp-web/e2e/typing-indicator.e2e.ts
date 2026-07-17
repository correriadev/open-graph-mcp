import { expect, test } from "@playwright/test"
import { startHarness, type Harness } from "./fixture"

// QA-2 DoD item 3: typing indicator — appears during claims, disappears on the quiet transition,
// disappears when the typing user goes invisible (Task 3 fix, exercised end-to-end here).
//
// typingMs/idleMs are given a real but small ordering (typingMs < idleMs, unlike server defaults'
// 2000/5000) so the idle→quiet real-clock transition (lastDeltaAt is a genuine timestamp, not something
// the control channel can fake) only costs ~1s of real wait instead of 5s — QD2/QD5: a real window, not
// a blind sleep, and never shrunk so far it races the client's own timers (unlike presenceTtlMs earlier).

let h: Harness

test.beforeAll(async () => {
  h = await startHarness({ typingMs: 200, idleMs: 500 })
})
test.afterAll(async () => {
  await h.stop()
})

test("typing indicator appears on claim, disappears when quiet, disappears when invisible", async ({ browser }) => {
  const s1 = await h.openSession(browser, "alice") // observer
  const s2 = await h.openSession(browser, "bob") // types

  await s2.page.evaluate((cell) => (window as any).__og_e2e.setFocus(cell), h.firstCell)

  const [domain, level] = h.firstCell.split(":")
  await s2.page.locator("#openturn").click()
  await s2.page.locator("#cells .cd").first().selectOption(domain!)
  await s2.page.locator("#cells .cl").first().selectOption(level!)
  await s2.page.fill("#intent", "typing-indicator e2e turn")
  await s2.page.locator("#doopen").click()
  await expect(s2.page.locator("#modal")).toBeHidden()

  // ---- claim → typing ----
  // changeset.claim's touchDelta (typing.ts) runs unconditionally before the gate check (Fase 3 §5.1:
  // "está mexendo" is the signal, not gate success) — the plain form's payload has no `id` field so
  // incrementalGate will refuse it, which is fine here: this spec only needs the typing side-effect.
  async function submitClaim() {
    await s2.page.fill("#f_subject", "irrelevant to typing")
    await s2.page.locator("#addclaim").click()
  }
  await submitClaim()

  await h.control("tickTypingNow")
  await expect(s1.page.locator("#typing")).toBeVisible()
  await expect(s1.page.locator("#typing")).toContainText("bob")
  await expect(s1.page.locator("#typing")).toContainText("editando")

  // ---- real clock passes idleMs → quiet ----
  await s1.page.waitForTimeout(600)
  await h.control("tickTypingNow")
  await expect(s1.page.locator("#typing")).toBeHidden()

  // ---- typing again, then invisible mid-typing → forceQuiet fires immediately ----
  await submitClaim()
  await h.control("tickTypingNow")
  await expect(s1.page.locator("#typing")).toBeVisible()

  await s2.page.locator("#settingsBtn").click()
  await s2.page.locator("#s_presence").uncheck()
  await expect(s1.page.locator("#typing")).toBeHidden()

  await s1.context.close()
  await s2.context.close()
})
