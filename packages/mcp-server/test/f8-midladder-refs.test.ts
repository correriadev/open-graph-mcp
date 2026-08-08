/**
 * f8-midladder-refs.test.ts — F8 (docs/roadmap-server-beta): `refs` tinha DOIS contratos mutuamente
 * contraditórios para qualquer célula de meio-escada.
 *
 *   1. roundtrip.checkClaims exige nível ADJACENTE (|level(claim) - level(ref)| === 1) — GLOBAL, sobre
 *      o conjunto inteiro de claims.
 *   2. verifyIntegrity (chamado por finalGate com `metaIds`/`claimIds` ESCOPADOS à célula, via
 *      nodesOfCell/claimsOfCell) exigia que toda ref resolvesse DENTRO da mesma célula.
 *
 * Como (1) força a ref pra um nível adjacente, e célula = (domínio, nível), uma ref válida por (1)
 * aponta necessariamente pra OUTRA célula — e por isso sempre "danglava" por (2). Meio-escada nunca
 * fechava um caminho limpo até `authority.flip -> graph`; só passava via o truque de claim-chão (id de
 * claim === id de nó) que F4 tentou aposentar.
 *
 * A correção (verify.ts): separar QUE claims revisar (escopo da célula, correto) de contra QUE
 * universo de ids uma ref resolve (tem que ser GLOBAL). `finalGate` agora passa o conjunto agregado de
 * claims do changeset (existentes + novas, todas as células) como universo de resolução.
 *
 * Este arquivo reproduz EXATAMENTE o cenário do achado: uma célula de nível 4 (meio-escada), refs
 * apontando pra uma claim-raiz em nível 5 (adjacente, outra célula), NENHUMA claim com id de nó,
 * cobertura fechada via `covers` — e prova que o flip chega a `ok:true`.
 */
import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, register, tempRepo } from "./helpers"

test("F8: célula de meio-escada (nível 4) fecha authority.flip -> graph via refs para claim-raiz adjacente (outra célula), sem claim-chão", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const domain = "core"

    const { csId } = await callTool(s.url, "changeset.open", {
      token: a.token,
      cells: [`${domain}:5`, `${domain}:4`],
      intent: "F8 repro",
    })

    // Claim-raiz em nível 5 (extremo — refs: [] válido ali por roundtrip), sem tocar em nenhum nó.
    const root = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "raiz-do-modulo-core", subject: "raiz", domain, level: 5, refs: [] } },
    })
    expect(root.ok).toBe(true)

    // Duas claims de nível 4 (meio-escada), cada uma refs a claim-raiz (nível 5, ADJACENTE — outra
    // célula), cobrindo os "nós" via `covers` (não há nó real cadastrado nesta célula, então a
    // cobertura fecha trivialmente — o ponto do teste é a resolução de refs, não claimCoverage).
    const alpha = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "conhecimento-alpha", subject: "alpha", domain, level: 4, refs: ["raiz-do-modulo-core"], covers: ["alpha.ts"] } },
    })
    expect(alpha.ok).toBe(true)

    const beta = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "conhecimento-beta", subject: "beta", domain, level: 4, refs: ["raiz-do-modulo-core"], covers: ["beta.ts"] } },
    })
    expect(beta.ok).toBe(true)

    // Nenhuma claim tem id de nó — não é o truque da claim-chão que F4 tentou aposentar.
    expect(["raiz-do-modulo-core", "conhecimento-alpha", "conhecimento-beta"]).not.toContain("alpha.ts")
    expect(["raiz-do-modulo-core", "conhecimento-alpha", "conhecimento-beta"]).not.toContain("beta.ts")

    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "F8 repro" })
    expect(commit.ok).toBe(true)

    const flip = await callTool(s.url, "authority.flip", { token: a.token, cell: `${domain}:4`, to: "graph" })
    expect(flip.ok).toBe(true)
    expect(flip.reasons).toBeUndefined()

    const row = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", `${domain}:4`) as { value: string }
    expect(row.value).toBe("graph")
  } finally {
    s.stop()
  }
})

