/**
 * verify.ts — gate de integridade estático (CA-7: nada flutua solto).
 * Diferente do graphwatch (que detecta MUDANÇA no tempo), o verify responde "o grafo ATUAL é íntegro?":
 * nó sem chão, âncora que não bate, id duplicado, claim apontando pra meta inexistente, âncora de claim sem lastro.
 *
 * Divisão de responsabilidade com roundtrip.ts: verify = CHÃO (meta ↔ arquivo, claim ancorado no chão);
 * roundtrip = ESCADA (refs claim→claim: adjacência, órfãos, ciclos). `claim.refs` pode apontar pra id de
 * meta OU pra claim do nível abaixo (subida) — ver claim-store.ts. Uma ref só é dangling se não resolve em
 * NADA (nem meta, nem claim); e a checagem de âncora-verbatim-no-arquivo só se aplica a claims ancoradas no
 * chão (≥1 ref de meta) — claims de escada pura já tiveram a âncora gate-checada na admissão (ascent/expand).
 *
 * Determinístico, sem LLM. Gate: clean=true só se 0 breaches.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { excerptCheck } from "./extract"
import type { MetaRecord } from "./meta"
import type { ClaimRecord } from "./claim-store"

export type Breach = {
  kind: "missing-file" | "broken-anchor" | "dup-id" | "dangling-ref" | "dangling-claim-anchor"
  id: string
  detail: string
}

export type VerifyResult = { breaches: Breach[]; clean: boolean; checked: { nodes: number; claims: number } }

/** Checa integridade estrutural sobre meta/claims já deduplicados. `readFile` injetado pra testar. */
export function verifyIntegrity(
  meta: readonly MetaRecord[],
  claims: readonly ClaimRecord[],
  readFile: (f: string) => string | undefined,
): VerifyResult {
  const breaches: Breach[] = []
  const metaIds = new Set(meta.map((m) => m.id))
  const claimIds = new Set(claims.map((c) => c.id))

  // nós: chão presente + âncora verbatim
  for (const m of meta) {
    const content = readFile(m.file)
    if (content === undefined) breaches.push({ kind: "missing-file", id: m.id, detail: m.file })
    else if (!excerptCheck(content, m.anchor)) breaches.push({ kind: "broken-anchor", id: m.id, detail: m.file })
  }

  // claims: refs existem (em meta OU noutra claim — escada) + âncora ancorada no chão quando aplicável
  for (const c of claims) {
    const unknown = c.refs.filter((r) => !metaIds.has(r) && !claimIds.has(r))
    if (unknown.length) breaches.push({ kind: "dangling-ref", id: c.id, detail: unknown.join(", ") })

    const metaRefs = c.refs.filter((r) => metaIds.has(r))
    const isFloorGrounded = metaRefs.length > 0
    if (c.anchor && isFloorGrounded) {
      const ok = metaRefs.some((r) => {
        const m = meta.find((x) => x.id === r)
        const content = m && readFile(m.file)
        return content !== undefined && excerptCheck(content, c.anchor)
      })
      if (!ok) breaches.push({ kind: "dangling-claim-anchor", id: c.id, detail: "anchor not verbatim in any ref file" })
    }
  }

  return { breaches, clean: breaches.length === 0, checked: { nodes: meta.length, claims: claims.length } }
}

/**
 * Conflito de id no log cru: mesmo id de meta apontando pra ARQUIVOS diferentes = identidade ambígua (breach).
 * Mesma linha repetida (re-submit do mesmo símbolo) é log append-only benigno — não é breach.
 */
export function findDuplicates(root: string): Breach[] {
  const breaches: Breach[] = []
  const metaDir = path.join(root, ".graph", "meta")
  if (!existsSync(metaDir)) return breaches
  const filesById = new Map<string, Set<string>>()
  for (const f of readdirSync(metaDir)) {
    if (!f.endsWith(".jsonl")) continue
    for (const l of readFileSync(path.join(metaDir, f), "utf8").split("\n")) {
      if (!l.trim()) continue
      try {
        const m = JSON.parse(l)
        ;(filesById.get(m.id) ?? filesById.set(m.id, new Set()).get(m.id)!).add(m.file)
      } catch {
        /* skip */
      }
    }
  }
  for (const [id, files] of filesById) {
    if (files.size > 1) breaches.push({ kind: "dup-id", id, detail: `same id, different files: ${[...files].join(", ")}` })
  }
  return breaches
}
