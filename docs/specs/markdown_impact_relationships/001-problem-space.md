# Problem Space — Relações de Impacto em Markdown

## Contexto e objetivo

`graph.impact` deve fornecer um blast radius confiável também para nós Markdown, incluindo skills e documentação operacional. Hoje, esses arquivos entram no bootstrap como nós, mas não recebem relacionamentos estruturais: a extração reconhece imports/requires de código, a montagem publica `depends-on` somente a partir dessas dependências e a análise de impacto percorre apenas essas arestas.

O falso-negativo foi confirmado no tenant `harness-kit-demo`: entre 299 nós e 620 arestas há 58 nós Markdown, todos sem arestas de entrada ou saída. `skills/autonomous-orchestrator/SKILL.md` retorna 0 dependentes e 0 dependências, enquanto uma busca textual encontra 22 arquivos e 44 linhas relacionadas a `autonomous-orchestrator`; além do próprio arquivo, 18 arquivos encontrados também são nós indexados. Três arquivos JSON relevantes nem sequer fazem parte do grafo. O risco de negócio é uma decisão de mudança baseada em blast radius incompleto e apresentada sem ressalva.

O domínio deve distinguir evidência observável de relação e inferência. Referência textual explícita, link ou caminho resolvível e delegação declarativa são sinais diferentes; acoplamento comportamental inferido tem menor certeza e não pode ser apresentado como dependência comprovada. Resultados precisam ser explicáveis, conter cobertura conhecida e falhar de forma segura quando o índice não sustentar uma conclusão de “impacto zero”.

## 1. Event Storming

| # | Domain Event (past tense) | Command (trigger) | Aggregate | External Systems | Read Models |
|---:|---|---|---|---|---|
| 1 | Escopo de Indexação Descoberto | Iniciar bootstrap ou rebuild do repositório | Escopo de Indexação | Sistema de arquivos do repositório | Inventário de Artefatos |
| 2 | Artefato Markdown Indexado | Registrar arquivo Markdown elegível | Artefato Indexado | — | Catálogo de Nós |
| 3 | Referência Textual Explícita Detectada | Analisar conteúdo textual por identificadores conhecidos | Evidência de Relacionamento | — | Evidências Detectadas |
| 4 | Link ou Caminho Detectado | Analisar destinos de links e caminhos citados | Evidência de Relacionamento | — | Evidências Detectadas |
| 5 | Delegação Declarativa Detectada | Interpretar declaração de skill, agente ou workflow invocado | Evidência de Relacionamento | — | Evidências Detectadas |
| 6 | Acoplamento Comportamental Sinalizado | Correlacionar regras, contratos e comportamento descrito | Hipótese de Acoplamento | — | Hipóteses Pendentes |
| 7 | Destino de Referência Resolvido | Resolver evidência contra artefatos indexados | Relacionamento Candidato | — | Referências Resolvidas |
| 8 | Destino de Referência Permanecido Não Resolvido | Registrar evidência cujo alvo está fora do índice ou é ambíguo | Relacionamento Candidato | — | Referências Não Resolvidas |
| 9 | Relacionamento Classificado | Atribuir tipo, direção, origem e nível de confiança | Relacionamento Publicável | — | Relacionamentos Explicáveis |
| 10 | Relacionamento Ambíguo Rejeitado | Aplicar política contra falso-positivo | Relacionamento Publicável | — | Rejeições de Relacionamento |
| 11 | Grafo de Relacionamentos Publicado | Concluir indexação consistente do snapshot | Publicação do Grafo | Armazenamento do tenant | Cobertura do Grafo |
| 12 | Consulta de Impacto Solicitada | Consultar dependentes e dependências de um nó | Análise de Impacto | Cliente MCP | Blast Radius Explicado |
| 13 | Cobertura Insuficiente Declarada | Avaliar capacidade do índice de sustentar a conclusão | Análise de Impacto | Cliente MCP | Diagnóstico de Cobertura |
| 14 | Impacto Transitivo Calculado | Percorrer somente relações elegíveis segundo a política | Análise de Impacto | — | Blast Radius Explicado |
| 15 | Evidência de Impacto Explicada | Expor origem, tipo, direção e confiança de cada resultado | Análise de Impacto | Cliente MCP | Trilha de Explicação |

## 2. Subdomain Classification

