import { expect, test } from "@playwright/test"
import { turns, webToken } from "./driver"
import { startHarness, type Harness } from "./fixture"

// UI-1 (cenários QA-2): typing — aparece no claim, some na transição quiet, some
// quando o user vira invisível. RECEPÇÃO apenas nesta fase (ver nota datada no
// 01-scope): o typist é dirigido pela API com o token do próprio user web (bob),
// já que o único caminho server pra user.typing_state é changeset.claim → touchDelta.
//
// typingMs < idleMs pequenos e reais (200/500) — janela real, nunca sleep cego (QD2/QD5).

let h: Harness

test.beforeAll(async () => {
  h = await startHarness({ typingMs: 200, idleMs: 500 })
})
test.afterAll(async () => {
  await h.stop()
})

test("typing indicator appears on claim, disappears when quiet, disappears when invisible", async ({ browser }) => {
  const s1 = await h.openSession(browser, "alice") // observadora
  const s2 = await h.openSession(browser, "bob") // digita (via API com o token dele)

  await s2.page.evaluate((cell) => (window as any).__og_e2e.setFocus(cell), h.firstCell)

  const bob = turns(h, await webToken(s2.page))
  const opened = await bob.open([h.firstCell], "typing-indicator e2e turn")
  const csId = opened.csId ?? opened.id

  // claim → touchDelta roda antes do gate (Fase 3 §5.1) — payload sem `id` é recusado
  // pelo incrementalGate, mas o side-effect de typing é o que interessa aqui.
  const submitClaim = () => bob.claim(csId, { kind: "claim.add", payload: { subject: "irrelevant to typing" } })
  await submitClaim()

  await h.control("tickTypingNow")
  await expect(s1.page.locator("#typing")).toBeVisible()
  await expect(s1.page.locator("#typing")).toContainText("bob")
  await expect(s1.page.locator("#typing")).toContainText("editando")

  // relógio real passa idleMs → quiet
  await s1.page.waitForTimeout(600)
  await h.control("tickTypingNow")
  await expect(s1.page.locator("#typing")).toBeHidden()

  // digitando de novo, então invisível no meio → forceQuiet imediato
  await submitClaim()
  await h.control("tickTypingNow")
  await expect(s1.page.locator("#typing")).toBeVisible()

  await s2.page.locator("#settingsBtn").click()
  await s2.page.locator("#s_presence").uncheck()
  await expect(s1.page.locator("#typing")).toBeHidden()

  await s1.context.close()
  await s2.context.close()
})

test("typing in the web draft is observable by another session", async ({ browser }) => {
  const alice = await h.openSession(browser, "alice-web-typing")
  const bob = await h.openSession(browser, "bob-web-typing")
  await alice.page.evaluate((cell) => (window as any).__og_e2e.setFocus(cell), h.firstCell)
  await bob.page.evaluate((cell) => (window as any).__og_e2e.setFocus(cell), h.firstCell)

  await alice.page.locator("#openturn").click()
  await alice.page.locator("#intent").fill("web typing")
  await alice.page.locator("#doopen").click()
  await expect(alice.page.locator("#draft")).toBeVisible()
  let typingCalls = 0
  alice.page.on("request", (request) => {
    try {
      const body = request.postDataJSON()
      if (body?.method === "tools/call" && body?.params?.name === "presence.typing") typingCalls++
    } catch { /* non-JSON request */ }
  })
  await alice.page.locator("#f_subject").evaluate((input: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    for (let i = 1; i <= 100; i++) {
      setter.call(input, `typed ${i}`)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }
  })
  await expect.poll(() => typingCalls).toBeGreaterThanOrEqual(1)
  await h.control("tickTypingNow")
  await expect(bob.page.locator("#typing")).toContainText("alice-web-typing")
  await alice.page.waitForTimeout(450)
  expect(typingCalls).toBeLessThanOrEqual(2)
  const beforeSustained = typingCalls
  await alice.page.locator("#f_subject").evaluate(async (input: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    for (let i = 0; i < 12; i++) {
      setter.call(input, `sustained ${i}`)
      input.dispatchEvent(new Event("input", { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })
  const sustainedCalls = typingCalls - beforeSustained
  expect(sustainedCalls).toBeGreaterThanOrEqual(3)
  expect(sustainedCalls).toBeLessThanOrEqual(4)
  await alice.context.close()
  await bob.context.close()
})
