# Roadmap QA — plano completo de testes

> Status: **plano p/ execução**. Baseline: `main @ 3395839` (pós-merge Fase 3).
> Irmão de `roadmap-mcp/` (produto); este documento cobre só qualidade/testes.

---

## 0. Fotografia atual (o que JÁ existe)

| Superfície | Cobertura | Evidência |
|---|---|---|
| mcp-server (tools, gates, SQLite, SSE, presença, affinity, typing) | **Boa** — 29 arquivos de teste de integração real (HTTP+SQLite+SSE, sem mocks) | `packages/mcp-server/test/*.test.ts` |
| mcp-web lógica pura (envelope, eventstream, presence-state, toasts, ghosts) | **Boa** — 5 arquivos unit | `packages/mcp-web/test/*.test.ts` |
| mcp-web DOM/UI (main.ts ~17K, render.ts ~13K) | **ZERO** — nunca renderizado em browser por teste | — |
| graph-core (~50 módulos vendorados: extract, resolve, watch, authority…) | **ZERO teste direto** — só exercitado indiretamente via mcp-server | — |
| Performance | Load script real (50 sessões, p100=54ms) | `test/load/presence-load.ts` |
| CI | **NÃO EXISTE** — tudo roda só na máquina do dev | sem `.github/workflows` |
| Segurança | Regressões pinadas em testes (tenant-isolation, presence-ownership, lock-denied-private) | idem |

Total: 86 testes verdes + load script. **Os dois buracos reais: UI web em browser e ausência de CI.** graph-core é o terceiro, mitigado por ser read-mostly e coberto por integração.

---

## QA-0 — CI (fazer PRIMEIRO; meio dia)

Sem CI, todo o resto é teatro: teste que não roda em todo push regride em silêncio.

- [ ] `.github/workflows/ci.yml`: em push/PR →
  1. `bun install --frozen-lockfile`
  2. `bun test` (raiz — server + web)
  3. `bunx tsc --noEmit` em `packages/mcp-web` (server tem baseline sujo pré-existente — ver Débitos §6)
  4. `bun run build` em `packages/mcp-web` (vite)
- [ ] Load test como job separado **não-bloqueante** (`continue-on-error`), só em PR p/ main — latência em runner compartilhado flakeia; número é informativo, não gate.
- [ ] Badge no README.

**DoD:** PR com teste quebrado não mergeia.

## QA-1 — Smoke browser manual-assistido (imediato; 1 sessão)

Valida AGORA o que a Fase 3 entregou sem esperar QA-2. Browser real (claude-in-chrome ou manual), roteiro escrito:

- [ ] Roteiro `docs/roadmap-qa/smoke-checklist.md`: server up + `dev:web`, 2 abas →
  presence bar mostra 2 conectados; dots verdes; focus em cell → avatar na outra aba;
  abrir turno → badge de lock; claims → indicador "digitando"; commit → toast na aba observadora;
  click no toast → jump; invisible mode → some da barra; matar server → toast de restart; reconectar → foco redeclarado.
- [ ] Executar 1x, registrar resultado (data/commit) no próprio checklist.

**DoD:** checklist executado e commitado com resultado. Bugs achados viram issues antes de QA-2.

## QA-2 — E2E web automatizado (1-2 semanas)

O buraco §10.7 do scope da Fase 3 (`toast-notifications.test.ts` e2e) + o resto da UI.

- [ ] **Decisão de ferramenta: Playwright** (única dependência de teste nova do roadmap inteiro; roda headless em CI; alternativa "sem dependência" não existe p/ DOM real).
- [ ] Harness: fixture que sobe `startServer({stateDir: tmp})` + vite preview, N páginas = N sessões.
- [ ] Testes (1 arquivo por peça de UI, espelhando §7 do scope):
  - `presence-bar.e2e.ts` — contagem, dots (usar `lastSeen` do server p/ forçar amarelo/cinza), expand/collapse.
  - `avatar-overlay.e2e.ts` — badge em cell locked, semi-transparente em focus, tooltip hover.
  - `typing-indicator.e2e.ts` — aparece em claims, some em quiet (inclusive via invisible).
  - `toast-notifications.e2e.ts` — **§10.7 literal**: S1 commita, S2 vê toast, click → canvas jump; coalescência (burst → "N eventos"); cap 5 + (+N).
  - `settings-invisible.e2e.ts` — checkbox → some da barra da outra aba; sessionStorage por aba.
  - `reconnect.e2e.ts` — derruba server, sobe, toast de restart + foco redeclarado (§9.1 ponta-a-ponta).
