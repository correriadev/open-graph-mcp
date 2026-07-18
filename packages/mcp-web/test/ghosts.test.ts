import { expect, test } from "bun:test"
import { colorForCsId, GhostStore } from "../src/ghosts"

const ev = (kind: string, payload: any) => ({ kind, payload })

test("GhostStore folds a changeset lifecycle into open state + locks", () => {
  const g = new GhostStore()
  g.apply(ev("changeset.opened", { csId: "cs1", intent: "cpf", cells: ["ui:P4"], byUser: "alice", expiresAt: 100 }))
  g.apply(ev("lock.acquired", { cell: "ui:P4", csId: "cs1", holder: "alice", expiresAt: 100 }))
  expect(g.changesets.get("cs1")?.intent).toBe("cpf")
  expect(g.locks.get("ui:P4")?.holder).toBe("alice")

  // delta bumps count and asks caller to refetch
  const r = g.apply(ev("changeset.delta", { csId: "cs1", deltaCountSinceLast: 2 }))
  expect(r.refetch).toBe("cs1")
  expect(g.changesets.get("cs1")?.deltaCount).toBe(2)

  // committed clears the changeset and its lock
  const c = g.apply(ev("changeset.committed", { csId: "cs1", cells: ["ui:P4"] }))
  expect(c.committed).toBe(true)
  expect(g.changesets.has("cs1")).toBe(false)
  expect(g.locks.has("ui:P4")).toBe(false)
})

test("GhostStore.apply ignores deltas for unknown changesets and unrelated kinds", () => {
  const g = new GhostStore()
  expect(g.apply(ev("changeset.delta", { csId: "ghost", deltaCountSinceLast: 1 }))).toEqual({})
  expect(g.apply(ev("authority.flipped", { cell: "ui:P4" }))).toEqual({})
  expect(g.changesets.size).toBe(0)
})

test("GhostStore.apply aborts drop the changeset without a base reload", () => {
  const g = new GhostStore()
  g.apply(ev("changeset.opened", { csId: "cs2", cells: ["api:P3"] }))
  g.apply(ev("lock.acquired", { cell: "api:P3", csId: "cs2", holder: "bob", expiresAt: 1 }))
  const r = g.apply(ev("changeset.aborted", { csId: "cs2", cells: ["api:P3"], reason: "ttl_expired" }))
  expect(r.committed).toBeUndefined()
  expect(g.changesets.has("cs2")).toBe(false)
  expect(g.locks.has("api:P3")).toBe(false)
})

test("lock.released only clears the lock owned by that csId", () => {
  const g = new GhostStore()
  g.apply(ev("lock.acquired", { cell: "ui:P4", csId: "csA", holder: "a", expiresAt: 1 }))
  g.apply(ev("lock.released", { cell: "ui:P4", csId: "other" })) // stale release, different owner
  expect(g.locks.has("ui:P4")).toBe(true)
  g.apply(ev("lock.released", { cell: "ui:P4", csId: "csA" }))
  expect(g.locks.has("ui:P4")).toBe(false)
})

test("colorForCsId is deterministic and varies across ids", () => {
  expect(colorForCsId("cs-abc")).toBe(colorForCsId("cs-abc"))
  const colors = new Set(["cs1", "cs2", "cs3", "cs4", "cs5"].map(colorForCsId))
  expect(colors.size).toBeGreaterThan(1)
  expect(colorForCsId("cs-abc")).toMatch(/^hsl\(\d+, 70%, 60%\)$/)
})

test("setDeltas populates the open changeset's ghost deltas", () => {
  const g = new GhostStore()
  g.apply(ev("changeset.opened", { csId: "cs1", cells: ["ui:P4"] }))
  g.setDeltas("cs1", [{ kind: "claim.add", domain: "ui", level: "P4", summary: "validateCpf" }])
  expect(g.changesets.get("cs1")?.deltas[0].summary).toBe("validateCpf")
  expect(g.changesets.get("cs1")?.deltaCount).toBe(1)
})
