/**
 * merge-driver.ts — union merge driver pra .graph/claims.jsonl (blind spot 2.2: dois devs
 * anexando ao mesmo log append-only em branches paralelos produzem conflito TEXTUAL no git;
 * resolver "na mão" (pegar um lado, descartar o outro) muda a verdade semântica porque a ordem
 * de LWW (readAllClaims, seq-based) depende de TODAS as linhas estarem presentes.
 *
 * Fix: um merge driver seq-aware que faz UNION das linhas dos dois lados (nunca escolhe um lado
 * só, nunca reordena linhas já existentes) e deixa o LWW-por-seq (já implementado em
 * readAllClaims, claim-store.ts) decidir o vencedor em tempo de leitura. O log em si nunca é
 * "resolvido" — ele só cresce. graph.json (derivado) nunca é merge manual; é sempre recomputado
 * a partir do claims.jsonl merged.
 *
 * Wiring pretendido (NÃO aplicado aqui — módulo é puramente aditivo, não mexe em git config):
 *
 *   # .gitattributes
 *   .graph/*.jsonl merge=graphseq
 *
 *   # git config (local ou .git/config), apontando pro driver:
 *   git config merge.graphseq.driver 'bun run packages/opencode/src/graph/merge-driver.ts %O %A %B'
 *   git config merge.graphseq.name 'seq-aware union merge for append-only claims.jsonl'
 *
 * (%O = base comum, %A = ours, %B = theirs — convenção padrão de merge driver do git)
 */

/** Uma linha JSONL "crua": preserva o texto original pra dedup/determinismo exato. */
type RawLine = {
  raw: string // texto original da linha (sem \n), usado pra dedup exato e como tie-breaker final
  id: string | undefined
  seq: number | undefined
}

function parseLines(blob: string): RawLine[] {
  const out: RawLine[] = []
  for (const line of blob.split("\n")) {
    if (!line.trim()) continue
    let id: string | undefined
    let seq: number | undefined
    try {
      const parsed = JSON.parse(line) as { id?: string; seq?: number }
      id = parsed.id
      seq = typeof parsed.seq === "number" ? parsed.seq : undefined
    } catch {
      // linha malformada: mantém como está (raw), sem id/seq — dedup ainda funciona por texto exato.
    }
    out.push({ raw: line, id, seq })
  }
  return out
}

/**
 * Merge de dois blobs JSONL (base + ours + theirs) em UNION determinística.
 *
 * Estratégia: `base` serve só pra documentar a intenção (identificar o que é "novo" em cada lado);
 * na prática, uma união simples de `ours` ∪ `theirs` com dedup por linha exata é suficiente e mais
 * simples — qualquer linha que já estava na base também está em ours e/ou theirs (git não apaga
 * linhas de um log append-only em uso normal), então ela entra na união do mesmo jeito. Isso é
 * documentado aqui em vez de implementar um three-way diff completo, porque:
 *   1. o log é append-only por contrato (claim-store.ts nunca reescreve linhas existentes);
 *   2. dedup por linha exata já cobre "a mesma linha nos dois lados" (item 2 do DoD);
 *   3. seq distinto pro mesmo id nos dois lados é mantido (nunca escolhido aqui) — vira
 *      responsabilidade do LWW-by-seq em readAllClaims (item 3 do DoD).
 *
 * Ordenação determinística da saída: por `seq` ascendente (records sem seq contam como -Infinity,
 * ficam primeiro — mesma convenção de readAllClaims), depois por `id` ascendente, depois pelo
 * texto JSON original (desempate final absoluto, cobre linhas malformadas ou sem id/seq).
 * A ordenação é independente da ordem de aparição nos blobs de entrada — só depende do conteúdo.
 */
export function mergeJsonlSeq(base: string, ours: string, theirs: string): string {
  void base // base não participa do algoritmo (ver doc acima); mantido na assinatura pra clareza da intenção 3-way.

  const seen = new Map<string, RawLine>() // dedup por texto exato de linha
  for (const line of [...parseLines(ours), ...parseLines(theirs)]) {
    if (!seen.has(line.raw)) seen.set(line.raw, line)
  }

  const merged = [...seen.values()].sort((a, b) => {
    const seqA = a.seq ?? -Infinity
    const seqB = b.seq ?? -Infinity
    if (seqA !== seqB) return seqA - seqB
    const idA = a.id ?? ""
    const idB = b.id ?? ""
    if (idA !== idB) return idA < idB ? -1 : 1
    if (a.raw !== b.raw) return a.raw < b.raw ? -1 : 1
    return 0
  })

  return merged.length ? merged.map((l) => l.raw).join("\n") + "\n" : ""
}

/**
 * Relatório informativo (não é erro): ids que aparecem nos dois lados com `seq` diferente.
 * Essas são exatamente as ids onde o merge textual teria conflito e um resolvedor ingênuo
 * poderia perder uma versão — aqui ambas são preservadas no log (mergeJsonlSeq), e o LWW-by-seq
 * (readAllClaims) decide o valor efetivo em tempo de leitura. Isso só nomeia os candidatos.
 */
export function mergeConflictFreeReport(ours: string, theirs: string): { sameIdDifferentSeq: string[] } {
  const oursById = new Map<string, Set<number | undefined>>()
  for (const l of parseLines(ours)) {
    if (!l.id) continue
    if (!oursById.has(l.id)) oursById.set(l.id, new Set())
    oursById.get(l.id)!.add(l.seq)
  }

  const flagged = new Set<string>()
  for (const l of parseLines(theirs)) {
    if (!l.id) continue
    const oursSeqs = oursById.get(l.id)
    if (!oursSeqs) continue
    const differsFromAll = ![...oursSeqs].some((s) => s === l.seq)
    if (differsFromAll) flagged.add(l.id)
  }

  return { sameIdDifferentSeq: [...flagged].sort() }
}
