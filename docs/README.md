# DOCUMENTAÇÃO — OpenGraph

## Cânone vigente

Leia nesta ordem — ela também é a ordem de autoridade: **onde um documento divergir do anterior, o anterior vence.**

| # | Documento | O que é |
|---|---|---|
| 1 | [Working Paper v1.0](./PRD/OpenGraph_Working_Paper_v1_0.md) | **Fonte normativa.** A arquitetura cognitiva recursiva sobre substrato epistêmico verificável: planos, horizontes, promoção de autoridade, invariantes, ameaças e o programa experimental. |
| 2 | [PRD](./PRD/PRD.md) | 89 requisitos em dez épicos, cada um com critério de aceite verificável por log, ADR de origem e a hipótese ou ameaça que o falsifica. |
| 3 | [ADR](./ADR/ADR.md) | 21 registros de decisão arquitetural derivados do paper, mais o apêndice de ambiguidades abertas e o de achados de código. |

Nenhum destes documentos descreve algo já construído. O campo **Status** de cada ADR diz em que estágio a decisão está, e o vocabulário de marcas — `[B]` conquistado, `[C]` construído e desligado, `[E]` evolução proposta, `[A]` aberto — vale para os três.

## Base histórica

| Documento | O que é |
|---|---|
| [CHANGELOG](./CHANGELOG.md) | Contexto consolidado dos ~150 documentos apagados em 2026-08-11: seis roadmaps, o loop autônomo, a auditoria de qualidade e o alpha v0. Registro de como se chegou até aqui — não é fonte normativa. |

Os documentos originais permanecem recuperáveis pelo histórico do git (`git log --diff-filter=D -- docs/`).
