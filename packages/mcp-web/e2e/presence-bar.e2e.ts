import { expect, test, type Page } from "@playwright/test"
import { startHarness, type Harness } from "./fixture"

// QA-2 DoD item 1: presence bar — "Conectados (N)" count, dot color from lastSeen
// (green <30s / yellow 30-60s / gray >60s, spec §7.1), expand/collapse.

let h: Harness

test.beforeAll(async () => {
  h = await startHarness()
})
test.afterAll(async () => {
  await h.stop()
})

test("shows Conectados (N) and updates live as a second session joins", async ({ browser }) => {
  const s1 = await h.openSession(browser, "alice")
  await expect(s1.page.locator("#pcount")).toHaveText("Conectados (1)")

  const s2 = await h.openSession(browser, "bob")
  await expect(s1.page.locator("#pcount")).toHaveText("Conectados (2)")
  await expect(s2.page.locator("#pcount")).toHaveText("Conectados (2)")

  const items = s1.page.locator("#plist li")
  await expect(items).toHaveCount(2)
  await expect(s1.page.locator("#plist")).toContainText("alice")
  await expect(s1.page.locator("#plist")).toContainText("bob")

  await s1.context.close()
  await s2.context.close()
})

test("ptoggle collapses and expands the roster list", async ({ browser }) => {
  const s1 = await h.openSession(browser, "carol")
  await expect(s1.page.locator("#plist li")).toHaveCount(1)

  await s1.page.locator("#ptoggle").click()
  await expect(s1.page.locator("#presence")).toHaveClass(/collapsed/)
  await expect(s1.page.locator("#plist li")).toHaveCount(0)

  await s1.page.locator("#ptoggle").click()
  await expect(s1.page.locator("#presence")).not.toHaveClass(/collapsed/)
  await expect(s1.page.locator("#plist li")).toHaveCount(1)

  await s1.context.close()
})

/** Rewrites `target`'s lastSeen in every presence.who response `page` receives, from then on. */
async function mockLastSeen(page: Page, target: string, lastSeen: number): Promise<void> {
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON()
    if (body?.method !== "tools/call" || body?.params?.name !== "presence.who") {
      await route.continue()
      return
    }
    const res = await route.fetch()
    const json = await res.json()
    const users = json?.result?.structuredContent?.users
    if (Array.isArray(users)) {
      for (const u of users) if (u.name === target) u.lastSeen = lastSeen
    }
    await route.fulfill({ status: res.status(), headers: res.headers(), body: JSON.stringify(json) })
  })
}

function dotClass(page: Page, name: string) {
  return page.locator("#plist li", { hasText: name }).locator(".dot")
}

test("dot goes yellow then gray as the other user's lastSeen ages, via mocked presence.who", async ({ browser }) => {
  test.slow() // waits real 10s poll ticks twice — see mockLastSeen comment above
  const s1 = await h.openSession(browser, "dana")
  const s2 = await h.openSession(browser, "erin")
  await expect(s1.page.locator("#pcount")).toHaveText("Conectados (2)")
  await expect(dotClass(s1.page, "erin")).toHaveClass(/green/)

  await mockLastSeen(s1.page, "erin", Date.now() - 45_000) // 30-60s → yellow
  await expect(dotClass(s1.page, "erin")).toHaveClass(/yellow/, { timeout: 15_000 })

  await mockLastSeen(s1.page, "erin", Date.now() - 90_000) // >60s → gray
  await expect(dotClass(s1.page, "erin")).toHaveClass(/gray/, { timeout: 15_000 })

  await s1.context.close()
  await s2.context.close()
})
