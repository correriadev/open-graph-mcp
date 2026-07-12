/**
 * module-map.ts — agrupa arquivos do ledger em módulos coesos e extrai
 * estrutura determinística que dá norte à fase de claims:
 * - agrupamento por diretório pai (o "domínio"/torre do README)
 * - mapa de dependências entre módulos (direção de leitura)
 * - entry point por módulo (barrel com mais exports importados de fora)
 * - densidade semântica (imports internos / total)
 * - cobertura de testes (ratio .test.ts / .ts)
 * - distribuição de níveis P1-P5 por módulo
 *
 * Tudo determinístico, sem LLM. Usa extract.ts para imports/exports.
 */
import path from "node:path"
import type { Ledger } from "./descent"
import type { Level } from "./classify"
import { buildFileGraph, loadWorkspaces, packageDomain, type FileGraph, type WorkspacePkg } from "./resolve"

export type ModuleInfo = {
  path: string
  domain: string
  fileCount: number
  entryPoint: string | null
  imports: string[]
  importedBy: string[]
  density: number
  testCoverage: number
  levels: Record<string, number>
}

export type ModuleMap = ModuleInfo[]

const DOMAIN_NAMES = new Set([
  "session", "auth", "graph", "database", "server", "cli", "tool",
  "agent", "config", "plugin", "provider", "permission", "account",
  "project", "commit", "file", "search", "diff", "lsp", "mcp",
  "ui", "app", "desktop", "tui", "web", "sdk", "core",
  "theme", "component", "route", "page", "context", "feature",
  "command", "prompt", "message", "event", "query", "mutation",
])

function inferDomain(dirPath: string, workspaces: WorkspacePkg[]): string {
  const pkgInfo = workspaces.find((w) => dirPath === w.dir || (w.dir && dirPath.startsWith(w.dir + "/")))
  // dentro de um pacote do workspace: procura segmento semântico fino (session, auth...) DENTRO
  // do pacote; se nenhum aparecer, domínio = nome curto do pacote (core, tui) — não o último dir.
  const within = pkgInfo?.dir ? dirPath.slice(pkgInfo.dir.length + 1) : dirPath
  const parts = within.split("/").filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i].toLowerCase()
    if (DOMAIN_NAMES.has(p)) return p
    if (p === "src" || p === "lib") continue
  }
  return pkgInfo ? packageDomain(pkgInfo.name) : (parts[parts.length - 1] || "root")
}

function isTestFile(fp: string): boolean {
  return fp.endsWith(".test.ts") || fp.endsWith(".test.tsx") ||
    fp.endsWith(".spec.ts") || fp.endsWith(".spec.tsx")
}

function isSourceFile(fp: string): boolean {
  return fp.endsWith(".ts") || fp.endsWith(".tsx") ||
    fp.endsWith(".js") || fp.endsWith(".jsx")
}

/**
 * Determina o módulo de um arquivo: o diretório pai imediato.
 * Arquivos na raiz ficam no módulo "root".
 */
function moduleOf(filePath: string): string {
  const dir = path.dirname(filePath)
  return dir === "." ? "." : dir
}

/**
 * Constrói o module map a partir do ledger + classificações.
 */
