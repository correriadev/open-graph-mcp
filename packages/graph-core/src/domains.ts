/**
 * domains.ts — dono explícito de célula (blind spot 1.2: hoje o domínio de um nó é
 * `[...a.domains].sort()[0]` — um tiebreak alfabético. Um claim de outro domínio pode
 * migrar o nó de célula em silêncio, deslocando a fronteira de autoridade β sem gate.
 *
 * Fix: `.graph/domains.json` (array de `{ pattern, domain }`, first-match-wins, ordem do
 * arquivo = determinístico) dá posse EXPLÍCITA por arquivo. Quando presente, o padrão que
 * casa com o arquivo decide o domínio — os claims não têm voto. Sem padrão casando →
 * "(unassigned)".
 *
 * Compat: se `.graph/domains.json` NÃO existe, `assignDomain` reproduz exatamente o
 * comportamento antigo (`[...candidateDomains].sort()[0] ?? null`) — a baseline de 286
 * testes do grafo fica verde sem tocar em nada.
 *
 * `(unassigned)` é uma célula NUNCA flipável (não tem dono, não pode ganhar um por
 * acidente) — a aplicação disso é responsabilidade do gate de autoridade (authority.ts),
 * não deste módulo: aqui só documentamos a invariante.
 */
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

export type DomainRule = { pattern: string; domain: string }
export type DomainMap = readonly DomainRule[]

export const UNASSIGNED = "(unassigned)"

/** Glob simples: exato, `prefix*`, `*suffix`, ou `*substr*`. Sem dependência de glob. */
function matchesPattern(file: string, pattern: string): boolean {
  if (!pattern.includes("*")) return file === pattern
  const isPrefixWildcard = pattern.startsWith("*")
  const isSuffixWildcard = pattern.endsWith("*")
  if (isPrefixWildcard && isSuffixWildcard && pattern.length > 1) {
    return file.includes(pattern.slice(1, -1))
  }
  if (isSuffixWildcard) return file.startsWith(pattern.slice(0, -1))
  if (isPrefixWildcard) return file.endsWith(pattern.slice(1))
  return file === pattern
}

/** Lê `.graph/domains.json`. Ausente ou inválido → null (caller cai no fallback de sort). */
export function loadDomains(root: string): DomainMap | null {
  const file = path.join(root, ".graph", "domains.json")
  if (!existsSync(file)) return null
  try {
    const arr = JSON.parse(readFileSync(file, "utf8"))
    if (!Array.isArray(arr)) return null
    const rules = arr.filter(
      (r): r is DomainRule => !!r && typeof r.pattern === "string" && typeof r.domain === "string",
    )
    return rules
  } catch {
    return null
  }
}

/**
 * Decide o domínio de um nó dado seu arquivo.
 * - map presente: primeiro padrão que casa com `file` vence (ordem do arquivo). Sem match → "(unassigned)".
 * - map ausente: fallback EXATO ao comportamento pré-existente (sort alfabético dos domínios candidatos).
 */
export function assignDomain(
  file: string,
  candidateDomains: Iterable<string>,
  map: DomainMap | null,
): string | null {
  if (map) {
    for (const rule of map) {
      if (matchesPattern(file, rule.pattern)) return rule.domain
    }
    return UNASSIGNED
  }
  const arr = [...candidateDomains].sort()
  return arr.length ? arr[0] : null
}
