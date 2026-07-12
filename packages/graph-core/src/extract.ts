/**
 * extract.ts — piso determinístico da decomposição (loop 2b-det). Regex de imports/exports
 * ESTÁTICOS de TS/JS. TS puro, sem LLM.
 * ponytail: floor regex SINGLE-LINE. GAPS CONHECIDOS cobertos pela rede LLM (2b-llm Decomposer lê o
 * arquivo inteiro) e pelo upgrade AST futuro: import MULTILINHA (`import {\n...\n} from "x"`),
 * dynamic-import com expressão, re-export exótico, outras linguagens. Multilinha NÃO é regex-eável
 * com segurança (o `[\s\S]*?` mescla statements quando um import anterior não tem `from`).
 */

export type ImportRef = { spec: string; line: string }
export type ExportRef = { name: string; line: string }

const IMPORT_PATTERNS: RegExp[] = [
  /\bimport\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/, // import ... from "x"
  /\bimport\s*['"]([^'"]+)['"]/, //               import "x"
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/, //     require("x")
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/, //      import("x")
]

/** Imports estáticos. `line` = a linha literal (excerpt re-checável). Dedup por (spec, line). */
export function extractImports(content: string): ImportRef[] {
  const out: ImportRef[] = []
  const seen = new Set<string>()
  for (const line of content.split(/\r?\n/)) {
    for (const re of IMPORT_PATTERNS) {
      const m = re.exec(line)
      if (m) {
        const spec = m[1]
        const key = spec + " " + line
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ spec, line })
        }
      }
    }
  }
  return out
}

/**
 * AST (tree-sitter) das mesmas 4 formas estáticas que IMPORT_PATTERNS cobre, MAIS o caso
 * multilinha (`import {\n...\n} from "x"`) que o regex line-by-line não alcança com segurança
 * (ver header do módulo). Ativa pra todas as linguagens com gramática carregada (TS/TSX/Go/
 * Python/Rust via anchorLangOf); qualquer extensão sem gramática cai no piso `extractImports`.
 * `line` = primeira linha do texto do nó (contrato "excerpt re-checável": é sempre substring
 * literal de `content`, então excerptCheck(content, line) bate). Dedup por (spec, line), igual
 * ao regex. Dynamic import com argumento não-literal (`import(x)`) não resolve estaticamente —
 * não contribui, não lança (mesma semântica do piso regex de hoje).
 */
