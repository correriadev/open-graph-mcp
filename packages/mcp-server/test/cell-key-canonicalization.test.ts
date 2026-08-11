/**
 * cell-key-canonicalization.test.ts — F1 (CRÍTICO), docs/CHANGELOG.md
 *
 * `nodesOfCell` (gates.ts) tirava o prefixo "P" do nível do NÓ mas comparava contra a célula CRUA:
 * uma célula escrita "domain:P4" (grafia natural pra quem lê "nível P4" no grafo) nunca batia com
 * nível de nó "4" (já sem "P") e devolvia [] em silêncio. `claimCoverage` recebendo `meta: []` some
 * `balanced: true` vacuamente — `authority.flip` passava para "graph" numa célula com nó descoberto
 * e ZERO claims, contanto que a célula fosse escrita com "P". Evidência ao vivo no relatório:
 *   flip billing:P4 -> graph   {"ok":true,"admitSeq":30}          <- APROVADO com zero claims
 *   flip billing:4  -> graph   {"ok":false,"reasons":["coverage not balanced ..."]}
 *
 * Fix: `nodesOfCell` agora canonicaliza a CÉLULA (reusa `canonicalCell`, o mesmo helper já usado por
 * `blastRadius`/`finalGate`) antes de comparar. `claimsOfCell` ganhou o mesmo tratamento — sem isso,
 * `nodesOfCell` já achava o nó certo pra grafia "domain:P4", mas `claimCoverage` continuava cego às
 * claims genuínas da célula (elas são sempre gravadas com level numérico — normalizeClaimLevel — então
 * a comparação de string crua `cellOfClaim(c) === "domain:P4"` nunca batia), quebrando o caminho FELIZ
 * (flip legítimo com cobertura fechada) na grafia com "P". Ambas as funções vivem neste arquivo
 * (gates.ts) e são a única mudança deste fix.
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { nodesOfCell, type NodeSnapshot } from "../src/gates"
import { callTool, readResource, register, tempRepo } from "./helpers"

// ── 1. nodesOfCell puro: as duas grafias devolvem os MESMOS nós ────────────────────────────────

test("nodesOfCell: 'domain:P4' e 'domain:4' resolvem para os mesmos nós (nível do nó é sempre 'P<n>')", () => {
  const nodes: NodeSnapshot[] = [
    { id: "n1", domain: "auth", level: 4, file: "a.ts", anchor: "x" },
    { id: "n2", domain: "auth", level: 5, file: "b.ts", anchor: "y" }, // nível diferente — não deve entrar
    { id: "n3", domain: "billing", level: 4, file: "c.ts", anchor: "z" }, // domínio diferente — não deve entrar
  ]
  const viaPrefixed = nodesOfCell(nodes, "auth:P4")
  const viaBare = nodesOfCell(nodes, "auth:4")
  expect(viaPrefixed.map((n) => n.id)).toEqual(["n1"])
  expect(viaPrefixed).toEqual(viaBare)
})

test("nodesOfCell: domínio contendo ':' continua resolvido pelo lastIndexOf, nas duas grafias", () => {
  const nodes: NodeSnapshot[] = [{ id: "n1", domain: "scope:sub", level: 3, file: "a.ts", anchor: "x" }]
  expect(nodesOfCell(nodes, "scope:sub:P3").map((n) => n.id)).toEqual(["n1"])
  expect(nodesOfCell(nodes, "scope:sub:3").map((n) => n.id)).toEqual(["n1"])
})

test("nodesOfCell: célula malformada (sem ':') preserva o comportamento pré-existente — nada inventado", () => {
  const nodes: NodeSnapshot[] = [{ id: "n1", domain: "auth", level: 4, file: "a.ts", anchor: "x" }]
  // canonicalCell devolve a string crua quando não há ":"; nodesOfCell então repete o próprio
  // cálculo pré-fix (cut = -1) sobre ela — o mesmo resultado esquisito de antes, não um novo caso.
  expect(nodesOfCell(nodes, "no-colon-here")).toEqual([])
})

// ── helpers locais só deste arquivo: insere um nó real na tabela `nodes`, apontando pra um arquivo
// verdadeiro do tempRepo "fresh" (src/audit.ts, contém verbatim "adversarialAudit"), pra exercitar
// verify/roundtrip/readFile de ponta a ponta, exatamente como changeset.commit faz em produção. ──

function insertNode(s: { state: { db: { query: (sql: string) => { run: (...args: unknown[]) => unknown } } } }, id: string, domain: string, level: string, file: string, anchor: string): void {
  s.state.db
    .query("INSERT INTO nodes (tenant_id,id,domain,level,file,anchor) VALUES (?,?,?,?,?,?)")
    .run("default", id, domain, level, file, anchor)
}

// ── 2. Teste de nível de PRODUTO: authority.flip pra 'graph' numa célula com nó descoberto e SEM
// claims deve ser RECUSADO com "coverage not balanced" — nas DUAS grafias. Este é o teste que prova
// que o gate não falha mais aberto (antes do fix, a grafia "P4" era APROVADA com zero claims). ──

test("authority.flip é recusado por cobertura ausente na grafia 'domain:P4' (antes: aprovado silenciosamente)", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    insertNode(s, "rejectP4-node", "rejectp4", "P4", "src/audit.ts", "adversarialAudit")

    const flip = await callTool(s.url, "authority.flip", { token: a.token, cell: "rejectp4:P4", to: "graph" })
    expect(flip.ok).toBe(false)
    expect(flip.reasons.join(" ")).toContain("coverage not balanced")
    expect(flip.reasons.join(" ")).toContain("1 node(s) without claims")

    // Nenhuma autoridade foi gravada — o cell não virou beta às cegas.
    const row = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", "rejectp4:P4")
    expect(row).toBeNull()
  } finally {
    s.stop()
  }
})

test("authority.flip é recusado por cobertura ausente na grafia 'domain:4' (mesmo nó, grafia bare)", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    insertNode(s, "rejectBare-node", "rejectbare", "P4", "src/audit.ts", "adversarialAudit")

    const flip = await callTool(s.url, "authority.flip", { token: a.token, cell: "rejectbare:4", to: "graph" })
    expect(flip.ok).toBe(false)
    expect(flip.reasons.join(" ")).toContain("coverage not balanced")
    expect(flip.reasons.join(" ")).toContain("1 node(s) without claims")

    const row = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", "rejectbare:4")
    expect(row).toBeNull()
  } finally {
    s.stop()
  }
})

// ── 3. graph://cell/{key}: nodeCount correto na grafia canônica bare ("domain:4"), que é a única
// forma que os deltas do servidor (cellOfClaim/blastRadius) produzem internamente. A grafia
// prefixada "domain:P4" NESTE resource é um achado À PARTE, fora do escopo deste fix: `cellState`
// (resources.ts) não chama `nodesOfCell` — reimplementa o próprio parse de "domain:level" do zero,
// com a convenção OPOSTA (espera nível bare e prefixa "P" internamente pra comparar), então herda a
// MESMA classe de bug F1 mas num arquivo que não é meu (gates.ts é meu; resources.ts não). Confirmado
// empiricamente abaixo: bare funciona, "P"-prefixado no resource ainda retorna 0 nós. Reportado, não
// consertado aqui — resources.ts está sendo mexido por outro workstream nesta mesma janela. ──

// `cellState` (resources.ts) lê do grafo HOT em memória (`tenantGraph(state,tenant).graph.nodes`),
// não da tabela SQLite `nodes` (essa é lida por `readNodes`, usado pelos gates) — então aqui, ao
// contrário dos testes acima, semeia-se `s.state.graphs` diretamente (mesma técnica de
// resources-cell-domain.test.ts) em vez de inserir na tabela `nodes`.
function seedHotGraph(s: { state: { graphs: Map<string, unknown> } }, id: string, domain: string, level: string): void {
  s.state.graphs.set("default", {
    graph: {
      schemaVersion: 1,
      repo: "fake",
      generatedAt: new Date().toISOString(),
      stats: { nodes: 1, edges: 0, claims: 0, domains: 1 },
      nodes: [{ id, file: "src/audit.ts", domain, level, claims: [], anchor: "adversarialAudit", kind: "File", responsibility: id, exposed: false, confidence: null, overclaim: false }],
      edges: [],
    },
    graphId: "fake-graph-id",
    pipeline: "indexed",
    bootstrappedAt: new Date().toISOString(),
    repoPath: null,
  })
}

test("graph://cell/{key}: nodeCount correto na grafia canônica bare — regressão OK após o fix de gates.ts", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    seedHotGraph(s, "cellRes-node", "cellresdom", "P4")

    const bare = await readResource(s.url, "graph://cell/cellresdom:4", a.token)
    expect(bare.nodeCount).toBe(1)
  } finally {
    s.stop()
  }
})

test("graph://cell/{key}: as duas grafias devolvem a MESMA célula — resources.ts tinha a terceira cópia do bug F1", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    seedHotGraph(s, "cellResP4-node", "cellresp4dom", "P4")

    // `cellState` (resources.ts) reimplementava o parse de "domain:level" com a convenção INVERTIDA
    // em relação a `nodesOfCell` — nível cru e `P` prefixado na comparação —, então "…:P4" virava
    // `"P4" === "PP4"` e o recurso devolvia `nodeCount: 0` para uma célula povoada. Como este caminho
    // nem chama `nodesOfCell`, corrigir gates.ts sozinho não o alcançava: a correção foi passar as
    // três cópias pela canonicalização única exportada de gates.ts.
    const prefixed = await readResource(s.url, "graph://cell/cellresp4dom:P4", a.token)
    const bare = await readResource(s.url, "graph://cell/cellresp4dom:4", a.token)
    expect(prefixed.nodeCount).toBe(1)
    expect(prefixed.nodes).toEqual(bare.nodes)
    expect(prefixed.authority).toBe(bare.authority)
  } finally {
    s.stop()
  }
})

// ── 4. Caminho feliz: flip legítimo com cobertura FECHADA continua PASSANDO — não quebrar o caso
// comum. Segue o padrão do próprio transport.ts (descrição da tool changeset.claim): uma claim-chão
// no nível 5 cujo id É o id do nó (refs: [], âncora verbatim do arquivo-chão), e uma claim de nível 4
// com refs: ["<id do nó>"] — sem a claim-chão, o ref aponta pra um id que não existe no CONJUNTO DE
// CLAIMS (roundtripScoped só enxerga claim↔claim, não claim↔nó) e o commit trava com dangling-ref. ──

async function happyPathFlip(s: { url: string }, domain: string, flipCell: string, claimCell: string): Promise<any> {
  const a = await register(s.url, "alice-" + domain)
  insertNode(s, `${domain}-node`, domain, "P4", "src/audit.ts", "adversarialAudit")
  const nodeId = `${domain}-node`

  const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: [flipCell, `${domain}:5`], intent: "happy path" })

  // claim-chão no nível 5: id == id do nó, refs: [], âncora verbatim do arquivo-chão.
  const floor = await callTool(s.url, "changeset.claim", {
    token: a.token,
    csId,
    delta: { kind: "claim.add", payload: { id: nodeId, subject: nodeId, domain, level: 5, refs: [], anchor: "adversarialAudit", file: "src/audit.ts" } },
  })
  expect(floor.ok).toBe(true)

  // claim de nível 4 aponta pra claim-chão (que compartilha id com o nó) — fecha cobertura E roundtrip.
  const cov = await callTool(s.url, "changeset.claim", {
    token: a.token,
    csId,
    delta: { kind: "claim.add", payload: { id: `${domain}-cov`, subject: `${domain}-cov`, domain, level: 4, refs: [nodeId] } },
  })
  expect(cov.ok).toBe(true)

  const flip = await callTool(s.url, "changeset.claim", { token: a.token, csId, delta: { kind: "authority.flip", payload: { cell: flipCell, to: "graph" } } })
  expect(flip.ok).toBe(true)

  return callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "happy path" })
}

test("flip legítimo (cobertura fechada) PASSA na grafia bare 'domain:4' — não quebrou o caminho feliz", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root })
  try {
    const commit = await happyPathFlip(s, "passbare", "passbare:4", "passbare:4")
    expect(commit.ok).toBe(true)
    const row = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", "passbare:4") as { value: string }
    expect(row.value).toBe("graph")
  } finally {
    s.stop()
    cleanup()
  }
})

test("flip legítimo (cobertura fechada) PASSA na grafia 'domain:P4' — claimsOfCell precisava do mesmo fix pra não cegar a cobertura genuína", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root })
  try {
    const commit = await happyPathFlip(s, "passp4", "passp4:P4", "passp4:P4")
    expect(commit.ok).toBe(true)

    // F1/F7: a autoridade é gravada sob a chave CANÔNICA, mesmo tendo sido pedida como "…:P4".
    // Uma linha só — antes, as duas grafias produziriam duas linhas para a mesma célula, e a mesma
    // célula podia ler "graph" numa e "source" na outra.
    const rows = s.state.db.query("SELECT cell, value FROM authority WHERE tenant_id = ? AND cell LIKE 'passp4:%'").all("default") as { cell: string; value: string }[]
    expect(rows).toEqual([{ cell: "passp4:4", value: "graph" }])
  } finally {
    s.stop()
    cleanup()
  }
})
