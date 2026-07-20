# Tactical Design — mcp-web

**Domain:** ui3_leitura_query | **Project:** mcp-web (com boundary pontual em mcp-server)
**Scope:** UI-3 — fechar o gap leitura/query. Entregar Claims Browser, Query bar ⌘K com gaps de 1ª classe, History, Sidebar tree. Esta fase NÃO escreve código de produção — só specs (esta), e2e (004), DoD flip e CI verde local. Production code será Phase B do orchestrator.

**Pré-condição:** UI-2 (F001) COMPLETED; culminar em `turn.tsx`, `og.ts`, `base-card.tsx`, `store.ts`, `flow/*` já merged.

**Gating (task 01):** inspecionar `GraphNode.claims` em `@open-graph-mcp/graph-core/build` (build.ts:34) confirmou `string[]` id-only. Task 02 (server PR aditivo read-only `graph://claims?cell=`) É necessária. ClaimRecord completo (claim-store.ts:14-32) só vive no server.

---

## Section 1 — Main Structure

Camada: frontend 3-layer (WD2: RF+Zustand; react-markdown AUSNTE nesta fase). Elementos que os e2e desta fase validam.

| Element | Layer / Type | Invariants / Tech Rules | 4-line Snippet |
|---|---|---|---|
| `ClaimsBrowser` | Component (UI) | painel por cell; lista `ClaimRow[]` ordenado por seq desc; abre `OpenClaim` com chips refs + "referenciado por" + `Provenance` | *see below* |
| `ClaimRow` | Component (UI) | render `id`, `subject`, `author`, `ts`, `status` badge; click → `OpenClaim` | *see below* |
| `OpenClaim` | Component (UI) | render `subject`, `anchor` verbatim, `verdict` metadados; seção "referenciado por" do reverse index | WD2: texto puro, sem markdown |
| `RefChip` | Component (UI) | label = ref id; click → centra nó referenciado (setCenter RF reuso UI-1) + abre `OpenClaim` do alvo | *see below* |
| `Provenance` | Component (UI) | rodapé: `csId`+`seq` do claim admitido | *see below* |
| `QueryBar` | Component (topbar UI) | ⌘K abre; debounce 200ms; `og.call('query', {term})`; resultados agrupados por domínio | WD3: og.call, sem api.ts |
| `QueryResult` | Component (UI) | match render id+responsibility; click → setCenter + select | *see below* |
| `GapResult` | Component (UI) | "sem resultado: '<termo>'" + `RefinementSuggestion[]` (domínios próximos lexicon) | gap é load-bearing |
| `HistoryView` | Component (route UI) | rota `/history`; filtros byUser/target/kind cliente-side over `graph://history`; clique expande payload | paridade rota velha |
| `SidebarTree` | Component (UI) | árvore domínios→níveis; `claimCount` + `lockBadge` por cell; quick filters | "CÉLULAS" do norte visual |
| `ReverseIndex` | Domain Service (client) | `Map<claimId, claimId[]>` O(edges); build lazy on first OpenClaim; invalidate on `graph.rebuilt` | *see below* |
| `useUi` (store) | Integration (zustand) | adiciona `selectedClaim`, `selectedCell`, `queryOpen`, `queryResults`, `historyFilters`, `historyEvents`, `sidebarFilter` | extende store UI-2 |
| `readClaims(cell)` | Integration (og.ts) | `resourceRead('graph://claims?cell=<domain:level>')` → `ClaimRecord[]` | WD3 + WD4 |
| `queryClaims`/`queryGraph` | Integration (og.ts) | `og.call('query', {term})` → `{matches[], gaps[]}` (server indexer já expõe) | WD3 |
| `Harness` (e2e/fixture.ts) | E2E infrastructure | reuso UI-2: server subprocess + vite preview real + BrowserContext por user | QD4 |
| `readers(h, token)` (e2e/driver.ts) | E2E driver | resourceRead em nome do user; usado p/ setup de claims commitados fora-da-UI | reuso UI-2 driver |

