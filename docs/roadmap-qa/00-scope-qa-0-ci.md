# QA-0 — Escopo fechado (CI)

> Status: **parcial** — workflow, job de load e badge implementados
> (`164f2f0`, `bc494de`); falta branch protection em `main` e o PR de
> quebra proposital que confirma o gate. Ambos exigem acesso à API do
> GitHub (token/`gh`) e uma decisão de dono do repo sobre proteção de
> branch — não fechado por falta de acesso, não por falta de trabalho.
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

- [x] `.github/workflows/ci.yml` com job `test`:
  1. `bun install --frozen-lockfile`
  2. `bun test` (raiz — mcp-server + mcp-web)
  3. `bunx tsc --noEmit` em `packages/mcp-web`
  4. `bun run build` em `packages/mcp-web` (vite)
- [x] Job `load` separado, `continue-on-error: true`, só em PR p/ main:
      `bun run test:load` (packages/mcp-server) — números vão pro log do job.
- [ ] Branch protection em `main`: job `test` obrigatório. **Bloqueado
      por auth, não por tooling** (update 2026-07-18): `gh` 2.86.0 já
      instalado em `~/.local/bin`; o dono decidiu autenticar na máquina
      destino (não esta) — executar lá `gh auth login` e então os dois
      itens abertos deste DoD.
- [x] Badge no `README.md` raiz.
- [ ] PR de teste com quebra proposital confirma o gate (depois revertido).
      **Bloqueado** pela mesma falta de acesso — exige push real + PR no
      GitHub.

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
