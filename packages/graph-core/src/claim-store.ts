/**
 * claim-store.ts — Fase B: store de claims (saída do Pass B), modelo JSONL append-only.
 * O agent lê os metadados (meta.ts) por domínio, separa assuntos, e submete claims; esta camada
 * é a PORTA: valida que os `refs` apontam pra metas reais e que a âncora é verbatim, e persiste.
 *
 * append-only (.graph/claims.jsonl) → O(1) por claim (vs reescrever JSON inteiro = O(n²) na sessão).
 * Cobertura B: toda meta referenciada por ≥1 claim — senão breach (símbolo lido mas não claimado).
 */
import { readFileSync, appendFileSync, mkdirSync, existsSync, writeFileSync } from "node:fs"
import path from "node:path"
import { excerptCheck } from "./extract"
import type { MetaRecord } from "./meta"

export type ClaimRecord = {
  id: string
  subject: string
  domain: string
  refs: string[] // ids de meta (name_path) OU de claims do nível abaixo (subida)
  anchor: string // verbatim, deve existir em algum arquivo dos refs
  verdict?: { confidence: number; overclaim: boolean; contradiction?: boolean; findings?: string[] }
  // ── escada de abstração (subida governada) ──
  level?: number // 5=código (default, claims do Pass B) … 0=ideação. Ausente = 5.
  status?: "pending-verification" | "verified" | "contradicts-floor" | "test-spec" // cicatriz da subida/descida
  file?: string // arquivo-chão onde a âncora foi verificada (resolve grounding do nível acima)
  // ── descida governada (expander) ──
  derivation?: "[Implied]" | "[Compatible]" | "[Speculative]" // quanto o pai sustenta o filho
  parent_constraint?: string | null // restrição (humana) que este claim impõe aos próprios descendentes
  forbids?: string[] // gêmeo verificável de parent_constraint: termos que um descendente não pode conter
  score?: number // herança determinística (expandScore): ≤ pai mais fraco, afunda pelas issues próprias
  provisional?: boolean // nasceu de pai não-resolvido (leve); marca transitiva, nunca bloqueia
  seq?: number // ordem de escrita monotônica (LWW por seq, não por ordem de leitura). Ausente = mais antigo que qualquer seq'd.
}

export function claimsPath(root: string): string {
  return path.join(root, ".graph", "claims.jsonl")
}

export type ValidateResult = { valid: ClaimRecord[]; rejected: { id: string; reason: string }[] }

/** Valida claims contra o índice de metas. `readFile` injetado pra testar sem fs. */
export function validateClaims(
  claims: readonly ClaimRecord[],
  metaById: Map<string, MetaRecord>,
  readFile: (f: string) => string | undefined,
): ValidateResult {
  const valid: ClaimRecord[] = []
  const rejected: { id: string; reason: string }[] = []
  for (const c of claims) {
    if (!c.id || !c.subject || !c.refs?.length) {
      rejected.push({ id: c.id ?? "?", reason: "missing required fields (id/subject/refs)" })
      continue
    }
    const unknown = c.refs.filter((r) => !metaById.has(r))
    if (unknown.length) {
      rejected.push({ id: c.id, reason: `refs missing from metadata: ${unknown.join(", ")}` })
      continue
    }
    if (c.anchor) {
      const ok = c.refs.some((r) => {
        const content = readFile(metaById.get(r)!.file)
        return content !== undefined && excerptCheck(content, c.anchor)
      })
      if (!ok) {
        rejected.push({ id: c.id, reason: "anchor not found verbatim in the refs' files" })
        continue
      }
    }
    valid.push(c)
  }
  return { valid, rejected }
}

