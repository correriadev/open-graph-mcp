/**
 * meta.ts — Fase A: store de metadados de símbolo (saída do Pass A).
 * O agent lê via graphsymbols, julga, e submete records; esta camada é a PORTA determinística:
 * valida a âncora verbatim (excerptCheck → rejeita alucinação) e persiste em shard por módulo.
 *
 * Shard por módulo (.graph/meta/<modulo>.jsonl) → escrita paralela sem lock (cada worker no seu).
 * id = name_path do LSP (símbolo), estável a rename. Cobertura: todo arquivo-fonte kept precisa
 * de ≥1 record — senão breach (nada some em silêncio), mesmo invariante do prune.
 */
import { readFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { excerptCheck } from "./extract"
import { exportedSymbols, extractSymbols, isTsFamily } from "./symbols"
import { isDocument, extractScriptsFromHtml } from "./outline"
import { packageOf, packageDomain, loadWorkspaces, type WorkspacePkg } from "./resolve"
import { readLedgerV2, type LedgerV2 } from "./prune"

export type MetaRecord = {
  id: string // name_path: "modulo/Classe/metodo" ou nivel-arquivo "modulo/arquivo"
  file: string // caminho relativo à raiz do repo
  kind: string
  sig?: string
  responsibility: string
  exposed: boolean
  deps: string[]
  anchor: string // linha verbatim re-checável
  range?: string
  seq?: number // ordem de escrita monotônica (LWW por seq, não por ordem de readdir). Ausente = mais antigo que qualquer seq'd.
  // ── campos estruturais opcionais (piso graded drift, INV-H1-2) ─────────────
  // Presença de AMBOS habilita o gate estrutural via resolveAnchor (extract.ts); ausência
  // (records legados) preserva o caminho verbatim de hoje EXATAMENTE. Sem backfill aqui —
  // popular estes campos em records existentes é um dispatch de migração separado.
  symbolPath?: string // path de declaração (ex.: "Classe/metodo") resolvido por tree-sitter
  tokenHash?: string // sha256 do stream de tokens canônico (ver resolveAnchor/tokenHashOf)
  renameStableHash?: string // sha256 do stream de tokens canonicalizado por identificador (ver renameStableHashOf em extract.ts)
}

const META_DIR = "meta"

export function shardPath(root: string, moduleName: string): string {
  const safe = moduleName.replace(/[/\\]/g, "_").replace(/[^\w.-]/g, "").replace(/^\.+$/, "") || "root"
  return path.join(root, ".graph", META_DIR, `${safe}.jsonl`)
}

export type ValidateResult = { valid: MetaRecord[]; rejected: { id: string; reason: string }[] }

/** Valida records. `readFile` injetado pra testar sem fs. Âncora alucinada = rejeitada. */
export function validateRecords(records: readonly MetaRecord[], readFile: (f: string) => string | undefined): ValidateResult {
  const valid: MetaRecord[] = []
  const rejected: { id: string; reason: string }[] = []
  for (const r of records) {
    if (!r.id || !r.file || !r.anchor) {
      rejected.push({ id: r.id ?? "?", reason: "missing required fields (id/file/anchor)" })
      continue
    }
    const content = readFile(r.file)
    if (content === undefined) {
      rejected.push({ id: r.id, reason: `file not read: ${r.file}` })
      continue
    }
    if (!excerptCheck(content, r.anchor)) {
      rejected.push({ id: r.id, reason: "anchor not found verbatim (hallucinated?)" })
      continue
    }
    valid.push(r)
  }
  return { valid, rejected }
}

/**
 * Maior `seq` já persistido em qualquer shard (0 se vazio/ausente). Contador é global entre shards.
 * spec v2-06: lê primeiro o sidecar `<dir>/.seq` (um inteiro, utf8). Se presente E >= o maior seq
 * da última linha de cada shard, retorna direto (O(shards) file reads, O(1) JSON parse por shard).
 * Sidecar ausente/atrasado (ex.: pós-merge uniu dois ramos) → full scan (código de hoje) + reescreve
 * o sidecar. Sidecars são derivados: arquivos .seq sob .graph devem ser gitignored (o merge driver os ignora).
 */
function readMaxSeq(dir: string): number {
  const sidecar = path.join(dir, ".seq")
  if (existsSync(sidecar)) {
    const sideVal = parseInt(readFileSync(sidecar, "utf8").trim(), 10)
    if (!isNaN(sideVal) && existsSync(dir)) {
      // trust-but-verify: sidecar must be >= every shard's last-line seq
      let lastMax = 0
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".jsonl")) continue
        const lines = readFileSync(path.join(dir, f), "utf8").split("\n").filter((l) => l.trim())
        const lastLine = lines[lines.length - 1]
        if (lastLine) {
          const lastSeq = (JSON.parse(lastLine) as MetaRecord).seq
          if (typeof lastSeq === "number" && lastSeq > lastMax) lastMax = lastSeq
        }
      }
      if (sideVal >= lastMax) return sideVal
    }
  }
  // fallback: full scan (sidecar missing/behind/corrupt) + rewrite sidecar
  if (!existsSync(dir)) return 0
  let max = 0
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue
    for (const line of readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue
      const m = JSON.parse(line) as MetaRecord
      if (typeof m.seq === "number" && m.seq > max) max = m.seq
    }
  }
  writeFileSync(sidecar, String(max))
  return max
}