- [ ] Job CI separado (`e2e`), bloqueante em PR p/ main.

**DoD:** os 9 testes de aceite do scope §10 todos automatizados (7 já existem server-side; 10.7 e 10.9-web entram aqui).

## QA-3 — Integração multi-cliente (3-5 dias)

Web + não-web interoperando sobre o mesmo evento — hoje testado só isoladamente.

- [ ] `cross-client.test.ts` (bun test, server-side): sessão `agentKind:"web"` + sessão `agentKind:"opencode"` observam a mesma cell; um commit → web recebe envelope cru (sem system.message), opencode recebe envelope + `system.message` com texto pt-BR correto.
- [ ] Cliente MCP real: script que fala o protocolo como um agente falaria (`presence.who` → tabela, history replay) — valida o contrato §8.2 de fora.
- [ ] Cenário "opencode perde turno por TTL enquanto web observa" — os dois lados notificados nas formas certas.

## QA-4 — graph-core: rede de segurança mínima (contínuo, oportunista)

0 testes diretos em ~50 módulos. NÃO vamos testar tudo (vendorado, estável, coberto por integração). Regra:

- [ ] Testar direto SÓ os módulos no caminho de mutação do server: `authority.ts` (canFlip), o que `gates.ts` importa, `merge-driver.ts` se Fase 4 (rebase) chegar.
- [ ] **Regra permanente: tocou num módulo do graph-core → deixa teste unit atrás.** Sem sprint de cobertura retroativa (baixo ROI; o código não muda).

## QA-5 — Performance e soak (antes do alpha multiplayer / Fase 4)

O load atual mede 1 burst. Alpha precisa de sustentado.

- [ ] `presence-load.ts` estendido: modo soak — 50 sessões, 10 min, beat 15s + claims contínuos + focus churn; asserta latência estável (sem degradação >2x entre 1º e último minuto) e RSS do processo estável (leak de session/presence/timer).
- [ ] Broadcast storm: 50 sessões todas digitando → typing_state agregado segura (spec §5: transições, não ticks).
- [ ] Registrar números por commit em `docs/roadmap-qa/perf-log.md` (tabela: data, commit, p50/p95/p100, RSS).

## QA-6 — Segurança como suíte nomeada (1 dia)

Os testes de segurança existem mas espalhados. Consolidar visibilidade, não reescrever:

- [ ] Convenção `*.sec.test.ts` OU tag no nome; documentar em `docs/roadmap-qa/security-tests.md` o inventário: tenant-isolation, presence-ownership (hijack), lock-denied-private (leak via history/replay/live), session IDs aleatórios.
- [ ] `/security-review` no diff acumulado antes de cada release de fase; achados viram testes pinados aqui.
- [ ] Fase 4 (roles/authz) OBRIGATORIAMENTE nasce com testes de authz negativo (observer não pode X) — gate de PR.

---

## Ordem e esforço

| Fase | Esforço | Quando |
|---|---|---|
| QA-0 CI | 0.5 dia | **JÁ** — antes de qualquer código novo |
| QA-1 smoke manual | 1 sessão | JÁ (paralelo a QA-0) |
| QA-2 e2e Playwright | 1-2 sem | antes de declarar Fase 3 "done done" |
| QA-3 multi-cliente | 3-5 dias | junto/logo após QA-2 |
| QA-4 graph-core | contínuo | regra a partir de agora |
| QA-5 soak/perf | 2-3 dias | gate de entrada da Fase 4 |
| QA-6 sec suite | 1 dia | qualquer hora; obrigatório na Fase 4 |

## Débitos conhecidos (registrar, não esconder)

1. `tsc --noEmit` no mcp-server tem baseline sujo pré-existente (bun-types/ffi, web-tree-sitter, fixtures) — QA-0 só gate-ia o mcp-web; limpar baseline é tarefa própria (esforço desconhecido, baixo valor imediato).
2. Testes com timing (debounce 250ms, typing ticks) têm margem mas não imunidade — se flakearem em CI, aumentar janelas configuráveis, nunca retry silencioso.
3. Load test em runner de CI compartilhado ≠ número de referência — por isso não-bloqueante (QA-0).
4. `presence.who` N+1 tem `ponytail:` comment — vira item real se QA-5 mostrar degradação.

## Anti-escopo (deliberado)

- ❌ Cobertura % como métrica/gate — direciona teste inútil.
- ❌ Sprint retroativo de unit tests no graph-core.
- ❌ Mutation testing, fuzzing — custo alto, fase errada do produto.
- ❌ Framework de teste adicional além de Playwright (bun test cobre o resto).
