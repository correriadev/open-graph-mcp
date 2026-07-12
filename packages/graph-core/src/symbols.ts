/**
 * symbols.ts — projeção determinística do documentSymbol do LSP pro Pass A.
 * O cliente LSP (src/lsp) já dá os símbolos; aqui só PROJETAMOS:
 * - esqueleto: name_path + kind + range + assinatura (detail), SEM corpo → barato pra LLM
 * - body por name_path: fatia o arquivo pelo range → mergulho seletivo
 *
 * name_path (`Classe/metodo`) = id simbólico estável (sobrevive a rename), igual o Serena.
 * Tudo puro — testável sem subir language server. A I/O do LSP mora no tool.
 */

import ts from "typescript"

export type Range = { start: { line: number; character: number }; end: { line: number; character: number } }
/** Símbolo cru do LSP. `children` existe no runtime (LSP hierárquico) mesmo fora do schema do opencode. */
export type RawSym = {
  name: string
  kind: number
  detail?: string
  range?: Range
  location?: { range: Range }
  selectionRange?: Range
  children?: RawSym[]
}

export type FlatSym = {
  namePath: string
  kind: string
  startLine: number // 1-based
  endLine: number // 1-based
  detail?: string
}

// LSP SymbolKind → nome (subset relevante; resto cai em "Symbol")
// 200 = "Type" (alias TS, sem número LSP oficial — código sintético nosso)
// 300/301 = documento (outline.ts): Section = heading, Document = raiz file-stem
const KIND: Record<number, string> = {
  5: "Class", 6: "Method", 9: "Constructor", 10: "Enum", 11: "Interface",
  12: "Function", 13: "Variable", 14: "Constant", 23: "Struct", 8: "Field", 7: "Property", 3: "Namespace", 200: "Type",
  300: "Section", 301: "Document",
}
// kinds que entram no esqueleto por padrão (corta ruído: Field/Property/EnumMember)
const SKELETON_KINDS = new Set([5, 6, 9, 10, 11, 12, 13, 14, 23, 3, 200, 300, 301])

function rangeOf(s: RawSym): Range | undefined {
  return s.range ?? s.location?.range
}

/** Achata a hierarquia LSP em lista, montando name_path `pai/filho`. */
export function flattenSymbols(syms: RawSym[], parent = ""): FlatSym[] {
  const out: FlatSym[] = []
  for (const s of syms) {
    if (!s?.name) continue
    const namePath = parent ? `${parent}/${s.name}` : s.name
    const r = rangeOf(s)
    if (r) {
      out.push({
        namePath,
        kind: KIND[s.kind] ?? "Symbol",
        startLine: r.start.line + 1,
        endLine: r.end.line + 1,
        detail: s.detail?.trim() || undefined,
      })
    }
    if (s.children?.length) out.push(...flattenSymbols(s.children, namePath))
  }
  return out
}

/** Esqueleto TSV: name_path · kind · L{a}-{b} · assinatura. SEM corpo. Filtra ruído. */
export function symbolsToSkeleton(syms: RawSym[]): string {
  const flat = flattenSymbols(syms).filter((s) => isSkeletonKind(s.kind))
  const lines = ["namePath\tkind\tlines\tsignature"]
  for (const s of flat) {
    lines.push(`${s.namePath}\t${s.kind}\tL${s.startLine}-${s.endLine}\t${s.detail ?? ""}`)
  }
  return lines.join("\n") + "\n"
}

function isSkeletonKind(kindName: string): boolean {
  for (const [k, name] of Object.entries(KIND)) {
    if (name === kindName) return SKELETON_KINDS.has(Number(k))
  }
  return false
}

/** Acha um símbolo pelo name_path exato (recursivo). */
export function findByNamePath(syms: RawSym[], namePath: string, parent = ""): RawSym | null {
  for (const s of syms) {
    if (!s?.name) continue
    const np = parent ? `${parent}/${s.name}` : s.name
    if (np === namePath) return s
    if (s.children?.length) {
      const hit = findByNamePath(s.children, namePath, np)
      if (hit) return hit
    }
  }
  return null
}

/** Fatia o corpo de um símbolo do conteúdo do arquivo, pelo range (linhas 0-based do LSP). */
export function sliceBody(content: string, sym: RawSym): string {
  const r = rangeOf(sym)
  if (!r) return ""
  const lines = content.split(/\r?\n/)
  return lines.slice(r.start.line, r.end.line + 1).join("\n")
}

/** Linha-âncora verbatim = a linha do selectionRange (nome do símbolo), ou 1ª linha do range. */
export function anchorOf(content: string, sym: RawSym): string {
  const r = sym.selectionRange ?? rangeOf(sym)
  if (!r) return ""
  return content.split(/\r?\n/)[r.start.line] ?? ""
}

// ── Extração via TS Compiler API (síncrona, sem LSP/rede/processo) ────────────
// Mesmo motor que o tsserver embrulha, usado direto pro caso TS/JS (foco brownfield).
// Produz RawSym (mesma forma do documentSymbol do LSP) → reusa toda a projeção acima.

const TS_FAMILY = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"])
export function isTsFamily(filename: string): boolean {
  const dot = filename.lastIndexOf(".")
  return dot >= 0 && TS_FAMILY.has(filename.slice(dot).toLowerCase())
}