| Subdomain | Type | Justification |
|---|---|---|
| Descoberta de Relações Documentais | Core | Transformar sinais heterogêneos de Markdown em relações úteis e conservadoras diferencia a qualidade do blast radius. |
| Semântica e Confiança de Relacionamentos | Core | Distinguir relação comprovada de hipótese impede que falsos positivos e falsos negativos recebam a mesma autoridade. |
| Análise de Impacto Explicável | Core | O valor do produto depende de decisões de mudança auditáveis, não apenas de contagens de arestas. |
| Cobertura e Completude do Índice | Supporting | Informa quando “zero impacto” é uma conclusão válida e quando significa ausência de evidência indexada. |
| Resolução de Identidade de Artefatos | Supporting | Conecta nomes, caminhos, links e aliases aos nós corretos, habilitando os subdomínios centrais. |
| Inventário e Leitura de Arquivos | Generic | Descoberta de arquivos, parsing básico e acesso ao sistema de arquivos são capacidades de infraestrutura comuns. |
| Persistência e Transporte MCP | Generic | Armazenamento do tenant e exposição por protocolo são meios de entrega, não a diferenciação semântica. |

## 3. Ubiquitous Language Glossary

| Term | Definition | Notes |
|---|---|---|
| Artefato Indexado | Arquivo reconhecido como parte do conhecimento consultável de um repositório. | Não implica que seus relacionamentos tenham sido descobertos. |
| Nó Markdown | Artefato Markdown representado no grafo. | Inclui skills, documentação operacional, ADRs e outros documentos; não usar como sinônimo de “nó conectado”. |
| Evidência de Relacionamento | Trecho observável que sugere uma relação entre dois artefatos. | Deve preservar localização e natureza do sinal. |
| Referência Textual Explícita | Menção direta ao identificador, nome ou título de outro artefato. | Coincidência lexical isolada ou termo genérico não basta. |
| Link ou Caminho | Referência com destino expresso como link ou localização de arquivo. | Pode ser resolvida, quebrada, externa ou ambígua. |
| Delegação Declarativa | Declaração de que uma skill, agente ou workflow invoca ou atribui trabalho a outro componente. | É uma relação dirigida; não reduzir a mera coocorrência textual. |
| Acoplamento Comportamental | Dependência entre regras ou contratos cujo efeito conjunto pode mudar mesmo sem link estrutural direto. | Quando inferido, deve permanecer hipótese e nunca fato silencioso. |
| Relacionamento Comprovado | Relação sustentada por evidência resolvida que atende à política de publicação. | Exige tipo, direção, origem e explicação. |
| Hipótese de Acoplamento | Possível relação que requer validação adicional por não possuir evidência estrutural suficiente. | Não deve inflar automaticamente o blast radius confirmado. |
| Dependente | Artefato potencialmente afetado quando o nó consultado muda. | A direção deve ser explicada no resultado. |
| Dependência | Artefato do qual o nó consultado depende para cumprir seu contrato. | Não confundir com simples menção ou arquivo vizinho. |
| Blast Radius | Conjunto explicado de impactos diretos e transitivos de uma mudança. | Uma contagem zero só é conclusiva com cobertura suficiente. |
| Cobertura do Grafo | Medida de quanto do escopo e dos tipos de relação relevantes foi efetivamente analisado. | Não é sinônimo de quantidade total de nós ou arestas. |
| Impacto Desconhecido | Estado em que a evidência disponível não permite afirmar impacto nem ausência de impacto. | Preferível a um “zero” enganoso; princípio fail-closed. |
| Explicação de Impacto | Trilha que mostra por que um artefato entrou ou não no blast radius. | Deve permitir auditoria sem reexecutar busca manual. |

## 4. Socratic Questions

### Business Invariants and Consistency

1. Sob quais condições exatas `graph.impact` pode afirmar zero dependentes ou zero dependências, em vez de declarar impacto desconhecido por cobertura insuficiente?
2. Como garantir que a direção de uma delegação declarativa permaneça consistente entre a evidência original, a aresta publicada e o blast radius apresentado?
3. Se o mesmo par de artefatos tiver evidências conflitantes — por exemplo, um link explícito e uma inferência comportamental inversa — qual delas determina a classificação sem apagar o conflito?
4. Uma referência quebrada deve afetar a avaliação de cobertura do nó de origem mesmo quando nenhum destino indexado puder ser associado?

### Scalability and Performance

