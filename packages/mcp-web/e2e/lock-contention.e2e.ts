import { expect, test } from "@playwright/test"
import { startHarness, type Harness } from "./fixture"
import { webToken, webUserId, turns } from "./driver"

// UI-2 (cenários QA-2 §3.1 retry + §3.2 gate-fail legibility): dois BrowserContexts
// disputam a mesma cell — bob vê #denied renderizado como estado de primeira
// classe (nome do holder + csId + countdown), nunca toast genérico; alice libera
// o lock (abort) e bob clica #retry → reabre ao vivo, sem page.reload nem nova
// requisição /events. Depois gate-fail de claim fora-de-escopo preserva o texto
// digitado (subject, domain, level, refs) e projeta reasons em <li> estruturado.
//
// DOM API: turn.tsx #denied/.denied-free/#retry/#draft/#f_id/#f_subject/#f_domain/
// #f_level/#f_refs/#addclaim, ul #dreasons com li.reason/.warning (selector real do
// DraftPanel — “.gate-reasons” do spec 004 é aspiracional; adaptação documentada em
// TDD-OUTPUT.notes). app.tsx header documenta os IDs como API de e2e.
//
// RETRY #1 emendas (REWORK-LOG action plan A):
//  - asserção NEGATIVA PII: raw userId (u_<hash> de “alice” via webUserId) NÃO em
//    #denied — passa burro se só asserir positivo (“alice” aparece).
//  - novo cenário §3.2 (a) ref-absente commit-reject: incrementalGate NÃO valida
//    refs (advisory); finalGate (@commit) REJEITA dangling-ref com reason nomeando
//    o id ofensor. Adicionado bypass-API (changeset.commit direto) p/ asserir
//    `roundtrip dangling-ref @<id>:` no reasons[] — UI hidden pós-abort (cs=null
//    desmonta #draft) é honest adaptation documentada no spec 004 §3.2.
//  - recovery path: alice corrige #f_refs → vazio, re-submete → #dlist +1, #dreasons
//    esvazia.
//  - novo cenário §3.3 malformed JSON: #f_json “{invalid” → nenhum request
//    changeset.claim no wire (page.on request counting), #dreasons mostra reason
//    local “raw JSON inválido”, form estruturado preservado.
//  - novo cenário §3.2 TTL-abort: startHarness({ ttlMs:50 }) → h.control("sweep")
//    aborta changeset → .toast “abortado por TTL” em alice. Honest adaptation: o
//    painel desmonta em cs=null (turn.tsx:147), então “preservar texto digitado” é
//    infeasível no UI — documentado no spec 004 §3.2 como N/A branch.

let h: Harness

test.beforeAll(async () => {
  h = await startHarness()
})
test.afterAll(async () => {
  await h.stop()
})

function firstCellParts(): { d: string; l: string } {
  const cell = h.firstCell
  const i = cell.lastIndexOf(":")
  const d = cell.slice(0, i)
  let l = cell.slice(i + 1)
  if (!/^P\d+$/.test(l)) l = "P" + l
  return { d, l }
}

