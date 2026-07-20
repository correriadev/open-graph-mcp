# Test Scenarios — mcp-web

**Domain:** ui2_turnos_e2e
**Project:** mcp-web
**Framework:** Playwright (`@playwright/test`) + bun test for unit suite; e2e harness in `packages/mcp-web/e2e/fixture.ts`
**Date:** 2026-07-19

> Scope: cenários derivados do `003-mcp-web-tactical-design.md`. São especificações (Given/When/Then), NÃO código executável. Phase B implementa os `.e2e.ts`. Ubiquitous Language do `001-problem-space.md` usada integralmente.

---

## Section 1 — Unit Tests

> N/A para esta fase. Os unit tests do mcp-web (PresenceStore, GhostStore, ToastQueue, `cells.ts` marshalling) já existem e fazem parte de UI-1/UI-2 produção (commit cfb24f5). Esta fase não adiciona lógica unit-testável nova — só spec e2e + bookkeeping + gate.

### 1.1 Aggregates and Aggregate Roots
N/A — sem production code novo.

### 1.2 Value Objects
N/A — `ActiveCs`, `Denied`, `ClaimForm`, `DraftDelta`, `MyTurn`, `OpenTurnResult` já validados em UI-2 produção.

### 1.3 Domain Services
N/A — `openTurn`, `claimDraft`, `commitTurn`, `abortTurn`, `extendTurn`, `listMine`, `reopenTurn`, `applyEvent` já cobertos pelos unit tests de produção.

### 1.4 Domain Events
N/A — `changeset.opened`, `lock.acquired`, `lock.released`, `changeset.delta`, `changeset.committed`, `changeset.aborted` são emissões do server, testados no `mcp-server` integration suite; aqui só consumidos via SSE.

---

## Section 2 — Integration Tests

> N/A pelo princípio do spec: o harness e2e já usa o server real (subprocess) + build real (`vite preview`) + dois BrowserContexts reais — não há "camada intermediária" a integrar isoladamente nesta fase. Toda a verificação de costura é funcional (Section 3).

### 2.1 Repositories
N/A.

### 2.2 Use Cases
N/A — `openTurn`/`claimDraft`/`commitTurn`/`abortTurn`/`extendTurn` são exercitados ponta a ponta nos cenários funcionais abaixo.

### 2.3 External Integrations
N/A — a integração `og.call()` com `@open-graph-mcp/client` é validada transitivamente pelos fluxos e2e (qualquer regressão na costura SSE→store→render aparece num dos dois specs).

---

## Section 3 — Functional Tests

> Dois specs e2e, contra o harness real (`packages/mcp-web/e2e/fixture.ts`): server subprocess (Bun) + `vite preview` build real (QD4) + um BrowserContext Playwright por user simulado (localStorage isolado → identidade própria). Driver `e2e/driver.ts` (`turns(h, token)`, `webToken`, `webUserId`) usado só quando o setup precisa bypassar a UI.

### 3.1 Happy Path Flows

