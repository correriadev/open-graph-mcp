# Roadmap-qa — índice

> Plano de qualidade/testes do serviço MCP, irmão do `roadmap-mcp/`
> (produto). Baseline: `main @ 3395839` (pós-merge Fase 3): 86 testes
> verdes + load script — mas **zero browser, zero CI, zero graph-core
> direto**. Este roadmap fecha esses buracos em fases.

## Documentos

| # | Arquivo | Função | Status |
|---|---|---|---|
| 0 | `00-scope-qa-0-ci.md` | CI GitHub Actions: gate de push/PR. **Primeiro.** | parcial — workflow+load+badge implementados (`164f2f0`, `bc494de`); falta branch protection + PR de quebra proposital |
| 1 | `01-scope-qa-1-smoke.md` | Smoke browser manual-assistido da Fase 3 (roteiro versionado). | implementado — executado 2026-07-17, 9/12 ✅, 1 bug real fixado |
| 2 | `02-scope-qa-2-e2e.md` | e2e Playwright: UI web inteira, fecha §10.7/§10.9-web da Fase 3. | quase implementado — harness + 5 specs + job CI (6/8 DoD); falta rodar de verdade no GitHub |
| 3 | `03-scope-qa-3-multi-client.md` | Web + não-web sobre o mesmo evento (contrato §8). | proposto |
| 4 | `04-scope-qa-4-graph-core.md` | Rede de segurança mínima + regra "tocou → testa". | regra contínua |
| 5 | `05-scope-qa-5-perf-soak.md` | Soak 10 min + broadcast storm + perf-log. **Gate da Fase 4.** | proposto |
| 6 | `06-scope-qa-6-security.md` | Inventário de testes de segurança + processo por release. | proposto |

## Fotografia atual (o que JÁ existe)

| Superfície | Cobertura |
|---|---|
| mcp-server (tools, gates, SQLite, SSE, presença, affinity, typing) | **Boa** — 29 arquivos de integração real (HTTP+SQLite+SSE, sem mocks) |
| mcp-web lógica pura (envelope, eventstream, presence-state, toasts, ghosts) | **Boa** — 5 arquivos unit |
| mcp-web DOM/UI (main.ts ~17K, render.ts ~13K) | 5 arquivos Playwright (presence bar, avatar overlay, typing, toasts, settings/invisible, reconnect) — ainda não confirmados rodando no CI real |
| graph-core (~50 módulos vendorados) | **ZERO direto** — só via integração do server |
| Performance | 1 burst (`presence-load.ts`: 50 sessões, p100=54ms) |
| CI | `.github/workflows/ci.yml` roda `test`/`client-node`/`load` em push+PR; falta branch protection em `main` |
| Segurança | Regressões pinadas, mas espalhadas/anônimas |

## Decisões tomadas (QD)

- **QD1** Load test nunca bloqueia CI — latência em runner compartilhado
  flakeia; número de referência é o da máquina do dev (perf-log, QA-5).
- **QD2** Flake de timing → aumentar janelas configuráveis dos testes;
  NUNCA retry automático silencioso.
- **QD3** Playwright é a ÚNICA dependência de teste nova do roadmap
  inteiro; confinada ao mcp-web. bun test cobre todo o resto.
- **QD4** e2e roda contra `vite preview` (build real), não dev server.
- **QD5** e2e usa os mesmos knobs determinísticos dos testes de
  integração (debounceMs, typingMs, presenceTtlMs, `sweepPresenceNow`,
  `tickTypingNow`) — nunca sleep calibrado no relógio de produção.

## Sequência de execução

```
QA-0 (CI) ──┬──► QA-2 (e2e web) ──► QA-3 (multi-cliente)
QA-1 (smoke)┘                              │
                                           ▼
QA-4 (graph-core: regra contínua, vale desde já)
                                           │
                                           ▼
                            QA-5 (soak) ══ GATE da Fase 4 (roadmap-mcp)
                                           │
QA-6 (sec suite) — qualquer hora; obrigatório antes da Fase 4
```

QA-0 e QA-1 em paralelo, imediatos. QA-2 só com QA-0 verde (e2e sem CI é
teatro). QA-5 e QA-6 são pré-requisitos declarados da Fase 4 do
roadmap-mcp (lock otimista + rebase + authz multiplicam superfície de
escrita e de permissão — sem soak e sem suíte de segurança nomeada, não
começa).

## Esforço estimado (1 dev, ~50% dedicação)

- QA-0: 0.5 dia
- QA-1: 0.5 dia (1 sessão)
- QA-2: 1-2 semanas
- QA-3: 3-5 dias
- QA-4: 1-2 dias one-shot + disciplina contínua
- QA-5: 2-3 dias
- QA-6: 1 dia setup + ~0.5 dia por release
- **Total até "Fase 3 done-done + gates da Fase 4 prontos: ~3-4 semanas**

## Débitos conhecidos (registrar, não esconder)

1. `tsc --noEmit` no mcp-server tem baseline sujo pré-existente
   (bun-types/ffi, web-tree-sitter, fixtures) — QA-0 só gate-ia o mcp-web;
   limpar baseline é tarefa própria, sem dono ainda.
2. Testes com timing (debounce 250ms, typing ticks) têm margem, não
   imunidade — QD2 é a resposta.
3. `presence.who` N+1 (`ponytail:` comment) — vira item real SE QA-5
   mostrar degradação.
4. Cliente opencode REAL nunca integrado ponta-a-ponta — QA-3 simula o
   protocolo; validação com produto real é checkpoint de adoção
   (roadmap-mcp), não CI.

## Anti-escopo (deliberado, vale p/ o roadmap inteiro)

- ❌ Cobertura % como métrica/gate — direciona teste inútil.
- ❌ Sprint retroativo de unit tests no graph-core.
- ❌ Mutation testing, fuzzing — custo alto, fase errada do produto.
- ❌ Framework de teste além de Playwright — bun test cobre o resto.
- ❌ Visual regression, multi-browser, mobile — cliente interno v1.

## Princípio herdado

Teste que não roda em todo push não existe. Por isso QA-0 vem antes de
tudo — inclusive antes de escrever mais testes.
