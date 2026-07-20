# F002 REWORK-LOG — RETRY #1 (2026-07-20)

Trigger: Phase C scores TL=0.62 (<0.70), QA=0.45 (<0.70). No app crash (continuable). Reworks 0→1 (<maxReworks=2).

## openPoints (from TL.json)

1. claimsOfCell `SELECT` filters tenant in JS — N+1, O(tenant) per read. Push domain+level into SQL predicate.
2. ReverseIndex built per-cell but spec 003 §3 mandated snapshot-wide O(edges). Cross-cell referenciado-por invisible.
3. Cross-cell RefChip navigation deferred to Phase B while DoD asserted [x]. Either implement now or revert DoD + scope.
4. HistoryView filter URL only read at mount, never `replaceState` on change — shareable links broken, DoD flipped anyway.
5. Module-level `setInterval` (pollWho/projectPresence) never cleared; clearInterval on onClose missing.
6. Module-level mutable debounce + `window.__og_query_call_count` shipped to prod namespace.
7. og.ts god module 557 lines — introduce extraction seam (history-view, claims-browser already split; keep ReverseIndex service boundary).
8. graph://history?limit=1000 hardcoded, no cursor — tenants >1k silently lose audit.
9. navigateToClaim fallback fires full `loadSnapshot` per dangling ref, no negative cache, no debounce.
10. resolveResource tenant defaults to DEFAULT_TENANT — defense-in-depth on read path missing.
11. Silent NULL level coercion to `'5'` — phantom claims at level 5; hides upstream data quality.
12. SidebarTree `(out as any).__mine` smuggle side channel — type-breachable, future consumers render as domain.

## edgeCasesMissed (from QA.json)

A. **navigateToClaim canvas never centers** (spec 003 §3 + §21 broken): impl only `openClaim(refId)`, no `setSelectedCell(ownerCell)` + `requestCenter`. e2e self-deprecates as "TBD fase B" — assert skipped. MUST: locate ownerCell by scanning claimsByCell, setSelectedCell BEFORE openClaim, requestCenter + fallback. e2e MUST assert cross-cell chip nav.

B. **Cross-cell refs silently swallowed**: claim IS cached in different cell → ClaimsBrowser `active=null`, no toast. claim-id gating broken cross-cell.

C. ReverseIndex scope drift (mirrors openPoint 2) — unit test only covers intra-cell. Add cross-cell source-in-A/target-in-B test.

D. Sidebar `claimCount += n.claims.length` without de-dup — multi-file claims share claimId → double count. Spec 003 §351-352 demanded unique id count.

E. history byUser filter only matches `payload.byUser/openedBy`. lock.acquired/released hold user in `payload.holder`; authority.demoted in `payload.by`. e2e 003 §3.1 alice+bob drops bob's lock events. Filter must union: payload.byUser | payload.openedBy | payload.holder | payload.by.

F. History filter URL never written on change (mirrors openPoint 4). Add e2e: change filter → nav away → return → assert URL+state reflect last choice.

G. QueryBar `(c.score ?? 0).toFixed(2)` trusts non-null numeric. Malformed server `score:'high'` → TypeError render crash. Validate `typeof score === 'number' ? score : 0`; validate `typeof domain === 'string'`. Add malformed-payload unit test.

H. claimsOfCell malformed cell (`'auth'`, `':P3'`) silently returns level-5 claims, cache-key collisions. Validate cell has colon, reject malformed rather than coercing.

I. claimsOfCell unbounded tenant-wide scan on uncached/large tenants (mirrors openPoint 1). Push domain+level predicate into SQL; respect 004 §174 200ms budget.

J. ClaimRecord.file serialized verbatim to tenant callers — server filesystem layout disclosure. Redact/trim path prefix.

K. history-view `typeof e.ts === 'string' ? new Date(e.ts) : new Date(e.ts)` dead ternary — malformed epoch renders 'Invalid Date' silently. Guard ts.

L. graph.rebuilt invalidates ReverseIndex but lazy-build effect never rebuilds for already-open OpenClaim (`!reverseIndex && claims?.length > 0` — claimsByCell empty after rebuild). Auto-rebuild on rebuild regardless of active selection.

## Required work for RETRY #1

- [server] claimsOfCell: SQL predicate domain+level; reject malformed cell (require colon); redact file path prefix.
- [web] navigateToClaim: ownerCell lookup → setSelectedCell → openClaim → requestCenter; cross-cell ref handled with toast if owner out-of-snapshot.
- [web] ReverseIndex: build snapshot-wide (`Object.values(claimsByCell).flat()`); add cross-cell unit test.
- [web] HistoryView: filter via union(byUser|openedBy|holder|by); `history.replaceState` on filter change.
- [web] QueryBar: numeric/string validation; remove `window.__og_query_call_count` from prod (move behind `import.meta.env.DEV`).
- [web] og.ts: clearInterval on close; negative cache + debounce on navigateToClaim fallback.
- [web] SidebarTree: unique claimCount dedup; remove `(out as any).__mine` smuggle.
- [web] graph.rebuilt: auto-rebuild ReverseIndex regardless of active selection.
- [e2e] query-and-read.e2e.ts: assert cross-cell chip nav (setSelectedCell + center).
- [e2e] history.e2e.ts: assert filter-change → URL update → round-trip preserves.
- [DoD] Reconcile 03-scope-ui-3-leitura-query.md: items resolved by RETRY flip to [x] honestly; items still deferred (e.g. Phase B turn-modal cross-cell) flipped back to [ ].
- [CI] tsc + bun test + build + e2e chromium + mcp-server suite green.