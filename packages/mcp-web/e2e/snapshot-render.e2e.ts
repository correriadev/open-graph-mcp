// UI-0 DoD (WD1): fundação React renderiza o snapshot real — N nós visíveis,
// pan/zoom mexe o viewport, clique abre o painel, identidade registra (#who).
import { expect, test } from "@playwright/test"
import { type Harness, startHarness } from "./fixture"

let h: Harness

test.beforeAll(async () => {
  h = await startHarness()
})
test.afterAll(async () => {
  await h.stop()
})

test("snapshot renderiza, pan/zoom navega, painel abre, identidade registra", async ({ browser }) => {
  const snap = await h.readResource("graph://snapshot")
  const total = snap.graph.nodes.length
  expect(total).toBeGreaterThan(0)

  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(h.pageUrl())

  // snapshot anônimo: todos os cards do fixture (poucos nós — culling não esconde nenhum)
  await expect(page.locator(".og-card")).toHaveCount(total)

  // clique num card (fitView inicial deixa todos visíveis) abre o painel com id de nó do snapshot
  await page.locator(".og-card").first().click()
  await expect(page.locator("#panel h3")).toHaveText(/.+/)
  const panelId = await page.locator("#panel h3").textContent()
  expect(snap.graph.nodes.some((n: { id: string }) => n.id === panelId)).toBe(true)

  // zoom (wheel) altera o transform do viewport RF
  const before = await page.locator(".react-flow__viewport").getAttribute("style")
  await page.locator(".react-flow__pane").hover()
  await page.mouse.wheel(0, -300)
  await expect
    .poll(async () => page.locator(".react-flow__viewport").getAttribute("style"))
    .not.toBe(before)

  // zoom-out forte cruza LOD_TOWER_MAX_ZOOM — data-lod chega a "tower" (minZoom < 0.35)
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 400)
  await expect(page.locator(".canvas-wrap")).toHaveAttribute("data-lod", "tower")

  // identidade: nome + blur → register → #who
  const s = await h.openSession(browser, "alice")
  await expect(s.page.locator("#who")).toHaveText("alice")
  await s.context.close()
  await context.close()
})
