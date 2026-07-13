# Roadmap-mcp — índice

> Linha de produto paralela ao fork open-graph: um **serviço MCP** derivado
> dos conceitos do open-graph, p/ base de conhecimento centralizada
> multi-usuário rastreada em tempo real.

## Documentos

| # | Arquivo | Função | Status |
|---|---|---|---|
| — | `ADR.md` | Decisões arquiteturais + tese de produto. **Ler primeiro.** | proposto |
| 1 | `01-scope-phase-1.md` | MCP read-only: bootstrap, query, subscribe. | proposto |
| 2 | `02-scope-phase-2.md` | Changesets + locks pessimistas + SQLite como índice live (JSONL durável). | proposto |
| 3 | `03-scope-phase-3.md` | Presença live + affinity router + typing + toasts. | proposto |
| 4 | `04-scope-phase-4.md` | Lock otimista + rebase + authz + watch validado multi-dev. | proposto |
| 5 | `05-scope-phase-5-federacao.md` | Manifestos cross-server (v2+, a escrever). | proposto |
| 5' | `05-business-hosted-vs-self-hosted.md` | Decisões comerciais v2 (a escrever). | proposto |

## Decisões tomadas (defaults ADR)

- **D1** Server-only (sem `.graph/` local p/ cliente). **D2** Single-org
  com auditoria. **D3** Single-node SQLite. **D4** Lock híbrido (β
  pessimista/α otimista). **D5** Cliente web apartado.
- **D6** Watch herdado como está (Fase 1 não refina `A2/A3`).
- **D7** Watch **opcional desde a Fase 2** (modo repo-linked via
  `WATCH_REPO_PATH` + adapter `watch-bridge → appendEvent` SQLite+JSONL);
  sem repo configurado, desligado. Evita regressão de demo vs Fase 1.
- **D8** Múltiplos observers em uma cell sem lock OK.
- **D9** Rebase explícito com atalho "Rebase & Commit".
- **D10** Tokens 90 dias + renew via admin CLI (escopo **Fase 4**; nas
  Fases 2-3 tokens são efêmeros em memória, sem expiração — ver `02` §9).
- **D11** Corrida watch-vs-changeset resolvida por **ordenação de seq
  global**: quem admite primeiro ganha; o segundo rebasa. (Não "watch
  ganha sempre".)

D1–D5 validados pelo usuário. D6–D11 = propostas deste escopo, sujeitas a
edição antes da execução.

## Sequência de execução

```
ADR ──► Fase 1 (read-only) ──► Fase 2 (mutação pess.) ──► Fase 3 (presença)
                                                         │
                                                         ▼
                                                       Fase 4 (otimista + authz)
                                                         │
                                                         ▼
                                          Fase 5 (federação) | Fase 5' (hosted)
```

Cada fase só começa após a anterior verde (verificação pelos testes de
aceite listados em cada escopo).

**Checkpoint de adoção entre Fase 2 e Fase 3:** 2+ usuários reais usando
o serviço semanalmente após a Fase 2. Sem isso, pivô/pausa antes de
investir 9–12 semanas (Fases 3+4) em polish da metáfora multiplayer.
Mesmo espírito do gate de federação da Fase 5 ("não codar sem 2+ times
pedindo"), aplicado uma fase antes.

## Estimativa total (1 dev, ~50% dedicação)

- Fase 1: 2-3 sem
- Fase 2: 5-7 sem
- Fase 3: 4-5 sem
- Fase 4: 5-7 sem
- **MVP multiplayer alpha: ~16-22 sem (~4-5 meses)** p/ abrir possibilidade
  de adoção pagante/uso sério.

Fase 5/5' são v2 — sem data; dependem de mercado.

## Pendências de pesquisa (pré-código)

Ver `02-scope-phase-2.md` §13:

1. ~~`@modelcontextprotocol/sdk` state-of-art~~ **RESOLVIDO (2026-07-12):**
   SDK `1.29.0` já é dependência de `packages/opencode` (era Streamable
   HTTP). Caminho da Fase 1 confirmado: tools MCP + `/events` SSE próprio;
   `resources/subscribe` fora da v1.
2. ~~exports dos módulos de grafo~~ **RESOLVIDO (2026-07-12):** o pacote
   `opencode` expõe `"./*": "./src/*.ts"` — deep import
   `opencode/graph/watch` etc. funciona de qualquer workspace package via
   `"opencode": "workspace:*"`. **Extração de `graph-core` desnecessária.**
   Atenção: o nome `@opencode-ai/core` que aparecia nas specs era ERRADO
   (é outro pacote, sem `graph/`) — corrigido nos docs.
3. `bun:sqlite` transações em workers/fibers — trava a Fase 2 (aberto).

**D13 DECIDIDA (2026-07-12, pelo usuário, contra a recomendação R):**
multi-tenant desde a Fase 2 — `tenant_id` em todas as tabelas SQLite,
toda query escopada por tenant, espelho JSONL por tenant, seq monotônico
por tenant. SQLite permanece (Postgres continua fora do v1). Ver
`05-business-hosted-vs-self-hosted.md` §3.

## Princípios herdados do open-graph (non-negotiable)

1. Núcleo determinístico, LLM na borda.
2. Porta única (gate).
3. Verdade no grafo.
4. Autoridade ganha, não herdada.
5. Escada bidirecional.
6. Humano nos pontos irreversíveis.

Estas são a base de produto. O servidor MCP adiciona camada distribuída
sobre estes princípios; nunca subtrai.