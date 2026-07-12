/**
 * treesitter.ts — motor de extração multi-linguagem (Phase 1: python/go/rust).
 * web-tree-sitter (WASM, in-process): init assíncrono ÚNICO por linguagem; parse
 * síncrono depois. Sem subprocess, sem LSP — o lock "sem processo" segue de pé.
 * Produz árvore crua; extractors por linguagem (extract-*.ts) projetam pra RawSym.
 */
import { fileURLToPath } from "node:url"
import { Language, Parser, type Tree } from "web-tree-sitter"
import { lazy } from "./util/lazy"

export type TreeLang = "python" | "go" | "rust" | "typescript" | "tsx"

// "typescript"/"tsx" NÃO entram no EXT/langOf: .ts/.tsx já são roteados pro compiler API nativo
// (symbols.ts::extractSymbols, via isTsFamily) em graph-symbols.ts — mudar langOf("f.ts") pra
// não-null quebraria o teste existente `langOf("f.ts") === null` (treesitter.test.ts, fora do
// escopo deste dispatch). As duas linguagens ficam disponíveis via parseLang("typescript"|"tsx", …)
// para o primitivo de âncora (extract.ts::resolveAnchor), que resolve o TreeLang direto da
// extensão sem passar por este EXT/langOf.
const EXT: Record<string, TreeLang> = { ".py": "python", ".pyi": "python", ".go": "go", ".rs": "rust" }

export function langOf(filename: string): TreeLang | null {
  const dot = filename.lastIndexOf(".")
  return dot >= 0 ? (EXT[filename.slice(dot).toLowerCase()] ?? null) : null
}

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  return fileURLToPath(new URL(asset, import.meta.url))
}

const initParser = lazy(async () => {
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
})

const GRAMMAR_WASM: Record<TreeLang, () => Promise<{ default: string }>> = {
  python: () => import("tree-sitter-python/tree-sitter-python.wasm" as string, { with: { type: "wasm" } }),
  go: () => import("tree-sitter-go/tree-sitter-go.wasm" as string, { with: { type: "wasm" } }),
  rust: () => import("tree-sitter-rust/tree-sitter-rust.wasm" as string, { with: { type: "wasm" } }),
  typescript: () =>
    import("tree-sitter-typescript/tree-sitter-typescript.wasm" as string, { with: { type: "wasm" } }),
  tsx: () => import("tree-sitter-typescript/tree-sitter-tsx.wasm" as string, { with: { type: "wasm" } }),
}

const parsers = new Map<TreeLang, Promise<Parser>>()

function parserFor(lang: TreeLang): Promise<Parser> {
  let p = parsers.get(lang)
  if (!p) {
    p = (async () => {
      await initParser()
      const { default: wasm } = await GRAMMAR_WASM[lang]()
      const language = await Language.load(resolveWasm(wasm))
      const parser = new Parser()
      parser.setLanguage(language)
      return parser
    })()
    parsers.set(lang, p)
  }
  return p
}

/** Parse síncrono após load lazy da gramática. Uma gramática só carrega se usada. */
export async function parseLang(lang: TreeLang, content: string): Promise<Tree> {
  const parser = await parserFor(lang)
  const tree = parser.parse(content)
  if (!tree) throw new Error(`tree-sitter parse returned null for ${lang}`)
  return tree
}
