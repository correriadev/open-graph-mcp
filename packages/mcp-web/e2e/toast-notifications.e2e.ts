import { expect, test } from "@playwright/test"
import { startHarness, type Harness } from "./fixture"

// QA-2 DoD item 4 — §10.7 literal: S1 commits, S2 sees a toast naming S1 and the cell; click jumps the
// canvas. Coalescing/cap/overflow/hover-timestamp are toasts.ts's pure logic (already unit-tested) —
// real same-csId bursts within its 500ms window aren't reproducible deterministically over a real
// network, so those parts drive the same production pushToast() the real handlers call (__og_e2e hook).

let h: Harness

test.beforeAll(async () => {
  h = await startHarness()
})
test.afterAll(async () => {
  await h.stop()
})

test("S2 commits a changeset, S1 sees a toast and clicking it jumps the canvas", async ({ browser }) => {
  const s1 = await h.openSession(browser, "alice") // observer
  const s2 = await h.openSession(browser, "bob") // opens + commits

  const [domain, level] = h.firstCell.split(":")
  await s2.page.locator("#openturn").click()
  await s2.page.locator("#cells .cd").first().selectOption(domain!)
  await s2.page.locator("#cells .cl").first().selectOption(level!)
  await s2.page.fill("#intent", "toast e2e turn")
  await s2.page.locator("#doopen").click()
  await expect(s2.page.locator("#modal")).toBeHidden()

  await s2.page.locator("#commit").click()
  await expect(s2.page.locator("#draft")).toBeHidden() // activeCsId cleared on successful commit

  const toast = s1.page.locator(".toast[data-id]").first()
  await expect(toast).toBeVisible()
  await expect(toast).toContainText("bob")
  await expect(toast).toContainText("commitou")
  await expect(toast).toContainText(h.firstCell)
  await expect(toast).toHaveAttribute("title", /\d{1,2}:\d{2}:\d{2}/) // hover timestamp (native title attr)

  const camBefore = await s1.page.evaluate(() => (window as any).__og_e2e.getCamera())
  await toast.click()
  await expect
    .poll(() => s1.page.evaluate(() => (window as any).__og_e2e.getCamera().zoom))
    .not.toBe(camBefore.zoom) // focusTarget(cell) always re-centers at zoom 0.8, distinct from the initial fitCamera zoom

  await s1.context.close()
  await s2.context.close()
})

test("coalescing (same key → \"N eventos\"), cap at 5 + overflow indicator", async ({ browser }) => {
  const s1 = await h.openSession(browser, "carol")

  async function push(key: string, text: string) {
    await s1.page.evaluate(([k, t]) => (window as any).__og_e2e.pushToast(k, t), [key, text])
  }

  await push("cs_burst", "burst event 1")
  await push("cs_burst", "burst event 2") // same key, within the 500ms default window → coalesces
  await expect(s1.page.locator(".toast[data-id]").first()).toHaveText("2 eventos em cs_burst")
  await expect(s1.page.locator(".toast[data-id]")).toHaveCount(1)

  for (let i = 0; i < 6; i++) await push(`cs_${i}`, `distinct event ${i}`)
  await expect(s1.page.locator(".toast[data-id]")).toHaveCount(5) // cap
  await expect(s1.page.locator(".toast.overflow")).toHaveText("(+2)") // burst-toast + 6 distinct - 5 shown

  await s1.context.close()
})
