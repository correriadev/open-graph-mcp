# Test Scenarios — open-graph-mcp

**Domain:** `compound_term_gap_semantics`  
**Project:** `open-graph-mcp`  
**Framework:** Bun Test; Playwright for `packages/mcp-web`  
**Date:** 2026-08-15

## Unit Tests

### Query Expression and Token Policy

- [ ] **Should tokenize compound expressions at punctuation and camelCase boundaries**
  - Given: `NoAuthStrategy` and `no-auth_strategy` as Query Expressions.
  - When: `TokenizeQueryExpression` runs.
  - Then: normalized tokens include `no`, `auth`, and `strategy`, with original expressions preserved.
- [ ] **Should distinguish generic-token evidence from meaningful coverage**
  - Given: a node matching only `no` and a compound expression `zz-og-no-match-20260815`.
  - When: `EvaluateExpressionCoverage` runs.
  - Then: coverage is partial and the original expression remains a Gap.
- [ ] **Should preserve atomic-term compatibility when the complete token matches**
  - Given: a node containing the atomic term `audit`.
  - When: `QueryGraph` receives `audit`.
  - Then: the candidate is returned and `gaps` is empty for `audit`.
- [ ] **Should be deterministic and immutable across repeated evaluations**
  - Given: identical nodes and Query Expression.
  - When: coverage and ranking execute twice.
  - Then: candidates, scores, and gaps are byte-for-byte equivalent.

### Candidate Ranking

- [ ] **Should rank complete meaningful coverage above generic-only evidence**
  - Given: candidates matching all meaningful tokens and candidates matching only `no`.
  - When: `RankCandidates` runs.
  - Then: complete meaningful candidates appear first with higher scores.
- [ ] **Should use stable ID ordering for equal scores**
  - Given: two candidates with identical evidence and score.
  - When: ranking runs.
  - Then: IDs determine a stable order.

## Integration Tests

### Pure and Indexed Query Paths

- [ ] **Should return identical results for pure and indexed compound queries**
  - Given: a graph containing `NoAuthStrategy`-related and generic `no` nodes.
  - When: `queryGraph` and `indexQueryIndexed` receive `zz-og-no-match-20260815`.
  - Then: candidates, scores, and gaps are equal and the expression remains a Gap.
- [ ] **Should rebuild the token index when graph content changes**
  - Given: an indexed graph hash followed by a graph mutation.
  - When: the same compound query executes.
  - Then: the index rebuilds and cannot suppress newly required gaps.
- [ ] **Should preserve domain and layer gap semantics**
  - Given: a query with a missing domain or layer filter.
  - When: pure and indexed paths execute.
  - Then: both return the same filter gaps and candidate set.

### MCP Query Host

- [ ] **Should publish partial candidates and a compound gap through `graph.query`**
  - Given: a bootstrapped tenant graph with only a generic `no` match.
  - When: the MCP client submits `zz-og-no-match-20260815`.
  - Then: response contains candidates if available and `gaps` contains the original expression.
- [ ] **Should preserve caller blindness across `NoAuthStrategy` and authenticated paths**
  - Given: equivalent graph state and anonymous versus authenticated callers.
  - When: both call `graph.query` with the same compound expression.
  - Then: semantic candidates, scores, and gaps are identical.
- [ ] **Should reject malformed terms at the adapter boundary**
  - Given: absent, non-array, or non-string `terms`.
  - When: `graph.query` is called.
  - Then: it returns the project-standard validation error without entering query semantics.

## Functional Tests

### Query Bar Flow

- [ ] **Should show a gap while retaining partial evidence for a compound expression**
  - Given: the web client is connected to a graph containing only a generic-token candidate.
  - When: the user searches `zz-og-no-match-20260815`.
  - Then: the query bar shows the gap/refinement state and does not present the result as fully found.
- [ ] **Should show a known atomic term as found**
  - Given: the graph contains a claim with `login`.
  - When: the user searches `login`.
  - Then: a ranked query result appears with no gap for `login`.

### Security and Compatibility

- [ ] **Should bound oversized or malformed expressions**
  - Given: an expression exceeding the configured maximum or containing malformed Unicode/control characters.
  - When: the MCP boundary receives it.
  - Then: it is rejected deterministically without excessive indexing work.
- [ ] **Should not expose unauthorized tenant candidates through gaps or refinements**
  - Given: two isolated tenants with different graph terms.
  - When: one tenant queries the other's compound expression.
  - Then: no candidate or suggestion leaks across tenant boundaries.