```
component ClaimsBrowser:
  props: cell; reads: snapshot, claimsByCell, reverseIndex
  mount: readClaims(cell) -> ClaimRecord[]
  ClaimRow click -> OpenClaim
```
```
component OpenClaim:
  claims-record: ClaimRecord; referencedBy: claimId[]
  body: subject + anchor verbatim + verdict + refs (RefChip each)
  footer: Provenance {csId, seq}
```
```
component RefChip:
  props: refId; click -> setCenter(nodeById) + open OpenClaim(refId)
```
```
component QueryBar:
  ⌘K focus; term debounce 200ms -> queryClaims(term)
  results: matches (QueryResult[]) + gaps (GapResult[])
```
```
component HistoryView:
  route /history; resourceRead('graph://history?limit=N')
  filters: {byUser, target, kind} client-side over events[]
  row click -> payload expand (collapsible JSON)
```
```
component SidebarTree:
  domains[] -> levels[]; per cell: claimCount + lockBadge
  quickFilter: 'open-turn'|'locked'|'mine' (reuses changeset.list_mine)
```
```
fn ReverseIndex.build(snapshot): Map<claimId, claimId[]>
  // O(edges): for each edge of type claim->claim ref, append source to by[target]
  // invalidation: discard on 'graph.rebuilt' event; lazy rebuild on next OpenClaim
```
```
fn readClaims(cell): Promise<ClaimRecord[]>
  // resourceRead('graph://claims?cell=' + encodeURIComponent(cell))
  // cached in store per snapshot; invalidated on graph.rebuilt
```
```
store useUi (additions over UI-2):
  selectedClaim, selectedCell, queryOpen, queryResults,
  reverseIndex, historyEvents, historyFilters, sidebarFilter
```
```
harness startHarness(): build + spawn server + preview  # reuso UI-2
  openSession(browser, name): {page, context}            # reuso UI-2
```
```
driver readers(h, token): { readClaims(cell), query(term),
  readHistory(since), commitClaim(...) }  # setup fora-da-UI p/ e2e
```

---

## Section 2 — Value Objects / Types / Interfaces

| Name | Context / Layer | Validation & Typing Rules | 4-line Snippet |
|---|---|---|---|
| `ClaimRecord` | Integration (ClaimStore import) | reuso de `@open-graph-mcp/graph-core` (claim-store.ts:14-32): id, subject, refs[], anchor, verdict?, level?, status?, seq? | import type from graph-core |
| `OpenClaimState` | Integration (store) | `claimId`, `cell`, `loading: bool`, `error?: string` | *see below* |
| `QueryResults` | Integration (og.ts) | `{matches: MatchResult[]; gaps: GapResult[]}` — retorno do server `queryGraph` (indexer) | *see below* |
| `MatchResult` | Integration (og.ts) | `nodeId`, `domain`, `responsibility`, `score` — campos já publicados pelo indexer | reuso indexer Result |
| `GapResult` | Integration (og.ts) | `{term: string; suggestions: string[]}` — load-bearing: exibido como "sem resultado: '<termo>'" + sugestões | *see below* |
| `HistoryFilters` | Integration (store) | `{byUser?: string; target?: string; kind?: string}` | *see below* |
| `HistoryEvent` | Integration (resourceRead) | `EventEnvelope` reuso state.ts: `{seq, ts, kind, target, payload, graphId}` | reuso server |
| `SidebarNode` | Integration (store) | `domain`, `level`, `cell`, `claimCount`, `lockBadge: {holder?,expiresAt?}\|null` | *see below* |
| `QuickFilter` | Integration (store) | union: `'all' \| 'open-turn' \| 'locked' \| 'mine'` | *see below* |
| `ReverseIndexMap` | Domain Service | `Map<claimId, claimId[]>` — readonly após build | *see below* |
| `ClaimsEnvelope` | Integration (resourceRead server) | `{cell, claims: ClaimRecord[]}` — retorno `graph://claims?cell=` | *see below* |

```
type OpenClaimState = { claimId: string
  cell: string; loading: boolean; error?: string }
```
```
type QueryResults = { matches: MatchResult[]
  gaps: GapResult[] }  // gaps nunca vazia quando term sem match
```
```
type GapResult = { term: string; suggestions: string[] }
```
```
type HistoryFilters = { byUser?: string
  target?: string; kind?: string }
```
```
type SidebarNode = { domain: string; level: string
  cell: string; claimCount: number
  lockBadge: { holder: string; expiresAt: string } | null }
```
```
type QuickFilter = 'all' | 'open-turn' | 'locked' | 'mine'
```
```
type ReverseIndexMap = Map<string, string[]>
  // readonly pós-build; discard on graph.rebuilt
```
```
type ClaimsEnvelope = { cell: string; claims: ClaimRecord[] }
```

