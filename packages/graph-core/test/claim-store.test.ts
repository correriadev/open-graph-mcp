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

// F4 (docs/roadmap-server-beta/01-evidencias-fluxo-completo.md §F4): `refs` used to carry two
// contracts at once — ladder adjacency (roundtrip.checkClaims) AND node coverage (claimCoverage).
// `covers` is the explicit field for the second contract, so a claim's id no longer has to equal a
// node's id (the floor-claim trick) just to close coverage.

test("F4: `covers` alone closes coverage — no floor-claim id trick needed", () => {
  const withCovers = (id: string, refs: string[], covers: string[]) => ({ ...claim(id, refs), covers })
  const r = claimCoverage([meta("a"), meta("b")], [withCovers("c1", [], ["a", "b"])])
  expect(r).toEqual({ metaCount: 2, claimed: 2, missing: [], balanced: true })
})

test("F4: `covers` and legacy `refs`-as-node-id both contribute to coverage, additively", () => {
  const withCovers = (id: string, refs: string[], covers: string[]) => ({ ...claim(id, refs), covers })
  // "a" covered via `covers`, "b" covered the legacy way (its id appears directly in `refs`).
  const r = claimCoverage([meta("a"), meta("b")], [withCovers("c1", [], ["a"]), claim("c2", ["b"])])
  expect(r).toEqual({ metaCount: 2, claimed: 2, missing: [], balanced: true })
})

test("F4: legacy claims (no `covers` field at all) keep covering via `refs` — back-compat, nothing lost", () => {
  // Simulates a claim record read back from a pre-F4 store: `covers` is simply absent (undefined).
  const legacy = { id: "c1", subject: "c1", domain: "d", refs: ["a"], anchor: "" }
  const r = claimCoverage([meta("a")], [legacy])
  expect(r).toEqual({ metaCount: 1, claimed: 1, missing: [], balanced: true })
})

test("F4: partial coverage via `covers` still reports the uncovered node as missing", () => {
  const withCovers = (id: string, refs: string[], covers: string[]) => ({ ...claim(id, refs), covers })
  const r = claimCoverage([meta("a"), meta("b")], [withCovers("c1", [], ["a"])])
  expect(r.balanced).toBe(false)
  expect(r.missing).toEqual(["b"])
  expect(r.claimed).toBe(1)
})
