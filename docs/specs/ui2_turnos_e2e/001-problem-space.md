# Strategic Design — Problem Space

**Domain:** ui2_turnos_e2e
**Project:** mcp-web
**Date:** 2026-07-19
**Scope source:** `docs/roadmap-web-ui/02-scope-ui-2-turnos.md` — UI-2 closure (e2e specs + DoD flip). Production code already merged at commit cfb24f5.

---

## Section 1 — Event Storming

Big Picture flow over the UI-2 closure scope. Events temporally ordered from the actor's first intent to the cross-browser observable outcome.

| # | Domain Event (past tense) | Command (trigger) | Aggregate | External Systems | Read Models |
|---|---|---|---|---|---|
| 1 | TurnIntentStated | `openTurn(uiCells, intent)` | Changeset (draft) | mcp-server (`changeset.open`) | `denied` projection, `activeCs` |
| 2 | LockDenied | server rejects `changeset.open` (`cell_locked`) | Lock | mcp-server | `Denied{cell, holder, csId, expiresAt}` |
| 3 | TurnOpened | `changeset.open` ok | Changeset | mcp-server | `activeCs`, ghost cell border, `myTurns` |
| 4 | RefPickingToggled | user clicks "add ref by click" | Draft Panel (UI) | — | `refPicking`, `refDraft` |
| 5 | RefPickedFromCanvas | user clicks a node in canvas | Draft Panel (UI) | snapshot graph | `refDraft[]` |
| 6 | ClaimDrafted | `claimDraft(form\|rawJson)` | Changeset Delta | mcp-server (`changeset.claim`), gate | `draftDeltas`, `graph://changeset/{id}` |
| 7 | GateFailed | server rejects claim (reasons) | Gate | mcp-server | `reasons[]` in panel; form text preserved |
| 8 | LockReleased | holder commits/aborts/TTL expires | Lock | mcp-server (`lock.released` SSE) | `locks` map drop, `denied.lockGone` |
| 9 | TurnCommitted | `commitTurn()` | Changeset | mcp-server (`changeset.commit`), graph rebuild | `activeCs=null`, `graph.rebuilt`, new node in snapshot |
| 10 | TurnAborted | `abortTurn()` or TTL | Changeset | mcp-server | ghosts cleared, `activeCs=null` |
| 11 | TtlExtended | `extendTurn()` | Changeset | mcp-server | `activeCs.expiresAt` updated |
| 12 | NodeVisibleInOtherBrowser | second `BrowserContext` receives `graph.rebuilt` + refetches snapshot | Snapshot projection | mcp-server SSE | `.og-card[newId]` in browser B |
| 13 | LiveRetrySucceeded | user clicks "tentar de novo" after `lockGone` | Changeset (draft) | mcp-server | new `activeCs`, no page reload |
| 14 | DodFlipped | editor toggles `[ ]→[x]` and header `proposto→concluído` | Roadmap doc | — | `02-scope-ui-2-turnos.md` |
| 15 | CiGreen | dev runs `tsc && bun test && build && e2e chromium` | CI gate | shell | terminal exit 0 |

---

## Section 2 — Subdomain Classification

| Subdomain | Type | Justification |
|---|---|---|
| Turn lifecycle e2e | Core | momento-verdade do produto UI-2: open→claim→commit ponta a ponta visível — diferencial |
| Lock contention e2e | Core | `lock.denied` é estado de primeira classe; re-try ao vivo sem F5 diferencia a UX |
| Gate-fail preservation | Core | reasons estruturadas + texto digitado preservado = confiança no draft |
| DoD bookkeeping | Supporting | flip mecânico no doc roadmap, não diferencial |
| CI validation | Supporting | gate de regressão padrão (WD1 — e2e blocking) |

---

## Section 3 — Ubiquitous Language Glossary

