import { expect, test } from "@playwright/test"
import { webUserId } from "./driver"
import { startHarness, type Harness } from "./fixture"

// UI-1 (cenários QA-2 §10.9 web): mata o processo real do server e reinicia (mesmo
// stateDir/porta — restartServer()), então: toast "Server reiniciou", toast QA-1
// "Sessão renovada", #conn volta a on, e o focus do bob é redeclarado sozinho
// (avatar reaparece SEM re-chamar setFocus). Contagem de /events: ≥2 (reconexão
// natural + doReregister por token morto) e limitada — nunca loop de reconexão.
// (Racional completo do bound no spec antigo, HEAD~2:.../reconnect.e2e.ts.)

let h: Harness

test.beforeAll(async () => {
  h = await startHarness()
})
test.afterAll(async () => {
  await h.stop()
})

test("server restart: toasts, presence auto-redeclared, bounded reconnect", async ({ browser }) => {
  test.slow() // backoff real (500ms→1s→...) + round-trip de reconexão
  const s1 = await h.openSession(browser, "alice") // observadora
  const s2 = await h.openSession(browser, "bob")
  const bobUserId = await webUserId(s2.page)
  const avatar = s1.page.locator(`.og-avatar[data-user="${bobUserId}"]`)

  await s2.page.evaluate((cell) => (window as any).__og_e2e.setFocus(cell), h.firstCell)
  await expect(avatar).toBeVisible({ timeout: 10_000 })

  let eventsRequests = 0
  s1.page.on("request", (req) => {
    if (req.url().includes("/events")) eventsRequests++
  })

  await h.restartServer()

  // dois toasts distintos, ambos esperados: broadcast server.restarted + prova do QA-1
  await expect(s1.page.locator(".toast", { hasText: "Server reiniciou" })).toBeVisible({ timeout: 20_000 })
  await expect(s1.page.locator(".toast", { hasText: "Sessão renovada" })).toBeVisible({ timeout: 20_000 })
  await expect(s1.page.locator("#conn")).toHaveClass(/on/, { timeout: 20_000 })

  // focus foi setado UMA vez, antes do restart — reaparecer prova o redeclarePresence automático
  await expect(avatar).toBeVisible({ timeout: 20_000 })

  expect(eventsRequests).toBeGreaterThanOrEqual(2)
  expect(eventsRequests).toBeLessThan(6)

  await s1.context.close()
  await s2.context.close()
})