---

## Section 3 — Aggregates and Domain Services

| Aggregate | Root | Invariants | Behavior | Business Rules |
|---|---|---|---|---|
| ClaimsBrowser | `useUi.selectedCell` | cell selecionada → zero ou + `ClaimRow`; `OpenClaim` único ativo | `selectCell(cell)`, `openClaim(id)`, `closeClaim()` | proveniência sempre render; "referenciado por" só se reverse index populado p/ claimId |
| QuerySession | `useUi.queryOpen` + `queryResults` | uma sessão por vez; debounce 200ms; gaps nunca suprimidos | `openQuery()`, `runQuery(term)`, `selectMatch(nodeId)`, `closeQuery()` | gap é resultado de 1ª classe mesmo com matches vazios (não é lista vazia muda) |
| HistoryView | `useUi.historyFilters` + `historyEvents` | filtros client-side over events já carregados; sem refetch por filtro | `loadHistory(since)`, `applyFilters(f)`, `openPayload(seq)` | auditoria read-only; payload expandido não é editável |
| SidebarTree | `useUi.sidebarFilter` + `domainTree` | árvore deriva do snapshot; quick filter refiltra cells | `buildTree(snapshot)`, `applyQuickFilter(q)` | "minhas contribuições" reusa changeset.list_mine (UI-2) |

**Domain Services:**

| Service | Responsibility | Dependencies | Failure Modes |
|---|---|---|---|
| `ReverseIndex` | construir `Map<claimId, claimId[]>` O(edges) do snapshot; rebuild on `graph.rebuilt` | snapshot em memória (store) | snapshot vazio → index vazio (OpenClaim mostra "sem referenciados") |
| `readClaims` | fetch `graph://claims?cell=` e cache no store | `resourceRead`, og token | 404/unbootstrapped → OpenClaim erro |
| `queryClaims` | `og.call('query', {term})` e normalização pra `QueryResults` | `og.call` | server Não-bootstrapped → erro; term vazio → não dispara |
| `readHistory` | `resourceRead('graph://history?since=N&limit=L')` | resourceRead | sem eventos → lista vazia (não erro) |
| `navigateToClaim(refId)` | centra câmera no nó RF do claim + abre OpenClaim do alvo | setCenter (RF, reuso UI-1), store | ref dangling (snapshot defasado) → toast "ref não encontrado, snapshot refresh" + trigger refetch |

---

## Section 4 — Domain Events

| Event | Producers | Consumers | Payload | Side Effects |
|---|---|---|---|---|
| `CellSelected` | SidebarTree, Canvas click | ClaimsBrowser | `cell: string` | readClaims(cell); OpenClaim fechado |
| `ClaimOpened` | ClaimRow click | OpenClaim, Provenance, ReverseIndex | `claimId: string` | garante reverse index construído; busca ClaimRecord |
| `RefNavigated` | RefChip click | Camera (setCenter RF), OpenClaim | `refId: string` | centra nó alvo + abre OpenClaim alvo |
| `QueryBarToggled` | ⌘K, esc, backdrop click | QueryBar | `open: boolean` | mount/unmount do input |
| `QuerySubmitted` | QueryBar input (debounced) | QuerySession, og.call | `term: string` | dispatch `og.call('query', {term})` |
| `MatchSelected` | QueryResult click | Camera, store | `nodeId: string` | setCenter + select; fecha QueryBar |
| `HistoryLoaded` | HistoryView mount | store | `events: EventEnvelope[]` | popula historyEvents; filtros reset |
| `HistoryFiltered` | filtro change | HistoryView (re-render) | `filters: HistoryFilters` | client-side filter over historyEvents |
| `PayloadExpanded` | row click | HistoryView | `seq: number` | toggle collapse do payload |
| `QuickFilterChanged` | sidebar click | SidebarTree, store | `filter: QuickFilter` | refilter cells |
| `ReverseIndexInvalidated` | `graph.rebuilt` SSE | ReverseIndex | — | discard index; próximo OpenClaim reconstrói |
| `DodFlipped` | editor | Roadmap doc | — | `03-scope-ui-3-leitura-query.md` header + checkboxes |
| `CiGreen` | dev shell | — | — | exit 0 |

---

## Section 5 — Persistence / Repository / Data Access Interfaces

