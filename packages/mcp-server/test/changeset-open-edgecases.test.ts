import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, register } from "./helpers"

test("changeset.open with an empty cells array is refused, not a crash", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    await expect(callTool(s.url, "changeset.open", { token: a.token, cells: [], intent: "empty" })).rejects.toThrow(/cells required/)
  } finally {
    s.stop()
  }
})

test("changeset.open with cells as a non-array (a string) is refused the same way as empty, not a crash", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    await expect(callTool(s.url, "changeset.open", { token: a.token, cells: "ui:1", intent: "not-an-array" })).rejects.toThrow(/cells required/)
  } finally {
    s.stop()
  }
})

// REPORT-A2: a cell key with no ":" is accepted silently. `nodesOfCell` (gates.ts) does
// `cell.lastIndexOf(":")` → -1 when absent, so `domain = cell.slice(0, -1)` and `level = cell.slice(0)`
// (the whole string) — it doesn't throw, it just matches zero nodes and the lock/changeset is created
// on a cell key that can never correspond to a real cell. Not a crash, but a malformed cell silently
// creates a changeset nobody can ever legitimately hold nodes under. Fixing this would mean validating
// cell shape in changeset.ts — doesn't change inputSchema/URI/event kind, so it's a real Tier 1
// candidate; left as documented-and-not-fixed here because the campaign's priority order (per the
// scope doc) put changeset lifecycle/TTL correctness first and this is a pre-existing, non-crashing
// edge case with no user-visible symptom in the currently tested flows.
test("REPORT-A2: changeset.open accepts a cell key with no colon (no domain:level shape) without validation", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const open = await callTool(s.url, "changeset.open", { token: a.token, cells: ["not-a-real-cell"], intent: "malformed" })
    expect(open.ok).toBe(true)
    const lockCount = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ? AND cell = ?").get("default", "not-a-real-cell") as { c: number }).c
    expect(lockCount).toBe(1)
  } finally {
    s.stop()
  }
})

test('opening cells that span two of the caller\'s own existing changesets throws "cells span multiple of your changesets"', async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const cs1 = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:40"], intent: "first" })
    const cs2 = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:41"], intent: "second" })
    expect(cs1.csId).not.toBe(cs2.csId)

    await expect(callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:40", "ui:41"], intent: "merge attempt" })).rejects.toThrow(
      /cells span multiple of your changesets; commit\/abort first/,
    )

    // both changesets remain open and independently intact — the throw didn't leave a partial write
    const cs1Row = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", cs1.csId) as { status: string }
    const cs2Row = s.state.db.query("SELECT status FROM changesets WHERE tenant_id = ? AND id = ?").get("default", cs2.csId) as { status: string }
    expect(cs1Row.status).toBe("open")
    expect(cs2Row.status).toBe("open")
    const lock40 = s.state.db.query("SELECT cs_id FROM locks WHERE tenant_id = ? AND cell = ?").get("default", "ui:40") as { cs_id: string }
    const lock41 = s.state.db.query("SELECT cs_id FROM locks WHERE tenant_id = ? AND cell = ?").get("default", "ui:41") as { cs_id: string }
    expect(lock40.cs_id).toBe(cs1.csId)
    expect(lock41.cs_id).toBe(cs2.csId)
  } finally {
    s.stop()
  }
})
