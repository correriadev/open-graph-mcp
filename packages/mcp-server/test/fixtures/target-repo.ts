/**
 * target-repo.ts — harness do repo-alvo REAL (QA-7 Fase 0). Copia
 * `OG_TARGET_REPO` (default `C:\Users\User\Documents\harness-kit`) para um
 * tmpdir isolado — NUNCA aponta teste para o path original, porque a Fase 5
 * (drift/watch, fora deste escopo) escreve em arquivos-fonte e um repo git de
 * verdade não pode ser sujado por um teste.
 *
 * Guarda obrigatória: se o repo-alvo não existir no filesystem local (ex.:
 * CI sem o clone), `targetRepoAvailable()` devolve false e o CHAMADOR faz
 * `test.skipIf` com um motivo explícito — nunca falha por ambiente ausente,
 * nunca passa em silêncio (rodar contra a fixture errada sem avisar).
 */
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DEFAULT_IGNORE } from "@open-graph-mcp/graph-core/scan"

/** Domínios explícitos p/ o repo-alvo: passe em `startServer({ domains })`. Padrões-prefixo, sem `"*"` catch-all —
 *  `matchesPattern` trata `"*"` sozinho como `file === "*"` (length 1), não como wildcard-total
 *  (domains.ts:33-41). O que não casar cai em "(unassigned)", por design não-flipável. */
export const TARGET_DOMAINS = [
  { pattern: "sdk/src/*", domain: "sdk" },
  { pattern: "sdk/tests/*", domain: "sdk-tests" },
  { pattern: "agents/*", domain: "agents" },
  { pattern: "skills/*", domain: "skills" },
  { pattern: "docs/*", domain: "docs" },
] as const

export function targetRepoPath(): string {
  return process.env.OG_TARGET_REPO ?? "C:\\Users\\User\\Documents\\harness-kit"
}

export function targetRepoAvailable(): boolean {
  return existsSync(targetRepoPath())
}

export type TargetRepo = { root: string; cleanup: () => void }

/**
 * Copia o repo-alvo p/ um tmpdir (respeitando DEFAULT_IGNORE de scan.ts — sem `.git`,
 * `node_modules`, `dist` etc.). Devolve `{ root, cleanup }`; o chamador é responsável por chamar
 * `cleanup()` (idealmente em `finally`).
 *
 * NÃO injeta mais `.graph/domains.json`: o repo não hospeda nada de grafo (ADR D1). As regras de
 * domínio são CONFIG DO SERVIDOR — passe `TARGET_DOMAINS` em `startServer({ domains })`.
 *
 * Lança se o repo-alvo não existir — o chamador deve checar `targetRepoAvailable()` e fazer
 * `test.skipIf(!targetRepoAvailable())` ANTES de chamar isto, não depender do throw p/ pular.
 */
export function prepareTargetRepo(src: string = targetRepoPath()): TargetRepo {
  if (!existsSync(src)) {
    throw new Error(`repo-alvo ausente em ${src} — defina OG_TARGET_REPO ou clone harness-kit; teste deveria ter feito skip antes de chegar aqui`)
  }
  const root = mkdtempSync(path.join(tmpdir(), "og-target-"))
  cpSync(src, root, {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source)
      // raiz sempre passa (cpSync chama filter até para o próprio `src`)
      if (path.resolve(source) === path.resolve(src)) return true
      return !DEFAULT_IGNORE.includes(name)
    },
  })
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}