test("lock contention: deny legível → lock.released SSE → retry ao vivo sem F5", async ({ browser }) => {
  const alice = await h.openSession(browser, "alice")
  const bob = await h.openSession(browser, "bob")

  // bob precisa ver alice no roster p/ o holderName resolver p/ “alice” (não p/ userId cru)
  await expect(bob.page.locator("#plist li", { hasText: "alice" })).toBeVisible({ timeout: 15_000 })

  // PII non-leak (§3.3 RETRY #1 HIGH): raw userId de alice = u_<sha256-16-hex>
  // (session.ts:14) — NÃO deve aparecer em #denied; só o name legível. userWebId
  // lê og.userId do localStorage (settado em token-store no register).
  const aliceUserId = await webUserId(alice.page)
  expect(aliceUserId).toMatch(/^u_[0-9a-f]{16}$/)

  const { d, l } = firstCellParts()

  // alice locka a cell via UI (caminho de produção, não API bypass)
  await alice.page.locator("#openturn").click()
  await alice.page.locator("#intent").fill("lock contention test")
  await alice.page.locator(".cd").selectOption({ value: d })
  await alice.page.locator(".cl").selectOption({ value: l })
  await alice.page.locator("#doopen").click()
  await expect(alice.page.locator("#draft")).toBeVisible({ timeout: 10_000 })
  const aliceCsId = (await alice.page.locator("#draft h3").textContent())?.replace("drafting ", "").trim()
  expect(aliceCsId).toMatch(/^cs_/)

  // bob tenta abrir a MESMA cell → cell_locked → #denied (nada de toast genérico)
  await bob.page.locator("#openturn").click()
  await bob.page.locator("#intent").fill("contender")
  await bob.page.locator(".cd").selectOption({ value: d })
  await bob.page.locator(".cl").selectOption({ value: l })
  await bob.page.locator("#doopen").click()
  await expect(bob.page.locator("#denied")).toBeVisible({ timeout: 10_000 })
  await expect(bob.page.locator(".toast", { hasText: /erro|falha/i })).toHaveCount(0)

  // legibilidade: nome (display) de alice, csId dela, countdown não-vazio
  const denied = bob.page.locator("#denied")
  const deniedText = (await denied.textContent()) ?? ""
  expect(deniedText).toContain("alice")
  expect(deniedText).toContain(aliceCsId!)
  const countdownBob = await bob.page.locator("#denied .mono").first().textContent()
  expect(countdownBob ?? "").toMatch(/^\d+:\d{2}$/)
  // PII non-leak asserção NEGATIVA: raw userId (u_<hash>) NÃO vaza em #denied —
  // regressão real de leak passaria burro na asserção só-positiva. “alice” (name)
  // pode aparecer; substring nunca colide com o hash.
  await expect(denied).not.toContainText(aliceUserId)

  // alice libera via abort (lock.released broadcast) — bob ainda não recarregou
  await alice.page.locator("#abort").click()
  await expect(alice.page.locator("#draft")).toHaveCount(0, { timeout: 10_000 })

  // bob recebe lock.released via SSE → denied.lockGone → mensagem .denied-free
  await expect(bob.page.locator("#denied .denied-free")).toBeVisible({ timeout: 10_000 })

  // contagem de /events antes e depois do retry: retry roda sobre a SSE viva
  let eventsRequests = 0
  const reqHandler = (req: { url(): string }) => {
    if (req.url().includes("/events")) eventsRequests++
  }
  bob.page.on("request", reqHandler)
  try {
    const navBefore = await bob.page.evaluate(() => performance.getEntriesByType("navigation").length)
    const reqBefore = eventsRequests

    // bob clica “tentar de novo” (DOM) — nenhum page.reload
    await bob.page.locator("#retry").click()
    await expect(bob.page.locator("#draft")).toBeVisible({ timeout: 10_000 })
    await expect(bob.page.locator("#denied")).toHaveCount(0)

    const navAfter = await bob.page.evaluate(() => performance.getEntriesByType("navigation").length)
    expect(navAfter).toBe(navBefore) // anti-F5: nenhuma navigation nova

    // retry NÃO dispara nova conexão /events (live-retry sobre a SSE existente)
    const reqDelta = eventsRequests - reqBefore
    expect(reqDelta).toBe(0)
  } finally {
    bob.page.off("request", reqHandler)
  }

  // bob agora detém o lock na cell alvo (draft panel aberto, sem denied)
  expect((await bob.page.locator("#draft h3").textContent())?.replace("drafting ", "").trim()).toMatch(/^cs_/)

  // limpa o draft de bob p/ liberar a cell p/ os próximos specs do arquivo
  // (testei-then-testei-then collision inter-test: sem isso, o gate-fail test a
  // seguir tenta reabrir a mesma cell e esbarra no lock persistente).
  await bob.page.locator("#abort").click()
  await expect(bob.page.locator("#draft")).toHaveCount(0, { timeout: 10_000 })

  await alice.context.close()
  await bob.context.close()
})

