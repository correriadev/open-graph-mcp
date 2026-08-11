# OpenGraph

## Arquitetura cognitiva recursiva sobre substrato epistêmico verificável: planos, horizontes e promoção de autoridade

**Documento de trabalho · versão 0.4 · 10 de agosto de 2026**

> **Tese central**
> Capacidade de inferir não implica autoridade para afirmar. Capacidade de produzir não implica autoridade para persistir.
>
> **Tese estrutural da v0.4**
> Autoridade não é um lugar na pilha — é uma propriedade preservada *através* dela. Inteligência pode navegar, interpretar, expandir, negociar e agir sem adquirir o direito de persistir verdade. **A mesma máquina epistemológica — proposta → deliberação → admissão → concretização → verificação → autoridade — recorre em todo horizonte OpenGraph; mudam o escopo, o tempo de vida e aquilo que pode ser promovido.**
>
> **Tese de memória da v0.4**
> Memória não é um mecanismo paralelo ao OpenGraph. **Toda memória governada é um OpenGraph dentro do horizonte em que vive.**

---

## 0. Enquadramento: baseline e evolução

Este documento não substitui a v0.2, o repositório ou a v0.3. É a próxima formulação do sistema: preserva a baseline empírica, registra a contribuição da v0.3 e explicita as definições surgidas na auditoria subsequente.

```
v0.2 + repo HEAD
      │  evidência do que já funciona
      │  lições dos testes reais
      │  invariantes conquistados
      ▼
   BASELINE  ─────────────── fotografia, não teto
      │
      ▼
     v0.3
      │  três planos + Guardião cognitivo
      │  falsificação da fronteira
      │
      ▼
AUDITORIA DA v0.3
      │  recursividade restaurada
      │  memória = OpenGraph por horizonte
      │  loop Intermediador ↔ Técnico
      ▼
     v0.4
```

A pergunta que a v0.4 responde:

> **Como os mecanismos comprovados da fotografia atual tornam-se o substrato de uma arquitetura cognitiva recursiva — em que cada horizonte possui seu próprio OpenGraph — sem que inteligência, execução ou promoção destruam as garantias conquistadas?**

### 0.1 Nota de versão — o que a v0.4 fixa

A v0.3 encontrou a separação correta entre inteligência, autoridade e mecanismo, mas deixou duas partes centrais subespecificadas. A v0.4 registra as definições que emergiram da auditoria seguinte:

1. **Os três blocos arquiteturais passam a ser chamados de `Cognitive Plane`, `Epistemic Plane` e `Runtime Plane`.** Os antigos “três eixos” tornam-se **coordenadas de estado**: durabilidade, status epistêmico e horizonte cognitivo.
2. **Recursividade é princípio estrutural.** O ciclo `PROPOSTA → DELIBERAÇÃO → ADMISSÃO → CONCRETIZAÇÃO → VERIFICAÇÃO → AUTORIDADE` é o mesmo em qualquer horizonte OpenGraph.
3. **Toda memória governada é um OpenGraph no horizonte ao qual pertence.** Sessão, negociação, transformação, microtask e persistência não são memórias de natureza diferente; são instâncias com escopos e lifetimes diferentes.
4. **O Intermediador é a fronteira formal de qualidade da transformação.** Ele instancia e governa o OpenGraph médio e audita os resultados dos Técnicos em loop limitado de correção.
5. **Agentes Técnicos podem agir no mundo.** A proibição correta não é `Cognitive → Runtime`; é `Cognitive → Persistent Authority` sem atravessar o Epistemic Plane. Ferramentas operacionais são permitidas por uma rota controlada de capacidades.
6. **Horizonte de memória não define se algo é agente.** Ele define o contexto cognitivo que o agente possui. O Router continua não sendo agente porque sua responsabilidade é determinística, não porque seja stateless.

A v0.4 não transforma essas definições em fatos da baseline. Elas permanecem **[E]** até implementação e falsificação.

### 0.2 Conflitos aparentes não são regressões

A v0.2 afirmou: *o Guardião não deve ser um agente; a autoridade pertence ao gate e à célula.* A v0.3 reintroduz um agente Guardião. Isso não é contradição, e a pergunta que resolve não é "qual versão estava certa":

> **O novo componente está recebendo autoridade que hoje pertence ao protocolo, ou está usando o protocolo como mecanismo de autoridade?**

São duas arquiteturas completamente diferentes, e a §11 dá o teste que as separa. Enquanto o teste passar, a conquista da v0.2 permanece intacta:

> **Nenhuma LLM possui a capacidade de declarar sozinha que algo virou verdade.**

### 0.3 Marcas de estado

| Marca | Significa |
|---|---|
| **[B]** | Baseline conquistada — evidência no repositório, teste de regressão, commit identificado |
| **[C]** | Construído e desligado — código vendorado, nunca exercitado. Não é prova |
| **[E]** | Evolução proposta nesta versão — precisa de justificativa e de teste de não-regressão |
| **[A]** | Aberto — requisito reconhecido, desenho não resolvido |

Uma marca mais baixa não é afirmação mais fraca; é afirmação em outro horizonte. O que a marca impede é a confusão entre descrever e pretender — nas duas direções.

---

# Parte I — A baseline conquistada

## 1. Invariantes que a v0.4 não pode destruir *[B]*

Cada linha foi paga com implementação, exercício adversarial ou defeito documentado. A evolução pode reinterpretar, mover de camada ou renomear. **Não pode revogar.**

| # | Invariante | Como foi conquistado |
|---|---|---|
| **I1** | Toda claim carrega âncora verbatim re-checável; âncora inexistente é bloqueio duro, não aviso | gate recusa ao vivo `anchor not found verbatim` |
| **I2** | β exige prova de cobertura fechada; célula com nó descoberto não promove | `coverage not balanced in β cell` |
| **I3** | β é privilégio revogável; no HEAD atual, drift de código em célula β de nível 5 é graduado: `structural → suspended`, `gone → source`, enquanto `lexical/renamed` não demovem | evolução do tripwire originalmente provado por `drift.node → authority.demoted → watch.converged` |
| **I4** | Escada valida atomicamente no commit: adjacência, raízes nos extremos, sem órfão, sem ciclo | commit atômico com `admitSeq` |
| **I5** | Chave de célula tem forma canônica única em toda fronteira | pago com F1 e F7, dois críticos |
| **I6** | Recusa é registrada como recusa, com razões | pago com 59 chamadas logadas `ok:true` e zero claims |
| **I7** | Knowledge graph e audit log permanecem separados | regra canônica: JSONL durável, SQLite derivado |
| **I8** | Camada viva nunca é requisito; todo fluxo tem fallback por polling | pago com MP-1 |
| **I9** | Verificação nunca depende de rede no gate | herdado; vale inclusive para refs federadas |
| **I10** | Evidência não se fabrica: feature bloqueada fica bloqueada | 2 BLOCKED e 2 FAILED de 9, sem invenção |