| Term | Definition | Notes |
|---|---|---|
| Turno | changeset aberto por um user numa cell; tem intent, TTL, deltas | sinônimo: changeset aberto |
| Cell | par `domínio:nível` (ex.: `auth:1`, `billing:1`); unidade de lock | dialeto de exibição `auth:P1`; server recebe `auth:1` |
| Lock | posse temporária de uma cell por um holder; tem `expiresAt` | projetado como borda âmbar na cell inteira |
| LockDenied | recusa de `changeset.open` por cell já lockada; carrega `holder`, `csId`, `expiresAt` | nunca como erro genérico — estado de 1ª classe |
| ClaimDraft | `claim.add` submetido no changeset ativo | form {subject, domain, level, refs, anchor} ou raw JSON |
| Gate | validação server-side do claim; emite `reasons[]` | formato `roundtrip <kind> @<id>: <detail>` |
| Ref por clique | modo UI onde clicar nó no canvas appenda id em `refDraft` | fatia antecipada da UI-3; highlight + esc cancela |
| DraftDeltas | deltas do turno ativo re-hidratados de `graph://changeset/{id}` | server é fonte (WD4) — estado local só é o form não-submetido |
| Ghosts | deltas não-commitados de OUTROS changesets, sub-cards tracejados por cell | cor por csId |
| MyTurns | widget que lista `changeset.list_mine` do user | base do reattach |
| Reattach | reconectou com turno aberto → draft panel volta sozinho | `onReattach` entrega changesets sobreviventes |
| LiveRetry | clicar "tentar de novo" após `lock.released` — sem refresh | gate: `denied.lockGone` true |
| BrowserContext | sessão Playwright isolada (localStorage próprio) | um por user simulado |
| DoD | Definition of Done da fase UI-2 | checkboxes no rodapé de `02-scope-ui-2-turnos.md` |

---

## Section 4 — Socratic Questions

**Business Invariants and Consistency**
1. O que impede o re-try ao vivo de abrir um turno concorrente entre dois browsers que recebem `lock.released` no mesmo tick — corre race de quem reabre primeiro?
2. O `gate-fail` preserva o texto do form; se o server cai entre o claim recusado e o re-submit, onde fica a verdade do rascunho?
3. O `refDraft` (refs por clique) é só estado local — se o user commita e o server rejeita uma ref inexistente, o draft volta intacto com as refs?

**Scalability and Performance**
4. O refetch debounced de `graph://changeset/{id}` a cada claim — com 3 claims consecutivos num changeset de dois browsers, quantas idas ao server ficam na janela de debounce?
5. O `lock.released` chega via SSE a ambos browsers; se o segundo browser perde o evento (gap de reconexão), como o `lockGone` se resolve sem F5?

**Security and Sensitive Data**
6. O `denied.holder` expõe o userId do dono do lock ao user negado — é informação de presença legítima ou vazamento跨-user?

**Concurrency and Failures**
7. Dois browsers disputam a mesma cell; o primeiro commita e o segundo estava no meio de um claim — o `lock.released` chega antes do submit do claim. O que o segundo browser vê: deny novo, abort do draft, ou re-try automático?
8. `commitTurn` dispara `graph.rebuilt`; o novo nó aparece no browser B só quando B re-fetcha o snapshot. Se B está offline no gap, o nó some ou chega na reconexão?

**Responsibility Boundaries Between Layers**
9. `openTurn` converte `auth:P2→auth:2` em og.ts; o e2e passa cells pela UI (clique no picker) ou pela API (`h.callTool`)? Misturar as duas quebra a validação do gate?
10. O `TurnModal` lee `denied` direto do zustand; o e2e checa o DOM ou o store? Usar DOM prova a projeção inteira; usar store pula a costura de eventos.

**Architecture Tip:** o e2e deve dirigir a UI pelo DOM (cliques, form, toasts) e validar estados via seletores estáveis (`#denied`, `.og-card[data-id]`, `.toast`), nunca ler o store zustand direto — isso prova a costura SSE→projetação→render.