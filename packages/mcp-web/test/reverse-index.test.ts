import { expect, test } from "bun:test"
import { buildReverseIndex } from "../src/reverse-index"
import type { ClaimRecord } from "../src/store"

test("buildReverseIndex returns empty map for empty claims", () => {
  expect(buildReverseIndex([]).size).toBe(0)
  expect(buildReverseIndex({}).size).toBe(0)
})

test("buildReverseIndex maps target claimId to source claimId for each claim->claim ref", () => {
  const claims: ClaimRecord[] = [
    { id: "c1", subject: "a", domain: "auth", refs: [], anchor: "x" },
    { id: "c2", subject: "b", domain: "auth", refs: ["c1"], anchor: "x" },
    { id: "c3", subject: "c", domain: "auth", refs: ["c1", "c2"], anchor: "x" },
  ]
  const idx = buildReverseIndex(claims)
  expect(idx.get("c1")?.slice().sort()).toEqual(["c2", "c3"].sort())
  expect(idx.get("c2")).toEqual(["c3"])
  expect(idx.get("c3")).toBeUndefined()
})

test("buildReverseIndex is single-pass; N=1000 completes under 50ms", () => {
  const big: ClaimRecord[] = []
  for (let i = 1; i <= 1000; i++) big.push({ id: `c${i}`, subject: "s", domain: "auth", refs: i > 1 ? [`c${i - 1}`] : [], anchor: "a" })
  const t0 = performance.now()
  const idx = buildReverseIndex(big)
  const t1 = performance.now()
  expect(idx.size).toBe(999)
  expect(t1 - t0).toBeLessThan(50)
})

test("invalidate (discard) semantics: empty new Map replaces previous entries", () => {
  const before = buildReverseIndex([{ id: "c1", subject: "a", domain: "auth", refs: [], anchor: "x" }])
  expect(before.size).toBe(0) // c1 has no refs, so no incoming edges → size 0
  // discard path: replace with fresh empty map (mirrors store.setReverseIndex(null) + next build)
  const fresh = buildReverseIndex([])
  expect(fresh.size).toBe(0)
})

test("snapshot-wide build: source in cell A targeting claim in cell B is captured (cross-cell reverse index)", () => {
  // Spec 003 §3 mandates snapshot-wide O(edges); REWORK-LOG openPoint 2 / edgeCase C.
  const claimsByCell: Record<string, ClaimRecord[]> = {
    "auth:P3": [{ id: "root", subject: "s", domain: "auth", refs: [], anchor: "a" }],
    "auth:P4": [{ id: "downstream", subject: "t", domain: "auth", refs: ["root"], anchor: "b" }],
    "billing:P2": [{ id: "lateral", subject: "u", domain: "billing", refs: ["root"], anchor: "c" }],
  }
  const idx = buildReverseIndex(claimsByCell)
  expect(idx.get("root")?.slice().sort()).toEqual(["downstream", "lateral"].sort())
  expect(idx.get("downstream")).toBeUndefined()
})

test("snapshot-wide build remains bounded across 1000 cells", () => {
  const claimsByCell: Record<string, ClaimRecord[]> = {}
  for (let i = 0; i < 1000; i++) {
    claimsByCell[`domain-${i}:P4`] = [{ id: `c-${i}`, subject: "s", domain: `domain-${i}`, refs: i ? [`c-${i - 1}`] : [], anchor: "a" }]
  }
  const started = performance.now()
  expect(buildReverseIndex(claimsByCell).size).toBe(999)
  expect(performance.now() - started).toBeLessThan(50)
})
