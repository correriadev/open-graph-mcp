import { expect, test } from "bun:test"
import { verifyIntegrity } from "../src/verify"
import type { MetaRecord } from "../src/meta"
import type { ClaimRecord } from "../src/claim-store"

// QA-4 DoD item 2: verifyIntegrity backs finalGate's β-cell "verify clean" check (gates.ts).
// meta = chão (file/anchor), claims = escada; covers each Breach kind gates.ts can surface.

const meta = (over: Partial<MetaRecord> = {}): MetaRecord => ({
  id: "mod/file.ts",
  file: "mod/file.ts",
  kind: "File",
  responsibility: "mod/file.ts",
  exposed: false,
  deps: [],
  anchor: "export function handler() {}",
  ...over,
})

const claim = (over: Partial<ClaimRecord> = {}): ClaimRecord => ({
  id: "c1",
  subject: "handler",
  domain: "mod",
  refs: ["mod/file.ts"],
  anchor: "export function handler() {}",
  ...over,
})

const files = (map: Record<string, string>) => (f: string) => map[f]

test("clean: node grounded with verbatim anchor, claim grounded + anchor verbatim in its ref's file", () => {
  const r = verifyIntegrity([meta()], [claim()], files({ "mod/file.ts": "export function handler() {}\n" }))
  expect(r.clean).toBe(true)
  expect(r.breaches).toEqual([])
  expect(r.checked).toEqual({ nodes: 1, claims: 1 })
})

test("missing-file: node's file doesn't resolve via readFile", () => {
  const r = verifyIntegrity([meta()], [], files({}))
  expect(r.clean).toBe(false)
  expect(r.breaches).toEqual([{ kind: "missing-file", id: "mod/file.ts", detail: "mod/file.ts" }])
})

test("broken-anchor: file exists but doesn't contain the node's anchor verbatim", () => {
  const r = verifyIntegrity([meta()], [], files({ "mod/file.ts": "totally different content" }))
  expect(r.clean).toBe(false)
  expect(r.breaches).toEqual([{ kind: "broken-anchor", id: "mod/file.ts", detail: "mod/file.ts" }])
})

test("dangling-ref: claim ref resolves to neither a meta id nor another claim id", () => {
  const r = verifyIntegrity([meta()], [claim({ refs: ["nowhere"], anchor: "" })], files({ "mod/file.ts": "export function handler() {}" }))
  expect(r.clean).toBe(false)
  expect(r.breaches).toEqual([{ kind: "dangling-ref", id: "c1", detail: "nowhere" }])
})

test("a claim ref resolving to ANOTHER CLAIM (ladder, not floor) is not dangling", () => {
  const claims = [claim({ id: "c1", refs: [], anchor: "" }), claim({ id: "c2", refs: ["c1"], anchor: "" })]
  const r = verifyIntegrity([], claims, files({}))
  expect(r.clean).toBe(true)
})

test("dangling-claim-anchor: claim is floor-grounded (refs a meta id) but its anchor isn't verbatim in that file", () => {
  const r = verifyIntegrity(
    [meta()],
    [claim({ anchor: "this text never appears in the file" })],
    files({ "mod/file.ts": "export function handler() {}" }),
  )
  expect(r.clean).toBe(false)
  expect(r.breaches).toEqual([{ kind: "dangling-claim-anchor", id: "c1", detail: "anchor not verbatim in any ref file" }])
})

test("a claim with no anchor is exempt from the floor-anchor check even when grounded", () => {
  const r = verifyIntegrity([meta()], [claim({ anchor: "" })], files({ "mod/file.ts": "export function handler() {}" }))
  expect(r.clean).toBe(true)
})

test("a ladder-only claim (no meta refs) is exempt from the floor-anchor check regardless of anchor text", () => {
  const claims = [claim({ id: "c1", refs: [], anchor: "" }), claim({ id: "c2", refs: ["c1"], anchor: "anything at all" })]
  const r = verifyIntegrity([], claims, files({}))
  expect(r.clean).toBe(true)
})

// F8: `claims` (3rd arg) is the REVIEW SCOPE (what gets checked); `allClaimIds` (4th arg, optional) is
// the RESOLUTION UNIVERSE (what a ref may point at). They used to be the same set, which made every
// mid-ladder ref look dangling once `claims` was scoped to a single cell (adjacency forces the ref
// into a DIFFERENT cell by construction). See top-of-file note and docs/roadmap-server-beta.

test("F8: without allClaimIds, ref resolution stays scoped to `claims` (back-compat: default = claims)", () => {
  // c2 (level 4) refs c1 (level 5) — c1 is NOT in the reviewed subset, so it looks dangling.
  // This is the pre-F8 behavior, preserved when the 4th arg is omitted.
  const c1 = claim({ id: "c1", subject: "root", domain: "d", level: 5, refs: [], anchor: "" } as any)
  const c2 = claim({ id: "c2", subject: "mid", domain: "d", level: 4, refs: ["c1"], anchor: "" } as any)
  const r = verifyIntegrity([], [c2], files({}))
  expect(r.clean).toBe(false)
  expect(r.breaches).toEqual([{ kind: "dangling-ref", id: "c2", detail: "c1" }])
})

test("F8: with allClaimIds carrying the GLOBAL claim set, a mid-ladder ref into another cell resolves (not dangling)", () => {
  // Same shape as above, but the caller now passes the global universe (existing + new claims across
  // ALL cells) as the 4th arg — the reviewed subset (3rd arg) stays just [c2], mirroring finalGate's
  // per-cell loop: `claims` = cellClaims (what to check), `allClaimIds` = allClaims (what refs resolve
  // against).
  const c1 = claim({ id: "c1", subject: "root", domain: "d", level: 5, refs: [], anchor: "" } as any)
  const c2 = claim({ id: "c2", subject: "mid", domain: "d", level: 4, refs: ["c1"], anchor: "" } as any)
  const r = verifyIntegrity([], [c2], files({}), new Set([c1.id, c2.id]))
  expect(r.clean).toBe(true)
  expect(r.breaches).toEqual([])
})

test("F8: allClaimIds accepts a plain array of {id} objects too (not just a Set)", () => {
  const c1 = claim({ id: "c1", subject: "root", domain: "d", level: 5, refs: [], anchor: "" } as any)
  const c2 = claim({ id: "c2", subject: "mid", domain: "d", level: 4, refs: ["c1"], anchor: "" } as any)
  const r = verifyIntegrity([], [c2], files({}), [c1, c2])
  expect(r.clean).toBe(true)
})

test("F8: a ref to an id that exists NOWHERE (not in meta, not in the global universe) is still dangling-ref — the universe fix does not loosen real breaches", () => {
  const c2 = claim({ id: "c2", subject: "mid", domain: "d", level: 4, refs: ["nowhere"], anchor: "" } as any)
  const r = verifyIntegrity([], [c2], files({}), new Set(["c2", "some-other-claim-not-nowhere"]))
  expect(r.clean).toBe(false)
  expect(r.breaches).toEqual([{ kind: "dangling-ref", id: "c2", detail: "nowhere" }])
})
