/**
 * extract-python.ts — projeta a árvore tree-sitter de Python pra RawSym (mesma
 * forma do documentSymbol do LSP) → reusa flatten/skeleton/slice/anchor sem mudança.
 * Escopo: top-level defs/classes + métodos de classe. Nested defs ficam de fora
 * (mesma política de profundidade do extractor TS).
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

function sigOf(def: Node): string | undefined {
  const params = def.childForFieldName("parameters")?.text?.replace(/\s+/g, " ")
  if (!params) return undefined
  const ret = def.childForFieldName("return_type")?.text
  return ret ? `${params} -> ${ret}` : params
}

/** decorated_definition → definição interna; range externo (decorators inclusos). */
function unwrap(n: Node): { def: Node; outer: Node } | null {
  if (n.type === "decorated_definition") {
    const def = n.childForFieldName("definition")
    return def ? { def, outer: n } : null
  }
  if (n.type === "function_definition" || n.type === "class_definition") return { def: n, outer: n }
  return null
}

function toSym(def: Node, outer: Node, kindWhenFn: number): RawSym | null {
  const name = def.childForFieldName("name")
  if (!name) return null
  const isClass = def.type === "class_definition"
  const sym: RawSym = {
    name: name.text,
    kind: isClass ? 5 : kindWhenFn,
    detail: isClass ? undefined : sigOf(def),
    range: rangeOf(outer),
    selectionRange: rangeOf(name),
  }
  if (isClass) {
    const body = def.childForFieldName("body")
    const children: RawSym[] = []
    for (const c of body?.namedChildren ?? []) {
      if (!c) continue
      const u = unwrap(c)
      if (!u) continue
      const child = toSym(u.def, u.outer, 6) // método
      if (child) children.push(child)
    }
    if (children.length) sym.children = children
  }
  return sym
}

export async function extractPython(content: string): Promise<RawSym[]> {
  const tree = await parseLang("python", content)
  const out: RawSym[] = []
  for (const n of tree.rootNode.namedChildren) {
    if (!n) continue
    const u = unwrap(n)
    if (!u) continue
    const sym = toSym(u.def, u.outer, 12)
    if (sym) out.push(sym)
  }
  return out
}
