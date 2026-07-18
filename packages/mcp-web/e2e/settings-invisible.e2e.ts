import { expect, test } from "@playwright/test"
import { turns, webToken, webUserId } from "./driver"
import { startHarness, type Harness } from "./fixture"

// UI-1 (cenários QA-2): settings — invisível some do roster e do avatar de outra
// página; notifyCommits off suprime toast de commit pro observador que desligou;
// sessionStorage é por aba (duas abas do mesmo user, settings independentes).

let h: Harness

test.beforeAll(async () => {
  h = await startHarness()
})
test.afterAll(async () => {
  await h.stop()
})

test("invisible checkbox removes the user from another page's presence bar and avatar overlay", async ({ browser }) => {
  const s1 = await h.openSession(browser, "alice") // observadora
  const s2 = await h.openSession(browser, "bob")
  const bobUserId = await webUserId(s2.page)
  const avatar = s1.page.locator(`.og-avatar[data-user="${bobUserId}"]`)

  await expect(s1.page.locator("#pcount")).toHaveText("Conectados (2)")

  await s2.page.evaluate((cell) => (window as any).__og_e2e.setFocus(cell), h.firstCell)
  await expect(avatar).toBeVisible({ timeout: 10_000 })

  await s2.page.locator("#settingsBtn").click()
  await s2.page.locator("#s_presence").uncheck()

  // a transição pra invisível não broadcasta nada (presence.ts) — outros clientes só
  // aprendem no próximo poll de presence.who. Dispara o poll agora em vez de esperar 10s.
  await s1.page.evaluate(() => (window as any).__og_e2e.pollWho())

  await expect(s1.page.locator("#pcount")).toHaveText("Conectados (1)")
  await expect(s1.page.locator("#plist")).not.toContainText("bob")
  await expect(avatar).toHaveCount(0)

  await s1.context.close()
  await s2.context.close()
})

test("commit-notification checkbox off suppresses the toast for the observer who disabled it", async ({ browser }) => {
  const s1 = await h.openSession(browser, "carol") // observadora, desliga notifyCommits
  const s2 = await h.openSession(browser, "dave") // commita via API

  await s1.page.locator("#settingsBtn").click()
  await s1.page.locator("#s_notify").uncheck()
  await s1.page.locator("#sclose").click()

  const dave = turns(h, await webToken(s2.page))
  const opened = await dave.open([h.firstCell], "settings-invisible e2e turn")
  await dave.commit(opened.csId ?? opened.id)

  // dá tempo dum round-trip real de evento, então afirma que toast nenhum apareceu
  await s1.page.waitForTimeout(1_000)
  await expect(s1.page.locator(".toast[data-id]")).toHaveCount(0)

  await s1.context.close()
  await s2.context.close()
})

test("sessionStorage settings persist per tab, not shared across two pages of the same user", async ({ browser }) => {
  const context = await browser.newContext()
  const s1 = await h.openSessionInContext(context, "erin")
  const s2 = await h.openSessionInContext(context, "erin") // mesma identidade, 2ª aba

  await s1.page.locator("#settingsBtn").click()
  await s1.page.locator("#s_notify").uncheck()
  await s1.page.locator("#sclose").click()

  await s2.page.locator("#settingsBtn").click()
  await expect(s2.page.locator("#s_notify")).toBeChecked() // sessionStorage independente

  await context.close()
})
