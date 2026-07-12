/**
 * extract-go.ts — projeta tree-sitter Go pra RawSym. Métodos aninham sob o tipo
 * do receiver (name_path `Server/Start`) — a posse pai/filho espelha o modelo Go.
 * Receiver sem type decl no arquivo ganha pai sintético (kind Class).
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

function fnDetail(n: Node, receiver?: Node): string | undefined {
  const params = n.childForFieldName("parameters")?.text
  if (!params) return undefined
  const result = n.childForFieldName("result")?.text
  const recv = receiver ? collapse(receiver.text) : ""
  return collapse(`${recv}${params}${result ? " " + result : ""}`)
}

function typeKind(spec: Node): number {
  const t = spec.childForFieldName("type")?.type
  if (t === "struct_type") return 23
  if (t === "interface_type") return 11
  return 200
}

/** Nome do tipo do receiver: identificador dentro do parameter_list, sem `*`. */
function receiverType(recv: Node): string | null {
  const m = /\*?\s*([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*\)\s*$/.exec(recv.text)
  return m ? m[1] : null
}

export async function extractGo(content: string): Promise<RawSym[]> {
  const tree = await parseLang("go", content)
  const out: RawSym[] = []
  const byType = new Map<string, RawSym>()
  const pendingMethods: { type: string; sym: RawSym }[] = []

  for (const n of tree.rootNode.namedChildren) {
    if (!n) continue
    if (n.type === "function_declaration") {
      const name = n.childForFieldName("name")
      if (name)
        out.push({ name: name.text, kind: 12, detail: fnDetail(n), range: rangeOf(n), selectionRange: rangeOf(name) })
    } else if (n.type === "method_declaration") {
      const name = n.childForFieldName("name")
      const recv = n.childForFieldName("receiver")
      if (!name || !recv) continue
      const t = receiverType(recv)
      if (!t) continue
      const sym: RawSym = {
        name: name.text,
        kind: 6,
        detail: fnDetail(n, recv),
        range: rangeOf(n),
        selectionRange: rangeOf(name),
      }
      pendingMethods.push({ type: t, sym })
    } else if (n.type === "type_declaration") {
      for (const spec of n.namedChildren) {
        if (spec?.type !== "type_spec" && spec?.type !== "type_alias") continue
        const name = spec.childForFieldName("name")
        if (!name) continue
        const sym: RawSym = {
          name: name.text,
          kind: spec.type === "type_alias" ? 200 : typeKind(spec),
          range: rangeOf(spec),
          selectionRange: rangeOf(name),
          children: [],
        }
        byType.set(name.text, sym)
        out.push(sym)
      }
    } else if (n.type === "const_declaration" || n.type === "var_declaration") {
      const kind = n.type === "const_declaration" ? 14 : 13
      for (const spec of n.namedChildren) {
        if (spec?.type !== "const_spec" && spec?.type !== "var_spec") continue
        for (const c of spec.namedChildren) {
          if (c?.type === "identifier") out.push({ name: c.text, kind, range: rangeOf(spec), selectionRange: rangeOf(c) })
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
