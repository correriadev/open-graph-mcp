/**
 * classify.ts — classificador determinístico P1-P5 por convenção.
 * Cobre 100% dos arquivos baseado em nome, extensão, path e profundidade.
 * O subagent faz override nos casos ambíguos via parâmetro classifications do graphprune.
 */
import path from "path"
import type { Ledger } from "./descent"

export type Level = "P1" | "P2" | "P3" | "P4" | "P5"

const P1_FILES = new Set([
  "readme.md", "license", "license.md", "contributing.md", "security.md",
  "package.json", "bunfig.toml", "turbo.json", "sst.config.ts", "sst-env.d.ts",
  "flake.nix", "flake.lock", "tsconfig.json", "tsconfig.base.json",
  ".gitignore", ".editorconfig", ".gitattributes", ".prettierignore",
  ".dockerignore", ".gitleaksignore", "oxlintrc.json",
  "dockerfile", "docker-compose.yml", "docker-compose.yaml",
  "agenda.md", "agenda.br.md", "agenda.es.md", "agenda.ja.md",
  "agenda.ko.md", "agenda.zh.md", "agenda.zht.md", "agenda.fr.md",
  "agenda.de.md", "agenda.it.md", "agenda.ru.md", "agenda.tr.md",
  "agenda.pl.md", "agenda.no.md", "agenda.da.md", "agenda.bs.md",
  "agenda.bn.md", "agenda.gr.md", "agenda.th.md", "agenda.uk.md",
  "agenda.vi.md", "agenda.ar.md",
])

const P2_NAMES = new Set([
  "main.ts", "index.ts", "app.ts", "app.tsx",
  "router.ts", "routes.ts", "router.tsx",
  "next.config.js", "next.config.mjs", "vite.config.ts", "vitest.config.ts",
  "webpack.config.js", "tsup.config.ts", "eslint.config.js",
  "tailwind.config.ts", "postcss.config.js",
])

const P3_DIRS = new Set(["types", "interfaces", "contracts", "schemas", "migration", "migrations", "__snapshots__"])
const P5_DIRS = new Set([
  "fixtures", "fixture", "stories", "templates", "audio", "icons", "fonts",
  "e2e", "e2e_tests", "patches", "vendor", "third_party",
  "i18n", "locales", "translations", "public",
  ".vscode", ".zed", ".claude", ".opencode",
  "coverage", ".nyc_output", ".cache",
])
const P5_EXTS = new Set([".aac", ".mp3", ".wav", ".ogg", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".woff", ".woff2", ".ttf", ".eot", ".otf"])
const P5_NAMES = new Set(["bun.lock", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "screenshot-uk.png"])

export function classifyFile(fp: string): Level {
  const name = path.basename(fp)
  const ext = path.extname(name).toLowerCase()
  const lower = name.toLowerCase()
  const dir = path.dirname(fp)
  const dirLower = dir.toLowerCase()

  if (P1_FILES.has(lower)) return "P1"
  if (P2_NAMES.has(lower)) return "P2"
  if (P5_NAMES.has(lower)) return "P5"
  if (P5_EXTS.has(ext)) return "P5"
  if (lower.endsWith(".snap")) return "P5"
  if (lower.endsWith(".test.ts") || lower.endsWith(".test.tsx") || lower.endsWith(".spec.ts") || lower.endsWith(".spec.tsx")) return "P3"
  if (lower.endsWith(".types.ts") || lower.endsWith(".schema.ts")) return "P3"
  if (lower.startsWith("vitest.config") || lower.startsWith("jest.config") || lower.startsWith("playwright.config")) return "P3"
  if (dirLower.includes("/__tests__/") || dirLower.includes("/__snapshots__/")) return "P3"
  if (dirLower.includes("/migration") || dirLower.includes("/migrations")) return "P3"
  if (lower.startsWith(".")) return "P4"
  if (name.endsWith(".d.ts")) return "P4"
  return "P4"
}

export function classifyDir(name: string): Level {
  const lower = name.toLowerCase()
  if (lower === ".github" || lower === ".circleci" || lower === ".gitlab") return "P1"
  if (lower === "docs" || lower === "specs" || lower === "plans" || lower === "adr") return "P1"
  if (lower === "src" || lower === "lib" || lower === "app" || lower === "pages" || lower === "routes" || lower === "api") return "P2"
  if (lower === "components" || lower === "ui") return "P2"
  if (lower === "test" || lower === "tests") return "P3"
  if (P3_DIRS.has(lower)) return "P3"
  if (P5_DIRS.has(lower)) return "P5"
  if (lower === "assets") return "P5"
  if (lower === "node_modules" || lower.endsWith("_modules")) return "P5"
  if (lower === ".next" || lower === "dist" || lower === "build" || lower === "out" || lower === ".graph") return "P5"
  if (lower === ".git") return "P5"
  return "P4"
}

export interface ClassificationResult {
  classifications: Map<string, Level>
  pruneSuggestions: { path: string; reason: string; level: Level }[]
}

/**
 * Classifica 100% dos arquivos do ledger e sugere podas para diretórios P5.
 */
export function classifyLedger(ledger: Ledger): ClassificationResult {
  const classifications = new Map<string, Level>()
  const pruneSuggestions: { path: string; reason: string; level: Level }[] = []

  // Coleta todos os diretórios presentes nos passes
  const allDirs = new Set<string>()
  for (const pass of ledger.passes) {
    for (const d of pass.dirs) {
      if (d !== ".") allDirs.add(d)
    }
  }

  // Classifica cada arquivo
  for (const pass of ledger.passes) {
    for (const f of pass.files) {
      classifications.set(f, classifyFile(f))
    }
  }

  // Sugere podas para diretórios P5 com profundidade suficiente
  for (const d of allDirs) {
    const name = path.basename(d)
    const depth = d.split("/").length
    const level = classifyDir(name)
    if (level !== "P5") continue
    if (depth <= 1 && !["node_modules", ".git", "dist", "build", ".next", "vendor", "patches", "coverage"].includes(name)) continue

    const reasonMap: Record<string, string> = {
      "audio": "asset-audio",
      "icons": "asset-icons",
      "fonts": "asset-fonts",
      "fixtures": "test-fixture",
      "fixture": "test-fixture",
      "stories": "storybook",
      "templates": "boilerplate",
      "e2e": "e2e-fixture",
      "e2e_tests": "e2e-fixture",
      "patches": "vendor-patches",
      "vendor": "vendor-patches",
      "third_party": "vendor-patches",
      "i18n": "locale-i18n",
      "locales": "locale-i18n",
      "translations": "locale-i18n",
      "public": "asset-public",
      "assets": "asset-dir",
      ".vscode": "ide-config",
      ".zed": "ide-config",
      ".claude": "ide-config",
      "coverage": "generated",
      ".nyc_output": "generated",
      ".cache": "cache",
      ".graph": "cache",
      ".next": "generated",
      "dist": "generated",
      "build": "generated",
      "out": "generated",
      "node_modules": "dependency",
    }

    const filesInDir = ledger.passes.flatMap(p => p.files).filter(f => f.startsWith(d + "/"))
    if (filesInDir.length > 0) {
      pruneSuggestions.push({
        path: d,
        reason: reasonMap[name] ?? `hierarchy-${name}`,
        level: "P5",
      })
    }
  }

  return { classifications, pruneSuggestions }
}
