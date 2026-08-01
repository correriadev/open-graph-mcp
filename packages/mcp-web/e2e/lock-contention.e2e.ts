import { expect, test } from "@playwright/test"
import { startHarness, type Harness } from "./fixture"
import { enterEdit, turns, webToken, webUserId } from "./driver"

// F1 (lock implícito): não existe mais modal de abertura nem banner `#denied`. O gatilho da
// contenção é a transição LEITURA → EDIÇÃO no NÓ (`#edit-node` → node.edit). O estado "em edição
// por X" (`#editing-by`, projetado de node.editing/node.idle) aparece ANTES de qualquer tentativa —
// não como recusa depois de clicar. Cobre também os dois riscos que o plano nomeia: turno órfão
// (abort libera sem deixar rastro) e corrida (2º usuário recebe editingBy — testado via API bypass,
// já que forçar dois cliques simultâneos na UI é não-determinístico).
//
// DOM API: app.tsx #panel/#edit-node/#editing-by, turn.tsx #draft/#f_id/#f_subject/#f_domain/
// #f_level/#f_refs/#addclaim/#intent/#commit/#abort, ul #dreasons com li.reason/.warning.

let h: Harness

test.beforeAll(async () => {
  h = await startHarness()
})
test.afterAll(async () => {
  await h.stop()
})

test("contenção de edição: 'em edição por X' aparece ANTES da tentativa, some ao vivo quando libera, sem banner de erro", async ({ browser }) => {
  const alice = await h.openSession(browser, "alice")
  const bob = await h.openSession(browser, "bob")

  // bob precisa ver alice no roster p/ o holderName da UI eventualmente resolver — mas node.editing
  // já carrega o nome resolvido server-side (holderNameOf), então nem depende disto pra aparecer.
  await expect(bob.page.locator("#plist li", { hasText: "alice" })).toBeVisible({ timeout: 15_000 })
  const aliceUserId = await webUserId(alice.page)
  expect(aliceUserId).toMatch(/^u_[0-9a-f]{16}$/)

  // alice entra em edição no nó — caminho de produção (clique, não API bypass).
  await enterEdit(alice.page, h.firstNodeId)
  await expect(alice.page.locator("#draft")).toBeVisible({ timeout: 10_000 })

  // bob abre o MESMO nó: o painel já mostra "em edição por alice" sem ele ter tentado nada —
  // o botão #edit-node nem aparece (estado ANTES da tentativa, spec F1).
  await bob.page.locator(`.og-card[data-id="${h.firstNodeId}"]`).click()
  await expect(bob.page.locator("#panel")).toBeVisible()
  await expect(bob.page.locator("#editing-by")).toBeVisible({ timeout: 10_000 })
  await expect(bob.page.locator("#editing-by")).toContainText("alice")
  await expect(bob.page.locator("#edit-node")).toHaveCount(0)
  // PII non-leak: raw userId (u_<hash>) nunca aparece — só o nome (holderName resolvido no server).
  await expect(bob.page.locator("#editing-by")).not.toContainText(aliceUserId)
  await expect(bob.page.locator(".toast", { hasText: /erro|falha/i })).toHaveCount(0)

  // alice libera (abort) — turno órfão / fim de edição: bob vê o estado sumir AO VIVO, sem F5.
  const navBefore = await bob.page.evaluate(() => performance.getEntriesByType("navigation").length)
  await alice.page.locator("#abort").click()
  await expect(alice.page.locator("#draft")).toHaveCount(0, { timeout: 10_000 })
  await expect(bob.page.locator("#editing-by")).toHaveCount(0, { timeout: 10_000 })
  await expect(bob.page.locator("#edit-node")).toBeVisible()
  const navAfter = await bob.page.evaluate(() => performance.getEntriesByType("navigation").length)
  expect(navAfter).toBe(navBefore)

  // bob agora consegue entrar em edição no mesmo nó.
  await bob.page.locator("#edit-node").click()
  await expect(bob.page.locator("#draft")).toBeVisible({ timeout: 10_000 })
  await bob.page.locator("#abort").click()
  await expect(bob.page.locator("#draft")).toHaveCount(0, { timeout: 10_000 })

  await alice.context.close()
  await bob.context.close()
})

// RISCO "corrida" nomeado pelo plano F1: dois usuários entram em edição JUNTOS. Forçar isso na UI é
// não-determinístico (dois cliques no mesmo tick); exercido direto no server via API bypass, com o
// MESMO contrato que a UI consome (og.ts editNode) — `{ ok:false, editingBy, holderName, since }`.
test("corrida em node.edit: o 2º usuário recebe editingBy/holderName/since (sem duplicar o lock)", async ({ browser }) => {
  const alice = await h.openSession(browser, "alice")
  const bob = await h.openSession(browser, "bob")
  const aliceToken = await webToken(alice.page)
  const bobToken = await webToken(bob.page)
  const aliceUserId = await webUserId(alice.page)

  const editAlice = await h.callTool("node.edit", { token: aliceToken, nodeId: h.firstNodeId })
  expect(editAlice.ok).toBe(true)

  const editBob = await h.callTool("node.edit", { token: bobToken, nodeId: h.firstNodeId })
  expect(editBob.ok).toBe(false)
  expect(editBob.editingBy).toBe(aliceUserId)
  expect(editBob.holderName).toBe("alice")
  expect(typeof editBob.since).toBe("string")

  await turns(h, aliceToken).abort(editAlice.csId)
  await alice.context.close()
  await bob.context.close()
})

