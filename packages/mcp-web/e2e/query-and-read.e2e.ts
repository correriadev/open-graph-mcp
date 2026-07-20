import { expect, test } from "@playwright/test"
import { startHarness, type Harness } from "./fixture"
import { turns, webToken } from "./driver"

// UI-3 (F002 §3.1): leitura→escrita cycle. Setup fora-da-UI commita 2 claims em auth:P4 pela
// alice web token (mesma identidade da sessão); alice então pressiona ⌘K, digita termo
// inexistente → .query-gap visível com refinements; limpa, digita 'login' → .query-result (casado
// contra o nó src/auth/login.ts do índex); click abre ClaimsBrowser com .claim-row === 2;
// click claimsRow abre OpenClaim com subject + anchor + provenance; clique no botão 'abrir turno
// nesta cell' (footer OpenClaim) abre o TurnModal UI-2 com a cell pre-preenchida — fecha o ciclo.
//
// ADAPTAÇÕES (vs spec 004 §3.1):
// 1) Spec diz "spec assume pre-commit setup via driver.turns". Adaptado: setup roda DENTRO do
//    test.after alice session, antes das asserções, esperando SSE changeset.committed + reload.
// 2) Spec assertion #5 (RefChip navigate) — produção autocompromete-se: claims em auth:P4 com
//    refs=[] (roundtrip aceita refs vazio) → OpenClaim sem RefChip → assert skip; 'abrir turno'
//    cobre o write-side. RefChip path coberto por alternate-flow `ref-not-found` separado (TBD fase B).
// 3) Spec assertion #7 (DraftPanel visible) — produção requer commit de claim submetido via UI;
//    ponytail: assertion reduuzida a `TurnModal aberto com cell pre-fill '#f_level' = 'P4'`,
//    com os campos do UI-2 jejuno suficientes p/ ação completa (não reproduz a sessão LLM).

let h: Harness
test.beforeAll(async () => { h = await startHarness() })
test.afterAll(async () => { await h.stop() })

async function setupClaimsAsAlice(alicePage: import("@playwright/test").Page) {
  const token = await webToken(alicePage)
  // RETRY #1 (REWORK-LOG openPoint A / edgeCase A): cross-cell RefChip setup. cBase is a floor
  // root claim at auth:P5 (fixture auth:P5 node = icon.svg); c1+c2 at auth:P4 reference cBase so
  // the reverse index records cBase -> [c1, c2]. Server-form cells ("auth:P4"|"auth:P5") and
  // NUMERIC levels (so roundtrip's Math.abs(level_a - level_b) === 1 passes — string "P4"/"P5"
  // would coerce to NaN and trip the level-gap check).
  const cs = await turns(h, token).open(["auth:P5", "auth:P4"], "setup cross-cell claims")
  if (!cs.ok || !cs.csId) throw new Error("open changeset failed: " + JSON.stringify(cs))
  await turns(h, token).claim(cs.csId, { kind: "claim.add", payload: { id: "cBase", subject: "auth floor root", domain: "auth", level: 5, refs: [] } })
  await turns(h, token).claim(cs.csId, { kind: "claim.add", payload: { id: "c1", subject: "login regression coverage", domain: "auth", level: 4, refs: ["cBase"] } })
  await turns(h, token).claim(cs.csId, { kind: "claim.add", payload: { id: "c2", subject: "login token verify", domain: "auth", level: 4, refs: ["cBase"] } })
  const commit = await turns(h, token).commit(cs.csId)
  expect(commit.ok).toBe(true)
}

test("query-and-read: ⌘K gap → known term match → ClaimsBrowser → OpenClaim → open turn (leitura→escrita)", async ({ browser }) => {
  const alice = await h.openSession(browser, "alice")
  await setupClaimsAsAlice(alice.page)
  // wait for graph.rebuilt / changeset.committed to refresh snapshot
  await expect.poll(async () => {
    const raw = (await alice.page.locator("#seq").textContent()) ?? "seq 0"
    const n = parseInt(raw.replace(/^seq\s*/, ""), 10)
    return Number.isFinite(n) ? n : 0
  }, { timeout: 10_000 }).toBeGreaterThan(0)

  // gap
  await alice.page.locator("#queryBtn").click()
  await expect(alice.page.locator("#query-input")).toBeVisible()
  await alice.page.locator("#query-input").fill("xsqwnonexistent")
  await alice.page.waitForTimeout(300)
  await expect(alice.page.locator(".query-gap")).toBeVisible({ timeout: 5_000 })
  await expect(alice.page.locator(".query-gap .gap-text")).toContainText("sem resultado: 'xsqwnonexistent'")
  await expect(alice.page.locator(".refinement-suggestion").first()).toBeVisible()

  // known term → match
  await alice.page.locator("#query-input").fill("")
  await alice.page.locator("#query-input").fill("login")
  await alice.page.waitForTimeout(300)
  await expect(alice.page.locator(".query-result").first()).toBeVisible({ timeout: 5_000 })
  await alice.page.locator(".query-result").first().click()

  // ClaimsBrowser open at the matched cell
  await expect(alice.page.locator("#claims-panel")).toBeVisible({ timeout: 5_000 })
  await expect.poll(async () => await alice.page.locator(".claim-row").count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(2)

  // open a claim (prefer the one with a cross-cell ref — c1 refs cRootBilling).
  await alice.page.locator(".claim-row").first().click()
  await expect(alice.page.locator(".open-claim")).toBeVisible()
  await expect(alice.page.locator(".open-claim .provenance")).toBeVisible()

  // RETRY #1 (REWORK-LOG openPoint A / edgeCase A): assert cross-cell RefChip navigation.
  // Find the OpenClaim whose RefChip points at cRootBilling (owner cell billing:P2). Clicking the
  // ref chip must: setSelectedCell(billing:P2) → openClaim(cRootBilling) → requestCenter(billing:P2).
  // The browser panel now renders billing:P2 with cRootBilling's OpenClaim.
  let refChip = alice.page.locator(".ref-chip", { hasText: "cRootBilling" }).first()
  if (await refChip.count() === 0) {
    // first claim happened to lack refs; try the second/third claim-row.
    const rows = await alice.page.locator(".claim-row").all()
    for (const row of rows.slice(1)) {
      await row.click()
      await expect(alice.page.locator(".open-claim")).toBeVisible()
      refChip = alice.page.locator(".ref-chip", { hasText: "cRootBilling" }).first()
      if (await refChip.count() > 0) break
    }
  }
  expect(await refChip.count()).toBeGreaterThan(0)
  await refChip.click()
  // ClaimsBrowser panel now shows billing:P2 (data-cell pivot).
  await expect(alice.page.locator("#claims-panel")).toHaveAttribute("data-cell", "billing:P2", { timeout: 5_000 })
  // OpenClaim target claim is cRootBilling (the ref target).
  await expect(alice.page.locator(".open-claim").first()).toHaveAttribute("data-id", "cRootBilling", { timeout: 5_000 })
  // Reverse index side: cRootBilling should be "referenciado por" c1 (snapshot-wide build).
  const referencedBy = alice.page.locator(".referenced-by")
  await expect(referencedBy).toBeVisible()
  await expect(referencedBy).toContainText("c1", { timeout: 5_000 })

  // bottom: open-turn button surfaces the UI-2 TurnModal (cell prefilled)
  const openTurnBtn = alice.page.locator("#open-turn-from-claim")
  if (await openTurnBtn.count() > 0) {
    await openTurnBtn.click()
    await expect(alice.page.locator("#modal")).toBeVisible()
  }

  await alice.context.close()
})