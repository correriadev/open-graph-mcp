/**
 * imports-lang.ts — extração/resolução de imports pra python/go/rust, SÍNCRONA
 * (linha-orientada, regex — sem tree-sitter, sem processo). Alimenta buildFileGraph.
 * Melhor-esforço: spec não resolvido = externo (mesma política do TS/node_modules).
 * ponytail: python `from . import x` vira aresta pro __init__.py (não pro x.py);
 * rust super::/self:: fora; go vendor/ fora. Upgrade se um repo real provar falta.
 */
import path from "node:path"

// ── Python ────────────────────────────────────────────────────────────────────
export function extractPySpecs(content: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of content.split(/\r?\n/)) {
    const m = /^\s*(?:from\s+([.\w]+)\s+import\b|import\s+([\w.]+(?:\s*,\s*[\w.]+)*))/.exec(line)
    if (!m) continue
    const specs = m[1] ? [m[1]] : m[2]!.split(/\s*,\s*/)
    for (const s of specs) if (!seen.has(s)) { seen.add(s); out.push(s) }
  }
  return out
}

function pyCandidates(base: string, rest: string[]): string[] {
  const p = rest.length ? path.posix.join(base, ...rest) : base
  return rest.length ? [`${p}.py`, `${p}/__init__.py`] : [`${p}/__init__.py`]
}

export function resolvePySpec(spec: string, importerFile: string, knownFiles: Set<string>): string | null {
  const dots = /^\.*/.exec(spec)![0].length
  const rest = spec.slice(dots) ? spec.slice(dots).split(".") : []
  let base: string
  if (dots > 0) {
    base = path.posix.dirname(importerFile)
    for (let i = 1; i < dots; i++) base = path.posix.dirname(base)
    if (base === ".") base = ""
  } else {
    base = "" // raiz do repo; ponytail: sem sys.path/pyproject roots — upgrade se um repo real precisar
  }
  for (const cand of pyCandidates(base, rest)) {
    const norm = path.posix.normalize(cand)
    if (knownFiles.has(norm)) return norm
  }
  return null
}

// ── Go ────────────────────────────────────────────────────────────────────────
export function extractGoSpecs(content: string): string[] {
  const out: string[] = []
  let inBlock = false
  for (const line of content.split(/\r?\n/)) {
    if (inBlock) {
      if (/^\s*\)/.test(line)) { inBlock = false; continue }
      const m = /"([^"]+)"/.exec(line)
      if (m) out.push(m[1])
      continue
    }
    if (/^\s*import\s*\(\s*$/.test(line)) { inBlock = true; continue }
    const single = /^\s*import\s+(?:\w+\s+|\.\s+|_\s+)?"([^"]+)"/.exec(line)
    if (single) out.push(single[1])
  }
  return out
}

export function goModuleName(goModContent: string): string | null {
  const m = /^\s*module\s+(\S+)/m.exec(goModContent)
  return m ? m[1] : null
}

/** Import de pacote = TODOS os .go do dir (semântica Go: pacote = diretório). */
export function resolveGoSpec(spec: string, module: string | null, knownFiles: Set<string>): string[] {
  if (!module) return []
  let dir: string
  if (spec === module) dir = ""
  else if (spec.startsWith(module + "/")) dir = spec.slice(module.length + 1)
  else return [] // externo
  const out: string[] = []
  for (const f of knownFiles) {
    if (!f.endsWith(".go")) continue
    if (path.posix.dirname(f) === (dir === "" ? "." : dir)) out.push(f)
  }
  return out
}

// ── Rust ──────────────────────────────────────────────────────────────────────
export type RustSpec = { kind: "use" | "mod"; path: string }

export function extractRustSpecs(content: string): RustSpec[] {
  const out: RustSpec[] = []
  for (const line of content.split(/\r?\n/)) {
    const use = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:]+)/.exec(line)
    if (use) {
      // corta no `::{` (lista) — o caminho de módulo é o que interessa
      const raw = line.includes("::{")
        ? line.slice(0, line.indexOf("::{")).replace(/^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+/, "")
        : use[1]
      out.push({ kind: "use", path: raw.replace(/;$/, "").trim() })
      continue
    }
    const mod = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/.exec(line)
    if (mod) out.push({ kind: "mod", path: mod[1] })
  }
  return out
}

/** Raiz do crate = diretório `src` mais próximo acima do importador (ponytail: layout cargo padrão). */
function crateRoot(importerFile: string): string | null {
  const parts = importerFile.split("/")
  const i = parts.lastIndexOf("src")
  return i >= 0 ? parts.slice(0, i + 1).join("/") : null
}

export function resolveRustSpec(spec: RustSpec, importerFile: string, knownFiles: Set<string>): string | null {
  if (spec.kind === "mod") {
    const dir = path.posix.dirname(importerFile)
    for (const cand of [`${dir}/${spec.path}.rs`, `${dir}/${spec.path}/mod.rs`]) {
      const norm = path.posix.normalize(cand)
      if (knownFiles.has(norm)) return norm
    }
    return null
  }
  if (!spec.path.startsWith("crate::")) return null // std/externo/super/self — fora do floor
  const root = crateRoot(importerFile)
  if (!root) return null
  const segs = spec.path.split("::").slice(1)
  for (let k = segs.length; k >= 1; k--) {
    const p = `${root}/${segs.slice(0, k).join("/")}`
    if (knownFiles.has(`${p}.rs`)) return `${p}.rs`
    if (knownFiles.has(`${p}/mod.rs`)) return `${p}/mod.rs`
  }
  return null
}