export async function extractImportsAst(content: string, filename: string): Promise<ImportRef[]> {
  const lang = anchorLangOf(filename)
  if (!lang) return extractImports(content)

  const tree = await parseLang(lang, content)
  const out: ImportRef[] = []
  const seen = new Set<string>()

  const firstLine = (text: string): string => {
    const nl = text.indexOf("\n")
    return nl < 0 ? text : text.slice(0, nl)
  }
  const stringContent = (n: Node): string | null => (n.text.length >= 2 ? n.text.slice(1, -1) : null)
  const push = (spec: string, node: Node): void => {
    const line = firstLine(node.text)
    const key = spec + " " + line
    if (!seen.has(key)) {
      seen.add(key)
      out.push({ spec, line })
    }
  }

  if (lang === "typescript" || lang === "tsx") {
    const walk = (node: Node): void => {
      if (node.type === "import_statement") {
        const source = node.childForFieldName("source")
        if (source && source.type === "string") {
          const spec = stringContent(source)
          if (spec !== null) push(spec, node)
        }
      } else if (node.type === "call_expression") {
        const fn = node.childForFieldName("function")
        const isStaticSpecSource = fn && (fn.type === "import" || (fn.type === "identifier" && fn.text === "require"))
        if (isStaticSpecSource) {
          const args = (node.childForFieldName("arguments")?.namedChildren ?? []).filter((c): c is Node => !!c)
          if (args.length === 1 && args[0]!.type === "string") {
            const spec = stringContent(args[0]!)
            if (spec !== null) push(spec, node)
          }
        }
      }
      for (const c of node.children) if (c) walk(c)
    }
    walk(tree.rootNode)
  } else if (lang === "go") {
    // Go: import_declaration → import_spec (single) or import_spec_list → import_spec children.
    // `line` = first line of the individual import_spec's text (NOT the whole block — the
    // excerpt-re-checkable contract needs a line that exists verbatim per spec).
    const walk = (node: Node): void => {
      if (node.type === "import_spec") {
        const pathNode = node.childForFieldName("path")
        if (pathNode && pathNode.type === "interpreted_string_literal") {
          const spec = stringContent(pathNode)
          if (spec !== null) push(spec, node)
        }
      }
      for (const c of node.children) if (c) walk(c)
    }
    walk(tree.rootNode)
  } else if (lang === "python") {
    // Python: import_statement (`import a.b` → one ref per dotted_name) and import_from_statement
    // (`from x import (a, b)` → ONE ref with spec `x`; the imported names are not separate sources —
    // mirrors what imports-lang.ts's regex extracts today so the resolver contract is unchanged).
    // Relative `from . import x` keeps producing the leading-dots spec string exactly as the regex does.
    const walk = (node: Node): void => {
      if (node.type === "import_statement") {
        for (const child of node.namedChildren) {
          if (!child) continue
          if (child.type === "dotted_name") push(child.text, node)
          else if (child.type === "aliased_import") {
            const name = child.childForFieldName("name")
            if (name) push(name.text, node)
          }
        }
      } else if (node.type === "import_from_statement") {
        // Reconstruct the module spec from the text between 'from' and 'import' — this captures
        // leading dots (relative imports) + the dotted module name exactly as imports-lang.ts's
        // regex does, without depending on grammar-specific field/node names for relative imports.
        const text = node.text
        const fromEnd = text.indexOf("from") + 4
        const importStart = text.indexOf("import", fromEnd)
        if (importStart > fromEnd) {
          const spec = text.slice(fromEnd, importStart).trim()
          if (spec) push(spec, node)
        }
      }
      for (const c of node.children) if (c) walk(c)
    }
    walk(tree.rootNode)
  } else if (lang === "rust") {
    // Rust: use_declaration → spec = the use path argument text, cut at `::{` if grouped (matches
    // imports-lang.ts's regex behavior exactly). `mod` declarations are NOT import forms and stay
    // on imports-lang.ts's regex path (they carry a `kind` discriminant the resolver needs).
    const walk = (node: Node): void => {
      if (node.type === "use_declaration") {
        const arg = node.childForFieldName("argument")
        if (arg) {
          let spec = arg.text
          const braceIdx = spec.indexOf("::{")
          if (braceIdx >= 0) spec = spec.slice(0, braceIdx)
          spec = spec.replace(/;$/, "").trim()
          if (spec) push(spec, node)
        }
      }
      for (const c of node.children) if (c) walk(c)
    }
    walk(tree.rootNode)
  }

  return out
}

/** Exports: default, * from, declaração nomeada, e lista entre chaves (cada nome vira um ref). */
export function extractExports(content: string): ExportRef[] {
  const out: ExportRef[] = []
  for (const line of content.split(/\r?\n/)) {
    if (/\bexport\s+default\b/.test(line)) out.push({ name: "default", line })
    if (/\bexport\s+\*\s+from\s*['"][^'"]+['"]/.test(line)) out.push({ name: "*", line })
    const decl = /\bexport\s+(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (decl) out.push({ name: decl[1], line })
    const braced = /\bexport\s*\{([^}]*)\}/.exec(line)
    if (braced) {
      for (const part of braced[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].trim()
        if (name) out.push({ name, line })
      }
    }
  }
  return out
}

/** Âncora verbatim: excerpt existe LITERAL no conteúdo (normaliza só CRLF→LF). */
export function excerptCheck(content: string, excerpt: string): boolean {
  return content.replace(/\r\n/g, "\n").includes(excerpt.replace(/\r\n/g, "\n"))
}

// ── Anchor (loop 2b-det hardening): canonical token-stream identity ────────────
// A âncora verbatim (excerptCheck acima) sofre de flapping: qualquer reformatação
// (aspas, ponto-e-vírgula, quebra de linha) muda o texto literal e derruba o match.
// resolveAnchor projeta a árvore tree-sitter do símbolo resolvido (por symbolPath, NÃO
// por posição de linha) num stream de tokens canônico — identificadores, literais,
// keywords, operadores/pontuação com significado semântico — e compara o hash desse
// stream contra o hash salvo. Comentários e trivia NUNCA entram no stream: uma âncora
// colada dentro de um `// comment` não pode casar (INV-H1-1), porque symbolPath só
// resolve pra um nó de declaração real, nunca pro texto de um comentário.
import { createHash } from "node:crypto"
import type { Node } from "web-tree-sitter"
import { parseLang, type TreeLang } from "./treesitter"

