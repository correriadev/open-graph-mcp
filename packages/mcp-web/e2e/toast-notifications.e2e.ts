import { expect, test } from "@playwright/test"
import { turns, webToken } from "./driver"
import { startHarness, type Harness } from "./fixture"

// UI-1 (cenários QA-2 §10.7): S2 commita, S1 vê toast com nome + cell; clique
// centra a câmera. Coalescing/cap/overflow são lógica pura do toasts.ts (unit-
// tested) — o teste DOM dirige o mesmo pushToast de produção via __og_e2e.
// Turnos via API com o token do próprio user web (modal de turno nasce em UI-2).

let h: Harness

test.beforeAll(async () => {
  h = await startHarness()
})
test.afterAll(async () => {
  await h.stop()
})

test("S2 commits a changeset, S1 sees a toast and clicking it centers the camera", async ({ browser }) => {
  const s1 = await h.openSession(browser, "alice") // observadora
  const s2 = await h.openSession(browser, "bob") // abre + commita via API

  const bob = turns(h, await webToken(s2.page))
  const opened = await bob.open([h.firstCell], "toast e2e turn")
  const csId = opened.csId ?? opened.id
  await bob.commit(csId)

  const toast = s1.page.locator(".toast[data-id]").first()
  await expect(toast).toBeVisible()
  await expect(toast).toContainText("bob")
  await expect(toast).toContainText("commitou")
  await expect(toast).toContainText(h.firstCell)
  await expect(toast).toHaveAttribute("title", /\d{1,2}:\d{2}:\d{2}/) // timestamp no hover (title nativo)

  const before = await s1.page.evaluate(() => (window as any).__og_e2e.getViewport())
  await toast.click()
  await expect
    .poll(() => s1.page.evaluate(() => (window as any).__og_e2e.getViewport().zoom))
    .not.toBe(before.zoom) // setCenter centra a cell a zoom 0.8, distinto do fitView inicial

  await s1.context.close()
  await s2.context.close()
})

test('coalescing (same key → "N eventos"), cap at 5 + overflow indicator', async ({ browser }) => {
  const s1 = await h.openSession(browser, "carol")

  async function push(key: string, text: string) {
    await s1.page.evaluate(([k, t]) => (window as any).__og_e2e.pushToast(k, t), [key, text])
  }

  await push("cs_burst", "burst event 1")
  await push("cs_burst", "burst event 2") // mesma key, dentro da janela de 500ms → coalesce
  await expect(s1.page.locator(".toast[data-id]").first()).toHaveText("2 eventos em cs_burst")
  await expect(s1.page.locator(".toast[data-id]")).toHaveCount(1)

  for (let i = 0; i < 6; i++) await push(`cs_${i}`, `distinct event ${i}`)
  await expect(s1.page.locator(".toast[data-id]")).toHaveCount(5) // cap
  await expect(s1.page.locator(".toast.overflow")).toHaveText("(+2)") // burst + 6 distintos - 5 visíveis

  await s1.context.close()
})
