/**
 * view.ts — projeção token-eficiente do ledger v2 pro handoff LLM (fase de claims).
 * Unifica os dois eixos de economia: mandar MENOS (só `modules`, não a file-table de N linhas;
 * a file-table é cru que `graphread` resolve ao vivo) + mandar BARATO (TSV: header 1×, sem chaves
 * repetidas, arrays aninhados como `a|b|c`). Linhas ordenadas por `readingOrder` → deps antes de
 * dependentes, então a ordem É o roteiro de leitura (campo separado vira redundante).
 *
 * Canônico (JSON full) fica no disco pra engine determinística; isto é só a VIEW descartável.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import type { LedgerV2 } from "./prune"

const COLS = ["path", "domain", "files", "entry", "density", "testCov", "levels", "imports", "importedBy"] as const

/** Quantos importadores listar antes de truncar pra `+K`. Centralidade já vem de `+K`. */
const MAX_IMPORTED_BY = 8

function packLevels(levels: Record<string, number>): string {
  return Object.entries(levels)
    .sort()
    .map(([l, c]) => `${l}:${c}`)
    .join(",")
}

/**
 * Aliases de prefixo: troca `.../src/` (ou 1º segmento) recorrentes por `@0`, `@1`... com legenda.
 * Um prefixo comum único falha em monorepo real (módulos em `docs/`, roots zeram). Aliasing
 * por-raiz captura o desperdício real: `packages/opencode/src/` (22ch) vira `@0` (2ch), repetido
 * milhares de vezes em imports/importedBy. Só aliasa quando compensa a linha de legenda.
 */
function buildAliases(paths: string[]): { strip: (p: string) => string; legend: string[] } {
  const prefixOf = (p: string): string | null => {
    const i = p.lastIndexOf("/src/")
    if (i >= 0) return p.slice(0, i + 5)
    if (p.endsWith("/src")) return p + "/"
    const j = p.indexOf("/")
    return j >= 0 ? p.slice(0, j + 1) : null
  }
  const freq = new Map<string, number>()
  for (const p of paths) {
    const pre = prefixOf(p)
    if (pre) freq.set(pre, (freq.get(pre) ?? 0) + 1)
  }
  // vale a pena se economia das ocorrências > custo da legenda (len+~6)
  const chosen = [...freq.entries()]
    .filter(([pre, c]) => c * (pre.length - 2) > pre.length + 6)
    .sort((a, b) => b[1] - a[1])
    .map(([pre]) => pre)
  const alias = new Map<string, string>()
  const legend: string[] = []
  chosen.forEach((pre, i) => {
    alias.set(pre, `@${i}`)
    legend.push(`# @${i} = ${pre}`)
  })
  const byLen = chosen.slice().sort((a, b) => b.length - a.length)
  const strip = (p: string) => {
    for (const pre of byLen) {
      if (p === pre.replace(/\/$/, "")) return alias.get(pre)!
      if (p.startsWith(pre)) return alias.get(pre)! + p.slice(pre.length)
    }
    return p
  }
  return { strip, legend }
}

export function ledgerToTsv(ledger: LedgerV2): string {
  const modules = ledger.modules ?? []
  const order = ledger.readingOrder ?? modules.map((m) => m.path)
  const byPath = new Map(modules.map((m) => [m.path, m]))
  const { strip, legend } = buildAliases(modules.map((m) => m.path))

  const lines: string[] = []
  if (ledger.projectSummary) lines.push(`# project: ${ledger.projectSummary}`)
  for (const l of legend) lines.push(l)
  lines.push(
    `# modules: ${modules.length} | ordered by readingOrder (deps before dependents) | importedBy truncated to ${MAX_IMPORTED_BY} +K | coverage kept=${ledger.coverage.filesKept} pruned=${ledger.coverage.filesPruned}`,
  )
  lines.push(COLS.join("\t"))

  for (const p of order) {
    const m = byPath.get(p)
    if (!m) continue
    const entry = m.entryPoint ? path.relative(m.path, m.entryPoint) : ""
    const ib = m.importedBy
    const ibStr =
      ib.length > MAX_IMPORTED_BY
        ? ib.slice(0, MAX_IMPORTED_BY).map(strip).join("|") + `|+${ib.length - MAX_IMPORTED_BY}`
        : ib.map(strip).join("|")
    lines.push(
      [
        strip(m.path),
        m.domain,
        String(m.fileCount),
        entry,
        String(m.density),
        String(m.testCoverage),
        packLevels(m.levels),
        m.imports.map(strip).join("|"),
        ibStr,
      ].join("\t"),
    )
  }
  return lines.join("\n") + "\n"
}

export function writeView(root: string, ledger: LedgerV2, filename = "view.tsv"): string {
  const dir = path.join(root, ".graph")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = path.join(dir, filename)
  writeFileSync(file, ledgerToTsv(ledger))
  return file
}
