/**
 * indexer.ts — read-only retrieval seam over graph.json for the orchestrator.
 *
 * The indexer is the "smart cache" the orchestrator consults: "what does the ecosystem
 * already know about X?". It NEVER mutates the graph — gate.ts stays the sole mutation door.
 *
 * v1 = structured layer: load nodes, filter by domain, rank by term overlap, report gaps.
 * The `gaps` are load-bearing — a term/domain that matched nothing is how the orchestrator
 * learns to ask the human instead of assuming.
 *
 * ponytail: keyword/domain filter only, over live graph.json (fresh by construction, no cache).
 * The hybrid vector re-rank (embeddings, lazy per-node hash, .graph/index/vec.jsonl) is a
 * separate slice — added only when keyword recall proves weak on real queries. See
 * docs/CHANGELOG.md
 */
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import type { GraphNode } from "./build"
import type { Level } from "./classify"
import { openIndex, buildTokenIndex, candidateIds, tokenIndexFresh } from "./state-index"

export type Query = {
  terms: string[]
  domain?: string
  /** Filter by ladder level (P1-P5); mirrors GraphNode.level verbatim (spec v2-10). */
  layer?: Level
  limit?: number
}
export type Candidate = {
  id: string
  domain: string | null
  /** Ladder level (P1-P5) from GraphNode.level (spec v2-10). */
  layer?: Level
  subject: string
  file: string
  anchor: string
  score: number
}
export type Result = { candidates: Candidate[]; gaps: string[]; indexRebuilt?: boolean }

const DEFAULT_LIMIT = 20

/** Splits a single word on camelCase / acronym boundaries: getUserData → get User Data, XMLParser → XML Parser. */
function splitCamel(word: string): string[] {
  return word
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase and word→Word
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // ACRONYMWord → ACRONYM Word
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Tokens for indexing/query. Splits on non-alnum ("a/foo" → foo; "get_user_data" → get,user,data)
 * AND on camelCase boundaries BEFORE lowercasing, so `getUserData` yields get/user/data — a query
 * for "user" hits it (blind spot: lowercasing first collapsed it to one token and broke recall).
 * The whole lowercased token is kept too, so an exact "getuserdata" query still matches.
 */
export function tokenizeForIndex(s: string): string[] {
  const out = new Set<string>()
  for (const raw of s.split(/[^A-Za-z0-9]+/)) {
    if (!raw) continue
    out.add(raw.toLowerCase())
    for (const part of splitCamel(raw)) out.add(part.toLowerCase())
  }
  return [...out]
}

function nodeTokens(n: GraphNode): Set<string> {
  return new Set([
    ...tokenizeForIndex(n.id),
    ...tokenizeForIndex(n.responsibility),
    ...tokenizeForIndex(n.anchor),
  ])
}

/**
 * Pure query core — testable without fs.
 * A term matches a node if ANY of the term's tokens is in the node's token set.
 * Score = number of matched terms, +1 when a domain filter matches the node's domain.
 */
export function queryGraph(nodes: readonly GraphNode[], q: Query): Result {
  const limit = q.limit ?? DEFAULT_LIMIT
  const pool = nodes.filter((n) =>
    (q.domain === undefined || n.domain === q.domain) &&
    (q.layer === undefined || n.level === q.layer)
  )
  const termToks = q.terms.map((term) => ({ term, toks: tokenizeForIndex(term) }))

  const matched = new Set<string>()
  const candidates: Candidate[] = []
  for (const n of pool) {
    const nt = nodeTokens(n)
    let hits = 0
    for (const { term, toks } of termToks) {
      if (toks.some((tk) => nt.has(tk))) {
        hits++
        matched.add(term)
      }
    }
    if (hits === 0) continue
    candidates.push({
      id: n.id,
      domain: n.domain,
      layer: n.level,
      subject: n.responsibility,
      file: n.file,
      anchor: n.anchor,
      score: hits + (q.domain && n.domain === q.domain ? 1 : 0),
    })
  }
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))

  const gaps = q.terms.filter((t) => !matched.has(t))
  if (q.domain && nodes.every((n) => n.domain !== q.domain)) gaps.push(`domain:${q.domain}`)
  if (q.layer && nodes.every((n) => n.level !== q.layer)) gaps.push(`layer:${q.layer}`)

  return { candidates: candidates.slice(0, limit), gaps }
}

/** fs shell: load nodes from a project root's .graph/graph.json (consumer path, cf. watch.ts). */
export function loadGraphNodes(root: string): GraphNode[] {
  const file = path.join(root, ".graph", "graph.json")
  const raw = JSON.parse(readFileSync(file, "utf8")) as { nodes?: GraphNode[] }
  return raw.nodes ?? []
}

/** Convenience: load + query. */
export function indexQuery(root: string, q: Query): Result {
  return queryGraph(loadGraphNodes(root), q)
}

/**
 * SQLite-backed query path: prunes the pool to candidate node ids from the persisted
 * token_index BEFORE handing off to the pure `queryGraph` scorer — same scoring, fewer
 * nodes tokenized/scanned. Equivalence with `indexQuery`/`queryGraph(allNodes, q)`:
 *   - A node not returned by `candidateIds` shares no token with any query term, so
 *     `queryGraph` would have given it 0 hits and dropped it anyway (pruning it away
 *     changes nothing about the final candidates/scores).
 *   - When `q.domain` is set, `queryGraph` internally filters `nodes` down to the domain
 *     pool BEFORE checking `pool.length === 0` for the "domain gap" — that check is about
 *     domain existence, not term-hits. So the full domain pool (not just its token
 *     matches) is unioned into the pruned set here, which makes `queryGraph`'s internal
 *     domain-filtered pool identical in membership to what it would compute over all
 *     nodes, preserving both the domain gap and the scored candidates exactly.
 * spec v2-05: the token index is rebuilt ONLY when graph.json's content hash changed since
 * the last build (stored in `token_index_meta`). A mismatch rebuilds + stamps the new hash;
 * a match skips the rebuild entirely. `indexRebuilt` in the result reports which path was
 * taken (observability for the manual test plan). Determinism is preserved: query results
 * remain a pure function of graph.json content — the hash gate only skips recomputing an
 * index that is already byte-equivalent to what the rebuild would produce.
 */
export function indexQueryIndexed(root: string, q: Query): Result {
  const graphFile = path.join(root, ".graph", "graph.json")
  const graphBytes = readFileSync(graphFile, "utf8")
  const graphSha = createHash("sha256").update(graphBytes).digest("hex")
  const nodes = (JSON.parse(graphBytes) as { nodes?: GraphNode[] }).nodes ?? []

  const db = openIndex(root)
  let indexRebuilt: boolean
  if (tokenIndexFresh(db, graphSha)) {
    indexRebuilt = false
  } else {
    buildTokenIndex(db, nodes, graphSha)
    indexRebuilt = true
  }
  const ids = candidateIds(db, q.terms)
  db.close()
  const pruned = nodes.filter((n) =>
    ids.has(n.id) ||
    (q.domain !== undefined && n.domain === q.domain) ||
    (q.layer !== undefined && n.level === q.layer)
  )
  return { ...queryGraph(pruned, q), indexRebuilt }
}