**I5 e I6 merecem destaque** porque não são propriedades de desenho — são cicatrizes. O gate de integridade aprovou sem prova na grafia que a própria documentação recomendava, e o instrumento de diagnóstico mentiu 59 vezes seguidas. A arquitetura estava correta e a implementação estava aprovando vacuamente.

## 2. A lição que reorganiza tudo *[B]*

> **A patologia que a arquitetura existe para impedir numa LLM apareceu na implementação que a impede.**

Um gate que falha em silêncio produz confiança sem produzir garantia. Isso força a v0.4 a tratar cada componente novo — inclusive cognitivo — como suspeito até que exista um teste que tente burlá-lo.

---

# Parte II — A tese estrutural

## 3. Três planos arquiteturais que se compõem *[E]*

A v0.3 separou corretamente três responsabilidades, mas chamou essas responsabilidades de “camadas” e depois reutilizou os mesmos nomes como “eixos”. A v0.4 fixa a nomenclatura:

```
COGNITIVE PLANE          Maître · Guardião · Intermediador · Técnicos
   inteligência          interpretar · navegar · negociar · decompor · agir
        │
        │ propostas e contratos estruturados
        ▼
EPISTEMIC PLANE          hipóteses · claims · células · α/β · proveniência · gates
   autoridade            o que pode ser admitido e promovido em cada horizonte
        │
        │ materialização governada
        ▼
RUNTIME PLANE            changesets · locks · events · stores · MCP · scheduler
   mecanismo             durabilidade · concorrência · lifecycle · capabilities
```

Os três planos não são níveis de maturidade. São responsabilidades ortogonais. Trocar o modelo de um Técnico não muda a semântica de uma claim. Trocar SQLite não muda a definição de β. Trocar a ontologia de domínio não deveria reescrever o scheduler.

### 3.1 Duas rotas, uma única fronteira de autoridade *[E]*

A formulação da v0.3 — “a camada cognitiva nunca fala com a camada de sistema” — era forte demais. Um Agente Técnico precisa usar filesystem, shell, Git, browser, banco, APIs ou ferramentas equivalentes. Impedir `Cognitive → Runtime` impediria a própria concretização.

A v0.4 separa duas rotas:

```
ROTA EPISTÊMICA — obrigatória para verdade

Cognitive Plane
      │  proposta / claim / resultado candidato
      ▼
Epistemic Plane
      │  gate / cobertura / roundtrip / autoridade
      ▼
Runtime Plane
      │  persistência / evento / commit
      ▼
OpenGraph promovido
```

```
ROTA OPERACIONAL — permitida para ação

Agente Técnico
      │
      ▼
Capability / Tool Gateway
      │
      ├── filesystem
      ├── shell
      ├── Git
      ├── browser
      ├── APIs
      └── banco / ferramentas especializadas
      │
      ▼
artefatos + evidências + resultados
      │
      ▼
Intermediador
      │
      └── se algo pretende adquirir autoridade → ROTA EPISTÊMICA
```

A regra correta é:

> **Ação no mundo não é autoridade sobre o mundo.**

Um Técnico pode criar um arquivo. Não pode declarar que o arquivo representa corretamente o objeto governado. Pode executar uma migração em ambiente permitido. Não pode, por esse fato, promover uma decisão arquitetural ao OpenGraph persistente.

A fronteira proibida é:

```
Cognitive Plane ─────────X────────► Persistent Authority
```

Toda passagem que altera o que o sistema chama de verdade atravessa o Epistemic Plane.

### 3.2 O Runtime materializa; não decide verdade *[E]*

Locks, TTL, stores, `seq`, filas e tools são mecanismos. Eles podem bloquear uma operação por autorização, concorrência ou disponibilidade, mas não decidem o mérito epistêmico de uma claim. Da mesma forma, um gate pode exigir que uma célula esteja reservada antes de aceitar uma proposta sem transformar o lock em evidência de verdade.

Essa distinção preserva a lição da baseline: autorização operacional e mérito epistêmico podem ser adjacentes, mas não são a mesma decisão.

## 4. Coordenadas de estado, não novos planos *[E]*

Os planos dizem **quem é responsável por quê**. As coordenadas dizem **em que estado um dado se encontra**.

| Coordenada | Pergunta que responde | Exemplos de valores |
|---|---|---|
| **Durabilidade** | sobrevive a quê? | in-memory · sessão · durável · append-only |
| **Status epistêmico** | que direito este dado conquistou? | proposto · admitido-no-escopo · α · β · suspended |
| **Horizonte cognitivo** | em que escopo temporal/operacional ele é relevante? | sessão · negociação · transformação · microtask · persistente |

Um mesmo elemento tem posição nas três coordenadas. Uma hipótese em negociação pode ser durável, ainda proposta e pertencente ao horizonte de negociação. Uma claim de uma microtask pode estar durável num changeset e continuar sem autoridade fora daquele horizonte.

### 4.1 Toda memória governada é um OpenGraph no próprio horizonte *[E — DEFINIÇÃO v0.4]*

A v0.4 fecha uma ambiguidade das versões anteriores:

> **Memória não é um store paralelo ao OpenGraph. A memória governada é o próprio OpenGraph recortado pelo horizonte em que vive.**

Isso não obriga todas as instâncias a usarem o mesmo storage físico, schema completo ou política de retenção. Define a semântica: estado cognitivo relevante é representado como nós, relações, claims, lacunas e evidências dentro de um OpenGraph escopado.

Os horizontes atualmente definidos são:

| Horizonte | Agente/autoridade relacionada | OpenGraph contém | Lifetime |
|---|---|---|---|
| **Sessão** | Maître | conversa útil, respostas obtidas, decisões explicitadas, referências de contexto | duração da sessão ou política de continuidade |
| **Negociação** | Guardião | questões, respostas, conflitos, hipóteses, resoluções e pontos conscientemente abertos | até convergência, abandono ou expiração |
| **Transformação / médio** | Intermediador | proposta + contrato + decomposição + dependências + resultados aceitos das microtasks | duração da mudança |
| **Microtask / curto** | Técnico | contexto mínimo, tentativas, erros, evidências, artefatos intermediários | duração da microtask |
| **Persistente / longo** | objeto governado, mediado pelo Guardião | estado admitido e versionado do objeto concreto | longo prazo |

O mesmo modelo de grafo em horizontes diferentes não significa o mesmo nível de autoridade. **Autoridade é sempre relativa ao horizonte e à fronteira de promoção seguinte.**

### 4.2 A máquina epistemológica é recursiva *[E — DEFINIÇÃO CRÍTICA v0.4]*

O ciclo que apareceu desde a formulação inicial deixa de ser apenas narrativa e vira princípio arquitetural:

```
PROPOSTA
   ↓
DELIBERAÇÃO
   ↓
ADMISSÃO
   ↓
CONCRETIZAÇÃO
   ↓
VERIFICAÇÃO
   ↓
AUTORIDADE
```

Ele é executado **independentemente do horizonte**.

Para qualquer OpenGraph `G_h` pertencente ao horizonte `h`:

```
G_h.proposta
   ↓
G_h.deliberação
   ↓
G_h.admissão
   ↓
G_h.concretização
   ↓
G_h.verificação
   ↓
G_h.autoridade_relativa
```

