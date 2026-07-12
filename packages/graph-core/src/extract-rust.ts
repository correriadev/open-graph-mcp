/**
 * extract-rust.ts — projeta tree-sitter Rust pra RawSym. Métodos de `impl Tipo`/
 * `impl Trait for Tipo` aninham sob o nome do tipo (name_path `Server/new`),
 * mesclando no struct/enum/trait já declarado no arquivo, ou pai sintético
 * (kind Class) quando o tipo não é declarado localmente — mesma regra do Go.
 * `mod x { ... }` inline recursa (filhos viram símbolos aninhados); `mod x;` é folha.
 */
import type { Node } from "web-tree-sitter"
import type { RawSym, Range } from "./symbols"
import { parseLang } from "./treesitter"

function rangeOf(n: Node): Range {
  return {
    start: { line: n.startPosition.row, character: n.startPosition.column },
    end: { line: n.endPosition.row, character: n.endPosition.column },
  }
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim()

function fnDetail(n: Node): string | undefined {
  const params = n.childForFieldName("parameters")?.text
  if (!params) return undefined
  const ret = n.childForFieldName("return_type")?.text
  return collapse(`${params}${ret ? " -> " + ret : ""}`)
}

/** Nome base do tipo implementado: pega o último segmento de um path/generic. */
function implTypeName(t: Node): string | null {
  let node: Node | null = t
  if (node.type === "generic_type") node = node.childForFieldName("type") ?? node
  const text = node.text
  const m = /([A-Za-z_]\w*)\s*$/.exec(text)
  return m ? m[1] : null
}

function fnOrSigToSym(n: Node): RawSym | null {
  const name = n.childForFieldName("name")
  if (!name) return null
  return { name: name.text, kind: 6, detail: fnDetail(n), range: rangeOf(n), selectionRange: rangeOf(name) }
}

/** Processa um nível de aninhamento (root ou corpo de um `mod`). */
function dispatchLevel(nodes: (Node | null)[]): RawSym[] {
  const out: RawSym[] = []
  const byType = new Map<string, RawSym>()
  const pendingMethods: { type: string; sym: RawSym }[] = []

  for (const n of nodes) {
    if (!n) continue
    if (n.type === "function_item" || n.type === "function_signature_item") {
      const name = n.childForFieldName("name")
      if (name)
        out.push({ name: name.text, kind: 12, detail: fnDetail(n), range: rangeOf(n), selectionRange: rangeOf(name) })
    } else if (n.type === "struct_item") {
      const name = n.childForFieldName("name")
      if (!name) continue
      const sym: RawSym = { name: name.text, kind: 23, range: rangeOf(n), selectionRange: rangeOf(name) }
      byType.set(name.text, sym)
      out.push(sym)
    } else if (n.type === "enum_item") {
      const name = n.childForFieldName("name")
      if (!name) continue
      const sym: RawSym = { name: name.text, kind: 10, range: rangeOf(n), selectionRange: rangeOf(name) }
      byType.set(name.text, sym)
      out.push(sym)
    } else if (n.type === "type_item") {
      const name = n.childForFieldName("name")
      if (!name) continue
      const sym: RawSym = { name: name.text, kind: 200, range: rangeOf(n), selectionRange: rangeOf(name) }
      byType.set(name.text, sym)
      out.push(sym)
    } else if (n.type === "const_item" || n.type === "static_item") {
      const name = n.childForFieldName("name")
      if (!name) continue
      out.push({ name: name.text, kind: 14, range: rangeOf(n), selectionRange: rangeOf(name) })
    } else if (n.type === "trait_item") {
      const name = n.childForFieldName("name")
      if (!name) continue
      const sym: RawSym = { name: name.text, kind: 11, range: rangeOf(n), selectionRange: rangeOf(name), children: [] }
      const body = n.childForFieldName("body")
      const children: RawSym[] = []
      for (const c of body?.namedChildren ?? []) {
        if (!c) continue
        if (c.type === "function_item" || c.type === "function_signature_item") {
          const m = fnOrSigToSym(c)
          if (m) children.push(m)
        }
      }
      if (children.length) sym.children = children
      else delete sym.children
      byType.set(name.text, sym)
      out.push(sym)
    } else if (n.type === "mod_item") {
      const name = n.childForFieldName("name")
      if (!name) continue
      const body = n.childForFieldName("body")
      const sym: RawSym = { name: name.text, kind: 3, range: rangeOf(n), selectionRange: rangeOf(name) }
      if (body) {
        const children = dispatchLevel(body.namedChildren)
        if (children.length) sym.children = children
      }
      out.push(sym)
    } else if (n.type === "impl_item") {
      const typeNode = n.childForFieldName("type")
      const body = n.childForFieldName("body")
      if (!typeNode || !body) continue
      const typeName = implTypeName(typeNode)
      if (!typeName) continue
      for (const c of body.namedChildren) {
        if (!c) continue
        if (c.type === "function_item" || c.type === "function_signature_item") {
          const m = fnOrSigToSym(c)
          if (m) pendingMethods.push({ type: typeName, sym: m })
        }
      }
    }
  }

  for (const { type, sym } of pendingMethods) {
    let parent = byType.get(type)
    if (!parent) {
      parent = { name: type, kind: 5, range: sym.range, selectionRange: sym.selectionRange, children: [] }
      byType.set(type, parent)
      out.push(parent)
    }
    parent.children = parent.children ?? []
    parent.children.push(sym)
  }
  for (const sym of out) if (sym.children && sym.children.length === 0) delete sym.children
  return out
}

export async function extractRust(content: string): Promise<RawSym[]> {
  const tree = await parseLang("rust", content)
  return dispatchLevel(tree.rootNode.namedChildren)
}
