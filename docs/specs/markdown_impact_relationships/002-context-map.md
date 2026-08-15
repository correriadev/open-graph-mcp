# Context Map — Relações de Impacto em Markdown

## 1. Bounded Context Identification

| Bounded Context | Responsibility | Boundary (excluded) | Team Ownership | Key Entities |
|---|---|---|---|---|
| Target Repository | Fornecer o conjunto versionado de arquivos e seus conteúdos como fonte externa de observação. | Não interpreta evidências, não classifica relacionamentos e não conhece a semântica do grafo. | Equipe proprietária do repositório analisado | Repository Snapshot, Source Artifact |
| Artifact Inventory | Descobrir Artefatos Indexados, atribuir identidade canônica e registrar cobertura e falhas de leitura por formato. | Não extrai referências do conteúdo e não infere dependências. | Plataforma OpenGraph — Indexing | Indexing Scope, Indexed Artifact, Artifact Identity, Inventory Coverage |
| Evidence Extraction | Detectar e preservar Evidências de Relacionamento observáveis em código e Markdown, com origem e localização. | Não decide que toda menção é um Relacionamento Comprovado nem calcula impacto. | Plataforma OpenGraph — Extraction | Evidence Record, Explicit Textual Reference, Link or Path, Declarative Delegation, Behavioral Coupling Hypothesis |
| Relationship Classification | Resolver destinos e classificar tipo, direção e grau da evidência segundo uma política conservadora. | Não publica snapshots, não percorre o grafo e não promove Hipótese de Acoplamento a dependência silenciosamente. | Domínio OpenGraph — Relationship Semantics | Relationship Candidate, Resolved Reference, Unresolved Reference, Proven Relationship, Coupling Hypothesis, Evidence Grade |
| Graph Publication | Publicar atomicamente nós, relacionamentos explicáveis, proveniência e Cobertura do Grafo para um tenant. | Não reclassifica evidências nem calcula Blast Radius. | Plataforma OpenGraph — Graph Storage | Graph Snapshot, Published Relationship, Provenance, Coverage Manifest |
| Impact Traversal | Avaliar cobertura e calcular Blast Radius direto e transitivo usando apenas relacionamentos elegíveis, expondo a Explicação de Impacto. | Não extrai conteúdo, não inventa arestas ausentes e não converte ausência de evidência em impacto zero. | Domínio OpenGraph — Impact Analysis | Impact Analysis, Dependent, Dependency, Explained Blast Radius, Unknown Impact |

### Evidence Grades

| Grade | Evidence admitted | Semantic authority | Impact behavior |
|---|---|---|---|
| A — explicit structural | Import resolvido, link/caminho resolvido ou Delegação Declarativa com alvo e direção inequívocos | Pode sustentar um Relacionamento Comprovado do tipo correspondente | Elegível para travessia quando a política do tipo de relacionamento assim definir |
| B — explicit symbolic | Referência Textual Explícita a identificador único, resolvida contra a identidade de um Artefato Indexado e acompanhada da localização | Sustenta uma referência explicável, mas não equivale automaticamente a `depends-on` | Só entra no Blast Radius quando a política declarar que aquele tipo representa impacto |
| C — behavioral hypothesis | Correlação entre regras, contratos ou comportamento sem vínculo estrutural inequívoco | Permanece Hipótese de Acoplamento; exige validação adicional | Nunca infla o Blast Radius confirmado; pode ser apresentada separadamente como possível impacto |
| Rejected/ambiguous | Termo genérico, coocorrência, alvo múltiplo, trecho não resolvível ou sinal abaixo do limiar | Nenhuma relação publicada; a rejeição permanece auditável | Não é atravessada e pode reduzir a cobertura declarada |

O grau descreve a força da evidência, enquanto o tipo descreve a semântica da relação. Assim, nem toda menção vira `depends-on`, e uma relação `references` ou `delegates-to` não herda silenciosamente a direção de dependência de um import de código.

## 2. Context Map

### Target Repository → Artifact Inventory

Pattern   : Anti-Corruption Layer (ACL)  
Direction : upstream / downstream  
Justification: o inventário traduz caminhos, formatos, encoding e falhas mutáveis do repositório para identidades e cobertura estáveis sem contaminar o domínio com detalhes do sistema de arquivos.

### Artifact Inventory → Evidence Extraction

Pattern   : Open Host Service  
Direction : upstream / downstream  
Justification: o inventário fornece a múltiplos extratores um catálogo estável de artefatos elegíveis, identidades canônicas e conteúdo disponível.

### Artifact Inventory ↔ Relationship Classification

Pattern   : Published Language  
Direction : bidirectional  
Justification: resolução e reconciliação dependem de um contrato compartilhado de identidade, aliases, escopo e estado resolvido/não resolvido, sem compartilhar regras internas dos contextos.

### Evidence Extraction → Relationship Classification