O que muda entre horizontes não é a máquina; é o objeto produzido e o que “autoridade” habilita:

| Horizonte | Concretização típica | Autoridade relativa permite |
|---|---|---|
| Sessão | resposta contextualizada / decisão explicitada | continuar a sessão sem reabrir o mesmo ponto |
| Negociação | hipótese preditiva aceita / contrato candidato | instanciar a transformação |
| Transformação | conjunto coerente de artefatos e resultados aceitos | propor promoção ao persistente |
| Microtask | artefato, teste, análise ou ação especializada | devolver resultado aceito ao Intermediador |
| Persistente | delta admitido sobre o objeto concreto | compor o estado oficial versionado |

**Autoridade relativa não é β.** `α/β/suspended` continua sendo o gradiente de posse da verdade por célula definido na baseline. A recursividade descreve o lifecycle de conhecimento dentro de qualquer horizonte; α/β descreve uma semântica específica de autoridade do OpenGraph governado.

### 4.3 Promoção é mudança de horizonte, não cópia de memória *[E]*

Quando um horizonte conclui seu ciclo, ele não despeja seu conteúdo inteiro no próximo.

```
OpenGraph curto
      │  distill / admit / promote
      ▼
OpenGraph médio
      │  distill / admit / promote
      ▼
OpenGraph longo
```

Tentativas, diálogos, erros transitórios e caminhos abandonados podem permanecer úteis no horizonte de origem e ainda assim desaparecer quando ele morre. O que atravessa é uma representação destilada cuja promoção passou pelo ciclo do horizonte receptor.

O audit log permanece separado: ele registra que algo aconteceu, inclusive recusas, sem transformar o acontecimento em conhecimento admitido.

### 4.4 Consequência operacional *[E]*

Toda estrutura governada deve conseguir responder quatro perguntas:

1. **Em qual plano ela vive?** — cognitivo, epistêmico ou runtime.
2. **Qual sua durabilidade?**
3. **Qual seu status epistêmico?**
4. **Em qual horizonte OpenGraph ela é relevante?**

Se uma estrutura não consegue responder em qual horizonte existe, sua política de destruição e promoção está indefinida. Se não consegue responder seu status epistêmico, pode contaminar o horizonte seguinte. Se não consegue responder qual plano a governa, responsabilidades operacionais e autoridade tendem a se misturar.

# Parte III — O Epistemic Plane como contrato estável

## 5. Por que ela é o meio, e não a base *[E]*

A intuição comum colocaria o sistema no meio: agentes em cima, dados embaixo, protocolo ligando. A v0.4 mantém a inversão deliberada da v0.3.

O Epistemic Plane é **o contrato que nem o Cognitive Plane nem o Runtime Plane podem contornar quando a operação pretende alterar autoridade**. Ela é o único lugar onde as três perguntas se encontram, e é a única que precisa ser estável ao longo de reescritas das outras duas. Trocar SQLite por outro store não muda o que é uma claim admitida. Trocar o desenho de agentes não muda o que β exige. **Se a troca de uma das pontas altera a semântica de verdade, a camada epistêmica vazou.**

## 6. O que vive nela *[B, reinterpretado]*

| Elemento | Papel | Estado |
|---|---|---|
| **Célula** (`domínio × nível`) | unidade de autoridade, cobertura, concorrência e escopo | [B] |
| **α / β / suspended** | gradiente de posse da verdade, conquistável e revogável | [B] |
| **Âncora verbatim** | condição de admissão; hash de token-stream | [B] |
| **Escada 0..5** | descida é projeção, subida é ancoragem | [B] gate · [C] motores |
| **Cobertura censitária** | reivindicação de completude, distinta de correção | [B] |
| **Roundtrip** | o artefato realiza a intenção que o produziu | [B] |
| **Gate de admissão** | porta única, determinística, cega ao chamador | [B] + [E] §11.2 |
| **Proveniência** | origem, evidência, derivação, escopo | [A] — esquema mínimo não decidido |
| **Supersessão / contestação** | `ACTIVE · SUPERSEDED · CHALLENGED · REVOKED` | [A] — [23] oferece vocabulário próximo |
| **Hipótese preditiva aceita** | admitida no escopo da mudança, sujeita a concretização | [E] — formalizada na §9.3 |

## 7. A célula continua sendo a unidade canônica *[B]*

Cinco responsabilidades numa chave: autoridade, cobertura, concorrência, escopo de gate, raio de impacto. Economia conceitual — e a razão pela qual a chave precisa de forma canônica única em toda fronteira (I5). A v0.4 não mexe nisso e herda a cicatriz: **F1 e F7 provaram que duas grafias da mesma célula lógica produzem autoridade não merecida e edição simultânea silenciosa.**

---

# Parte IV — O Cognitive Plane

## 8. O que torna um componente cognitivo *[E]*

A v0.3 tentou definir agente pela posse exclusiva de um horizonte de memória. A regra era elegante, mas forte demais: um agente pode ser efêmero ou manter seu estado fora do processo e continuar sendo um agente.

A v0.4 adota uma definição funcional:

> **Um agente é um componente probabilístico capaz de interpretar contexto e produzir uma decisão, proposta, decomposição ou ação semântica.**

O horizonte OpenGraph não determina se ele é agente. Determina **o escopo cognitivo que ele pode carregar legitimamente**.

| Componente | Função cognitiva | Horizonte OpenGraph principal | Veredito |
|---|---|---|---|
| **Maître** | interface com o operador, continuidade, coordenação da sessão | sessão | agente [E] |
| **Guardião** | interpretar, navegar, expandir e negociar sobre o objeto governado | negociação + leitura do persistente | agente [E] |
| **Intermediador** | transformar mudança admitida em execução governada e auditada | transformação / médio | agente [E] |
| **Técnico** | concretizar uma microtask com ferramentas e especialidade | microtask / curto | agente [E] |
| **Router** | validar estados, transições, spawn, retry, timeout e lifecycle | nenhum horizonte cognitivo próprio | **não agente** — §10 |

O Router não é agente porque seu trabalho deve ser determinístico. A ausência de horizonte próprio é consequência dessa função, não sua definição.

## 9. Agentes e horizontes OpenGraph *[E]*

### 9.1 Maître — front-of-house da sessão

O operador interage diretamente com o Maître. Ele mantém o OpenGraph de sessão: aquilo que precisa continuar disponível para que a conversa não reabra desnecessariamente o que acabou de ser resolvido.

Em uma consulta simples:

```
OPERADOR
   ↓
MAÎTRE
   │ consulta
   ▼
GUARDIÃO
   │ navega o persistente
   ▼
MAÎTRE
   │ incorpora a resposta ao OpenGraph de sessão
   ▼
OPERADOR
```

Consultar não modifica o OpenGraph persistente. O fato de uma resposta passar a existir no horizonte de sessão não lhe confere autoridade de longo prazo.

### 9.2 Guardião — interface cognitiva da autoridade

