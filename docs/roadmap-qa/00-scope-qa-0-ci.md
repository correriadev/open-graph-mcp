# QA-0 — Escopo fechado (CI)

> Status: **escopo p/ execução** — pré-requisito de todo o resto.
> Índice-pai: `README.md`.
>
> **Objetivo:** todo push/PR roda a suíte inteira automaticamente. Sem CI,
> teste que não roda em todo push regride em silêncio — o roadmap QA inteiro
> é teatro sem esta fase.

---

## 1. O que sai pronto no final

1. Workflow GitHub Actions rodando em push + PR.
2. Gate real: PR com teste quebrado não mergeia.
3. Load test informativo (não-bloqueante) em PRs p/ main.
4. Badge de status no README raiz.

**Definição de pronto (DoD):**

- [ ] `.github/workflows/ci.yml` com job `test`:
  1. `bun install --frozen-lockfile`
  2. `bun test` (raiz — mcp-server + mcp-web)
  3. `bunx tsc --noEmit` em `packages/mcp-web`
  4. `bun run build` em `packages/mcp-web` (vite)
- [ ] Job `load` separado, `continue-on-error: true`, só em PR p/ main:
      `bun run test:load` (packages/mcp-server) — números vão pro log do job.
- [ ] Branch protection em `main`: job `test` obrigatório.
- [ ] Badge no `README.md` raiz.
- [ ] PR de teste com quebra proposital confirma o gate (depois revertido).

---

## 2. O que NÃO está nesta fase

- ❌ `tsc --noEmit` no mcp-server como gate — baseline sujo pré-existente
  (bun-types/ffi, web-tree-sitter, fixtures). Limpeza é tarefa própria,
  fora deste escopo (ver README Débitos).
- ❌ e2e browser no CI — entra na QA-2 (job próprio).
- ❌ Matrix de OS/versões — Bun em ubuntu-latest basta p/ v1.
- ❌ Cache elaborado de dependências — `bun install` é rápido; otimizar
  depois se doer.

---

## 3. Decisões

- **QD1** Load test nunca bloqueia: latência em runner compartilhado
  flakeia; o número é informativo, não gate. Números de referência são os
  da máquina do dev, registrados na QA-5 (`perf-log.md`).
- **QD2** Timing-sensitive tests (debounce 250ms, typing ticks): se
  flakearem no runner, a correção é aumentar as janelas configuráveis dos
  testes — NUNCA retry automático silencioso.

---

## 4. Esforço estimado

| Item | Estimativa |
|---|---|
| Workflow + branch protection + badge | 0.5 dia |
| **Total** | **0.5 dia** |

---

## 5. Riscos

1. **Flake de timing no runner.** Mitigação: QD2 (janelas maiores), e os
   testes já usam hooks determinísticos (`sweepPresenceNow`,
   `tickTypingNow`) onde importa.
2. **Suíte cresce e CI fica lento.** Hoje ~3.5s. Se passar de minutos,
   particionar por pacote — não antes.
