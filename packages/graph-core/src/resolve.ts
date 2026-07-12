/**
 * resolve.ts — resolução de imports COMPARTILHADA e tsconfig-aware. Único lugar que
 * transforma (arquivo, spec) → arquivo do ledger. Antes: lógica duplicada (e divergente)
 * em prune.ts e module-map.ts, com `@/` hardcoded pra `src/` na raiz — quebrava em monorepo.
 *
 * Faz UMA passada: lê cada arquivo source uma vez, extrai specs (multiline-aware) + exports,
 * resolve contra os `paths` do tsconfig mais próximo. module-map e prune reusam o mesmo grafo.
 *
 * Monorepo: resolve specs bare de pacotes do workspace via `package.json` `exports`/`main`/`types`
 * (resolução Node/Bun, não tsconfig). `@opencode-ai/core/database/database` → exports de core.
 * Antes do tsconfig alias: um spec que casa um workspace package vira arquivo do ledger, não
 * "pacote externo" — a espinha dorsal de dependência cross-package de um monorepo.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import type { Ledger } from "./descent"
import { extractImports, extractExports, extractImportsAst } from "./extract"
import {
  extractPySpecs, resolvePySpec,
  extractGoSpecs, goModuleName, resolveGoSpec,
  extractRustSpecs, resolveRustSpec,
} from "./imports-lang"

export type FileGraph = {
  /** arquivo → imports resolvidos (caminhos de arquivos do ledger). Inclui testes. */
  imports: Map<string, Set<string>>
  /** arquivo → nº de exports estáticos */
  exports: Map<string, number>
}

function isSource(f: string): boolean {
  return /\.(ts|tsx|js|jsx|py|go|rs)$/.test(f)
}

/** Pacote do workspace (lido de um package.json do ledger). `dir` é relativo à raiz. */
export type WorkspacePkg = {
  name: string
  dir: string
  exports: Record<string, string> | null
  main: string | null
  types: string | null
}

/** Achata um alvo de exports condicional (`{ types, import, default }`) num caminho único. */
function flattenExportTarget(t: unknown): string | null {
  if (typeof t === "string") return t
  if (t && typeof t === "object") {
    const obj = t as Record<string, unknown>
    for (const cond of ["types", "import", "node", "bun", "require", "default"]) {
      if (obj[cond] !== undefined) {
        const r = flattenExportTarget(obj[cond])
        if (r) return r
      }
    }
    for (const v of Object.values(obj)) {
      const r = flattenExportTarget(v)
      if (r) return r
    }
  }
  return null
}

function parseExports(raw: unknown): Record<string, string> | null {
  if (typeof raw === "string") return { ".": raw }
  if (!raw || typeof raw !== "object") return null
  const out: Record<string, string> = {}
  for (const [sub, target] of Object.entries(raw as Record<string, unknown>)) {
    const flat = flattenExportTarget(target)
    if (flat) out[sub] = flat
  }
  return Object.keys(out).length ? out : null
}

/**
 * Coleta todos os package.json do ledger que declaram `name`. Em monorepo cada pacote tem o seu;
 * o resolver escolhe por prefixo de nome (scoped `@scope/name` respeita a fronteira `/`).
 */
export function loadWorkspaces(ledger: Ledger, root: string): WorkspacePkg[] {
  const files = ledger.passes.flatMap((p) => p.files)
  const pkgs: WorkspacePkg[] = []
  for (const f of files) {
    if (path.basename(f) !== "package.json") continue
    let json: any
    try {
      json = JSON.parse(readFileSync(path.join(root, f), "utf8"))
    } catch {
      continue
    }
    if (!json?.name || typeof json.name !== "string") continue
    const dir = path.dirname(f) === "." ? "" : path.dirname(f)
    pkgs.push({
      name: json.name,
      dir,
      exports: parseExports(json.exports),
      main: typeof json.main === "string" ? json.main : null,
      types: typeof json.types === "string" ? json.types : null,
    })
  }
  // nome mais longo primeiro: `@opencode-ai/core` antes de qualquer prefixo mais curto
  pkgs.sort((a, b) => b.name.length - a.name.length)
  return pkgs
}

/** Casca um spec bare num subpath de exports. `@a/b/x` → name `@a/b`, subpath `./x`. */
function splitWorkspaceSpec(spec: string, pkgs: WorkspacePkg[]): { pkg: WorkspacePkg; subpath: string } | null {
  for (const pkg of pkgs) {
    if (spec === pkg.name) return { pkg, subpath: "." }
    if (spec.startsWith(pkg.name + "/")) return { pkg, subpath: "./" + spec.slice(pkg.name.length + 1) }
  }
  return null
}

