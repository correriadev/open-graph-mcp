import { expect, test } from "bun:test"
import { startServer } from "../src/index"
import { callTool, readResource, register, tempRepo, bootstrapAs } from "./helpers"

/**
 * F3 — o gate incremental (`changeset.claim`) roda o roundtrip advisory contra
 * (claims commitadas + a nova), sem o que já foi ENCENADO no mesmo changeset aberto. Uma claim-chão
 * (nível 5, refs: []) encenada e, na chamada seguinte do MESMO turno, uma claim de nível 4 apontando
 * pra ela — o roundtrip local via `dangling-ref` num ref que o gate final (que monta o conjunto
 * completo) aceita sem reclamar segundos depois. Ver docs/CHANGELOG.md §F3.
 */
test("F3: claim-chão encenada no turno não dispara dangling-ref falso na claim seguinte do mesmo turno", async () => {
  const { root, cleanup } = tempRepo("fresh")
  const s = startServer({ repoPath: root, watch: false, domains: [{ pattern: "src/*", domain: "src" }] })
  try {
    const a = await register(s.url, "alice")
    await bootstrapAs(s.url, root, "bootstrapper")

    // ids/âncoras REAIS do grafo — não chutados.
    const snap = await readResource(s.url, "graph://snapshot")
    const nodes: { id: string; domain: string | null; level: string; file: string; anchor: string }[] = snap.graph.nodes
    expect(nodes.length).toBeGreaterThanOrEqual(2)
    const floor = nodes[0]!
    expect(floor.domain).toBeString()
    const domain = floor.domain as string

    const { csId } = await callTool(s.url, "changeset.open", {
      token: a.token,
      cells: [`${domain}:5`, `${domain}:4`],
      intent: "F3 staged-claims roundtrip",
    })

    // claim-chão nível 5: refs [], âncora verbatim do arquivo real.
    const floorClaim = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: floor.id, subject: floor.id, domain, level: 5, refs: [], anchor: floor.anchor, file: floor.file } },
    })
    expect(floorClaim.ok).toBe(true)
    expect(floorClaim.warnings).toEqual([])

    // claim nível 4 apontando pra claim-chão ENCENADA no mesmo turno (ainda não commitada).
    const p4Claim = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId,
      delta: { kind: "claim.add", payload: { id: "c_p4_over_floor", subject: "p4 over floor", domain, level: 4, refs: [floor.id] } },
    })
    expect(p4Claim.ok).toBe(true)
    // O CERNE do achado: NENHUM warning de dangling-ref sobre um ref que existe, só como delta
    // encenado no mesmo turno.
    expect(p4Claim.warnings).toEqual([])

    // O commit continua passando: o aviso de dangling-ref do achado F3 estava errado, não o commit.
    const commit = await callTool(s.url, "changeset.commit", { token: a.token, csId, intent: "F3 staged-claims roundtrip" })
    expect(commit.ok).toBe(true)
    expect(commit.admitSeq).toBeGreaterThan(0)

    // Guarda de regressão (3), turno à parte: um ref que NÃO existe em lugar nenhum — nem
    // commitado, nem encenado — AINDA dispara dangling-ref. Isto está corrigindo um falso positivo,
    // não desligando o aviso. (Turno separado e abortado: um dangling-ref real é bloqueio duro no
    // gate final, não cabe no mesmo commit que passa acima.)
    const openGhost = await callTool(s.url, "changeset.open", { token: a.token, cells: [`${domain}:4`], intent: "F3 guard dangling-ref" })
    const ghostClaim = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId: openGhost.csId,
      delta: { kind: "claim.add", payload: { id: "c_p4_ghost", subject: "p4 ghost ref", domain, level: 4, refs: ["totally-nonexistent-ref-xyz"] } },
    })
    expect(ghostClaim.ok).toBe(true)
    expect(ghostClaim.warnings.some((w: string) => w.includes("dangling-ref") && w.includes("totally-nonexistent-ref-xyz"))).toBe(true)
    await callTool(s.url, "changeset.abort", { token: a.token, csId: openGhost.csId })

    // Guarda de regressão (4), turno à parte: level-gap real — claim nível 2 apontando direto pra
    // claim nível 5 encenada no mesmo turno (distância 3, não 1) — continua avisado.
    const openGap = await callTool(s.url, "changeset.open", { token: a.token, cells: [`${domain}:5`, `${domain}:2`], intent: "F3 guard level-gap" })
    const floorClaim2 = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId: openGap.csId,
      delta: { kind: "claim.add", payload: { id: "c_floor2", subject: "floor2", domain, level: 5, refs: [] } },
    })
    expect(floorClaim2.ok).toBe(true)
    const gapClaim = await callTool(s.url, "changeset.claim", {
      token: a.token,
      csId: openGap.csId,
      delta: { kind: "claim.add", payload: { id: "c_p2_gap", subject: "p2 pointing at floor directly", domain, level: 2, refs: ["c_floor2"] } },
    })
    expect(gapClaim.ok).toBe(true)
    expect(gapClaim.warnings.some((w: string) => w.includes("level-gap"))).toBe(true)
    await callTool(s.url, "changeset.abort", { token: a.token, csId: openGap.csId })
  } finally {
    s.stop()
    cleanup()
  }
})
