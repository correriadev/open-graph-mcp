# Problem Space — Relações de Impacto Markdown nos Quatro Horizontes

## Contexto e objetivo

O defeito original é reproduzível no corpus HarnessKit: o bootstrap reconhece arquivos Markdown como nós, mas o extrator genérico e a montagem de arestas não capturam seus acoplamentos documentais. No tenant `harness-kit-demo`, 58 nós Markdown aparecem desconectados; `skills/autonomous-orchestrator/SKILL.md` retorna 0 dependentes e 0 dependências apesar de referências e delegações observáveis. Imports escritos dentro de cercas Markdown ainda podem ser confundidos com imports executáveis, e JSON relevante fica fora da allowlist. Portanto, 0/0 significa hoje tanto “zero conhecido” quanto “não analisado”.

O escopo corrige essa lacuna com Graph v2 e o insere na arquitetura de quatro horizontes governados de conhecimento: **negociação**, **microtask**, **transformação** e **persistente**. **Sessão** é continuidade e iniciador por `INITIATE`, não um quinto horizonte de promoção. Cada `GraphSnapshotV2` pertence ao escopo `(tenantId, horizonId, graphId)` e carrega seus próprios nós, relações internas, evidências, Coverage Manifest, Policy Version, eventos, queries e cursores.

Há duas famílias semânticas que nunca devem ser misturadas:

- relações internas do Graph v2: `depends-on`, `references`, `delegates-to` e `behavioral-hypothesis`;
- relações inter-horizonte: `INITIATE`, `PROMOTE`, `CONTEST`, `RECALL` e a topologia `parent`.

O DAG de promoção não admite saltos: negociação → transformação por `ChangeContract`/`AcceptedPredictiveHypothesis`; microtask → transformação por `PromotionProposal`; transformação → persistente por `PersistentDelta`. `CONTEST` pode atravessar o DAG em qualquer direção com evidência, sem fabricar uma aresta documental. `RECALL` ou mudança da base torna promoções derivadas `STALE_BASE`; nada é mutado ou reclassificado silenciosamente.

## 1. Event Storming

| # | Domain Event (past tense) | Command (trigger) | Aggregate | External Systems | Read Models |
|---:|---|---|---|---|---|
| 1 | Escopo de Horizonte Selecionado | Iniciar bootstrap para tenant e horizonte | Horizon Graph Scope | Cliente MCP | Horizon Graph Registry |
| 2 | Escopo de Indexação Descoberto | Inventariar repositório | Artifact Inventory | Sistema de arquivos | Inventory Coverage |
| 3 | Artefato Markdown Indexado | Registrar Markdown elegível | Artifact Inventory | — | Artifact Catalog |
| 4 | Família JSON Admitida | Aplicar allowlist configurada | Artifact Inventory | — | Format Coverage |
| 5 | Artefato Permanecido Não Analisado | Registrar exclusão, leitura ou parse falho | Coverage Manifest | — | Coverage Diagnostics |
| 6 | Evidência Markdown Extraída | Analisar links, caminhos, símbolos e delegações | Evidence Set | — | Evidence Outcomes |
| 7 | Import Cercado Rejeitado | Ignorar import em bloco ou exemplo Markdown | Evidence Set | — | Rejected Signals |
| 8 | Destino de Evidência Resolvido | Resolver identidade no snapshot | Relationship Candidate Set | — | Resolution Outcomes |
| 9 | Destino Permanecido Incerto | Registrar alvo não resolvido ou ambíguo | Relationship Candidate Set | — | Resolution Outcomes |
| 10 | Relacionamento Interno Classificado | Aplicar Policy Version do horizonte | Relationship Set | — | Relationship Explanations |
| 11 | Hipótese Comportamental Separada | Classificar correlação como hipótese | Relationship Set | — | Hypothesis Channel |
| 12 | Coverage Manifest Reconciliado | Fechar contagens e falhas por horizonte | Graph Snapshot Candidate | — | Horizon Coverage |
| 13 | Graph Snapshot Publicado | Confirmar snapshot atômico | GraphSnapshotV2 | SQLite e JSONL | Active Horizon Graph |
| 14 | Consulta de Impacto Avaliada | Consultar nó e direção | Impact Analysis | Cliente MCP | Explained Blast Radius |
| 15 | Impacto Conhecido como Zero | Confirmar cobertura direcional suficiente | Impact Analysis | — | ImpactResponseV2 |
| 16 | Impacto Permanecido Desconhecido | Detectar cobertura insuficiente | Impact Analysis | — | ImpactResponseV2 |
| 17 | Cursor Obsoleto Recusado | Continuar query com escopo divergente | Impact Query | Cliente MCP | Named Refusal Log |
| 18 | Negociação Iniciada | Aplicar `INITIATE` com `NegotiationSeed` | Negotiation Horizon | Sessão do operador | Proposed Negotiation Context |
| 19 | Hipótese Preditiva Aceita | Completar ciclo no horizonte de negociação | Negotiation Knowledge | — | Accepted Hypotheses |
| 20 | Conteúdo Promovido à Transformação | Enviar `ChangeContract` no pai imediato | Promotion | — | Proposed Transformation Intake |
| 21 | Microtask Iniciada | Aplicar `INITIATE` com `WorkOrder` | Microtask Horizon | — | Proposed Work Context |
| 22 | Resultado de Microtask Promovido | Enviar `PromotionProposal` à transformação originadora | Promotion | — | Proposed Result Intake |
| 23 | Conteúdo Recebido Revalidado | Resolver, reclassificar e verificar sob política receptora | Receiving Horizon | — | Promotion Decision |
| 24 | Promoção ao Persistente Proposta | Enviar `PersistentDelta` ao pai imediato | Promotion | — | Proposed Persistent Intake |
| 25 | Salto de Horizonte Recusado | Detectar alvo diferente do pai topológico | Promotion | — | `HORIZON_SKIP` Refusal |
| 26 | Autoridade de Origem Descartada | Admitir somente conteúdo proposto no receptor | Promotion | — | Authority Boundary Audit |
| 27 | Conteúdo Contestado | Aplicar `CONTEST` com evidência entre horizontes | Contest | — | Contestation Queue |
| 28 | Base Persistente Recalled | Aplicar `RECALL` comprovado | Recall | — | Recall Closure |
| 29 | Promoção Derivada Tornada Obsoleta | Propagar mudança de base como `STALE_BASE` | Promotion Lineage | — | Stale Promotion Register |

