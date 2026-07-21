import { expect, test } from "bun:test"
import { submitClaimDraft } from "../src/claim-draft"

test("malformed raw JSON returns reasons without invoking mutation", async () => {
  let calls = 0
  const result = await submitClaimDraft({}, "{broken", async () => { calls++; return { ok: true } })
  expect(result).toEqual({ ok: false, reasons: ["raw JSON inválido"], warnings: [] })
  expect(calls).toBe(0)
})

test("valid raw JSON preserves claim.add mutation and server outcome", async () => {
  let sent: unknown
  const result = await submitClaimDraft({}, '{"id":"c1","level":3}', async (payload) => {
    sent = payload
    return { ok: false, reasons: ["rejected"], warnings: ["warning"] }
  })
  expect(sent).toEqual({ id: "c1", level: 3 })
  expect(result).toEqual({ ok: false, reasons: ["rejected"], warnings: ["warning"] })
})

test("primitive, array, and oversized raw JSON return bounded structured failures", async () => {
  let calls = 0
  const mutate = async () => { calls++; return { ok: true } }
  for (const raw of ["null", "1", '"text"', "[]", `[${"0,".repeat(40_000)}0]`, `{"text":"${"x".repeat(70_000)}"}`]) {
    const result = await submitClaimDraft({}, raw, mutate)
    expect(result.ok).toBe(false)
    expect(result.reasons).toHaveLength(1)
    expect(result.warnings).toEqual([])
  }
  expect(calls).toBe(0)
})