test("gate-fail: out-of-scope claim rejected preserves typed form text", async ({ browser }) => {
  // ADAPTAÇÃO (vs spec 004 §3.2): o gate incremental (gates.ts:incrementalGate
  // — packages/mcp-server/src/gates.ts) NÃO valida existência de refs; refs
  // ausentes viram warnings (advisory), não reasons. Rejeição legível de claim
  // com texto preservado → uso rejeição “claim out of turn scope: <cell> not
  // locked by this changeset” disparada por domain≠cell_locked. O formato
  // roundtrip <kind> @<id>: <detail> só existe no gate FINAL de commit; lá o
  // abort desmonta o DraftPanel (cs=null) e o painel de reasons não fica visível
  // — documentado em TDD-OUTPUT.notes.
  const alice = await h.openSession(browser, "alice")
  const { d, l } = firstCellParts()

  // alice abre turno em {d}:{l} (cellLocked)
  await alice.page.locator("#openturn").click()
  await alice.page.locator("#intent").fill("gate-fail text preservation")
  await alice.page.locator(".cd").selectOption({ value: d })
  await alice.page.locator(".cl").selectOption({ value: l })
  await alice.page.locator("#doopen").click()
  await expect(alice.page.locator("#draft")).toBeVisible({ timeout: 10_000 })
  const csId = (await alice.page.locator("#draft h3").textContent())?.replace("drafting ", "").trim()
  expect(csId).toMatch(/^cs_/)

  // claim OUT-OF-SCOPE: domain fora do lockedCells do cs. subject e refs
  // tipados (“texto a preservar”); rejected → reasons visíveis sem toast.
  const subjTyped = "ref fantasma"
  const refTyped = "node-inexistente-xyz"
  await alice.page.locator("#f_id").fill("badcell")
  await alice.page.locator("#f_subject").fill(subjTyped)
  await alice.page.locator("#f_domain").fill("billing")
  await alice.page.locator("#f_level").fill(l)
  await alice.page.locator("#f_refs").fill(refTyped)
  await alice.page.locator("#addclaim").click()

  // reasons projetados como <li class="reason"> estruturados. Id rejeitado
  // nomeado: o reason carrega `<cell>` ofensora (formato `domain:level`).
  await expect(alice.page.locator("#dreasons li.reason")).not.toHaveCount(0, { timeout: 10_000 })
  const reasonText = (await alice.page.locator("#dreasons li.reason").first().textContent()) ?? ""
  expect(reasonText).toMatch(/claim out of turn scope:.*not locked by this changeset/)
  expect(reasonText).toContain(`billing:${l.replace(/^P/, "")}`)
  await expect(alice.page.locator(".toast", { hasText: /erro|falha/i })).toHaveCount(0)

  // texto preservado: subject, domain, level, refs — e activeCs NÃO abortado
  await expect(alice.page.locator("#f_subject")).toHaveValue(subjTyped)
  await expect(alice.page.locator("#f_domain")).toHaveValue("billing")
  await expect(alice.page.locator("#f_level")).toHaveValue(l)
  await expect(alice.page.locator("#f_refs")).toHaveValue(refTyped)
  const csIdStill = (await alice.page.locator("#draft h3").textContent())?.replace("drafting ", "").trim()
  expect(csIdStill).toBe(csId)

  // §3.2 recovery path (MEDIUM): alice corrige #f_refs (limpa p/ vazio → vira
  // claim-raiz aceitável; cell “billing” NÃO está locked, então trocamos p/ “auth”)
  // e re-submete → #dlist +1, #dreasons esvazia (turno continua o mesmo csId).
  await alice.page.locator("#f_domain").fill("auth")
  await alice.page.locator("#f_refs").fill("")
  const dlistBefore = await alice.page.locator("#dlist li").count()
  await alice.page.locator("#addclaim").click()
  await expect(alice.page.locator("#dlist li")).toHaveCount(dlistBefore + 1, { timeout: 10_000 })
  await expect(alice.page.locator("#dreasons li.reason")).toHaveCount(0)
  const csIdRecovery = (await alice.page.locator("#draft h3").textContent())?.replace("drafting ", "").trim()
  expect(csIdRecovery).toBe(csId)

  await alice.context.close()
})