- [ ] **Should complete a full turn lifecycle across two browsers when a user opens a turn, drafts three claims (one via ref-por-clique) and commits**
  - Given: harness `startHarness()` rodando com fixture dois-domínios (`auth`, `billing`); `openSession(browser, "alice")` autenticada e conectada (`#conn.on`); `openSession(browser, "bob")` observadora autenticada.
  - When: alice abre o `TurnModal`, preenche `intent`, adiciona uma row `{d:"auth", l:"P3"}`, clicando em "abrir turno".
  - Then: o `DraftPanel` fica visível em alice com `activeCs.csId` não-vazio; `CellOverlays` desenha borda âmbar na cell `auth:P3`; a widget `MyTurns` lista o novo changeset; nenhum `#denied` aparece.
  - When: alice preenche o `ClaimForm` com `{subject:"login refatorado", domain:"auth", level:"P3"}`, sem refs, e submete.
  - Then: o `gate` aceita; a timeline de `DraftDeltas` do panel mostra um item novo `{kind:"claim.add", summary:"login refatorado"}`; `.gate-reasons` vazia.
  - When: alice ativa o modo "adicionar ref por clique" (`refPicking=true`), o canvas entra em highlight de picking; alice clica num `.og-ghost-card` existente cujo `data-claim` é um claim-id do próprio changeset.
  - Then: o campo `refs` do `ClaimForm` recebe o claim-id clicado; `refDraft` no store contém esse id. **(Emenda RETRY #1: `.og-card[data-id=...]` não tem `data-id` em produção (base-card.tsx); a semântica real do ref-por-clique clica em `.og-ghost-card[data-claim=<id>]` de um delta do changeset aberto — refs de `claim.add` são claim-ids, não node-ids, pois `incrementalGate` é advisory em refs e `finalGate` rejeita dangling-ref fora do claim-set.)**
  - When: alice completa o segundo claim `{subject:"sessão persistida", domain:"auth", level:"P3", refs:[<claim-id clicado>]}` e submete; depois submete um terceiro claim qualquer válido. **Emenda RETRY #1 LOW: pós-`#addclaim` aceito, `clearRefDraft()` (turn.tsx:177) seta `refPicking:false` (store.ts:118) — `#refpick` perde a classe `on`. Estado asserido explicitamente (não condicional); segundo claim precisa re-arm `#refpick` antes do terceiro.**
  - Then: a timeline mostra 3 `DraftDeltas`; nenhum `gateFailed`; `.gate-reasons` permanece vazia nos três.
  - When: alice clica em "commit" no `DraftPanel`.
  - Then: `activeCs` em alice vai para `null`; `CellOverlays` remove a borda âmbar; `MyTurns` lista o changeset como `committed`.
  - When: o server emite `graph.rebuilt` e alice faz `loadSnapshot` (automático via `applyEvent`).
  - Then: bob, sem reload, recebe o evento `graph.rebuilt` via SSE; um `.toast` com texto `"<opener> commitou <csId> em [<cell>]"` aparece no canvas de bob dentro de timeout determinístico (sem `page.reload()`); `#seq` de bob incrementa **numericamente** (`>= bobSeqBefore + 1` após parse-int do texto `seq <N>`); a contagem de `.og-ghost-card` em bob, não-nula ANTES do commit (cs aberto produz ghosts), cai DEPOIS do commit (cs fecha → `ghostStore.apply` remove-as). **(Emenda RETRY #1: o spec aspirava `.og-card[data-id=<idNovo>]` aparecendo + contagem de `.og-card` crescendo. Em produção, commit só estende `n.claims` dos nós cujo id está em `d.payload.refs` (changeset.ts:171) — e refs válidos são claim-ids (gate), NÃO node-ids, então NENHUM `n.claims` é estendido. Cross-browser visível mensurável pós-commit é a soma: (a) toast broadcast via SSE, (b) #seq incremento numérico >= before+1, (c) `.og-ghost-card` count em bob caindo (cs fechou).)**

- [ ] **Should resolve lock contention live when the holder releases the cell and the denied browser retries without reloading**
  - Given: harness rodando; alice (`openSession`) e bob (`openSession`) autenticadas; alice ainda não abriu turno; bob também não; cell alvo = `auth:P3` (primeira cell de auth do fixture convertida para `auth:1` em og.ts pelo picker ou `h.firstCell`).
  - When: alice abre `TurnModal`, preenche `intent="lock contention test"`, seleciona cell `auth:P3` e clica "abrir turno".
  - Then: alice adquire o lock; `CellOverlays` desenha borda âmbar em `auth:P3` no canvas de alice; `MyTurns` de alice atualiza.
  - When: bob abre `TurnModal`, preenche `intent="contender"`, seleciona a MESMA cell `auth:P3` e clica "abrir turno".
  - Then: o server responde `{ok:false, reason:"cell_locked"}`; `og.openTurn` seta `denied` no store de bob; o `TurnModal` renderiza `#denied` (não um toast de erro genérico) contendo: nome de exibição de alice (via roster), o `csId` dela e um countdown `mm:ss` não-vazio derivado de `denied.expiresAt`.
  - When: alice aborta (ou commita) o turno.
  - Then: o server emite `lock.released` com `{cell:"auth:3", holder:<aliceUserId>, csId:<id>}`; ambos browsers recebem via SSE; em bob, o `locks` map remove `auth:P3` e `denied.lockGone` torna-se verdadeiro; o botão "tentar de novo" no `#denied` fica habilitado.
  - When: bob clica em "tentar de novo".
  - Then: NENHUM `page.reload()` ocorre em bob (assert: `page.evaluate(() => performance.getEntriesByType("navigation").length) === 1` antes e depois); `og.openTurn` re-tenta com a cell `auth:P3`; o server aceita; `denied` volta pra `null`; `DraftPanel` abre pra bob com `activeCs.csId` novo; `CellOverlays` desenha borda âmbar em `auth:P3` no canvas de bob.
  - Then: a contagem de requests `/events` em bob NÃO aumenta como efeito do retry (o retry roda sobre a SSE já aberta — diferencial: live-retry, sem reconexão).

### 3.2 Alternative and Error Flows

- [ ] **(b) Should render gate failures as a structured reason list and preserve the typed claim text when a claim is rejected at claim-time (out-of-scope domain)**
  - Given: harness rodando; alice (`openSession`) com um turno ativo em `auth:P3` com pelo menos 0 claims; `ClaimForm` aberto no `DraftPanel`.
  - When: alice preenche `subject="ref fantasma"`, `domain="billing"` (≠ da cell locked `auth`), `level="P3"` e tipa `refs="node-inexistente-xyz"`.
  - Then: o server rejeita o claim em `incrementalGate` por `claim out of turn scope: <domain>:<level> not locked by this changeset`; `claimDraft` retorna `{ok:false, reasons:[...]}`. O `<cell>` ofensora (`billing:3`) é nomeada no reason.
  - When: o `DraftPanel` projeta a recusa (DOM real: ul `#dreasons` com `<li class="reason">` — `.gate-reasons` do spec é aspiracional, emendado p/ `#dreasons li.reason`).
  - Then: `#dreasons li.reason` não-vazio; o texto casa `/claim out of turn scope:.*not locked by this changeset/` E contém o `<cell>` rejeitado (`billing:3`).
  - When: alice relê os campos do `ClaimForm` depois da recusa.
  - Then: o `subject` continua `"ref fantasma"`; o `domain` continua `billing`; o `level` continua P3; o campo refs ainda contém `"node-inexistente-xyz"`; o `activeCs` continua o mesmo (turno NÃO foi abortado pela recusa de claim).
  - When: alice corrige `#f_domain` para `auth` e limpa `#f_refs` (vira claim-raiz aceitável), re-submete. **(Recovery path — emenda RETRY #1 MEDIUM.)**
  - Then: `#dlist` cresce `+1`; `#dreasons` volta a ficar vazia; `activeCs.csId` permanece o mesmo.

- [ ] **(a) Should reject committal with a dangling ref and name the offending id in the reason (finalGate, server-level)**
  - Given: harness rodando; alice com turno ativo em `auth:P3`; `ClaimForm` aberto.
  - When: alice submete um claim `{id:"claim-fantasma", subject:"com ref fantasma", domain:"auth", level:"P3", refs:["node-fantasma-xyz"]}`. **(Emenda RETRY #1: `incrementalGate` (gates.ts:48-75) é ADVISORY em refs — refs ausentes viram `warnings`, não `reasons`. O cenário LITERAL do spec original (“claim rejeitado com ref inexistente”) é infeasível em `incrementalGate` — só `finalGate` em commit rejeita dangling-ref. Decomposição em (a) commit-reject server-side + (b) claim-reject UI form-preservation.)**
  - Then: o `incrementalGate` ACEITA o claim com warning (refs viram advisory); `#dlist` cresce 1.
  - When: alice commita (via bypass-API `driver.turns(h, token).commit(csId)` — bypass necessário pois UI pós-commit-reject desmonta `#draft` via `cs=null`, então reasons não renderizam em DOM).
  - Then: o `commitResult` tem `{ok:false, reasons:[/roundtrip dangling-ref @<claimId>: ref <refId> not found in claim set/]}`; o id rejeitado (`node-fantasma-xyz`) aparece em pelo menos um reason; SSE `changeset.aborted` chega → `#draft` some em alice.

- [ ] **Should show the second browser's open attempt as a first-class denial state, not a generic error**
  - Given: harness rodando; alice com lock ativo em `auth:P3`; bob tentando abrir a mesma cell (Scenario 3.1 prefix).
  - When: bob clica "abrir turno" numa cell já lockada por alice.
  - Then: NENHUM `.toast` de erro genérico aparece em bob; o `#denied` fica visível; o botão "tentar de novo" fica desabilitado enquanto `denied.lockGone === false`; os dados de holder/csId/expires são legíveis no DOM.

- [ ] **Should broadcast a TTL-abort toast when the active turn's changeset expires (cs=null → panel unmounts)**
  - Given: harness rodando com `startHarness({ ttlMs: 50, sweepIntervalMs: 100 })`; alice com turno ativo em `auth:P3` e texto digitado em `#f_subject` (não-submetido).
  - When: o TTL do changeset expira (50ms wall clock) e `h.control("sweep")` dispara o sweeper (`sweepTtl` em sweeper.ts).
  - Then: o server emite `changeset.aborted` com `reason:"ttl_expired"`; `maybeToast` (og.ts:111) dispara um `.toast` com texto `"<csId> abortado por TTL"` em alice. `#draft` some em alice (`activeCs=null` via og.ts:250 → turn.tsx:147 `if (!cs) return null`).
  - **(Emenda RETRY #1: spec original exigia `ClaimForm` (subject/refs digitados) preservado pós-TTL. Em produção, `cs=null` desmonta o `DraftPanel` e o `useState` local é descartado — branch “N/A se o produto decide descartar” do próprio spec é a que vigora. Cobertura de preservação de form fica unit-level em `GhostStore.test.ts`/`PresenceStore.test.ts` (UI-1 produção); e2e assserta só o broadcast + desmonte. Backlog: reabrir turno re-hidrata form do `localStorage` se behavior desejado.)**

### 3.3 Security Scenarios

- [ ] **Should not leak raw userId of the lock holder beyond what roster already exposes**
  - Given: alice com lock ativo em `auth:P3`; bob negado. O raw userId de alice (`u_<sha256-16-hex>` de session.ts:14) é lido via `webUserId(alice.page)` (localStorage `og.userId` settado pelo token-store no register).
  - When: bob lê o conteúdo do `#denied`.
  - Then: o `#denied` mostra o NOME de exibição de alice (`roster.find(u => u.userId === denied.holder).name`), não o userId cru — a menos que alice não esteja no roster (caso raro: holder antigo desconectado), em que o userId aparece como fallback (resposta Socratic Q6 do `001-problem-space.md`).
  - Then (asserção NEGATIVA — emenda RETRY #1 HIGH): `await expect(bob.page.locator("#denied")).not.toContainText(aliceUserId)` — o hash `u_<hex16>` NÃO aparece no `#denied`. Substring “alice” (name) nunca colide com o hash. Regressão real de leak (e.g. `${denied.holder}` impresso cru) seria pega só pela negativa.
  - *(decisão: o fallback é aceitavel — presença pública do lock justifica o identificador; não é PII novo)*

- [ ] **Should reject claim submissions with malformed raw JSON and preserve the previous valid form**
  - Given: alice com turno ativo; `ClaimForm` aberto; form estruturado `#f_id`/`#f_subject`/`#f_domain`/`#f_level` válido pré-malformed.
  - When: alice expande o "raw JSON colapsável" (`details:has(#f_json) summary`) e digita JSON inválido `{subject: "broken"` (sem aspas na chave + string não fechada) no `#f_json`, e clica `#addclaim`.
  - Then: `claimDraft` (turn.tsx:153-159) captura o `JSON.parse` throw em try/catch → `setReasons(["raw JSON inválido"])`; NENHUM request `changeset.claim` é enviado no wire (verificado via `page.on("request")` counting de POSTs `/mcp` com body contendo `"changeset.claim"` — delta == 0); `#dreasons li.reason` contém texto `raw JSON inválido`; o form estruturado `#f_subject`/`#f_domain` (ainda válido) NÃO é limpo.

### 3.4 Roadmap Bookkeeping Scenario

- [ ] **Should mark UI-2 as concluded only after both e2e specs pass and CI is green**
  - Given: `docs/roadmap-web-ui/02-scope-ui-2-turnos.md` com `Status: proposto` e cinco checkboxes `[ ]` não-marcados; specs `turn-lifecycle.e2e.ts` e `lock-contention.e2e.ts` verdes; gate local (tsc, bun test, build, e2e chromium) verde.
  - When: o operador (Phase B final) edita o topo do arquivo.
  - Then: a linha 3 muda de `Status: **proposto**` para `Status: **concluído**`; os cinco itens `[ ]` viram `[x]` — convenção do repo (UI-0/UI-1 usam `[x]`, verificado em `00-scope-ui-0-spike-fundacao.md`/`01-scope-ui-1-vivacidade.md` — `[-x]` no spec original era aspiracional). Nenhuma outra seção é modificada; `git diff` é puramente o status + os 5 flips.
  - Then: o índice pai `docs/roadmap-web-ui/README.md` permanece inalterado nesta fase (sua coluna Status só muda quando da auditoria do roadmap, fora deste escopo).

### 3.5 CI Validation Scenario

- [ ] **Should pass the four-step local gate (tsc, bun test, build, e2e chromium) before flipping DoD**
  - Given: working tree em `packages/mcp-web/` com os dois specs novos + DoD flip já no arquivo.
  - When: rodar `bunx tsc --noEmit` (ou o script `typecheck` do `package.json` se existir).
  - Then: exit code 0; nenhum erro de tipo em `src/` ou `e2e/`.
  - When: rodar `bun test` (suíte unit do mcp-web).
  - Then: exit code 0; PresenceStore/GhostStore/ToastQueue/cells marshall specs passam.
  - When: rodar `bunx vite build` (ou script `build`).
  - Then: `dist/` gerado; nenhum erro de build; o `ensureBuilt()` do harness usará esse dist (QD4).
  - When: rodar `bunx playwright test --project=chromium` (ou script `e2e`/`test:e2e`).
  - Then: exit code 0; todos os specs em `e2e/*.e2e.ts` passam — incluindo `turn-lifecycle.e2e.ts` e `lock-contention.e2e.ts` novos; nenhum flake em `presence-bar`/`reconnect`/`snapshot-render` herdados.
  - Then: somente DEPOIS dos quatro passos verdes, o DoD flip do Scenario 3.4 é considerado efetivo (gate serial: 003 task 07 depende de task 06; task 08 depende de 07; mas o flip do DOC deve refletir CI verde já observado — pronto post-mortem do gate).