```
GUARDIÃO  (LLM / inteligência)
      │  navega · interpreta · expande · negocia
      ▼
EPISTEMIC PLANE
      │
      ▼
OPEN GRAPH PERSISTENTE
      │
      ▼
GATES DETERMINÍSTICOS
```

> **Guardião ≠ autoridade**  
> **Guardião = interface cognitiva da autoridade**

O Guardião interpreta o estado admitido, confronta propostas com o que existe, navega relações, expande consequências e levanta dúvidas. O mecanismo de expansão preditiva é tratado aqui como capacidade já existente da solução e não é redesenhado nesta versão.

O que ele não faz é declarar persistência por vontade própria. `SUPPORTED · UNKNOWN · AMBIGUOUS · INFERRED · CONFLICTING` precisam permanecer distinguíveis, e qualquer delta que pretenda alterar o estado autoritativo atravessa o gate.

> **“100% assertivo sobre o concreto”** significa ausência de autorização arquitetural para converter informação não sustentada em fato persistente — não infalibilidade do modelo.

### 9.3 O OpenGraph de negociação e a hipótese preditiva aceita *[E — DEFINIÇÃO v0.4]*

Quando uma consulta se transforma em intenção de mudança, o Guardião passa a operar um **OpenGraph de negociação**. Ele contém perguntas, respostas, conflitos, resoluções, assumptions declaradas e lacunas ainda abertas.

Esse OpenGraph executa a mesma máquina recursiva da §4.2. Sua saída autoritativa relativa é a **Hipótese Preditiva Aceita**, suficientemente resolvida para instanciar uma transformação, sem ser ainda verdade persistente sobre o objeto.

```
HipótesePreditivaAceita {
  scope
  resolved[]
  unresolved[]
  assumptions[]
  provenance
  based_on_seq
}
```

`assumptions[]` impede que negociação vire lavanderia de suposições. `based_on_seq` torna explícita a versão do persistente contra a qual a hipótese foi construída.

A política física de retenção desse OpenGraph — store isolado, namespace dedicado, replay etc. — permanece [A]. O que está definido é sua semântica e seu horizonte.

### 9.4 Intermediador — governador do OpenGraph médio *[E — CRÍTICO]*

O Intermediador **não existe em toda sessão**. Ele nasce quando Operador + Maître + Guardião convergem para uma mudança real e a Hipótese Preditiva Aceita atravessa para um contrato de transformação.

Ele nasce com:

```
proposta admitida
+
contrato
+
escopo
+
constraints
+
based_on_seq
```

E instancia o **OpenGraph médio**, que representa a transformação candidata — não o projeto oficial e não apenas uma lista de tarefas.

O Intermediador pode consultar o Guardião para obter detalhes apurados do estado persistente — stack, banco, decisões arquiteturais, padrões, dependências — mas essas respostas entram no OpenGraph médio com proveniência e versão, não como memória invisível do modelo.

Sua função principal é dupla:

1. **decompor** a transformação em trabalho executável por especialidades;
2. **auditar** se o que os Técnicos produziram merece adquirir autoridade dentro do horizonte médio.

### 9.5 Agentes Técnicos — especialistas com OpenGraphs curtos *[E]*

Um Técnico é instanciado por necessidade e especialidade: codificador, arquiteto de dados, designer, QA, advogado ou outro domínio.

Cada instância recebe um **OpenGraph curto** com o mínimo necessário para uma microtask:

```
MicrotaskGraph {
  objective
  constraints[]
  relevant_context[]
  attempts[]
  evidence[]
  intermediate_artifacts[]
  status
}
```

O Técnico possui mãos por meio do Capability / Tool Gateway. Pode criar arquivos, executar scripts, chamar APIs, testar, navegar, gerar documentos ou usar ferramentas especializadas autorizadas.

Esses efeitos não são automaticamente conhecimento. O resultado volta como candidato ao Intermediador.

### 9.6 O loop formal Intermediador ↔ Técnico *[E — CRÍTICO]*

A v0.4 restaura explicitamente o segundo loop da concepção original:

```
INTERMEDIADOR
      │
      │ WorkOrder + OpenGraph curto inicial
      ▼
   TÉCNICO
      │
      │ tools / execução / ArtifactBundle
      ▼
INTERMEDIADOR
      │
      ├── ACEITO ─────────► admite no OpenGraph médio
      │
      └── CORRIGIR
             │
             ▼
          TÉCNICO
             │
             └── até N tentativas configuradas
                       │
                       ▼
                 limite excedido
                       │
                       ▼
               escalonamento / operador
```

O Técnico executa o ciclo recursivo no horizonte curto. O Intermediador executa o ciclo no horizonte médio. Um resultado aceito pelo Técnico **não atravessa automaticamente**: ele vira proposta no horizonte do Intermediador, que delibera/verifica antes de admitir.

Esse detalhe é a expressão mais concreta da recursividade:

```
autoridade no horizonte filho
            ≠
autoridade no horizonte pai
```

Um `ArtifactBundle` pode ser autoritativo para encerrar uma microtask e ainda ser recusado como parte da transformação global.

O inverso também é importante: uma falha ou descoberta da microtask pode contestar uma hipótese do OpenGraph médio. Nesse caso, o Intermediador não “corrige a realidade” por conta própria; ele marca a contestação e o Router decide a transição permitida, inclusive reabrir negociação quando a política exigir.

## 10. Router: control plane, não quinto agente *[E]*

O Router possui a máquina de estados e controla lifecycle, spawn, destroy, retries, timeouts e transições. Deve ser workflow determinístico; do contrário o roteamento recria a inferência não governada que a arquitetura combate.

```
LLM:            "o que isso significa?"
CONTROL PLANE:  "o que pode acontecer agora?"
```

Statecharts [18] dão o formalismo. Um primeiro conjunto de estados continua sendo:

`CHAT · QUERY · NEGOTIATING · CHANGE_READY · PLANNING · EXECUTING · VERIFYING · WAITING_HUMAN · PROMOTING · DONE`.

> **Regra:** LLMs decidem conteúdo. O protocolo decide fluxo e autoridade. Um modelo pode recomendar uma transição; o workflow valida se ela é permitida.

**[A]** A condição determinística exata de `CHANGE_READY` permanece aberta. A v0.4 apenas fixa que a transição precisa referenciar uma Hipótese Preditiva Aceita, e que `unresolved[]` não pode desaparecer implicitamente.

## 11. Falsificação do Cognitive Plane

A reintrodução de agentes só é aceitável se não reintroduzir autoridade probabilística.

### 11.1 Teste de substituição adversarial *[E]*

> **Substitua qualquer componente cognitivo por um adversário com as mesmas credenciais. Se um invariante da §1 ou uma fronteira de promoção da §4.3 quebrar, aquele componente possuía autoridade disfarçada.**

Um Guardião hostil pode mentir. Um Intermediador hostil pode aceitar artefato ruim. Um Técnico hostil pode produzir arquivos inconsistentes. O sistema ainda deve impedir que qualquer um deles transforme sozinho sua conclusão em verdade persistente.

