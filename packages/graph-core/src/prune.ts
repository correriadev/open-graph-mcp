/**
 * prune.ts — engine de poda hierárquica (loop 2b). Pega o ledger v1 (descida bruta),
 * aplica decisões de poda com classificação P1-P5, e produz ledger v2 balanceado.
 * Porta determinística: o subagent decide O QUE podar; esta engine valida e executa.
 *
 * Dependency-aware: antes de podar um diretório, checa se algum arquivo P1/P2/P3
 * importa dele. Se sim, NÃO poda — promove o alvo para P3 (keep, sinal de que é usado).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import type { Ledger } from "./descent"
import type { Level } from "./classify"
import { buildModuleMap, readingOrder, type ModuleMap } from "./module-map"
import { buildFileGraph, toDepMap, type FileGraph } from "./resolve"

export type { Level }

export type PruneDecision = {
  path: string
  reason: string
  level: Level
}

export type LedgerV2 = {
  schemaVersion: 2
  repo: string
  startedAt: string
  projectSummary?: string
  passes: {
    depth: number
    dirs: string[]
    files: { path: string; level: string }[]
    pruned: { path: string; reason: string; level: string }[]
  }[]
  coverage: {
    filesKept: number
    filesPruned: number
    censusTotal: number
    balanced: boolean
  }
  pruning: {
    decisions: PruneDecision[]
    blocked: { path: string; reason: string; importedBy: string[] }[]
    byLevel: Record<string, number>
    byReason: Record<string, number>
  }
  modules?: ModuleMap
  readingOrder?: string[]
}

/**
 * Filtra decisões de poda: remove podas que atingiriam arquivos importados por P1/P2/P3.
 * Retorna decisões filtradas + lista de podas bloqueadas com motivo.
 */
export function filterDependencyAware(
  decisions: PruneDecision[],
  classifications: Map<string, Level>,
  depMap: Map<string, string[]>,
  ledger: Ledger,
): { filtered: PruneDecision[]; blocked: { path: string; reason: string; importedBy: string[] }[] } {
  const allFiles = new Set(ledger.passes.flatMap(p => p.files))
  const blocked: { path: string; reason: string; importedBy: string[] }[] = []
  const filtered: PruneDecision[] = []

  for (const decision of decisions) {
    const prunedPath = decision.path.replace(/\/$/, "")
    // coleta todos os arquivos dentro do diretório podado
    const affectedFiles: string[] = []
    if (allFiles.has(prunedPath)) {
      affectedFiles.push(prunedPath)
    } else {
      for (const f of allFiles) {
        if (f.startsWith(prunedPath + "/")) affectedFiles.push(f)
      }
    }

    // checa se algum arquivo afetado é importado por um arquivo P1/P2/P3
    const blockingImporters = new Set<string>()
    for (const af of affectedFiles) {
      const importers = depMap.get(af) ?? []
      for (const imp of importers) {
        const impLevel = classifications.get(imp)
        if (impLevel === "P1" || impLevel === "P2" || impLevel === "P3") {
          blockingImporters.add(imp)
        }
      }
    }

    if (blockingImporters.size > 0) {
      blocked.push({
        path: prunedPath,
        reason: `importado por ${blockingImporters.size} arquivo(s) P1/P2/P3`,
        importedBy: [...blockingImporters],
      })
    } else {
      filtered.push(decision)
    }
  }

  return { filtered, blocked }
}

/**
 * Aplica decisões de poda sobre o ledger v1 e produz ledger v2.
 * Invariante: filesKept + filesPruned == censusTotal.
 * Dependency-aware: podas que atingiriam dependências de P1/P2/P3 são bloqueadas.
 */