function firstCellParts(): { d: string; l: string } {
  const cell = h.firstCell
  const i = cell.lastIndexOf(":")
  const d = cell.slice(0, i)
  let l = cell.slice(i + 1)
  if (!/^P\d+$/.test(l)) l = "P" + l
  return { d, l }
}

test("gate-fail: out-of-scope claim rejected preserves typed form text", async ({ browser }) => {
  // ADAPTAÇÃO (vs spec 004 §3.2): o gate incremental (gates.ts:incrementalGate) NÃO valida
  // existência de refs; refs ausentes viram warnings (advisory), não reasons. Rejeição legível de
  // claim com texto preservado → uso rejeição “claim out of turn scope: <cell> not locked by this
  // changeset” disparada por domain≠cell_locked.
  const alice = await h.openSession(browser, "alice")
  const { l } = firstCellParts()

  await enterEdit(alice.page, h.firstNodeId)
  await expect(alice.page.locator("#draft")).toBeVisible({ timeout: 10_000 })
  const csId = (await alice.page.locator("#draft h3").textContent())?.replace("drafting ", "").trim()
  expect(csId).toMatch(/^cs_/)

  const subjTyped = "ref fantasma"
  const refTyped = "node-inexistente-xyz"
  await alice.page.locator("#f_id").fill("badcell")
  await alice.page.locator("#f_subject").fill(subjTyped)
  await alice.page.locator("#f_domain").fill("billing")
  await alice.page.locator("#f_level").fill(l)
  await alice.page.locator("#f_refs").fill(refTyped)
  await alice.page.locator("#addclaim").click()

  await expect(alice.page.locator("#dreasons li.reason")).not.toHaveCount(0, { timeout: 10_000 })
  const reasonText = (await alice.page.locator("#dreasons li.reason").first().textContent()) ?? ""
  expect(reasonText).toMatch(/claim out of turn scope:.*not locked by this changeset/)
  expect(reasonText).toContain(`billing:${l.replace(/^P/, "")}`)
  await expect(alice.page.locator(".toast", { hasText: /erro|falha/i })).toHaveCount(0)

  await expect(alice.page.locator("#f_subject")).toHaveValue(subjTyped)
  await expect(alice.page.locator("#f_domain")).toHaveValue("billing")
  await expect(alice.page.locator("#f_level")).toHaveValue(l)
  await expect(alice.page.locator("#f_refs")).toHaveValue(refTyped)
  const csIdStill = (await alice.page.locator("#draft h3").textContent())?.replace("drafting ", "").trim()
  expect(csIdStill).toBe(csId)

  // recovery path (MEDIUM): alice corrige domain pra dentro do escopo trancado e re-submete.
  const { d } = firstCellParts()
  await alice.page.locator("#f_domain").fill(d)
  await alice.page.locator("#f_refs").fill("")
  const dlistBefore = await alice.page.locator("#dlist li").count()
  await alice.page.locator("#addclaim").click()
  await expect(alice.page.locator("#dlist li")).toHaveCount(dlistBefore + 1, { timeout: 10_000 })
  await expect(alice.page.locator("#dreasons li.reason")).toHaveCount(0)
  const csIdRecovery = (await alice.page.locator("#draft h3").textContent())?.replace("drafting ", "").trim()
  expect(csIdRecovery).toBe(csId)

  await alice.context.close()
})

