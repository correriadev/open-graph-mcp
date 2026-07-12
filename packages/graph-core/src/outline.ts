/**
 * outline.ts — projeção determinística de documentos (.md/.html) pro Pass A.
 * Paralelo do symbols.ts (código): devolve RawSym na MESMA forma, então reusa
 * flattenSymbols/symbolsToSkeleton/findByNamePath/sliceBody/anchorOf sem mudança.
 *
 * Estrutura = árvore de seções (headings) sob uma raiz Document (file stem) +
 * símbolos JS extraídos de tags <script> em HTML.
 * Âncora = linha do heading ou linha do código JS, verbatim (excerptCheck re-checa).
 * Sem LLM — o extractor é determinístico.
 *
 * Mantém o invariante do Pass A: a unidade endereçável vem de um extractor
 * determinístico, não da cabeça da LLM (a LLM propõe responsabilidade; o gate
 * re-checa a âncora verbatim). Documentos sem heading viram 1 nó Document (file-level).
 */
import type { RawSym } from "./symbols"
import { extractSymbols } from "./symbols"

const DOC_EXT = new Set([".md", ".markdown", ".html", ".htm"])

export function isDocument(filename: string): boolean {
  const dot = filename.lastIndexOf(".")
  return dot >= 0 && DOC_EXT.has(filename.slice(dot).toLowerCase())
}

export function documentName(filename: string): string {
  const dot = filename.lastIndexOf(".")
  return dot >= 0 ? filename.slice(0, dot) : filename
}

const DOC_KIND = 301
const SECTION_KIND = 300

type Head = { level: number; line: number; text: string; endLine?: number }

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
}

/** Extrai o conteúdo de tags <script> de HTML (type module ou sem type). */
export function extractScriptsFromHtml(content: string): string[] {
  const scripts: string[] = []
  const scriptRe = /<script\b[^>]*>(.*?)<\/script\s*>/gis
  let m: RegExpExecArray | null
  while ((m = scriptRe.exec(content)) !== null) {
    const attrs = m[0].slice(0, m[0].indexOf(">"))
    // Pula scripts externos (src="...") e non-JS (type diferente de module/javascript)
    if (/ src\s*=/i.test(attrs)) continue
    if (/ type\s*=/i.test(attrs) && !/type\s*=\s*["']?(module|text\/javascript|application\/javascript)["'\s>]/i.test(attrs)) continue
    const code = m[1].trim()
    if (code) scripts.push(code)
  }
  return scripts
}

/** Extrai a árvore de seções de um .md/.html. Raiz = Document (file stem); filhos = headings aninhados + símbolos JS de <script>. */
export function extractOutline(content: string, filename: string): RawSym[] {
  const lines = content.split(/\r?\n/)
  const stem = documentName(filename)
  const isHtml = /\.(html?|htm)$/i.test(filename)
  const heads = isHtml ? htmlHeads(lines) : mdHeads(lines)
  const doc = buildDocTree(lines, stem, heads)
  // Para HTML, extrai símbolos JS de tags <script> e adiciona como filhos do documento
  if (isHtml) {
    for (const js of extractScriptsFromHtml(content)) {
      const jsSyms = extractSymbols(js, "inline.js")
      doc.children!.push(...jsSyms)
    }
  }
  return [doc]
}

function mdHeads(lines: string[]): Head[] {
  const out: Head[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i])
    if (m) out.push({ level: m[1].length, line: i, text: m[2].trim() })
  }
  return out
}

function htmlHeads(lines: string[]): Head[] {
  const out: Head[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const hm = /<h([1-6])\b[^>]*>/i.exec(line)
    if (!hm) continue
    const level = Number(hm[1])
    const openEnd = line.indexOf(hm[0]) + hm[0].length
    const rest = line.slice(openEnd)
    const close = new RegExp(`</h${level}>`, "i").exec(rest)
    let text: string
    let end = i
    if (close) {
      text = rest.slice(0, close.index)
    } else {
      let buf = rest
      for (let j = i + 1; j < lines.length; j++) {
        const c = new RegExp(`</h${level}>`, "i").exec(lines[j])
        if (c) { buf += lines[j].slice(0, c.index); end = j; break }
        buf += lines[j]
      }
      text = buf
    }
    out.push({ level, line: i, text: stripTags(text) })
    i = end
  }
  return out
}

function buildDocTree(lines: string[], stem: string, heads: Head[]): RawSym {
  const lastLine = Math.max(0, lines.length - 1)
  // endLine por head: spana até o próximo heading de nível <= (mesma ou maior altura)
  for (let k = 0; k < heads.length; k++) {
    let end = lastLine
    for (let j = k + 1; j < heads.length; j++) {
      if (heads[j].level <= heads[k].level) { end = heads[j].line - 1; break }
    }
    heads[k].endLine = end
  }
  // árvore aninhada por pilha (posse pai/filho espelha o modelo de heading levels)
  const sectionRoots: RawSym[] = []
  const stack: { node: RawSym; level: number }[] = []
  for (const h of heads) {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop()
    const node: RawSym = {
      name: h.text || `L${h.line + 1}`,
      kind: SECTION_KIND,
      range: { start: { line: h.line, character: 0 }, end: { line: h.endLine ?? lastLine, character: 0 } },
      selectionRange: { start: { line: h.line, character: 0 }, end: { line: h.line, character: 0 } },
      children: [],
    }
    if (stack.length) stack[stack.length - 1].node.children!.push(node)
    else sectionRoots.push(node)
    stack.push({ node, level: h.level })
  }
  const anchorLine = heads.length ? heads[0].line : 0
  return {
    name: stem,
    kind: DOC_KIND,
    range: { start: { line: 0, character: 0 }, end: { line: lastLine, character: 0 } },
    selectionRange: { start: { line: anchorLine, character: 0 }, end: { line: anchorLine, character: 0 } },
    children: sectionRoots,
  }
}
