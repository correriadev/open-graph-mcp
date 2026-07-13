import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, register, tempRepo } from "./helpers"

test("changeset.claim with a non-existent anchor is rejected on the spot (not at commit)", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root })
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:5"], intent: "early gate" })

    const r = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "c1", subject: "s", domain: "ui", level: 5, refs: [], anchor: "THIS ANCHOR IS NOT IN THE FILE", file: "src/audit.ts" } },
    })
    expect(r.ok).toBe(false)
    expect(r.reasons.some((x: string) => x.includes("anchor"))).toBe(true)

    // nothing was staged
    const deltas = (s.state.db.query("SELECT COUNT(*) AS c FROM cs_deltas WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { c: number }).c
    expect(deltas).toBe(0)
  } finally {
    s.stop()
    cleanup()
  }
})