5. O que acontece com tempo, memória e tamanho do índice ao analisar de 100 a 1 milhão de arquivos Markdown com múltiplas menções repetidas ao mesmo identificador?
6. A resolução de referências provoca uma busca global por evidência ou por destino para cada arquivo, criando comportamento equivalente a N+1 durante bootstrap ou rebuild?
7. Como o blast radius transitivo se comporta diante de ciclos densos de documentação e qual limite impede explosão combinatória sem truncar silenciosamente impactos relevantes?
8. Resultados e evidências são paginados de forma estável quando milhares de artefatos referenciam a mesma skill?

### Security and Sensitive Data

9. Conteúdo Markdown controlado por terceiros pode fabricar links, caminhos ou declarações de delegação que contaminem o grafo e induzam decisões de mudança incorretas?
10. As explicações de impacto podem expor caminhos absolutos, segredos, dados pessoais ou trechos sensíveis presentes nos documentos do repositório?
11. A autorização por tenant é aplicada também aos destinos resolvidos e às evidências, impedindo que uma referência atravesse limites de repositório ou tenant?

### Concurrency and Failures

12. O que uma consulta observa quando ocorre simultaneamente a um rebuild: o snapshot anterior íntegro, o novo snapshot íntegro ou uma mistura parcial de nós e relacionamentos?
13. Se a leitura de alguns documentos falhar por encoding, permissão, timeout ou arquivo mutável, como essa falha altera a cobertura declarada e a validade de uma resposta 0/0?
14. Repetições de bootstrap produzem exatamente as mesmas relações, classificações e explicações quando a entrada não mudou?
15. Como referências não resolvidas são reconciliadas quando o destino aparece depois, sem duplicar arestas ou perder a evidência original?

### Responsibility Boundaries Between Layers

16. Qual camada é autoridade para classificar uma evidência como referência, delegação ou hipótese, e como impedir que adapters MCP reinterpretem essa semântica?
17. A política de confiança pertence à descoberta, à publicação do grafo ou à consulta de impacto, e como evitar decisões divergentes entre essas etapas?
18. Como a interface de impacto distingue relações de código, relações documentais confirmadas e hipóteses sem depender de convenções ocultas em campos livres?
19. Quem é responsável por declarar que formatos ausentes do índice — como os três JSON observados — tornam o blast radius incompleto?
20. Qual contrato de resposta substitui o atual 0/0 para tornar impossível confundir “nenhuma relação” com “nenhuma relação descoberta”?

**Architecture Tip:** Modele evidência, relacionamento publicado e resultado de impacto como conceitos separados, mantendo proveniência e cobertura como parte do contrato observável. Trate ausência de evidência como estado explícito, não como prova automática de ausência de impacto.

## 5. Respostas auditadas às questões socráticas

Esta revisão confronta as respostas propostas com o comportamento atual. `Comprovado` descreve apenas o sistema existente; `Decisão proposta` pertence ao novo escopo; `Aberto` exige benchmark, política de produto ou validação que o repositório ainda não oferece.

