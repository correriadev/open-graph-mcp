# QA-2 — Escopo fechado (e2e web automatizado)

> Status: **escopo p/ execução** — após QA-0 verde; QA-1 executada.
> Índice-pai: `README.md`.
>
> **Objetivo:** fechar o buraco §10.7 do scope da Fase 3
> (`toast-notifications.test.ts` e2e, deferido por falta de harness de
> browser) e cobrir toda a UI web com testes que rodam em CI. Depois desta
> fase, os 9 testes de aceite da Fase 3 (§10) estão TODOS automatizados.

---

## 1. O que sai pronto no final

1. Harness Playwright: server real + vite preview + N páginas = N sessões.
2. Suíte e2e espelhando §7 do scope da Fase 3, 1 arquivo por peça de UI.
3. Job `e2e` no CI, bloqueante em PR p/ main.

**Definição de pronto (DoD):**

- [ ] Playwright instalado SÓ em `packages/mcp-web` (devDependency) —
      única dependência de teste nova do roadmap QA inteiro.
- [ ] Fixture compartilhada: sobe `startServer({stateDir: tmp})` +
      `vite preview` (build real, não dev server), N `browser.newPage()`
      com `sessionStorage` isolado (1 sessão por página, spec §3.3).
- [ ] `e2e/presence-bar.e2e.ts` — contagem "Conectados (N)"; dots: forçar
      amarelo/cinza via `lastSeen` do server (campo já existe no
      presence.who desde a Task 5); expand/collapse.
- [ ] `e2e/avatar-overlay.e2e.ts` — badge sólido em cell locked; avatar
      semi-transparente em focus sem turno; tooltip hover (nome +
      agentKind + última atividade).
- [ ] `e2e/typing-indicator.e2e.ts` — aparece durante claims; some em
      transição p/ quiet; some quando o usuário vira invisible (fix da
      Task 3 exercitado ponta-a-ponta).
- [ ] `e2e/toast-notifications.e2e.ts` — **§10.7 literal**: S1 commita,
      S2 vê toast "S1 commitou cs_X em cell Y"; click → canvas jump.
      Coalescência (burst mesmo cs_id → "N eventos"); cap 5 na tela +
      "(+N)"; hover mostra timestamp.
- [ ] `e2e/settings-invisible.e2e.ts` — checkbox invisible → some da barra
      da outra página, zero user.focused; checkbox de notificação de
      commit off → sem toast de commit; persistência sessionStorage POR
      ABA (duas páginas, settings independentes).
- [ ] `e2e/reconnect.e2e.ts` — **§10.9 lado web**: derrubar server, subir
      de novo (mesmo stateDir); toast "Server reiniciou"; foco redeclarado
      automaticamente (avatar reaparece na outra página); exatamente UMA
      reconexão (regressão do leak de SSE da review da Task 4).
- [ ] Job CI `e2e` (chromium headless), bloqueante em PR p/ main.
- [ ] Suíte inteira < 2 min no CI.

---

## 2. O que NÃO está nesta fase

- ❌ Firefox/WebKit — chromium basta p/ v1 (cliente interno).
- ❌ Visual regression/screenshots — custo de manutenção alto, valor baixo
  agora.
- ❌ Testes de canvas pixel-a-pixel — asserta-se presença/ausência de
  elementos e payloads, não rendering exato (avatar overlay verifica via
  hover/tooltip DOM, não pixels).
- ❌ Mobile/responsivo — fora do produto v1.

---

## 3. Decisões

- **QD3** Playwright, não alternativa: precisa de DOM+canvas+SSE reais;
  "sem dependência" não existe p/ isso. Fica confinado ao mcp-web.
- **QD4** `vite preview` (build) e não dev server: testa o artefato que
  seria servido, e o build já é gate da QA-0 — coerência.
- **QD5** Timing: e2e usa os mesmos knobs configuráveis dos testes de
  integração (debounceMs, typingMs, presenceTtlMs curtos via env/opts do
  server de teste) — nunca sleeps calibrados no relógio de produção.

---

## 4. Esforço estimado

| Item | Estimativa |
|---|---|
| Harness (fixture server+preview+páginas) | 1-2 dias |
| 6 arquivos e2e | 4-6 dias |
| CI job + estabilização | 1-2 dias |
| **Total** | **1-2 semanas** |

---

## 5. Riscos

1. **Flake e2e** (o risco clássico). Travas: knobs de timing (QD5),
   waits por evento/elemento (nunca sleep fixo), retry de suíte proibido
   — flake é bug, conserta-se a espera.
2. **Canvas dificulta asserção.** Mitigação já embutida: lógica extraída
   pura (presence-state, toasts) já é unit-testada; e2e asserta o
   OBSERVÁVEL (tooltip, toast DOM, jump de viewport), não o desenho.
3. **Playwright pesa no CI.** ~1 browser download cacheado; job separado
   não atrasa o job `test` rápido.
