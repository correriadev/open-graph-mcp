# Context Map — Relações de Impacto Markdown nos Quatro Horizontes

## 1. Bounded Context Identification

| Bounded Context | Responsibility | Boundary (excluded) | Team Ownership | Key Entities |
|---|---|---|---|---|
| Target Repository | Fornecer arquivos versionados como fonte externa observável. | Não classifica relações, cobertura ou autoridade. | Equipe proprietária do repositório | Repository Snapshot, Source Artifact |
| Artifact Inventory | Descobrir identidades, formatos allowlisted e falhas no escopo do horizonte. | Não extrai evidência nem conclui impacto. | OpenGraph Indexing | Artifact Identity, Format Policy, Inventory Coverage |
| Evidence Extraction | Extrair sinais Markdown específicos, preservando proveniência e rejeitando imports cercados. | Não publica relação e não promove entre horizontes. | OpenGraph Extraction | Evidence Record, Source Location, Rejected Signal |
| Relationship Semantics | Resolver e classificar relações internas sob Policy Version do horizonte. | Não executa operações inter-horizonte nem travessia MCP. | OpenGraph Protocol Core | Resolution Outcome, Published Relationship, Evidence Grade |
| Horizon Graph Publication | Publicar atomicamente GraphSnapshotV2 escopado por tenant, horizonte e graph. | Não herda coverage/policy de outro horizonte. | OpenGraph Reference Host | GraphSnapshotV2, Coverage Manifest, Horizon Graph Scope |
| Impact Analysis | Calcular Blast Radius explicado e Impact Knowledge dentro de um snapshot. | Não reclassifica evidência nem atravessa DAG de promoção. | OpenGraph Protocol Core | Impact Query, Impact Cursor, ImpactResponseV2 |
| Horizon Governance | Declarar Parent Topology e governar `INITIATE`, `PROMOTE`, `CONTEST`, `RECALL`. | Não representa esses operadores como arestas documentais. | OpenGraph EAP Host | Horizon, PromotionEnvelope, Contest, Recall, Refusal |
| Promotion Reception | Receber candidatos como `proposed` e resolvê-los, reclassificá-los e revalidá-los localmente. | Não transfere Relative Authority ou Evidence Grade da origem. | Host do horizonte receptor | Proposed Candidate, Reception Decision, Promotion Lineage |
| HarnessKit Acceptance Corpus | Oferecer fatos documentais naturais e controles negativos estáveis. | Não implementa parser, política, host, persistência ou traversal OpenGraph. | HarnessKit maintainers | Corpus Manifest, Expected Evidence Case, Exclusion Case |

### Perfis dos quatro horizontes

| Horizon | Conhecimento governado | Pai de promoção | Contrato que promove | Política e Coverage Manifest |
|---|---|---|---|---|
| Negociação | Questões, hipóteses preditivas e contratos candidatos | Transformação | `ChangeContract` com `AcceptedPredictiveHypothesis` | Próprios; admissão local não vincula transformação |
| Microtask | Abordagem, execução e evidência rechecável de uma tarefa | Transformação que a iniciou | `PromotionProposal` | Próprios; Grau A não atravessa como autoridade |
| Transformação | WorkOrders, composição de resultados e mudança coerente | Persistente | `PersistentDelta` | Próprios; revalida entradas de negociação e microtask |
| Persistente | Estado oficial versionado e relações admitidas | Nenhum | — | Próprios; só `RECALL` corrige conhecimento admitido |

Sessão fornece continuidade e dispara `INITIATE`/`NegotiationSeed`; não pertence ao DAG de promoção nesta contagem. Transformação pode disparar `INITIATE`/`WorkOrder` para microtask, mas esse início não inverte o pai de promoção da microtask.

### Evidence Grades internos

| Grade | Evidência admitida | Autoridade interna | Efeito inter-horizonte |
|---|---|---|---|
| A | Import, link/caminho ou delegação estrutural resolvida | Pode sustentar relação interna confirmada | Vira apenas evidência em PromotionEnvelope; receptor revalida |
| B | Referência simbólica explícita e unívoca | Sustenta `references` conforme política | Não garante admissão no pai |
| C | Correlação comportamental | Permanece `behavioral-hypothesis` | Pode motivar candidato/contestação, nunca autoridade |
| Rejected/ambiguous | Termo genérico, alvo ausente/múltiplo ou sinal cercado | Nenhuma aresta confirmada | Pode reduzir coverage; não é promovido como fato |

## 2. Context Map

### Target Repository → Artifact Inventory

Pattern   : Anti-Corruption Layer (ACL)
Direction : upstream / downstream
Justification: o inventário traduz filesystem mutável em identidades e cobertura confinadas ao repositório.

### Artifact Inventory → Evidence Extraction

Pattern   : Open Host Service
Direction : upstream / downstream
Justification: extratores recebem artefatos elegíveis e estado de leitura sem duplicar descoberta.

### Evidence Extraction → Relationship Semantics

Pattern   : Customer-Supplier
Direction : upstream / downstream
Justification: o extrator preserva sinal; a classificação decide tipo, direção, grade e rejeição.

### Artifact Inventory ↔ Relationship Semantics

Pattern   : Published Language
Direction : bidirectional
Justification: ambos usam identidade canônica e resultados `resolved`, `unresolved` e `ambiguous`.

### Relationship Semantics → Horizon Graph Publication

Pattern   : Published Language
Direction : upstream / downstream
Justification: somente relações internas tipadas, hipóteses e outcomes atravessam para o snapshot.

