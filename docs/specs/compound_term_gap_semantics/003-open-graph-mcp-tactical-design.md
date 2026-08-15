# Tactical Design — open-graph-mcp

**Domain:** `compound_term_gap_semantics`  
**Project:** `open-graph-mcp`  
**Architecture:** protocol core → durable services → MCP adapters → clients/UI

## Section 1 — Main Structure

| Element | Layer / Type | Invariants / Tech Rules | 4-line Snippet |
|---|---|---|---|
| Query Expression Policy | `packages/graph-core` domain service | Meaningful-token coverage is distinct from any-token hit; deterministic and caller-blind | `type QueryExpressionPolicy = {`<br>`  meaningfulTokens: string[]`<br>`  coverage: "complete" | "partial" | "none"`<br>`}` |
| Query Result | `packages/graph-core` result type | Partial candidates may coexist with a gap; stable ordering | `type Result = {`<br>`  candidates: Candidate[]`<br>`  gaps: string[]`<br>`}` |
| Token Index | `packages/graph-core` data adapter | Indexed path is semantically equivalent to pure path; freshness is content-hash based | `interface TokenIndex:`<br>`  candidateIds(terms): Set<string>`<br>`  rebuildWhenGraphHashDiffers(): void`<br>`  close(): void` |
| MCP Query Tool | `packages/mcp-server` adapter | Validate terms at boundary; delegate all semantic decisions | `function query(state, q, tenant): Result`<br>`  validate(q.terms)`<br>`  graph = tenantGraph(state, tenant)`<br>`  return queryGraph(graph.nodes, q)` |

## Section 2 — Value Objects / Types / Interfaces

| Name | Context / Layer | Validation & Typing Rules | 4-line Snippet |
|---|---|---|---|
| QueryExpression | Core | Non-empty original string; bounded length; preserve original for gaps | `type QueryExpression = {`<br>`  original: string`<br>`  tokens: string[]`<br>`  meaningfulTokens: string[]` |
| TokenPolicy | Core | Explicit stopwords/generic tokens; same policy in both query paths | `interface TokenPolicy:`<br>`  tokenize(value: string): string[]`<br>`  isMeaningful(token: string): boolean`<br>`  weight(token: string): number` |
| MatchEvidence | Core | Records meaningful and generic hits separately | `type MatchEvidence = {`<br>`  matchedTokens: string[]`<br>`  meaningfulCoverage: number`<br>`  score: number`<br>`}` |
| QueryResult | MCP/client contract | `gaps` remains first-class even when candidates are present | `type QueryResult = {`<br>`  candidates: Candidate[]`<br>`  gaps: string[]`<br>`}` |

## Section 3 — Domain Services / Use Cases / Actions

| Operation / Hook | Responsibility | Coordinates / Subscriptions | 4-line Snippet |
|---|---|---|---|
| TokenizeQueryExpression | Split punctuation/camelCase while retaining whole-form evidence | TokenPolicy | `TokenizeQueryExpression(value): QueryExpression`<br>`  split boundaries`<br>`  classify meaningful tokens`<br>`  preserve original` |
| EvaluateExpressionCoverage | Decide complete/partial/no coverage and gap status | QueryExpression, node evidence | `EvaluateExpressionCoverage(expr, evidence): Coverage`<br>`  ignore weak-only closure`<br>`  require meaningful coverage`<br>`  return deterministic verdict` |
| RankCandidates | Rank full and meaningful matches ahead of generic-only matches | MatchEvidence, domain/layer filters | `RankCandidates(evidence): Candidate[]`<br>`  score weighted coverage`<br>`  tie-break by id`<br>`  apply limit` |
| QueryGraph | Orchestrate pure query semantics | Tokenization, coverage, ranking | `QueryGraph(nodes, query): Result`<br>`  normalize expressions`<br>`  score nodes`<br>`  return candidates + gaps` |

## Section 4 — Events / Messages / Async Flows

| Event / Action Name | Trigger | Minimum Payload | Consumers |
|---|---|---|---|
| QueryExpressionTokenized | QueryGraph accepts expression | `{ original, tokens, meaningfulTokens }` | coverage evaluator, telemetry (if enabled) |
| CandidateEvidenceScored | Node evidence evaluated | `{ nodeId, matchedTokens, meaningfulCoverage, score }` | ranker |
| CompoundTermGapReported | Coverage is partial/none | `{ expression, reason }` | MCP client, web query bar, plugin |
| QueryResultPublished | Query completes | `{ candidates, gaps }` | MCP transport and client adapters |

## Section 5 — Persistence / Repository / Data Access Interfaces

| Resource / Adapter | Methods / Actions | Return Types / Expected State |
|---|---|---|
| GraphNodeSource | load tenant graph nodes | `GraphNode[]`; tenant-isolated, read-only |
| TokenIndexAdapter | `candidateIds`, freshness/rebuild | `Set<string>`; equivalent candidate universe |
| QueryGraphPort | pure query seam | `Result`; no persistence or transport side effects |

## Section 6 — Ordered Development Tasks

```json
[
  {
    "id": "01",
    "title": "Define Query Expression Coverage Policy",
    "description": "Specify meaningful-token, generic-token, stopword, and coverage rules so partial compound evidence remains a gap.",
    "scope": ["packages/graph-core/src/indexer.ts", "QueryExpression", "TokenPolicy"],
    "acceptance": ["A generic-only hit cannot close a compound gap", "Atomic terms preserve existing match behavior", "Policy is deterministic and caller-blind"],
    "depends_on": null
  },
  {
    "id": "02",
    "title": "Align Pure Query Ranking and Gap Reporting",
    "description": "Update pure graph querying to separate meaningful coverage from any-token evidence while retaining stable candidates and gaps.",
    "scope": ["packages/graph-core/src/indexer.ts", "queryGraph", "Candidate scoring"],
    "acceptance": ["zz-og-no-match-20260815 remains a gap despite token no", "NoAuthStrategy does not suppress the gap", "Ranking favors complete meaningful coverage"],
    "depends_on": "01"
  },
  {
    "id": "03",
    "title": "Preserve Indexed Query Equivalence",
    "description": "Ensure token-index pruning and graph-hash freshness preserve the pure path's candidates, scores, and gaps.",
    "scope": ["packages/graph-core/src/indexer.ts", "packages/graph-core/src/state-index.ts", "indexQueryIndexed"],
    "acceptance": ["Indexed and pure results are equal for compound, atomic, and filtered queries", "Stale index cannot suppress a gap", "Limits and tie-breaks remain deterministic"],
    "depends_on": "02"
  },
  {
    "id": "04",
    "title": "Verify MCP and Client Gap Contract",
    "description": "Keep MCP validation thin and ensure web/plugin consumers render partial candidates together with first-class gaps.",
    "scope": ["packages/mcp-server/src/tools/graph-query.ts", "packages/mcp-web/src/og.ts", "packages/mcp-web/src/query-bar.tsx"],
    "acceptance": ["NoAuthStrategy and anonymous paths have identical semantic verdicts", "MCP returns candidates plus the compound gap", "UI does not infer a complete match from candidates alone"],
    "depends_on": "03"
  }
]
```
