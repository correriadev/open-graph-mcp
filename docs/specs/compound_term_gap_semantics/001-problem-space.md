# Problem Space — Compound Term Gap Semantics

**Domain:** `compound_term_gap_semantics`  
**Project:** `open-graph-mcp`  
**Date:** 2026-08-15

## 1. Event Storming

| # | Domain Event | Command (trigger) | Aggregate | External Systems | Read Models |
|---:|---|---|---|---|---|
| 1 | Query Request Accepted | Submit Graph Query | Query Request | MCP client, Claude plugin, browser | — |
| 2 | Query Expression Tokenized | Normalize Query Expression | Query Request | — | — |
| 3 | Candidate Evidence Scored | Match Query Expression | Query Result | — | Ranked candidates |
| 4 | Compound Term Gap Reported | Evaluate Unmatched Expression | Query Result | MCP client, browser query bar | Gaps and refinements |
| 5 | Query Result Published | Return Query Result | Query Result | MCP transport, client adapters | Candidates + gaps |

## 2. Subdomain Classification

| Subdomain | Type | Justification |
|---|---|---|
| Query Expression Semantics | Core | Determines whether the graph can honestly distinguish partial evidence from a fully grounded compound request. |
| Candidate Ranking | Supporting | Makes evidence useful and deterministic but is downstream of match semantics. |
| Graph Query Adapter | Supporting | Exposes the core result through MCP without owning domain rules. |
| Query UI Presentation | Supporting | Renders candidates, gaps and refinements for humans. |
| Tokenization Utilities | Generic | Reusable lexical normalization, unless its domain policy becomes differentiating. |

## 3. Ubiquitous Language Glossary

| Term | Definition | Notes |
|---|---|---|
| Query Expression | The caller-supplied term or phrase submitted to `graph.query`. | Preserve the original spelling in response gaps. |
| Atomic Term | A single semantic search term that can be evaluated independently. | Example: `NoAuthStrategy`. |
| Compound Expression | An expression containing multiple tokens that together convey one requested concept. | Must not be considered found merely because one generic token matches. |
| Token | A normalized lexical unit derived from an expression or indexed node metadata. | Case and punctuation rules are policy, not caller intent. |
| Generic Token | A token with weak discriminative value, such as `no`. | May contribute evidence but must not close a compound gap alone. |
| Stopword | A configured token ignored or down-weighted for semantic matching. | Policy must be explicit and versioned. |
| Token Boundary | A split produced by punctuation, separators, or camelCase transitions. | `NoAuthStrategy` yields `no`, `auth`, `strategy` plus whole-form evidence. |
| Match Evidence | A scored relation between an expression token and node metadata. | Evidence is not equivalent to complete expression coverage. |
| Expression Coverage | The proportion and quality of meaningful tokens supported by candidates. | Governs gap closure for compound expressions. |
| Candidate | A graph node returned as relevant evidence for a query. | Ranking must be deterministic. |
| Ranking Score | Deterministic score used to order candidates. | Should reward meaningful/full matches over generic-token matches. |
| Gap | A query expression for which required semantic evidence is insufficient. | A compound gap remains visible despite partial candidates. |
| Refinement | A suggested next query derived from a gap. | Must not silently imply the original expression was found. |
| Caller Blindness | Identical semantic verdicts regardless of caller identity or auth strategy. | `NoAuthStrategy` must not suppress a gap. |

## 4. Socratic Questions

### Business Invariants and Consistency

- What exact coverage threshold distinguishes a found compound expression from a partial match?
- Must every meaningful token match the same candidate, or may coverage be assembled across candidates?
- Is a configured stopword removed from coverage, merely down-weighted, or retained as a diagnostic?

### Scalability and Performance

- Can tokenization and candidate scoring remain bounded at one million nodes without rescanning all metadata for every query?
- Does the token index preserve identical coverage semantics to the non-indexed query path?
- How are duplicate tokens, repeated expressions, and large candidate limits bounded deterministically?

### Security and Sensitive Data

- Can malformed Unicode, punctuation, or oversized expressions cause divergent tokenization or resource exhaustion?
- Could gap suggestions expose tenant-specific terms that the caller is not authorized to read?
- Is caller blindness tested across anonymous, authenticated, and `NoAuthStrategy` paths?

### Concurrency and Failures

- What happens if graph content changes between token-index lookup and candidate scoring?
- Is a stale index able to turn a true gap into a false match or suppress a required gap?
- Are retries idempotent and do they preserve the same candidates, scores, and gaps?

### Responsibility Boundaries Between Layers

- Which layer owns compound coverage, stopword policy, and ranking so MCP adapters cannot drift semantically?
- Can the UI render partial candidates without reimplementing gap decisions?
- What contract guarantees that indexed and pure query implementations return equivalent result shapes?

**Architecture Tip:** Keep lexical policy and coverage decisions in `graph-core`; let `mcp-server` validate and delegate, and let clients render the returned candidates/gaps without semantic reinterpretation.
