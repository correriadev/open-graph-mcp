/**
 * descent.ts — engine de descida determinística (loop 2a). BFS por nível, frontier worklist,
 * invariante de cobertura. Zero LLM. Molde de gate.ts/scan.ts (TS puro).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, type Dirent } from "node:fs"
import path from "node:path"
import { DEFAULT_IGNORE, shouldIgnore, census } from "./scan"

export type PassRecord = {
  depth: number
  dirs: string[]
  files: string[]
  pruned: { path: string; reason: string }[]
}
export type Coverage = { filesRead: number; censusTotal: number; balanced: boolean }
export type DescentResult = { passes: PassRecord[]; coverage: Coverage }

/** Invariante de cobertura: todo arquivo relevante foi alcançado. Breach = throw, nunca silêncio. */
export function assertCoverage(filesRead: number, censusTotal: number): void {
  if (filesRead !== censusTotal)
    throw new Error(`coverage breach: filesRead(${filesRead}) !== censusTotal(${censusTotal})`)
}

/** Descida BFS por nível. Frontier determinística; symlinks de dir não seguidos (árvore, não grafo). */
export function descend(root: string, opts: { ignore?: string[] } = {}): DescentResult {
  const extra = opts.ignore ?? []
  const censusTotal = census(root, extra).totalFiles
  let filesRead = 0
  const passes: PassRecord[] = []
  let frontier = [root]
  let depth = 0
  while (frontier.length > 0) {
    const dirs: string[] = []
    const files: string[] = []
    const pruned: PassRecord["pruned"] = []
    const next: string[] = []
    for (const d of frontier) {
      dirs.push(path.relative(root, d) || ".")
      let entries: Dirent[]
      try {
        entries = readdirSync(d, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        if (e.isSymbolicLink()) continue
        const rel = path.relative(root, path.join(d, e.name))
        if (e.isDirectory()) {
          if (shouldIgnore(e.name, DEFAULT_IGNORE, extra)) pruned.push({ path: rel, reason: "default-ignore" })
          else next.push(path.join(d, e.name))
        } else if (e.isFile()) {
          if (shouldIgnore(e.name, DEFAULT_IGNORE, extra)) continue
          files.push(rel)
          filesRead++
        }
      }
    }
    passes.push({ depth, dirs, files, pruned })
    frontier = next
    depth++
  }
  assertCoverage(filesRead, censusTotal)
  return { passes, coverage: { filesRead, censusTotal, balanced: true } }
}

export type Ledger = {
  schemaVersion: 1
  repo: string
  startedAt: string
  passes: PassRecord[]
  coverage: Coverage
}

/** startedAt vem da engine (Date), nunca do LLM — mata o timestamp alucinado do step 0. */
export function buildLedger(root: string, result: DescentResult): Ledger {
  return {
    schemaVersion: 1,
    repo: root,
    startedAt: new Date().toISOString(),
    passes: result.passes,
    coverage: result.coverage,
  }
}

/** Grava .graph/ledger.json (cria .graph/ se faltar). Uma descida = um ledger (sobrescreve). */
export function writeLedger(root: string, ledger: Ledger): string {
  const dir = path.join(root, ".graph")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "ledger.json")
  writeFileSync(file, JSON.stringify(ledger, null, 2))
  return file
}

export function readLedger(root: string): Ledger | null {
  const file = path.join(root, ".graph", "ledger.json")
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, "utf8")) as Ledger
}