O teste precisa existir também entre horizontes: substituir um Técnico por adversário não pode promover diretamente ao médio; substituir o Intermediador não pode promover diretamente ao longo.

### 11.2 Mérito epistêmico cego ao chamador *[E]*

A mesma claim deve receber o mesmo veredito de mérito epistêmico independentemente de Maître, Guardião, Intermediador, Técnico ou cliente hostil.

Autorização continua podendo depender da identidade: um agente sem escopo de turno pode receber `out of turn scope`. A formulação precisa permanece:

> **O mérito da claim é cego ao chamador; o direito de submetê-la não é.**

### 11.3 Seis regressões proibidas *[E]*

| # | Regressão | Por que é fatal |
|---|---|---|
| **R1** | LLM com credencial de escrita autoritativa no persistente | revoga a tese |
| **R2** | mérito do gate varia por chamador | autoridade volta para identidade/agente |
| **R3** | interpretação baseada em estado não versionado | reintroduz uma cópia stale da verdade |
| **R4** | contratos entre agentes apenas em linguagem natural | facilita alucinação em cascata [5][17] |
| **R5** | resultado do horizonte filho promove automaticamente no pai | destrói a recursividade e a fronteira de autoridade |
| **R6** | memória cognitiva fora de um OpenGraph governado | reintroduz estado invisível que pode influenciar promoção sem proveniência |

Cache não é proibido por si. Um snapshot imutável identificado por `seq` é utilizável; o proibido é responder como atual sem validar a versão relevante.

## 12. Contratos de fronteira *[E]*

Raciocínio probabilístico dentro do agente; output estruturado nas fronteiras; validação antes da transição seguinte.

```
ChangeProposal {
  project_id, session_id, intent, scope
}

ImpactAnalysis {
  status, questions[], affected_nodes[],
  constraints[], unresolved[], based_on_seq
}

AcceptedPredictiveHypothesis {
  scope, resolved[], unresolved[], assumptions[],
  provenance, based_on_seq
}

ChangeContract {
  change_id, objective, accepted_hypotheses[],
  constraints[], unresolved[], based_on_seq
}

WorkOrder {
  task_id, specialty, objective, inputs[],
  constraints[], expected_artifacts[]
}

ArtifactBundle {
  task_id, artifacts[], tests[],
  execution_results[], evidence[]
}

AuditDecision {
  task_id,
  verdict: accepted | revise | escalate,
  reasons[], attempt
}
```

O `changeset` + `claim` da baseline cobre admissão no substrato atual. Esses contratos cobrem as fronteiras cognitivas e, principalmente, tornam explícito que `ArtifactBundle` não equivale a `AuditDecision(accepted)`.

## 13. Economia: consulta não instancia complexidade *[E]*

Consulta continua sendo o caminho barato:

```
Operador → Maître → Guardião → Maître → Operador
```

O Maître pode manter o resultado no OpenGraph da sessão. O Guardião lê o persistente. Não nasce Intermediador, não nasce Técnico e não existe mutação persistente.

```
Intermediador = ∅
Técnicos      = ∅
OpenGraph médio = ∅
OpenGraphs curtos = ∅
```

A complexidade cresce apenas quando o regime da sessão exige transformação. O alpha v0 (§21) continua sendo evidência indireta dessa regra: quando a tarefa estava auto-especificada, a estrutura adicional não produziu valor observável.

# Parte V — O Runtime Plane

## 14. O substrato, reinterpretado como Runtime Plane *[B]*

Nada aqui é novo. O que muda é o enquadramento: estes mecanismos deixam de ser "o produto" e passam a ser **o que torna o Epistemic Plane executável, durável e concorrente**.

| Mecanismo | Serve ao Epistemic Plane como | Estado |
|---|---|---|
| JSONL append-only | durabilidade da verdade; replay reconstrói tudo | [B] |
| SQLite | índice derivado e estado vivo; perdível por definição | [B] |
| `seq` monotônico por tenant | ordenação sem ambiguidade; base de R3 e de `history/since` | [B] |
| Changeset | atomicidade da admissão e raio de impacto auditável | [B] |
| Lock por célula | exclusividade que o escopo epistêmico exige | [B] |
| Roteador de afinidade | notificação sem vazar quem bateu em porta trancada | [B] |
| MCP tools + resources | fronteira cliente-agnóstica | [B] |
| Camada viva (SSE) | melhora, nunca habilita (I8) | [B] |

**Duas camadas de cliente [B].** Qualquer cliente MCP genérico alcança a maior parte do produto — query, ciclo de changeset, presença, flip. A camada viva é opcional com fallback por polling. Consequência estratégica: não se porta o produto para cada agente; entrega-se o endpoint compliant para todos e um plugin fino por flavor.

## 15. Construído e desligado *[C]*

21 de 47 módulos alcançáveis e nunca executados. Entre eles, capacidades diretamente relevantes para a evolução proposta na v0.4:

`claims.ts` (claims determinísticas por AST, sem LLM) · `greenfield.ts` · `federation.ts` · `project.ts` · `expand.ts` · `ascent.ts` · `cell-dag.ts` · `graphci.ts` · `merge-driver.ts`

**A nota no código dizendo que o pipeline real "é uma sessão de agente LLM, não é spawnável" era materialmente enganosa.** Existe piso determinístico produzindo claims e arestas de verdade. Reenquadramento: não é construir o que falta, é **conectar o que já está lá.**

Ressalva: `[C]` não é prova. `greenfield.ts` é código morto e não testado; a recomendação registrada é escrever teste antes de ligar.

---

# Parte VI — Generalização além de código

## 16. Greenfield é o mecanismo, não uma feature *[C → E]*

Desde a v0.1 o paper afirma que o objeto governado pode ser "API, produto, plano de viagem, contrato". Nada no substrato sustentava isso: toda âncora resolvia contra um arquivo. Era retórica.

Greenfield remove a dependência. **A regra de âncora não muda — muda a fonte do chão:** a claim ancora no *texto da claim-pai*, com bloqueio duro idêntico ao brownfield. A escada vendorada é literal:

```
["ideação", "concepção", "arquitetura", "cenários", "testes", "código"]   CODE_LEVEL = 5
```

**Consequência que reorganiza o roadmap:** um domínio sem código — legislação, contrato, plano, design system — é simplesmente uma escada que nunca alcança o nível 5. Não precisa de mecanismo novo. Precisa de um chão diferente.

> **Greenfield é o que converte a generalização do paper de retórica em arquitetura.** Isso o coloca acima da posição que ele ocupa hoje na sequência de execução.

Aceite mecânico já desenhado: `ascent(project(intent))` reproduz `intent`. Ponto fixo, não julgamento de LLM.

## 17. Federação: soberania sem cópia *[C → A]*

Time A importa manifesto assinado do time B como **torre estrangeira read-only**. Claims locais de A referenciam nós expostos de B. Quando B publica versão nova, diff de Merkle detecta refs quebradas e marca como `suspended` as células β dependentes de A.

Duas propriedades importam para a tese:

