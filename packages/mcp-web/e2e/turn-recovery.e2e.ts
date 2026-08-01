import { expect, test } from "@playwright/test"
import { enterEdit } from "./driver"
import { startHarness, type Harness } from "./fixture"

let harness: Harness
test.beforeAll(async () => { harness = await startHarness({ ttlMs: 60_000 }) })
test.afterAll(async () => { await harness.stop() })

test("active turn reattaches after restart, extends, and aborts without reload", async ({ browser }) => {
  test.slow()
  const alice = await harness.openSession(browser, "alice-recovery")
  const bob = await harness.openSession(browser, "bob-recovery")
  await enterEdit(alice.page, harness.firstNodeId)
  await expect(alice.page.locator("#draft")).toBeVisible()
  const heading = await alice.page.locator("#draft h3").textContent()
  await alice.page.locator("#f_subject").fill("unsent draft survives component state")
  const navigationCount = await alice.page.evaluate(() => performance.getEntriesByType("navigation").length)

  await harness.restartServer()
  await expect(alice.page.locator("#conn")).toHaveClass(/on/, { timeout: 20_000 })
  await expect(alice.page.locator("#draft h3")).toHaveText(heading!, { timeout: 20_000 })
  await expect(alice.page.locator("#f_subject")).toHaveValue("unsent draft survives component state")
  expect(await alice.page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(navigationCount)

  const ttlBefore = await alice.page.locator("#ttl").textContent()
  await alice.page.locator("#extend").click()
  await expect(alice.page.locator("#ttl")).not.toHaveText(ttlBefore ?? "")
  await alice.page.locator("#abort").click()
  await expect(alice.page.locator("#draft")).toHaveCount(0)
  await expect(bob.page.locator(".og-lock-badge")).toHaveCount(0, { timeout: 10_000 })
  await expect(bob.page.locator(".og-ghost-card")).toHaveCount(0)
  await alice.context.close()
  await bob.context.close()
})
