# Test Scenarios — mcp-web

**Domain:** ui3_leitura_query
**Project:** mcp-web (com boundary pontual em mcp-server)
**Framework:** Playwright (`@playwright/test`) + bun test para unit suite de server; harness e2e em `packages/mcp-web/e2e/fixture.ts`
**Date:** 2026-07-19

> Scope: cenários derivados do `003-mcp-web-tactical-design.md`. São especificações (Given/When/Then), NÃO código executável. Phase B implementa os `.e2e.ts` e o additive server resource. Ubiquitous Language do `001-problem-space.md` usada integralmente. WD2: sem react-markdown nesta fase.

---

## Section 1 — Unit Tests

> Escopo mínimo nesta fase. A única lógica unit-testável nova é `ReverseIndex.build` (pura, sem fs/DOM, deriva de edges) e o handler de resource `graph://claims?cell=` no server (task 02).

### 1.1 Aggregates and Aggregate Roots
N/A — ClaimsBrowser, QuerySession, HistoryView, SidebarTree são aggregates de UI; seu comportamento é funcional-testado via e2e (Section 3).

### 1.2 Value Objects
N/A — `ClaimRecord`, `MatchResult`, `GapResult`, `HistoryEvent`, `SidebarNode` são tipos importados/derivados; validação tipográfica pelo tsc.

### 1.3 Domain Services

- [ ] **ReverseIndex.build should return empty map for empty snapshot**
  - Given: snapshot com 0 edges.
  - When: chamar `buildReverseIndex(snapshot)`.
  - Then: retorna `Map` vazio; `.size === 0`.

- [ ] **ReverseIndex.build should map target claimId to source claimId for each claim->claim ref edge**
  - Given: snapshot com 3 edges `{from:'c2', to:'c1', type:'depends-on'}`, `{from:'c3', to:'c1', type:'depends-on'}`, `{from:'c3', to:'c2', type:'depends-on'}`.
  - When: chamar `buildReverseIndex(snapshot)`.
  - Then: `Map['c1'] === ['c2','c3']`, `Map['c2'] === ['c3']`, `Map['c3'] === undefined`.

- [ ] **ReverseIndex.build should be O(edges) — single pass over edges**
  - Given: snapshot com N edges (N=1000 fixture).
  - When: chamar `buildReverseIndex(snapshot)` e contar iterações.
  - Then: número de iterações === N (uma passada); nenhum nested loop sobre claims.

- [ ] **ReverseIndex invalidation discards map on graph.rebuilt event**
  - Given: `useUi.reverseIndex` populado com 3 entradas.
  - When: store recebe evento SSE `graph.rebuilt` (mesmo handler que refetcha snapshot).
  - Then: `useUi.reverseIndex` é setado para `null` (ou new empty Map); próximo `OpenClaim` reconstrói.

### 1.4 Domain Events
N/A — eventos SSE (`graph.rebuilt`, `lock.released`) são emissões do server, cobertos pelo integration suite do mcp-server; aqui só consumidos.

---

## Section 2 — Integration Tests

### 2.1 Repositories

- [ ] **mcp-server resolveResource('graph://claims?cell=auth:P3') returns ClaimsEnvelope with full ClaimRecord[]**
  - Given: server bootstrapped com fixture contendo 2 claims admitidos na cell `auth:P3` (csId='cs1', seqs=1 e 2).
  - When: chamar `resolveResource(state, 'graph://claims?cell=auth:P3', DEFAULT_TENANT)`.
  - Then: retorna `{cell:'auth:P3', claims:[ClaimRecord, ClaimRecord]}`; cada claim tem `id`, `subject`, `refs[]`, `anchor`, `verdict?`, `level?`, `status?`, `seq?`.

- [ ] **mcp-server resolveResource('graph://claims') throws 'cell key required'**
  - Given: server bootstrapped, nenhuma mutação.
  - When: chamar `resolveResource(state, 'graph://claims', DEFAULT_TENANT)`.
  - Then: lança `Error('cell key required')`.

- [ ] **mcp-server resolveResource('graph://claims?cell=unknown:P1') returns empty claims array (not error)**
  - Given: server bootstrapped sem claims em `unknown:P1`.
  - When: chamar `resolveResource(state, 'graph://claims?cell=unknown:P1')`.
  - Then: retorna `{cell:'unknown:P1', claims:[]}` — empty, não throw.

### 2.2 Use Cases
N/A — `readClaims`, `queryClaims`, `readHistory` são wrappers de `resourceRead`/`og.call`; validados ponta a ponta na Section 3.

### 2.3 External Integrations
N/A — a integração `og.call()` + `resourceRead` com `@open-graph-mcp/client` é validada transitivamente pelos fluxos e2e (qualquer regressão na costura SSE→snapshot→índice→render aparece nos dois specs).

---

## Section 3 — Functional Tests

> Dois specs e2e contra o harness real (`packages/mcp-web/e2e/fixture.ts`): server subprocess (Bun) + `vite preview` build real (QD4) + um BrowserContext Playwright por user simulado. Driver `e2e/driver.ts` (`readers(h, token)`, `webToken`, `webUserId`, `turns(h, token)` reuso UI-2) quando setup precisa bypassar a UI.

