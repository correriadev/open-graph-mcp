import { expect, test } from "@playwright/test"
import { turns, webToken, webUserId } from "./driver"
import { startHarness, type Harness } from "./fixture"

// UI-1 (cenários QA-2): avatar overlay — badge semi-transparente em focus sem
// lock, sólido quando a cell tem lock do próprio user, tooltip no hover.
// Avatares agora são DOM (ViewportPortal) — asserts diretos, sem hooks de canvas.

let h: Harness

test.beforeAll(async () => {
  h = await startHarness()
})
test.afterAll(async () => {
  await h.stop()
})

test("unlocked focus draws a semi-transparent avatar; a lock on the same cell makes it solid", async ({ browser }) => {
  const s1 = await h.openSession(browser, "alice") // observadora
  const s2 = await h.openSession(browser, "bob") // foca/locka
  const bobUserId = await webUserId(s2.page)
  const avatar = s1.page.locator(`.og-avatar[data-user="${bobUserId}"]`)

  // ---- focus sem lock: semi-transparente (sem .solid) ----
  await s2.page.evaluate((cell) => (window as any).__og_e2e.setFocus(cell), h.firstCell)
  await expect(avatar).toBeVisible({ timeout: 10_000 })
  await expect(avatar).not.toHaveClass(/solid/)

  await avatar.hover()
  const tip = avatar.locator(".avatar-tip")
  await expect(tip).toBeVisible()
  await expect(tip).toContainText("bob")
  await expect(tip).toContainText("web")
  await expect(tip).not.toContainText("turno aberto")

  await s1.page.mouse.move(10, 10) // sai do avatar → tooltip some
  await expect(tip).toBeHidden()

  // ---- lock na mesma cell (via API, token do bob): sólido ----
  const bob = turns(h, await webToken(s2.page))
  await bob.open([h.firstCell], "avatar-overlay e2e turn")

  await expect(avatar).toHaveClass(/solid/, { timeout: 10_000 })
  await avatar.hover()
  await expect(tip).toContainText("bob")
  await expect(tip).toContainText("turno aberto")

  await s1.context.close()
  await s2.context.close()
})
