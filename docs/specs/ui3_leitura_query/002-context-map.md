# Bounded Contexts and Context Map

**Domain:** ui3_leitura_query
**Project:** mcp-web (com boundary pontual em mcp-server)
**Date:** 2026-07-19

---

## Section 1 — Bounded Context Identification

| Bounded Context | Responsibility | Boundary (excluded) | Team Ownership | Key Entities |
|---|---|---|---|---|
| ClaimsSchemaGate | Verificar se `GraphNode.claims` é id-only ou trás corpo; decidir se server PR é necessário (task 01) | Não edita graph-core, não propõe schema novo | mcp-web spec | SchemaProbe, ClaimsIsIdOnly |
| ServerClaimsResource | (condicional) PR aditivo read-only `graph://claims?cell=` em mcp-server; responde ClaimRecord completo por cell | Não muta store/changeset; não edita resources de changeset/snapshot | mcp-server | ClaimsEndpoint, ClaimEnvelope |
| ClaimsBrowser | Painel por cell: lista claims com autor/timestamp/status; claim aberto com chips de refs navegáveis + "referenciado por" + proveniência | Não edita claim commitado (UI-2); sem react-markdown (UI-4) | mcp-web UI | ClaimRow, OpenClaim, RefChip, ReferencedByList, Provenance |
| QueryGaps | Barra ⌘K no topbar; `og.call('query', {term})`; resultados agrupados; gaps de 1ª classe com sugestão de refinamento; selecionar centra nó | Não faz full-text search server-side novo; ranking backlog | mcp-web UI | QueryBar, QueryResult, GapResult, RefinementSuggestion |
| ReverseReferenceIndex | Índice reverso `Map<claimId, claimId[]>` derivado do snapshot em memória; O(edges); invalidado por `graph.rebuilt` | Não persiste; não sobrevive a refresh; não indexa meta-ids | mcp-web client | ReverseIndex, InvalidationEvent |
| HistoryView | Rota `/history` com filtros byUser/target/kind; clique expande payload | Não edita events; auditoria é read-only | mcp-web UI | HistoryFilters, HistoryRow, PayloadExpand |
| SidebarTree | Árvore domínios→níveis com claimCount + lockBadge por cell; quick filters | Não renderiza cards (canvas RF faz); só navegação e contagem | mcp-web UI | DomainNode, LevelNode, LockBadge, QuickFilter |
| RoadmapBookkeeping | Flipar DoDs `[]→[x]` e header `proposto→concluído` no `03-scope-ui-3-leitura-query.md` | Não altera specs de outras fases | mcp-web docs | DoDChecklist, PhaseStatus |
| CiValidationGate | Rodar `tsc`, `bun test`, build, e2e chromium localmente | Não roda CI remote | mcp-web dev | TypeCheck, UnitSuite, BuildStep, E2eSuite |

---

## Section 2 — Context Map

```
[ClaimsBrowser] → [mcp-server (snapshot)]
Pattern   : Open Host Service + Published Language
Direction : downstream (UI) ← upstream (server)
Justification: consome `graph://snapshot` (GraphNode.claims[]) via resourceRead.
              Contrato published stable. UI é conformist ao schema existente.

[ClaimsBrowser] → [ServerClaimsResource]
Pattern   : Customer-Supplier (condicional)
Direction : downstream (UI) ← upstream (server, novo resource aditivo)
Justification: SE task 01 confirmar GraphNode.claims id-only, server supplier
                expõe `graph://claims?cell=` (ClaimRecord completo) — sem isso o
                browser não renderiza subject/anchor/verdict. Read-only, aditivo.

[ClaimsBrowser] → [ReverseReferenceIndex]
Pattern   : Shared Kernel (client-side)
Direction : bidirectional
Justification: ambos derivam do snapshot em memória; índice é otimização pura do
                browser. Invalidação sincronizada via `graph.rebuilt` SSE.

[QueryGaps] → [mcp-server (queryGraph)]
Pattern   : Open Host Service + Published Language
Direction : downstream (UI) ← upstream (server indexer)
Justification: `og.call('query', {term})` já existe (graph-query.ts); gaps já
                retornados. WD3: roteia por og.call, sem api.ts.

[QueryGaps] → [Snapshot (centra nó)]
Pattern   : Conformist
Direction : downstream ← upstream
Justification：selecionar match chama a projeção de câmera do canvas (reuso de
                setCenter do RF do UI-1).

[SidebarTree] → [Changeset (UI-2)]
Pattern   : Customer
Direction : downstream (sidebar) ← upstream (UI-2 changeset.list_mine)
Justification: quick filter "minhas contribuições" reusa list_mine; "com turno
                aberto" reusa o mapa de locks do UI-2.