function matchExport(subpath: string, exports: Record<string, string>): string | null {
  if (exports[subpath]) return exports[subpath]
  for (const [key, target] of Object.entries(exports)) {
    const star = key.indexOf("*")
    if (star < 0) continue
    const pre = key.slice(0, star)
    const post = key.slice(star + 1)
    if (subpath.startsWith(pre) && subpath.endsWith(post) && subpath.length >= pre.length + post.length) {
      const mid = subpath.slice(pre.length, subpath.length - post.length)
      return target.replace("*", mid)
    }
  }
  return null
}

/** Resolve um spec bare que casa um pacote do workspace via exports/main/types. */
function resolveWorkspace(spec: string, pkgs: WorkspacePkg[], knownFiles: Set<string>): string | null {
  const split = splitWorkspaceSpec(spec, pkgs)
  if (!split) return null
  const { pkg, subpath } = split
  let target: string | null = null
  if (pkg.exports) {
    target = matchExport(subpath, pkg.exports)
    if (!target && subpath === ".") target = pkg.main ?? pkg.types
  } else {
    target = subpath === "." ? (pkg.main ?? pkg.types) : null
  }
  if (!target) return null
  const base = path.normalize(path.join(pkg.dir, target))
  return matchFile(base, knownFiles)
}

/**
 * Specs de import via AST (tree-sitter), com cobertura MULTILINHA nativa. Substitui o
 * regex + brace-collapse workaround (v1 spec 10 deferred este passo — agora viável após
 * spec 07 estender extractImportsAst pra todas as linguagens). O `filename` é REQUIRED pra
 * dispatch de linguagem: callers que sintetizam content sem um arquivo real devem passar
 * um nome cuja extensão matches a linguagem do content.
 */
export async function extractSpecs(content: string, filename: string): Promise<string[]> {
  return (await extractImportsAst(content, filename)).map((i) => i.spec)
}

type TsConfig = { dir: string; baseUrl: string; paths: { prefix: string; targets: string[] }[] }

/**
 * Parser tolerante de tsconfig (JSONC): tira comentários e vírgula final.
 * ponytail: teto = quebra se uma string contém `//` ou `/*` literal (raríssimo em tsconfig).
 */
function parseJsonc(text: string): any {
  const noComments = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,(\s*[}\]])/g, "$1")
  return JSON.parse(noComments)
}

/**
 * Coleta todos os tsconfig do ledger que definem `paths`. Em monorepo cada pacote tem o seu;
 * o resolver escolhe o mais profundo que cobre o arquivo importador.
 */
function loadTsConfigs(ledger: Ledger, root: string): TsConfig[] {
  const files = ledger.passes.flatMap((p) => p.files)
  const configs: TsConfig[] = []
  for (const f of files) {
    const base = path.basename(f)
    if (base !== "tsconfig.json" && !(base.startsWith("tsconfig.") && base.endsWith(".json"))) continue
    let json: any
    try {
      json = parseJsonc(readFileSync(path.join(root, f), "utf8"))
    } catch {
      continue
    }
    const co = json?.compilerOptions ?? {}
    if (!co.paths) continue
    const dir = path.dirname(f) === "." ? "" : path.dirname(f)
    const baseUrl = path.normalize(path.join(dir, co.baseUrl ?? "."))
    const paths = Object.entries(co.paths).map(([prefix, targets]) => ({
      prefix,
      targets: (targets as string[]) ?? [],
    }))
    configs.push({ dir, baseUrl, paths })
  }
  // mais específico (dir mais profundo) primeiro
  configs.sort((a, b) => b.dir.length - a.dir.length)
  return configs
}

/** Aplica os `paths` do tsconfig que cobre o importador. Retorna candidatos (sem extensão). */
function applyAlias(spec: string, configs: TsConfig[], importerFile: string): string[] {
  const out: string[] = []
  for (const cfg of configs) {
    if (cfg.dir && importerFile !== cfg.dir && !importerFile.startsWith(cfg.dir + "/")) continue
    for (const p of cfg.paths) {
      const star = p.prefix.indexOf("*")
      if (star === -1) {
        if (spec === p.prefix) for (const t of p.targets) out.push(path.normalize(path.join(cfg.baseUrl, t)))
        continue
      }
      const pre = p.prefix.slice(0, star)
      const post = p.prefix.slice(star + 1)
      if (spec.startsWith(pre) && spec.endsWith(post) && spec.length >= pre.length + post.length) {
        const mid = spec.slice(pre.length, spec.length - post.length)
        for (const t of p.targets) out.push(path.normalize(path.join(cfg.baseUrl, t.replace("*", mid))))
      }
    }
    if (out.length > 0) break // tsconfig mais específico ganha
  }
  return out
}

