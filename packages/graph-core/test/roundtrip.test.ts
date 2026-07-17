import { expect, test } from "bun:test"
import { roundtripScoped, type RoundtripClaim } from "../src/roundtrip"

// QA-4 DoD item 2: roundtripScoped is what gates.ts's incrementalGate (quick, advisory) and
// finalGate (aggregated, blocking) both call. Covers the four ladder-integrity invariants plus
// the scoping behavior finalGate relies on (regra 6: dedupe per new claim-root).

test("clean two-rung ladder: no violations", () => {
  const claims: RoundtripClaim[] = [
    { id: "code1", level: 5, refs: [] }, // root at the code extreme
    { id: "mid1", level: 4, refs: ["code1"] }, // adjacent
  ]
  const r = roundtripScoped(claims, "mid1")
  expect(r.ok).toBe(true)
  expect(r.violations).toEqual([])
})

test("dangling-ref: a ref that doesn't resolve to any claim in the set", () => {
  const claims: RoundtripClaim[] = [{ id: "mid1", level: 4, refs: ["nowhere"] }]
  const r = roundtripScoped(claims, "mid1")
  expect(r.ok).toBe(false)
  expect(r.violations).toEqual([{ id: "mid1", kind: "dangling-ref", detail: 'ref "nowhere" not found in claim set' }])
})

test("level-gap: ref is more than one rung away", () => {
  const claims: RoundtripClaim[] = [
    { id: "code1", level: 5, refs: [] },
    { id: "top1", level: 3, refs: ["code1"] }, // distance 2, not adjacent
  ]
  const r = roundtripScoped(claims, "top1")
  expect(r.ok).toBe(false)
  expect(r.violations).toEqual([
    { id: "top1", kind: "level-gap", detail: 'ref "code1" at level 5 is 2 levels from claim at level 3 (expected 1)' },
  ])
})

test("orphan-midladder: mid-ladder claim (0 < level < CODE_LEVEL) with zero refs", () => {
  const claims: RoundtripClaim[] = [{ id: "mid1", level: 3, refs: [] }]
  const r = roundtripScoped(claims, "mid1")
  expect(r.ok).toBe(false)
  expect(r.violations).toEqual([
    { id: "mid1", kind: "orphan-midladder", detail: "claim at level 3 has no refs (mid-ladder orphan; not connected to any adjacent level)" },
  ])
})

test("a root claim at level 0 or CODE_LEVEL with zero refs is NOT an orphan", () => {
  const claims: RoundtripClaim[] = [
    { id: "code1", level: 5, refs: [] },
    { id: "idea1", level: 0, refs: [] },
  ]
  expect(roundtripScoped(claims, "code1").ok).toBe(true)
  expect(roundtripScoped(claims, "idea1").ok).toBe(true)
})

test("cycle: two claims referencing each other at adjacent levels", () => {
  const claims: RoundtripClaim[] = [
    { id: "a", level: 4, refs: ["b"] },
    { id: "b", level: 5, refs: ["a"] },
  ]
  const r = roundtripScoped(claims, "a")
  expect(r.ok).toBe(false)
  expect(r.violations.map((v) => v.kind)).toEqual(["cycle", "cycle"])
  expect(new Set(r.violations.map((v) => v.id))).toEqual(new Set(["a", "b"]))
})

test("scoping: a violation in an unrelated connected component is invisible from this root", () => {
  const claims: RoundtripClaim[] = [
    { id: "clean-code", level: 5, refs: [] },
    { id: "clean-mid", level: 4, refs: ["clean-code"] },
    { id: "broken-mid", level: 3, refs: [] }, // orphan, but a disconnected component
  ]
  const r = roundtripScoped(claims, "clean-mid")
  expect(r.ok).toBe(true)
  expect(r.violations).toEqual([])
  // sanity: the same claim set DOES surface the violation when scoped from the broken root
  expect(roundtripScoped(claims, "broken-mid").ok).toBe(false)
})

test("rootId not present in the claim set: empty scope, ok:true", () => {
  const claims: RoundtripClaim[] = [{ id: "a", level: 4, refs: [] }]
  const r = roundtripScoped(claims, "does-not-exist")
  expect(r).toEqual({ violations: [], ok: true })
})
