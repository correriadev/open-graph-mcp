/**
 * drift-target-repo.test.ts — QA-7 Fase 5: os mesmos dois cenários de drift/watch de
 * subscribe-drift.test.ts / broadcast.test.ts, mas contra a CÓPIA do repo-alvo (~186 arquivos,
 * árvore real de diretórios) em vez da fixture plana de 3 arquivos — o watcher passa a percorrer
 * `walkSource`/`dirtyFiles` numa escala e profundidade que a fixture nunca exercita.
 *
 * Investigação prévia (QA-7 Fase 5, registrada no relatório da tarefa): as duas falhas históricas
 * de timeout em subscribe-drift.test.ts / broadcast.test.ts eram consequência do bug de path
 * separator (P2) — id de nó com `\` no Windows nunca casava com o alvo do evento — e não
 * flakiness de timing. `tick()` é síncrono/determinístico (sem fs.watch, sem setInterval de
 * produção nestes testes); rodado 10x consecutivas após o fix, 0 falhas. Os testes abaixo herdam
 * o mesmo padrão determinístico (QD5: nunca sleep calibrado no relógio de produção).
 */
import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { startServer } from "../src/index"
import { callTool, openSse, bootstrapAs } from "./helpers"
import { prepareTargetRepo, targetRepoAvailable, TARGET_DOMAINS } from "./fixtures/target-repo"

// arquivo real sob sdk/src usado como alvo de edição — âncora é a 1ª linha não-vazia (esqueleto,
// graph-bootstrap.ts:71). excerptCheck (extract.ts:182-184) é `content.includes(excerpt)` — um
// SUBSTRING verbatim em QUALQUER LUGAR do arquivo basta p/ manter "fresh". `DebugContext.ts`
// começa com `/**` — um token genérico que reaparece em outros blocos JSDoc do mesmo arquivo —
// então só trocar a 1ª linha não derruba a âncora (achado durante a escrita deste teste: o
// substring sobrevivia em outro comentário mais abaixo). Por isso a substituição é total: o
// conteúdo novo não compartilha nenhuma linha com o original, igual ao padrão já usado em
// subscribe-drift.test.ts / broadcast.test.ts contra a fixture `fresh`.
const ANCHORED_FILE = "sdk/src/cli/DebugContext.ts"
const REPLACEMENT_CONTENT = "export class DebugContextRenamed {\n  static enabled = false\n}\n"

test.skipIf(!targetRepoAvailable())(
  "editing an anchored source file under sdk/src emits drift.node to a subscribed client (repo-alvo real)",
  async () => {
    const { root, cleanup } = prepareTargetRepo()
    const s = startServer({ repoPath: root, watch: false, domains: TARGET_DOMAINS })
    try {
      await bootstrapAs(s.url, root)
      const sse = await openSse(s.url)

      const abs = path.join(root, ...ANCHORED_FILE.split("/"))
      writeFileSync(abs, REPLACEMENT_CONTENT)
      await s.tick()

      const evt = await sse.waitFor((e) => e.kind === "drift.node" && e.target === ANCHORED_FILE)
      expect(evt.schemaVersion).toBe(1)
      expect(evt.seq).toBeGreaterThan(0)
      expect(evt.graphId).toBeString()
      expect(evt.payload.status).toBe("stale")
      sse.close()
    } finally {
      s.stop()
      cleanup()
    }
  },
)

test.skipIf(!targetRepoAvailable())(
  "two connected clients receive the same drift event in the same tick (repo-alvo real)",
  async () => {
    const { root, cleanup } = prepareTargetRepo()
    const s = startServer({ repoPath: root, watch: false, domains: TARGET_DOMAINS })
    try {
      await bootstrapAs(s.url, root)
      const a = await openSse(s.url)
      const b = await openSse(s.url)

      const abs = path.join(root, ...ANCHORED_FILE.split("/"))
      writeFileSync(abs, REPLACEMENT_CONTENT)
      await s.tick()

      const isDrift = (e: any) => e.kind === "drift.node" && e.target === ANCHORED_FILE
      const [evtA, evtB] = await Promise.all([a.waitFor(isDrift), b.waitFor(isDrift)])
      expect(evtA.seq).toBe(evtB.seq)
      expect(evtA.ts).toBe(evtB.ts)
      a.close()
      b.close()
    } finally {
      s.stop()
      cleanup()
    }
  },
)