export function appendShard(root: string, moduleName: string, records: readonly MetaRecord[]): string {
  const file = shardPath(root, moduleName)
  mkdirSync(path.dirname(file), { recursive: true })
  const dir = path.join(root, ".graph", META_DIR)
  // seq monotônico global (entre shards): continua do máximo já persistido, sobrevive a restart.
  let next = readMaxSeq(dir) + 1
  const stamped = records.map((r) => ({ ...r, seq: next++ }))
  const lines = stamped.map((r) => JSON.stringify(r)).join("\n")
  if (lines.length) appendFileSync(file, lines + "\n")
  // spec v2-06: stamp the sidecar with the new max so the next append skips the full scan
  writeFileSync(path.join(dir, ".seq"), String(next - 1))
  return file
}

/**
 * Lê metas com last-write-wins por id (shards são append-only; re-gravar um símbolo não duplica).
 *
 * LWW é por `seq`, nunca por ordem de readdir (a ordem de diretório é dependente de plataforma —
 * ver INV-H1-3). `readdirSync(dir).sort()` só garante uma ordem de iteração estável pro desempate
 * de records sem `seq` (legados); quem decide o vencedor é sempre o maior `seq`, independente de
 * qual shard foi lido primeiro.
 */
export function readAllMeta(root: string): MetaRecord[] {
  const dir = path.join(root, ".graph", META_DIR)
  if (!existsSync(dir)) return []
  const byId = new Map<string, MetaRecord>()
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".jsonl")) continue
    const content = readFileSync(path.join(dir, f), "utf8")
    for (const line of content.split("\n")) {
      if (!line.trim()) continue
      const m = JSON.parse(line) as MetaRecord
      const existing = byId.get(m.id)
      const newSeq = m.seq ?? -Infinity
      const oldSeq = existing?.seq ?? -Infinity
      if (!existing || newSeq >= oldSeq) byId.set(m.id, m)
    }
  }
  return [...byId.values()]
}

const isSource = (f: string) => /\.(ts|tsx|js|jsx)$/.test(f)

/** Cobertura A (arquivo): cada arquivo-fonte kept precisa de ≥1 meta. `missing` = breach. */
export function metaCoverage(
  ledger: LedgerV2,
  meta: readonly MetaRecord[],
): { keptSource: number; covered: number; missing: string[]; balanced: boolean } {
  const targets = ledger.passes.flatMap((p) => p.files.map((f) => f.path)).filter(isSource)
  const withMeta = new Set(meta.map((m) => m.file))
  const missing = targets.filter((f) => !withMeta.has(f))
  return { keptSource: targets.length, covered: targets.length - missing.length, missing, balanced: missing.length === 0 }
}

