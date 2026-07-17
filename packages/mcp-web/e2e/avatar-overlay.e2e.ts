import { expect, test } from "@playwright/test"
import { startHarness, type Harness } from "./fixture"

// QA-2 DoD item 2: avatar overlay — semi-transparent badge on unowned focus, solid badge on a locked
// cell, tooltip hover (name + agentKind + last activity). Avatars are canvas pixels, not DOM nodes —
// __og_e2e.avatarScreenPos (main.ts) reports where the renderer actually drew one so the real mousemove
// handler (render.ts's onHover → onAvatarHover → showAvatarTip) gets exercised for real, not bypassed.

let h: Harness

test.beforeAll(async () => {
  h = await startHarness()
})
test.afterAll(async () => {
  await h.stop()
})

test("unlocked focus draws a semi-transparent avatar; a lock on the same cell makes it solid", async ({ browser }) => {
  const s1 = await h.openSession(browser, "alice") // observer
  const s2 = await h.openSession(browser, "bob") // focuses/locks
  const bobUserId = await s2.page.evaluate(() => localStorage.getItem("og.userId"))
  const canvasBox = (await s1.page.locator("#cv").boundingBox())!

  async function avatarPos() {
    return s1.page.evaluate(
      (uid) => (window as any).__og_e2e.avatarScreenPos(uid),
      bobUserId,
    ) as Promise<{ x: number; y: number; locked: boolean } | null>
  }
  async function hoverAvatar() {
    const pos = (await avatarPos())!
    await s1.page.mouse.move(canvasBox.x + pos.x, canvasBox.y + pos.y)
  }

  // ---- unlocked focus: semi-transparent (locked:false) ----
  await s2.page.evaluate((cell) => (window as any).__og_e2e.setFocus(cell), h.firstCell)
  await expect.poll(avatarPos, { timeout: 10_000 }).not.toBeNull()
  expect((await avatarPos())!.locked).toBe(false)

  await hoverAvatar()
  await expect(s1.page.locator("#avatarTip")).toBeVisible()
  await expect(s1.page.locator("#avatarTip")).toContainText("bob")
  await expect(s1.page.locator("#avatarTip")).toContainText("web")
  await expect(s1.page.locator("#avatarTip")).not.toContainText("turno aberto")

  // Move to whichever canvas corner is farthest from the avatar (hit radius is only 6-9px, but the
  // fixture graph is tiny enough that the avatar's own position isn't predictable ahead of time).
  // "Away" must stay on the bare canvas: #presence (left, 250px) and #events (right, 300px) are fixed
  // overlays stacked on top of it, so a point under either never reaches the canvas's own mousemove
  // listener at all. Pick whichever corner of the safe strip is farthest from the avatar.
  const away = (await avatarPos())!
  const safeXMin = 260
  const safeXMax = canvasBox.width - 310
  const farX = away.x < (safeXMin + safeXMax) / 2 ? safeXMax : safeXMin
  const farY = away.y < canvasBox.height / 2 ? canvasBox.height - 20 : 40
  await s1.page.mouse.move(canvasBox.x + farX, canvasBox.y + farY)
  await expect(s1.page.locator("#avatarTip")).toBeHidden()

  // ---- lock on the same cell: solid (locked:true) ----
  const [domain, level] = h.firstCell.split(":")
  await s2.page.locator("#openturn").click()
  await s2.page.locator("#cells .cd").first().selectOption(domain!)
  await s2.page.locator("#cells .cl").first().selectOption(level!)
  await s2.page.fill("#intent", "avatar-overlay e2e turn")
  await s2.page.locator("#doopen").click()
  await expect(s2.page.locator("#modal")).toBeHidden()

  await expect.poll(async () => (await avatarPos())?.locked, { timeout: 10_000 }).toBe(true)

  await hoverAvatar()
  await expect(s1.page.locator("#avatarTip")).toContainText("bob")
  await expect(s1.page.locator("#avatarTip")).toContainText("turno aberto")

  await s1.context.close()
  await s2.context.close()
})
