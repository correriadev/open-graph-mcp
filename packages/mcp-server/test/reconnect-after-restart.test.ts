import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { startServer } from "../src/index"
import { callTool, openSse, register } from "./helpers"

// Fase 3 §9.1 / §10.9: server restart wipes in-memory tokens/sessions/presence (spec §3.1/§9), but the
// SQLite state (changesets, locks, events) is durable and lives in stateDir — surviving a process
// restart that reuses the same directory. This test drives a real process restart: two independent
// `startServer` calls sharing one stateDir, stopping the first before starting the second.
test("reconnect after restart: presence is gone, server.restarted is delivered, durable changesets survive", async () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), "og-restart-"))
  try {
    const s1 = startServer({ stateDir, focusDebounceMs: 10 })
    const alice = await register(s1.url, "alice")
    const sse1 = await openSse(s1.url, 0, alice.token)
    const aliceSessionId = sse1.events[0].sessionId

    const focusResult = await callTool(s1.url, "presence.focus", { token: alice.token, sessionId: aliceSessionId, cell: "ui:4" })
    expect(focusResult.ok).toBe(true)
    await sse1.waitFor((e) => e.kind === "user.focused") // let the debounce settle before we tear anything down

    const { csId } = await callTool(s1.url, "changeset.open", { token: alice.token, cells: ["ui:9"], intent: "durable across restart" })
    expect(csId).toBeTruthy()

    sse1.close()
    s1.stop() // real process-restart simulation: tokens/sessions/presence (in-memory) are gone after this

    const s2 = startServer({ stateDir, focusDebounceMs: 10 }) // same stateDir: SQLite durable state survives
    try {
      // Alice's client still holds the pre-restart token — presenting it is exactly what a reconnecting
      // client does. D10-lite: esse token AGORA continua válido (foi hidratado do SQLite), mas veio de
      // um processo anterior (`staleBoot`), e é isso que o servidor usa para saber "esta conexão vem
      // depois de um restart" — a credencial sobreviveu, a presença não. Ver sse.ts `restartPending`.
      const sse2 = await openSse(s2.url, 0, alice.token)
      const restarted = await sse2.waitFor((e) => e.kind === "server.restarted")
      expect(restarted).toBeTruthy()

      // Presence is empty — nobody re-declared focus yet (spec §9.1: no server-side auto-refocus).
      // Re-registrar continua funcionando e continua devolvendo o MESMO userId (determinístico por
      // tenant+name); depois do D10-lite ele deixou de ser obrigatório, mas segue sendo válido — é o
      // caminho de recuperação de quem perdeu o token ou teve o SQLite apagado.
      const alice2 = await register(s2.url, "alice")
      expect(alice2.userId).toBe(alice.userId)
      const who = await callTool(s2.url, "presence.who", { token: alice2.token })
      expect(who.users).toHaveLength(0)

      // Durable changeset opened before the restart is still queryable via changeset.list_mine —
      // SQLite (state.sqlite in stateDir) survived; only the in-memory token/session/presence layer didn't.
      const mine = await callTool(s2.url, "changeset.list_mine", { token: alice2.token })
      expect(mine.changesets.map((c: any) => c.csId)).toContain(csId)

      // Client must explicitly re-declare focus (no auto-refocus) — this now succeeds against the NEW
      // process with the NEW token/sessionId.
      const aliceSessionId2 = sse2.events[0].sessionId
      const refocus = await callTool(s2.url, "presence.focus", { token: alice2.token, sessionId: aliceSessionId2, cell: "ui:4" })
      expect(refocus.ok).toBe(true)
      const who2 = await callTool(s2.url, "presence.who", { token: alice2.token, cell: "ui:4" })
      expect(who2.users.map((u: any) => u.id)).toEqual([alice2.userId])

      sse2.close()
    } finally {
      s2.stop()
    }
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
})
