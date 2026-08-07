/**
 * watch-tenant-attribution.test.ts — `state.lastTickHadEvents` (state.ts) é um único boolean GLOBAL,
 * mas `watch-bridge.ts::tick(state, tenant)` é escopado por tenant. Dois tenants ticando intercalados
 * cruzam o sinal: um tick sem drift de um tenant pode emitir `watch.converged` porque OUTRO tenant
 * teve eventos no tick anterior — e o inverso, um tenant que genuinamente convergiu pode ter seu
 * `watch.converged` engolido porque o flag global já foi consumido por outro tenant no meio.
 *
 * Pré-classificado Tier 2 (docs/roadmap-server-beta/00-scope-sb-0-hardening-servidor.md §4): o campo
 * mora em `state.ts`, CONGELADO para todos os streams — o fix certo é escopar `lastTickHadEvents` por
 * tenant (ex.: `Map<string, boolean>`, como `driftStale`), mas isso é mudança de shape de
 * `ServerState` e este stream não pode tocar `state.ts`. Reportado, não corrigido.
 */
import { expect, test } from "bun:test"
import { writeFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { startServer } from "../src/index"
import { tick } from "../src/watch-bridge"
import { callTool, readResource, register, tempRepo } from "./helpers"

const history = (base: string, token: string) => readResource(base, "graph://history?limit=50", token)

test("REPORT-F1: um tick sem drift de um tenant pode herdar (ou engolir) watch.converged de OUTRO tenant, por causa do flag global lastTickHadEvents", async () => {
  const repoA = tempRepo("fresh")
  const repoB = tempRepo("fresh")
  const s = startServer({ watch: false })
  try {
    const acme = await register(s.url, "alice", "acme")
    const globex = await register(s.url, "bob", "globex")
    await callTool(s.url, "graph.bootstrap", { token: acme.token, repoPath: repoA.root })
    await callTool(s.url, "graph.bootstrap", { token: globex.token, repoPath: repoB.root })

    // Provoca drift SÓ em acme: quebra a âncora de src/audit.ts (repoA).
    const originalContent = readFileSync(path.join(repoA.root, "src", "audit.ts"), "utf8")
    writeFileSync(path.join(repoA.root, "src", "audit.ts"), "export function renamedAudit(input) {\n  return refinement(input)\n}\n")

    const acmeEvents1 = await tick(s.state, "acme")
    expect(acmeEvents1.length).toBeGreaterThan(0) // drift.node real em acme
    expect(s.state.lastTickHadEvents).toBe(true) // flag GLOBAL, setado pelo tick de acme

    // globex nunca teve drift — seu repo (repoB) está intacto — mas o tick dele vê o flag global
    // ainda `true` (deixado por acme) e por isso emite watch.converged NO TENANT ERRADO.
    const globexEvents = await tick(s.state, "globex")
    expect(globexEvents.length).toBe(0) // globex genuinamente não teve nada pra reportar
    const globexHist = await history(s.url, globex.token)
    const globexHasConverged = globexHist.events.some((e: { kind: string }) => e.kind === "watch.converged")
    // BUG reproduzido: watch.converged aparece no log de globex, que nunca teve drift/healed algum.
    expect(globexHasConverged).toBe(true)
    expect(s.state.lastTickHadEvents).toBe(false) // e o flag global foi consumido pelo tenant ERRADO

    // acme continua com o nó em drift (nada mudou nele desde acmeEvents1) — o próximo tick de acme
    // é exatamente "a primeira rodada quieta depois de atividade", e É ELE quem deveria receber
    // watch.converged (sinal "nada de novo agora"). Mas o flag já foi zerado pelo tick de globex acima,
    // então acme não recebe nada: seu watch.converged legítimo foi engolido.
    const acmeEvents2 = await tick(s.state, "acme")
    expect(acmeEvents2.length).toBe(0) // nó já estava stale — nada NOVO neste tick
    const acmeHist = await history(s.url, acme.token)
    const acmeHasConverged = acmeHist.events.some((e: { kind: string }) => e.kind === "watch.converged")
    expect(acmeHasConverged).toBe(false) // devia ser true — engolido pelo cruzamento do flag global

    void originalContent // fixture não precisa ser restaurada (tmpdir descartável, cleanup abaixo)
  } finally {
    s.stop()
    repoA.cleanup()
    repoB.cleanup()
  }
})

test.todo("REPORT-F1: watch.converged deveria ser atribuído SEMPRE ao tenant correto — lastTickHadEvents precisa virar Map<tenant, boolean> em state.ts (arquivo congelado; escalado, não corrigido por este stream)")
