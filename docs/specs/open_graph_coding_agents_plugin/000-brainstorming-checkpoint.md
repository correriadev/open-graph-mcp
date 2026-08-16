# Checkpoint de brainstorming — plugin OpenGraph para coding agents

> **Histórico e supersedido:** este checkpoint preserva o estado da conversa em 2026-08-15, mas não orienta implementação. As decisões vigentes estão em `001`–`005`, e a ordem normativa está em `005-implementation-handoff.md`.

**Estado:** rascunho de descoberta, não aprovado para implementação  
**Data:** 2026-08-15  
**Objetivo deste arquivo:** permitir retomar o refinamento em outra sessão sem reconstruir o contexto desta conversa.

## 1. Estado do processo

Esta feature foi classificada como **arquitetural** pela skill `brainstorming`, pois introduz uma nova superfície de distribuição e um protocolo operacional para múltiplos coding agents.

O processo foi interrompido durante a descoberta e antes da comparação formal de abordagens. Ainda faltam:

1. concluir as decisões de escopo abertas;
2. propor duas ou três arquiteturas com trade-offs;
3. apresentar o design em seções e obter aprovação humana;
4. registrar a especificação definitiva;
5. somente depois produzir o plano de implementação.

**Gate vigente:** este documento não autoriza implementação, scaffold, alteração do plugin atual nem invocação de um workflow de desenvolvimento.

## 2. Intenção da feature

Criar um plugin para que coding agents saibam operar corretamente com o OpenGraph. O produto deve ser mais robusto que a skill existente `packages/claude-plugin/skills/using-open-graph/SKILL.md` e tomar o Harness Kit como referência de organização operacional.

A skill existente é somente uma evidência do workflow atual. Ela **não é a base arquitetural** do novo produto.

O plugin pretendido é um harness operacional portátil, composto por skills e agents que ensinam e executam os papéis do OpenGraph sem depender das capacidades avançadas de um host específico.

## 3. Fontes normativas e referências

### OpenGraph

- `docs/PRD/PRD.md` — requisitos de produto. O documento declara o Working Paper como fonte de verdade.
- `docs/PRD/OpenGraph_Working_Paper_v1_0.md` — fonte normativa para horizontes, arquétipos, contratos, statechart e invariantes.
- `docs/adr/ADR.md` — decisões arquiteturais derivadas do paper.
- `instructions.local.md` — runbook atual de setup e operação local; útil como inventário, não como contrato definitivo do plugin.
- `packages/claude-plugin/` — integração Claude Code atual, com MCP, hooks, comandos e uma skill. É precedente técnico, mas não deve limitar a nova arquitetura.

Trechos especialmente relevantes do PRD/paper:

- agentes são clientes L0/L1; nenhum agente hospeda gate;
- Maître opera na sessão;
- Guardião opera na negociação e lê o persistente;
- Intermediador opera na transformação;
- Executor/Técnico opera na microtask;
- Router é control plane determinístico e não-agente;
- `CHANGE_READY` é recomendado pelo Guardião, mas verificado mecanicamente pelo Router;
- o loop Intermediador–Executor usa `AuditAssessment` e `AuditDecision`;
- promoção ao persistente atravessa o gate normal, sem fast-path para conteúdo pré-auditado.

### Harness Kit

Referência consultada: `C:\Users\User\Documents\harness-kit`.

Superfícies relevantes:

- `plugin.json` registra diretórios de agents e skills;
- `skills/` contém procedimentos especializados;
- `agents/` contém personas isoladas;
- `docs/workflow/` separa fundamento, playbook diário e orquestração;
- a robustez vem da combinação de contratos, papéis, workflow, estado persistente e validação, não de uma única skill extensa.

O Harness Kit é referência de **estrutura e robustez**, não de semântica. Os papéis e horizontes do OpenGraph permanecem definidos pelo PRD e pelo Working Paper.

## 4. Decisões já confirmadas pelo usuário

### 4.1 Plataformas

A primeira versão deve mirar:

- Claude Code;
- Codex CLI;
- Gemini CLI.

O núcleo será agnóstico ao coding agent, com empacotamento ou metadados mínimos por host quando necessários.

### 4.2 Superfícies permitidas

A v1 deve usar somente:

- skills;
- agents.

