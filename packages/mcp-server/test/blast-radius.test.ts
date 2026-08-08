/**
 * blast-radius.test.ts — raio de impacto REAL de um changeset.
 *
 * `blastRadius` foi reimplementado no servidor (gates.ts) ao deletar o `changeset-store.ts`
 * vendorado — que era file-based, sem tenant/token/lock/transação. A versão vendorada computava o
 * raio a partir de um Changeset em memória; esta parte dos deltas persistidos, e faz UNIÃO com as
 * células declaradas no lock.
 *
 * MP-3 (corrigido em claimOrOpenCs, changeset.ts): `blast_cells` era gravado uma única vez, na
 * CRIAÇÃO do changeset, e nunca recalculado. Como um turno aberto pode ser EXPANDIDO com células
 * novas (changesetOpen, caminho `mineCs`), o registro de auditoria ficava subdeclarado — abrir com
 * ["ui:5"] e reabrir com ["ui:5","auth:5"] reusava o csId, trancava auth:5, o gate de escopo aceitava
 * claims lá, mas `blast_cells` continuava ["ui:5"]. Corrigido reescrevendo `blast_cells` a partir da
 * tabela `locks` (verdade real) na MESMA transação que grava a trava nova — não só no commit, porque
 * um turno que expira por TTL nunca passa por lá (ver changeset-scope-and-contention.test.ts).
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, readResource, register } from "./helpers"
import { blastRadius } from "../src/gates"

const claim = (id: string, domain: string, level: number, refs: string[] = []) => ({
  kind: "claim.add" as const,
  payload: { id, subject: id, domain, level, refs },
})

test("blastRadius (puro): une células declaradas, células das claims e células de authority.flip", () => {
  const deltas = [claim("c1", "ui", 5), claim("c2", "auth", 4), { kind: "authority.flip" as const, payload: { cell: "billing:3", to: "graph" } }]
  const blast = blastRadius(deltas, ["ui:5"])
  expect(blast.cells).toEqual(["auth:4", "billing:3", "ui:5"]) // ordenado, dedupado
  expect(blast.claimCount).toBe(2) // authority.flip não é claim

  // canonicaliza "P<n>" p/ não duplicar a mesma célula sob duas grafias
  expect(blastRadius([], ["ui:P5", "ui:5"]).cells).toEqual(["ui:5"])
  // sem deltas e sem declaradas: vazio, não explode
  expect(blastRadius([], [])).toEqual({ cells: [], claimCount: 0 })
})

test("uma claim FORA de toda célula trancada é bloqueada pelo gate de escopo — o raio nunca cresce por aí", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:5"], intent: "escopo" })
    const fora = await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: claim("x1", "auth", 5) })
    expect(fora.ok).toBe(false)
    expect(fora.reasons.some((r: string) => r.includes("out of turn scope"))).toBe(true)
  } finally {
    s.stop()
  }
})

test("commit registra o raio REAL quando o turno é EXPANDIDO com uma célula nova", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:5"], intent: "raio real" })
    // expande o MESMO turno: inclui a célula já trancada por mim + uma nova → reusa o csId e tranca
    // auth:5; blast_cells é reescrito NA HORA (MP-3) para refletir as duas.
    const again = await callTool(s.url, "changeset.open", { token: a.token, cells: ["ui:5", "auth:5"], intent: "raio real" })
    expect(again.csId).toBe(csId)

    expect((await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: claim("b1", "ui", 5) })).ok).toBe(true)
    expect((await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: claim("b2", "auth", 5) })).ok).toBe(true)

    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "raio real" })
    expect(commit.ok).toBe(true)

    // registro de auditoria persistido: as DUAS células, não só a trancada
    const row = s.state.db.query("SELECT blast_cells FROM changesets WHERE tenant_id = ? AND id = ?").get("default", csId) as { blast_cells: string }
    expect(JSON.parse(row.blast_cells)).toEqual(["auth:5", "ui:5"])

    // e o evento nomeia as células, não só a contagem — um número sozinho não é revisável
    const hist = await readResource(s.url, "graph://history?limit=100", a.token)
    const committed = hist.events.find((e: { kind: string }) => e.kind === "changeset.committed")
    expect(committed.payload.blastCells).toEqual(["auth:5", "ui:5"])
    expect(committed.payload.blastRadius).toBe(2) // antes seria 1 (só a célula declarada)
    expect(committed.payload.claimCount).toBe(2)
    // `cells` (as TRANCADAS) também mostra as duas agora — MP-3: antes desta correção o turno
    // expandido reportava só ["ui:5"] aqui, subdeclarando a célula auth:5 que estava genuinamente
    // trancada (e cujo lock era liberado no mesmo commit). Ambos os campos convergem porque
    // `blast_cells` deixou de ser uma segunda cópia: `cells` já é o raio real no momento da leitura.
    expect(committed.payload.cells).toEqual(["auth:5", "ui:5"])
  } finally {
    s.stop()
  }
})