// RETRY #1 §3.2 (a) — cenário LITERAL do spec 004 (“ref inexistente rejeitado pelo gate com reason
// nomeando o id”). incrementalGate é ADVISORY em refs; a rejeição que nomeia o id ofensor acontece
// no finalGate (@commit) como `roundtrip dangling-ref @<claimId>: ref <refId> not found in claim
// set`. UI commit-reject aborta o changeset → #draft desmonta; reasons não ficam visíveis em DOM —
// honest adaptation: exerce via bypass-API, asserte reasons nomeando id (UI covered acima).
test("gate-fail (a): commit com ref inexistente → finalGate rejeita nomeando o id ofensor (API bypass, UI covered by claim-reject acima)", async ({ browser }) => {
  const h2 = await startHarness()
  try {
    const alice = await h2.openSession(browser, "alice")
    await enterEdit(alice.page, h2.firstNodeId)
    await expect(alice.page.locator("#draft")).toBeVisible({ timeout: 10_000 })
    const csId = (await alice.page.locator("#draft h3").textContent())?.replace("drafting ", "").trim()
    expect(csId).toMatch(/^cs_/)

    const { d, l } = (() => {
      const cell = h2.firstCell
      const i = cell.lastIndexOf(":")
      const dd = cell.slice(0, i)
      let ll = cell.slice(i + 1)
      if (!/^P\d+$/.test(ll)) ll = "P" + ll
      return { d: dd, l: ll }
    })()

    const ghostRef = "node-fantasma-xyz"
    const claimId = "claim-fantasma"
    await alice.page.locator("#f_id").fill(claimId)
    await alice.page.locator("#f_subject").fill("com ref fantasma")
    await alice.page.locator("#f_domain").fill(d)
    await alice.page.locator("#f_level").fill(l)
    await alice.page.locator("#f_refs").fill(ghostRef)
    await alice.page.locator("#addclaim").click()
    await expect(alice.page.locator("#dlist li")).toHaveCount(1, { timeout: 10_000 })

    const token = await webToken(alice.page)
    const res = await turns(h2, token).commit(csId!, "ref-absente commit-reject")
    expect(res?.ok).toBe(false)
    const reasons: string[] = res?.reasons ?? []
    expect(reasons.length).toBeGreaterThan(0)
    const reasonJoined = reasons.join(" | ")
    expect(reasonJoined).toMatch(/roundtrip dangling-ref @.*:.*not found in claim set/)
    expect(reasonJoined).toContain(ghostRef)

    await expect(alice.page.locator("#draft")).toHaveCount(0, { timeout: 10_000 })

    await alice.context.close()
  } finally {
    await h2.stop()
  }
})

test("gate-fail (malformed JSON): raw JSON inválido pelo #f_json → 0 requests changeset.claim + form preservado", async ({ browser }) => {
  const alice = await h.openSession(browser, "alice")
  const { d, l } = firstCellParts()

  await enterEdit(alice.page, h.firstNodeId)
  await expect(alice.page.locator("#draft")).toBeVisible({ timeout: 10_000 })

  const subjTyped = "raiz válida"
  await alice.page.locator("#f_id").fill("claim-struct")
  await alice.page.locator("#f_subject").fill(subjTyped)
  await alice.page.locator("#f_domain").fill(d)
  await alice.page.locator("#f_level").fill(l)

  await alice.page.locator("details:has(#f_json) summary").click()
  await alice.page.locator("#f_json").fill('{subject: "broken"')

  let claimReqs = 0
  const claimHandler = (req: { url(): string; method(): string; postData(): string | null }) => {
    if (req.url().includes("/mcp") && req.method() === "POST") {
      const body = req.postData() ?? ""
      if (body.includes('"changeset.claim"')) claimReqs++
    }
  }
  alice.page.on("request", claimHandler)
  try {
    const reqsBefore = claimReqs
    await alice.page.locator("#addclaim").click()
    await expect(alice.page.locator("#dreasons li.reason", { hasText: /raw JSON inválido/i })).toBeVisible({ timeout: 10_000 })
    await alice.page.waitForTimeout(200)
    expect(claimReqs - reqsBefore).toBe(0)
  } finally {
    alice.page.off("request", claimHandler)
  }

  await expect(alice.page.locator("#f_subject")).toHaveValue(subjTyped)
  await expect(alice.page.locator("#f_domain")).toHaveValue(d)

  await alice.context.close()
})

// turno órfão (risco nomeado pelo plano): node.edit pode abrir turno que nunca recebe delta. TTL
// varre o lock igual a qualquer changeset — o toast "abortado por TTL" chega via SSE.
test("ttl-abort: changeset TTL expira → .toast \"abortado por TTL\" em alice (UI descarta form — N/A branch)", async ({ browser }) => {
  const h2 = await startHarness({ ttlMs: 2000 } as any)
  try {
    const alice = await h2.openSession(browser, "alice")
    await enterEdit(alice.page, h2.firstNodeId)
    await expect(alice.page.locator("#draft")).toBeVisible({ timeout: 10_000 })
    const csId = (await alice.page.locator("#draft h3").textContent())?.replace("drafting ", "").trim()
    expect(csId).toMatch(/^cs_/)

    // texto não-submetido (turno órfão: entrou em edição, não chegou a fazer nenhum delta).
    await alice.page.locator("#f_subject").fill("texto não-submetido p/ TTL")

    await alice.page.waitForTimeout(2100)
    await h2.control("sweep")

    await expect(alice.page.locator(".toast", { hasText: /abortado por TTL/ })).toBeVisible({ timeout: 10_000 })
    await expect(alice.page.locator("#draft")).toHaveCount(0, { timeout: 10_000 })

    await alice.context.close()
  } finally {
    await h2.stop()
  }
})
