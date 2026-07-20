# Bounded Contexts and Context Map

**Domain:** ui2_turnos_e2e
**Project:** mcp-web
**Date:** 2026-07-19

---

## Section 1 — Bounded Context Identification

| Bounded Context | Responsibility | Boundary (excluded) | Team Ownership | Key Entities |
|---|---|---|---|---|
| TurnLifecycleE2E | Verificar ponta a ponta: open → 3 claims (um via ref-por-clique) → commit → nó visto no browser B | Não testa autority.flip, não edita claim commitado, não testa browser completo de claims (UI-3) | mcp-web e2e | Harness, BrowserSession, TurnFlow, ClaimFlow |
| LockContentionE2E | Verificar contenção: dois browsers disputam a mesma cell — deny legível, release via `lock.released`, live-retry sem F5, gate-fail preserva texto | Não testa TTL expirar sozinho (outro spec), não testa commit do holder (TurnLifecycle cobre) | mcp-web e2e | DenialState, LockEvent, LiveRetry, GateFailure |
| RoadmapBookkeeping | Flipar DoDs `[]→[x]` e header `proposto→concluído` no doc da fase após specs verdes | Não altera specs de outras fases, não renomeia o escopo | mcp-web docs | DoDChecklist, PhaseStatus |
| CiValidationGate | Rodar `tsc`, `bun test`, build, e2e chromium localmente e confirmar verde | Não roda CI remoto (GH Actions), não publica artefatos | mcp-web dev | TypeCheck, UnitSuite, BuildStep, E2eSuite |

---

## Section 2 — Context Map

```
[TurnLifecycleE2E] → [mcp-server (subprocess)]
Pattern   : Open Host Service + Published Language
Direction : downstream (e2e) ← upstream (server)
Justification: e2e consome tools/resources/SSE do server via contrato RPC+JSON estável; nenhum modelo vaza. e2e é conformist ao contrato published (JSON-RPC).

[LockContentionE2E] → [mcp-server (subprocess)]
Pattern   : Open Host Service + Published Language
Direction : downstream (e2e) ← upstream (server)
Justification: mesmo contrato; consome `lock.released`/`lock.acquired` SSE e `changeset.open` deny payload.

[TurnLifecycleE2E] → [LockContentionE2E]
Pattern   : Shared Kernel
Direction : bidirectional
Justification: ambos dependem do mesmo `fixture.ts` (harness), `driver.ts` (turns API), `openSession(browser, name)`. Mudar o harness quebra ambos — kernel compartilhado.

[RoadmapBookkeeping] → [TurnLifecycleE2E, LockContentionE2E]
Pattern   : Customer-Supplier
Direction : downstream (docs) ← upstream (specs)
Justification: o flip dos DoDs SÓ acontece depois que os specs estão verdes — specs são supplier, docs é customer que consome o sinal "verde".

[CiValidationGate] → [TurnLifecycleE2E, LockContentionE2E, RoadmapBookkeeping]
Pattern   : Conformist
Direction : downstream (CI) ← upstream (artifacts)
Justification: CI aceita os artefatos como estão; roda a suíte completa como gate de regressão (WD1 — e2e blocking).

[mcp-web src (production)] → [TurnLifecycleE2E, LockContentionE2E]
Pattern   : Published Language
Direction : upstream (src) → downstream (e2e)
Justification: e2e valida a UI real buildada em dist/ via `vite preview` (QD4). Selectors DOM (#denied, .og-card, .toast) são o contrato published entre src e e2e.
```

---

## Section 3 — Core Domain Highlight

```
Context : TurnLifecycleE2E + LockContentionE2E (concatenados: UI-2 e2e specs)
Reason  : são a prova observável do momento-verdade do produto UI-2 — um turno
          ponta a ponta refletido num segundo browser, e a contenção de lock
          resolvida ao vivo sem refresh. Sem esses dois specs verdes, UI-2 não
          está entregue (roadmap WD1: "e2e é onde regressão aparece; fase sem
          e2e é fase não entregue").
Investment: spec detalhado em Given/When/Then (004), tasks granulares por
            cenário (003 §6), dois BrowserContexts reais por spec para validar
            multiplayer, drivers via DOM (prova a costura SSE→render).
```

---

## Section 4 — Architectural Decisions

```
Decision    : E2E dirige a UI pelo DOM, nunca lê o store zustand direto.
Context     : provar a costura SSE → og.applyEvent → projectGhosts → render
              exige validar o que o USER vê, não o estado interno. Ler o store
              pula a costura e pode passar verde com UI quebrada.
Consequences:
  + specs pegam regressão de render e seletores quebrados
  + imune a refactor interno do store
  - seletores (`#denied`, `.og-card[data-id]`, `.gate-reasons li`) têm que
    existir estáveis no src — contrato published entre src e e2e
```

```
Decision    : LockContention usa dois BrowserContexts reais (openSession × 2),
              não mock de SSE.
Context     : a UX de live-retry sem F5 só se prova com server real emitindo
              `lock.released` pro segundo context. Mock quebraria o sinal-verdade
              (gap de reconexão, ordering de eventos).
Consequences:
  + valida ordering real de SSE entrecontexts
  + cobertura natural de TTL/extend via control knobs deterministicos
  - mais lento que mock; aceito (test.slow() onde preciso)
```

```
Decision    : DoD flip só depois dos dois specs verdes (dependência serial).
Context     : roadmap WD1 explicita "fase sem e2e é fase não entregue". Flipar
              DoD antes reabriria a porta de "marcar concluído sem prova".
Consequences:
  + gate auditável no git log: spec commit → DoD commit
  + se e2e quebra em CI, DoD não flippa — status permanece "proposto"
  - adiciona um step explícito no fluxo; aceito
```

```
Decision    : CI validation é local e 4-passos (tsc, bun test, build, e2e
              chromium); não roda GH Actions remoto.
Context     : o usuário/orchestrador pediu "CI verde local" como DoD final.
              Rodar remote exigiria push/PR fora de escopo da spec.
Consequences:
  + proves o gate antes de commit/push
  + não substitui CI remote — esse continua rodando no push
  - se e2e local passa e remote falhar por flake, fase marcada concluída
    prematuramente; mitigado: rodar e2e chromium headless 2x antes de flippar
```

```
Decision    : Tasks não escrevem código de produção nem os .ts e2e. Só spec
              + docs + validação.
Context     : produção já existe (cfb24f5); os .ts e2e são Phase B do
              orchestrator. Esta fase só especifica.
Consequences:
  + sem sobreposição com Phase B
  + tasks 01-06 são "especificar e validar execução" — descrição clara
  - pode parecer redundante; é intencional: spec é o contrato que Phase B
    seguirá
```