export async function applyPruning(
  ledger: Ledger,
  decisions: PruneDecision[],
  classifications: Map<string, Level>,
  opts: { root?: string; dependencyAware?: boolean; projectSummary?: string; buildModules?: boolean } = {},
): Promise<LedgerV2> {
  let effectiveDecisions = decisions
  let blocked: { path: string; reason: string; importedBy: string[] }[] = []

  // Grafo de imports lido UMA vez (antes: prune e module-map liam todo arquivo separado).
  const graph: FileGraph | undefined =
    opts.root && (opts.dependencyAware || opts.buildModules) ? await buildFileGraph(ledger, opts.root) : undefined

  if (opts.dependencyAware && opts.root && graph) {
    const depMap = toDepMap(graph)
    const result = filterDependencyAware(decisions, classifications, depMap, ledger)
    effectiveDecisions = result.filtered
    blocked = result.blocked
  }

  const prunedSet = new Set<string>()
  const reasonMap = new Map<string, { reason: string; level: string }>()

  for (const d of effectiveDecisions) {
    const normalized = d.path.replace(/\/$/, "")
    if (prunedSet.has(normalized)) continue
    prunedSet.add(normalized)
    reasonMap.set(normalized, { reason: d.reason, level: d.level })
  }

  let filesKept = 0
  let filesPruned = 0
  const v2Passes: LedgerV2["passes"] = []

  for (const pass of ledger.passes) {
    const files: { path: string; level: string }[] = []
    const pruned: { path: string; reason: string; level: string }[] = [...pass.pruned.map(p => ({
      path: p.path,
      reason: p.reason,
      level: "P5",
    }))]
    const dirs: string[] = []

    for (const d of pass.dirs) {
      if (prunedSet.has(d)) {
        pruned.push({ path: d, reason: reasonMap.get(d)?.reason ?? "hierarchy-prune", level: reasonMap.get(d)?.level ?? "P5" })
      } else {
        dirs.push(d)
      }
    }

    for (const f of pass.files) {
      if (isInsidePrunedDir(f, prunedSet)) {
        pruned.push({ path: f, reason: "parent-pruned", level: "P5" })
        filesPruned++
        continue
      }
      const level = classifications.get(f) ?? "P4"
      files.push({ path: f, level })
      filesKept++
    }

    v2Passes.push({ depth: pass.depth, dirs, files, pruned })
  }

  const censusTotal = filesKept + filesPruned
  const byLevel: Record<string, number> = {}
  const byReason: Record<string, number> = {}
  for (const p of v2Passes.flatMap(p => p.pruned)) {
    byLevel[p.level] = (byLevel[p.level] ?? 0) + 1
    byReason[p.reason] = (byReason[p.reason] ?? 0) + 1
  }

  // Build module map if requested (needs root to read files)
  // Usa SÓ os arquivos mantidos (pós-poda) — não o ledger v1 cru
  let modules: ModuleMap | undefined
  let readingOrderResult: string[] | undefined
  if (opts.buildModules && opts.root && graph) {
    const keptLedger: Ledger = {
      ...ledger,
      passes: v2Passes.map(p => ({
        depth: p.depth,
        dirs: p.dirs,
        files: p.files.map(f => f.path),
        pruned: [],
      })),
    }
    modules = await buildModuleMap(keptLedger, classifications, opts.root, graph)
    readingOrderResult = readingOrder(modules)
  }

  return {
    schemaVersion: 2,
    repo: ledger.repo,
    startedAt: new Date().toISOString(),
    projectSummary: opts.projectSummary,
    passes: v2Passes,
    coverage: { filesKept, filesPruned, censusTotal, balanced: true },
    pruning: { decisions: effectiveDecisions, blocked, byLevel, byReason },
    modules,
    readingOrder: readingOrderResult,
  }
}

function isInsidePrunedDir(filePath: string, prunedDirs: Set<string>): boolean {
  for (const d of prunedDirs) {
    if (filePath.startsWith(d + "/") || filePath === d) return true
  }
  return false
}

export function writeLedgerV2(root: string, ledger: LedgerV2, filename = "ledger.json"): string {
  const dir = path.join(root, ".graph")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = path.join(dir, filename)
  // minified: canônico lido por código (graphread/census), não por LLM → sem pretty-print (~40% off)
  writeFileSync(file, JSON.stringify(ledger))
  return file
}

export function readLedgerV2(root: string, filename = "ledger.json"): LedgerV2 | null {
  const file = path.join(root, ".graph", filename)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, "utf8")) as LedgerV2
}
