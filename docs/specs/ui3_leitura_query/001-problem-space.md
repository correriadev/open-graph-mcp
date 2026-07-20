# Strategic Design — Problem Space

**Domain:** ui3_leitura_query
**Project:** mcp-web (com PR aditivo pontual em mcp-server)
**Date:** 2026-07-19
**Scope source:** `docs/roadmap-web-ui/03-scope-ui-3-leitura-query.md` — UI-3 (leitura/query). Gap central da reescrita: a UI escreve mas não lê. Antecedente: UI-2 (F001) COMPLETED.

---

## Section 1 — Event Storming

Big Picture flow. Eventos ordenados do primeiro intento do leitor até o resultado observável cross-canvas.

| # | Domain Event (past tense) | Command (trigger) | Aggregate | External Systems | Read Models |
|---|---|---|---|---|---|
| 1 | ClaimsSchemaVerified | task 01 — inspeciona `GraphNode.claims` em `@open-graph-mcp/graph-core/build` + `to-flow.ts` | Spec (gating) | graph-core build | `claimsIsIdOnly: boolean` (veredito da task) |
| 2 | ClaimsResourceAddedOnServer | task 02 — PR aditivo `graph://claims?cell=` read-only | mcp-server resources | mcp-server (SQLite/graph snapshot) | `ClaimsEnvelope{cell, claims[]}` |
| 3 | BrowserOpened | user clica numa cell do canvas / sidebar | Claims Browser (UI) | mcp-server (`resourceRead`) | `selectedCell`, `claimsList` |
| 4 | ClaimRendered | user clica num claim da lista | Claims Browser (UI) | snapshot em memória | `selectedClaim`, proveniência footer |
| 5 | RefNavigated | user clica num chip de ref num claim aberto | Claims Browser (UI) | snapshot (centra nó) | câmera centraliza nó referenciado |
| 6 | ReverseRefComputed | snapshot carregado → índice reverso edra→claims O(edges) | Reverse Index (client) | snapshot em memória | `referencedBy: Map<claimId, claimId[]>` |
| 7 | ReverseRefInvalidated | `graph.rebuilt` (commit) → snapshot refetch → índice reconstruído | Reverse Index (client) | mcp-server SSE | índice descartado e reconstruído |
| 8 | QueryBarFocused | user pressiona ⌘K | Query (topbar UI) | — | `queryOpen: true` |
| 9 | QueryTermSubmitted | user digita termo + Enter | Query | mcp-server (`og.call('query', ...)`) | `queryResults{matches[], gaps[]}` |
| 10 | GapSurfaced | server retorna gap (termo sem match) | Query | mcp-server `queryGraph` (já expõe gaps) | render "sem resultado: '<termo>'" + sugestão refinamento |
| 11 | QueryResultSelected | user seleciona match | Query | snapshot (centra nó) | câmera centraliza + seleciona nó |
| 12 | HistoryRouteOpened | user navega para `/history` | History (UI) | mcp-server (`resourceRead('graph://history')`) | `historyEvents[]` |
| 13 | HistoryFiltered | user ajusta filtros byUser/target/kind | History (UI) | — | `filteredEvents[]` |
| 14 | HistoryPayloadOpened | user clica num evento | History (UI) | — | `selectedEvent.payload` expandido |
| 15 | SidebarTreeRendered | snapshot carregado | Sidebar (UI) | snapshot em memória | `domainTree{domains→levels→claimCount, lockBadge}` |
| 16 | QuickFilterApplied | user clica "com turno aberto"/"bloqueados"/"minhas contribuições" | Sidebar (UI) | og.call changeset.list_mine | `filteredCells[]` |
| 17 | ReadToWriteCycleClosed | user abre turno na cell do claim lido (reuso UI-2) | Changeset (UI-2) | mcp-server | `activeCs` (ciclo leitura→escrita) |
| 18 | DodFlipped | editor `[]→[x]` + header `proposto→concluído` | Roadmap doc | — | `03-scope-ui-3-leitura-query.md` |
| 19 | CiGreen | dev roda `tsc && bun test && build && e2e chromium` | CI gate | shell | exit 0 |

---

## Section 2 — Subdomain Classification

| Subdomain | Type | Justification |
|---|---|---|
| Claims Browser | Core | transforma co-criação em "mesa de leitura": sem isso, escreve-se cego. Refs navegáveis + reverso + proveniência são o diferencial |
| Query + Gaps de 1ª classe | Core | gaps são load-bearing — ensinam vocabulário do grafo; sem isso, lista vazia é muda |
| Reverse Reference Index | Core | viabiliza "referenciado por" sem O(n²) por render — derivado do snapshot, invalidado por commit |
| History | Core | paridade com rota velha — auditoria acessível é energia de confiança na co-criação |
| Sidebar de navegação | Core | "CÉLULAS" do norte visual — porta de entrada para leitura orientada |
| Server claims resource (aditivo) | Supporting | habilita Claims Browser se task 01 confirmar schema id-only; read-only, aditivo, PR pequeno — não diferencial |
| DoD bookkeeping | Supporting | flip mecânico no doc roadmap |
| CI validation | Supporting | gate regressão padrão (WD1 — e2e blocking) |