## 2. Subdomain Classification

| Subdomain | Type | Justification |
|---|---|---|
| Descoberta de Relações Markdown | Core | Transforma evidência documental heterogênea em sinais conservadores e explicáveis. |
| Semântica de Relacionamentos Internos | Core | Preserva a distinção entre dependência, referência, delegação e hipótese comportamental. |
| Governança Inter-Horizonte | Core | Garante promoção imediata, revalidação receptora e não transferência de autoridade. |
| Análise de Impacto Explicável | Core | Diferencia `known-zero`, `known-nonzero` e `unknown` por cobertura real. |
| Cobertura por Horizonte | Supporting | Impede que Grau A ou cobertura suficiente em um filho seja herdada pelo pai. |
| Linhagem, Contestação e Recall | Supporting | Torna evidência, `STALE_BASE` e correção observáveis sem mutação silenciosa. |
| Inventário e Leitura de Arquivos | Generic | Descoberta, leitura e parsing básico são infraestrutura comum. |
| Persistência e Transporte MCP | Generic | SQLite, JSONL e JSON-RPC entregam o domínio sem definir sua semântica. |
| Corpus de Aceite HarnessKit | Supporting | Prova o defeito e as correções com conteúdo natural, sem hospedar lógica OpenGraph. |

## 3. Ubiquitous Language Glossary

| Term | Definition | Notes |
|---|---|---|
| Horizon | Fronteira governada na qual conhecimento percorre seu próprio ciclo e ganha apenas autoridade relativa. | Os quatro são negociação, microtask, transformação e persistente; sessão não entra nessa contagem. |
| GraphSnapshotV2 | Estado imutável e atômico de um grafo para um tenant e horizonte. | Identidade completa: `tenantId + horizonId + graphId`. |
| Internal Relationship | Relação entre artefatos dentro de um GraphSnapshotV2. | `depends-on`, `references`, `delegates-to` ou `behavioral-hypothesis`; não usar para promoção. |
| Horizon Boundary Operation | Operação governada entre horizontes. | `INITIATE`, `PROMOTE`, `CONTEST` e `RECALL`; não é aresta documental. |
| Parent Topology | DAG que declara o único destino imediato permitido para uma promoção. | Não significa duração, posse ou contenção. |
| PromotionEnvelope | Pacote de candidatura enviado ao horizonte receptor. | Contém `sourceHorizonId`, `sourceGraphId`, `targetHorizonId`, `candidates`, `evidenceIds`, `coverageSummary`, `policyVersion` e `provenance`. |
| Proposed Content | Conteúdo recebido que ainda não tem autoridade no receptor. | Deve ser resolvido, reclassificado e revalidado localmente. |
| Relative Authority | Permissão para governar operações somente no horizonte que a concedeu. | Nunca atravessa `INITIATE` ou `PROMOTE`. |
| Coverage Manifest | Registro reconciliado do que um horizonte inventariou, analisou, excluiu ou falhou. | Grau A e cobertura no filho não implicam admissão no pai. |
| Evidence Grade | Força da evidência interna: A estrutural, B simbólica explícita, C hipótese comportamental. | Grau não define tipo nem autoridade inter-horizonte. |
| Impact Knowledge | Estado direcional de conhecimento de impacto. | `known-zero`, `known-nonzero` ou `unknown`. |
| HORIZON_SKIP | Recusa de uma promoção cujo alvo não é o pai topológico imediato. | Contestação não usa essa regra de trânsito. |
| CONTEST | Desafio baseado em evidência a conteúdo admitido em outro horizonte. | Pode cruzar o DAG; não cria Internal Relationship. |
| RECALL | Correção comprovada sobre conhecimento persistente admitido. | Avança a base e torna derivações em voo `STALE_BASE`. |
| STALE_BASE | Estado em que a base referenciada deixou de ser atual. | Promoção exige rebase ou revalidação; não admite aprovação substitutiva. |

