import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

test("an expired lock aborts the changeset (ttl_expired) and releases the lock", async () => {
  const s = startServer({ ttlMs: 1 }) // 1ms TTL — expires immediately
  try {
    const a = await register(s.url, "alice")
    const sse = await openSse(s.url, 0, a.token)
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:5"], intent: "ttl" })

    await new Promise((r) => setTimeout(r, 20))
    s.sweep() // deterministic sweep (prod runs this on an interval)

    const evt = await sse.waitFor((e) => e.kind === "changeset.aborted" && e.payload.csId === csId)
    expect(evt.payload.reason).toBe("ttl_expired")

    const locks = (s.state.db.query("SELECT COUNT(*) AS c FROM locks WHERE tenant_id = ? AND cs_id = ?").get("default", csId) as { c: number }).c
    expect(locks).toBe(0)
    sse.close()
  } finally {
    s.stop()
  }
})