| Resource / Adapter | Methods / Actions | Return Types / Expected State |
|---|---|---|
| `og.call` (`@open-graph-mcp/client`) | `query` (already exists; graph-query.ts), `changeset.list_mine` (UI-2) | `og.call('query', {term})` → `QueryResults`; WD3 |
| `resourceRead(serverBase, uri, token)` | `graph://snapshot`, `graph://claims?cell=<cell>` (novo), `graph://history?since=N&limit=L` | `Promise<{graph\|ClaimsEnvelope\|EventEnvelope[]}>` |
| `Harness.callTool(name, args)` (e2e) | direct tools/call RPC (reuso UI-2) | structuredContent |
| `Harness.readResource(uri)` (e2e) | direct resources/read (reuso UI-2) | JSON parsed |
| `Harness.openSession(browser, name)` | reuso UI-2: novo BrowserContext + Page autenticada | `{page, context}` |
| `Harness.control(action)` | reuso UI-2: `tick`, `sweep`, `restartServer` | `Promise<void>` |
| `webToken(page)` / `webUserId(page)` | reuso UI-2: lê `og.token`/`og.userId` | `Promise<string>` |

```
interface OgCallAPI:
  call(tool: string, args: unknown): Promise<any>
  // 'query' (ja existe), 'changeset.list_mine' (UI-2 reuso)
```
```
interface ResourceReadAPI:
  read(uri: string): Promise<any>
  // 'graph://snapshot', 'graph://claims?cell=<domain:level>',
  // 'graph://history?since=N&limit=L'
```
```
interface E2eHarnessAPI:  # reuso UI-2
  openSession(b: Browser, name: string): Promise<{page,context}>
  callTool(name, args?): Promise<any>; readResource(uri): Promise<any>
  control(action): Promise<void>
```

---

## Section 6 — Ordered Development Tasks

