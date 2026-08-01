import { expect, test } from "@playwright/test"
import { startHarness, type Harness } from "./fixture"
import { enterEdit, turns, webToken } from "./driver"

// UI-2 (cenário QA-2 §3.1), atualizado para F1 (lock implícito): alice entra em edição NUM NÓ
// (#edit-node → node.edit, não mais um modal de "Abrir turno" pré-declarando cells+intent). O
// turno é da CÉLULA do nó (granularidade não mudou — decisão 1 do plano F1); alice adiciona um
// claim, digita o `intent` só na hora do commit (decisão 2), e commita. bob recebe
// changeset.committed via SSE → toast “alice commitou …” sem F5 — norte multiplayer do spec §3.1
// preservado.
//
// ADAPTAÇÃO: node.edit tranca UMA célula (a do nó clicado). Um claim root (refs=[]) só é válido no
// EXTREMO da escada (nível 0 ou CODE_LEVEL=5 — roundtrip.ts); os nós da fixture (arquivos .ts) caem
// em P4, meio da escada, então uma claim sem refs ali é sempre "orphan-midladder". Setup fora-da-UI
// (API bypass, padrão já usado por outras specs — query-and-read.e2e.ts) cria um claim-raiz válido
// em auth:5 (floor); a claim que alice adiciona PELA UI referencia esse claim-raiz (nível adjacente,
// 4↔5) — histórico honesto: a laddering multi-nível completa é um caminho de agente via
// `changeset.open` explícito (fora da web), turn-lifecycle cobre o caminho de produção da web.
//
// DOM API: app.tsx #panel/#edit-node, turn.tsx #draft/#intent/#f_id/#f_subject/#f_domain/#f_level/
// #f_refs/#commit/#dlist/#dreasons (header de app.tsx documenta os IDs como API de e2e).

let h: Harness

test.beforeAll(async () => {
  h = await startHarness()
})
test.afterAll(async () => {
  await h.stop()
})

test("turn lifecycle: node.edit → claim referenciando raiz da floor → intent no commit → observado por outro browser sem F5", async ({ browser }) => {
  const alice = await h.openSession(browser, "alice")
  const bob = await h.openSession(browser, "bob")

  const cut = h.firstCell.lastIndexOf(":")
  const domain = h.firstCell.slice(0, cut)
  let level = h.firstCell.slice(cut + 1)
  if (!/^P\d+$/.test(level)) level = "P" + level

  // setup fora-da-UI: claim-raiz na floor (auth:5) — ref válido pro claim que a UI vai adicionar.
  const aliceToken = await webToken(alice.page)
  const setup = await turns(h, aliceToken).open([`${domain}:5`], "setup floor root")
  if (!setup.ok || !setup.csId) throw new Error("setup open failed: " + JSON.stringify(setup))
  expect((await turns(h, aliceToken).claim(setup.csId, { kind: "claim.add", payload: { id: "floor-root", subject: "raiz floor", domain, level: 5, refs: [] } })).ok).toBe(true)
  expect((await turns(h, aliceToken).commit(setup.csId, "setup floor root")).ok).toBe(true)

  await enterEdit(alice.page, h.firstNodeId)
  await expect(alice.page.locator("#draft")).toBeVisible({ timeout: 10_000 })
  const csIdText = await alice.page.locator("#draft h3").textContent()
  const csId = (csIdText ?? "").replace("drafting ", "").trim()
  expect(csId).toMatch(/^cs_/)

  // claim adjacente (nível 4 refs floor-root, nível 5) — íntegro pro roundtrip.
  await alice.page.locator("#f_id").fill("claim-mid")
  await alice.page.locator("#f_subject").fill("mid")
  await alice.page.locator("#f_domain").fill(domain)
  await alice.page.locator("#f_level").fill(level)
  await alice.page.locator("#f_refs").fill("floor-root")
  await alice.page.locator("#addclaim").click()
  await expect(alice.page.locator("#dlist li")).toHaveCount(1, { timeout: 10_000 })
  await expect(alice.page.locator("#dreasons li.reason")).toHaveCount(0)

  // pré-commit (deste 2º cs — o setup acima já gerou o seu próprio toast de commit).
  const bobSeqBeforeRaw = await bob.page.locator("#seq").textContent()
  const bobSeqBefore = parseInt((bobSeqBeforeRaw ?? "seq 0").replace(/^seq\s*/, ""), 10)
  expect(Number.isFinite(bobSeqBefore)).toBe(true)
  const bobGhostsBefore = await bob.page.locator(".og-ghost-card").count()

  // intent pedido AGORA (F1: migrou pro commit) — não na abertura.
  await alice.page.locator("#intent").fill("lifecycle test")
  const navBefore = await bob.page.evaluate(() => performance.getEntriesByType("navigation").length)
  await alice.page.locator("#commit").click()
  await expect(alice.page.locator("#draft")).toHaveCount(0, { timeout: 10_000 })

  // bob recebe changeset.committed via SSE; maybeToast dispara toast "alice commitou..." — prova
  // multiplayer sem F5; navigation count não cresce (antif5), #seq de bob avança.
  await expect(bob.page.locator(".toast", { hasText: `${domain}:${level}` })).toBeVisible({ timeout: 15_000 })
  const navAfter = await bob.page.evaluate(() => performance.getEntriesByType("navigation").length)
  expect(navAfter).toBe(navBefore)
  await expect.poll(async () => {
    const raw = (await bob.page.locator("#seq").textContent()) ?? "seq 0"
    return parseInt(raw.replace(/^seq\s*/, ""), 10)
  }).toBeGreaterThanOrEqual(bobSeqBefore + 1)

  // side-effect canvas-real pós-commit: o cs de alice fecha → ghosts em bob não crescem.
  await expect.poll(async () => bob.page.locator(".og-ghost-card").count()).toBeLessThanOrEqual(bobGhostsBefore)

  await alice.context.close()
  await bob.context.close()
})
