# QA-4 — Escopo fechado (graph-core: rede de segurança mínima)

> Status: **regra contínua** — vale a partir de já, sem sprint dedicado.
> Índice-pai: `README.md`.
>
> **Objetivo:** graph-core (~50 módulos vendorados, 0 testes diretos) tem
> rede de segurança SÓ onde o server muta estado através dele. NÃO é
> sprint de cobertura retroativa: o código é estável, read-mostly, e já é
> exercitado por 29 testes de integração do mcp-server.

---

## 1. O que sai pronto no final

1. Testes unit diretos p/ os módulos no caminho de mutação.
2. Regra de contribuição permanente documentada.

**Definição de pronto (DoD):**

- [ ] `packages/graph-core/test/authority.test.ts` — `canFlip` e semântica
      de autoridade (o que `gates.ts` do server consome no
      `authority.flip`): casos permitido/negado/inválido.
- [ ] Teste unit p/ cada função do graph-core que `gates.ts` importa
      (inventariar imports; hoje é o gate incremental + final — cobrir as
      entradas que o server realmente passa).
- [ ] Regra no `CONTRIBUTING`/README do pacote: **tocou num módulo do
      graph-core → deixa teste unit atrás.** PR que edita graph-core sem
      teste correspondente não passa review.
- [ ] `merge-driver.ts`: teste unit ANTES da Fase 4 usar rebase — item de
      entrada da Fase 4, listado lá, não aqui.

---

## 2. O que NÃO está nesta fase

- ❌ Cobertura retroativa dos ~45 módulos restantes (extract-*, layout,
  quadtree, treesitter, …) — baixo ROI, código não muda, integração cobre.
- ❌ Meta de % de cobertura — direciona teste inútil (anti-escopo global).
- ❌ Refatorar graph-core p/ "ficar testável" — vendorado; muda-se o
  mínimo.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| authority + funções do gate | 1-2 dias (one-shot) |
| Regra contínua | 0 (processo) |
| **Total** | **1-2 dias + disciplina** |

---

## 4. Riscos

1. **Regra "tocou → testa" esquecida.** Trava: linha no template de
   review/PR; o orquestrador de subagents já injeta a regra nos prompts
   de implementação.
2. **Divergência do upstream open-graph.** Fora de escopo de QA — decisão
   de produto (vendorado = fork assumido).
