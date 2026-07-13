import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { buildPhase1Graph, callTool, readResource, register, tempRepo } from "./helpers"

test("two tenants are fully isolated: events, locks, graph and history do not cross", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root })
  try {
    await buildPhase1Graph(s.url, root) // writes .graph/ to disk for import
    const alice = await register(s.url, "alice", "acme")
    const bob = await register(s.url, "bob", "globex")

    // Graph isolation: alice imports into acme; globex has no graph.
    await callTool(s.url, "graph.import", { token: alice.token, repoPath: root })
    const acmeQuery = await callTool(s.url, "graph.query", { token: alice.token, terms: ["audit"] })
    expect(acmeQuery.candidates.length).toBeGreaterThan(0)
    let globexThrew = false
    try {
      await callTool(s.url, "graph.query", { token: bob.token, terms: ["audit"] })
    } catch {
      globexThrew = true // globex tenant was never bootstrapped/imported
    }
    expect(globexThrew).toBe(true)

    // Lock isolation: both tenants lock the SAME cell name independently.
    const aOpen = await callTool(s.url, "changeset.open", { token: alice.token, cells: ["ui:5"], intent: "acme turn" })
    const bOpen = await callTool(s.url, "changeset.open", { token: bob.token, cells: ["ui:5"], intent: "globex turn" })
    expect(aOpen.ok).toBe(true)
    expect(bOpen.ok).toBe(true) // no cross-tenant collision on ui:5

    const acmeLocks = s.state.db.query("SELECT cs_id FROM locks WHERE tenant_id = ? AND cell = ?").all("acme", "ui:5") as { cs_id: string }[]
    const globexLocks = s.state.db.query("SELECT cs_id FROM locks WHERE tenant_id = ? AND cell = ?").all("globex", "ui:5") as { cs_id: string }[]
    expect(acmeLocks.map((l) => l.cs_id)).toEqual([aOpen.csId])
    expect(globexLocks.map((l) => l.cs_id)).toEqual([bOpen.csId])

    // Event/history isolation: acme's changeset is invisible in globex's history and vice versa.
    const acmeHist = await readResource(s.url, "graph://history?since=0", alice.token)
    const globexHist = await readResource(s.url, "graph://history?since=0", bob.token)
    const acmeIds = acmeHist.events.map((e: any) => e.payload.csId).filter(Boolean)
    const globexIds = globexHist.events.map((e: any) => e.payload.csId).filter(Boolean)
    expect(acmeIds).toContain(aOpen.csId)
    expect(acmeIds).not.toContain(bOpen.csId)
    expect(globexIds).toContain(bOpen.csId)
    expect(globexIds).not.toContain(aOpen.csId)
  } finally {
    s.stop()
    cleanup()
  }
})
