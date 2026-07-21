# F008 — CONTEXT MAP

## BOUNDED CONTEXTS

| Context | Responsibility |
|---|---|
| Draft UI | Preserve editable input and display structured reasons. |
| Web Orchestration | Parse drafts, coordinate point lookups, merge projections, and navigate. |
| Claim Resource | Resolve a tenant-scoped claim by exact identifier. |
| Claim Projection | Store claims by owner cell and maintain reverse references. |
| MCP Transport | Authenticate resource reads and pass tenant identity to resolution. |

## RELATIONSHIPS

| Upstream | Downstream | Pattern | Contract |
|---|---|---|---|
| Draft UI | Web Orchestration | Customer/Supplier | `claimDraft` always resolves to an outcome envelope for expected input errors. |
| Web Orchestration | Claim Resource | Published Language | `graph://claims?id=<encodedId>` returns `{ claim }` or `{ claim: null }`. |
| MCP Transport | Claim Resource | Conformist | The authenticated tenant is server-owned and never accepted from query input. |
| Claim Resource | Claim Projection | Open Host Service | Point records reuse the paginated claim representation and redaction policy. |
| Web Orchestration | Claim Projection | Anti-Corruption Layer | Derive the UI owner cell and merge without replacing paginated state. |

## REQUEST FLOWS

### MALFORMED DRAFT

1. Draft UI submits non-empty raw text.
2. Web orchestration attempts JSON parsing inside the outcome boundary.
3. Syntax failure returns one stable user-facing reason and no warnings.
4. Draft UI renders the reason and retains the original text.

### UNCACHED REFERENCE

1. Web orchestration searches locally loaded claim pages.
2. A cache miss starts or joins a point lookup keyed by generation and claim ID.
3. Claim Resource queries the authenticated tenant by exact ID.
4. A resolved claim is merged into its owner cell without changing page cursors.
5. Web orchestration opens the claim and centers its owner cell if the generation remains current.
6. An unresolved claim enters the bounded negative cache and emits one stable missing-reference toast.

## CONTRACT CONSTRAINTS

- Give `id` precedence over cell and snapshot modes, or reject ambiguous combinations explicitly.
- Ignore pagination parameters for point lookup or reject them consistently; never return a page-shaped partial result.
- Preserve existing cell and snapshot cursor semantics unchanged.
- Keep response absence non-exceptional to avoid turning normal dangling references into transport errors.
- Do not disclose file-system prefixes or foreign-tenant existence.

## PROJECT OWNERSHIP

| Project | Owned concern |
|---|---|
| `mcp-server` | Exact tenant query, response envelope, resource discovery, and isolation tests. |
| `mcp-web` | Draft error normalization, single-flight lookup, merge/navigation, caching, and UX evidence. |

