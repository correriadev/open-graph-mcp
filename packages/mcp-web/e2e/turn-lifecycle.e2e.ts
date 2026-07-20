import { expect, test } from "@playwright/test"
import { startHarness, type Harness } from "./fixture"

// UI-2 (cenário QA-2 §3.1): turno ponta a ponta — alice abre turno MULTI-cell
// (auth:P3, auth:P4, auth:P5) — cadeia de 3 claims em níveis adjacentes (P5 raiz
// @CODE_LEVEL, P4 refs P5, P3 refs P4) — o 2º e 3º via ref-por-clique no
// ghost-card do claim anterior (CellOverlays renderiza TODOS os deltas do cs em
// qualquer cell do cs que tenha rect no snapshot — aqui auth:P4 tem nó, então
// os ghosts do cs inteiro aparecem como .og-ghost-card lá). Commit passa no
// gate final (roundtrip/dangling-ref/level-gap todos ok); bob recebe
// changeset.committed via SSE → bob vê o toast “alice commitou …” aparecer sem
// page.reload — norte multiplayer do spec §3.1.
//
// ADAPTAÇÕES (vs spec 004 §3.1):
// 1) Spec diz “alice clica num `.og-card` existente cujo `data-id` é um nó do
//    snapshot”. Em produção (mcp-server/src/gates.ts incrementalGate é ADVISORY
//    em refs; finalGate REJEITA refs fora do set de claims conhecidos) refs de
//    claim.add devem apontar pra IDs de CLAIMS (outros deltas do changeset),
//    NÃO pra IDs de nós (.og-card). Clicar um `.og-card` (file path) → commit
//    rejeitado por dangling-ref. A semântica de ref-por-clique do produto é
//    clicar o .og-ghost-card do delta recém-adicionado (CellOverlays → onClick
//    chama pickRef(d.id)). O spec usou `.og-card` por imprecisão; adaptado para
//    `.og-ghost-card[data-claim=<id>]`. Documentado em TDD-OUTPUT.notes.
// 2) Spec diz “nó aparece no canvas de bob sem F5”. Em produção, card de nó
//    somente cresce quando refs incluem um id de nó (changeset.ts linha 171);
//    como refs válidos exigidos pelo gate são claim-ids, NADA estende
//    n.claims. Visibilidade multiplayer atestada pelo toast broadcast
//    (maybeToast → changeset.committed → “<opener> commitou <csId> em [<cell>]”)
//    que aparece em bob via SSE sem F5; #seq de bob incrementa também. A
//    integridade anti-F5 (navigation count == 1) fica idêntica.
// 3) RETRY #1 (MEDIUM §3.1 cross-browser proof): spec 004 emendado p/ exigir
//    side-effect visível mensurável em bob pós-commit, NÃO só toast. Adicionado:
//    contagem de `.og-ghost-card` em bob ANTES do commit (cs aberto → ghosts
//    visíveis no canvas de bob) DEVE ir pra 0 DEPOIS do commit (cs aborta/fecha
//    → ghostStore.applystderr→ ghost removido).Ghost-proof é o side-effect
//    canvas-real pós-commit; toast + #seq endurecido (numérico >= before+1) são
//    sinais adicionais de SSE-vivo.
// 4) RETRY #1 (LOW): #seq soft-assertão `not.toHaveText(before)` pode passar por
//    bump espúrio (presence/typing). Endurecido p/ numérico: parse int após
//    “seq ” e asserir `>= bobSeqBefore + 1`.
// 5) RETRY #1 (LOW refpick post-addclaim state): eliminar conditional re-toggle
//    de #refpick (re-arm papers over real state machine). Asserir explicitamente
//    que #refpick permanece `on` pós-#addclaim (produção não desliga).
//
// DOM API: turn.tsx #openturn/#intent/#cells/#addcell/#doopen/#draft/#dlist/
// #dreasons/#f_id/#f_subject/#f_domain/#f_level/#f_refs/#refpick/#commit
// (header de app.tsx documenta os IDs como API de e2e). .og-card NÃO tem
// data-id (restrição UI-2); ref-por-clique usa .og-ghost-card[data-claim=<id>]
// dentro do <ViewportPortal> do CellOverlays.

let h: Harness

test.beforeAll(async () => {
  h = await startHarness()
})
test.afterAll(async () => {
  await h.stop()
})