Ficam fora da versão inicial:

- hooks;
- statusline;
- comandos proprietários do host;
- interceptação automática de ferramentas;
- features avançadas específicas de Claude, Codex ou Gemini;
- dependência de uma camada viva para correção do fluxo.

O MCP continua sendo a integração técnica com o OpenGraph.

### 4.3 Contrato alvo

O plugin deve nascer para o contrato novo, com breaking changes permitidas. Não há clientes atuais a preservar e não deve existir camada de compatibilidade com o contrato antigo.

O fluxo deve respeitar:

- Graph v2;
- horizontes governados;
- escopo identificado por tenant, horizonte e grafo;
- cobertura e impacto distinguindo `known-zero`, `known-nonzero` e `unknown`;
- contratos tipados nas fronteiras;
- gates hospedados pelo OpenGraph, nunca pelos agentes.

### 4.4 Doctor separado

Setup e diagnóstico não pertencem à skill operacional principal.

Deve existir uma skill `doctor` apartada do loop normal. Quando a skill principal detectar objetivamente uma falha de prontidão, ela delegará automaticamente ao doctor e tentará retomar depois da correção.

Responsabilidades do doctor:

- detectar o coding agent atual;
- verificar servidor, stdio proxy e MCP;
- orientar ou executar a configuração compatível com o host;
- registrar ou recuperar identidade;
- detectar credencial incompatível;
- confirmar tenant e repositório-alvo;
- executar bootstrap somente se o tenant realmente não possuir grafo;
- validar Graph v2 e o escopo operacional;
- validar declarações do adapter, inclusive classificação das tools quando aplicável;
- devolver um relatório de prontidão.

Se a correção exigir reiniciar o coding agent, a v1 pode instruir o usuário a reiniciar e invocar novamente o workflow. Retomada automática através de restart está fora do escopo simples inicial.

### 4.5 Changeset obrigatório

Todo arquivo mapeado pelo grafo exige changeset antes da primeira edição, independentemente de presença concorrente.

Presença e locks determinam negociação e serialização; não determinam se haverá auditoria.

O escopo deve ser ampliado antes de editar uma nova célula. Nenhum Executor pode crescer o escopo silenciosamente.

### 4.6 Responsabilidades corrigidas dos arquétipos

O fluxo deve usar quatro arquétipos de agente:

- Maître;
- Guardião;
- Intermediador;
- Executor.

O entendimento corrigido pelo usuário é:

- o **Guardião** valida semanticamente o plano na pré-implementação;
- o **Intermediador** não valida o plano inicial — ele atua durante a implementação com um grafo próprio;
- o **Maître** chega ao despacho do Intermediador com o plano completo, incluindo nós, células e execução;
- o **Maître** abre o changeset;
- o **Maître** despacha o Executor;
- o Intermediador corresponde, na visão do Harness Kit, à combinação de Tech Lead e Adversarial QA.

## 5. Arquitetura cognitiva que o plugin deve respeitar

### 5.1 Separação entre agentes, Router e hosts

| Elemento | Natureza | Pode julgar semanticamente? | Pode aplicar transição/gate? |
|---|---|---:|---:|
| Maître | agente cliente L0/L1 | sim | não |
| Guardião | agente cliente L0/L1 | sim | não |
| Intermediador | agente cliente L0/L1 | sim | não |
| Executor | agente cliente L0/L1 | sim, dentro da execução | não |
| Router | control plane determinístico | não | aplica transições do workflow |
| Host do horizonte | autoridade epistemológica | não decide mérito por identidade | admite, recusa, propaga e registra |

Nenhuma skill deve ensinar que um arquétipo “aprova” autoritativamente uma mudança. Agentes produzem propostas, análises e recomendações; hosts e Router aplicam consequências governadas.

### 5.2 Horizontes

| Horizonte | Arquétipo principal | Função |
|---|---|---|
| Sessão | Maître | continuidade, intenção, contexto e coordenação |
| Negociação | Guardião | deliberação, hipóteses, riscos, assumptions e contrato |
| Transformação | Intermediador | governo cognitivo da implementação e auditoria das propostas |
| Microtask | Executor | concretização, testes e produção de evidências |
| Persistente | nenhum agente proprietário | conhecimento durável admitido pelo gate |