### 3.1 Happy Path Flows

- [ ] **Should complete the leitura→escrita cycle when a user queries, hits a gap, queries again, opens a claim, navigates a ref, and opens a turn**
  - Given: harness `startHarness()` rodando com fixture dois-domínios (`auth`, `billing`) e 3 claims já commitados via driver (`turns(h, tokenA).open('auth:P3', 'intent-x')` → claim → commit × 3); `openSession(browser, "alice")` autenticada e conectada (`#conn.on`).
  - When: alice pressiona `⌘K` (ou Meta+K em macOS test env); o `QueryBar` fica visível com input focado.
  - When: alice digita `xsqwnonexistent` e espera 250ms (debounce 200ms + margeim).
  - Then: o `QueryBar` renderiza `.query-gap` com texto `sem resultado: 'xsqwnonexistent'` e ao menos uma `.refinement-suggestion` visível; `MatchResult` rows ausentes.
  - When: alice limpa o input e digita substring de um subject já commitado (ex.: `login`); espera debounce.
  - Then: `QueryBar` renderiza `QueryResult` rows agrupadas por domínio (`auth` header); ao menos uma row com `nodeId`+`responsibility`.
  - When: alice clica numa match row.
  - Then: canvas centra no nó alvo (assert via `setCenter` RF state ou comparando viewport center); `QueryBar` fecha; `ClaimsBrowser` painel abre para a cell do match; `ClaimRow[]` listadas com `id`, `subject`, `author`, `ts`, `status`.
  - When: alice clica num `ClaimRow`.
  - Then: `OpenClaim` renderiza: `subject` em texto puro (não markdown); `anchor` verbatim; `verdict` metadados; seção "referenciado por" listando claimIds do `ReverseIndex` (vazio se nenhum); rodapé `Provenance` com `csId`+`seq`.
  - When: alice clica num `RefChip` cujo ref alvo existe no snapshot.
  - Then: canvas centra no nó alvo (setCenter RF); `OpenClaim` do claim alvo abre com `subject`+`anchor`+`refs`.
  - When: alice clica no botão "abrir turno nesta cell" no rodapé do `OpenClaim`.
  - Then: `TurnModal` (UI-2) abre na cell do claim lido; alice preenche intent e confirma; `DraftPanel` (UI-2) fica visível com `activeCs.csId` não-vazio — fechando o ciclo leitura→escrita sem sair do fluxo.

- [ ] **Should display a gap prominently when query returns no matches (gap visibility DoD)**
  - Given: harness rodando; `openSession` autenticada.
  - When: ⌘K + termo que não casa (`zzz`).
  - Then: `.query-gap` renderiza `sem resultado: 'zzz'`; `MatchResult` rows ausentes; `.refinement-suggestion` presentes (domínios próximos lexicon); gap aparece como resultado de 1ª classe — não como `MatchResult[]` vazio muda — texto explícito presente.

