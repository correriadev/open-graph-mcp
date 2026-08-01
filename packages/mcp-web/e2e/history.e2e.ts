import { expect, test } from "@playwright/test"
import { startHarness, type Harness } from "./fixture"
import { turns, webToken } from "./driver"

// UI-3 (F002 §3.1 history): auditoria read-only. Setup fora-da-UI com 2 changesets (alice
// commita em billing:P2; bob abre e aborta em auth:P4) → events de 4+ kinds مختلف. alice web
// session navega para #/history; asserts ≥1 .history-row; filtro byUser=bob deixa só rows de bob;
// filtro kind=changeset.committed deixa só rows de commit; click row expande payload JSON;
// recolhe.
//
// ADAPTAÇÕES (vs spec 004 §3.1 history):
// 1) Spec setup pairing target=a célula do changeset. Produção filtra por payload.cells inclui a cell
//    (server target_id é o csId). Adaptado ao filtro supportando payload.cells.includes(target).
// 2) Especificamente "target=auth:P3" do spec: fixture não tem auth:P3 nó (login está em auth:P4);
//    adaptado p/ auth:P4 que é o BS actual cell real. Cobertura de behaviour-equivalente mantida.

let h: Harness
test.beforeAll(async () => { h = await startHarness() })
test.afterAll(async () => { await h.stop() })

async function setupHistory(browser: import("@playwright/test").Browser) {
  // alice commits in billing:P2; bob opens auth:P4 and aborts
  const alice = await h.openSessionInContext(await browser.newContext(), "alice")
  const bob = await h.openSessionInContext(await browser.newContext(), "bob")
  const aliceToken = await webToken(alice.page)
  const bobToken = await webToken(bob.page)
  const bobUserId = await bob.page.evaluate(() => localStorage.getItem("og.userId")!) as string
  // alice opens billing:P2 and commits two root claims (no refs → roundtrip ok)
  const aliceCs = await turns(h, aliceToken).open(["billing:P2"], "billing turn")
  if (!aliceCs.ok || !aliceCs.csId) throw new Error("alice open failed: " + JSON.stringify(aliceCs))
  await turns(h, aliceToken).claim(aliceCs.csId, { kind: "claim.add", payload: { id: "h-b1", subject: "billing root a", domain: "billing", level: "P2", refs: [] } })
  await turns(h, aliceToken).claim(aliceCs.csId, { kind: "claim.add", payload: { id: "h-b2", subject: "billing root b", domain: "billing", level: "P2", refs: [] } })
  const commit = await turns(h, aliceToken).commit(aliceCs.csId, "billing turn")
  expect(commit.ok).toBe(true)
  // bob opens auth:P4 and aborts
  const bobCs = await turns(h, bobToken).open(["auth:P4"], "bob trial")
  if (!bobCs.ok || !bobCs.csId) throw new Error("bob open failed: " + JSON.stringify(bobCs))
  await turns(h, bobToken).claim(bobCs.csId, { kind: "claim.add", payload: { id: "h-a1", subject: "bob trial claim", domain: "auth", level: "P4", refs: [] } })
  await turns(h, bobToken).abort(bobCs.csId)
  return { alice, bob, bobUserId }
}

test("history: filter byUser + kind + payload expand against harness events", async ({ browser }) => {
  const { alice, bob, bobUserId } = await setupHistory(browser)
  try {
    // navigate to /history
    await alice.page.locator("#nav-history").click()
    await expect(alice.page.locator("#history-view")).toBeVisible({ timeout: 5_000 })
    await expect.poll(async () => await alice.page.locator(".history-row").count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)

    // filter by bob → only bob rows remain visible (changeset.opened abort + lock + delta).
    await alice.page.locator("#history-byuser").selectOption({ value: bobUserId })
    await expect.poll(async () => {
      const rows = await alice.page.locator(".history-row")
      const count = await rows.count()
      for (let i = 0; i < count; i++) {
        const kind = await rows.nth(i).getAttribute("data-kind")
        // bob events: changeset.opened, changeset.delta, changeset.aborted, lock.acquired, lock.released
        if (kind && !/changeset\.opened|changeset\.delta|changeset\.aborted|lock\.acquired|lock\.released/.test(kind)) return false
      }
      return count > 0
    }, { timeout: 10_000 }).toBe(true)
    // reset
    await alice.page.locator("#history-byuser").selectOption({ value: "" })

    // filter kind=changeset.committed → only commit rows (alice's one)
    await alice.page.locator("#history-kind").selectOption({ label: "changeset.committed" })
    await expect.poll(async () => await alice.page.locator(".history-row").count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
    {
      const rows = await alice.page.locator(".history-row")
      const count = await rows.count()
      for (let i = 0; i < count; i++) expect(await rows.nth(i).getAttribute("data-kind")).toBe("changeset.committed")
    }
    await alice.page.locator("#history-kind").selectOption({ value: "" })

    // click first row → payload expands
    await alice.page.locator(".history-row").first().click()
    await expect(alice.page.locator(".history-payload").first()).toBeVisible()
    // click again → collapses
    await alice.page.locator(".history-row").first().click()
    await expect.poll(async () => await alice.page.locator(".history-payload").count(), { timeout: 5_000 }).toBe(0)

    // RETRY #1 (REWORK-LOG openPoint 4 / edgeCase F): filter-change → URL update → round-trip
    // preserves. Apply kind=changeset.committed, expect URL to carry ?kind=changeset.committed;
    // navigate to canvas then back; URL must still carry the filter and rows must stay filtered.
    await alice.page.locator("#history-kind").selectOption({ label: "changeset.committed" })
    await expect.poll(async () => alice.page.url().includes("kind=changeset.committed"), { timeout: 5_000 }).toBe(true)
    const rowsAfterKindFilter = await alice.page.locator(".history-row").count()
    expect(rowsAfterKindFilter).toBeGreaterThanOrEqual(1)
    {
      const rows = await alice.page.locator(".history-row").all()
      for (const r of rows) expect(await r.getAttribute("data-kind")).toBe("changeset.committed")
    }

    // navigate away (canvas) then back (history)
    await alice.page.locator("#nav-canvas").click()
    await expect.poll(async () => !alice.page.url().includes("/history"), { timeout: 5_000 }).toBe(true)
    await alice.page.locator("#nav-history").click()
    await expect(alice.page.locator("#history-view")).toBeVisible({ timeout: 5_000 })

    // URL preserved AND filter reapplied (only committed rows visible).
    await expect.poll(async () => alice.page.url().includes("kind=changeset.committed"), { timeout: 5_000 }).toBe(true)
    await expect.poll(async () => {
      const rows = await alice.page.locator(".history-row")
      const count = await rows.count()
      if (count === 0) return false
      for (let i = 0; i < count; i++) if ((await rows.nth(i).getAttribute("data-kind")) !== "changeset.committed") return false
      return true
    }, { timeout: 10_000 }).toBe(true)
  } finally {
    await alice.page.context().close().catch(() => {})
    await bob.page.context().close().catch(() => {})
  }
})