- **Verificação offline (I9).** Refs federadas checadas contra hashes do manifesto vendorado; **nunca há rede no gate.** Determinismo não é negociável nem para conhecimento estrangeiro.
- **Semver de intenção.** O diff classifica por intenção preservada versus alterada — não por diff de código. É a única forma de versionamento coerente com a tese: se o código mudou e a intenção não, é patch.

Federação é também o que fecha o ciclo da §16: uma torre de legislação mantida por quem entende de legislação, consumida read-only por quem constrói o produto. **Conhecimento que você não possui ganha presença de primeira classe.**

Gate de execução declarado: não codar sem dois times pedindo. Por isso, o mecanismo permanece `[C]` e sua ativação operacional permanece `[A]`.

---

# Parte VII — A camada de interface

## 18. A interface renderiza principalmente o estado epistêmico *[E]*

A v0.3 introduziu esta conexão com o trabalho de design; a v0.4 a preserva e passa a distingui-la das coordenadas de horizonte e durabilidade.

Uma interface pode renderizar qualquer coordenada ou plano. Renderizar apenas o Runtime Plane produz um painel operacional: tabelas, locks, seqs. Renderizar apenas o horizonte cognitivo produz um chat com histórico. **Renderizar o status epistêmico produz algo que não existe ainda** — e é o único que responde às perguntas que a árvore de arquivos não responde: *o que depende disto? que ideia isto implementa? o que quebra se eu mudar de ideia?*

### 18.1 Autoridade epistêmica como material *[E]*

O estado de confiança não é anotado por cima com selo ou ícone. **Muda a substância do desenho.**

| Estado epistêmico | Material |
|---|---|
| **Proposto** (ghost) | esboço solto a lápis, traço tremido, visivelmente ainda-não-real |
| **Admitido** (α) | tinta limpa e contínua |
| **β** | desenho técnico de precisão — diagrama explodido, chamadas numeradas, monoespaçada |
| **suspended** | fratura visível: linhas usinadas degradam de volta a esboço, e **uma cicatriz permanece** |

Duas consequências contraintuitivas:

**A descontinuidade estética é carga útil.** Um protótipo com estética uniforme — mesmo bonita — enfraquece o sinal. Se tudo é esboço, proposto e verificado ficam indistinguíveis. **Aqui, coerência estética é passivo.** Quebrar a uniformidade é o que faz a sinalização funcionar.

**Cicatriz é estado, não decoração.** Confiança degradada deixa história visível em vez de resetar em silêncio — a mesma exigência que separa `SUPERSEDED` de sobrescrever.

### 18.2 A cidade *[E]*

Torres são domínios; torres guardam andares; andares guardam seções; seções guardam nós — e o nó é a coisa real, não um caminho para ela. **Seleção é a linguagem:** selecione qualquer combinação, de qualquer torre, e o canvas mostra as conexões que existem entre exatamente o que foi selecionado. "Como o andar de legislação toca minha seção de checkout" é um gesto.

Propostas associadas: **zoom semântico** (a representação troca a cada altitude, não escala), **gesto de explosão** para inspeção no nível do chão, **regra anti-emaranhado** (arestas só para o selecionado), **airlock** como superfície dedicada de revisão de proposta e diff.

**[B] parcial:** três regimes de zoom semântico entregues sem remontagem de nós, cartões ricos, legenda de estado, minimapa. A cidade, a linguagem material e o airlock não existem.

### 18.3 Falsificação da linguagem visual *[E]*

Coerente com o resto do documento, a proposta precisa de teste: **quatro estados lado a lado, sem legenda, distinguíveis por não-especialistas.** Se a distinção exige explicação, o material não está carregando a informação e o desenho falhou — por mais bonito que seja.

Risco de método registrado: modelos de geração de imagem tendem a homogeneizar estilo de cena, o que recriaria exatamente o erro que o desenho resolve. Mitigação: geração isolada por estado e composição posterior.

---

# Parte VIII — Programa de avaliação

## 19. Hipótese testável *[E]*

> Separar geração probabilística de autoridade persistente — mantendo inteligência rica no Cognitive Plane, autoridade granular no Epistemic Plane e **reexecutando o mesmo ciclo de admissão em cada horizonte OpenGraph** — reduz a propagação de inferências não verificadas entre horizontes e até estados concretos sem eliminar a capacidade criativa e operacional dos LLMs.

**Baselines:** A — agente único · B — agente + RAG · C — workflow multiagente convencional · **D — substrato epistêmico sem Cognitive Plane** (a fotografia atual) · **E — v0.4 completa**.

D é o baseline mais informativo para esta evolução: isola quanto o Cognitive Plane e a recursividade entre horizontes acrescentam sobre o substrato/gate sozinho.

## 20. Métricas *[E]*

| Métrica | Camada que testa |
|---|---|
| **Persistent Contamination Rate** | epistêmica — primária |
| **Silent-Fail-Open Rate** | epistêmica — pago com F1/F7 |
| **Refusal Fidelity** | epistêmica — recusas cujas razões nomeiam a causa real |
| **Adversarial Substitution Survival** *(nova)* | fronteira — invariantes que sobrevivem a componente hostil (§11.1) |
| **Caller-Blindness** *(nova)* | fronteira — vereditos idênticos sob N identidades (§11.2) |
| **Staleness of Interpretation** | cognitiva — respostas do Guardião baseadas em estado não validado por `seq` (R3) |
| **Cross-Horizon Leakage** *(nova v0.4)* | recursividade — resultados que adquiriram autoridade em um horizonte e atravessaram ao pai sem nova admissão |
| **Audit Loop Convergence** *(nova v0.4)* | execução — tentativas até `accepted` ou escalonamento no Intermediador |
| **Assumption-to-Action Rate** | cognitiva — suposições marcadas que produziram efeito |
| **Clarification Precision** | cognitiva — perguntas realmente necessárias |
| **Cost / Latency** | economia — contra o baseline D |

As métricas adicionadas nas v0.3–v0.4 testam o que o Cognitive Plane e a recursividade acrescentam. Sem elas, a evolução seria um acréscimo não falsificável — precisamente o que a §11 existe para impedir.

## 21. O que o alpha v0 ensinou sobre desenho experimental *[B]*

Dois braços, prompts congelados, veredito pré-registrado. Ambos reconstruíram a feature; **o braço com MCP não usou o servidor uma única vez**, verificado por log e não por autorrelato.

Causa: o teste tinha 199 linhas e a implementação 184. **A especificação era maior que o artefato — não sobrava ambiguidade para um grafo resolver.**

Correções para o próximo experimento: feature sem teste que a especifique; feature transversal onde *o que quebra se eu mexer* não seja óbvio; e grafo carregando claims commitadas, isto é, julgamento humano — não só estrutura.

---

# Parte IX — Fechamento

## 22. O que o OpenGraph não é