// RETRY #1 §3.2 (a) — cenário LITERAL do spec 004 (“ref inexistente rejeitado pelo
// gate com reason nomeando o id”). incrementalGate (gates.ts:48) é ADVISORY em refs:
// refs ausentes/fantasma viram warnings, não reasons. A rejeição que nomeia o id
// ofensor acontece no finalGate (@commit) como `roundtrip dangling-ref @<claimId>:
// ref <refId> not found in claim set`. Em UI, commit-reject aborta o changeset
// (changeset.ts:158-162) → SSE changeset.aborted → og.ts:250 seta activeCs=null →
// turn.tsx:147 `if (!cs) return null` desmonta o DraftPanel; `setReasons` rodou mas
// o painel some, então reasons NÃO ficam visíveis em DOM. Honest adaptation: exerce
// a rejeição server-side via bypass-API (driver.turns) e asserte reasons nomeando
// id — UI render é coberta pelo cenário “out of turn scope” acima (também nomeia).
test("gate-fail (a): commit com ref inexistente → finalGate rejeita nomeando o id ofensor (API bypass, UI covered by claim-reject acima)", async ({ browser }) => {
  const h2 = await startHarness()
  try {
    const alice = await h2.openSession(browser, "alice")
    const { d, l } = firstCellParts()
    await alice.page.locator("#openturn").click()
    await alice.page.locator("#intent").fill("ref-absente commit-reject")
    await alice.page.locator(".cd").selectOption({ value: d })
    await alice.page.locator(".cl").selectOption({ value: l })
    await alice.page.locator("#doopen").click()
    await expect(alice.page.locator("#draft")).toBeVisible({ timeout: 10_000 })
    const csId = (await alice.page.locator("#draft h3").textContent())?.replace("drafting ", "").trim()
    expect(csId).toMatch(/^cs_/)

    // claim com ref fantasma — incrementalGate aceita (refs=advisory, vira warning);
    // finalGate em commit é quem rejeita_nomeando_id.
    const ghostRef = "node-fantasma-xyz"
    const claimId = "claim-fantasma"
    await alice.page.locator("#f_id").fill(claimId)
    await alice.page.locator("#f_subject").fill("com ref fantasma")
    await alice.page.locator("#f_domain").fill(d)
    await alice.page.locator("#f_level").fill(l)
    await alice.page.locator("#f_refs").fill(ghostRef)
    await alice.page.locator("#addclaim").click()
    await expect(alice.page.locator("#dlist li")).toHaveCount(1, { timeout: 10_000 })

    // bypass-API commit p/ asserir reasons server-side nomeando id (UI desmonta pós-
    // abort; cobertura deReasonDom fica no cenário anterior).
    const token = await webToken(alice.page)
    const res = await turns(h2, token).commit(csId!)
    expect(res?.ok).toBe(false)
    const reasons: string[] = res?.reasons ?? []
    expect(reasons.length).toBeGreaterThan(0)
    // formato finalGate gates.ts:106: `roundtrip <kind> @<id>: <detail>`.
    const reasonJoined = reasons.join(" | ")
    expect(reasonJoined).toMatch(/roundtrip dangling-ref @.*:.*not found in claim set/)
    expect(reasonJoined).toContain(ghostRef)

    // confirma side-effect: SSE changeset.aborted chegou → #draft sumiu p/ alice
    await expect(alice.page.locator("#draft")).toHaveCount(0, { timeout: 10_000 })

    await alice.context.close()
  } finally {
    await h2.stop()
  }
})

