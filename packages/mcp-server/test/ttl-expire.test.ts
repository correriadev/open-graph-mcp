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

test("TTL expiry reaches the HOLDER even when their filter matches neither the cell nor the cs (affinity §6.1)", async () => {
  const s = startServer({ ttlMs: 1 })
  try {
    const a = await register(s.url, "alice")
    // Alice's SSE is narrowly filtered to an unrelated domain — the base filter would drop the abort;
    // only the holder-routing branch of the affinity router can deliver it.
    const sse = await openSse(s.url, 0, a.token, "domain:totally-unrelated")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:5"], intent: "ttl-holder" })

    await new Promise((r) => setTimeout(r, 20))
    s.sweep()

    const evt = await sse.waitFor((e) => e.kind === "changeset.aborted" && e.payload.csId === csId)
    expect(evt.payload.reason).toBe("ttl_expired")
    expect(evt.payload.byUser).toBe(a.userId)
    sse.close()
  } finally {
    s.stop()
  }
})