/**
 * Cobertura A (símbolo): todo símbolo top-level EXPORTADO precisa de ≥1 meta.
 * Fecha o gap que o gate por-arquivo deixa (arquivo coberto mas exports faltando).
 * Compara nome exportado contra os segmentos dos ids de meta daquele arquivo.
 */
export function symbolCoverage(
  ledger: LedgerV2,
  meta: readonly MetaRecord[],
  readFile: (f: string) => string | undefined,
): { total: number; covered: number; missing: { file: string; symbol: string }[]; balanced: boolean } {
  const targets = ledger.passes.flatMap((p) => p.files.map((f) => f.path)).filter(isSource)
  const segsByFile = new Map<string, Set<string>>()
  for (const m of meta) {
    const set = segsByFile.get(m.file) ?? new Set<string>()
    for (const seg of m.id.split("/")) set.add(seg)
    segsByFile.set(m.file, set)
  }
  const missing: { file: string; symbol: string }[] = []
  let total = 0
  for (const f of targets) {
    const content = readFile(f)
    if (content === undefined) continue
    const have = segsByFile.get(f) ?? new Set<string>()
    if (isTsFamily(f)) {
      for (const sym of exportedSymbols(content, f)) {
        total++
        if (!have.has(sym)) missing.push({ file: f, symbol: sym })
      }
    } else if (isDocument(f)) {
      // A3: HTML com JS embutido — extrai símbolos via parser e verifica cobertura
      const scripts = extractScriptsFromHtml(content)
      for (const js of scripts) {
        const jsSyms = extractSymbols(js, "inline.js")
        for (const s of jsSyms) {
          total++
          if (!have.has(s.name)) missing.push({ file: f, symbol: s.name })
        }
      }
    }
  }
  return { total, covered: total - missing.length, missing, balanced: missing.length === 0 }
}

export type PackageCoverage = {
  package: string
  keptSource: number
  covered: number
  missing: string[]
  balanced: boolean
}

/**
 * Cobertura A por pacote do workspace: agrupa o denominador por pacote (core, tui, ...).
 * Resolve a coarseza do `metaCoverage` global em monorepo — dá pra perguntar "packages/core
 * está mapeado?" sem mesclar todos os pacotes num só numerador. Arquivos fora de qualquer
 * pacote do workspace caem em "(unscoped)".
 */
export function metaCoverageByPackage(
  ledger: LedgerV2,
  meta: readonly MetaRecord[],
  root: string,
): PackageCoverage[] {
  const allFiles = ledger.passes.flatMap((p) => p.files.map((f) => f.path))
  const files = allFiles.filter(isSource)
  const workspaces = loadWorkspaces(
    { schemaVersion: 1, repo: root, startedAt: "", passes: [{ depth: 0, dirs: ["."], files: allFiles, pruned: [] }], coverage: { filesRead: allFiles.length, censusTotal: allFiles.length, balanced: true } },
    root,
  )
  const withMeta = new Set(meta.map((m) => m.file))
  const groups = new Map<string, { kept: string[]; missing: string[] }>()
  for (const f of files) {
    const pkg = packageOf(f, workspaces)
    const label = pkg ? packageDomain(pkg) : "(unscoped)"
    const g = groups.get(label) ?? { kept: [], missing: [] }
    ;(withMeta.has(f) ? g.kept : g.missing).push(f)
    groups.set(label, g)
  }
  return [...groups.entries()]
    .map(([label, g]) => ({
      package: label,
      keptSource: g.kept.length + g.missing.length,
      covered: g.kept.length,
      missing: g.missing,
      balanced: g.missing.length === 0,
    }))
    .sort((a, b) => b.keptSource - a.keptSource)
}