```json
[
  {
    "id": "01",
    "title": "Verify GraphNode.claims schema (gating) — id-only or full payload?",
    "description": "Inspect @open-graph-mcp/graph-core/build (build.ts:34) and packages/mcp-web/src/flow/to-flow.ts to determine whether GraphNode.claims carries claim ids only (string[]) or full payloads. Document veredito in spec 003 §0 (gating header) and decide if task 02 is required. Confirmed id-only per build.ts:34 — task 02 REQUIRED.",
    "project": "mcp-web",
    "files": [
      "packages/graph-core/src/build.ts",
      "packages/mcp-web/src/flow/to-flow.ts",
      "packages/graph-core/src/claim-store.ts"
    ],
    "acceptance": [
      "Spec 003 §0 (gating header) records veredito: GraphNode.claims is string[] (id-only); ClaimRecord body lives in claim-store.ts:14-32 on server only",
      "Task 02 listed as required (not NO-OP) and is the immediate dependency for any browser-emitting task",
      "No production code edited — only spec doc updated"
    ],
    "depends_on": null
  },
  {
    "id": "02",
    "title": "Additive server PR: read-only resource graph://claims?cell= (mcp-server) with unit test",
    "description": "Open additive, read-only PR in packages/mcp-server/src/resources.ts exposing graph://claims?cell=<domain:level> returning ClaimsEnvelope {cell, claims: ClaimRecord[]} from tenantSnapshot claims store. Read-only: never mutates. Add unit test in packages/mcp-server test suite. WD5: server not frozen, beta adiado allows PR. Update RESOURCE_LIST with new uri.",
    "project": "mcp-server",
    "files": [
      "packages/mcp-server/src/resources.ts",
      "packages/mcp-server/src/state.ts",
      "packages/mcp-server/test/resources.test.ts"
    ],
    "acceptance": [
      "resources.ts resolveResource adds 'claims' head branch returning {cell, claims: ClaimRecord[]} where claims come from tenant snapshot claims store (readAllClaims filtered by cell)",
      "RESOURCE_LIST adds entry {uri: 'graph://claims', name: 'claims', mimeType: 'application/json', description: 'Claims of a cell (?cell=domain:level)'}",
      "Resource is read-only: zero mutation paths; only reads from in-memory snapshot",
      "Unit test asserts: bootstrap with 2 known claims on cell auth:P3 → resourceRead('graph://claims?cell=auth:P3') returns both claims with full body (id, subject, refs, anchor, verdict, seq)",
      "Unit test asserts: missing cell arg throws 'cell key required'; unknown cell returns empty claims array (not error)",
      "Existing resources (snapshot, history, cell, domain, changeset/*) unchanged in behavior — diff is purely additive"
    ],
    "depends_on": "01"
  },
  {
    "id": "03",
    "title": "Specify ClaimsBrowser component: panel, OpenClaim, RefChip, ReferencedBy, Provenance",
    "description": "Produce component spec for ClaimsBrowser: painel por cell/domínio; lista ClaimRow[] ordered by seq desc; OpenClaim renders subject + anchor verbatim + verdict + refs as RefChip[]; 'referenciado por' section from ReverseIndex; Provenance footer (csId, seq). WD2: NO react-markdown — text/chips/anchor verbatim only.",
    "project": "mcp-web",
    "files": [
      "packages/mcp-web/src/claims-browser.tsx",
      "packages/mcp-web/src/flow/to-flow.ts",
      "packages/mcp-web/src/og.ts",
      "packages/mcp-web/src/store.ts"
    ],
    "acceptance": [
      "Spec defines ClaimsBrowser component reading selectedCell from useUi; on cell change fires resourceRead('graph://claims?cell=<cell>') returning ClaimsEnvelope",
      "Spec defines ClaimRow rendering id+subject+author+timestamp+status badge; sorted by seq desc; click sets selectedClaim and renders OpenClaim",
      "OpenClaim renders subject (text), anchor (text verbatim pre), verdict metadados (confidence/overclaim), and one RefChip per ref id (no react-markdown; no rich formatting)",
      "OpenClaim renders 'referenciado por' section listing claimIds from ReverseIndex lookup; empty index shows 'nenhum referenciado'",
      "OpenClaim footer renders Provenance {csId, seq} from ClaimRecord parent changeset",
      "RefChip click calls navigateToClaim(refId) which setCenter RF on target node and opens OpenClaim of target",
      "Loading state shows skeleton; error state shows message + retry; snapshot graph.rebuilt invalidates claims cache and reverse index"
    ],
    "depends_on": "02"
  },
  {
    "id": "04",
    "title": "Specify ReverseIndex domain service (client-side, O(edges), invalidation on graph.rebuilt)",
    "description": "Specify the reverse reference index: Map<claimId, claimId[]> built O(edges) from snapshot edges in memory; built lazily on first OpenClaim of the session; discarded on graph.rebuilt SSE; rebuild on next OpenClaim. Pure derivation, never persisted.",
    "project": "mcp-web",
    "files": [
      "packages/mcp-web/src/reverse-index.ts",
      "packages/mcp-web/src/store.ts",
      "packages/mcp-web/src/og.ts"
    ],
    "acceptance": [
      "Spec defines buildReverseIndex(snapshot): Map<claimId, claimId[]> iterating edges once O(edges); edges of type claim->claim ref contribute",
      "Index is lazy: only built when first OpenClaim needs 'referenciado por'; not eagerly on snapshot load",
      "Index stored in useUi.reverseIndex; cleared by graph.rebuilt handler (same SSE path that refetches snapshot)",
      "Index is invalidated (discard) not patched — next OpenClaim rebuilds from fresh snapshot; simpler, accepts O(edges) cost per commit",
      "Index exposed to ClaimsBrowser via useUi.reverseIndex.get(claimId) — no direct mutation paths from components",
      "OpenClaim 'referenciado por' renders list of claimIds (not full records); user can click to navigate"
    ],
    "depends_on": "03"
  },
  {
    "id": "05",
    "title": "Specify QueryBar ⌘K with gaps as first-class results and refinement suggestions",
    "description": "Produce component spec for QueryBar in topbar: ⌘K opens; debounced 200ms; og.call('query', {term}) returns {matches, gaps}; matches grouped by domain; selecting match calls setCenter and closes; gaps rendered as 'sem resultado: \\'<termo>\\'' plus refinement suggestions. WD3: og.call, no api.ts.",
    "project": "mcp-web",
    "files": [
      "packages/mcp-web/src/query-bar.tsx",
      "packages/mcp-web/src/og.ts",
      "packages/mcp-web/src/store.ts",
      "packages/mcp-server/src/tools/graph-query.ts"
    ],
    "acceptance": [
      "QueryBar mounts in topbar; ⌘K focuses input; esc closes; backdrop click closes",
      "Input change debounced 200ms before og.call('query', {term}); empty term does not fire",
      "Results render matches grouped by domain (domain headers + MatchResult rows); each row shows nodeId + responsibility; click → setCenter(nodeId) + select + close QueryBar",
      "Gaps render as first-class: 'sem resultado: \\'<termo>\\'' with refinement suggestions (nearby lexicon / domain hints); gaps are NOT collapsed under matches or hidden as empty state",
      "Loading state shows spinner during og.call; error state shows toast and leaves last results visible",
      "QueryBar uses og.call exclusively (no api.ts import); query tool already exists at graph-query.ts:9"
    ],
    "depends_on": "04"
  },
  {
    "id": "06",
    "title": "Specify History route: filters byUser/target/kind, payload click expand",
    "description": "Produce component spec for HistoryView route /history: loads graph://history?since=0&limit=N via resourceRead; filters byUser/target/kind applied client-side over loaded events; row click expands payload (collapsible JSON). Parity with rota velha estilizada no norte visual.",
    "project": "mcp-web",
    "files": [
      "packages/mcp-web/src/history-view.tsx",
      "packages/mcp-web/src/og.ts",
      "packages/mcp-web/src/store.ts"
    ],
    "acceptance": [
      "HistoryView route /history mounts and fires resourceRead('graph://history?since=0&limit=1000'); events stored in useUi.historyEvents",
      "Filters byUser (string select of known users), target (string), kind (kind enum) — all applied client-side over loaded events without refetch",
      "Row renders seq, ts, kind, target; click toggles payload expand (collapsible JSON) — payload is read-only (no edit)",
      "Filter changes re-filter the in-memory events; query strings update URL (?user=&target=&kind=) for shareable links",
      "Empty state shows 'nenhum evento'; error state shows message + retry; loading shows skeleton",
      "HistoryView uses resourceRead exclusively (no api.ts import); parity with rota velha styling per norte visual"
    ],
    "depends_on": "05"
  },
  {
    "id": "07",
    "title": "Specify SidebarTree: domains→levels with claimCount + lockBadge + quick filters",
    "description": "Produce component spec for SidebarTree: tree of domains → levels (cells) with claimCount per cell and lockBadge (holder, expiresAt) when locked; quick filters 'all', 'open-turn', 'locked', 'mine'. 'mine' reuses changeset.list_mine. 'CÉLULAS' of the norte visual.",
    "project": "mcp-web",
    "files": [
      "packages/mcp-web/src/sidebar-tree.tsx",
      "packages/mcp-web/src/store.ts",
      "packages/mcp-web/src/og.ts"
    ],
    "acceptance": [
      "SidebarTree derives domainTree from snapshot: domains[] → levels[] → SidebarNode{cell, claimCount, lockBadge}",
      "claimCount per cell derived from GraphNode.claims[] (id count — unique); lockBadge from UI-2 lock map in store",
      "Quick filter 'all' shows all cells; 'open-turn' filters to cells with locks active; 'locked' filters same as open-turn (alias); 'mine' filters to cells touched by changeset.list_mine of current user",
      "Click on a cell node triggers CellSelected event (ClaimsBrowser opens that cell); click on domain expands/collapses subtree",
      "Locked cells render lock badge with holder + expiresAt countdown (reuses UI-2 lock projection); cells without lock show plain badge",
      "SidebarTree is independent of canvas (does not render RF nodes); pure navigation/filter"
    ],
    "depends_on": "05"
  },
  {
    "id": "08",
    "title": "Specify query-and-read.e2e.ts: query→gap→query ok→open claim→navigate ref→open turn",
    "description": "Produce e2e spec covering the DoD cycle leitura→escrita: query with non-existent term surfaces gap; query with valid term returns matches; select match opens ClaimsBrowser for that cell; open claim; navigate ref chip (setCenter + open target claim); open turn in cell of read claim (reuses UI-2). Two BrowserContexts optional unless validating cross-browser.",
    "project": "mcp-web",
    "files": [
      "packages/mcp-web/e2e/query-and-read.e2e.ts",
      "packages/mcp-web/e2e/fixture.ts",
      "packages/mcp-web/e2e/driver.ts"
    ],
    "acceptance": [
      "Spec declares test.beforeAll(startHarness)/afterAll(stop) and one openSession as reader",
      "Spec triggers ⌘K on topbar; types non-existent term 'xsqwnonexistent'; within 200ms+debounce asserts .query-gap renders 'sem resultado: \\'xsqwnonexistent\\'' with refinement suggestions visible",
      "Spec clears input; types known claim subject substring; asserts QueryResult rows grouped by domain appear",
      "Spec clicks a match row; asserts canvas setCenter visibly centers the target node; ClaimsBrowser panel opens for that cell with ClaimRow entries",
      "Spec clicks a ClaimRow; asserts OpenClaim renders subject + anchor verbatim + refs as RefChip[] + provenience footer (csId, seq)",
      "Spec clicks a RefChip; asserts canvas centers the ref target and OpenClaim of the target claim opens (or toast 'ref não encontrado' if dangling)",
      "Spec clicks 'abrir turno nesta cell' button on the OpenClaim footer (reuses UI-2 TurnModal); asserts DraftPanel becomes visible — closing the read→write cycle without leaving the flow"
    ],
    "depends_on": "07"
  },
  {
    "id": "09",
    "title": "Specify history.e2e.ts: filter byUser/target/kind + payload click expand",
    "description": "Produce e2e spec for HistoryView: navigate to /history; assert events load; apply each filter and assert filtered rows match; click a row and assert payload expands as collapsible JSON. Parity with rota velha.",
    "project": "mcp-web",
    "files": [
      "packages/mcp-web/e2e/history.e2e.ts",
      "packages/mcp-web/e2e/fixture.ts",
      "packages/mcp-web/e2e/driver.ts"
    ],
    "acceptance": [
      "Spec declares test.beforeAll(startHarness)/afterAll(stop); commits a couple of changesets via driver.turns(h, token) OUTSIDE the UI so events exist in graph://history",
      "Spec opens openSession; navigates to /history; asserts .history-row entries > 0 with seq + ts + kind + target rendered",
      "Spec selects a byUser filter (a known user from setup) and asserts only rows with that user as openedBy remain visible",
      "Spec enters a target filter (a known cell/node id) and asserts only matching rows remain",
      "Spec selects a kind filter (e.g. 'changeset.committed') and asserts only matching rows remain",
      "Spec clicks a row; asserts payload expands showing JSON with structured fields (id, intent, cells) — not raw escaped string; clicking again collapses"
    ],
    "depends_on": "07"
  },
  {
    "id": "10",
    "title": "Flip DoDs and header status in 03-scope-ui-3-leitura-query.md",
    "description": "After both e2e specs (08, 09) are green, edit docs/roadmap-web-ui/03-scope-ui-3-leitura-query.md to change header status from 'proposto' to 'concluído' and flip all four Definition-of-Done checkboxes from [ ] to [x].",
    "project": "mcp-web",
    "files": [
      "docs/roadmap-web-ui/03-scope-ui-3-leitura-query.md"
    ],
    "acceptance": [
      "Header line 3 reads Status: concluído (with original data and Índice-pai preserved)",
      "All four DoD checklist items (Ciclo leitura→escrita, Gaps visíveis, e2e da fase, CI verde) show [x]",
      "No other content of the doc (sections 1-4) is modified — diff is purely status + checkbox flips"
    ],
    "depends_on": "09"
  },
  {
    "id": "11",
    "title": "Validate local CI gate: tsc, bun test, build, e2e chromium",
    "description": "Run the four-step local gate against packages/mcp-web (and packages/mcp-server if task 02 was merged) after the spec edits and DoD flip to confirm everything is green before closing the phase.",
    "project": "mcp-web",
    "files": [
      "packages/mcp-web/package.json",
      "packages/mcp-web/tsconfig.json",
      "packages/mcp-server/package.json"
    ],
    "acceptance": [
      "tsc --noEmit on packages/mcp-web exits 0 (no type errors in src or e2e)",
      "bun test passes the full unit suite of mcp-web (including any ports touched: ReverseIndex function if extracted as unit)",
      "tsc --noEmit on packages/mcp-server exits 0 (validates the additive claims resource from task 02)",
      "bun test passes the unit suite of mcp-server (including the new resources.test.ts assertions for graph://claims)",
      "vite build of mcp-web succeeds producing dist/, and playwright e2e chromium headless runs all specs in e2e/*.e2e.ts including query-and-read and history and exits 0"
    ],
    "depends_on": "10"
  }
]
```