A sessão não é pai de promoção da negociação. Ela inicia a negociação por `NegotiationSeed`.

As fronteiras principais são:

```text
sessão          -- INITIATE(NegotiationSeed) --> negociação
negociação      -- ChangeContract -----------> transformação
transformação   -- INITIATE(WorkOrder) ------> microtask
microtask       -- PromotionProposal --------> transformação
transformação   -- PersistentDelta ----------> persistente
```

Iniciação carrega contexto sem autoridade. Promoção carrega uma proposta que será reavaliada no horizonte alvo. `CONTEST` carrega evidência e não equivale a edição direta.

## 6. Fluxo consolidado até este checkpoint

### 6.1 Entrada e prontidão

1. O usuário inicia o coding agent no repositório-alvo.
2. O workflow faz uma sondagem leve de MCP, sessão, tenant, Graph v2 e escopo.
3. Se houver falha objetiva, delega ao doctor.
4. O doctor corrige ou informa a ação necessária.
5. O workflow só avança após nova sondagem saudável.

O doctor fica fora do caminho normal quando o ambiente está pronto.

### 6.2 Sessão e investigação barata

1. O Maître registra a intenção do operador.
2. O Guardião consulta o persistente sem instanciar transformação ou microtasks.
3. São levantados candidatos, nós, células, dependências, dependentes, cobertura, autoridade, locks e estado de `seq`.
4. Impacto desconhecido permanece `unknown`; ausência de arestas não pode ser apresentada como zero seguro sem cobertura suficiente.

O caminho de consulta deve continuar barato:

```text
Operador -> Maître -> Guardião -> Maître -> Operador
```

### 6.3 Negociação e plano

O Maître e o Guardião convergem sobre um plano completo antes da implementação.

O Guardião registra resultados de deliberação como:

- `SUPPORTED`;
- `UNKNOWN`;
- `AMBIGUOUS`;
- `INFERRED`;
- `CONFLICTING`.

Regras:

- `INFERRED` não pode virar resolvido sem se tornar assumption declarada;
- toda assumption possui dono e consequência;
- unresolved permanece explícito ou recebe `OperatorApproval` escopada;
- conflito não desaparece por edição silenciosa;
- o plano referencia o `based_on_seq` usado na análise.

O plano entregue pelo Maître deve incluir pelo menos:

- intenção e critérios de sucesso;
- nós, arquivos e células afetados;
- análise de impacto e cobertura;
- dependências e riscos;
- assumptions e unresolved;
- passos de execução;
- WorkOrders previstos;
- testes e gates;
- tools necessárias e classes de efeito;
- ações irreversíveis autorizadas;
- rollback;
- `changeset_plan`.

Esse conteúdo deve ser representado no `ChangeContract` ou em artefato tipado referenciado por ele. A forma exata ainda não foi decidida.

### 6.4 Validação pré-implementação

O Guardião recomenda prontidão. Ele não muda o workflow.

O Router verifica mecanicamente o predicado de `CHANGE_READY`:

1. `unresolved[]` está vazio, ou cada residual possui `OperatorApproval` válida;
2. `based_on_seq` está corrente, ou a defasagem foi aceita para iniciar/concretizar;
3. toda assumption tem dono e consequência.

Aceitar defasagem não autoriza promoção final sob base stale. A promoção ao persistente continuará exigindo rebase ou revalidação.

### 6.5 Preparação da implementação pelo Maître

Após `CHANGE_READY`, o Maître:

1. submete o `ChangeContract`;
2. solicita a instanciação do horizonte de transformação e do Intermediador;
3. abre o changeset obrigatório para as células planejadas;
4. conserva o `csId` durante o ciclo;
5. entrega ao Intermediador o contrato e o plano integral;
6. despacha o Executor com o WorkOrder correspondente.

O despacho coordenado pelo Maître deve continuar sendo registrado pelo host como iniciação tipada da fronteira transformação para microtask. O Maître não ganha autoridade para escrever diretamente no grafo da transformação.

### 6.6 Implementação pelo Executor

O Executor recebe:

- WorkOrder;
- `csId` já aberto;
- arquivos e células autorizados;
- plano e critérios de aceite;
- assumptions e restrições;
- testes exigidos;
- ferramentas permitidas;
- budget;
- rollback.