- [ ] **Should load history events filtered by user/target/kind and expand payload**
  - Given: harness rodando; setup via driver: alice abre turno `billing:P2` e commita 2 claims; bob abre turno `auth:P3` e aborta — gera eventos `changeset.opened`, `changeset.delta`, `changeset.committed`, `changeset.aborted`, `lock.acquired`, `lock.released`; `openSession(browser, "alice")` autenticada.
  - When: alice navega para `/history` (link direto ou botão).
  - Then: rota `HistoryView` monta; `resourceRead('graph://history?since=0&limit=1000')` dispara; `HistoryRow[]` renderizadas com `seq`, `ts`, `kind`, `target`; ao menos 6 rows (número de eventos setup).
  - When: alice seleciona filter `byUser=bob`.
  - Then: apenas rows cujo `payload.openedBy === 'bob'` (ou `target_id` relevante) permanecem visíveis; ao menos 2 rows (open+abort do bob).
  - When: alice limpa `byUser` e entra filter `target=auth:P3`.
  - Then: apenas rows cujo `target_id === 'auth:P3'` (ou `payload.cells` contiene) permanecem; bob's open+abort do auth:P3 visíveis; alice's billing:P2 rows ausentes.
  - When: alice limpa `target` e seleciona filter `kind=changeset.committed`.
  - Then: apenas rows `changeset.committed` visíveis (alice's commit); outras kinds ausentes.
  - When: alice clica numa row.
  - Then: payload expande como JSON colapsável mostrando `id`, `intent`, `cells` estruturados — não string escaped; clicar novamente collapse.

### 3.2 Alternative Flows

- [ ] **Should show toast 'ref não encontrado' when RefChip target claimId is dangling (snapshot defasado)**
  - Given: harness rodando; `openSession` autenticada; alice tem `OpenClaim` aberto para um claim cujo ref aponta para `c-X` (id não presente no snapshot local — simula snapshot pre-commit de outro user).
  - When: alice clica no `RefChip` cujo ref é `c-X`.
  - Then: `.toast` renderiza `ref não encontrado, snapshot refresh`; canvas não centra (ou centra com fallback no ClaimRecord atual); trigger de `resourceRead('graph://snapshot')` refetch dispara.

- [ ] **Should rebuild ReverseIndex on graph.rebuilt without requiring page reload**
  - Given: harness rodando; `openSession` A autenticada; alice tem `OpenClaim` aberto com "referenciado por" populado (3 entradas).
  - When: segundo `openSession` B commita um novo claim que referencia c1 (claim aberto por alice); o server emite `graph.rebuilt`; alice recebe SSE.
  - Then: snapshot de alice é refetchado; `ReverseIndex` é invalidado; ao reabrir o mesmo claim alice vê 4 entradas em "referenciado por" — sem page.reload.

- [ ] **Should handle empty snapshot state in ClaimsBrowser gracefully**
  - Given: harness rodando, mas server ainda não bootstrapped (snapshot vazio) ou cell selecionada sem claims.
  - When: alice clica numa cell sem claims (via SidebarTree).
  - Then: `ClaimsBrowser` mostra mensagem `nenhum claim nesta cell`; `OpenClaim` ausente; sem erro vermelho.

- [ ] **Should handle query server error without masking gaps**
  - Given: harness rodando; cenário forçado de `og.call('query')` rejeitar (ex.: server caiu no momento).
  - When: alice digita termo válido.
  - Then: `.toast` de erro renderiza; `QueryBar` mantém input digitado; `MatchResult` rows da última query bem-sucedida ainda visíveis (não apagadas); gap não mascarado como erro genérico.

### 3.3 Edge Cases

- [ ] **Should not fire query on empty input (Debounce)**
  - Given: `QueryBar` aberto.
  - When: alice foca input mas não digita nada (ou apaga tudo).
  - Then: nenhuma chamada `og.call('query', ...)` dispara (verificado via interceptação de requests ou contagem no store); `MatchResult` rows ausentes; gap ausente.

- [ ] **Should preserve filters when navigating away and back to /history**
  - Given: alice em `/history?user=bob&kind=changeset.opened`.
  - When: alice navega para `/claims` e volta para `/history`.
  - Then: URL preserva querystring; filtros `byUser=bob` e `kind=changeset.opened` reaplicados; rows correspondentes visíveis.

- [ ] **Should display 'nenhum referenciado' in OpenClaim when ReverseIndex has no entry for the claim**
  - Given: claim selecionado sem outros claims referenciando-o.
  - When: `OpenClaim` renderiza.
  - Then: seção "referenciado por" mostra `nenhum referenciado` (não spinner eterno, não bloco oculto).

- [ ] **Should keep GapResult visible when matches are also present for partial overlap**
  - Given: termo `auth` casa algumas claims mas não outras palavras chão do domínio ausente.
  - When: alice digita `auth`.
  - Then: `MatchResult` rows presentes E `GapResult`rendeeriza `sem resultado: 'auth'` se o server retorna gap separado; gaps nunca colapsados — sempre de 1ª classe (regra DoD gaps visíveis).

### 3.4 Contract Tests

- [ ] **resourceRead('graph://claims?cell=<domain:level>') returns the published ClaimsEnvelope format**
  - Given: harness rodando; resource existe (task 02 merged).
  - When: driver `readers(h, token).readClaims('auth:P3')` chamado fora-da-UI.
  - Then: contrato `{cell: string, claims: ClaimRecord[]}`; cada `ClaimRecord` tem `id`, `subject`, `refs[]`, `anchor` não-empty, `verdict?`, `level?`, `status?`, `seq?`.

- [ ] **og.call('query', {term}) returns {matches, gaps} (reuses existing graph-query.ts contract)**
  - Given: harness rodando.
  - When: driver `readers(h, token).query('login')` chamado.
  - Then: retorno é `{matches: MatchResult[], gaps: GapResult[]}`; `matches[].nodeId`, `.domain`, `.responsibility`, `.score`; `gaps[].term`, `.suggestions[]`.

### 3.5 Non-Functional Tests

- [ ] **ClaimsBrowser panel open-to-render should be under 200ms on a 50-claim cell (regression budget)**
  - Given: harness rodando; snapshot com cell populada por 50 claims (fixture).
  - When: alice clica na cell (SidebarTree).
  - Then: tempo entre click até first paint `ClaimRow[]` < 200ms (medido via `performance.mark`); `OpenClaim` abertura < 100ms após click (ReverseIndex já construído ou lazy-build sob budget).

- [ ] **ReverseIndex.build on a 1000-edge snapshot should complete under 50ms**
  - Given: snapshot fixture com 1000 edges.
  - When: chamar `buildReverseIndex(snapshot)`.
  - Then: duração < 50ms (lazy-build on first OpenClaim não induz jank perceptível).

- [ ] **QueryBar debounce 200ms should not send more than 1 query per typing burst**
  - Given: `QueryBar` aberto.
  - When: alice digita `aut` rapidamente (3 chars em 100ms) e espera 250ms.
  - Then: exatamente 1 chamada `og.call('query', {term:'aut'})` dispara (contagem no store ou intercept de RPC); não 3 chamadas por char.