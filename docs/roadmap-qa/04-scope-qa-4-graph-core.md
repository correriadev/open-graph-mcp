# QA-4 — Escopo fechado (graph-core: rede de segurança mínima)

> Status: **implementado** (2026-07-17, `95c71c6`+) — 3/3 itens do DoD
> próprios fechados (o 4º item listado abaixo é entrada da Fase 4, não
> desta fase — ver sua própria nota). Regra contínua vale daqui pra
> frente.
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

- [x] `packages/graph-core/test/authority.test.ts` — `canFlip` e semântica
      de autoridade (o que `gates.ts` do server consome no
      `authority.flip`): casos permitido/negado/inválido. 10 testes:
      `canFlip` permitido/cada motivo de negação isolado/3 motivos
      combinados, `getAuthority` default+explícito, `setAuthority`
      seta/**deleta** a chave ao voltar pra source (não só sobrescreve)/
      não muta o input.
- [x] Teste unit p/ cada função do graph-core que `gates.ts` importa —
      inventariado (5 imports: `roundtripScoped`, `verifyIntegrity`,
      `claimCoverage`, `canFlip`, `excerptCheck`). `canFlip` acima;
      `test/roundtrip.test.ts` (8 testes: ladder limpa, os 4 tipos de
      violação, root em extremo não é órfão, escopo isola componente
      desconexo, rootId ausente), `test/verify.test.ts` (8 testes: limpo,
      os 5 `Breach.kind`, ref pra outra claim — não meta — não é
      dangling, claim sem âncora/só-escada isenta do check de âncora-no-
      chão), `test/claim-store.test.ts` (5 testes: `claimCoverage`
      balanceado/não-balanceado/multi-cobertura/cell vazia/ref não
      resolvida), `test/extract.test.ts` (6 testes: `excerptCheck` match/
      no-match/normalização CRLF nos dois lados/excerpt vazio/excerpt
      maior que o conteúdo). 37 testes novos, todos verdes (`bun test`
      raiz: 218 pass, 0 fail).
- [x] Regra no `CONTRIBUTING`/README do pacote: **tocou num módulo do
      graph-core → deixa teste unit atrás.** PR que edita graph-core sem
      teste correspondente não passa review. `packages/graph-core/README.md`
      criado (pacote não tinha nenhum) com a regra + a lista de cobertura
      mínima garantida.
- [ ] `merge-driver.ts`: teste unit ANTES da Fase 4 usar rebase — item de
      entrada da Fase 4, listado lá, não aqui. **Não bloqueia o fechamento
      desta fase** — é um lembrete pra quando a Fase 4 (roadmap-mcp)
      começar, não um item do DoD de QA-4 em si.

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