### Artifact Inventory → Horizon Graph Publication

Pattern   : Customer-Supplier
Direction : upstream / downstream
Justification: o Coverage Manifest do mesmo escopo deve ser publicado com as relações.

### Horizon Graph Publication → Impact Analysis

Pattern   : Open Host Service
Direction : upstream / downstream
Justification: Impact Analysis consome um snapshot imutável identificado por `(tenantId, horizonId, graphId)`.

### Relationship Semantics ↔ Impact Analysis

Pattern   : Published Language
Direction : bidirectional
Justification: Policy Version define travessia de `depends-on`, `references`, `delegates-to` e exclui hipóteses confirmadas.

### Horizon Graph Publication → Horizon Governance

Pattern   : Customer-Supplier
Direction : upstream / downstream
Justification: operações de fronteira referenciam graphId, evidência, coverage e proveniência sem converter relações internas em topologia.

### Horizon Governance → Promotion Reception

Pattern   : Published Language
Direction : upstream / downstream
Justification: PromotionEnvelope tem schema fechado e destino validado contra Parent Topology.

### Promotion Reception → Relationship Semantics

Pattern   : Anti-Corruption Layer (ACL)
Direction : upstream / downstream
Justification: o receptor traduz candidatos `proposed` para identidades, tipos, grades e política locais, descartando autoridade de origem.

### Horizon Governance ↔ Impact Analysis

Pattern   : Separate Ways
Direction : bidirectional
Justification: lineage e contestação podem referenciar evidência, mas nunca viram Internal Relationship ou caminho de Blast Radius.

### HarnessKit Acceptance Corpus → Evidence Extraction

Pattern   : Conformist
Direction : upstream / downstream
Justification: OpenGraph adapta seus extratores ao corpus natural e não exige que HarnessKit incorpore lógica de produto.

## 3. Core Domain Highlight

Context : Evidence Extraction
Reason  : resolve o falso 0/0 sem fabricar arestas a partir de termos genéricos ou imports cercados.
Investment: extrator Markdown específico, corpus positivo/negativo, proveniência determinística e allowlist JSON explícita.

Context : Relationship Semantics
Reason  : distingue relações internas comprovadas de hipóteses e mantém grade ortogonal ao tipo.
Investment: contratos fechados, política versionada e testes de propriedade para direção, reconciliação e determinismo.

Context : Horizon Governance e Promotion Reception
Reason  : preservam a tese de autoridade relativa ao fazer toda promoção cruzar exatamente um pai e reiniciar como proposta.
Investment: Parent Topology determinística, PromotionEnvelope, recusas nomeadas, revalidação e linhagem stale/recall.

Context : Impact Analysis
Reason  : transforma cobertura por horizonte em uma resposta auditável `known-zero`, `known-nonzero` ou `unknown`.
Investment: regras formais de cobertura, paginação escopada e explicações limitadas e seguras.

## 4. Architectural Decisions

Decision    : Governar exatamente quatro horizontes de conhecimento e tratar sessão somente como continuidade/iniciador.
Context     : sessão não é pai de promoção; `INITIATE` carrega contexto com proveniência e zero autoridade.
Consequences: evita uma cadeia linear falsa; exige contrato `NegotiationSeed` e distinção explícita da sessão de transporte.

Decision    : Declarar o DAG de promoção negociação→transformação, microtask→transformação e transformação→persistente, sem saltos.
Context     : “não saltar o pai” só é verificável com Parent Topology concreta.
Consequences: `HORIZON_SKIP` é determinístico; descobertas de microtask destinadas ao persistente atravessam dois gates.

Decision    : Separar relações internas do Graph v2 de operações e topologia inter-horizonte.
Context     : uma contestação, promoção ou recall não descreve acoplamento documental.
Consequences: evita blast radius contaminado; requer modelos, stores, eventos e queries distintos.

Decision    : Escopar todo GraphSnapshotV2 e seus derivados por `(tenantId, horizonId, graphId)`.
Context     : isolamento apenas por tenant permite misturar coverage, cursor ou relações de horizontes diferentes.
Consequences: persistência e contratos ficam maiores; queries e rebuilds passam a ser atomicamente verificáveis.

Decision    : Receber PromotionEnvelope sempre como `proposed` e revalidar no receptor.
Context     : Evidence Grade A e Relative Authority pertencem ao horizonte de origem.
Consequences: elimina authority laundering; acrescenta latência e pode rebaixar/rejeitar candidatos no pai.

Decision    : Fazer `CONTEST` cruzar o DAG com evidência e fazer `RECALL`/mudança de base produzir `STALE_BASE` em derivações.
Context     : dúvida precisa viajar mais rápido que afirmação, mas correção não pode reescrever história.
Consequences: contestação não precisa promover; promoções em voo exigem rebase/revalidação explícita.

Decision    : Substituir Graph v1 por Graph v2 sem camada de compatibilidade.
Context     : não existem clientes atuais e o contrato v1 permite 0/0 ambíguo.
Consequences: schema, MCP e cursor mudam de forma breaking; `CURSOR_GRAPH_STALE` e `CURSOR_HORIZON_MISMATCH` são erros nomeados.

Decision    : Manter HarnessKit como corpus de aceite externo.
Context     : mover parsing ou promoção para o corpus inverteria a responsabilidade do produto.
Consequences: HarnessKit só fixa casos naturais e drift; todas as asserções Graph v2 permanecem em OpenGraph.