---

## Section 3 — Ubiquitous Language Glossary

| Term | Definition | Notes |
|---|---|---|
| Claim | `ClaimRecord` (claim-store.ts:14-32): id, subject, refs, anchor, verdict, level, status, seq | corpo completo vive no server; GraphNode.claims é só ids |
| Claims Browser | painel por cell que lista claims + abre claim completo com refs chips + reverso + proveniência | UI-3 núcleo |
| Chip de ref | token clicável representando um `claim.id` ou meta-id referenciado pelo claim aberto | clique centra e abre referenciado (WD2: texto puro/anchor verbatim, sem react-markdown) |
| Referenciado por | seção do claim aberto: lista de claim-ids cujos `refs` contêm o claim aberto | reverso derivado do snapshot em memória O(edges), invalidado por commit |
| Proveniência | rodapé do claim aberto: `csId` + `seq` | auditoria — qual changeset admitiu, ordem do log |
| Query bar | input no topbar disparado por ⌘K; chama `og.call('query', {term})` | WD3: og.call, sem api.ts |
| Gap | termo sem match retornado como resultado de 1ª classe: "sem resultado: '<termo>'" + sugestão de refinamento | `queryGraph` (graph-core/indexer) já retorna gaps |
| Snapshot | projeção `graph://snapshot` (WD4) — fonte da verdade cliente-side | base do índice reverso e da sidebar tree |
| Reverse Index | `Map<claimId, claimId[]>` construído uma vez por snapshot no cliente | O(edges); invalidado por `graph.rebuilt` |
| History | rota `/history` com filtros byUser/target/kind; clique expande payload | paridade com rota velha estilizada no norte visual |
| Sidebar tree | árvore domínios → níveis com `claimCount` + `lockBadge` por cell | "CÉLULAS" do norte visual |
| Quick filter | filtros rápidos: "com turno aberto", "bloqueados", "minhas contribuições" | reusa `changeset.list_mine` (UI-2) |
| Ciclo leitura→escrita | achar claim via query → abrir browser → navegar refs → abrir turno na cell do claim lido | DoD 1 da fase; reusa UI-2 |
| DoD | Definition of Done da fase UI-3 | 4 checkboxes no rodapé de `03-scope-ui-3-leitura-query.md` |

---

## Section 4 — Socratic Questions

**Business Invariants and Consistency**
1. O índice reverso é derivado do snapshot em memória; se dois clients têm snapshots defasados (um pre-commit, outro pós-commit), o "referenciado por" diverge entre eles — isso é bug ou feature (eventual consistency)?
2. A proveniência mostra `csId`+`seq` de admissão; se o claim foi admitido por um changeset abortado depois, o `seq` ainda é válido como auditoria?
3. Gap de query é terminado que o server não casou — se o grafo ainda está bootstrapping (snapshot vazio), qual é o gap vs "ainda não carreguei"?

**Scalability and Performance**
4. O índice reverso O(edges) construído por snapshot — em grafo de milhares de nós/edges, qual o custo médio (edges em escala 10³-10⁴) e vale cache incremental ou rebuild total por commit?
5. Query bar com termo curto (1-2 chars) em grafo grande — o server `queryGraph` é síncrono; qual debounce mínimo no cliente pra não chicotear o server?

**Security and Sensitive Data**
6. O `referencedBy` expõe claim-ids de autores outros — é informação legível por qualquer user do tenant? Lockdown ou aberto por padrão?

**Concurrency and Failures**
7. User clica num chip de ref; o claim alvo foi recém-commitado por outro user e o snapshot local ainda é o anterior — o chip quebra (dangling)? Mitigação: refetch antes de centralizar?
8. `graph.rebuilt` chega no meio da renderização do browser — o índice reverso é invalidado e reconstruído sincronamente ou lazy no próximo acesso?

**Responsibility Boundaries Between Layers**
9. Sidebar tree filtra cells via `changeset.list_mine` (UI-2); o quick filter "minhas contribuições" depende de commits admits pelo user — o server já expõe isso ou precisa query joined?
10. WD3 manda toda chamada por `og.call()` ou `resourceRead`; filtros byUser de history são client-side sobre `graph://history` ou roteados por server?

**Architecture Tip:** spec e2e deve guiar a UI pelo DOM e validar seletores estáveis (`.claim-chip`, `.claim-provenance`, `.query-gap`, `.history-row`). Nunca ler o store zustand direto — prova a costura SSE→snapshot→índice→render.