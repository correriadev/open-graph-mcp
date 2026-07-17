import { expect, test } from "@playwright/test"
import { startHarness, type Harness } from "./fixture"

// QA-2 DoD item 5: settings modal — invisible checkbox hides the user from another page's presence bar
// and canvas avatar; commit-notification checkbox off suppresses commit toasts for the observer who
// disabled it; sessionStorage persistence is per-tab (two pages of the same user, independent settings).

let h: Harness

test.beforeAll(async () => {
  h = await startHarness()
})
test.afterAll(async () => {
  await h.stop()
})

test("invisible checkbox removes the user from another page's presence bar and avatar overlay", async ({ browser }) => {
  const s1 = await h.openSession(browser, "alice") // observer
  const s2 = await h.openSession(browser, "bob")
  const bobUserId = await s2.page.evaluate(() => localStorage.getItem("og.userId"))

  await expect(s1.page.locator("#pcount")).toHaveText("Conectados (2)")

  await s2.page.evaluate((cell) => (window as any).__og_e2e.setFocus(cell), h.firstCell)
  await expect
    .poll(() => s1.page.evaluate((uid) => (window as any).__og_e2e.avatarScreenPos(uid), bobUserId))
    .not.toBeNull()

  await s2.page.locator("#settingsBtn").click()
  await s2.page.locator("#s_presence").uncheck()

  // presence.focus's invisible transition broadcasts nothing (presence.ts) — other clients only learn
  // about it from the next presence.who poll. Trigger that poll now instead of waiting the real 10s.
  await s1.page.evaluate(() => (window as any).__og_e2e.pollWho())

  await expect(s1.page.locator("#pcount")).toHaveText("Conectados (1)")
  await expect(s1.page.locator("#plist")).not.toContainText("bob")
  expect(await s1.page.evaluate((uid) => (window as any).__og_e2e.avatarScreenPos(uid), bobUserId)).toBeNull()

  await s1.context.close()
  await s2.context.close()
})

test("commit-notification checkbox off suppresses the toast for the observer who disabled it", async ({ browser }) => {
  const s1 = await h.openSession(browser, "carol") // observer, disables notifyCommits
  const s2 = await h.openSession(browser, "dave") // commits

  await s1.page.locator("#settingsBtn").click()
  await s1.page.locator("#s_notify").uncheck()
  await s1.page.locator("#sclose").click()

  const [domain, level] = h.firstCell.split(":")
  await s2.page.locator("#openturn").click()
  await s2.page.locator("#cells .cd").first().selectOption(domain!)
  await s2.page.locator("#cells .cl").first().selectOption(level!)
  await s2.page.fill("#intent", "settings-invisible e2e turn")
  await s2.page.locator("#doopen").click()
  await expect(s2.page.locator("#modal")).toBeHidden()
  await s2.page.locator("#commit").click()
  await expect(s2.page.locator("#draft")).toBeHidden()

  // Give a real event round-trip a moment to land, then assert no toast ever showed up.
  await s1.page.waitForTimeout(1_000)
  await expect(s1.page.locator(".toast[data-id]")).toHaveCount(0)

  await s1.context.close()
  await s2.context.close()
})

test("sessionStorage settings persist per tab, not shared across two pages of the same user", async ({ browser }) => {
  const context = await browser.newContext()
  const s1 = await h.openSessionInContext(context, "erin")
  const s2 = await h.openSessionInContext(context, "erin") // same identity (shared localStorage), 2nd tab

  await s1.page.locator("#settingsBtn").click()
  await s1.page.locator("#s_notify").uncheck()
  await s1.page.locator("#sclose").click()

  await s2.page.locator("#settingsBtn").click()
  await expect(s2.page.locator("#s_notify")).toBeChecked() // independent sessionStorage, unaffected by s1

  await context.close()
})
