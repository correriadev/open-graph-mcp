# Component Specs — UI-3 (F002 tasks 03–07)

**Domain:** ui3_leitura_query | **Project:** mcp-web | **Date:** 2026-07-20
**Source of truth:** `003-mcp-web-tactical-design.md` §1–§5; this doc consolidates per-component specs
required by tasks 03 (ClaimsBrowser), 04 (ReverseIndex), 05 (QueryBar), 06 (HistoryView), 07 (SidebarTree).
Production code is committed in `packages/mcp-web/src/{claims-browser,reverse-index,query-bar,history-view,sidebar-tree}.tsx` and wired in `app.tsx` and `store.ts`.

---

## 03 — ClaimsBrowser

Component path: `packages/mcp-web/src/claims-browser.tsx`

**Behavior (production invariants):**
- Reads `useUi.selectedCell` from `useUi`; on cell change fires `readClaims(cell)` → `resourceRead('graph://claims?cell=<cell>')` (og.ts readClaims).
- Stores results into `useUi.claimsByCell[cell]`. Cached; invalidated on `graph.rebuilt` (invalidateReverseIndex clears claims caches).
- Lists `ClaimRow[]` ordered by `seq` desc; click sets `useUi.selectedClaimId` and renders `OpenClaim`.
- `OpenClaim` renders: `subject` (text), `anchor` (verbatim `<pre>`), `verdict` metrics, one `RefChip` per ref id, "referenciado por" section listing claimIds from `ReverseIndex.lookup(claimId)`, `Provenance` footer (seq, supersedes).
- Empty cell → "nenhum claim nesta cell" (no error). Loading skeleton; error → message + retry (click re-fetches + invalidates).
- WD2: no `react-markdown`; text/chips/<pre> only.
- `RefChip` click → `useUi.openClaim(refId)`; if target not in loaded claims → falls through (handled by ReverseIndex / future toast on dangling).

**e2e DOM API:** `#claims-panel`, `.claim-row` (data-id), `.open-claim` (data-id), `.ref-chip`, `.referenced-by`, `.provenance`, `#close-claims`.

---

## 04 — ReverseIndex

Code path: `packages/mcp-web/src/reverse-index.ts` + og.ts `buildReverseIndex` / `invalidateReverseIndex`.

**Behavior:**
- `buildReverseIndex(claims): Map<claimId, claimId[]>` — pure function, single pass over ClaimRecord.refs.
- Lazy: built on first OpenClaim render (ClaimsBrowser useEffect triggers). Not eagerly on snapshot load.
- Stored in `useUi.reverseIndex`; invalidateReverseIndex clears the map and drops `claimsByCell` cache when store receives `graph.rebuilt` (applyEvent).
- Discard (not patch) semantics — next OpenClaim rebuilds from fresh claims. Accepts O(N×refs) per rebuild; bounds stay small per session.
- Comes from ClaimRecord (not graph.edges): production GraphEdge.type is only "depends-on"/"survey" (no claim→claim edge); documented adaptation in TDD-OUTPUT.
- OpenClaim "referenciado por" reads `useUi.reverseIndex.get(claimId)`; empty list renders `nenhum referenciado`.
- Unit tests: `packages/mcp-web/test/reverse-index.test.ts` (004 §1.3): empty, 3-edge map spec, O(N)/N=1000 < 50ms, discard path.

---

## 05 — QueryBar ⌘K

Component path: `packages/mcp-web/src/query-bar.tsx`

**Behavior:**
- ⌘K (or Meta+K on macOS test env) opens; `Esc`, backdrop click closes.
- Input change debounced 200ms before og.call. Empty term doesn't fire. Test exposure: `window.__og_query_call_count()`.
- `og.call('graph.query', {terms:[term]})` returns `{candidates, gaps}`. Adapter named `queryClaims(term)` normalises to `{candidates: MatchResult[], gaps: GapResult[]}` (server's gap value is a string list — wrapped with `{term, suggestions}` derived from snapshot domain lexicon).
- Matches grouped by domain with domain headers; each row shows nodeId + responsibility + score; click → `setSelectedId` + `requestCenter(cell)` + `useUi.setSelectedCell(cell)` (opens ClaimsBrowser) + closes QueryBar.
- Gaps rendered as first-class: `.query-gap` with `sem resultado: '<termo>'` + `.refinement-suggestion` chips (domain hints). Gaps NOT hidden when matches present; gap is always visible (DoD).
- Loading spinner during og.call; error toast (reuses pushToast path) — pending; current implementation logs and leaves last results visible.
- WD3: `og.call` exclusively (no api.ts).

**e2e DOM API:** `#query-input`, `#query-backdrop`, `.query-results`, `.query-result`, `.query-gap`, `.refinement-suggestion`, `#queryBtn`.

---

## 06 — HistoryView

Component path: `packages/mcp-web/src/history-view.tsx`

**Behavior:**
- Routed at `/history` (hash route `#/history`; app.tsx `RouteDriver`). Loads via `readHistory(0, 1000)` → `resourceRead('graph://history?since=N&limit=L')`. Stored in `useUi.historyEvents`.
- Filters byUser / target / kind applied client-side over loaded events; no refetch on filter change. URL `?user=&target=&kind=` initialised from querystring (paridade shareable). `select#history-byuser`, `input#history-target`, `select#history-kind`.
- Row renders `seq`, `ts`, `kind`, `target`; click toggles payload expand (collapsible JSON via `<pre>`); payload is read-only (no edit). `payload.openedBy`, `target_id`, `payload.cells` are the filter fields depending on kind.
- Empty state → "nenhum evento"; error → message + retry (readHistory button).
- WD3: `resourceRead` exclusively.

**e2e DOM API:** `#history-view`, `.history-row` (data-seq, data-kind, data-target), `.history-payload`, `#history-byuser`, `#history-target`, `#history-kind`, `#nav-history`.

---

## 07 — SidebarTree

Component path: `packages/mcp-web/src/sidebar-tree.tsx`

**Behavior:**
- Derives domainTree from `useUi.graph`: domains → levels → `SidebarNode{cell, claimCount, lockBadge}`.
- `claimCount` per cell = sum of `GraphNode.claims.length` over nodes of that cell (id-only count from snapshot).
- `lockBadge` (🔒) when `useUi.locks[cell]` is active; hidden otherwise.
- Quick filters (`all`, `open-turn`, `locked`, `mine`) — `open-turn` and `locked` both filter to locked-active cells (alias per spec acceptance 07.3). `mine` filters to cells in `myTurns` (reuses `changeset.list_mine`).
- Click on a cell → `useUi.setSelectedCell(cell)` (cell selected → ClaimsBrowser opens). Click on a domain expands/collapses subtree.
- Independent of canvas (no RenderFlow nodes); pure navigation/filter.

**e2e DOM API:** `#sidebar-tree`, `.sidebar-cell` (data-cell), `.lock-badge` (data-holder), `.quick-filter[data-quickfilter=mine|locked|open-turn|all]`.