export type AnchorGrade = "match" | "renamed" | "structural" | "gone"
export type ResolvedAnchor = {
  grade: AnchorGrade
  tokenHash: string | null
  renameStableHash: string | null
  newSymbolPath?: string
  /** First line of the resolved node's text. Present whenever a node was resolved (match/structural/renamed);
   *  absent on "gone". Used by watch.ts heal write-back (specs 02/03) to refresh the verbatim anchor. */
  firstLine?: string
}

/** First line of `text` (no trailing newline). Pure, allocation-light. */
const firstLineOf = (text: string): string => {
  const nl = text.indexOf("\n")
  return nl < 0 ? text : text.slice(0, nl)
}

/** Tipos de nó tree-sitter-typescript/tsx que carregam um `name` e contam como segmento de symbolPath. */
const TS_DECL_TYPES = new Set([
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "abstract_class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "method_definition",
  "variable_declarator", // const/let/var binding (export const X = …); carries a `name` field
  "module", // namespace/module TS
])

// tree-sitter-go: function_declaration/method_declaration/type_spec todos expõem um campo `name`
// (verificado contra a gramática real). `type_declaration` é só o wrapper (`type X struct{}`) —
// quem carrega o `name` é o `type_spec` filho, então é ele que entra no registry, não o wrapper.
const GO_DECL_TYPES = new Set(["function_declaration", "method_declaration", "type_spec"])

// tree-sitter-python: function_definition/class_definition ambos expõem um campo `name`. Uma
// função decorada (@foo\ndef bar(): ...) é envolvida num nó `decorated_definition`, mas esse
// wrapper NÃO carrega `name` — quem carrega é o `function_definition` filho, que fica intacto
// dentro do wrapper. Os decorators ficam no ancestral (decorated_definition), nunca no nó âncora;
// symbolPathOf/findBySymbolPath andam por ancestralidade de declTypes, então o decorated_definition
// simplesmente não entra no path (não está no Set) e o function_definition filho resolve normal.
const PYTHON_DECL_TYPES = new Set(["function_definition", "class_definition"])

// tree-sitter-rust: function_item/struct_item/enum_item/trait_item/mod_item todos expõem um campo
// `name` (verificado contra node-types.json da gramática real). `impl_item` é diferente: NÃO tem
// campo `name` — tem um campo `type` (o tipo sendo implementado, ex. `impl Server { ... }` →
// type_identifier "Server"). Mantido no registry com special-case em declName() abaixo, porque dá
// aos métodos um symbolPath natural "Server/start" (em vez de deixar os métodos sem path nenhum).
const RUST_DECL_TYPES = new Set([
  "function_item",
  "struct_item",
  "enum_item",
  "trait_item",
  "mod_item",
  "impl_item",
])

/**
 * Registry per-TreeLang dos tipos de nó de declaração — um segmento de symbolPath por entrada.
 * Adicionar uma linguagem = uma entrada aqui + um mapeamento em anchorLangOf (ver spec 08 Python).
 */
export const DECL_TYPES_BY_LANG: Partial<Record<TreeLang, Set<string>>> = {
  typescript: TS_DECL_TYPES,
  tsx: TS_DECL_TYPES,
  go: GO_DECL_TYPES,
  python: PYTHON_DECL_TYPES,
  rust: RUST_DECL_TYPES,
}

export function declTypesFor(lang: TreeLang): Set<string> {
  return DECL_TYPES_BY_LANG[lang] ?? TS_DECL_TYPES
}

/**
 * .ts/.mts/.cts → gramática "typescript"; .tsx → gramática "tsx" (JSX). Só pro primitivo de
 * âncora — deliberadamente separado do langOf()/EXT de treesitter.ts (ver comentário lá: mudar
 * aquele EXT quebraria o teste existente `langOf("f.ts") === null`, fora do escopo deste dispatch).
 */