const TS_KIND: Partial<Record<ts.SyntaxKind, number>> = {
  [ts.SyntaxKind.FunctionDeclaration]: 12,
  [ts.SyntaxKind.ClassDeclaration]: 5,
  [ts.SyntaxKind.InterfaceDeclaration]: 11,
  [ts.SyntaxKind.TypeAliasDeclaration]: 200,
  [ts.SyntaxKind.EnumDeclaration]: 10,
  [ts.SyntaxKind.ModuleDeclaration]: 3,
  [ts.SyntaxKind.MethodDeclaration]: 6,
  [ts.SyntaxKind.MethodSignature]: 6,
  [ts.SyntaxKind.GetAccessor]: 6,
  [ts.SyntaxKind.SetAccessor]: 6,
  [ts.SyntaxKind.Constructor]: 9,
  [ts.SyntaxKind.PropertyDeclaration]: 7,
  [ts.SyntaxKind.PropertySignature]: 7,
}

function rangeFrom(sf: ts.SourceFile, node: ts.Node): Range {
  const s = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  const e = sf.getLineAndCharacterOfPosition(node.getEnd())
  return { start: { line: s.line, character: s.character }, end: { line: e.line, character: e.character } }
}

function sigOf(sf: ts.SourceFile, node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) ||
    ts.isMethodSignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
  ) {
    const params = node.parameters.map((p) => p.getText(sf)).join(", ")
    const ret = (node as ts.SignatureDeclaration).type ? `: ${(node as ts.SignatureDeclaration).type!.getText(sf)}` : ""
    return `(${params})${ret}`.replace(/\s+/g, " ")
  }
  return undefined
}

function memberToSym(sf: ts.SourceFile, m: ts.ClassElement | ts.TypeElement): RawSym | null {
  const kind = TS_KIND[m.kind]
  if (kind === undefined) return null
  const name = ts.isConstructorDeclaration(m) ? "constructor" : (m as any).name?.getText(sf)
  if (!name) return null
  const nameNode = (m as any).name as ts.Node | undefined
  return {
    name, kind, detail: sigOf(sf, m),
    range: rangeFrom(sf, m),
    selectionRange: nameNode ? rangeFrom(sf, nameNode) : rangeFrom(sf, m),
  }
}

function childrenOf(sf: ts.SourceFile, node: ts.Node): RawSym[] {
  const members = ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) ? node.members : undefined
  if (!members) return []
  const out: RawSym[] = []
  for (const m of members) {
    const s = memberToSym(sf, m as ts.ClassElement)
    if (s) out.push(s)
  }
  return out
}

function nodeToSyms(sf: ts.SourceFile, node: ts.Node): RawSym[] {
  // const/let/var: cada declarador vira um símbolo
  if (ts.isVariableStatement(node)) {
    const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0
    return node.declarationList.declarations
      .filter((d) => ts.isIdentifier(d.name))
      .map((d) => ({
        name: d.name.getText(sf), kind: isConst ? 14 : 13,
        range: rangeFrom(sf, node), selectionRange: rangeFrom(sf, d.name),
      }))
  }
  const kind = TS_KIND[node.kind]
  const nameNode = (node as any).name as ts.Node | undefined
  if (kind === undefined || !nameNode) return []
  return [{
    name: nameNode.getText(sf), kind, detail: sigOf(sf, node),
    range: rangeFrom(sf, node), selectionRange: rangeFrom(sf, nameNode),
    children: childrenOf(sf, node),
  }]
}

/**
 * Nomes dos símbolos top-level EXPORTADOS (pro gate symbol-level da cobertura A).
 * Cobertura completa (spec v2-09): inline `export function/const/class/type/interface/enum`,
 * `export { a, b as c }` (o nome EXPORTADO, não o local), `export default ...` → `default`,
 * `export { y } from "./x"` (y faz parte da superfície deste módulo), e `export * from "./x"`
 * (sem símbolos locais — a expansão transitiva viveria em outro módulo; ponytail: barrels
 * under-demand até um repo real provar falta). `export default function foo()` → `default`
 * (o nome do consumer é `default`, não `foo`).
 */
export function exportedSymbols(content: string, filename = "f.ts"): string[] {
  const sf = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true)
  const out: string[] = []
  const hasExport = (node: ts.Node) =>
    ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  sf.forEachChild((node) => {
    if (ts.isExportDeclaration(node)) {
      // export { a, b as c } [from "./x"]  OR  export * from "./x"
      const clause = node.exportClause
      if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          // el.name = the EXPORTED name (after `as`); el.propertyName = the local name (before `as`)
          out.push(el.name.getText(sf))
        }
      }
      // export * from "./x" → no local symbols (transitive re-export expansion out of scope)
      return
    }
    if (ts.isExportAssignment(node)) {
      // export default <expression> (not a named function/class decl) → exported name is "default"
      out.push("default")
      return
    }
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    const isDefault = modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    if (isDefault) {
      // `export default function foo()` / `export default class Foo {}` — these are declarations
      // with DefaultKeyword, NOT ExportAssignment; the consumer-visible name is "default", not foo
      out.push("default")
      return
    }
    const isExported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!isExported) return
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) out.push(d.name.getText(sf))
      }
    } else {
      const name = (node as any).name as ts.Node | undefined
      if (name) out.push(name.getText(sf))
    }
  })
  return out
}

/** Extrai símbolos top-level (+ membros de classe/interface) via parser TS. Síncrono, sem LSP. */
export function extractSymbols(content: string, filename = "f.ts"): RawSym[] {
  const sf = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true)
  const out: RawSym[] = []
  // forEachChild PARA se o callback retorna truthy — push retorna length (>0), então envolve em bloco void
  sf.forEachChild((node) => {
    out.push(...nodeToSyms(sf, node))
  })
  return out
}
