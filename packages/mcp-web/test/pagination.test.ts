import { expect, test } from "bun:test"
import { claimsPaginationControls, mergeClaimPage, mergeHistoryPage, shouldReadCellPage } from "../src/store"
import { mergeReverseIndex } from "../src/reverse-index"

const claim = (id: string, seq: number, domain = "auth", level = 4, refs: string[] = []) =>
  ({ id, seq, subject: id, domain, level, refs, anchor: "" })

test("claim pages group by cell and duplicate delivery is idempotent", () => {
  const page = [claim("a", 1), claim("b", 2, "billing", 2)]
  const once = mergeClaimPage({}, page)
  const twice = mergeClaimPage(once, page)
  expect(twice["auth:P4"].map((c) => c.id)).toEqual(["a"])
  expect(twice["billing:P2"].map((c) => c.id)).toEqual(["b"])
})

test("tenant snapshot page preserves a cell-loaded claim outside page one", () => {
  const open = claim("open-claim", 500)
  const initial = { "auth:P4": [open] }
  const merged = mergeClaimPage(initial, [claim("first-page", 1)])
  expect(merged["auth:P4"].map((item) => item.id)).toEqual(["first-page", "open-claim"])
})

test("snapshot fragments never satisfy the dedicated cell page-zero cache", () => {
  const fragment = [claim("snapshot-only", 1)]
  expect(shouldReadCellPage(fragment, undefined, false)).toBe(true)
  expect(shouldReadCellPage(fragment, { initialized: false }, false)).toBe(true)
  expect(shouldReadCellPage(fragment, { initialized: true }, false)).toBe(false)
})

test("late open claims retain both continuation controls and correctly-owned retries", () => {
  expect(claimsPaginationControls({
    hasOpenClaim: true,
    cellHasMore: true,
    snapshotHasMore: true,
    cellError: "cell failed",
    snapshotError: "snapshot failed",
  })).toEqual({ showCellContinuation: true, showSnapshotContinuation: true, retryCell: true, retrySnapshot: true })
})

test("history continuation appends by sequence while initial reads replace", () => {
  const first = [{ seq: 1, ts: 1, kind: "one" }]
  const second = [{ seq: 2, ts: 2, kind: "two" }, { seq: 2, ts: 2, kind: "two" }]
  expect(mergeHistoryPage(first, second, true).map((e) => e.seq)).toEqual([1, 2])
  expect(mergeHistoryPage(first, second, false).map((e) => e.seq)).toEqual([2])
})

test("incremental reverse index adds each edge once", () => {
  const first = mergeReverseIndex(new Map(), [claim("a", 1), claim("b", 2, "auth", 4, ["a"])])
  const twice = mergeReverseIndex(first, [claim("b", 2, "auth", 4, ["a"])])
  expect(twice.get("a")).toEqual(["b"])
})