Ele implementa dentro do escopo, executa testes, registra evidências e produz:

- `ArtifactBundle`;
- `PromotionProposal` da microtask para a transformação;
- `excluded_summary` com tentativas, erros e caminhos abandonados.

Descoberta fora do contrato não permite ampliação silenciosa. Ela gera contestação ou escalonamento.

### 6.7 Auditoria pelo Intermediador

O Intermediador trabalha em seu próprio grafo de transformação. Ele não implementa e não abre o changeset.

Sua função agrega Tech Lead e Adversarial QA:

- confrontar a execução com o ChangeContract;
- revisar arquitetura e impacto sistêmico;
- revisar diff, testes e evidências;
- testar riscos e casos adversariais;
- verificar assumptions e consequências;
- produzir `AuditAssessment` com julgamento e razões.

O host da transformação processa o assessment e emite `AuditDecision`:

```text
Executor -> ArtifactBundle + PromotionProposal
Intermediador -> AuditAssessment
Host médio -> AuditDecision(accepted | revise | escalate)
```

- `accepted`: admite a proposta somente no horizonte de transformação;
- `revise`: recusa com razões e retorna ao Executor se tentativa e budget permitirem;
- `escalate`: transfere a decisão ao fluxo tipado de escalonamento.

Aceito no médio não significa admitido no persistente.

### 6.8 Promoção e encerramento

Quando todas as WorkOrders estiverem aceitas no médio:

1. a transformação forma o `PersistentDelta`;
2. o delta inclui changeset, claims candidatas, cobertura e rollback;
3. o gate persistente reavalia tudo do zero, cego à identidade dos agentes;
4. não existe fast-path para conteúdo auditado pelo Intermediador;
5. se admitido, o Maître conclui o changeset;
6. o `seq` avança;
7. os horizontes efêmeros são encerrados com audit e `excluded_summary`;
8. entradas de sessão baseadas em `seq` antigo são marcadas stale.

Recusa do gate, `STALE_BASE`, contestação invalidante ou exaustão não podem virar promoção. O workflow escala ou aborta conforme o statechart. Aborto preserva audit e libera locks.

## 7. Estrutura preliminar do plugin

Esta estrutura é apenas hipótese de trabalho; ainda não foi comparada nem aprovada:

```text
plugin/
  agents/
    open-graph-maitre.md
    open-graph-guardian.md
    open-graph-intermediary.md
    open-graph-executor.md
    open-graph-doctor.md
  skills/
    open-graph-workflow/SKILL.md
    open-graph-doctor/SKILL.md
    open-graph-negotiation/SKILL.md
    open-graph-implementation-audit/SKILL.md
    open-graph-execution/SKILL.md
```

O desenho final pode reduzir o número de skills para evitar duplicação entre persona e procedimento. Essa decisão ainda não foi tomada.

## 8. Invariantes do futuro design

1. Nenhum agente hospeda gate.
2. Nenhum julgamento de LLM aplica sozinho uma transição de autoridade.
3. O Guardião recomenda `CHANGE_READY`; o Router verifica.
4. O Maître possui a coordenação e o changeset, não a verdade persistente.
5. O Intermediador governa cognitivamente a transformação, não epistemicamente.
6. O Executor só concretiza dentro de WorkOrder, budget e changeset.
7. Todo contrato entre horizontes é estruturado.
8. Toda edição mapeada exige changeset.
9. Um horizonte não edita diretamente o grafo de outro.
10. Promoção atravessa apenas a fronteira topológica permitida.
11. Aceitação no médio não implica admissão no persistente.
12. O gate persistente é cego ao chamador.
13. Exaustão nunca promove.
14. Conteúdo stale não promove sem rebase ou revalidação.
15. Recusas precisam de códigos e obrigações de cliente.
16. Correção de conflito ocorre por contestação, não por edição silenciosa.
17. Memória reutilizada pertence a um OpenGraph governado; scratch não pode influenciar decisões posteriores.
18. Correção do fluxo deve ser verificável por log do host, não por autorrelato do agente.

## 9. Pontos ainda abertos

### Próxima pergunta pendente

Definir a cardinalidade de execução na primeira versão:

