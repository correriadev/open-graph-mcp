/**
 * watch-tenant-attribution.test.ts — `state.lastTickHadEvents` era um único boolean GLOBAL do
 * processo, mas `watch-bridge.ts::tick(state, tenant)` é escopado por tenant. Dois tenants ticando
 * intercalados cruzavam o sinal: um tick sem drift de um tenant emitia `watch.converged` porque
 * OUTRO tenant tivera eventos no tick anterior — e, no mesmo movimento, o tenant que genuinamente
 * convergiu tinha o seu `watch.converged` engolido.
 *
 * Reportado como REPORT-F1 (Tier 2 para o stream, porque o campo mora em `state.ts`, congelado) e
 * corrigido pelo integrador serialmente: `lastTickHadEvents` virou `Map<tenant, boolean>`, como
 * `driftStale`. Este arquivo agora afirma o comportamento CORRETO nos dois sentidos.
 */
import { expect, test } from "bun:test"
import { writeFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { startServer } from "../src/index"
import { tick } from "../src/watch-bridge"
import { callTool, readResource, register, tempRepo } from "./helpers"

const history = (base: string, token: string) => readResource(base, "graph://history?limit=50", token)
const hasConverged = (h: { events: { kind: string }[] }) => h.events.some((e) => e.kind === "watch.converged")

test("watch.converged e atribuido ao tenant que de fato convergiu, e nao vaza pro tenant vizinho", async () => {
  const repoA = tempRepo("fresh")
  const repoB = tempRepo("fresh")
  const s = startServer({ watch: false })
  try {
    const acme = await register(s.url, "alice", "acme")
    const globex = await register(s.url, "bob", "globex")
    await callTool(s.url, "graph.bootstrap", { token: acme.token, repoPath: repoA.root })
    await callTool(s.url, "graph.bootstrap", { token: globex.token, repoPath: repoB.root })

    // Provoca drift SÓ em acme: quebra a âncora de src/audit.ts (repoA).
    void readFileSync(path.join(repoA.root, "src", "audit.ts"), "utf8")
    writeFileSync(path.join(repoA.root, "src", "audit.ts"), "export function renamedAudit(input) {\n  return refinement(input)\n}\n")

    const acmeEvents1 = await tick(s.state, "acme")
    expect(acmeEvents1.length).toBeGreaterThan(0) // drift.node real em acme
    expect(s.state.lastTickHadEvents.get("acme")).toBe(true)
    expect(s.state.lastTickHadEvents.get("globex")).toBeUndefined() // o tick de acme nao tocou globex

    // globex nunca teve drift — seu repo (repoB) esta intacto. Um tick quieto dele nao pode inventar
    // um watch.converged herdado da atividade de acme.
    const globexEvents = await tick(s.state, "globex")
    expect(globexEvents.length).toBe(0)
    expect(hasConverged(await history(s.url, globex.token))).toBe(false)
    expect(s.state.lastTickHadEvents.get("acme")).toBe(true) // e o flag de acme continua intacto

    // acme continua com o no em drift (nada mudou desde acmeEvents1) — o proximo tick de acme e
    // exatamente "a primeira rodada quieta depois de atividade", e E ELE quem recebe watch.converged.
    const acmeEvents2 = await tick(s.state, "acme")
    expect(acmeEvents2.length).toBe(0)
    expect(hasConverged(await history(s.url, acme.token))).toBe(true)
    expect(s.state.lastTickHadEvents.get("acme")).toBe(false) // consumido pelo tenant certo

    // ...e uma segunda rodada quieta nao repete o sinal (converged e uma TRANSICAO, nao um heartbeat).
    await tick(s.state, "acme")
    const acmeHist = await history(s.url, acme.token)
    expect(acmeHist.events.filter((e: { kind: string }) => e.kind === "watch.converged")).toHaveLength(1)

    // globex, que nunca teve evento nenhum, segue sem converged do começo ao fim.
    expect(hasConverged(await history(s.url, globex.token))).toBe(false)
  } finally {
    s.stop()
    repoA.cleanup()
    repoB.cleanup()
  }
})