export function anchorLangOf(filename: string): TreeLang | null {
  const dot = filename.lastIndexOf(".")
  if (dot < 0) return null
  const ext = filename.slice(dot).toLowerCase()
  if (ext === ".tsx") return "tsx"
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return "typescript"
  if (ext === ".go") return "go"
  if (ext === ".py" || ext === ".pyi") return "python"
  if (ext === ".rs") return "rust"
  return null
}

function declName(n: Node): string | null {
  // impl_item (Rust) não tem campo `name` — o tipo implementado mora no campo `type`
  // (ver RUST_DECL_TYPES acima). Special-case verificado contra node-types.json real.
  if (n.type === "impl_item") {
    const ty = n.childForFieldName("type")
    return ty ? ty.text : null
  }
  const nm = n.childForFieldName("name")
  return nm ? nm.text : null
}

/**
 * Deriva o symbolPath (um segmento por ancestral de declType, raiz→folha) de um nó da árvore.
 * Pura função da ancestralidade do nó (que por sua vez é pura função de source bytes). Exportada
 * pra reuso por quem for materializar âncoras nesse formato (dispatch separado). `declTypes` é
 * per-linguagem (ver DECL_TYPES_BY_LANG); default TS_DECL_TYPES mantém callers existentes intactos.
 */
export function symbolPathOf(node: Node, declTypes: Set<string> = TS_DECL_TYPES): string {
  const segments: string[] = []
  let n: Node | null = node
  while (n) {
    if (declTypes.has(n.type)) {
      const name = declName(n)
      if (name) segments.unshift(name)
    }
    n = n.parent
  }
  return segments.join("/")
}

/**
 * Acha o nó de declaração cujo symbolPath derivado == symbolPath pedido. DFS em ordem do source.
 * `declTypes` per-linguagem (default TS_DECL_TYPES, backward-compatible).
 */
export function findBySymbolPath(root: Node, symbolPath: string, declTypes: Set<string> = TS_DECL_TYPES): Node | null {
  const segments = symbolPath.split("/").filter(Boolean)
  if (segments.length === 0) return null

  function search(node: Node, idx: number): Node | null {
    for (const child of node.namedChildren) {
      if (!child) continue
      if (declTypes.has(child.type) && declName(child) === segments[idx]) {
        if (idx === segments.length - 1) return child
        const body = child.childForFieldName("body") ?? child
        const found = search(body, idx + 1)
        if (found) return found
        continue // este ramo não completa o path restante; não adianta descer genérico nele de novo
      }
      const nested = search(child, idx)
      if (nested) return nested
    }
    return null
  }
  return search(root, 0)
}

// Folhas puramente sintáticas: aspas de string (normaliza estilo `"`/`'`/`` ` ``), `;` (ASI —
// opcional, não-semântico) e comentários. Excluídas do stream canônico por design (não por bug).
const TS_SKIP_LEAF_TYPES = new Set(['"', "'", "`", ";", "comment"])
// Go: comentários e `;` (o grammar também insere `;` via ASI em alguns pontos do CST); Go não tem
// aspas como node type próprio pra strings (interpreted_string_literal é folha única, sem filhos
// de aspas separados), então não há entrada equivalente a '"'/'`' aqui.
const GO_SKIP_LEAF_TYPES = new Set(["comment", ";"])
// Python: comentários, e as bordas de string `string_start`/`string_end` — a gramática representa
// o estilo de aspas (`'`, `"`, `'''`, `"""`, prefixos como f/r/b) como esses dois nós-folha
// dedicados, não como texto literal dentro de um nó de string única. Puular os dois faz `'x'` e
// `"x"` produzirem o mesmo stream de tokens (o conteúdo em si, via `string_content`, permanece).
const PYTHON_SKIP_LEAF_TYPES = new Set(["comment", "string_start", "string_end"])
// Rust: ao contrário de TS/Go/Python (onde "comment" é sempre um nó-folha, childCount 0), a
// gramática tree-sitter-rust não tem um node type "comment" — tem "line_comment"/"block_comment",
// e AMBOS carregam filhos próprios (o marcador `//`/`/*`/`*/`, e pra doc-comments `///`/`//!` os
// nós outer_doc_comment_marker/inner_doc_comment_marker + doc_comment). Por isso collectTokens/
// renameStableHashOf (abaixo) checam skipLeafTypes ANTES do childCount===0, não só na folha —
// senão um comentário com filhos vazaria tokens dos seus marcadores no stream canônico.
const RUST_SKIP_LEAF_TYPES = new Set(["line_comment", "block_comment", ";"])

