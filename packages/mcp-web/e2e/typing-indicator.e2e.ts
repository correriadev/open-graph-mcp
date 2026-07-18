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