- **Não é apenas RAG** — recuperação não define quem pode persistir.
- **Não é apenas GraphRAG** — o grafo não é índice de consulta.
- **Não é Graph of Thoughts** — não persiste o raciocínio do modelo como verdade do domínio.
- **Não é multi-agent debate** — autoridade não é simétrica.
- **Não é uma empresa de agentes** — papéis são arquiteturais, não personas.
- **Não é um swarm** — fluxo, lifecycle e permissões são governados.
- **Não é memória infinita** — esquecimento é operação desejada.
- **Não é um framework de agentes que embute um grafo** — o OpenGraph é o substrato governado que também serve de memória em cada horizonte cognitivo.
- **Não é uma cadeia linear curto → médio → longo** — cada horizonte executa o mesmo ciclo e a promoção entre eles é uma nova fronteira de admissão.

## 23. Posicionamento *[B + E]*

Varredura de agosto de 2026: proveniência, supersessão e propagação governada são estado da arte, não diferencial. [16] já implementa em produção reconstrução de cadeias de derivação, supersessão temporal e propagação por política; [21], [22] e [23] cobrem território adjacente.

A baseline já diferencia OpenGraph por autoridade granular por região do grafo, conquistada por prova de regeneração, revogada por drift e sustentada por âncora verificável. A v0.4 acrescenta uma hipótese arquitetural ainda não validada:

> **essa semântica de autoridade pode ser preservada recursivamente em múltiplos OpenGraphs temporais, enquanto uma arquitetura cognitiva de Maître, Guardião, Intermediador e Técnicos opera sobre eles sem ganhar direito de promoção implícita.**

A alegação de novidade científica dessa composição permanece condicionada a revisão sistemática e experimento comparativo.

## 24. Nove leis de projeto

> **Lei 1** — Inferir ≠ afirmar.  
> **Lei 2** — Perguntar ≠ modificar.  
> **Lei 3** — Produzir ≠ admitir.  
> **Lei 4** — Memória útil ≠ memória permanente.  
> **Lei 5** — LLMs decidem conteúdo; o protocolo decide fluxo e autoridade.  
> **Lei 6** — Um gate que falha em silêncio é pior que a ausência de gate: produz confiança sem garantia.  
> **Lei 7** — Um componente cognitivo deve poder ser substituído por um adversário sem ganhar autoridade persistente.  
> **Lei 8** *(v0.4)* — A mesma máquina epistemológica se repete em todo horizonte; autoridade no filho não é autoridade no pai.  
> **Lei 9** *(v0.4)* — Memória governada é OpenGraph no horizonte em que vive; promoção é explícita, destruição é permitida.

A Lei 6 foi paga com F1, F7 e um log que mentiu 59 vezes. As Leis 8 e 9 registram as duas definições estruturais que a v0.3 havia diluído.

## 25. Questões abertas *[A]*

**Epistemic Plane:** esquema mínimo de proveniência de uma claim promovida; supersessão e contestação sem perda de cadeia causal; unidade de versionamento entre transformações concorrentes; como detectar e corrigir contaminação quando o próprio persistente estiver errado.

**Cognitive Plane:** condição verificável de `CHANGE_READY`; quando uma descoberta em microtask reabre negociação; política de escalonamento depois de `N` tentativas do loop Intermediador↔Técnico; calibração de número/especialidade de Técnicos; quando o Maître precisa invalidar partes do OpenGraph de sessão após avanço do `seq` persistente.

**Horizontes OpenGraph:** o schema é universal com perfis por horizonte ou cada horizonte possui schema próprio? A destruição física de um OpenGraph curto preserva quais evidências no audit log? Como formalizar a promoção `curto → médio` e `médio → longo` sem copiar ruído? OpenGraphs de sessão e negociação compartilham engine/storage com os demais ou apenas a mesma semântica?

**Runtime Plane:** claims determinísticas no bootstrap; paginação por cursor; sessão real de cliente MCP; repetição do multiplayer; capability sandbox para Técnicos; retries idempotentes de tools com efeitos colaterais.

**Transversal:** exposição dos motores da escada ao Guardião. A v0.4 permite essa hipótese porque usar uma capacidade não transfere autoridade, mas o acesso precisa sobreviver ao teste adversarial da §11.1.

## 26. Meta-análise *[histórica]*

A concepção do OpenGraph reproduziu várias vezes o fenômeno que pretende controlar.

**Na v0.1:** uma descrição incompleta foi preenchida com inferências plausíveis, e o operador precisou separar o que estava definido do que havia sido imaginado.

**Na v0.2:** a implementação real corrigiu a tendência oposta: tratar apenas o que tinha código como se fosse a totalidade do conceito, apagando hipóteses ainda não materializadas.

**Na v0.3:** a arquitetura separou planos de inteligência, autoridade e mecanismo, mas diluiu duas definições anteriores: a recursividade do lifecycle e os OpenGraphs curto/médio/longo. Também proibiu genericamente `Cognitive → System`, o que conflitaria com Agentes Técnicos capazes de usar ferramentas.

**Na v0.4:** a correção não escolhe entre “agentes” e “gate”. Ela os faz operar em coordenadas diferentes. O insight consolidado passa a ser:

> **“Está definido”, “está construído”, “é relevante neste horizonte” e “adquiriu autoridade aqui” são afirmações independentes. O sistema falha quando uma delas é usada como substituta das outras.**

A própria história do documento torna-se, assim, uma cadeia de promoção conceitual: versões anteriores não são apagadas; são evidência das hipóteses que sobreviveram, foram revogadas ou precisaram ser reespecificadas.

## 27. Conclusão

Grande parte da evolução de agentes LLM busca mais capacidade. O OpenGraph pergunta uma questão complementar: **como permitir que modelos conversem, naveguem, negociem e ajam sem que qualquer uma dessas capacidades se confunda com o direito de transformar uma conclusão em verdade?**

A baseline respondeu com mecanismos verificáveis: células, claims, âncoras, cobertura, roundtrip, α/β, drift, gates, changesets e audit log.

A v0.3 recolocou inteligência sobre esse substrato sem entregar a ela o gate.

A v0.4 acrescenta a peça que faltava: **não há um único processo epistemológico culminando no grafo persistente. Há uma máquina recursiva executada por OpenGraphs de diferentes horizontes.**

```
SESSÃO / NEGOCIAÇÃO / MICROTASK / TRANSFORMAÇÃO / PERSISTÊNCIA
                    │
                    └── em cada horizonte:

PROPOSTA
   ↓
DELIBERAÇÃO
   ↓
ADMISSÃO
   ↓
CONCRETIZAÇÃO
   ↓
VERIFICAÇÃO
   ↓
AUTORIDADE RELATIVA
   │
   └── se pretende atravessar horizonte:
               nova proposta no horizonte pai
```

Isso impede uma equivalência perigosa:

```
"o Técnico terminou"
        ≠
"a transformação está correta"
        ≠
"o projeto agora é assim"
```

O Maître governa a continuidade da relação com o operador. O Guardião interpreta o objeto e governa a deliberação sem possuir o direito de persistir. O Intermediador recebe uma mudança admitida, mantém seu OpenGraph médio e controla o loop de qualidade. Técnicos operam OpenGraphs curtos, usam ferramentas e produzem candidatos. O Epistemic Plane governa promoção. O Runtime Plane faz tudo sobreviver a ferramentas, rede, concorrência e falhas.