const SKIP_LEAF_TYPES_BY_LANG: Partial<Record<TreeLang, Set<string>>> = {
  typescript: TS_SKIP_LEAF_TYPES,
  tsx: TS_SKIP_LEAF_TYPES,
  go: GO_SKIP_LEAF_TYPES,
  python: PYTHON_SKIP_LEAF_TYPES,
  rust: RUST_SKIP_LEAF_TYPES,
}

export function skipLeafTypesFor(lang?: TreeLang): Set<string> {
  return (lang && SKIP_LEAF_TYPES_BY_LANG[lang]) ?? TS_SKIP_LEAF_TYPES
}

function collectTokens(node: Node, out: string[], skipLeafTypes: Set<string>): void {
  // Checa skipLeafTypes ANTES do childCount: em TS/Go/Python "comment" é sempre leaf (childCount
  // 0), mas em Rust line_comment/block_comment carregam filhos (marcador + doc_comment) — se só
  // checássemos na folha, esses filhos vazariam pro stream canônico. Checar aqui cobre os dois
  // casos sem mudar comportamento existente (skipLeafTypes de TS/Go/Python só contém leaves mesmo).
  if (skipLeafTypes.has(node.type)) return
  if (node.childCount === 0) {
    out.push(node.text)
    return
  }
  for (const c of node.children) if (c) collectTokens(c, out, skipLeafTypes)
}

/**
 * sha256 hex do stream de tokens canônico da subtree do nó (join sem separador, ver spec).
 * `skipLeafTypes` per-linguagem (default TS_SKIP_LEAF_TYPES, backward-compatible).
 */
export function tokenHashOf(node: Node, skipLeafTypes: Set<string> = TS_SKIP_LEAF_TYPES): string {
  const tokens: string[] = []
  collectTokens(node, tokens, skipLeafTypes)
  return createHash("sha256").update(tokens.join("")).digest("hex")
}

// Leaves that are USER-CHOSEN names (values, types, members). Canonicalized to positional
// indices for the rename-stable hash so an α-rename of any of them is invisible; keywords,
// operators, punctuation, and LITERALS stay verbatim (a literal/structure change is NOT a rename).
const TS_IDENT_TYPES = new Set([
  "identifier",
  "type_identifier",
  "property_identifier",
  "shorthand_property_identifier",
  "shorthand_property_identifier_pattern",
])
const GO_IDENT_TYPES = new Set(["identifier", "field_identifier", "type_identifier", "package_identifier"])
// Python: a gramática usa um único node type `identifier` pra nomes de função/classe/variável/
// atributo (ao contrário de Go/TS, que separam identifier de field/type/property_identifier).
const PYTHON_IDENT_TYPES = new Set(["identifier"])
// Rust: identifier (fn/var/mod names), type_identifier (struct/enum/trait/impl-type names),
// field_identifier (struct field names) — verificado contra node-types.json real.
const RUST_IDENT_TYPES = new Set(["identifier", "type_identifier", "field_identifier"])

const IDENT_TYPES_BY_LANG: Partial<Record<TreeLang, Set<string>>> = {
  typescript: TS_IDENT_TYPES,
  tsx: TS_IDENT_TYPES,
  go: GO_IDENT_TYPES,
  python: PYTHON_IDENT_TYPES,
  rust: RUST_IDENT_TYPES,
}

export function identTypesFor(lang?: TreeLang): Set<string> {
  return (lang && IDENT_TYPES_BY_LANG[lang]) ?? TS_IDENT_TYPES
}

/**
 * Rename-stable hash: the canonical token stream with every user identifier replaced by its
 * first-occurrence index (#0, #1, …). A pure rename of a symbol/params/locals yields an EQUAL
 * renameStableHash while its tokenHash differs — that pairing is what the drift taxonomy needs to
 * grade "renamed" (β held) instead of "gone"/"structural". A body or structural change perturbs
 * the stream and changes this hash too, so it does not mask real edits.
 */
