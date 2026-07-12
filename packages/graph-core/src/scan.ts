/**
 * scan.ts — canivete brownfield v0 (lâminas 1–4 das 30). TS puro + casca fs síncrona,
 * no molde de gate.ts. Sem LLM: emite só o verificável (regra acquire-codebase).
 * ponytail: só poda/stack/fingerprint/listagem-1-nível. Outras 26 lâminas quando um repo provar falta.
 */

import { readdirSync, readFileSync, existsSync, type Dirent } from "node:fs"
import path from "node:path"

// .graph é a casa do próprio grafo — o canivete não reporta o próprio workspace.
export const DEFAULT_IGNORE = ["node_modules", ".next", "dist", "build", ".git", ".graph"]
const MARKERS = ["src", "test", "tests", "docs", "public", ".github"]

export type StackInfo = { deps: string[]; scripts: Record<string, string>; workspaces: string[] }
export type Entry = { name: string; isDir: boolean }
export type Fingerprint = {
  dirs: string[]
  files: string[]
  markers: string[]
  byExt: Record<string, number>
}

/** Lâmina 1: poda. Ignora defaults + extras recebidos (canal adaptativo entre loops). */
export function shouldIgnore(name: string, defaults: string[], extra: string[]): boolean {
  return defaults.includes(name) || extra.includes(name)
}

/** Lê o campo `workspaces` (array de globs OU `{ packages: [...] }`) → lista de padrões. */
function readWorkspaces(pkg: Record<string, any>): string[] {
  const w: unknown = pkg.workspaces
  if (Array.isArray(w)) return (w as unknown[]).filter((s): s is string => typeof s === "string")
  if (w && typeof w === "object" && Array.isArray((w as { packages?: unknown }).packages))
    return ((w as { packages: unknown[] }).packages).filter((s): s is string => typeof s === "string")
  return []
}

/** Lâmina 2: stack via manifesto. Recebe o package.json já parseado (ou null). */
export function detectStack(pkg: unknown): StackInfo | null {
  if (!pkg || typeof pkg !== "object") return null
  const p = pkg as Record<string, any>
  const deps = [...Object.keys(p.dependencies ?? {}), ...Object.keys(p.devDependencies ?? {})]
  const scripts = (p.scripts ?? {}) as Record<string, string>
  return { deps, scripts, workspaces: readWorkspaces(p) }
}

/** Lâmina 3: fingerprint do nível (não dump). */
export function summarizeEntries(entries: Entry[]): Fingerprint {
  const dirs: string[] = []
  const files: string[] = []
  const byExt: Record<string, number> = {}
  for (const e of entries) {
    if (e.isDir) {
      dirs.push(e.name)
    } else {
      files.push(e.name)
      const dot = e.name.lastIndexOf(".")
      if (dot > 0) {
        const ext = e.name.slice(dot)
        byExt[ext] = (byExt[ext] ?? 0) + 1
      }
    }
  }
  dirs.sort()
  files.sort()
  const markers = MARKERS.filter((m) => dirs.includes(m)).map((m) => m + "/")
  return { dirs, files, markers, byExt }
}

export type ScanResult = { dir: string; stack: StackInfo | null; fingerprint: Fingerprint; graphPresent: boolean }

/** Lâmina 4: listagem 1-nível + poda + stack. Síncrono (callable dentro de Effect.sync). */
export function scanRoot(dir: string, opts: { ignore?: string[]; defaults?: string[] } = {}): ScanResult {
  const defaults = opts.defaults ?? DEFAULT_IGNORE
  const extra = opts.ignore ?? []
  const raw = readdirSync(dir, { withFileTypes: true })
  const entries: Entry[] = raw
    .filter((d) => !shouldIgnore(d.name, defaults, extra))
    .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
  let pkg: unknown = null
  const pkgPath = path.join(dir, "package.json")
  if (existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
    } catch {
      pkg = null
    }
  }
  return { dir, stack: detectStack(pkg), fingerprint: summarizeEntries(entries), graphPresent: graphPresent(dir) }
}

/** Check determinístico (dobra a antiga graph.build da spec): há grafo/step0 gravado? */
export function graphPresent(dir: string): boolean {
  const base = path.join(dir, ".graph")
  return existsSync(path.join(base, "graph.json")) || existsSync(path.join(base, "ledger.json"))
}

/** Lâmina census: contagem recursiva prune-aware (denominador de cobertura). Não segue symlink. */
export function census(dir: string, extraIgnore: string[] = []): { totalFiles: number; totalDirs: number } {
  let totalFiles = 0
  let totalDirs = 0
  const walk = (d: string) => {
    let entries: Dirent[]
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      if (shouldIgnore(e.name, DEFAULT_IGNORE, extraIgnore)) continue
      if (e.isDirectory()) {
        totalDirs++
        walk(path.join(d, e.name))
      } else if (e.isFile()) {
        totalFiles++
      }
    }
  }
  walk(dir)
  return { totalFiles, totalDirs }
}