A definição consolidada da v0.4 é:

> **OpenGraph é um substrato epistêmico verificável que também funciona como memória governada em múltiplos horizontes. Em cada horizonte, conhecimento percorre recursivamente proposta, deliberação, admissão, concretização, verificação e autoridade; atravessar para um horizonte superior exige nova admissão. Agentes podem inferir e agir, mas nenhum resultado persiste como verdade apenas porque foi gerado ou executado.**

```
conversar ≠ saber
inferir   ≠ afirmar
executar  ≠ admitir
admitir no filho ≠ admitir no pai
persistir = atravessar um protocolo de autoridade
```

---

## Referências

[1] Lewis, P. et al. (2020). *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks.* NeurIPS. arXiv:2005.11401
[2] Yao, S. et al. (2023). *ReAct.* ICLR. arXiv:2210.03629
[3] Sumers, T. R. et al. (2024). *Cognitive Architectures for Language Agents (CoALA).* TMLR. arXiv:2309.02427
[4] Packer, C. et al. (2023). *MemGPT.* arXiv:2310.08560
[5] Hong, S. et al. (2024). *MetaGPT.* ICLR. arXiv:2308.00352
[6] Wu, Q. et al. (2023). *AutoGen.* arXiv:2308.08155
[7] Edge, D. et al. (2024). *From Local to Global: A Graph RAG Approach.* arXiv:2404.16130
[8] Dongre, V. et al. (2024). *ReSpAct.* arXiv:2411.00927
[9] Shinn, N. et al. (2023). *Reflexion.* NeurIPS. arXiv:2303.11366
[10] Madaan, A. et al. (2023). *Self-Refine.* NeurIPS. arXiv:2303.17651
[11] Zhuge, M. et al. (2024). *Agent-as-a-Judge.* arXiv:2410.10934
[12] W3C (2013). *PROV-O: The PROV Ontology.*
[13] Yang, J. et al. (2024). *SWE-agent.* arXiv:2405.15793
[14] Roynard, M. (2026). *The Missing Knowledge Layer in Cognitive Architectures for AI Agents.* arXiv:2604.11364 — Knowledge/Memory/Wisdom/Intelligence com semânticas de persistência distintas. **Verificado 10/08/2026.**
[15] Du, P. (2026). *Memory for Autonomous LLM Agents.* arXiv:2603.07670
[16] Margalit, Y. et al. (2026). *Governed Shared Memory for Multi-Agent LLM Systems.* arXiv:2606.24535 — quatro modos de falha de fleet-memory; proveniência e propagação em produção. **Verificado 10/08/2026.**
[17] Jamshidi, S. et al. (2026). *Hallucination Cascade.* arXiv:2606.07937
[18] Harel, D. (1987). *Statecharts.* Science of Computer Programming, 8(3), 231–274.
[19] Garcia-Molina, H.; Salem, K. (1987). *Sagas.* ACM SIGMOD, 249–259.
[20] Hewitt, C.; Bishop, P.; Steiger, R. (1973). *A Universal Modular ACTOR Formalism.* IJCAI.
[21] Taheri, H. (2026). *Governed Memory: A Production Architecture for Multi-Agent Workflows.* arXiv:2603.17787
[22] Lam, C. et al. (2026). *Governing Evolving Memory in LLM Agents: SSGM.* arXiv:2603.11768
[23] *Governed Collaborative Memory as Artificial Selection in LLM-Based Multi-Agent Systems* (2026). arXiv:2605.04264 — estados *rejected / abstained / superseded / ratified*.

---

## Apêndice A — Planos, coordenadas e horizontes

A v0.4 separa três conceitos que a v0.3 ainda aproximava demais.

### A.1 Planos arquiteturais

| Plano | Responsabilidade |
|---|---|
| **Cognitive Plane** | interpretação, negociação, decomposição e ação semântica |
| **Epistemic Plane** | admissão, autoridade, promoção, proveniência e gates |
| **Runtime Plane** | durabilidade, lifecycle, concorrência, mensageria e capabilities |

### A.2 Coordenadas de estado

| Coordenada | Exemplos |
|---|---|
| Durabilidade | in-memory · sessão · durável · append-only |
| Status epistêmico | proposto · admitido-no-escopo · α · β · suspended |
| Horizonte | sessão · negociação · transformação · microtask · persistente |

### A.3 Exemplos completos

| Elemento | Plano principal | Durabilidade | Status epistêmico | Horizonte |
|---|---|---|---|---|
| resposta recuperada pelo Maître | Cognitive | sessão | contextual, não persistente | sessão |
| questão aberta do Guardião | Cognitive/Epistemic | durável enquanto ativa | proposta | negociação |
| hipótese preditiva aceita | Epistemic | durável | autoritativa para instanciar transformação, não para o persistente | negociação |
| WorkOrder | Cognitive | duração da mudança | instrução, não conhecimento persistente | transformação → microtask |
| tentativa fracassada de Técnico | Cognitive/Runtime | curto | não admitida | microtask |
| ArtifactBundle aceito | Cognitive/Epistemic | duração da mudança | admitido no horizonte médio | transformação |
| claim commitada em α | Epistemic | durável | admitida; fonte mantém posse da verdade | persistente |
| claim em β | Epistemic | durável | grafo possui a verdade daquela célula | persistente |
| evento de recusa | Runtime | append-only | não é conhecimento | audit |
| lock | Runtime | vivo/TTL | não é conhecimento | operacional |

### A.4 Recursividade e promoção

```
OpenGraph de microtask
   PROPOSTA → ... → AUTORIDADE_curto
                       │
                       │ vira proposta
                       ▼
OpenGraph de transformação
   PROPOSTA → ... → AUTORIDADE_médio
                       │
                       │ vira proposta
                       ▼
OpenGraph persistente
   PROPOSTA → ... → AUTORIDADE_longo
```

O mesmo padrão vale para saída de negociação em direção à transformação. **Nenhuma seta é cópia automática.** Cada seta é uma nova fronteira de admissão.

## Apêndice B — Questões para a próxima iteração

1. Qual contrato determinístico transforma `AUTORIDADE_curto` em `PROPOSTA_médio`?
2. Qual contrato transforma `AUTORIDADE_médio` em delta candidato do persistente?
3. O OpenGraph de negociação compartilha schema/engine com o persistente ou apenas invariantes epistemológicos?
4. Como o Router detecta `CHANGE_READY` sem transformar interpretação probabilística em transição automática?
5. Qual política define `N` tentativas do loop Intermediador↔Técnico por domínio e risco?
6. Quais tools podem ser repetidas com segurança e quais exigem idempotency keys/compensação?
7. Uma descoberta crítica num OpenGraph curto deve contestar diretamente um nó médio ou produzir um evento que o Intermediador transforma em proposta?
8. Se os motores da escada forem expostos ao Guardião, quais novos testes adversariais são obrigatórios?
9. Como medir `Cross-Horizon Leakage` em CI e em sessões reais?
10. O teste visual de materiais epistêmicos sobrevive quando a interface precisa mostrar simultaneamente horizonte e autoridade?