| # | Resposta auditada | Status |
|---:|---|---|
| 1 | O contrato atual não consegue provar impacto zero para Markdown: nó conhecido sempre recebe `gaps: []`, mesmo sem cobertura relacional. O novo contrato deve distinguir `known-zero`, `known-nonzero` e `unknown`. | Decisão proposta |
| 2 | A direção existente de `depends-on` está comprovada (`from` depende de `to`), mas aplicar essa direção a uma Delegação Declarativa ainda requer uma gramática e política novas; não é fato já implementado. | Decisão proposta |
| 3 | Evidências conflitantes devem ser preservadas. Uma relação estrutural confirmada pode ser transitável; a inferência inversa permanece hipótese e não sobrescreve a evidência. | Decisão proposta |
| 4 | Referência quebrada, ambígua ou não analisada reduz cobertura, mas não cria dependência. Um zero nessa direção passa a `unknown`. | Decisão proposta |
| 5 | Não existe evidência para um SLO próximo de um milhão de documentos. O desenho deve prever agregação por par/tipo, amostras limitadas de localização, lotes e benchmark antes de fixar limites. | Aberto |
| 6 | A resolução atual de imports usa `Set` e não apresenta N+1. O novo resolvedor deve manter uma tabela única de identidades/aliases e proibir busca global por menção. | Comprovado + decisão proposta |
| 7 | Ciclos já são contidos por `seen` e profundidade máxima cinco. Relações documentais densas ainda exigem orçamento explícito e truncamento nomeado sem falsificar totais. | Comprovado + decisão proposta |
| 8 | A paginação atual é keyset, mas permite continuar sobre um grafo republicado sem identificar a troca. Como breaking changes são permitidas, o novo cursor deve ser vinculado ao `graphId` e rejeitado explicitamente quando o snapshot mudar. | Decisão aprovada |
| 9 | Conteúdo Markdown é hoje enviado ao extrator genérico; exemplos ou blocos contendo imports relativos podem fabricar arestas para arquivos de código. O novo extrator deve ser específico por formato, confinado à raiz e conservador. | Comprovado + decisão proposta |
| 10 | `graph.impact` hoje expõe somente caminho relativo e profundidade. Explicações novas devem evitar texto bruto por padrão e limitar/redigir qualquer amostra. | Comprovado + decisão proposta |
| 11 | Nós e arestas são isolados por tenant e a resolução atual fica no mesmo repositório. Token ausente cair no tenant default é comportamento intencional atual; exigir autenticação para evidências detalhadas permanece decisão aberta. | Comprovado + aberto |
| 12 | No processo único, persistência transacional seguida da troca do grafo quente tende a expor snapshot antigo ou novo, não mistura. Não há garantia demonstrada para múltiplos processos; respostas futuras devem identificar o `graphId` observado. | Comprovado + aberto |
| 13 | Falhas de listagem e leitura são ignoradas silenciosamente hoje. O Coverage Manifest deve contar descobertos, elegíveis, lidos, analisados e falhos, com motivo; falha relevante torna zero `unknown`. | Comprovado + decisão proposta |
| 14 | Ordenação, deduplicação e checksum tornam o grafo atual determinístico para entrada idêntica. Evidências futuras precisam de identidade canônica e ordenação próprias, sem timestamp no hash de identidade. | Comprovado + decisão proposta |
| 15 | Referências não resolvidas são descartadas hoje. Elas devem ganhar identidade determinística e estado `unresolved`, `resolved` ou `ambiguous`, reconciliado a cada snapshot sem duplicar a relação agregada. | Comprovado + decisão proposta |
| 16 | A autoridade ainda está dividida: extração/indexação ocorre no MCP server e montagem estrutural no graph-core. Centralizar a classificação semântica no graph-core é recomendação arquitetural, não estado comprovado. | Decisão proposta |
| 17 | Não existe confiança por aresta. Extração deve registrar sinais; uma política versionada deve decidir publicação; impacto deve percorrer o publicado sem reclassificar. | Comprovado + decisão proposta |
| 18 | O contrato atual só distingue `depends-on` e `survey`. Ele pode ser substituído por um schema tipado de relações e evidências; hipóteses permanecem fora da travessia confirmada. | Comprovado + decisão aprovada |
| 19 | A allowlist atual exclui JSON, inclusive catálogos relevantes. O inventário deve declarar formatos cobertos/excluídos e habilitar somente famílias JSON configuradas, evitando lockfiles e fixtures indiscriminados. | Comprovado + decisão proposta |
| 20 | A resposta atual não precisa ser preservada. O novo contrato deve exigir `impactKnowledge`, `coverage`, `warnings`, `graphId` e relações explicáveis; omitir esses campos torna a resposta inválida, impedindo o antigo 0/0 ambíguo. | Decisão aprovada |

### Correções da auditoria

1. Delegação Declarativa documental não recebeu status de fato comprovado: somente a direção das arestas de código existentes está provada.
2. A classificação não pertence hoje exclusivamente ao `graph-core`; movê-la para lá é uma decisão de desenho.
3. Após confirmação de que não existem clientes atuais, a continuidade cross-rebuild deixou de ser restrição: o novo cursor será vinculado ao `graphId` e falhará explicitamente quando obsoleto.
4. Blocos de código Markdown que parecem imports foram registrados como um risco atual adicional: o extrator genérico pode interpretá-los como dependências de código.

### Invariantes aprovadas para o desenho tático

- Nenhuma menção isolada ou termo genérico vira `depends-on`.
- Hipótese de Acoplamento nunca entra silenciosamente no Blast Radius confirmado.
- Todo relacionamento publicado preserva tipo, direção, proveniência e Evidence Grade.
- Zero impacto só é conclusivo com cobertura suficiente na direção consultada.
- Falha, exclusão de formato e referência não resolvida permanecem observáveis.
- Breaking changes são permitidas: o contrato MCP e o schema persistido devem privilegiar correção, completude e impossibilidade de 0/0 ambíguo.
