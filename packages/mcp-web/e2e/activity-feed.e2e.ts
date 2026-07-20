import { expect, test } from "@playwright/test"
import { turns, webToken } from "./driver"
import { startHarness, type Harness } from "./fixture"

let harness: Harness
test.beforeAll(async () => { harness = await startHarness() })
test.afterAll(async () => { await harness.stop() })

test("activity feed renders event kind and target in increasing sequence", async ({ browser }) => {
  const alice = await harness.openSession(browser, "alice-feed")
  const bob = await harness.openSession(browser, "bob-feed")
  await bob.page.evaluate((cell) => (window as any).__og_e2e.setFocus(cell), harness.firstCell)
  const actor = turns(harness, await webToken(alice.page))
  const opened = await actor.open([harness.firstCell], "feed ordering")
  const csId = opened.csId ?? opened.id
  await actor.claim(csId, { kind: "claim.add", payload: { subject: "feed event" } })
  await actor.abort(csId)

  await expect(bob.page.locator('#evlist li[data-kind="changeset"]')).toHaveCount(2, { timeout: 10_000 })
  const entries = await bob.page.locator("#evlist li").evaluateAll((nodes) => nodes.map((node) => ({
    seq: Number((node as HTMLElement).dataset.seq),
    text: node.textContent ?? "",
  })))
  expect(entries.every((entry, index) => index === 0 || entries[index - 1]!.seq <= entry.seq)).toBe(true)
  expect(entries.some((entry) => entry.text.includes("lock.acquired") && entry.text.includes(harness.firstCell))).toBe(true)
  await alice.context.close()
  await bob.context.close()
})