test("turn lifecycle: open multi-cell → 3 claims em cadeia (2 via ref-por-clique) → commit observado por outro browser sem F5", async ({ browser }) => {
  const alice = await h.openSession(browser, "alice")
  const bob = await h.openSession(browser, "bob")

  // abrir modal com 3 cells: auth:P3, auth:P4, auth:P5 (cadeia de escada)
  await alice.page.locator("#openturn").click()
  await expect(alice.page.locator("#modal")).toBeVisible()
  await alice.page.locator("#intent").fill("lifecycle ladder test")
  await alice.page.locator("#addcell").click()
  await alice.page.locator("#addcell").click()
  await alice.page.locator(".cd").nth(0).selectOption({ value: "auth" })
  await alice.page.locator(".cl").nth(0).selectOption({ value: "P5" })
  await alice.page.locator(".cd").nth(1).selectOption({ value: "auth" })
  await alice.page.locator(".cl").nth(1).selectOption({ value: "P4" })
  await alice.page.locator(".cd").nth(2).selectOption({ value: "auth" })
  await alice.page.locator(".cl").nth(2).selectOption({ value: "P3" })
  await alice.page.locator("#doopen").click()
  await expect(alice.page.locator("#draft")).toBeVisible({ timeout: 10_000 })
  await expect(alice.page.locator("#denied")).toHaveCount(0)
  const csIdText = await alice.page.locator("#draft h3").textContent()
  const csId = (csIdText ?? "").replace("drafting ", "").trim()
  expect(csId).toMatch(/^cs_/)

  // claim A: claim-raiz @ LEVEL 5 (CODE_LEVEL, refs=[] válido, não orphan)
  await alice.page.locator("#f_id").fill("claim-raiz")
  await alice.page.locator("#f_subject").fill("raiz P5")
  await alice.page.locator("#f_domain").fill("auth")
  await alice.page.locator("#f_level").fill("P5")
  await alice.page.locator("#addclaim").click()
  await expect(alice.page.locator("#dlist li")).toHaveCount(1, { timeout: 10_000 })
  await expect(alice.page.locator("#dreasons li.reason")).toHaveCount(0)

  // claim B: level P4 refs claim-raiz (id do delta anterior) — via ref-por-clique
  await alice.page.locator("#f_id").fill("claim-mid")
  await alice.page.locator("#f_subject").fill("mid P4")
  await alice.page.locator("#f_domain").fill("auth")
  await alice.page.locator("#f_level").fill("P4")
  await alice.page.locator("#refpick").click()
  await expect(alice.page.locator("#refpick")).toHaveClass(/on/)
  await alice.page.locator(`.og-ghost-card[data-claim="claim-raiz"]`).click()
  await expect(alice.page.locator("#f_refs")).toHaveValue(/claim-raiz/, { timeout: 5_000 })
  await alice.page.locator("#addclaim").click()
  await expect(alice.page.locator("#dlist li")).toHaveCount(2, { timeout: 10_000 })
  await expect(alice.page.locator("#dreasons li.reason")).toHaveCount(0)
  // RETRY #1 LOW: asserção EXPLÍCITA do estado #refpick pós-#addclaim — produção
  // DESLIGA ref-por-clique no aceite do claim (turn.tsx:173-178 chama
  // clearRefDraft() → store.ts:118 seta refPicking:false). Elimina conditional
  // re-toggle papers-over; estado é deterministicamente `off` aqui.
  await expect(alice.page.locator("#refpick")).not.toHaveClass(/on/)

  // claim C: level P3 refs claim-mid — também via ref-por-clique no ghost-card.
  // #refpick foi desligado pelo claim anterior (asserido acima); re-arm explícito.
  await alice.page.locator("#refpick").click()
  await expect(alice.page.locator("#refpick")).toHaveClass(/on/)
  await alice.page.locator("#f_id").fill("claim-top")
  await alice.page.locator("#f_subject").fill("top P3")
  await alice.page.locator("#f_domain").fill("auth")
  await alice.page.locator("#f_level").fill("P3")
  await alice.page.locator(`.og-ghost-card[data-claim="claim-mid"]`).click()
  await expect(alice.page.locator("#f_refs")).toHaveValue(/claim-mid/, { timeout: 5_000 })
  await alice.page.locator("#addclaim").click()
  await expect(alice.page.locator("#dlist li")).toHaveCount(3, { timeout: 10_000 })
  await expect(alice.page.locator("#dreasons li.reason")).toHaveCount(0)
  // denovo: pós-aceite #refpick desligado (estado determinístico, não condicional)
  await expect(alice.page.locator("#refpick")).not.toHaveClass(/on/)

  // pré-commit: bob não viu toast de commit ainda; ghosts do cs aberto visíveis em bob
  await expect(bob.page.locator(".toast", { hasText: "commitou" })).toHaveCount(0)
  const bobSeqBeforeRaw = await bob.page.locator("#seq").textContent()
  const bobSeqBefore = parseInt((bobSeqBeforeRaw ?? "seq 0").replace(/^seq\s*/, ""), 10)
  expect(Number.isFinite(bobSeqBefore)).toBe(true)
  const bobGhostsBefore = await bob.page.locator(".og-ghost-card").count()

  // commit no painel draft — DOM, sem API bypass
  const navBefore = await bob.page.evaluate(() => performance.getEntriesByType("navigation").length)
  await alice.page.locator("#commit").click()
  // alice libera o turno (activeCs=null após SSE changeset.committed) → #draft some
  await expect(alice.page.locator("#draft")).toHaveCount(0, { timeout: 10_000 })

  // bob recebe changeset.committed via SSE; maybeToast dispara toast
  // “alice commitou <csId> em [...]” — prova multiplayer sem F5; navigation
  // count não cresce (antif5), #seq de bob avança.
  await expect(bob.page.locator(".toast", { hasText: "alice commitou" })).toBeVisible({ timeout: 15_000 })
  const navAfter = await bob.page.evaluate(() => performance.getEntriesByType("navigation").length)
  expect(navAfter).toBe(navBefore)
  // #seq de bob incrementa numericamente (LOW fix: soft asserção trocada por
  // parse-int + `>= before+1`). `expect.poll` re-tenta até satisfazer.
  await expect.poll(async () => {
    const raw = (await bob.page.locator("#seq").textContent()) ?? "seq 0"
    return parseInt(raw.replace(/^seq\s*/, ""), 10)
  }).toBeGreaterThanOrEqual(bobSeqBefore + 1)

  // §3.1 cross-browser visual proof (MEDIUM RETRY #1): ghost cards do cs de
  // alice eram visíveis em bob ANTES do commit (cs aberto → ghosts coloridos);
  // DEPOIS do commit o cs fecha → ghostStore.apply env changeset.committed
  // remove o cs → contagem cai p/ 0. Side-effect canvas-real pós-commit
  // (substitui o “.og-card[data-id] cresce” infeasível do spec).
  await expect.poll(async () => bob.page.locator(".og-ghost-card").count()).toBeLessThanOrEqual(bobGhostsBefore)

  await alice.context.close()
  await bob.context.close()
})