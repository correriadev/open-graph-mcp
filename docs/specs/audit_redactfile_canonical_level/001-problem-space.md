# F009 — DENY-BY-DEFAULT PATHS AND CANONICAL CLAIM LEVELS

## SCOPE

Prevent claim resources from disclosing filesystem layout across POSIX, Windows, UNC, mixed-separator, and misconfigured-root inputs. Validate and canonicalize claim levels before durable staging, commit, cache mutation, or broadcast while preserving supported claim APIs and JSONL recovery.

## DOMAIN EVENTS

1. **Claim Delta Received** — an authenticated changeset receives a `claim.add` payload.
2. **Claim Level Evaluated** — the server accepts a supported wire level or returns a stable rejection.
3. **Claim Level Canonicalized** — accepted input is converted to one internal and durable representation.
4. **Claim Delta Staged** — only a canonical payload enters `cs_deltas` and its JSONL mirror.
5. **Claim Committed** — canonical level data enters claims storage, caches, graph projection, and events.
6. **Claim Resource Requested** — stored file metadata is projected for an authenticated tenant.
7. **File Path Classified** — the server proves a safe relative path or reduces the value to a basename.
8. **Durable State Rebuilt** — replay canonicalizes supported legacy levels before claims become queryable.

## SUBDOMAINS

| Subdomain | Type | Responsibility |
|---|---|---|
| Claim Admission | Core | Reject malformed levels before staging and side effects. |
| Claim Persistence | Core | Store one canonical claim-level representation. |
| Resource Redaction | Supporting | Return useful file identity without host-layout disclosure. |
| Durable Recovery | Supporting | Normalize supported legacy values during JSONL replay. |

## UBIQUITOUS LANGUAGE

| Term | Meaning |
|---|---|
| Wire Level | Supported API form: integer `0`–`5` or exact string `P0`–`P5`. |
| Canonical Numeric Level | Integer `0`–`5` used by gates and cell derivation. |
| Canonical Stored Level | Exact string `P0`–`P5` used by SQLite and JSONL claims. |
| Admission Boundary | Validation before `cs_deltas` persistence and delta aggregation. |
| Trusted Repository Path | A normalized file proven to be inside the configured repository root. |
| Safe Relative Path | A separator-normalized, traversal-free path containing no drive, scheme, or absolute-root prefix. |
| Basename Fallback | Final path segment returned when ancestry cannot be proven safe. |
| Recovery Boundary | JSONL replay that validates and canonicalizes durable claim rows. |

## BUSINESS RULES

- Claim levels MUST be present and limited to the supported ladder `0`–`5`.
- Accepted numeric and `P`-prefixed wire forms MUST become canonical before staging.
- Booleans, floats, infinities, whitespace variants, signs, extra prefixes, and out-of-range values MUST be rejected.
- A rejected claim MUST NOT persist a delta, increment aggregation, mutate caches, or broadcast.
- Claim storage and JSONL mirrors MUST use exact `P0`–`P5` values.
- Recovery MUST canonicalize supported legacy numeric values and reject or quarantine invalid durable claim rows.
- File projection MUST expose a relative repository path only when containment is proven.
- Untrusted absolute, UNC, drive-relative, URL-like, traversal, and mismatched-root paths MUST reveal at most a sanitized basename.
- Redaction MUST never throw on malformed strings.

## RISKS AND RESOLUTIONS

| Risk | Autonomous Resolution |
|---|---|
| Prefix confusion such as `/repo2` under `/repo` | Compare normalized path segments, not raw string prefixes. |
| Windows paths on a POSIX host | Classify both slash dialects without depending only on host `path` semantics. |
| UNC and extended-device paths | Treat their ancestry as untrusted and return basename only. |
| `..` traversal in relative values | Normalize segments and deny relative ancestry that escapes its base. |
| Invalid level already staged | Revalidate at commit/write as defense in depth and preserve atomic rollback. |
| JSONL restores numeric levels | Normalize during replay before indexed reads resume. |
| Invalid durable legacy row | Fail recovery deterministically without partially exposing corrupt claims. |

## ACCEPTANCE BOUNDARY

- Resource outputs reveal no directory ancestry for untrusted path dialects or repository-root mismatch.
- Supported claim level inputs persist and replay only as `P0`–`P5`.
- Invalid levels produce stable admission failures before persistence, aggregation, cache, graph, or event effects.
- Existing cell and point claim reads continue returning numeric levels and valid redacted file values.

