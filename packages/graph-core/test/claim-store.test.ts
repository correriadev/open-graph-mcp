import { expect, test } from "bun:test"
import { claimCoverage } from "../src/claim-store"
import type { MetaRecord } from "../src/meta"
import type { ClaimRecord } from "../src/claim-store"

// QA-4 DoD item 2: claimCoverage backs finalGate's β-cell "coverage balanced" check (gates.ts) —
// every meta (node) in the cell must be referenced by at least one claim.

const meta = (id: string): MetaRecord => ({ id, file: id, kind: "File", responsibility: id, exposed: false, deps: [], anchor: "x" })
const claim = (id: string, refs: string[]): ClaimRecord => ({ id, subject: id, domain: "d", refs, anchor: "" })

test("balanced: every meta id is referenced by at least one claim", () => {
  const r = claimCoverage([meta("a"), meta("b")], [claim("c1", ["a"]), claim("c2", ["b"])])
  expect(r).toEqual({ metaCount: 2, claimed: 2, missing: [], balanced: true })
})

test("not balanced: a meta id claimed by nobody", () => {
  const r = claimCoverage([meta("a"), meta("b")], [claim("c1", ["a"])])
  expect(r.balanced).toBe(false)
  expect(r.missing).toEqual(["b"])
  expect(r.claimed).toBe(1)
})

test("one claim covering multiple metas still counts each meta once", () => {
  const r = claimCoverage([meta("a"), meta("b")], [claim("c1", ["a", "b"])])
  expect(r).toEqual({ metaCount: 2, claimed: 2, missing: [], balanced: true })
})

test("empty cell (no meta at all) is trivially balanced", () => {
  const r = claimCoverage([], [])
  expect(r).toEqual({ metaCount: 0, claimed: 0, missing: [], balanced: true })
})

test("a ref pointing at something other than a meta id in this cell doesn't create false coverage", () => {
  const r = claimCoverage([meta("a")], [claim("c1", ["some-other-claim-id"])])
  expect(r.balanced).toBe(false)
  expect(r.missing).toEqual(["a"])
})