// RETRY #1 §3.3 — malformed raw JSON escape hatch: submeter JSON inválido pelo
// #f_json NÃO dispara request changeset.claim no wire (claimDraft JSON.parse throw
// → catch turn.tsx:156-159 seta reason local), form estruturado preservado.
test("gate-fail (malformed JSON): raw JSON inválido pelo #f_json → 0 requests changeset.claim + form preservado", async ({ browser }) => {
  const alice = await h.openSession(browser, "alice")
  const { d, l } = firstCellParts()

  await alice.page.locator("#openturn").click()
  await alice.page.locator("#intent").fill("malformed json test")
  await alice.page.locator(".cd").selectOption({ value: d })
  await alice.page.locator(".cl").selectOption({ value: l })
  await alice.page.locator("#doopen").click()
  await expect(alice.page.locator("#draft")).toBeVisible({ timeout: 10_000 })

  // form estruturado válido pré-malformed
  const subjTyped = "raiz válida"
  await alice.page.locator("#f_id").fill("claim-struct")
  await alice.page.locator("#f_subject").fill(subjTyped)
  await alice.page.locator("#f_domain").fill(d)
  await alice.page.locator("#f_level").fill(l)

  // expande raw JSON colapsável e digita JSON inválido ({invalid — falta aspas, valor)
  await alice.page.locator("details:has(#f_json) summary").click()
  await alice.page.locator("#f_json").fill('{subject: "broken"')

  // conta requests changeset.claim no wire antes/depois do submit
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
    // reason local “raw JSON inválido” projetada sem chamada server
    await expect(alice.page.locator("#dreasons li.reason", { hasText: /raw JSON inválido/i })).toBeVisible({ timeout: 10_000 })
    // pequena espera p/ capturar qualquer request tardio que n deveria existir
    await alice.page.waitForTimeout(200)
    expect(claimReqs - reqsBefore).toBe(0)
  } finally {
    alice.page.off("request", claimHandler)
  }

  // form estruturado (ainda válido) NAO limpo — escape hatch preservado
  await expect(alice.page.locator("#f_subject")).toHaveValue(subjTyped)
  await expect(alice.page.locator("#f_domain")).toHaveValue(d)

  await alice.context.close()
})

// RETRY #1 §3.2 (TTL-abort risk #1) — changeset TTL curto (ttlMs:50) + control
// (“sweep”) aborta o changeset p/ TTL expirado; .toast “abortado por TTL” chega
// via SSE (maybeToast og.ts:111-112). Honest adaptation spec 004: painel
// desmonta em cs=null (turn.tsx:147), então “preservar texto digitado” é
// infeasível — branch N/A do próprio spec; cobertura unit em GhostStore.test.ts.
test("ttl-abort: changeset TTL expira → .toast \"abortado por TTL\" em alice (UI descarta form — N/A branch)", async ({ browser }) => {
  // ttlMs 2000: espaço p/ abrir panel + digitar antes do TTL escalar (50ms caiu
  // dentro do setup). 2000ms é o knob do harness p/ changeset (StartOptions.ttlMs).
  const h2 = await startHarness({ ttlMs: 2000 } as any)
  try {
    const alice = await h2.openSession(browser, "alice")
    const { d, l } = firstCellParts()
    await alice.page.locator("#openturn").click()
    await alice.page.locator("#intent").fill("ttl-abort test")
    await alice.page.locator(".cd").selectOption({ value: d })
    await alice.page.locator(".cl").selectOption({ value: l })
    await alice.page.locator("#doopen").click()
    await expect(alice.page.locator("#draft")).toBeVisible({ timeout: 10_000 })
    const csId = (await alice.page.locator("#draft h3").textContent())?.replace("drafting ", "").trim()
    expect(csId).toMatch(/^cs_/)

    // texto não-submetido digitado no #f_subject (estudo do risk #1) — ainda dentro
    // da janela TTL de 2000ms.
    await alice.page.locator("#f_subject").fill("texto não-submetido p/ TTL")

    // TTL 2000ms: espera 2100ms p/ lock.expires_at < now(), depois sweep dispara abort
    await alice.page.waitForTimeout(2100)
    await h2.control("sweep")

    // SSE changeset.aborted reason=ttl_expired → maybeToast dispara toast
    await expect(alice.page.locator(".toast", { hasText: /abortado por TTL/ })).toBeVisible({ timeout: 10_000 })
    // turno ativo morreu (cs=null) → painel desmonta — texto local é descartado
    // (N/A branch confirmado; UX recovery fica backlog)
    await expect(alice.page.locator("#draft")).toHaveCount(0, { timeout: 10_000 })

    await alice.context.close()
  } finally {
    await h2.stop()
  }
})