function matchFile(base: string, knownFiles: Set<string>): string | null {
  if (knownFiles.has(base)) return base
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) if (knownFiles.has(base + ext)) return base + ext
  for (const idx of ["/index.ts", "/index.tsx", "/index.js", "/index.jsx"]) if (knownFiles.has(base + idx)) return base + idx
  return null
}

/**
 * Resolve um spec para um arquivo do ledger, ou null se externo/não-encontrado.
 * Relativo (`.`) → relativo ao dir do importador. Bare → workspace exports primeiro
 * (`@opencode-ai/core/x`), senão aliases do tsconfig, senão externo (node_modules).
 */
export function resolveSpec(
  spec: string,
  importerFile: string,
  configs: TsConfig[],
  knownFiles: Set<string>,
  workspaces: WorkspacePkg[] = [],
): string | null {
  const candidates: string[] = []
  if (spec.startsWith(".")) {
    candidates.push(path.normalize(path.join(path.dirname(importerFile), spec)))
  } else {
    const wsHit = resolveWorkspace(spec, workspaces, knownFiles)
    if (wsHit) return wsHit
    candidates.push(...applyAlias(spec, configs, importerFile))
    if (candidates.length === 0) return null // pacote externo (node_modules)
  }
  for (const base of candidates) {
    const hit = matchFile(base, knownFiles)
    if (hit) return hit
  }
  return null
}

/** Lê cada arquivo source UMA vez e monta o grafo de imports/exports resolvido. */
export async function buildFileGraph(ledger: Ledger, root: string): Promise<FileGraph> {
  const files = ledger.passes.flatMap((p) => p.files)
  const known = new Set(files)
  const configs = loadTsConfigs(ledger, root)
  const workspaces = loadWorkspaces(ledger, root)
  const imports = new Map<string, Set<string>>()
  const exports = new Map<string, number>()

  let goModule: string | null = null
  if (known.has("go.mod")) {
    try {
      goModule = goModuleName(readFileSync(path.join(root, "go.mod"), "utf8"))
    } catch {
      goModule = null
    }
  }

  for (const f of files) {
    if (!isSource(f)) continue
    let content: string
    try {
      content = readFileSync(path.join(root, f), "utf8")
    } catch {
      continue
    }
    const resolved = new Set<string>()
    if (/\.(ts|tsx|js|jsx)$/.test(f)) {
      for (const spec of await extractSpecs(content, f)) {
        const r = resolveSpec(spec, f, configs, known, workspaces)
        if (r && r !== f) resolved.add(r)
      }
      exports.set(f, extractExports(content).length)
    } else if (f.endsWith(".py")) {
      for (const spec of extractPySpecs(content)) {
        const r = resolvePySpec(spec, f, known)
        if (r && r !== f) resolved.add(r)
      }
    } else if (f.endsWith(".go")) {
      for (const spec of extractGoSpecs(content)) {
        for (const r of resolveGoSpec(spec, goModule, known)) if (r !== f) resolved.add(r)
      }
    } else if (f.endsWith(".rs")) {
      for (const spec of extractRustSpecs(content)) {
        const r = resolveRustSpec(spec, f, known)
        if (r && r !== f) resolved.add(r)
      }
    }
    imports.set(f, resolved)
  }
  return { imports, exports }
}

/** Nome do pacote do workspace que possui o arquivo (dir mais profundo vence; raiz só p/ arquivos sem `/`). */
export function packageOf(file: string, workspaces: WorkspacePkg[]): string | null {
  let rootHit: string | null = null
  for (const pkg of workspaces) {
    if (pkg.dir === "") {
      rootHit = pkg.name
      continue
    }
    if (file === pkg.dir || file.startsWith(pkg.dir + "/")) return pkg.name
  }
  if (rootHit && !file.includes("/")) return rootHit
  return null
}

/** Rótulo de domínio curto de um pacote do workspace: último segmento do nome (`core`, `tui`, `sdk`). */
export function packageDomain(pkgName: string): string {
  const seg = pkgName.includes("/") ? pkgName.slice(pkgName.lastIndexOf("/") + 1) : pkgName
  return seg || pkgName
}

/** Inverte o grafo: arquivo importado → lista de importadores (inclui testes). */
export function toDepMap(graph: FileGraph): Map<string, string[]> {
  const dep = new Map<string, string[]>()
  for (const [importer, imps] of graph.imports) {
    for (const imp of imps) {
      const arr = dep.get(imp) ?? []
      arr.push(importer)
      dep.set(imp, arr)
    }
  }
  return dep
}
