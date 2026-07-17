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