Pattern   : Customer-Supplier  
Direction : upstream / downstream  
Justification: a classificação exige que o extrator preserve sinal, localização, sintaxe e candidato a alvo, mas decide de forma autônoma tipo, direção e Evidence Grade.

### Relationship Classification → Graph Publication

Pattern   : Published Language  
Direction : upstream / downstream  
Justification: somente o esquema versionado de Relacionamento Comprovado, Hipótese de Acoplamento, proveniência e rejeição pode atravessar a fronteira de publicação.

### Artifact Inventory → Graph Publication

Pattern   : Customer-Supplier  
Direction : upstream / downstream  
Justification: a publicação precisa do escopo efetivamente lido e de suas falhas para produzir o Coverage Manifest junto ao mesmo snapshot dos relacionamentos.

### Graph Publication → Impact Traversal

Pattern   : Open Host Service  
Direction : upstream / downstream  
Justification: o snapshot publicado é a autoridade estável para consultas, oferecendo relacionamentos tipados, proveniência e cobertura sem expor detalhes de armazenamento.

### Relationship Classification ↔ Impact Traversal

Pattern   : Published Language  
Direction : bidirectional  
Justification: ambos compartilham a política versionada que define quais tipos e graus são elegíveis à travessia; a consulta não reinterpreta menções como dependências.

## 3. Core Domain Highlight

Context : Evidence Extraction  
Reason  : materializa a Descoberta de Relações Documentais, distinguindo sinais heterogêneos de Markdown de coincidências lexicais genéricas.  
Investment: parsers extensíveis por evidência, corpus de falsos positivos e negativos, proveniência precisa e testes de escala e conteúdo hostil.

Context : Relationship Classification  
Reason  : materializa a Semântica e Confiança de Relacionamentos, separando Relacionamento Comprovado de Hipótese de Acoplamento e preservando direção.  
Investment: modelo tático explícito, invariantes de promoção/rejeição, política versionada de Evidence Grades e testes de propriedades para determinismo e reconciliação.

Context : Impact Traversal  
Reason  : materializa a Análise de Impacto Explicável, diferenciando ausência comprovada de impacto de Impacto Desconhecido por cobertura insuficiente.  
Investment: regras formais de elegibilidade e cobertura, explicações auditáveis e limites determinísticos para ciclos e paginação vinculada ao snapshot.

## 4. Architectural Decisions

Decision    : Separar Artefato Indexado, Evidência de Relacionamento, relacionamento publicado e resultado de impacto em modelos e fronteiras distintos.  
Context     : a presença de um nó Markdown hoje é confundida com cobertura suficiente para concluir 0/0.  
Consequences: permite diagnosticar onde a informação se perdeu e evita autoridade indevida; adiciona contratos intermediários e metadados de proveniência.

Decision    : Publicar tipos e Evidence Grades explícitos; `depends-on` deixa de ser o recipiente genérico de toda menção documental.  
Context     : links, caminhos, delegações e referências textuais têm semânticas e direções diferentes.  
Consequences: reduz falsos positivos e torna a travessia configurável e explicável; permite substituir o schema atual por um contrato mais rigoroso, pois não existem clientes atuais a preservar.

Decision    : Manter Acoplamento Comportamental como Hipótese de Acoplamento fora do Blast Radius confirmado.  
Context     : contratos podem estar acoplados sem vínculo estrutural, mas a inferência automática não possui autoridade para afirmar dependência.  
Consequences: preserva sinais úteis sem fabricar certeza; o usuário pode precisar revisar possíveis impactos separadamente.

Decision    : Acoplar Coverage Manifest e relacionamentos no mesmo Graph Snapshot atômico.  
Context     : falhas de leitura, formatos não inventariados e rebuild concorrente invalidam uma conclusão de impacto zero se a cobertura vier de outro instante.  
Consequences: `graph.impact` pode retornar Impacto Desconhecido de forma fail-closed e determinística; snapshots e respostas ficam maiores.

Decision    : Fazer Impact Traversal consumir uma política versionada de elegibilidade, sem reclassificar evidência no adapter MCP.  
Context     : classificação divergente entre indexação e consulta destruiria a consistência da direção e da confiança.  
Consequences: centraliza invariantes e preserva adapters finos; mudanças de política exigem identificação da versão e rebuild, sem obrigação de manter o schema anterior.

Decision    : Aceitar breaking changes no contrato MCP, no schema persistido e na semântica de paginação deste domínio.  
Context     : não existem clientes atuais; preservar o 0/0 ambíguo ou a continuidade de cursor entre snapshots manteria defeitos conhecidos sem benefício de compatibilidade.  
Consequences: o novo contrato pode exigir cobertura, conhecimento de impacto, proveniência e `graphId`, além de rejeitar cursor obsoleto; fixtures e testes internos deverão migrar atomicamente.