export function renameStableHashOf(
  node: Node,
  skipLeafTypes: Set<string> = TS_SKIP_LEAF_TYPES,
  identTypes: Set<string> = TS_IDENT_TYPES,
): string {
  const out: string[] = []
  const idMap = new Map<string, number>()
  const walk = (n: Node): void => {
    // Mesma ordem de checagem de collectTokens (ver comentário lá): skipLeafTypes antes de
    // childCount, pra cobrir comment nodes com filhos (Rust line_comment/block_comment).
    if (skipLeafTypes.has(n.type)) return
    if (n.childCount === 0) {
      if (identTypes.has(n.type)) {
        let idx = idMap.get(n.text)
        if (idx === undefined) {
          idx = idMap.size
          idMap.set(n.text, idx)
        }
        out.push("#" + idx)
      } else out.push(n.text)
      return
    }
    for (const c of n.children) if (c) walk(c)
  }
  walk(node)
  return createHash("sha256").update(out.join("")).digest("hex")
}

/**
 * Resolve uma âncora estrutural: acha o nó em `symbolPath` dentro de `content` (parseado como
 * `filename` indica) e compara o tokenHash canônico contra `storedHash`.
 * - "gone": symbolPath não resolve (arquivo não é TS/TSX, ou nenhum nó bate o path) — inclui
 *   o caso de rename (o segmento antigo do path deixa de existir) e o caso comentário-com-âncora
 *   (o texto pode estar lá, mas não há nó de declaração ali — INV-H1-1). Exceção: se `storedRenameHash`
 *   for fornecido, faz um scan de fallback (ver abaixo) antes de desistir.
 * - "match": nó resolvido e tokenHash === storedHash (mutação só de formatação).
 * - "structural": nó resolvido mas tokenHash difere (corpo/assinatura mudou de fato).
 * - "renamed": symbolPath NÃO resolveu, mas `storedRenameHash` foi passado e exatamente um nó
 *   DECL_TYPES em toda a árvore tem `renameStableHashOf === storedRenameHash` — prova que o corpo
 *   é o mesmo modulo rename de identificadores. Zero ou 2+ candidatos ambíguos → "gone" (fail-closed).
 * Pura: (content, filename, symbolPath, storedHash, storedRenameHash) determinam o resultado; sem
 * I/O além do parse.
 */
export async function resolveAnchor(
  content: string,
  filename: string,
  symbolPath: string,
  storedHash: string,
  storedRenameHash?: string,
): Promise<ResolvedAnchor> {
  const lang = anchorLangOf(filename)
  if (!lang) return { grade: "gone", tokenHash: null, renameStableHash: null }
  const declTypes = declTypesFor(lang)
  const skipLeafTypes = skipLeafTypesFor(lang)
  const identTypes = identTypesFor(lang)
  const tree = await parseLang(lang, content)
  const node = findBySymbolPath(tree.rootNode, symbolPath, declTypes)
  if (node) {
    const tokenHash = tokenHashOf(node, skipLeafTypes)
    return {
      grade: tokenHash === storedHash ? "match" : "structural",
      tokenHash,
      renameStableHash: renameStableHashOf(node, skipLeafTypes, identTypes),
      firstLine: firstLineOf(node.text),
    }
  }
  if (storedRenameHash) {
    const matches: Node[] = []
    const walk = (n: Node): void => {
      if (declTypes.has(n.type) && renameStableHashOf(n, skipLeafTypes, identTypes) === storedRenameHash) matches.push(n)
      for (const c of n.children) if (c) walk(c)
    }
    walk(tree.rootNode)
    if (matches.length === 1) {
      const match = matches[0]!
      return {
        grade: "renamed",
        tokenHash: tokenHashOf(match, skipLeafTypes),
        renameStableHash: storedRenameHash,
        newSymbolPath: symbolPathOf(match, declTypes),
        firstLine: firstLineOf(match.text),
      }
    }
  }
  return { grade: "gone", tokenHash: null, renameStableHash: null }
}

/** Tipo estrutural opcional a acompanhar a âncora verbatim já persistida (ver invariante de compat). */
export type Anchor = {
  /** Excerpt verbatim já existente — NUNCA remover/mudar o shape on-disk já persistido. */
  anchor: string
  /** Campos novos, OPCIONAIS: presença habilita o gate estrutural sem quebrar leitores antigos. */
  symbolPath?: string
  tokenHash?: string
}
