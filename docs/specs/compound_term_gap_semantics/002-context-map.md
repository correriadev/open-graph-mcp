# Context Map — Compound Term Gap Semantics

**Domain:** `compound_term_gap_semantics`  
**Project:** `open-graph-mcp`  
**Date:** 2026-08-15

## 1. Bounded Context Identification

| Bounded Context | Responsibility | Boundary (excluded) | Team Ownership | Key Entities |
|---|---|---|---|---|
| Query Expression Semantics | Normalize expressions, classify tokens, determine meaningful coverage and gaps. | Does not expose MCP, persist graph state, or render UI. | Graph Core | Query Expression, Token Policy, Match Evidence |
| Published Graph Index | Supply graph nodes and token-index candidates for deterministic search. | Does not decide caller-facing gap language or UI refinements. | Graph Core / persistence | Graph Node, Token Index |
| MCP Query Host | Validate tool input, resolve tenant graph, delegate query, publish result. | Does not reimplement tokenization, ranking, or coverage. | MCP Server | Query Request, Query Result |
| Client Query Experience | Display ranked candidates, gaps, and refinements across plugin/web clients. | Does not infer that partial candidates close a gap. | Client/UI | Candidate View, Gap View |

## 2. Context Map

`Query Expression Semantics` → `Published Graph Index`  
Pattern: **Customer-Supplier**  
Direction: downstream → upstream  
Justification: semantics consumes normalized index evidence while the index owns graph metadata and freshness.

`Published Graph Index` → `MCP Query Host`  
Pattern: **Open Host Service + Published Language**  
Direction: upstream → downstream  
Justification: the host consumes a stable `Query`/`Result` contract and tenant-scoped graph source.

`Query Expression Semantics` → `MCP Query Host`  
Pattern: **Open Host Service**  
Direction: upstream → downstream  
Justification: MCP delegates the domain verdict and must remain a thin validation boundary.

`MCP Query Host` → `Client Query Experience`  
Pattern: **Published Language**  
Direction: upstream → downstream  
Justification: `{ candidates, gaps }` is the client contract; clients must preserve first-class gaps.

`Published Graph Index` → `Client Query Experience`  
Pattern: **Separate Ways**  
Direction: none  
Justification: UI does not access graph/index internals and receives only the host result.

## 3. Core Domain Highlight

**Context:** Query Expression Semantics  
**Reason:** honest distinction between complete and partial compound evidence is the differentiator behind trustworthy graph navigation.  
**Investment:** deterministic token policy, meaningful-token coverage, indexed/pure equivalence, and exhaustive regression scenarios.

## 4. Architectural Decisions

**Decision:** Keep compound coverage and gap closure in `packages/graph-core`.  
**Context:** adapters and clients must not diverge from the domain verdict.  
**Consequences:** one source of truth; core API evolves carefully.

**Decision:** Preserve `{ candidates, gaps }` as a published result, allowing partial candidates with a non-empty gap.  
**Context:** partial evidence is useful but must not masquerade as a complete match.  
**Consequences:** clients need explicit partial-result rendering; backwards-compatible shape is retained.

**Decision:** Define generic-token/stopword policy explicitly and apply it equally to pure and indexed paths.  
**Context:** tokens such as `no` currently create false positives.  
**Consequences:** policy changes affect ranking and gap behavior and require fixtures.

**Decision:** Treat `NoAuthStrategy` as an ordinary atomic term and never let auth strategy or caller identity alter semantic coverage.  
**Context:** caller blindness is a required invariant.  
**Consequences:** auth tests and anonymous paths must share semantic assertions.