test("F8 guarda: ref para id inexistente em QUALQUER lugar continua dangling-ref mesmo com o universo global de resolução", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const domain = "coreguard"

    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: [`${domain}:4`], intent: "F8 guard" })

    const claim = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "mid-claim", subject: "mid", domain, level: 4, refs: ["nao-existe-em-lugar-nenhum"], covers: [] } },
    })
    expect(claim.ok).toBe(true) // incremental gate: advisory, não bloqueia

    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "F8 guard" })
    expect(commit.ok).toBe(false)
    expect(commit.reasons.join(" ")).toContain("dangling-ref")

    const row = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", `${domain}:4`)
    expect(row).toBeNull()
  } finally {
    s.stop()
  }
})

test("F8 guarda: caminho legado (claim-chão, id de claim === id de nó) continua funcionando", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root })
  try {
    const a = await register(s.url, "alice")
    const domain = "coreleg"
    s.state.db
      .query("INSERT INTO nodes (tenant_id,id,domain,level,file,anchor) VALUES (?,?,?,?,?,?)")
      .run("default", `${domain}-node`, domain, "P4", "src/audit.ts", "adversarialAudit")
    const nodeId = `${domain}-node`

    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: [`${domain}:4`, `${domain}:5`], intent: "F8 legacy" })

    const floor = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: nodeId, subject: nodeId, domain, level: 5, refs: [], anchor: "adversarialAudit", file: "src/audit.ts" } },
    })
    expect(floor.ok).toBe(true)

    const upper = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: `${domain}-upper`, subject: "upper", domain, level: 4, refs: [nodeId] } },
    })
    expect(upper.ok).toBe(true)

    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "F8 legacy" })
    expect(commit.ok).toBe(true)

    const flip = await callTool(s.url, "authority.flip", { token: a.token, cell: `${domain}:4`, to: "graph" })
    expect(flip.ok).toBe(true)
  } finally {
    s.stop()
    cleanup()
  }
})

test("F8 guarda: cobertura parcial na célula continua recusando o flip mesmo com resolução global de refs", async () => {
  const s = startServer()
  try {
    const a = await register(s.url, "alice")
    const domain = "corepartial"
    s.state.db
      .query("INSERT INTO nodes (tenant_id,id,domain,level,file,anchor) VALUES (?,?,?,?,?,?)")
      .run("default", `${domain}-node1`, domain, "P4", "src/a.ts", "anchorA")
    s.state.db
      .query("INSERT INTO nodes (tenant_id,id,domain,level,file,anchor) VALUES (?,?,?,?,?,?)")
      .run("default", `${domain}-node2`, domain, "P4", "src/b.ts", "anchorB")

    const { csId } = await callTool(s.url, "changeset.open", { token: a.token, cells: [`${domain}:5`, `${domain}:4`], intent: "F8 partial" })

    const root = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: `${domain}-root`, subject: "raiz", domain, level: 5, refs: [] } },
    })
    expect(root.ok).toBe(true)

    // Só cobre node1 — node2 fica de fora, de propósito.
    const claim = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: `${domain}-claim`, subject: "mid", domain, level: 4, refs: [`${domain}-root`], covers: [`${domain}-node1`] } },
    })
    expect(claim.ok).toBe(true)

    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "F8 partial" })
    expect(commit.ok).toBe(true) // commit em si não gateia cobertura de célula fora de flip

    const flip = await callTool(s.url, "authority.flip", { token: a.token, cell: `${domain}:4`, to: "graph" })
    expect(flip.ok).toBe(false)
    expect(flip.reasons.join(" ")).toContain("coverage not balanced")

    const row = s.state.db.query("SELECT value FROM authority WHERE tenant_id = ? AND cell = ?").get("default", `${domain}:4`)
    expect(row).toBeNull()
  } finally {
    s.stop()
  }
})