[HistoryView] → [mcp-server (graph://history)]
Pattern   : Open Host Service + Published Language
Direction : downstream (UI) ← upstream (server)
Justification: paridade com a rota velha; consome resource já publicado.

[mcp-web production src] → [ClaimsBrowser, QueryGaps, HistoryView, SidebarTree]
Pattern   : Published Language
Direction : upstream (src) → downstream (e2e)
Justification: spec e2e valida UI real buildada via vite preview (QD4). Seletores
                estáveis (`.claim-chip`, `.query-gap`, `.history-row`,
                `.sidebar-tree-node`) são o contrato published entre src e e2e.

[RoadmapBookkeeping] → [QueryAndReadE2E, HistoryE2E]
Pattern   : Customer-Supplier
Direction : downstream (docs) ← upstream (specs)
Justification: DoD flip só depois dos specs verdes — specs são supplier, docs
                customer.

[CiValidationGate] → [Todos os acima]
Pattern   : Conformist
Direction : downstream (CI) ← upstream (artifacts)
Justification: CI aceita artefatos como estão; roda suíte completa (WD1).
```

---

## Section 3 — Core Domain Highlight

```
Context : ClaimsBrowser + QueryGaps + ReverseReferenceIndex + HistoryView +
          SidebarTree (concatenados: UI-3 leitura/query)
Reason  : fechar o gap central que motivou a reescrita — a UI escreve mas não lê.
          Sem leitura navegável, busca com gaps visíveis, history e sidebar de
          CÉLULAS, a co-criação é escrita cega. WD2: sem react-markdown aqui
          (isso é UI-4); claims são texto/chips/anchor verbatim. WD3: og.call +
          resourceRead, sem api.ts. WD4: server autoritativo, snapshot em memória.
Investment: specs detalhadas Given/When/Then (004), tasks granulares com gated
            task 01 (verificação de schema) → task 02 condicional (server PR),
            dois e2e (query-and-read, history) validando o ciclo leitura→escrita.
```

---

## Section 4 — Architectural Decisions

```
Decision    : Task 01 (schema gate) roda ANTES de qualquer outra task.
Context     : risk 1 do 03-scope explícito — GraphNode.claims pode ser id-only
              (confirmado em build.ts:34: `claims: string[]`). Se faltar corpo,
              task 02 abre PR aditivo read-only `graph://claims?cell=` no server.
              WD5: server não congelado, beta adiado.
Consequences:
  + verticaliza o risco cedo (gating real, não especulativo)
  + se task 01 confirmar id-only, task 02 desbloqueia o resto; se confirmar
    payload, task 02 fica NO-OP e pula dependência
  - adiciona dependência serial no início; aceito (risco é arch-known)
```

```
Decision    : ReverseReferenceIndex é client-side, derivado do snapshot, O(edges),
              invalidado por graph.rebuilt (rebuild total por snapshot).
Context     : "referenciado por" precisa ser visível sem varredura por claim
              aberto. Server não tem esse índice (não é responsabilidade dele;
              o snapshot já publicou as arestas). Client constrói uma vez.
Consequences:
  + custa O(edges) por snapshot; aceito p/ escala beta (dezenas-centenas de
    claims; milhares = backlog pós-retomada, ver decide na UI-0 spike)
  + invalidação simples: discard+rebuild no graph.rebuilt (sem patch incremental)
  - em snapshot muito grande, rebuild síncrono pode jank; mitigar com build
    differed on first open do claim (lazy), não eagerly no carregamento
```

```
Decision    : WD2 explicit — UI-3 NÃO introduz react-markdown.
Context     : claims são texto puro + chips de refs + anchor verbatim + metadados.
              Markdown rich (	headers, listas, code blocks) é UI-4. Misturar agora
              reabre BD6-equivalente (beta congelado) e quebra o gating por fase.
Consequences:
  + diff mínimo desta fase; UI-4 absorve o complexity de markdown rendering
  + selector e2e `.claim-body` estável sob texto puro
  -UX ainda não tem rich text — intencional, leitura é o foco, formatação depois
```

```
Decision    : WD3 — toda chamada por og.call() ou resourceRead; api.ts morre.
Context     : query, history, snapshot, claims (se novo resource) — todos roteiam
              pelo seam unificado. Sem reimplantar SSE/auth (UI-1 tratou).
Consequences:
  + costura única validada em e2e (qualquer break de api causes e2e red)
  - overhead de string tool name; aceito
```

```
Decision    : e2e conduz por DOM, nunca lê store zustand direto.
Context     : provar a costura SSE→snapshot→índice→render exige validar o que o
              USER vê. Store bypass quebra a prova.
Consequences:
  + pega regressão de seletores e projeção
  - seletores (`.claim-chip`, `.query-gap`, `.history-row`, `.sidebar-tree-node`,
    `.claim-provenance`) têm que existir estáveis no src — contrato published
```

```
Decision    : DoD flip só depois dos 2 e2e verdes (dependência serial).
Context     : roadmap WD1: "fase sem e2e é fase não entregue". Flipar antes reabre
              a porta de "marcar concluído sem prova".
Consequences:
  + gate auditável no git log
  - adiciona step; aceito
```