/**
 * Maior `seq` já persistido no log (0 se vazio/ausente). Base pro contador continuar após restart.
 * spec v2-06: lê primeiro o sidecar `<file>.seq` (um inteiro, utf8). Se presente E >= o seq da
 * última linha do log, retorna direto (O(1) JSON parse — só a última linha é parseada pra verificação).
 * Sidecar ausente/atrasado (ex.: pós-merge uniu dois ramos) → full scan (código de hoje) + reescreve
 * o sidecar. Sidecars são derivados: arquivos .seq sob .graph devem ser gitignored (o merge driver os ignora).
 */
function readMaxSeq(file: string): number {
  const sidecar = file + ".seq"
  if (existsSync(sidecar)) {
    const sideVal = parseInt(readFileSync(sidecar, "utf8").trim(), 10)
    if (!isNaN(sideVal)) {
      // trust-but-verify: sidecar must be >= the log's last non-empty line's seq
      if (existsSync(file)) {
        const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim())
        const lastLine = lines[lines.length - 1]
        if (lastLine) {
          const lastSeq = (JSON.parse(lastLine) as ClaimRecord).seq
          if (sideVal >= (typeof lastSeq === "number" ? lastSeq : 0)) return sideVal
        } else {
          return sideVal // log is empty but sidecar has a value
        }
      } else {
        return sideVal
      }
    }
  }
  // fallback: full scan (sidecar missing/behind/corrupt — e.g. after a git merge) + rewrite sidecar
  if (!existsSync(file)) return 0
  let max = 0
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue
    const c = JSON.parse(line) as ClaimRecord
    if (typeof c.seq === "number" && c.seq > max) max = c.seq
  }
  writeFileSync(sidecar, String(max))
  return max
}

export function appendClaims(root: string, claims: readonly ClaimRecord[]): string {
  const file = claimsPath(root)
  mkdirSync(path.dirname(file), { recursive: true })
  // seq monotônico: continua do máximo já no log (sobrevive a restart), nunca reordena o log em si.
  let next = readMaxSeq(file) + 1
  const stamped = claims.map((c) => ({ ...c, seq: next++ }))
  const lines = stamped.map((c) => JSON.stringify(c)).join("\n")
  if (lines.length) appendFileSync(file, lines + "\n")
  // spec v2-06: stamp the sidecar with the new max so the next append skips the full scan
  writeFileSync(file + ".seq", String(next - 1))
  return file
}

/**
 * Lê claims com semântica last-write-wins por id. O log é append-only (adversary anexa a versão
 * com verdict), então a MESMA id aparece em várias linhas — dedup pela última mantém a store
 * idempotente (re-rodar adversary não infla nem re-julga). Sem dedup, cada run dobra o arquivo.
 *
 * LWW é por `seq`, nunca por ordem de leitura/linha física: um `seq` maior sempre vence, mesmo
 * que a linha física com `seq` menor apareça depois no arquivo. Records sem `seq` (logs legados)
 * contam como mais antigos que qualquer record com `seq`; entre dois sem `seq`, desempate é pela
 * ordem de aparição no arquivo (estável).
 */
export function readAllClaims(root: string): ClaimRecord[] {
  const file = claimsPath(root)
  if (!existsSync(file)) return []
  const byId = new Map<string, ClaimRecord>()
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue
    const c = JSON.parse(line) as ClaimRecord
    const existing = byId.get(c.id)
    const newSeq = c.seq ?? -Infinity
    const oldSeq = existing?.seq ?? -Infinity
    if (!existing || newSeq >= oldSeq) byId.set(c.id, c)
  }
  return [...byId.values()]
}

/** Cobertura B: toda meta referenciada por ≥1 claim. `missing` = símbolo lido mas não claimado. */
export function claimCoverage(
  meta: readonly MetaRecord[],
  claims: readonly ClaimRecord[],
): { metaCount: number; claimed: number; missing: string[]; balanced: boolean } {
  const claimed = new Set(claims.flatMap((c) => c.refs))
  const missing = meta.map((m) => m.id).filter((id) => !claimed.has(id))
  return { metaCount: meta.length, claimed: meta.length - missing.length, missing, balanced: missing.length === 0 }
}