export async function buildModuleMap(
  ledger: Ledger,
  classifications: Map<string, Level>,
  root: string,
  graph?: FileGraph,
): Promise<ModuleMap> {
  const allFiles = ledger.passes.flatMap(p => p.files)
  const knownFiles = new Set(allFiles)
  const g = graph ?? await buildFileGraph(ledger, root)
  const workspaces = loadWorkspaces(ledger, root)

  // 1. Agrupa arquivos por módulo (diretório pai)
  const moduleFiles = new Map<string, string[]>()
  for (const f of allFiles) {
    const mod = moduleOf(f)
    const arr = moduleFiles.get(mod) ?? []
    arr.push(f)
    moduleFiles.set(mod, arr)
  }

  // 2. Deps por arquivo (do grafo compartilhado). Só source não-teste, e só arestas entre
  //    arquivos deste ledger (knownFiles) — o grafo pode incluir alvos podados/testes.
  type FileDeps = { imports: Set<string>; exports: number; importedFromOutside: number }
  const fileDeps = new Map<string, FileDeps>()

  for (const f of allFiles) {
    if (!isSourceFile(f) || isTestFile(f)) continue
    const resolved = new Set<string>()
    for (const imp of g.imports.get(f) ?? []) {
      if (knownFiles.has(imp)) resolved.add(imp)
    }
    fileDeps.set(f, {
      imports: resolved,
      exports: g.exports.get(f) ?? 0,
      importedFromOutside: 0,
    })
  }

  // 3. Conta importedFromOutside para cada arquivo
  for (const [f, deps] of fileDeps) {
    const fModule = moduleOf(f)
    for (const imp of deps.imports) {
      const impModule = moduleOf(imp)
      if (impModule !== fModule) {
        const impDeps = fileDeps.get(imp)
        if (impDeps) impDeps.importedFromOutside++
      }
    }
  }

  // 4. Constrói dependências entre módulos
  const moduleImports = new Map<string, Set<string>>() // A imports B
  const moduleImportedBy = new Map<string, Set<string>>() // A imported by B

  for (const [f, deps] of fileDeps) {
    const fModule = moduleOf(f)
    for (const imp of deps.imports) {
      const impModule = moduleOf(imp)
      if (impModule !== fModule) {
        const imports = moduleImports.get(fModule) ?? new Set()
        imports.add(impModule)
        moduleImports.set(fModule, imports)
        const importedBy = moduleImportedBy.get(impModule) ?? new Set()
        importedBy.add(fModule)
        moduleImportedBy.set(impModule, importedBy)
      }
    }
  }

  // 5. Monta ModuleInfo para cada módulo
  const modules: ModuleInfo[] = []

  for (const [modPath, files] of moduleFiles) {
    const sourceFiles = files.filter(f => isSourceFile(f) && !isTestFile(f))
    const testFiles = files.filter(f => isTestFile(f))

    // entry point: arquivo com mais imports de fora do módulo
    let entryPoint: string | null = null
    let maxOutside = 0
    for (const f of sourceFiles) {
      const deps = fileDeps.get(f)
      if (deps && deps.importedFromOutside > maxOutside) {
        maxOutside = deps.importedFromOutside
        entryPoint = f
      }
    }

    // densidade: ratio de imports internos / total imports
    let totalImports = 0
    let internalImports = 0
    for (const f of sourceFiles) {
      const deps = fileDeps.get(f)
      if (!deps) continue
      for (const imp of deps.imports) {
        totalImports++
        if (moduleOf(imp) === modPath) internalImports++
      }
    }
    const density = totalImports > 0 ? internalImports / totalImports : 0

    // cobertura de testes: ratio testFiles / sourceFiles
    const testCoverage = sourceFiles.length > 0 ? testFiles.length / sourceFiles.length : 0

    // distribuição de níveis
    const levels: Record<string, number> = {}
    for (const f of files) {
      const level = classifications.get(f) ?? "P4"
      levels[level] = (levels[level] ?? 0) + 1
    }

    modules.push({
      path: modPath,
      domain: inferDomain(modPath, workspaces),
      fileCount: files.length,
      entryPoint,
      imports: [...(moduleImports.get(modPath) ?? [])].sort(),
      importedBy: [...(moduleImportedBy.get(modPath) ?? [])].sort(),
      density: Math.round(density * 100) / 100,
      testCoverage: Math.round(testCoverage * 100) / 100,
      levels,
    })
  }

  // Ordena por número de importedBy (mais importado = mais central)
  modules.sort((a, b) => b.importedBy.length - a.importedBy.length || b.fileCount - a.fileCount)

  return modules
}

/**
 * Topologia de leitura: ordena módulos para que importados venham antes de importadores.
 * Útil para a fase de claims saber por onde começar.
 */
export function readingOrder(modules: ModuleInfo[]): string[] {
  const visited = new Set<string>()
  const order: string[] = []

  function visit(modPath: string) {
    if (visited.has(modPath)) return
    visited.add(modPath)
    const mod = modules.find(m => m.path === modPath)
    if (!mod) return
    for (const imp of mod.imports) visit(imp)
    order.push(modPath)
  }

  for (const m of modules) visit(m.path)
  return order
}
