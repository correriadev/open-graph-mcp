import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

// Server-side proof of the ghost signal: a user observing cell X receives changeset.opened and the
// aggregated changeset.delta for a turn opened by ANOTHER user on X. The web canvas draws these as ghosts.
test("a user observing a cell sees another user's changeset ghost (opened + delta) via SSE", async () => {
  const s = startServer({ aggIntervalMs: 20 })
  try {
    const a = await register(s.url, "alice")
    const b = await register(s.url, "bob")

    // B observes cell ui:4
    const res = await fetch(`${s.url}/events?token=${b.token}&filter=cell:ui:4`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const seen: any[] = []
    ;(async () => {
      let buf = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        buf += decoder.decode(value, { stream: true })
        let cut
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, cut)
          buf = buf.slice(cut + 2)
          const line = raw.split("\n").find((l) => l.startsWith("data: "))
          if (line) seen.push(JSON.parse(line.slice(6)))
        }
      }
    })().catch(() => {})

    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:4"], intent: "ghost" })
    await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: { kind: "claim.add", payload: { id: "g1", subject: "s", domain: "ui", level: 4, refs: [] } } })

    // wait for the aggregator window to flush + delivery
    await new Promise((r) => setTimeout(r, 120))
    reader.cancel().catch(() => {})

    expect(seen.some((e) => e.kind === "changeset.opened" && e.payload.csId === csId)).toBe(true)
    expect(seen.some((e) => e.kind === "changeset.delta" && e.payload.csId === csId && e.payload.delta_count_since_last === 1)).toBe(true)
  } finally {
    s.stop()
  }
})
