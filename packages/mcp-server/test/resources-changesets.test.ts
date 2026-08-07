/**
 * resources-changesets.test.ts — WS-B (SB-0). `graph://changesets` had ZERO tests anywhere before this
 * file. Covers status filtering (open/admitted/aborted, and an unknown status → [] not an error), the
 * changesetView projection fields (deltas, participants, cells, admitSeq), tenant scoping, and
 * `graph://changeset/{id}` (unknown id, another tenant's csId, missing id).
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { resolveResource } from "../src/resources"
import { callTool, readResource, register } from "./helpers"

test("graph://changesets: status filter partitions open / admitted / aborted, and lists all when omitted", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")

    // open: still open, no commit.
    const open = await callTool(s.url, "changeset.open", { token: a.token, cells: ["auth:5"], intent: "stays open" })

    // admitted: opened, claimed, committed.
    const admitted = await callTool(s.url, "changeset.open", { token: a.token, cells: ["billing:5"], intent: "gets admitted" })
    await callTool(s.url, "changeset.claim", {
      token: a.token, csId: admitted.csId,
      delta: { kind: "claim.add", payload: { id: "cx", subject: "s", domain: "billing", level: "P5", refs: [] } },
    })
    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId: admitted.csId, intent: "gets admitted" })
    expect(commit.ok).toBe(true)

    // aborted: opened, explicitly aborted.
    const aborted = await callTool(s.url, "changeset.open", { token: a.token, cells: ["support:5"], intent: "gets aborted" })
    const abort = await callTool(s.url, "changeset.abort", { token: a.token, csId: aborted.csId })
    expect(abort.ok).toBe(true)

    const openList = await readResource(s.url, "graph://changesets?status=open", a.token)
    expect(openList.changesets.map((c: any) => c.id)).toEqual([open.csId])

    const admittedList = await readResource(s.url, "graph://changesets?status=admitted", a.token)
    expect(admittedList.changesets.map((c: any) => c.id)).toEqual([admitted.csId])

    const abortedList = await readResource(s.url, "graph://changesets?status=aborted", a.token)
    expect(abortedList.changesets.map((c: any) => c.id)).toEqual([aborted.csId])

    const all = await readResource(s.url, "graph://changesets", a.token)
    expect(new Set(all.changesets.map((c: any) => c.id))).toEqual(new Set([open.csId, admitted.csId, aborted.csId]))

    // Unknown status value → empty array, never an error.
    const unknown = await readResource(s.url, "graph://changesets?status=not-a-real-status", a.token)
    expect(unknown.changesets).toEqual([])
  } finally {
    s.stop()
  }
})

test("graph://changesets: each entry projects deltas, participants, cells, and admitSeq", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["auth:5"], intent: "projection check" })
    await callTool(s.url, "changeset.claim", {
      token: a.token, csId,
      delta: { kind: "claim.add", payload: { id: "p1", subject: "s1", domain: "auth", level: "P5", refs: [] } },
    })
    await callTool(s.url, "changeset.claim", {
      token: a.token, csId,
      delta: { kind: "claim.add", payload: { id: "p2", subject: "s2", domain: "auth", level: "P5", refs: [] } },
    })
    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "projection check" })
    expect(commit.ok).toBe(true)

    const list = await readResource(s.url, "graph://changesets?status=admitted", a.token)
    const view = list.changesets.find((c: any) => c.id === csId)
    expect(view).toBeDefined()
    expect(view.cells).toEqual(["auth:5"])
    expect(view.participants).toEqual([a.userId])
    expect(view.admitSeq).toBe(commit.admitSeq)
    expect(view.deltas).toHaveLength(2)
    expect(view.deltas.map((d: any) => d.kind)).toEqual(["claim.add", "claim.add"])
    expect(view.deltas[0]).toMatchObject({ seq: 1, kind: "claim.add", payload: expect.objectContaining({ id: "p1" }) })
    expect(typeof view.deltas[0].createdAt).toBe("string")

    // graph://changeset/{id} projects the exact same shape as the list entry.
    const single = await readResource(s.url, `graph://changeset/${csId}`, a.token)
    expect(single).toEqual(view)
  } finally {
    s.stop()
  }
})

test("graph://changesets is tenant-scoped: tenant A never sees tenant B's changesets", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice", "tenant-a")
    const b = await register(s.url, "bob", "tenant-b")
    await callTool(s.url, "changeset.open", { token: a.token, cells: ["auth:5"], intent: "a's turn" })
    await callTool(s.url, "changeset.open", { token: b.token, cells: ["auth:5"], intent: "b's turn" })

    const asA = await readResource(s.url, "graph://changesets", a.token)
    const asB = await readResource(s.url, "graph://changesets", b.token)
    expect(asA.changesets).toHaveLength(1)
    expect(asB.changesets).toHaveLength(1)
    expect(asA.changesets[0].id).not.toBe(asB.changesets[0].id)
    expect(asA.changesets[0].intent).toBe("a's turn")
    expect(asB.changesets[0].intent).toBe("b's turn")
  } finally {
    s.stop()
  }
})

test("graph://changeset/{id}: unknown id throws, another tenant's csId is invisible, missing id throws 'changeset id required'", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice", "tenant-a")
    const b = await register(s.url, "bob", "tenant-b")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["auth:5"], intent: "a's turn" })

    await expect(readResource(s.url, "graph://changeset/cs_does_not_exist", a.token)).rejects.toThrow(/unknown changeset/)

    // b's token, a's csId: not visible (the query is scoped by tenant_id AND id — a's csId doesn't
    // exist under tenant-b's rows at all).
    await expect(readResource(s.url, `graph://changeset/${csId}`, b.token)).rejects.toThrow(/unknown changeset/)

    // Same csId under a's own token resolves fine (control).
    const own = await readResource(s.url, `graph://changeset/${csId}`, a.token)
    expect(own.id).toBe(csId)

    expect(() => resolveResource(s.state, "graph://changeset/", "tenant-a")).toThrow("changeset id required")
    expect(() => resolveResource(s.state, "graph://changeset", "tenant-a")).toThrow("changeset id required")
  } finally {
    s.stop()
  }
})