## 4. Socratic Questions

### Business Invariants and Consistency

1. Como provar que nenhum payload de `INITIATE`, `PROMOTE`, `CONTEST` ou `RECALL` foi persistido como `depends-on`, `references` ou `delegates-to`?
2. Que verificação impede uma microtask de promover diretamente ao persistente e garante `HORIZON_SKIP` mesmo sob concorrência?
3. Como o receptor demonstra que resolveu, reclassificou e revalidou cada candidato, em vez de herdar o Evidence Grade ou a autoridade da origem?
4. Quando `RECALL` altera a base, como todas as promoções derivadas são marcadas `STALE_BASE` sem reescrever silenciosamente seu conteúdo histórico?
5. Sob quais condições o Coverage Manifest de um horizonte permite `known-zero` sem usar a cobertura de outro horizonte?

### Scalability and Performance

6. A resolução usa índice único por `(tenantId, horizonId, graphId)` ou executa busca global por menção, criando N+1 em um milhão de artefatos?
7. Como evidências repetidas, fanout documental, ciclos internos e linhagens de promoção são paginados e limitados sem falsificar totais?
8. Qual orçamento impede uma contestação ampla ou cascata de recall de bloquear publicação e queries de outros horizontes do tenant?

### Security and Sensitive Data

9. Como caminhos Markdown, symlinks, links codificados e JSON allowlisted são confinados ao repositório e ao mesmo tenant/horizonte?
10. PromotionEnvelope, eventos e explicações podem expor conteúdo bruto, segredo ou evidência pertencente a outro tenant ou horizonte?
11. Como um conteúdo Markdown hostil é impedido de fabricar delegações, imports executáveis ou proveniência inter-horizonte?

### Concurrency and Failures

12. Durante rebuild, promoção e recall concorrentes, cada leitor observa um GraphSnapshotV2 completo e uma base coerente, nunca mistura entre graphIds?
13. Se a política ou cobertura do receptor mudar entre recepção e admissão, a tentativa é revalidada ou falha com `STALE_BASE`?
14. Como retries idempotentes evitam duplicar PromotionEnvelope, contestação, evidência e eventos sem ocultar recusas?
15. Que erro nomeado distingue cursor com `graphId` obsoleto de cursor emitido para outro `horizonId`?

### Responsibility Boundaries Between Layers

16. Qual módulo é autoridade para relações internas e qual é autoridade para topologia/operações inter-horizonte, evitando que adapters MCP fundam os modelos?
17. Como impedir que HarnessKit receba parser, política, persistência ou lógica de promoção para facilitar o teste de aceite?
18. Onde a política de travessia decide que `references` é impactante sem reclassificar evidência durante a query?
19. Como o host L3 permanece determinístico e cego ao chamador enquanto agentes apenas propõem?

**Architecture Tip:** Separe por tipos e armazenamento o grafo interno escopado e o protocolo de fronteira. Faça o receptor reconstruir sua própria decisão a partir de candidatos, evidência e cobertura, nunca de autoridade herdada.

### Pontos abertos preservados

- SLO para corpus próximo de um milhão de documentos depende de benchmark; nenhum número é assumido nesta spec.
- Autenticação obrigatória para detalhes de evidência além do isolamento por tenant permanece decisão de produto.
- Critérios para extensões futuras do DAG além dos quatro horizontes continuam fora deste escopo; qualquer extensão deve ser declarada e verificável.