- exatamente um Executor por changeset; ou
- múltiplos Executors/WorkOrders, possivelmente paralelos.

A recomendação preliminar apresentada foi **um Executor por changeset** para reduzir ambiguidade de identidade, locks e responsabilidade na primeira versão. O usuário ainda não respondeu.

### Outras decisões a refinar

1. Se o plano completo vive diretamente no `ChangeContract` ou em `ExecutionPlan` tipado referenciado pelo contrato.
2. Quais skills são públicas e quais são dependências internas de outra skill.
3. Como cada host descobre e invoca os agents sem recursos proprietários avançados.
4. Qual é o formato mínimo comum de manifesto para Claude, Codex e Gemini.
5. Como o Maître passa o `csId` ao Executor sem transferir autoridade indevida.
6. Quem executa tecnicamente `changeset.commit`: Maître diretamente ou host/Router em nome do workflow após admissão.
7. Como uma revisão `revise` preserva ou renova locks e budget.
8. Quando uma descoberta do Executor permanece dentro do contrato e quando exige reabrir negociação.
9. Como representar a combinação Tech Lead + Adversarial QA dentro de um único Intermediador sem perder independência adversarial.
10. Quais relatórios mínimos ficam persistidos no repositório-alvo.
11. Como provar conformidade por logs em três flavors sem hooks.
12. Como conciliar a simplicidade da v1 com os contratos completos do EAP.

## 10. Insight posterior — conversa obrigatória entre Maître e Guardião

### 10.1 Decisão arquitetural preliminar

Deve sempre existir uma deliberação Maître–Guardião antes de iniciar uma mudança.

Essa conversa deve ocorrer entre agents do coding agent. O MCP não deve possuir uma LLM própria para desempenhar o Guardião.

```text
Coding agent
┌──────────────────────────────────────────────┐
│ Conversa principal: Maître                  │
│       │                                      │
│       ├─ invoca → Guardião isolado           │
│       │             │                        │
│       │             └─ devolve análise       │
│       │                                      │
│       └─ apresenta decisões ao operador      │
└──────────────────────┬───────────────────────┘
                       │ contratos e tools MCP
                       ▼
OpenGraph MCP
┌──────────────────────────────────────────────┐
│ Session Host                                 │
│ Negotiation Horizon Host                    │
│ Router determinístico                       │
│ Persistência, logs, recusas e gates          │
└──────────────────────────────────────────────┘
```

O Maître é a instância principal iniciada pelo usuário. O Guardião é invocado por ele como agent especializado e, preferencialmente, isolado em outro contexto.

O Maître permanece responsável por:

- conversa com o operador;
- intenção;
- coordenação;
- consolidação do plano;
- decisões que exigem soberania humana;
- abertura e encerramento do changeset;
- despacho posterior do Intermediador e do Executor.

O Guardião permanece responsável por:

- consulta e leitura do persistente;
- análise de impacto e cobertura;
- classificação de evidências;
- exposição de conflitos, ambiguidades e lacunas;
- transformação de inferências necessárias em assumptions explícitas;
- manutenção de `unresolved[]`;
- recomendação de `CHANGE_READY`.

O Guardião não aplica `CHANGE_READY`. O Router verifica o predicado determinístico e aplica ou recusa a transição.

### 10.2 Forma da conversa

A conversa não deve ser um canal de texto livre sem registro. Ela é um ciclo coordenado pelo Maître:

1. Maître registra a intenção e cria o `NegotiationSeed`.
2. Maître obtém do MCP um snapshot persistente identificado por `seq`.
3. Maître invoca o Guardião com intenção, referências e escopo.
4. Guardião consulta o OpenGraph e produz análise estruturada.
5. Guardião devolve evidências, conflitos, ambiguidades, inferências, assumptions, unresolved, impacto, cobertura e recomendação.
6. Maître incorpora o resultado ao horizonte de negociação.
7. Quando houver decisão soberana, Maître consulta o operador.
8. Maître registra a decisão e a devolve ao ciclo de negociação.
9. Guardião reavalia até recomendar prontidão ou aborto.
10. Router verifica mecanicamente os predicados de `CHANGE_READY`.

Cada rodada deve ser materializada por objetos governados. Ainda precisa ser decidido se haverá um envelope específico de rodada ou se os contratos existentes bastam.

### 10.3 O que o MCP faz

O MCP é o meio de coordenação e a memória verificável. Ele:

- hospeda os grafos de sessão e negociação;
- fornece consultas ao persistente;
- registra evidências e deliberações;
- valida schemas;
- mantém `based_on_seq`;
- aplica o statechart;
- verifica `CHANGE_READY`;
- registra recusas;
- preserva provenance e audit.

O MCP expõe ferramentas e recursos determinísticos para os agents. Ele não executa o julgamento probabilístico do Guardião.

### 10.4 Por que o MCP não possui agente próprio

Hospedar uma LLM no servidor misturaria duas responsabilidades normativamente separadas:

```text
Guardião recomenda.
Router verifica.
Host admite ou recusa.
```

Uma LLM server-side também introduziria:

- configuração de modelo e credenciais no servidor;
- custo e privacidade adicionais;
- risco de confundir host epistemológico com agente probabilístico;
- dificuldade para provar conformidade entre flavors;
- dois runtimes agentic concorrentes, o coding agent e o MCP;
- dependência da capacidade opcional de sampling do cliente MCP.

Por isso, a recomendação vigente é manter todos os arquétipos probabilísticos no coding agent e todos os gates/transições determinísticos nos hosts e no Router.

### 10.5 Memória da deliberação

Não é necessário persistir toda a conversa textual. O horizonte deve guardar tudo que possa influenciar decisões posteriores:

- `NegotiationSeed`;
- consultas e snapshots utilizados;
- evidências;
- classificações da deliberação;
- assumptions;
- unresolved;
- decisões do operador;
- versões do plano;
- recomendação do Guardião;
- `AcceptedPredictiveHypothesis`;
- `ChangeContract`;
- recusas e transições.

Texto intermediário pode permanecer scratch somente se nunca for reutilizado para justificar decisão posterior. Se influenciar uma decisão futura, é memória e precisa estar no OpenGraph governado.

### 10.6 Portabilidade e capacidade degradada

O contrato comum do plugin deve definir a troca estruturada Maître–Guardião. A forma de invocar o agent é responsabilidade do adapter do coding agent.

Claude Code e Gemini CLI possuem modelos de subagents isolados que retornam resultados ao agent principal. A superfície equivalente de Codex deve ser validada durante o desenho do adapter, sem tornar sua sintaxe parte do protocolo comum.

Permanece aberta a seguinte decisão:

- um host sem isolamento real de agents pode executar Maître e Guardião sequencialmente no mesmo contexto, marcando a execução como degradada; ou
- um host sem isolamento real fica restrito a doctor e consultas, sem poder iniciar mutações.

**Recomendação preliminar:** impedir mutações sem isolamento real. A execução poderia usar doctor e consultas, mas não alegar validação independente do Guardião.

## 11. Fora do escopo já identificado

- implementação do plugin antes de aprovação do design;
- hooks e statusline;
- UI própria;
- retomada automática através de restart do coding agent;
- adaptação server-side específica por flavor;
- compatibilidade com Graph v1;
- fast-path de admissão para conteúdo pré-auditado;
- agentes atuando como hosts ou gates;
- promoção por timeout, budget ou número de tentativas;
- federação operacional além do que o protocolo já prevê;
- solução de conflitos semânticos entre mudanças sem colisão de células.

## 12. Como retomar em outra sessão

1. Carregar a skill de brainstorming usada nesta sessão:
   `C:\Users\User\.claude\plugins\cache\claude-plugins-official\superpowers\6.3.0\skills\brainstorming\SKILL.md`.
2. Ler este arquivo integralmente.
3. Ler `docs/PRD/PRD.md` e, para os papéis/horizontes, as seções 12–16, Parte VIII e Apêndices A–B de `docs/PRD/OpenGraph_Working_Paper_v1_0.md`.
4. Não tratar este checkpoint como design aprovado.
5. Retomar pelas duas perguntas prioritárias registradas nas seções 9 e 10: cardinalidade de Executors e comportamento de hosts sem isolamento real de agents.
6. Depois das perguntas restantes, propor duas ou três abordagens arquiteturais com trade-offs.
7. Apresentar o design em seções e obter aprovação explícita antes de qualquer implementação.
