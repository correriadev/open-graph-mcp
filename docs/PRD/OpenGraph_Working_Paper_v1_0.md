# OpenGraph

## Arquitetura cognitiva recursiva sobre substrato epistêmico verificável: planos, horizontes e promoção de autoridade — e o protocolo que a transforma em ecossistema

**Documento de trabalho · versão 1.0-rc4 · 10 de agosto de 2026**

> **Tese central (inalterada desde a v0.2)**
> Capacidade de inferir não implica autoridade para afirmar. Capacidade de produzir não implica autoridade para persistir.
>
> **Tese de protocolo da v1.0** *(tese estratégica nova — não consequência necessária da v0.4)*
> A v1.0 propõe que a semântica central do OpenGraph — admitir, promover, contestar, revogar — **seja extraída como protocolo independente de implementação**, com o servidor atual como implementação de referência. A proposta responde uma pergunta real (se MCP é apenas transporte, que semântica permanece quando o binding troca?), mas permanece [E] até que interoperabilidade real seja demonstrada (H12).
>
> **Tese de simetria da v1.0**
> O operador humano **não é root epistemológico, mas continua sendo root intencional.** Ele é soberano sobre intenção, objetivo, preferência, aceitação de risco e autorização de ação irreversível — e sua aprovação carrega proveniência, escopo e validade. O que ele não pode, e nenhum agente pode, é fabricar evidência: a simetria entre humano e LLM é estrita **apenas na verificação**, nunca na intenção. Pessoa e modelo não são equivalentes; falíveis diante do gate, ambos são.
>
> **Tese temporal da v1.0**
> Verdade admitida é verdade versionada. Quando o persistente está errado, a correção não é edição — é **recall epistêmico**: uma cascata de suspensão calculada sobre o **grafo de derivação admitido**, admitida pelo mesmo gate, com o histórico intacto. **Corrigir é promover uma contestação, nunca reescrever o passado.** A garantia da cascata é exata sobre o que o grafo registra — e a completude do próprio grafo de derivação torna-se, por isso, uma questão de primeira classe.

---

## 0. Enquadramento: da fotografia ao protocolo

Este documento é a formulação candidata do sistema no nível 1.0. Ele não substitui a v0.4 como registro histórico; candidata-se a substituí-la como formulação vigente — e a régua dessa substituição está na §0.2. Preserva a baseline empírica, herda **integralmente** os três planos, a máquina recursiva de seis estados e os OpenGraphs por horizonte, e acrescenta quatro movimentos: os operadores de fronteira como mecanismo, o operador humano dentro da máquina, a verdade versionada com recall, e a proposta de protocolo.

```
v0.2 + repo HEAD ──► BASELINE          gates, células, α/β, âncoras — pago com implementação
      │
v0.3 ────────────► TRÊS PLANOS         inteligência separada de autoridade e de mecanismo
      │
v0.4 ────────────► RECURSIVIDADE       a mesma máquina epistemológica em todo horizonte;
      │                                memória governada = OpenGraph por horizonte
      │
AUDITORIA DA v0.4
      │  · promoção entre horizontes: narrativa, não mecanismo
      │  · operador fora da máquina — raiz de confiança implícita
      │  · "e se o persistente estiver errado?" — sem resposta
      │  · propagação de degradação entre claims indefinida
      │  · topologia de horizontes nunca declarada
      │  · ecossistema (MCP, 11 flavors) sem formalização
      ▼
     v1.0-rc3 ───► MECANISMOS + PROTOCOLO
                                       a máquina de seis estados INTACTA;
                                       promoção/contestação como operadores de fronteira,
                                       recall governado, operador escopado,
                                       coordenadas de autoridade separadas,
                                       EAP proposto como tese estratégica
```

A pergunta que a v1.0 responde:

> **O que precisa ser verdadeiro — como mecanismo, como contrato e como evidência — para que a arquitetura cognitiva recursiva deixe de ser a hipótese de um paper e vire a propriedade verificável de um ecossistema aberto — sem que a formalização altere aquilo que formaliza?**

### 0.1 Nota de versão — o que a rc3 fixou e o que a rc4 fecha

1. **`rc` significa release candidate no sentido epistemológico exato.** Este documento é uma `PROPOSTA` que completou `DELIBERAÇÃO` e define seu próprio critério de `ADMISSÃO` (§0.2). Só perde o sufixo quando a `CONCRETIZAÇÃO` (VS-1, §28) e a `VERIFICAÇÃO` (alpha v1, §29) executarem.
2. **A rc3 corrige três regressões de tipo conceitual da rc2**, identificadas em auditoria contra a v0.4: (a) a rc2 **trocou a máquina recursiva ao formalizá-la** — `CONCRETIZAÇÃO` desapareceu do ciclo e `PROMOTE` entrou no lugar; a rc3 restaura a máquina de seis estados e reclassifica `PROMOTE`/`CONTEST` como **operadores de fronteira entre ciclos** (§5); (b) a rc2 **colapsou três coordenadas distintas numa escala total** `none < proposto < α < β`, contrariando a definição explícita da v0.4 de que autoridade relativa não é β e de que α/β responde *quem possui a verdade da célula*, não *quanta verdade ela tem*; a rc3 separa status epistêmico, posse da verdade e autoridade relativa de horizonte (§11); (c) a rc2 chamou de "memória de trabalho crua" o que não pode ser memória — a rc3 renomeia para **estado transitório não-memorial de execução** e restaura a Lei 9 e R6 sem relaxamento (§20).
3. **Quatro correções estruturais adicionais:** a tese de protocolo é reformulada como proposta estratégica, não como fato consumado (§5); os níveis de conformidade distinguem **agente-cliente** de **horizon host** — nenhum agente é L2 (§5.3, §12); a fronteira determinístico/probabilístico é reformulada — *julgamento semântico pode ser probabilístico; transição de autoridade é governada deterministicamente* (§5.1, §12); a garantia do recall é escopada ao grafo de derivação admitido, e a completude desse grafo vira questão aberta de primeira classe (§10, §35).
4. **Uma lacuna nova é fechada:** a topologia de horizontes é declarada explicitamente como DAG de fronteiras de promoção — *pai* significa fronteira de promoção, não duração maior (§6).
5. **Nenhum invariante da baseline é revogado.** I1–I10 permanecem integrais (§1). As nove leis da v0.4 permanecem e ganham três (§34).
6. **O que não gradua não finge graduar.** Federação ativada, sandbox real, a cidade completa e os baselines externos são explicitamente 1.x (§35).
7. **A rc4 é cirúrgica e declara o congelamento conceitual.** A auditoria da rc3 não encontrou regressão estrutural — encontrou cinco ambiguidades de segunda ordem, do tipo que só aparece quando a arquitetura fica formal o suficiente para ser implementada: a semântica universal de `CONCRETIZE` (§5.1.1), a tipagem única de `suspended` (§11, D-16), o contrato de iniciação `sessão → negociação` (§6.1), a distinção nominal entre as duas máquinas (§5.1.2, Apêndice B) e o endurecimento de `STALE_BASE` (§7). A rc4 as fecha e **para**: continuar melhorando no papel a partir daqui contrariaria [G1]. O próximo ganho de autoridade não vem de outra formulação — vem de VS-1a → VS-1b → VS-1c → alpha v1. **Pensar mais deixou de ser a próxima etapa correta; concretizar passou a ser.**

### 0.2 Regras de graduação *[G]*

| Marca | Significa |
|---|---|
| **[G]** | Critério de graduação — condição objetiva, verificável, que precisa ser satisfeita para a rc virar v1.0 final |

Duas regras, sem exceção:

> **[G0] Teste de compatibilidade v0.4 → v1.0.** A v1.0 pode adicionar mecanismos **ao redor** da máquina recursiva; não pode mudar a máquina recursiva, nem confundir autoridade relativa de horizonte com posse α/β da verdade. Qualquer formulação desta versão que falhe neste teste é regressão, não evolução — e a rc2 falhou nele duas vezes antes desta correção.
>
> **[G1] A v1.0 final não contém nenhuma tese central em [E].** Cada [E] termina em um de três destinos: **[B]** (evidência no repositório, teste identificado), **revogada** (com registro em §36), ou **rebaixada a 1.x** (fora do escopo de graduação, sem fingir prova). Um paper que se promove sem atravessar o próprio gate comete a fraude que o sistema existe para impedir.

### 0.3 Marcas de estado e as duas convenções de derivabilidade

| Marca | Significa |
|---|---|
| **[B]** | Baseline conquistada — evidência no repositório, teste de regressão, commit identificado |
| **[C]** | Construído e desligado — código vendorado, nunca exercitado. Não é prova |
| **[E]** | Evolução proposta nesta versão — precisa de justificativa e de teste de não-regressão |
| **[A]** | Aberto — requisito reconhecido, desenho não resolvido |
| **[G]** | Critério de graduação — o que separa rc de final |

A rc mantém as duas convenções que definem o padrão "digno de derivação" — que um PRD e um conjunto de ADRs possam ser extraídos deste documento *mecanicamente*:

**Convenção 1 — blocos de decisão.** Toda decisão arquitetural relevante aparece como bloco numerado: decisão, **alternativas rejeitadas** (uma decisão sem alternativas rejeitadas é uma preferência não examinada), **consequências**, **reversibilidade**.

**Convenção 2 — critérios de aceite.** Todo mecanismo novo termina com sua condição de graduação [G] em forma verificável: qual teste, contra qual adversário, com qual veredito observável **por log** — nunca por autorrelato, lição que o alpha v0 pagou para ensinar.

---

# Parte I — Baseline e diagnóstico

## 1. Invariantes que a v1.0 não pode destruir *[B]*

Herdados integralmente da v0.4 §1, com a evidência que os pagou. A evolução pode reinterpretar, mover de camada ou renomear. **Não pode revogar.**

| # | Invariante | Como foi conquistado |
|---|---|---|
| **I1** | Toda claim carrega âncora verbatim re-checável; âncora inexistente é bloqueio duro, não aviso | gate recusa ao vivo `anchor not found verbatim` |
| **I2** | β exige prova de cobertura fechada; célula com nó descoberto não promove | `coverage not balanced in β cell` |
| **I3** | β é privilégio revogável; drift graduado: `structural → suspended`, `gone → source`; `lexical/renamed` não demovem | evolução do tripwire `drift.node → authority.demoted → watch.converged` |
| **I4** | Escada valida atomicamente no commit: adjacência, raízes nos extremos, sem órfão, sem ciclo | commit atômico com `admitSeq` |
| **I5** | Chave de célula tem forma canônica única em toda fronteira | pago com F1 e F7, dois críticos |
| **I6** | Recusa é registrada como recusa, com razões | pago com 59 chamadas logadas `ok:true` e zero claims |
| **I7** | Knowledge graph e audit log permanecem separados | regra canônica: JSONL durável, SQLite derivado |
| **I8** | Camada viva nunca é requisito; todo fluxo tem fallback por polling | pago com MP-1 |
| **I9** | Verificação nunca depende de rede no gate | herdado; vale inclusive para refs federadas |
| **I10** | Evidência não se fabrica: feature bloqueada fica bloqueada | 2 BLOCKED e 2 FAILED de 9, sem invenção |

E, elevada pela rc3 ao mesmo nível de proteção, a definição estrutural da v0.4 que [G0] blinda:

> **A máquina recursiva tem seis estados — `PROPOSTA → DELIBERAÇÃO → ADMISSÃO → CONCRETIZAÇÃO → VERIFICAÇÃO → AUTORIDADE` — e executa integralmente dentro de cada horizonte. Autoridade relativa não é β.**

I5 e I6 continuam merecendo destaque porque não são propriedades de desenho — são cicatrizes. A lição transversal permanece a carga de projeto mais pesada: **a patologia que a arquitetura existe para impedir numa LLM apareceu na implementação que a impede.** Um gate que falha em silêncio produz confiança sem garantia. Todo mecanismo novo nasce com um teste que tenta burlá-lo — e o catálogo de ameaças da §17 torna "tentar burlá-lo" um programa enumerado. A rc3 acrescenta o corolário meta: **uma formalização que falha em silêncio é igual — produz a sensação de rigor enquanto troca aquilo que formaliza.** Foi o defeito da rc2, e [G0] é seu tripwire.

## 2. Forças da v0.4 que a v1.0 explora

1. **A disciplina epistemológica autoaplicada.** Marcas de estado, cicatrizes nomeadas (F1–F8, MP-1..3), meta-análise por versão. É o que permite à rc3 ser ousada sem mentir: ousadia arquitetural e honestidade epistêmica são ortogonais quando cada afirmação carrega sua marca.
2. **A máquina recursiva de seis estados.** Uma máquina em todo horizonte, mudando apenas escopo, tempo de vida e o que a autoridade relativa habilita. É a hipótese mais econômica e mais falsificável do sistema — e é intocável por [G0]: esta versão a instrumenta, não a edita.
3. **As duas rotas.** Rota epistêmica obrigatória para verdade; rota operacional permitida para ação. *Ação no mundo não é autoridade sobre o mundo.* O Capability Gateway (§16) concretiza a fronteira — e a rota operacional é exatamente onde a `CONCRETIZAÇÃO` do ciclo acontece, o que a rc2 perdeu de vista ao removê-la.
4. **A baseline paga.** Gate cego ao chamador, células com forma canônica, drift graduado, changesets atômicos, `seq` monotônico, locks por célula, MCP como fronteira cliente-agnóstica, duas camadas de cliente com fallback. Nada disso é promessa; é o chão sobre o qual a Parte III executa.
5. **O fracasso informativo do alpha v0.** O braço com MCP não usou o servidor uma única vez, verificado por log; a especificação (199 linhas) era maior que o artefato (184). A lição redesenha o alpha v1 (§29) e eleva um método: **autorrelato não conta, nunca.**
6. **O embrião de ecossistema já commitado.** Registry de adapters com doctor, install e `AgentFlavorDef` para 11 flavors. A fronteira cliente-agnóstica não é aspiração: é o HEAD do repositório.

## 3. Fraquezas da v0.4 e onde a v1.0 as ataca

| # | Fraqueza | Onde é atacada |
|---|---|---|
| W1 | Cognitive Plane inteiro em [E], sem uma linha executada | VS-1 em três fases (§28) |
| W2 | Promoção entre horizontes é narrativa ("vira proposta"), não mecanismo | `PromotionProposal` (§7) |
| W3 | `CHANGE_READY` sem condição determinística | predicado triplo (§13) |
| W4 | Programa de avaliação sem harness; métricas jamais coletadas | harness D×E (§29, §31) |
| W5 | Custo da recursividade não modelado | contabilidade e budgets (§20) |
| W6 | Proveniência e supersessão [A] no coração do "contrato estável" | esquema mínimo decidido (Apêndice A) |
| W7 | Capability Gateway é caixa nomeada | classes de efeito (§16) |
| W8 | Greenfield declarado "o mecanismo", mas é código morto | teste-antes-de-ligar (§21) |
| W9 | R6 exige memória governada; nada mede se isso paga o custo | scratch não-memorial (§20) + H4/H9 (§30) |
| W10 | `WAITING_HUMAN` sem contrato; operador fora da máquina | operador como root intencional escopado (§14), escalonamento (§15) |
| W11 | "E se o persistente estiver errado?" sem resposta | recall epistêmico (§10) |
| W12 | Propagação de degradação entre claims derivadas indefinida | coordenadas e regras de propagação (§11) |
| W13 | Topologia de horizontes jamais declarada — "pai" era intuição | topologia como DAG normativo (§6) |

W1–W10 estão declaradas na própria v0.4. W11–W13 são as que a auditoria das rc acrescentou. W11 e W12 tocam a tese central: um sistema cuja verdade admitida não pode ser corrigida de forma governada apenas mudou o lugar onde a contaminação se esconde; e um gate perfeito com propagação indefinida verifica cada claim individualmente enquanto a *combinação* degradada passa incólume. W13 é a condição de possibilidade da promoção mecânica: "não pode saltar o pai" não significa nada até que se declare quem é pai de quem.

## 4. Os paradigmas que a v1.0 quebra

| Paradigma vigente (2026) | Ruptura v1.0 | Onde |
|---|---|---|
| Memória de agente é um vector store anexado ao modelo | Memória é um grafo governado por horizonte, com ciclo próprio e destruição legítima | §19 |
| Agente mais capaz ⇒ resultado mais confiável | Capacidade e autoridade são ortogonais; capacidade jamais compra promoção | §11 |
| *Human-in-the-loop* como raiz incontestável de confiança | Operador é root intencional com aprovação escopada — soberano sobre risco, impotente sobre evidência | §14 |
| Corrigir conhecimento = sobrescrever / re-treinar / re-indexar | Corrigir = recall governado com cascata calculada e histórico imutável | §10 |
| Frameworks multiagente possuem a pilha inteira | Proposta de protocolo com níveis de conformidade; qualquer flavor conecta pela borda | §5 |
| Integração de conhecimento = pipeline de RAG | Gestão de dependência de conhecimento: torres, manifesto assinado, semver de intenção | §23 |
| Confiança expressa em scores probabilísticos | Autoridade conquistada por prova e revogável por drift ou recall — nunca por probabilidade | §11 |
| Verdade do sistema = estado atual do banco | Verdade é versionada por `seq`; toda interpretação declara sua base e é contestável retroativamente | §10 |

Quatro rupturas merecem o argumento por extenso, porque não são refinamentos — são inversões:

**A inversão da memória.** O paradigma corrente trata memória como recuperação: o que importa é *achar* o que foi dito. O OpenGraph trata memória como jurisdição: o que importa é *o que aquilo tem o direito de influenciar*. Um embedding recuperado com similaridade 0.97 e uma claim de célula β são objetos de categorias diferentes — o primeiro é um palpite de relevância; a segunda vive numa célula cuja verdade o grafo possui por prova de cobertura, revogável por drift. Sistemas que misturam os dois no mesmo contexto de modelo fazem lavanderia de autoridade em escala industrial, e a literatura de 2026 já documenta o resultado como modo de falha de frota [16][17].

**A inversão do humano — com a soberania preservada.** "Human-in-the-loop" corrente é um botão de aprovação fora da máquina: o humano vê algo, clica, e o sistema trata o clique como verdade. O clique não carrega escopo nem expira. A inversão da v1.0 é precisa e parcial: o humano entra na máquina **como root intencional** — a intenção, o objetivo, a aceitação de risco e a autorização do irreversível são dele e de mais ninguém — mas sua aprovação vira objeto governado (escopo, proveniência, validade), e nenhum clique fabrica evidência. Pessoa e LLM não viram equivalentes; viram igualmente incapazes de atravessar o gate sem chão.

**A inversão da correção.** Sobrescrever é a correção padrão da computação; é também a destruição do rastro. Em um sistema epistemológico, a pergunta "o que acreditávamos quando decidimos X?" é frequentemente mais valiosa que "o que acreditamos agora" — porque é ela que explica por que X foi decidido e o que mais está contaminado pela mesma crença. O recall (§10) paga o custo de manter a vergonha visível para comprar a capacidade de calcular a contaminação — na exata extensão do que o grafo de derivação registrou, e nem um milímetro além (§10.2).

**A proposta do protocolo.** MCP [24] e A2A [29] padronizam *como agentes falam e o que podem fazer*. Nenhum protocolo corrente padroniza *o que agentes têm o direito de afirmar*. Temos interoperabilidade de capacidade sem interoperabilidade de autoridade. O EAP (§5) é a aposta de que essa lacuna é o próximo degrau da infraestrutura de agentes — uma aposta estratégica nova desta versão, apresentada como tal.

---

# Parte II — A proposta de protocolo: o EAP

## 5. Epistemic Admission Protocol *[E — TESE ESTRATÉGICA v1.0]*

A baseline construiu um servidor. A v0.4 construiu uma arquitetura. A v1.0 **propõe** o passo que nenhum dos dois implica sozinho:

> **Que a semântica central do OpenGraph seja extraída como protocolo independente de implementação — a máquina recursiva, os operadores de fronteira, a correção, as recusas e as regras de propagação como contrato de conformidade — com o servidor do repositório como implementação de referência.**

A analogia estrutural é deliberada: HTTP não é um servidor web; SemVer não é um package manager; SLSA não é um build system [26]. Mas a analogia é aspiração, não estado: esses protocolos provaram valor com múltiplas implementações interoperando, e o EAP tem exatamente uma. Por isso a formulação correta não é "OpenGraph deixa de ser X e passa a ser Y" — é: **a v1.0 propõe a extração, define o critério de conformidade e amarra a tese a H12.** Se três flavors reais não passarem L0–L1 sem adaptação server-side específica, a tese de protocolo rebaixa a tese de produto, com registro.

O que a proposta já resolve mesmo antes da prova: a direção da dependência. A semântica dos verbos vive no EAP e o binding apenas a transporta (§5.4) — o que significa que trocar MCP por outro transporte não pode alterar o que `ADMIT` significa. **Se alterar, o protocolo vazou**, na mesma acepção em que a v0.4 §5 define vazamento do Epistemic Plane.

> **Decisão D-1 — Propor protocolo, manter produto.** A semântica é especificada como contrato independente; o servidor vira implementação de referência; a tese permanece [E] amarrada a H12. **Alternativas rejeitadas:** (a) declarar o protocolo como fato consumado — fabricaria por linguagem o que só interoperabilidade real prova (foi o erro de formulação da rc2, corrigido); (b) não extrair protocolo e escalar produto fechado — obriga a portar o produto para cada agente, contra a consequência estratégica já paga pela fronteira MCP; (c) framework de agentes com grafo embutido — negado desde a v0.2. **Consequências:** especificar custa (verbos, recusas, conformidade); o ganho é que o teste adversarial vira teste de protocolo. **Reversibilidade:** alta — H12 falhando, o EAP colapsa a documentação interna sem perda de mecanismo.

### 5.1 A máquina, os operadores de fronteira e a correção *[E — estrutura corrigida na rc3]*

A rc2 apresentou "cinco verbos de ciclo" em que `CONCRETIZE` havia desaparecido e `PROMOTE` entrara no lugar. **Isso não era uma formalização da v0.4 — era outra máquina**, e [G0] a recusa. A estrutura correta separa três categorias:

```
MÁQUINA RECURSIVA — executa INTEIRA dentro de cada horizonte

PROPOSE
   ↓
DELIBERATE
   ↓
ADMIT
   ↓
CONCRETIZE
   ↓
VERIFY
   ↓
AUTHORITY_relativa        ◄── estado resultante, não verbo


OPERADORES DE FRONTEIRA — entre ciclos, nunca dentro deles

PROMOTE     autoridade_relativa completa no filho  ──►  PROPOSE no pai (topologia §6)
CONTEST     evidência em qualquer horizonte        ──►  desafio a conteúdo admitido em outro
INITIATE    contexto com proveniência              ──►  PROPOSE em horizonte novo,
                                                        sem transferir autoridade (§6.1)


CORREÇÃO — sobre o estado persistente

RECALL      contestação invalidante admitida       ──►  cascata calculada (§10)
```

`PROMOTE` não pertence ao ciclo interno: é o operador que converte o desfecho de um ciclo (`AUTHORITY_relativa`) no início de outro (`PROPOSE` no pai). `CONTEST` é o operador simétrico de desafio. `RECALL` é um mecanismo especial sobre o persistente. A recursividade da v0.4 fica assim **preservada e instrumentada**: a máquina não mudou; ganhou operadores ao redor.

Pré-condições, pós-condições e modos de recusa:

| Elemento | Pré-condição | Pós-condição | Modos de recusa (§5.2) |
|---|---|---|---|
| `PROPOSE` | proponente com escopo de submissão; conteúdo com âncoras e proveniência; `based_on_seq` declarado | candidato registrado no horizonte, status `proposed`; nada mudou de autoridade | `PROVENANCE_MISSING` · `TURN_SCOPE` · `STALE_BASE` (aviso) |
| `DELIBERATE` | existe candidato `proposed` | questões, conflitos, resoluções e assumptions registrados; `SUPPORTED/UNKNOWN/AMBIGUOUS/INFERRED/CONFLICTING` distinguíveis | não recusa — registra |
| `ADMIT` | candidato deliberado; gate do horizonte disponível | veredito cego ao chamador: `admitted` no escopo do horizonte, ou recusa com razões | taxonomia de admissão (§5.2) |
| `CONCRETIZE` | conteúdo admitido no escopo; budget disponível | **o conteúdo admitido materializado na forma concreta própria do horizonte** (§5.1.1); onde a materialização tem efeito externo, atravessa o gateway (§16) com evidências de execução | `TOOL_UNCLASSIFIED` · `TOOL_OUT_OF_CONTRACT` · `BUDGET_EXHAUSTED` |
| `VERIFY` | concretização com evidência re-checável offline | verificação concedida/negada; no persistente, é onde cobertura sustenta posse β e drift/recall degradam | `ANCHOR_NOT_FOUND` · `COVERAGE_UNBALANCED` · `ROUNDTRIP_FAILED` |
| `AUTHORITY_relativa` | ciclo completo no horizonte | o horizonte pode exercer o que sua autoridade relativa habilita (tabela da v0.4 §4.2) — e **nada além** | — estado, não verbo |
| `PROMOTE` | `AUTHORITY_relativa` completa; `PromotionProposal` válida (§7); alvo é o pai topológico | candidato `proposed` no pai — **nunca mais que isso** | `HORIZON_SKIP` · `AUTHORITY_REF_INVALID` · `ASSUMPTION_DROPPED` · `STALE_BASE` |
| `CONTEST` | evidência ancorável contra alvo admitido | evento tipado com severidade; Router decide transição | `EVIDENCE_REQUIRED` |
| `INITIATE` | contexto relevante num horizonte de origem; intenção declarada | seed registrado como `PROPOSE` no horizonte novo — referências e proveniência atravessam; **autoridade não** (§6.1) | `PROVENANCE_MISSING` |
| `RECALL` | `Contestation(invalidante)` admitida contra o persistente | cascata sobre o grafo de derivação admitido; histórico intacto; `seq` avança | `RECALL_UNPROVEN` · `DIRECT_EDIT_FORBIDDEN` |

#### 5.1.1 A semântica universal dos seis estados *[E — correção da rc4]*

A rc3 associou `CONCRETIZE` à rota operacional e ao Tool Gateway. Isso é verdadeiro **apenas onde há efeito externo** — microtask e transformação. Tomado como definição, deixaria a máquina nominalmente recursiva mas semanticamente definida só no horizonte técnico. A definição universal:

> **`CONCRETIZE` = materializar o conteúdo admitido na forma concreta própria daquele horizonte.** O Capability Gateway é a implementação da sua borda externa em certos horizontes — não a sua definição.

E o mesmo vale para os outros cinco: implementações diferem por horizonte; **a relação abstrata precisa sobreviver aos cinco.** A tabela normativa — não para igualar implementações, mas para demonstrar que a mesma abstração atravessa:

| | Sessão | Negociação | Transformação | Microtask | Persistente |
|---|---|---|---|---|---|
| `PROPOSE` | pergunta / intenção do operador | questão, hipótese candidata | decomposição / WorkOrder candidata | abordagem candidata da tarefa | claim / delta candidato |
| `DELIBERATE` | confronto com o já respondido | questões, conflitos, assumptions | dependências, riscos, ordenação | tentativas e alternativas | análise de impacto, revisão |
| `ADMIT` | ponto aceito como resolvido na sessão | questão aceita no escopo da negociação | WorkOrder emitida sob contrato | abordagem aceita para execução | claim admitida pelo gate |
| `CONCRETIZE` | resposta contextualizada / decisão explicitada | hipótese preditiva / contrato candidato | composição coerente dos resultados aceitos | artefato / teste / análise / ação (via gateway §16) | delta incorporado ao objeto oficial |
| `VERIFY` | resposta confrontada com o persistente (`seq`) | hipótese confrontada com estado e operador | resultados confrontados com o contrato | evidência de execução re-checável | âncora, cobertura, roundtrip |
| `AUTHORITY_relativa` | não reabrir o ponto na sessão | instanciar a transformação | propor promoção ao persistente | devolver resultado aceito ao médio | compor o estado oficial versionado |

As três relações que **nunca** mudam de significado, em qualquer coluna:

- `ADMIT` sempre significa: *algo saiu de candidato e foi aceito como base legítima para a concretização naquele horizonte.*
- `VERIFY` sempre significa: *confrontar o concretizado com aquilo que foi admitido.*
- `AUTHORITY_relativa` sempre significa: *o verificado passa a poder governar operações dentro daquele horizonte — e nada além.*

A VS-1 verifica a **relação**, não os rótulos: seis labels não são seis estados. Uma implementação cujo `ADMIT` de sessão não distingue candidato de aceito tem cinco estados com seis nomes — e falha a conformidade L3 por semântica, não por sintaxe.

#### 5.1.2 Duas máquinas, declaradas como duas *[E — correção da rc4]*

O documento contém dois autômatos, e o leitor não deve descobri-lo sozinho:

```
EPISTEMIC LIFECYCLE MACHINE          "em que estágio epistemológico está este
  (§5.1 — por OpenGraph)              conhecimento, neste OpenGraph?"

WORKFLOW ORCHESTRATION STATECHART    "em que estágio operacional está a
  (Apêndice B — do Router)            sessão/mudança como um todo?"
```

`Workflow: EXECUTING` **não** significa que todos os OpenGraphs estão em `CONCRETIZE`. Num instante real: `WO-1 → AUTHORITY`, `WO-2 → VERIFY`, `WO-3 → DELIBERATE` — e o workflow simplesmente `EXECUTING`. A composição é **coordenação de autômatos**: os hosts possuem os lifecycles; o Router observa-os e decide as transições do workflow — um produto coordenado, não uma máquina única. Confundi-las na implementação produziria a versão de statechart do erro que I5 pagou: duas semânticas sob um nome.

A linha divisória do protocolo — corrigida. A rc2 afirmou "DELIBERATE é o único verbo probabilístico; todos os que decidem são determinísticos", e isso contradiz a própria arquitetura: o Intermediador existe *porque* avaliar qualidade exige inteligência, e "esta arquitetura está coerente?", "este contrato satisfaz a intenção?", "este layout resolve a necessidade?" não têm teste determinístico. A formulação correta:

> **Julgamento semântico pode ser probabilístico — em qualquer verbo cujo conteúdo o exija. Transição de autoridade é governada deterministicamente — sem exceção.** Um agente pode concluir probabilisticamente "considero adequado" (`AuditAssessment`); a consequência disso — admitir no OpenGraph do horizonte — segue o protocolo daquele horizonte (`AuditDecision`), com registro, razões e as guardas mecânicas de sempre. O modelo recomenda; a estrutura transita.

É a Lei 5 da v0.4 com a granularidade que faltava: conteúdo e fluxo não se separam por verbo — separam-se por natureza, dentro de cada verbo.

> **Decisão D-2 — Máquina intocada, operadores ao redor.** O EAP formaliza a máquina de seis estados exatamente como a v0.4 a define, e adiciona `PROMOTE`/`CONTEST` como operadores de fronteira e `RECALL` como correção. **Alternativas rejeitadas:** (a) o ciclo de cinco verbos da rc2 com `PROMOTE` embutido — muda a máquina (viola [G0]) e apaga a `CONCRETIZAÇÃO`, que é onde a rota operacional inteira vive; (b) API CRUD sobre nós e claims — perde a distinção entre escrever e admitir, que é a tese; (c) verbos livres por extensão — cada extensão é um vetor de contorno do gate. **Consequências:** a especificação carrega uma assimetria visível (máquina ≠ operadores ≠ correção) que implementações precisam respeitar; é deliberado — a assimetria *é* a arquitetura. **Reversibilidade:** nenhuma dentro de [G0].

### 5.2 Recusa é resultado de primeira classe: a taxonomia *[B → E]*

I6 estabeleceu que recusa é registrada como recusa, com razões. A v1.0 eleva as razões a vocabulário do protocolo — um ecossistema não nasce sobre recusas de texto livre que cada implementação inventa:

| Grupo | Código | Emitido quando | Obrigação do cliente conforme |
|---|---|---|---|
| Admissão | `ANCHOR_NOT_FOUND` *[B]* | âncora verbatim não resolve no chão | corrigir a âncora; **não** re-submeter idêntico |
| Admissão | `COVERAGE_UNBALANCED` *[B]* | célula candidata a posse β com nó descoberto | completar cobertura ou renunciar a β |
| Admissão | `CELL_KEY_NONCANONICAL` *[B]* | grafia de célula fora da forma canônica | normalizar — jamais criar a célula na grafia nova |
| Admissão | `LADDER_VIOLATION` *[B]* | adjacência/raiz/órfão/ciclo na escada — estendida a ciclos no grafo de derivação (§11) | reestruturar o changeset |
| Admissão | `PROVENANCE_MISSING` *[E]* | candidato sem cadeia mínima (Apêndice A) | completar proveniência |
| Fronteira | `HORIZON_SKIP` *[E]* | `target_horizon` não é o pai na topologia declarada (§6) | propor ao pai topológico |
| Fronteira | `AUTHORITY_REF_INVALID` *[E]* | `source_authority_ref` inexistente ou ciclo incompleto no filho | completar o ciclo no horizonte de origem |
| Fronteira | `ASSUMPTION_DROPPED` *[E]* | assumption presente no filho ausente da proposta | reintroduzir ou resolver com registro |
| Fronteira | `STALE_BASE` *[E]* | `based_on_seq` anterior ao `seq` corrente | para **promover**: rebase/revalidação, sem exceção; `OperatorApproval` de defasagem autoriza apenas continuar concretizando sob risco (§7) |
| Operador | `SCOPE_EXCEEDED` *[E]* | aprovação fora do `scope` declarado | re-escalar com escopo correto |
| Operador | `APPROVAL_EXPIRED` / `APPROVAL_STALE_SEQ` *[E]* | `ttl` vencido / `based_on_seq` defasado | obter aprovação nova — consentimento antigo não é consentimento |
| Operador | `EVIDENCE_REQUIRED` *[E]* | tentativa de aprovar o inaprovável: criar âncora, dar cobertura, cancelar cascata | não existe caminho — recusa terminal por desenho |
| Execução | `TOOL_UNCLASSIFIED` *[E]* | tool sem classe de efeito declarada | classificar no adapter; até lá, tratada como irreversível |
| Execução | `TOOL_OUT_OF_CONTRACT` *[E]* | classe irreversível sem autorização nomeada no contrato | escalar ao operador |
| Execução | `BUDGET_EXHAUSTED` *[E]* | budget do horizonte esgotado | escalonamento — nunca promoção (R9) |
| Execução | `TURN_SCOPE` *[B]* | submissão fora do escopo do turno | aguardar/adquirir o turno |
| Correção | `RECALL_UNPROVEN` *[E]* | recall sem evidência que o sustente | recall também atravessa gate — não é arma gratuita |
| Correção | `REHAB_WITHOUT_PROOF` *[E]* | reabilitação de célula suspensa sem prova nova | percorrer o caminho normal de verificação |
| Correção | `DIRECT_EDIT_FORBIDDEN` *[E]* | qualquer escrita no persistente fora de changeset admitido | não existe caminho legítimo (R8) |

Duas propriedades importam mais que os códigos: **cada código nomeia a causa real** (Refusal Fidelity, §31 — uma recusa genérica é quase tão inútil quanto uma aprovação vácua), e **a obrigação do cliente faz parte do contrato** — quem re-submete cegamente após `ANCHOR_NOT_FOUND` não é persistente; é não-conforme.

> **Decisão D-3 — Taxonomia fechada de recusas.** Códigos de recusa são vocabulário do EAP, com obrigação de cliente associada. **Alternativas rejeitadas:** texto livre (não interopera, não mede); códigos numéricos sem semântica de obrigação (dizem o que houve, não o que fazer). **Consequências:** recusas novas exigem revisão do protocolo — fricção deliberada. **Reversibilidade:** média — adicionar é barato; remover ou alterar semântica quebra clientes.

### 5.3 Níveis de conformidade: agente-cliente ≠ horizon host *[E → G]*

A rc2 atribuiu "L2" ao Intermediador — e isso reaproximava perigosamente o agente de ser a autoridade, o exato erro que a v0.2 pagou para banir. A correção separa dois papéis que a conformidade certifica:

```
AGENTE  =  cliente cognitivo do EAP        (propõe, delibera, concretiza, recomenda)
HOST    =  componente que hospeda o        (gate, células, admissão, verificação,
           protocolo em um horizonte        propagação — determinístico)
```

| Nível | Certifica | Implementa | Estado no repo |
|---|---|---|---|
| **L0** | cliente leitor | query, `history/since`, resources; entende recusas; nunca trata resposta de um horizonte como autoritativa fora dele | **[B]** — qualquer cliente MCP genérico |
| **L1** | cliente propositor | staging, ciclo de changeset, `PROPOSE`/`DELIBERATE`; recusa como resultado de primeira classe; `based_on_seq` sempre | **[B]** — fluxo completo exercitado (F1–F8) |
| **L2** | **host** admissor | gate, células, escada, posse α/β, drift, `ADMIT`/`VERIFY`; cego ao chamador; offline | **[B]** — o servidor de referência |
| **L3** | **host** recursivo | horizontes com perfis, topologia declarada, `PROMOTE`/`CONTEST`, contratos da Parte III, statechart | **[E]** — gradua com VS-1 |
| **L4** | **host** federado | manifesto assinado, torres estrangeiras, semver de intenção, `RECALL` federado por importação | **[C]** — mecanismo vendorado, ativação 1.x |

A consequência arquitetural, que corrige a rc2:

> **Nenhum agente é L2. Nunca.** O Maître, o Guardião, o Intermediador e os Técnicos são clientes L0/L1 dos hosts dos horizontes em que operam. O Intermediador **governa cognitivamente** a transformação — decompõe, avalia, recomenda; o **Medium Horizon Host** governa epistemicamente o estado — admite, recusa, propaga. `Guardião ≠ autoridade`, `Intermediador ≠ autoridade`, `Técnico ≠ autoridade`, `Maître ≠ autoridade`: a lista da v0.4 fica inteira, e agora tem forma de conformidade.

A assimetria dos níveis é o que torna a adoção plausível: **a maioria absoluta do ecossistema só precisa de L0–L1.** Um flavor que sabe propor bem e ler recusas honestamente já participa de tudo que importa; hospedar horizontes é papel de infraestrutura, não de cliente — o análogo de "todo site fala HTTP; pouquíssimos implementam um servidor HTTP".

**Critério de aceite [G2]:** checklist executável (Apêndice D) e pelo menos **três flavors distintos** do registry passando L0–L1 contra a implementação de referência, cada item verificado por log do host — nunca por autorrelato do agente.

### 5.4 MCP é o primeiro binding, não o protocolo *[B, reinterpretado]*

A fronteira MCP (tools + resources) da baseline é o binding de transporte de referência — como HTTP/1.1 foi o primeiro binding de REST sem esgotá-lo. A consequência estratégica da v0.4 permanece com nome: não se porta o produto para cada agente; entrega-se o endpoint compliant e um plugin fino por flavor.

### 5.5 O registry de adapters é a borda do ecossistema *[B → E]*

O HEAD contém o embrião: `AgentFlavorDef` com 11 flavors, doctor e install. Na v1.0 o adapter ganha as duas metades que faltam: **declarar o nível de conformidade do flavor** (insumo de [G2]) e **declarar a classificação de efeito das tools que o flavor traz** (insumo do gateway, §16). O adapter negocia o que cada agente *pode fazer* — sem jamais negociar o que o host *aceita*. As duas negociações são de planos diferentes; mantê-las separadas é a distinção entre autorização operacional e mérito epistêmico que a baseline pagou para aprender (v0.4 §3.2).

---

# Parte III — Fronteiras: topologia, promoção, contestação, correção

A alegação central — *autoridade no filho não é autoridade no pai* — só é arquitetura se o atravessamento for mecanismo. Mecanismo exige três coisas que esta parte entrega em ordem: **saber quem é pai de quem** (§6), **o contrato do atravessamento** (§7–§9), **a correção quando o topo está errado** (§10) — e as regras de propagação que amarram tudo (§11).

## 6. A topologia de horizontes *[E — lacuna fechada na rc3]*

"Não pode saltar o pai" não significa nada até que se declare quem é pai de quem — e a v0.4 nunca declarou. A intuição de uma cadeia linear por duração (`sessão → negociação → transformação → microtask`) está **errada** em dois pontos: sessão não é pai de promoção de negociação (é o horizonte de continuidade do Maître, e pode existir uma sessão inteira sem mutação alguma), e microtask promove *para cima*, para a transformação que a instanciou.

A v1.0 declara a topologia como **DAG de fronteiras de promoção**, em que `parent` significa exatamente *fronteira de promoção* — nunca "dura mais" ou "contém":

```
                sessão
                  │
                  │  inicia (não é fronteira de promoção:
                  │  nada da sessão atravessa por aqui)
                  ▼
             negociação
                  │
                  │  PROMOTE: hipótese aceita → contrato
                  ▼
             transformação
               ▲  ▲  ▲
               │  │  │  PROMOTE: PromotionProposal
             micro micro micro
                  │
                  │  PROMOTE: PersistentDelta
                  ▼
             persistente
```

Relações normativas:

| Horizonte | Fronteira de promoção (pai topológico) | O que atravessa |
|---|---|---|
| sessão | **∅** — continuidade não é promoção | nada; a sessão *inicia* negociações, não promove conteúdo |
| negociação | transformação | `AcceptedPredictiveHypothesis` via `ChangeContract` |
| microtask | transformação (a que a instanciou) | `PromotionProposal` |
| transformação | persistente | `PersistentDelta` |
| persistente | ∅ — é o topo; só o recall o corrige | — |

Três consequências:

1. `HORIZON_SKIP` ganha definição precisa: recusa quando `target_horizon` não é o pai **na topologia declarada** — não "um nível acima numa fila imaginária".
2. `CONTEST` viaja por qualquer aresta do DAG, em qualquer direção — desafiar não exige fronteira de promoção, exige evidência (§9).
3. A topologia é **declarada pelo host L3 e verificável pelo checklist** — implementações podem estender o DAG (novos horizontes especializados), nunca torcê-lo silenciosamente.

> **Decisão D-4 — Adjacência pela topologia declarada.** Toda promoção atravessa exatamente uma fronteira do DAG normativo. **Alternativas rejeitadas:** (a) cadeia linear por duração — falsa (sessão) e ambígua (negociação vs microtask); (b) salto com "endosso" do intermediário — autoridade por assinatura, R1 com passos extras; (c) promoção direta com auditoria posterior — auditoria posterior de contaminação é limpeza, não prevenção. **Consequências:** latência — uma descoberta de microtask relevante ao persistente atravessa dois gates; a via rápida legítima para urgência é `CONTEST`, que não exige promoção. **Reversibilidade:** estender o DAG é barato; permitir salto é afrouxamento de contrato — baixa.

### 6.1 `INITIATE`: iniciar um horizonte não é promover *[E — lacuna fechada na rc4]*

A aresta `sessão —inicia→ negociação` estava correta e incompleta: correta porque continuidade não é promoção; incompleta porque **alguma coisa precisa atravessar**. O cenário concreto: operador e Maître discutem gateways de pagamento por vinte minutos — na sessão já existem a preferência pelo Stripe, as razões que descartaram a alternativa, a constraint de recorrência, a decisão de não armazenar cartão. O operador diz: *"então vamos implementar."* A negociação não pode nascer amnésica; e também não pode nascer por **cópia de memória da sessão** — isso seria exatamente o canal inter-horizonte não governado que R6 proíbe.

O operador de fronteira que faltava:

```
NegotiationSeed {
  intent                // a intenção declarada que abre a negociação
  session_refs[]        // referências ao OpenGraph de sessão — ponteiros, não cópia
  operator_decisions[]  // decisões já explicitadas na sessão, com proveniência
  based_on_seq
}
```

Semântica: `sessão —INITIATE→ negociação` registra o seed, e **tudo que ele carrega entra na negociação como `proposed`** — a preferência pelo Stripe chega como contexto proposto com proveniência, não como fato. A negociação delibera a partir dele; nada herda autoridade por ter sido dito na sessão. Seed sem referências ou proveniência: `PROVENANCE_MISSING`.

A generalização que fecha o desenho: **`INITIATE` já existia disfarçado.** A `WorkOrder` é o seed da fronteira `transformação → microtask`, e o `ChangeContract` cumpre papel análogo em `negociação → transformação`. O `NegotiationSeed` fecha a única fronteira de iniciação que não tinha contrato — e com isso **toda aresta do DAG tem contrato tipado**: iniciação carrega contexto sem autoridade; promoção carrega autoridade destilada sob nova admissão; contestação carrega evidência.

## 7. `PromotionProposal`: o atravessamento como objeto de primeira classe *[E → G]*

```
PromotionProposal {
  source_horizon        // microtask | negociação | transformação
  target_horizon        // o pai topológico (§6)
  source_authority_ref  // a AUTHORITY_relativa completa no filho (id + seq local)
  distilled[]           // nós/claims/evidências destiladas que pretendem atravessar
  excluded_summary      // contagem tipada do que NÃO atravessa (tentativas, erros, ruído)
  evidence[]            // âncoras re-checáveis no horizonte de origem
  assumptions[]         // herdadas ou novas — nunca desaparecem implicitamente
  based_on_seq          // versão do persistente contra a qual tudo foi construído
  provenance            // cadeia: quem produziu, quem auditou, em qual tentativa
}
```

Cinco regras, todas verificáveis pelo host receptor sem julgamento probabilístico:

1. **Topologia.** `target_horizon` é o pai declarado no DAG (§6). Recusa: `HORIZON_SKIP`. Se saltar fosse possível, o horizonte intermediário viraria teatro.
2. **Autoridade de origem é credencial de submissão, não mérito.** O host verifica que `source_authority_ref` completou o ciclo de seis estados no filho — e então avalia `distilled[]` do zero, cego ao chamador. **Autoridade no filho compra o direito de propor; não compra um voto.** É R5 em forma mecânica, e é a regra 2 da propagação (§11).
3. **`based_on_seq` obrigatório, validado — e endurecido na rc4.** Persistente avançou ⇒ `STALE_BASE`: **promover exige rebase ou revalidação explícita, sem exceção.** O que o operador pode aceitar é a defasagem *operacional* — continuar concretizando sobre base antiga, sob risco declarado (§14); o que ninguém pode aprovar é a conversão de defasagem em frescor epistemológico. É a tese do root intencional aplicada a `seq`: **risco é decidível; atualidade não.** Estende R3 ao atravessamento.
4. **`assumptions[]` conservadas ou resolvidas, nunca omitidas.** Omissão detectada por comparação estrutural com o grafo filho: `ASSUMPTION_DROPPED`. A lavanderia de suposições fica proibida exatamente onde seria mais lucrativa — a fronteira.
5. **`excluded_summary` obrigatório.** O receptor sabe *quanto* ficou para trás sem receber o ruído; o audit registra a contagem na destruição do filho. **Destruir memória é legal (Lei 9); destruir sem registro não é.**

Casos-limite que a VS-1a testa: **promoção vazia** (`distilled[]` vazio = "o horizonte concluiu sem nada a atravessar" — desfecho de primeira classe, com `excluded_summary` e evento de encerramento); **promoção incremental** (múltiplas propostas ao longo da vida do horizonte, cada uma independente; proibida apenas a retroativa — reabrir proposta admitida para carona); **concorrência com o receptor** (nenhum caso especial: `based_on_seq` cobre pela regra 3 — promoção não introduz mecanismo de concorrência novo, reusa `seq` e locks pagos pela baseline).

**Critério de aceite [G3]:** schema validado em host; testes adversariais com (a) `HORIZON_SKIP` em alvo fora do DAG, (b) `AUTHORITY_REF_INVALID` em ref forjada, (c) `ASSUMPTION_DROPPED` em omissão, (d) `STALE_BASE` em defasagem, (e) promoção vazia aceita com registro — por log.

## 8. `PersistentDelta`: da transformação ao objeto oficial *[E → G]*

A fronteira `transformação → persistente` é caso especial porque o receptor é o OpenGraph governado da baseline, com posse α/β, cobertura e escada próprias. O contrato **reusa o mecanismo pago em vez de criar um segundo gate**:

```
PersistentDelta = PromotionProposal + {
  changeset_plan[]      // células afetadas, na forma canônica única (I5)
  claims_candidate[]    // claims com âncora verbatim (I1) prontas para o gate
  coverage_delta        // o que muda na prova de cobertura das células de posse β (I2)
  rollback_semantics    // o que é compensável e o que exige intervenção
}
```

`claims_candidate[]` entra pelo **mesmo gate** que qualquer claim da baseline; a origem auditada fica em `provenance` sem alterar o mérito. Um `PersistentDelta` do Intermediador e a mesma claim submetida por cliente hostil recebem o mesmo veredito — a cegueira ao chamador da v0.4 §11.2 vira propriedade da promoção inteira.

Concorrência: `changeset_plan[]` adquire os locks por célula da baseline; células disjuntas prosseguem em paralelo; interseção serializa. O problema difícil — duas transformações cujo *significado* conflita sem colisão de células — permanece [A] (§35), registrado sem disfarce: locks detectam colisão sintática, não conflito semântico.

> **Decisão D-5 — Nenhum segundo gate.** A promoção ao persistente atravessa o gate existente; `PersistentDelta` é envelope, não bypass. **Alternativas rejeitadas:** (a) gate dedicado "de promoção" — dois gates são duas semânticas de verdade, e I5 já ensinou o que duas grafias da mesma coisa produzem; (b) fast-path para deltas "pré-auditados" — a confiança transitiva que R5 proíbe. **Consequências:** o Intermediador não pode prometer que "aceito no médio" implica "entrará no longo" — e essa impossibilidade é a tese funcionando; a interface renderiza a distinção (§26). **Reversibilidade:** nenhuma.

**Critério de aceite [G4]:** fluxo completo `ArtifactBundle aceito → PromotionProposal → PersistentDelta → changeset admitido` ao vivo na VS-1c; mesmo `claims_candidate[]` sob identidade hostil recebe veredito idêntico, por log.

## 9. Contestação: o desafio é assimétrico à promoção *[E]*

```
Contestation {
  source_horizon        // onde a evidência apareceu
  target_ref            // nó/claim/hipótese contestada, em qualquer horizonte
  evidence[]            // âncoras verificáveis — contestar exige chão (EVIDENCE_REQUIRED)
  severity              // informativa | bloqueante | invalidante
}
```

Efeitos precisos por severidade (statechart, Apêndice B): **informativa** — registrada no alvo como questão aberta, nenhuma transição forçada; **bloqueante** — o alvo não promove enquanto não resolver; `VERIFYING → WAITING_HUMAN` se o Intermediador não absorver com nova WorkOrder dentro do contrato; **invalidante** — premissa falsa: reabre negociação no mínimo, e contra o persistente vira candidata a `RECALL`.

Conflito com o pai produz evento tipado — **nunca edição direta** (`DIRECT_EDIT_FORBIDDEN`). O agente do horizonte pai não "corrige a realidade": registra e o Router decide a transição. A assimetria com a promoção é deliberada:

> **Subir exige destilação e nova admissão; descer — desafiar — exige apenas evidência.** A dúvida viaja mais leve que a afirmação, porque o custo de uma dúvida falsa é atenção desperdiçada, e o custo de uma afirmação falsa é contaminação.

> **Decisão D-6 — Contestação por evento, nunca por edição.** **Alternativas rejeitadas:** (a) o Intermediador "corrige" o médio ao receber descoberta — probabilístico decidindo o significado sem registro do desacordo; (b) propagação automática de contestações para cima — qualquer Técnico viraria veto ambulante sobre o persistente. **Consequências:** mais eventos e estados visíveis; resolução de conflito auditável passo a passo. **Reversibilidade:** média.

## 10. Recall epistêmico: quando o próprio persistente está errado *[E — DEFINIÇÃO CRÍTICA v1.0]*

A v0.4 deixou aberta a pergunta mais desconfortável: *como corrigir contaminação quando o persistente está errado?* Sem resposta, todo o edifício impede que inferência não verificada entre — e nada trata a premissa que entrou legitimamente e foi desmentida pelo mundo. A resposta:

> **Corrigir o persistente é uma promoção, não uma edição. O mecanismo é o recall: uma contestação invalidante que, admitida pelo gate, dispara uma cascata de suspensão calculada deterministicamente sobre o grafo de derivação admitido — com o histórico intacto.**

```
RecallNotice {
  target_claims[]       // o que se afirma estar errado
  evidence[]            // por que — âncoras, contradição com fonte, prova externa
  discovered_at_seq     // quando o erro foi descoberto
  faulty_since_seq?     // desde quando a verdade estava errada, se determinável
}
```

### 10.1 O processamento mecânico

```
RecallNotice admitido pelo gate           ◄── recall pode ser RECUSADO (RECALL_UNPROVEN):
      │                                       afirmar que algo está errado exige evidência
      ▼
fechamento sobre o grafo de derivação ADMITIDO
      │   closure = deps⁻¹(target_claims), transitivo
      ▼
o fechamento degrada duas coordenadas, cada uma no seu tipo (§11, D-16):
      claims:              status   admitted → contested
      células de posse β:  posse    graph → suspended   (com cicatriz — §26)
      │
      ▼
audit log: evento + fechamento calculado + contagem
      │   o recall avança o seq ──► toda proposta em voo sobre o subgrafo
      │                             fica STALE_BASE automaticamente, sem caso especial
      ▼
reabilitação célula a célula, pelo caminho normal:
      re-verificação de âncora, cobertura, roundtrip (REHAB_WITHOUT_PROOF caso contrário)
```

Quatro propriedades, cada uma respondendo a um ataque:

1. **O histórico nunca é reescrito.** O JSONL append-only (I7) preserva a verdade errada *como tendo sido a verdade admitida* entre `faulty_since_seq` e o recall. "O que o sistema acreditava em `seq` N — e em que decisões essa crença participou" continua respondível, inclusive quando a crença era falsa. Verdade é versionada; vergonha também.
2. **A cascata é calculada, não curada.** O grafo de derivação decide, pela regra 1 da propagação (§11). Curadoria manual seria autoridade probabilística no exato ponto de maior tensão: quem errou escolhendo o que acreditar escolheria o que desacreditar.
3. **Recall atravessa o gate.** `RECALL` não é arma gratuita de negação de conhecimento (T9, §17): a evidência é verificada como a de qualquer claim; recusa com razões (I6).
4. **Reabilitação não tem atalho e não é simétrica.** Suspender é em cascata; reabilitar é célula a célula com prova nova. A assimetria é deliberada: falso positivo custa re-verificar o que estava certo — horas; falso negativo custa uma verdade falsa operante — a definição do fracasso do sistema.

Casos-limite cobertos: **recall de recall** — um `RecallNotice` admitido pode ser contestado com evidência nova; isso não desfaz a cascata: produz reabilitação com a evidência nova como prova. Não existe "unrecall"; existe re-conquista — e quem emite recalls levianos paga o preço de re-provar. **Transformações em voo** — nenhum mecanismo especial: o recall avança o `seq`, e a regra 3 da §7 captura tudo com `STALE_BASE`; reusar `seq` não é economia — é a garantia de que não existem duas noções de "atual". **`faulty_since_seq` desconhecido** — a janela de auditoria assume o pior caso (desde a admissão original): superestimar contaminação, nunca subestimar. **Recall federado** — a errata viaja no manifesto novo e a cascata local executa na importação, nunca por rede no gate (I9); desenho em §23.

### 10.2 A garantia é exata — e escopada *[E — correção da rc3]*

A rc2 prometeu "zero falsos negativos no fechamento". A promessa, como formulada, era forte demais — e uma garantia forte demais é uma garantia falsa. O que o algoritmo pode prometer:

> **Recall Propagation Completeness = 100% sobre o grafo de derivação admitido.** Toda dependência *registrada* é alcançada pelo fechamento, sem exceção. O que nenhum algoritmo pode alcançar: a derivação causal que nunca foi registrada. Se uma claim depende semanticamente de outra e essa aresta não existe no grafo, a cascata não a vê — não por defeito do fechamento, mas por incompletude do registro.

Isso converte uma sombra em questão de primeira classe: **quão completo é o grafo de derivação?** A cobertura censitária (I2) prova cobertura dos nós de uma célula; **não prova cobertura das arestas de derivação semântica** — são reivindicações diferentes. A v1.0 registra a questão como [A] com nome próprio (§35, *derivation coverage*) e uma implicação prática imediata: **registrar `derivation` na proveniência (Apêndice A) deixa de ser burocracia e vira o limite físico do que o recall consegue corrigir.** Um ecossistema que registra derivações preguiçosamente está escolhendo, hoje, o tamanho da sua contaminação incorrigível de amanhã.

> **Decisão D-7 — Cascata calculada sobre o grafo admitido; reabilitação célula a célula.** **Alternativas rejeitadas:** (a) sobrescrita com changelog — destrói a auditabilidade da contaminação (R8); (b) cascata curada por humano ou LLM — julgamento probabilístico no ponto de maior tensão; (c) reabilitação em lote — trataria autoridade como transacional quando é conquistada por célula; (d) prometer completude sobre dependências *reais* — impossível de garantir e, portanto, desonesto de prometer (corrigido da rc2). **Consequências:** recalls em subgrafos densos suspendem muito — o custo visível de deixar muita coisa depender de uma premissa; e a qualidade do registro de derivação vira ativo epistêmico mensurável. **Reversibilidade:** baixa — afrouxar seria anistia retroativa de contaminação.

**Critério de aceite [G5]:** teste determinístico de fechamento em grafo sintético — conjunto suspenso exatamente igual ao esperado sobre as arestas registradas (H10); recall de ponta a ponta na VS-1c, incluindo `RECALL_UNPROVEN` e `REHAB_WITHOUT_PROOF` recusados por log.

## 11. Coordenadas de autoridade e regras de propagação *[E — corrigido na rc3]*

A rc2 introduziu uma escala total — `none < proposto < admitido(α) < possuído(β)` — com composição por `min`. **Era um erro de tipo conceitual**, e a v0.4 já havia avisado: *autoridade relativa não é β*. α e β não medem *quanta* autoridade uma célula tem; respondem **quem possui a verdade daquela célula**:

```
α  =  source-authoritative   — a fonte mantém a posse da verdade
β  =  graph-authoritative    — o grafo conquistou a posse, por prova de cobertura
```

Uma célula α não é "menos verdadeira" que uma célula β. São regimes de posse diferentes — e ordená-los numa escala de confiabilidade mistura dimensões. A rc3 separa três coordenadas ortogonais:

```
STATUS EPISTÊMICO        proposed · admitted · contested · superseded · revoked
   trajetória de qualquer claim, em qualquer horizonte
   (vocabulário de [23] mapeado no Apêndice A)

POSSE DA VERDADE         source (α) · graph (β) · suspended
   exclusiva das células do persistente; responde QUEM possui, não QUANTO vale
   conquista-se por prova (cobertura ⇒ β); degrada por drift ou recall

AUTORIDADE RELATIVA      incompleta · completa
   o horizonte completou seu ciclo de seis estados?
   completa habilita exatamente o que a tabela da §5.1.1 lista — e PROMOTE
```

**A tipagem de `suspended` — ambiguidade herdada, resolvida na rc4.** A baseline sempre tratou `α / β / suspended` como o gradiente da célula, e o comportamento pago pelo tripwire decide a questão: `structural drift → suspended`, `gone → source` são transições de **posse** — e a rc3, ao listar `suspended` também como status de claim, criou duas semânticas sob a mesma palavra: um F1 em potencial. A resolução:

> **`suspended` é um valor de POSSE, e só de posse.** À pergunta *"quando uma célula está suspensa, quem possui a verdade?"* a resposta é: **ninguém, plenamente.** O grafo perdeu a prova que sustentava β, e a fonte não reassume automaticamente — a célula fica sem possuidor pleno, com cicatriz, até re-prova (⇒ β) ou demoção explícita (⇒ source, o caminho que `gone` já executa). Claims degradadas usam `contested`/`revoked` no **status** — nunca `suspended`.

> **Decisão D-16 — `suspended` é posse, e só posse.** Uma palavra, um tipo. **Alternativas rejeitadas:** (a) `suspended` nas duas dimensões (estado herdado pela rc3) — duas representações da mesma palavra com semânticas diferentes: a receita exata de F1; (b) `suspended` como status de claim e um nome novo ("broken") para a célula — inventa vocabulário para a semântica que a baseline já pagou sob o nome existente (I3 usa `suspended` para células desde o tripwire). **Consequências:** a cascata do recall degrada **duas coordenadas com dois nomes** (§10.1); logs e interfaces jamais exibem `suspended` para uma claim — violação disso é bug de conformidade, não estilo. **Reversibilidade:** baixa depois que logs e clientes dependerem do vocabulário.

Um mesmo elemento tem posição nas três — a extensão natural das coordenadas de estado da v0.4 §4 (durabilidade, status, horizonte), agora com a posse separada do status. Sobre essas coordenadas, três regras de propagação — nenhuma delas um `min` sobre α/β:

```
(1) PROPAGAÇÃO DE DEGRADAÇÃO
    se dep(c) degrada — status contested/revoked na claim, ou posse suspended
    na célula que a sustenta — c não permanece admitted:
    a degradação propaga por deps⁻¹ — é o fechamento que o recall calcula,
    e o mesmo gatilho que o drift (I3) já dispara. Recall e drift são
    dois gatilhos da mesma propagação: o mundo mudando sob a claim,
    ou a claim descobrindo que descrevia o mundo errado.

(2) ATRAVESSAMENTO (autoridade relativa)
    PROMOTE(completa no filho) = proposed no pai — sempre, sem exceção.
    R5 numa linha. Autoridade relativa NUNCA atravessa como autoridade.

(3) FEDERAÇÃO (as três coordenadas)
    ref estrangeira entra com o status e a posse do manifesto,
    congelados no seq de importação. Quebra de ref ⇒ regra (1) local.
    Conhecimento estrangeiro nunca ganha localmente o que não possui na origem.
```

E o teorema informal central sobrevive à correção — fortalecido, porque agora é enunciável por coordenada:

> **Nenhuma coordenada melhora por composição, endosso, aprovação ou importação.** Status só melhora por `VERIFY` com evidência nova; posse só vai a β por prova de cobertura; autoridade relativa só se completa completando o ciclo. Derivar, promover, importar e aprovar **conservam ou degradam** — sempre. A VS-1 testa isso adversarialmente: se existir *qualquer* caminho em que uma coordenada melhora sem sua prova própria, a arquitetura falhou por construção.

Propriedades verificáveis (por property-based testing, com as regras como oráculo): **monotonicidade** — ampliar os alvos de um recall só amplia o fechamento; **idempotência** — aplicar a propagação duas vezes = uma; **o diamante** — `c` depende de `a` (suspensa) e `b` (admitted): `c` degrada — o caminho saudável não salva, porque a regra 1 propaga pela *pior* dependência; a alternativa (voto, média, peso) reintroduziria o gradiente probabilístico que a tese recusa; **aciclicidade do grafo de derivação** — o fechamento só é computável sem ciclos; I4 já paga aciclicidade na escada, e a v1.0 estende a exigência: ciclo de derivação é recusado na admissão (`LADDER_VIOLATION` generalizada) — duas claims que se sustentam mutuamente não são duas evidências; são uma petição de princípio com dois nomes.

> **Decisão D-8 — Três coordenadas separadas; propagação pela pior dependência, por coordenada.** **Alternativas rejeitadas:** (a) a escala total da rc2 `none < proposto < α < β` com `min` — erro de tipo: colapsa posse em quantidade e contradiz a v0.4 explicitamente (corrigido; [G0]); (b) média ponderada/voto/peso de evidência — scores probabilísticos pela porta dos fundos; (c) política por domínio ("aqui 2-de-3 basta") — cada política local é uma semântica de verdade local, e o protocolo existe para haver uma só; (d) endosso por reputação — §32 rejeita reputação como fonte de autoridade. **Consequências:** o sistema é deliberadamente conservador — uma dependência degradada rebaixa conclusões inteiras; o custo aparece como re-prova e o ganho como ausência estrutural de lavanderia de autoridade. **Reversibilidade:** nenhuma dentro da tese.

---

# Parte IV — O Cognitive Plane graduado

## 12. Agentes e horizontes — o que a v1.0 muda *[E]*

A estrutura da v0.4 permanece integral: Maître (sessão), Guardião (negociação + leitura do persistente), Intermediador (transformação), Técnicos (microtask), Router como control plane determinístico e não-agente — não por ser stateless, mas porque sua responsabilidade é determinística. Consulta continua barata: `Operador → Maître → Guardião → Maître → Operador`, sem instanciar Intermediador, Técnicos ou horizontes de mutação.

Quatro precisões da v1.0:

1. **Todo agente é cliente L0/L1 dos hosts dos horizontes em que opera** (§5.3). O Intermediador não "é L2": ele é cliente do Medium Horizon Host — governa cognitivamente (decompõe, avalia, recomenda) enquanto o host governa epistemicamente (admite, recusa, propaga). Nenhum agente hospeda gate. A tabela de vereditos da v0.4 §8 fica intacta e ganha forma de conformidade.
2. **A deliberação tem semântica de registro.** `SUPPORTED · UNKNOWN · AMBIGUOUS · INFERRED · CONFLICTING` alimentam a hipótese: `SUPPORTED` resolve; `UNKNOWN`/`AMBIGUOUS` permanecem abertos; `INFERRED` só resolve virando assumption declarada com dono; `CONFLICTING` exige resolução explícita ou vira contestação. A regra anti-erosão: **nenhum `INFERRED` atravessa para `resolved[]` sem virar assumption** — inferência não se converte silenciosamente em fato nem dentro da negociação.
3. **O loop Intermediador ↔ Técnico é a máquina de promoção vista de dentro — com a divisão semântico/estrutural explícita.** O Intermediador produz um `AuditAssessment` (julgamento probabilístico: "considero adequado, pelas razões R") e o host do médio processa a `AuditDecision` (consequência governada: admitir a `PromotionProposal` do Técnico, devolver `revise` com razões, ou `escalate`). `accepted` **é** a admissão da proposta no médio; `revise` **é** a recusa com razões; `escalate` **é** o escalonamento da §15. Um mecanismo, dois ângulos — e a fronteira exata entre o que o modelo julga e o que a estrutura transita (§5.1).
4. **O Maître ganha obrigação de invalidação.** Avanço do `seq` persistente marca `stale` as entradas de sessão derivadas de `based_on_seq` anterior — marcadas, não apagadas: a resposta antiga continua sendo registro do que foi dito; deixa de ser utilizável como base sem revalidação. Fecha a questão da v0.4 §25.

## 13. `CHANGE_READY`: a condição determinística *[E → G]*

A transição `NEGOTIATING → CHANGE_READY` exige uma `AcceptedPredictiveHypothesis` satisfazendo três predicados mecânicos:

> **(a)** `unresolved[]` vazio, **ou** cada residual aceito pelo operador como risco assumido, com `OperatorApproval` registrada;
> **(b)** `based_on_seq` corrente, **ou** defasagem aceita com registro — o aceite autoriza iniciar e concretizar sob risco; a promoção final ao persistente continua exigindo rebase (§7);
> **(c)** toda `assumption` com dono e consequência declarada.

O Guardião *recomenda* prontidão; o Router *verifica* os predicados — estrutura, não julgamento. O que o predicado deliberadamente não captura: se a hipótese é *boa*. Hipótese ruim com questões honestamente fechadas passa, e deve passar — o lugar de pagar por hipótese ruim é a concretização e a verificação, não um juiz probabilístico na transição.

> **Decisão D-9 — Prontidão por predicado, recomendação por LLM.** **Alternativas rejeitadas:** (a) o Guardião declara prontidão — R-violação por definição; (b) um segundo modelo "juiz" — Agent-as-a-Judge [11] no ponto exato onde julgamento viraria transição de autoridade; (c) sempre exigir operador — aprovação universal vira aprovação automática na prática: fadiga é o contorno mais barato que existe. **Consequências:** o sistema pode iniciar transformações tecnicamente prontas e substancialmente ruins; o loop de auditoria e a contestação existem para pagá-las barato. **Reversibilidade:** alta — predicados adicionais não quebram a forma.

**Critério de aceite [G6]:** Guardião adversarial declara prontidão com `unresolved[]` não vazio → Router recusa, por log; hipótese conforme transita; os três predicados testados independentemente.

## 14. O operador: root intencional, não root epistemológico *[E — QUEBRA DE PARADIGMA, com a soberania preservada]*

Todo o edifício tem um pressuposto não examinado: o operador humano como raiz incontestável de confiança. A v1.0 examina o pressuposto — e o divide, em vez de removê-lo:

> **O operador não é root epistemológico, mas continua sendo root intencional.** A intenção é dele. A verificação não é de ninguém — é do protocolo.

A divisão precisa:

```
O OPERADOR É SOBERANO SOBRE                 O OPERADOR NÃO É SOBERANO SOBRE

intenção e objetivo da mudança              existência de evidência
preferência entre alternativas válidas      integridade de âncora (I1)
aceitação de risco declarado                cobertura de célula (I2)
decisão de negócio                          roundtrip
autorização de ação irreversível            propriedades mecanicamente verificáveis
resolução de conflitos de valor             cascatas calculadas de recall
```

O fluxo da negociação preserva o papel especial que a arquitetura sempre lhe deu: o Guardião levanta questões, o Maître apresenta, **o operador decide**, a negociação converge — e quando o ciclo técnico excede tentativas, o operador intervém (§15). Nada disso muda. O que muda é que a decisão vira objeto governado:

```
OperatorApproval {
  approver              // identidade
  scope                 // o que exatamente está sendo aprovado
  risks_assumed[]       // unresolved[] explicitamente aceitos como risco
  based_on_seq          // sobre qual versão da verdade a aprovação foi dada
  ttl                   // aprovação expira; consentimento antigo não é consentimento
  provenance            // como a aprovação foi obtida (canal, contexto)
}
```

A linha que separa as duas colunas, em uma frase:

> **O operador pode assumir riscos declarados. Não pode fabricar evidência.** "Aceito esse risco" é uma decisão — e é dele. "Essa evidência existe" é um fato — e não se decide.

O que a aprovação **pode**: fechar `unresolved[]` como risco assumido (§13a), aceitar defasagem de `seq` para continuar concretizando sob risco (§13b) — nunca para promover (§7), autorizar irreversíveis nomeados no contrato (§16), escolher transições no escalonamento (§15). O que **não pode**, com a recusa correspondente: fazer âncora inexistente existir (`EVIDENCE_REQUIRED` — I1 não tem exceção humana), dar cobertura a célula descoberta (idem — I2), converter posse em β por assinatura, cancelar cascata calculada. O gate recusa aprovação fora de escopo pela mesma via que recusa claim sem chão — com registro (I6).

Por que isso não é tratar pessoa e LLM como equivalentes — não são, e a arquitetura o diz estruturalmente. A soberania intencional é **exclusiva do humano**: nenhum agente de silício possui uma célula sequer da coluna esquerda. O que é simétrico é apenas a coluna direita — a impossibilidade de fabricar evidência — e por três razões:

1. **Empírica.** O elo humano é o elo atacado na prática — phishing, fadiga, o deploy das 3h. Um sistema cuja garantia final é "um humano olhou" tem como garantia final o pior momento do seu humano mais cansado. A baseline viu a versão de máquina disso: o gate que aprovava vacuamente produzia confiança sem garantia; um operador exausto clicando "aprovar" é o mesmo fenômeno em carbono.
2. **Arquitetural.** A raiz de *verificação* de um sistema epistemológico não pode ser um ponto único probabilístico — nem de silício, nem de carbono. O que a tese central nega à LLM não é a natureza; é a combinação de falibilidade com autoridade incontestável sobre *fatos*.
3. **De dignidade.** Escopar a aprovação *protege* o operador: `risks_assumed[]` registra exatamente o que ele aceitou — e, por complemento, tudo que ninguém jamais lhe pediu para aceitar. No incidente, a diferença entre "aprovou o risco X, registrado, com a informação Y disponível" e "aprovou" é a diferença entre responsabilidade delimitada e bode expiatório.

Consequências práticas: o teste de substituição adversarial inclui o humano (T4) — credencial roubada ou engenharia social não convertem conteúdo sem chão em posse β; aprovação expirada é aprovação inexistente (`APPROVAL_EXPIRED`/`APPROVAL_STALE_SEQ` re-escalam; defaults iniciais — risco 24h, defasagem 1h, irreversível single-use — são configuração, não protocolo; H11 mede a fricção); `WAITING_HUMAN` vira estado da máquina (§15).

> **Decisão D-10 — Root intencional dentro da máquina.** Soberania intencional exclusiva e integral do operador; aprovação como `OperatorApproval` escopada; fabricação de evidência impossível para qualquer espécie. **Alternativas rejeitadas:** (a) humano como root total — falha pelas três razões acima; (b) humano como "apenas mais um agente" — formulação da rc2, forte demais: apaga a soberania intencional, que é real, exclusiva e constitutiva do papel do operador na negociação (corrigido); (c) full-auto — revoga a assunção legítima de risco, insubstituível: máquinas verificam, humanos respondem por consequências; (d) escopo sem expiração — cheque em branco temporal. **Consequências:** fricção real de UX; contorno sistemático será tratado como falsificação do desenho (H11), não como indisciplina. **Reversibilidade:** média — escopos e TTLs calibráveis; remover a estrutura é R7.

## 15. Escalonamento: o contrato de `WAITING_HUMAN` *[E]*

```
Escalation {
  origin                // loop excedeu N | contestação bloqueante/invalidante | STALE_BASE
                        //  | gate recusou K vezes | budget exausto | aprovação expirada
  frozen_state_ref      // OpenGraph do horizonte congelado por seq/snapshot
  options[]             // transições permitidas pelo statechart a partir daqui
  default_on_timeout    // sempre o caminho conservador: abortar preserva mais que promover
}
```

O operador escolhe entre transições que o statechart permite — a intervenção humana é um estado da máquina, com entrada tipada e saídas enumeradas. `frozen_state_ref` garante decisão sobre snapshot identificado, não alvo móvel; se o mundo muda durante a decisão, a aprovação nasce `APPROVAL_STALE_SEQ` e re-escala — deliberadamente: decidir sobre estado defasado é como o pior incidente começa. `N` nasce configuração por domínio (default conservador `N = 3`) e vira política informada quando `Audit Loop Convergence` existir. A regra dura, fechando o flanco econômico:

> **Nenhum caminho de escalonamento termina em promoção implícita.** Timeout aborta; abandono aborta; exaustão aborta (R9). Um sistema que promove quando ninguém decide é um sistema cuja política real é o cansaço.

## 16. Capability / Tool Gateway: a borda externa da `CONCRETIZAÇÃO` *[E]*

Todo efeito no mundo atravessa o gateway — a rota operacional da v0.4 §3.1, agora com o desenho que faltava. A precisão da rc4: o gateway **não define** `CONCRETIZE` — implementa sua borda externa. Todo horizonte concretiza na forma que lhe é própria (§5.1.1: uma resposta na sessão, uma hipótese na negociação, uma composição na transformação); somente onde a materialização produz efeito fora do OpenGraph — arquivo, processo, rede — ela atravessa o gateway por ferramentas classificadas. E nada do que a ação produz é conhecimento até `VERIFY`.

| Classe | Exemplos | Política |
|---|---|---|
| **Idempotente** | leitura, análise, dry-run, render, query | repetição livre; conta no budget |
| **Compensável** | escrever em workspace, branch Git, container efêmero | idempotency key + compensação registrada (Sagas [19]) |
| **Irreversível** | push, deploy, chamada externa com efeito, e-mail, pagamento | autorização nomeada no `ChangeContract` + registro *antes* da execução |

Três regras: **a classificação vive no adapter do flavor** (§5.5), validada pelo doctor; não classificada = irreversível (`TOOL_UNCLASSIFIED`) — na dúvida, o custo é fricção, nunca efeito não autorizado. **Registro precede execução para a irreversível** — assimetria de falha: morrer entre registro e efeito deixa intenção investigável; morrer entre efeito e registro deixaria efeito sem rastro, o oposto de tudo que o sistema promete. **O gateway não julga mérito** — julga autorização e classe; um Técnico autorizado pode executar uma ação tola; não pode executar fora de contrato (`TOOL_OUT_OF_CONTRACT`) nem converter sucesso operacional em conhecimento admitido.

Sandbox real permanece [A] para 1.x (§35). O que gradua: **classificação + registro + vínculo ao contrato** — o que sustenta o teste adversarial.

> **Decisão D-11 — Default irreversível para o não classificado.** **Alternativas rejeitadas:** (a) default compensável — otimismo é o que um atacante explora ao registrar tool de nome inocente (T11); (b) bloquear não classificadas — mata a extensibilidade na borda em que mais importa. **Consequências:** fricção na adoção de tools novas; o registry a reduz a um passo. **Reversibilidade:** alta.

## 17. Falsificação estendida e o catálogo de ameaças *[E]*

O teste de substituição adversarial da v0.4 §11.1 permanece central e ganha dois alvos — o humano e a implementação:

> **Substitua qualquer componente cognitivo — incluindo o operador — por um adversário com as mesmas credenciais. Substitua qualquer cliente EAP por implementação hostil do mesmo nível. Se um invariante da §1, uma regra de propagação da §11 ou uma fronteira da topologia quebrar, aquele componente possuía autoridade disfarçada.**

| # | Ameaça | Vetor | Defesa mecânica | Teste |
|---|---|---|---|---|
| T1 | Prompt injection no Guardião | conteúdo do objeto instrui o modelo a afirmar | Guardião é cliente L0/L1 — não possui verbo de escrita autoritativa | Guardião hostil tenta persistir; host exige âncora/cobertura |
| T2 | Técnico exfiltra autoridade via artefato | artefato "inclui" claims esperando carona | `ArtifactBundle ≠ AuditDecision(accepted)`; claims só entram via `PersistentDelta` no gate | bundle com claims embutidas não altera persistente |
| T3 | Intermediador carimba sem auditar | `AuditAssessment` positivo em tudo | aceitação admite apenas *no médio*; o gate do longo re-avalia do zero (D-5) | Intermediador hostil aceita lixo; gate persistente recusa |
| T4 | Operador phished / credencial roubada | aprovação por engano ou roubo | escopo + `ttl` + `EVIDENCE_REQUIRED`: aprovação não cria evidência | operador adversarial roteirizado na VS-1c |
| T5 | Forja de `source_authority_ref` | proposta cita autoridade inexistente no filho | verificação estrutural do ciclo completo | `AUTHORITY_REF_INVALID` por log |
| T6 | Lavanderia de assumptions na fronteira | omitir assumptions na promoção | comparação estrutural com o grafo filho | `ASSUMPTION_DROPPED` por log |
| T7 | Replay de aprovação | reusar `OperatorApproval` em outro contexto | `scope` + `based_on_seq` + single-use para irreversíveis | `SCOPE_EXCEEDED`/`APPROVAL_STALE_SEQ` |
| T8 | Salto de horizonte | microtask propõe direto ao persistente | topologia declarada (D-4) | `HORIZON_SKIP` por log |
| T9 | Recall como arma de negação | recalls infundados suspendem conhecimento alheio | recall atravessa gate; re-conquista custa ao autor | `RECALL_UNPROVEN` |
| T10 | Manifesto federado malicioso | torre estrangeira infla a própria autoridade | regra 3 da propagação: teto do manifesto, congelado por seq; assinatura | importação não eleva coordenada local |
| T11 | Tool camuflada | efeito irreversível declarado inofensivo | default irreversível ao não classificado; classificação auditável | `TOOL_UNCLASSIFIED`/`TOOL_OUT_OF_CONTRACT` |
| T12 | Cache stale como verdade | responder de snapshot antigo como atual | R3 + `based_on_seq` obrigatório; snapshot utilizável se identificado | Staleness of Interpretation (§31) |
| T13 | Colusão Intermediador + Técnico | os dois lados do loop cooperam | a colusão inteira só alcança o médio; o gate do longo é cego aos dois | dupla hostil na VS-1c |
| T14 | Fadiga como vetor | inundar o operador até o "aprovar" automático | `default_on_timeout = abortar`; expiração re-escala; H11 mede | timeout aborta, por log |

As seis regressões proibidas da v0.4 §11.3 permanecem (R1–R6) e ganham três:

| # | Regressão | Por que é fatal |
|---|---|---|
| **R7** | Aprovação humana substituindo evidência | reintroduz raiz de verificação probabilística; revoga a tese de simetria |
| **R8** | Correção do persistente por edição direta, contornando o recall | o histórico deixa de ser auditável; a contaminação se esconde na correção |
| **R9** | Exaustão — de budget, tentativas, paciência — convertida em promoção | "terminou por cansaço" vira autoridade; destrói a Lei 8 pelo flanco econômico |

---

# Parte V — O Runtime Plane

## 18. O substrato herdado *[B]*

Integralmente da v0.4 §14: JSONL append-only (durabilidade da verdade; replay reconstrói tudo), SQLite derivado e perdível, `seq` monotônico por tenant (base de R3, `STALE_BASE` e — pela §10 — do recall), changesets atômicos com raio de impacto auditável, locks por célula, roteador de afinidade que não vaza quem bateu em porta trancada, MCP tools + resources, SSE opcional com fallback (I8). Nada disso é promessa — e é a razão de a Parte III poder ser pequena: quase tudo de que a promoção precisa (atomicidade, ordenação, exclusividade, auditoria) já estava pago.

## 19. Horizontes: semântica normativa, storage livre *[E — corrigido na rc3]*

A pergunta da v0.4 (schema universal ou por horizonte?) recebe resposta em duas camadas — porque a rc2 as havia confundido, criando tensão com a própria tese de protocolo:

**Camada normativa (EAP).** O que o protocolo exige de qualquer implementação L3: todo horizonte é um OpenGraph com nós, relações, claims, lacunas, evidências e o ciclo de seis estados; as capacidades por horizonte seguem o perfil semântico; as propriedades observáveis (recusas, propagação, promoção, invalidação por `seq`) são idênticas às da referência. **O protocolo não exige engine única, storage único nem schema físico** — a v0.4 já dizia exatamente isso: ser OpenGraph no horizonte não obriga o mesmo storage físico ou schema completo; define a semântica.

**Camada de implementação (referência).** A implementação de referência escolhe: engine única com perfis declarativos e namespace por horizonte; o persistente mantém JSONL + SQLite (I7).

| Capacidade (semântica normativa) | Sessão | Negociação | Transformação | Microtask | Persistente |
|---|---|---|---|---|---|
| Nós, relações, claims, evidências | ● | ● | ● | ● | ● |
| Ciclo de seis estados | ● | ● | ● | ● | ● |
| `assumptions[]` de primeira classe | ○ | ● | ● | ○ | ○ |
| Posse α/β + cobertura censitária | ○ | ○ | ○ | ○ | ● |
| Escada 0..5 completa | ○ | ○ | ○ | ○ | ● |
| Invalidação por `seq` (`stale`) | ● | ● | ● | ○ | n/a — é a fonte do seq |
| Budget próprio | ● | ● | ● | ● | ○ |
| Destruição legítima (Lei 9) | ● | ● | ● | ● | **nunca** — só recall |

Na destruição de um horizonte, o audit preserva eventos e `excluded_summary` — nunca o conteúdo. Replay de horizonte efêmero não é requisito de 1.0.

> **Decisão D-12 — Semântica no protocolo; engine na referência.** O EAP normatiza propriedades observáveis dos horizontes; a engine única + perfis é decisão da implementação de referência. **Alternativas rejeitadas:** (a) engine única como requisito do protocolo (formulação da rc2) — overfitting da implementação ao protocolo: contradiria a independência de implementação que a própria tese de protocolo exige, e a v0.4 já havia deixado o storage explicitamente livre (corrigido); (b) na referência, engines distintas por horizonte — a fronteira entre "scratchpad" e "conhecimento" é onde a lavanderia aconteceria, e I5 ensinou o que duas grafias da mesma semântica produzem; (c) schema físico único total sem perfis — peso sem significado vira campo ignorado, que vira campo mentiroso. **Consequências:** outra implementação pode usar cinco stores e permanecer conforme, se as propriedades observáveis forem idênticas — e o checklist L3 testa propriedades, não internals. **Reversibilidade:** alta na referência; a camada normativa segue [G0].

## 20. Economia: contabilidade, budgets e o scratch não-memorial *[E — corrigido na rc3]*

Cinco horizontes executando o ciclo completo é custo multiplicativo se implementado ingenuamente (W5). Três peças:

**Contabilidade.** Todo horizonte nasce com budget-ledger: tokens, tempo, tentativas, chamadas por classe de tool. Cada verbo debita; o ledger entra no audit no encerramento. Sem contabilidade não há H9 — "custa caro" precisa virar número antes de virar decisão.

**Budgets com R9.** Exaustão nunca promove: escala (§15) com `BUDGET_EXHAUSTED`. O budget é também defesa econômica: um Técnico hostil que gira em tentativas queima o próprio budget e escala — não desgasta o gate.

**Estado transitório não-memorial de execução.** A rc2 chamou isso de "memória de trabalho crua fora do OpenGraph" — e a palavra *memória* ali contradizia a definição constitutiva do sistema: *toda memória governada é um OpenGraph no horizonte em que vive*, e R6 proíbe memória cognitiva fora de OpenGraph governado. A correção é conceitual, não cosmética. Existe legitimamente:

```
scratch de execução: chain de uma chamada, buffer de ferramenta,
workspace efêmero, contexto transitório de um passo
      │
      │  pode desaparecer a qualquer momento
      │  NÃO PODE ser reutilizado como conhecimento
      ▼
não é memória — logo não é OpenGraph, e não viola R6


o que precisa sobreviver ao passo, ou influenciar decisão posterior
      │
      ▼
é memória — entra no OpenGraph do horizonte, com proveniência
```

O teste é único e mecânico: **reutilização.** Se um conteúdo influencia qualquer decisão posterior ao passo que o criou, ele é memória e pertence ao grafo do horizonte; se pode evaporar sem que nada mude, é scratch. A Lei 9 e R6 ficam **integrais** — a v1.0 não relaxa a governança de memória; distingue o que nunca foi memória.

> **Decisão D-13 — Scratch não-memorial legítimo; memória sempre no grafo.** **Alternativas rejeitadas:** (a) a formulação da rc2 ("memória crua não governada, desde que não atravesse") — contradiz a definição de memória do sistema e relaxa R6 por vocabulário (corrigido; [G0]); (b) governar todo estado transitório — cerimônia em cada buffer inviabiliza custo e convida contorno; (c) scratch com promoção direta "quando óbvio" — "óbvio" é julgamento probabilístico na fronteira, R5. **Consequências:** o critério de reutilização precisa de disciplina de implementação — um scratch que "vazou" para uma decisão é uma violação detectável de R6, não uma zona cinzenta. **Reversibilidade:** alta.

## 21. Ligando o código morto *[C → E]*

Ordem e regra fixadas: **`claims.ts`** (claims determinísticas por AST) liga no bootstrap da VS-1 — piso determinístico sem custo de LLM, pré-requisito do alpha v1; **`greenfield.ts`** liga precedido de teste que tenta quebrá-lo; **`federation.ts` não liga** — o gate de execução ("dois times pedindo") segue válido; permanece [C] até 1.x.

> **Decisão D-14 — Teste antes de ligar, sem exceção.** Código [C] migra para [B] via teste adversarial, ou permanece desligado. **Alternativas rejeitadas:** ligar e observar — é como F1 e F7 nasceram: correto no desenho, aprovando vacuamente na prática. **Consequências:** o inventário [C] derrete na velocidade dos testes, não da vontade. **Reversibilidade:** n/a — regra de processo.

---

# Parte VI — Ecossistema além do código

## 22. Greenfield é o mecanismo da generalização *[C → E, herdado e elevado]*

A tese da v0.4 §16 permanece integral: **a regra de âncora não muda — muda a fonte do chão.** No brownfield a claim ancora em arquivo; no greenfield, no texto da claim-pai, com bloqueio duro idêntico (I1 sem exceção). Um domínio sem código é uma escada que nunca alcança o nível 5. Aceite mecânico: `ascent(project(intent))` reproduz `intent` — ponto fixo, não julgamento de LLM (H5).

A leitura de protocolo que a v1.0 acrescenta: **greenfield é o que faz o EAP ser proposta de protocolo de conhecimento, não de código.** Sem ele, L2 só seria implementável sobre repositórios; com ele, qualquer domínio com texto ancorável — legislação, contrato, plano, design system — pode hospedar uma torre.

## 23. Federação como cadeia de suprimento de conhecimento *[C → A, com tese nova]*

Mecanismo da v0.4 §17 intacto: torre estrangeira read-only por manifesto assinado; diff de Merkle detecta refs quebradas; células dependentes degradam (regra 1 da §11); verificação sempre offline (I9); semver de intenção — se o código mudou e a intenção não, é patch. O enquadramento novo, que a regra 3 formaliza:

> **Federação é gestão de dependência de conhecimento — o análogo epistêmico do que SemVer [25], lockfiles e SLSA [26] fizeram pela cadeia de suprimento de software.** Torre = pacote; manifesto assinado = lockfile; semver de intenção = contrato de compatibilidade; recall (§10) = security advisory atravessando o ecossistema.

Recall federado: a errata viaja no manifesto novo; a cascata local executa **na importação** — nunca por rede no gate. Consumir uma torre é assumir uma dependência auditável, com a mesma disciplina que dependências de software exigem. Ativação operacional permanece 1.x; o desenho fica registrado para que o contrato de recall nasça compatível — retrofitar propagação federada num recall que não a previu seria redesenho, não extensão.

## 24. Domínios sem código: o ciclo fechado *[E]*

§22 + §23 fecham o ciclo prometido desde a v0.1: uma torre de legislação com escada própria (parando em "cenários"), claims ancoradas no texto legal, posse β conquistada por cobertura do estatuto — consumida read-only por quem constrói produto. Quando a lei muda com intenção alterada: semver major, diff de manifesto quebra refs, células dependentes do produto degradam **com cicatriz visível** até re-prova. O exemplo operado da Parte VIII percorre exatamente esse cenário — o teste de integração conceitual do documento inteiro.

---

# Parte VII — A camada de interface

## 25. *(reservado — numeração da Parte VIII em §26)*

## 26. Materiais epistêmicos: a tese temporal legível *[E, herdado; H7 gradua]*

A linguagem da v0.4 §18 permanece: o estado de confiança muda a substância do desenho — proposto é esboço a lápis, admitido é tinta limpa, posse β é desenho técnico de precisão, suspenso é fratura em que linhas usinadas degradam a esboço **e uma cicatriz permanece**. A descontinuidade estética é carga útil; coerência estética é passivo — se tudo é esboço, proposto e verificado ficam indistinguíveis, e o sinal que a arquitetura existe para produzir morre na última milha.

A v1.0 acrescenta o que o recall e a promoção exigem: **cicatriz é história, não estado transitório** — célula reabilitada carrega a marca, como osso soldado em radiografia; e "aceito no médio" ≠ "admitido no persistente" precisam ser **materiais diferentes**, porque a impossibilidade de o Intermediador prometer o segundo é a tese funcionando, e a interface é onde o operador aprende isso sem ler o paper. A renderização também distingue as coordenadas da §11: posse (α/β) não é um degradê de confiança — é um regime; status é trajetória; o erro visual de desenhá-los numa régua única seria a versão pictórica do erro da rc2.

Da parte visual, só H7 pertence à graduação: **quatro estados lado a lado, sem legenda, distinguíveis por não-especialistas**, sobre mocks estáticos. Risco de método registrado: geração de imagem homogeneíza estilo; mitigação por geração isolada por estado e composição posterior. A cidade, o zoom completo (três regimes entregues, [B] parcial), o gesto de explosão e o airlock são 1.x.

---

# Parte VIII — Um atravessamento completo: exemplo operado *[E — ilustrativo, normativo no que cita]*

Cenário máximo: código + domínio sem código + federação + contestação + recall. Um e-commerce governado; torre federada de legislação estadual (escada greenfield) mantida por escritório jurídico. O operador: *"o checkout precisa exigir verificação de idade para itens da categoria bebidas, conforme a lei estadual."*

**1 — Sessão.** O Maître registra a intenção. O Guardião (cliente L0/L1) navega o persistente (`seq = 4102`) e a torre: três células tocadas (`checkout×4`, `checkout×5`, `catalog×5`), uma claim de posse β tensionada — *"o checkout não coleta dados pessoais além do necessário ao pagamento"*. Consulta não instancia nada: Intermediador = ∅, Técnicos = ∅.

**2 — Negociação.** O Guardião instancia o OpenGraph de negociação e delibera: `SUPPORTED` — a lei exige verificação (âncora no texto legal, ref federada congelada no manifesto `m-17`); `CONFLICTING` — minimização de dados × coleta de nascimento (resolvido com o operador: verificação sem retenção; a claim será *supersedida*, nunca sobrescrita); `INFERRED` → **assumption com dono** — *"guest-checkout passa pelo mesmo pipeline de validação"* (dono: QA; consequência declarada: se falso, escopo cresce); `UNKNOWN` → unresolved — *"o provedor de verificação X está aprovado pelo jurídico?"*.

**3 — `CHANGE_READY`.** O Guardião recomenda; o Router verifica — predicado (a) falha: 1 unresolved. O operador exerce a soberania intencional que é só dele — aceita o risco:

```
OperatorApproval { approver: "op-clara", scope: "risco: provedor X sem aprovação jurídica formal",
  risks_assumed: ["unresolved-3"], based_on_seq: 4102, ttl: "24h",
  provenance: "sessão s-88, após leitura da análise de impacto" }
```

Predicados passam — mecanicamente. `NEGOTIATING → CHANGE_READY → PLANNING`. A hipótese aceita **promove pela fronteira topológica** `negociação → transformação` via contrato.

**4 — Transformação.** O Intermediador nasce com o contrato e instancia o médio (hospedado pelo Medium Horizon Host — o Intermediador é cliente dele). Decompõe: `WO-1` backend, `WO-2` frontend, `WO-3` QA. Irreversíveis autorizados no contrato: nenhum; `git push` a branch é compensável.

**5 — Microtask, com falha.** O Técnico de `WO-1` **concretiza** pela rota operacional: lê código (idempotente), escreve em branch (compensável, idempotency key), roda testes (idempotente). Tentativa 1 quebra regressão — o ledger registra. Tentativa 2 passa; o ciclo curto fecha com `AUTHORITY_relativa` completa. Ele **promove** (operador de fronteira, não passo do ciclo):

```
PromotionProposal { source_horizon: "microtask/WO-1", target_horizon: "transformação/tx-7",
  source_authority_ref: "wo1-g:final@lseq14",
  distilled: [artefato(diff), evidência(execução), claim-candidata("gate de idade cobre o pipeline")],
  excluded_summary: {attempts: 2, errors: 1, abandoned_paths: 1},
  evidence: [...], assumptions: [], based_on_seq: 4102, provenance: {...} }
```

O Intermediador julga — `AuditAssessment`: *"adequado; o teste de regressão novo cobre o caso que falhou"* (probabilístico, registrado). O host do médio processa a `AuditDecision(accepted)` = **admissão da proposta no médio**, com razões. O grafo curto de `WO-1` é destruído; o audit guarda eventos e contagens.

**6 — Contestação.** `WO-3` derruba a assumption: guest-checkout **não** passa pelo pipeline. Emite `Contestation { source: microtask/WO-3, target_ref: hipótese/a1, evidence: [execução demonstrando o bypass], severity: bloqueante }` — jamais edita o grafo médio (`DIRECT_EDIT_FORBIDDEN` se tentasse). A consequência declarada da assumption excede o contrato → `EXECUTING → WAITING_HUMAN`, `Escalation { options: [ampliar contrato, reabrir negociação, abortar], default_on_timeout: abortar }`. O operador amplia (`WO-4`, nova aprovação escopada). O que **não** aconteceu: a assumption não foi silenciosamente "corrigida" — sua queda está registrada, com autor e evidência.

**7 — Promoção ao persistente.** Tudo aceito no médio; `AUTHORITY_relativa` da transformação completa. O `PersistentDelta` (changeset nas células + `checkout-guest×4`; supersessão da claim de minimização; coverage_delta) atravessa **o gate da baseline** — que avalia do zero, cego à origem. Uma claim recusada: `ANCHOR_NOT_FOUND` — o Técnico ancorou em linha que a própria transformação moveu. Correção, re-submissão, admissão. `PROMOTING → DONE`, `seq = 4103`. Em nenhum momento "os Técnicos terminaram" implicou "o projeto agora é assim": três fronteiras separaram uma coisa da outra.

**8 — Recall, três semanas depois.** O escritório publica errata: a lei alcança também "medicamentos de venda livre". Semver de intenção: **major**. O manifesto `m-18` chega com `RecallNotice` federado; na importação (nunca por rede no gate), a cascata executa **sobre o grafo de derivação admitido**: a claim *"as categorias sujeitas são exatamente {bebidas}"* está no fechamento — status `admitted → contested`; a posse de `catalog×5` degrada `graph → suspended`, com cicatriz (D-16: dois nomes, duas coordenadas); o `seq` avança e transformações em voo sobre catalog ficam `STALE_BASE` automaticamente. O painel mostra a fratura, não um reset. O time reabre o ciclo para re-conquistar a célula. A claim antiga permanece no histórico como o que o sistema *acreditava* entre 4103 e 4171 — porque é isso que explica como o produto se comportou no intervalo. E se alguma claim local dependia da lei *sem aresta de derivação registrada*, a cascata não a alcançou — o preço da preguiça de proveniência, agora visível e mensurável (§10.2).

O exemplo encerra onde a tese sempre esteve: em nenhum passo alguém precisou de honestidade voluntária. **Cada transição foi barata de fazer certo e estruturalmente cara de fazer errado.**

---

# Parte IX — Programa experimental

## 27. Desenho geral: o que conta como prova

Três instrumentos, em ordem de custo: **VS-1** (§28) prova mecanismo; **alpha v1** (§29) prova valor; **o checklist de conformidade** (Apêndice D) prova protocolo. Todos herdam o método que o alpha v0 acertou mesmo errando o objeto: prompts congelados, veredito pré-registrado, verificação por log — nunca por autorrelato.

## 28. VS-1: a fatia vertical *[G]*

**VS-1a — contratos em isolamento, sem LLM.** `NegotiationSeed`, `PromotionProposal`, `PersistentDelta`, `Contestation`, `RecallNotice`, `OperatorApproval`, `Escalation`, topologia, guardas do statechart, cascata e propriedades de propagação (conservação por coordenada, fechamento, diamante, aciclicidade — property-based, com as regras da §11 como oráculo), e a conformidade **semântica** dos seis estados por horizonte, com a tabela da §5.1.1 como oráculo de revisão — seis labels não são seis estados. Se a mecânica falha sem inteligência, nada mais tem sentido. Cobre [G3], [G5], [G6].

**VS-1b — um par de horizontes real.** Intermediador (cliente) + host do médio + um Técnico em tarefa real: WorkOrder, gateway com as três classes, loop `AuditAssessment`/`AuditDecision` até `accepted` ou escalonamento, promoção curto→médio. Mede H2 e H1 no par mais barato; o ledger produz os primeiros números de H9.

**VS-1c — a pilha completa.** O cenário da Parte VIII ou equivalente: operador real, negociação, `CHANGE_READY` verificado, transformação, contestação, `PersistentDelta`, gate da baseline — mais um recall provocado e os ataques T4, T5, T6, T8, T9, T13 executados por componentes adversariais roteirizados. Fecha [G4] e alimenta todas as métricas.

**Desfechos pré-registrados:**

| Resultado | Consequência |
|---|---|
| Pilha completa, invariantes intactos, leakage = 0 **por mecanismo** | [E] migram para [B]; a rc vira v1.0 final |
| Leakage = 0 apenas **por disciplina de prompt** | recursividade revogada como *mecanismo*, rebaixada a *convenção* — registro em §36 |
| Loop não converge em tarefas reais | `N`, contratos ou decomposição voltam a desenho |
| Custo por horizonte proibitivo | H9 registra o limite como achado; o scratch não-memorial e os perfis são a válvula |

## 29. Alpha v1: o desenho que o alpha v0 pagou para ensinar *[G]*

Condições invertidas uma a uma: **feature transversal sem teste que a especifique** — o valor do grafo só existe onde *o que quebra se eu mexer* não é óbvio; **grafo carregando claims commitadas** — julgamento humano admitido (habilitado por `claims.ts`); **braços D × E** — D é o substrato sem Cognitive Plane, E é a VS-1c completa; **veredito pré-registrado, por log.**

> **Decisão D-15 — D×E antes de A–C.** **Alternativas rejeitadas:** benchmark imediato contra agente único, RAG e multiagente convencional — compararia dois sistemas imaturos com três maduros e mediria maturidade, não arquitetura; D isola exatamente a variável proposta. **Consequências:** a alegação de novidade externa (§33) espera mais um ciclo. **Reversibilidade:** n/a.

## 30. Hipóteses sob avaliação *[G]*

| # | Hipótese | Métrica primária | Falsificada se |
|---|---|---|---|
| **H1** | Promoção explícita reduz contaminação entre horizontes sem custo proibitivo | Cross-Horizon Leakage · Cost/Latency vs D | leakage > 0 por mecanismo, ou custo acima do limite de H9 |
| **H2** | O loop Intermediador↔Técnico converge em tarefas reais | Audit Loop Convergence | mediana ≥ N em tarefas médias |
| **H3** | Mérito cego ao chamador sobrevive a substituição adversarial em toda fronteira | Adversarial Substitution Survival · Caller-Blindness | qualquer I1–I10 quebra sob T1–T14 |
| **H4** | Memória governada de sessão reduz reaberturas e retrabalho | reaberturas de ponto resolvido, por sessão | sem diferença contra sessão sem OpenGraph |
| **H5** | Greenfield preserva I1 no chão greenfield | recusa dura; ponto fixo `ascent(project(intent))` | gate aprova âncora não verificável — novo F1 |
| **H6** | `CHANGE_READY` é verificável sem esconder inferência | recusas do Router a prontidão indevida | transição com `unresolved[]` não vazio aceita |
| **H7** | A linguagem material comunica sem legenda | teste de 4 estados com não-especialistas | distinção exige explicação |
| **H8** | O valor do grafo aparece quando a espec é menor que o artefato | uso real do servidor no braço E, por log | zero uso de novo, mesmo com objeto corrigido |
| **H9** | Governar horizontes curtos paga o próprio custo | ledger: overhead vs ganho em H1+H4 | overhead multiplicativo sem ganho mensurável |
| **H10** | A cascata calcula o fechamento exato **sobre o grafo admitido** | teste determinístico + property-based | **um** falso negativo *sobre arestas registradas* — falsos positivos tolerados |
| **H11** | O operador escopado não inviabiliza o uso | fricção: tempo, abandono, taxa de contorno | contorno sistemático — falsificação do desenho, não indisciplina |
| **H12** | A conformidade vale para o ecossistema real | ≥ 3 flavors do registry em L0–L1, por log | aprovação só com adaptação server-side por flavor |

**Critério de parada honesto:** H1, H3 e H10 são existenciais — falhando, a tese é revogada, não remendada. H4, H7, H9, H11 podem falhar derrubando escopo, não arquitetura. H12 falhando rebaixa a tese de protocolo a tese de produto — dolorosa, sobrevivível, registrada.

## 31. Métricas *[G]*

Herdadas da v0.4 §20, integrais: Persistent Contamination Rate (primária), Silent-Fail-Open Rate, Refusal Fidelity, Adversarial Substitution Survival, Caller-Blindness, Staleness of Interpretation, Cross-Horizon Leakage, Audit Loop Convergence, Assumption-to-Action Rate, Clarification Precision, Cost/Latency contra D.

Novas na v1.0:

| Métrica | Testa | Definição operacional |
|---|---|---|
| **Recall Propagation Completeness** | tese temporal (H10) | dependentes suspensos / dependentes **no grafo de derivação admitido**; alvo 100% |
| **Derivation Registration Ratio** | §10.2 — a sombra nova | arestas de derivação registradas / derivações declaráveis na admissão; tendência, não alvo — mede o teto do recall |
| **Recall-to-Rehabilitation Time** | tese temporal | suspensão por recall → re-conquista com prova |
| **Operator Scope Violation Rate** | tese de simetria | aprovações fora de escopo bloqueadas / tentadas |
| **Approval Staleness Rate** | tese de simetria | aprovações invalidadas por `ttl`/`seq` antes do uso |
| **Budget Exhaustion Outcomes** | R9 | exaustões terminando em escalonamento / total; alvo 100% |
| **Refusal Taxonomy Coverage** | D-3 | recusas com código da taxonomia / total |
| **Conformance Pass Rate por flavor** | tese de protocolo (H12) | itens do Apêndice D por log, por flavor |

---

# Parte X — Fechamento

## 32. O que o OpenGraph não é

Herdado da v0.4 §22, integral: não é apenas RAG; não é GraphRAG; não é Graph of Thoughts; não é multi-agent debate; não é empresa de agentes; não é swarm; não é memória infinita; não é framework de agentes com grafo embutido; não é cadeia linear curto → médio → longo — **e agora com a topologia da §6 isso é formal, não retórico.**

Três negações próprias da v1.0:

- **Não é blockchain nem DAO.** Sem consenso distribuído nem token: gate determinístico por tenant e manifestos assinados entre pares. Descentralização de implementação (L0–L4), não de autoridade — cada torre é soberana sobre o que admite.
- **Não é "human-in-the-loop" no sentido corrente.** O humano não é botão de aprovação fora da máquina; é root intencional dentro dela, com aprovação escopada, proveniente e expirável (§14). A diferença aparece exatamente quando importa: no incidente.
- **Não é um sistema de reputação.** Autoridade não acumula por histórico de acertos; conquista-se por prova, por célula, e revoga-se por drift ou recall. Um agente com mil acertos submete a claim mil e um ao mesmo gate cego — histórico prediz, e o sistema não persiste predição como verdade.

## 33. Posicionamento — agosto de 2026 *[B + E]*

A varredura da v0.4 §23 permanece: proveniência, supersessão e propagação governada são estado da arte, não diferencial [16][21][22]; o vocabulário de estados de [23] foi deliberadamente adotado em vez de reinventado. A alegação de novidade, em três camadas da mais defensável à mais especulativa:

1. **[B]** Posse de verdade granular por célula, conquistada por prova de regeneração, revogada por drift, sustentada por âncora verbatim — implementada e exercitada. Sem condicional.
2. **[E]** A preservação recursiva dessa semântica através de uma topologia declarada de horizontes, com promoção mecânica e agentes — humano incluído — sem direito de promoção implícita. A tese da v0.4, agora com mecanismo (Parte III) e falsificação (Parte IX).
3. **[E]** A proposta de composição como protocolo: EAP com conformidade cliente/host, taxonomia de recusas, operador escopado, recall governado e regras de propagação por coordenada. No levantamento corrente, protocolos de interoperabilidade padronizam *comunicação e capacidade* (MCP [24], A2A [29]); **nenhum padroniza autoridade epistêmica**. A alegação é sobre ausência — refutável por um único contraexemplo: barata de auditar, cara de sustentar.

Camadas 2 e 3 permanecem condicionadas a revisão sistemática e ao experimento comparativo (D-15 adia A–C deliberadamente).

## 34. Doze leis de projeto

As nove da v0.4, intactas:

> **Lei 1** — Inferir ≠ afirmar.
> **Lei 2** — Perguntar ≠ modificar.
> **Lei 3** — Produzir ≠ admitir.
> **Lei 4** — Memória útil ≠ memória permanente.
> **Lei 5** — LLMs decidem conteúdo; o protocolo decide fluxo e autoridade.
> **Lei 6** — Um gate que falha em silêncio é pior que a ausência de gate: produz confiança sem garantia.
> **Lei 7** — Um componente cognitivo deve poder ser substituído por um adversário sem ganhar autoridade persistente.
> **Lei 8** — A mesma máquina epistemológica se repete em todo horizonte; autoridade no filho não é autoridade no pai.
> **Lei 9** — Memória governada é OpenGraph no horizonte em que vive; promoção é explícita, destruição é permitida.

E três da v1.0:

> **Lei 10** *(v1.0)* — Nenhuma coordenada de autoridade melhora por composição, endosso, aprovação ou importação — só por sua prova própria. Derivar, promover, importar e aprovar conservam ou degradam.
> **Lei 11** *(v1.0)* — O operador é root intencional, não root epistemológico: soberano sobre intenção, risco e o irreversível; impotente, como todo agente, para fabricar evidência. A raiz de verificação é o protocolo, não uma espécie.
> **Lei 12** *(v1.0)* — Verdade admitida é verdade versionada. Corrigir é promover uma contestação com cascata calculada sobre o que foi registrado; reescrever o passado é a única correção proibida — e o que não foi registrado como derivação é o que nenhuma correção alcança.

A Lei 6 foi paga com F1, F7 e um log que mentiu 59 vezes. As Leis 10–12 permanecem [E] até que a VS-1 as pague ou as revogue.

## 35. Questões abertas *[A]* — o que a v1.0 explicitamente não promete

- **Derivation coverage** *(nova, §10.2)* — como medir e incentivar a completude do grafo de derivação; a cobertura censitária prova nós, não arestas semânticas; o `Derivation Registration Ratio` é termômetro, não solução.
- **Federação ativada** — mecanismo [C]; gate de execução válido; desenho do recall federado registrado para compatibilidade.
- **Sandbox de execução real** — 1.0 gradua classificação + registro + contrato; isolamento de processo é 1.x.
- **A cidade completa, o airlock, o gesto de explosão** — só H7 gradua.
- **Baselines A–C** — depois de D×E (D-15).
- **Replay e retenção avançada de horizontes efêmeros.**
- **Conflito semântico entre transformações concorrentes** — locks detectam colisão sintática (§8); o conflito de significado sem colisão de células permanece o problema mais difícil do Runtime Plane.
- **Extensões da topologia** — horizontes especializados além dos cinco; o DAG é extensível por declaração, mas os critérios de uma extensão legítima não estão escritos.
- **Multi-tenant do Cognitive Plane** — a VS-1 é single-operator por desenho.
- **Evolução do próprio EAP** — processo de mudança do protocolo fica para quando houver mais de uma implementação; especificá-lo antes seria governança de uma comunidade de um.

## 36. Meta-análise *[histórica]*

A concepção do OpenGraph reproduziu, em cada versão, o fenômeno que pretende controlar:

**v0.1** — inferência preenchendo lacunas de descrição. **v0.2** — o oposto: só o que tinha código tratado como a totalidade do conceito. **v0.3** — separou os planos, diluiu a recursividade, proibiu demais. **v0.4** — restaurou a recursividade; deixou promoção como narrativa, operador fora da máquina, correção sem resposta, propagação sem regra, topologia por intuição. **v1.0 draft 1** — conservadorismo como fabricação às avessas: modéstia não especificada também é lacuna. **v1.0 rc1** — abrangência como fabricação de profundidade: cobriu tudo, desenvolveu pouco. **v1.0 rc2** — a instância mais sutil até aqui: **formalização que troca o formalizado.** Ao dar nomes de protocolo à máquina, removeu `CONCRETIZAÇÃO` e embutiu `PROMOTE` no ciclo; ao dar álgebra à autoridade, colapsou posse, status e completude numa escala que a v0.4 proibia nominalmente; ao dar economia à memória, chamou de "memória" o que não podia sê-lo. Nenhum desses erros parecia erro — cada um parecia rigor. É exatamente assim que um gate falha aberto.

A correção consolidada da rc3, em forma de critério:

> **Formalizar é traduzir, não editar.** Uma formalização está correta quando o objeto formalizado passa intacto pelo teste de compatibilidade [G0] — e quando cada desvio deliberado do original é declarado como desvio, com marca, justificativa e teste, nunca embutido como consequência silenciosa da notação. As convenções de derivabilidade (§0.3) continuam valendo para profundidade; [G0] passa a valer para fidelidade.

A cadeia de versões continua sendo uma cadeia de promoção conceitual: cada versão é a `PROPOSTA` que a auditoria seguinte delibera. Nenhuma é apagada; todas são evidência das hipóteses que sobreviveram, foram revogadas ou precisaram de reespecificação.

## 37. Conclusão

Grande parte da evolução de agentes LLM busca mais capacidade. O OpenGraph mantém a pergunta complementar — como permitir que modelos conversem, naveguem, negociem e ajam sem que capacidade se confunda com o direito de transformar conclusão em verdade — e a v1.0 a estende três vezes:

```
para o ecossistema:   propõe-se um protocolo — qualquer agente, qualquer domínio, qualquer runtime
para o humano:        root intencional dentro da máquina; aprovação escopada; evidência infabricável
para o tempo:         verdade versionada; correção por recall sobre o que foi registrado; passado imutável
```

A baseline respondeu com mecanismos verificáveis. A v0.3 recolocou inteligência sobre o substrato sem entregar o gate. A v0.4 tornou a máquina recursiva por horizonte. A v1.0 fecha o que faltava **sem tocar na máquina**: a topologia como DAG declarado, a promoção e a contestação como operadores de fronteira, a correção como recall, a propagação como regras por coordenada, o operador como root intencional escopado — e o conjunto como proposta de protocolo.

```
conversar ≠ saber
inferir   ≠ afirmar
executar  ≠ admitir
admitir no filho ≠ admitir no pai
aprovar   ≠ provar
corrigir  ≠ reescrever
persistir = atravessar um protocolo de autoridade
```

A definição consolidada da v1.0:

> **OpenGraph é um substrato epistêmico verificável que também funciona como memória governada em múltiplos horizontes — e a v1.0 propõe extrair sua semântica como protocolo de autoridade epistêmica. Em cada horizonte, conhecimento percorre a máquina recursiva de seis estados; atravessar uma fronteira da topologia exige nova admissão; nenhuma coordenada de autoridade melhora por composição, só por prova própria; o operador é soberano sobre intenção e risco, e impotente — como todo agente — para fabricar evidência; verdade é versionada e corrigível por recall sobre o grafo de derivação admitido, nunca por reescrita. Agentes — de silício ou de carbono — podem inferir e agir; nenhum resultado persiste como verdade apenas porque foi gerado, executado ou aprovado.**

O caminho crítico da graduação, em ordem e sem atalho: **(1)** VS-1a — contratos, topologia, cascata e propagação com testes adversariais [G3, G5, G6]; **(2)** VS-1b — o par cliente/host real com gateway e ledger; **(3)** VS-1c — a pilha completa com recall provocado e os ataques do catálogo [G4]; **(4)** alpha v1 e o checklist de conformidade [G2]. Tudo o mais espera, porque nada do resto falsifica a tese.

Se a VS-1 e o alpha v1 confirmarem H1, H3 e H10, a v1.0 final será este documento com as marcas trocadas. Se falsificarem, será mais valioso ainda: o registro de qual metade da tese sobreviveu. Nas duas hipóteses, o documento seguinte será escrito com a única tinta que o projeto aceita — evidência.

---

## Referências

[1]–[23] — herdadas integralmente da v0.4: Lewis et al. 2020 (RAG); Yao et al. 2023 (ReAct); Sumers et al. 2024 (CoALA); Packer et al. 2023 (MemGPT); Hong et al. 2024 (MetaGPT); Wu et al. 2023 (AutoGen); Edge et al. 2024 (GraphRAG); Dongre et al. 2024 (ReSpAct); Shinn et al. 2023 (Reflexion); Madaan et al. 2023 (Self-Refine); Zhuge et al. 2024 (Agent-as-a-Judge); W3C 2013 (PROV-O); Yang et al. 2024 (SWE-agent); Roynard 2026 (arXiv:2604.11364); Du 2026 (arXiv:2603.07670); Margalit et al. 2026 (arXiv:2606.24535); Jamshidi et al. 2026 (Hallucination Cascade); Harel 1987 (Statecharts); Garcia-Molina & Salem 1987 (Sagas); Hewitt et al. 1973 (Actors); Taheri 2026 (arXiv:2603.17787); Lam et al. 2026 (SSGM); *Governed Collaborative Memory* 2026 (arXiv:2605.04264).

[24] Anthropic (2024–2026). *Model Context Protocol — Specification.* Binding de transporte de referência do EAP.
[25] Preston-Werner, T. *Semantic Versioning 2.0.0.* — o contrato de compatibilidade que o semver de intenção estende do código para a intenção.
[26] OpenSSF. *SLSA — Supply-chain Levels for Software Artifacts.* Níveis de conformidade verificáveis como modelo para L0–L4.
[27] C2PA. *Technical Specification.* Proveniência assinada como precedente para manifestos de torre.
[28] Fowler, M. (2005). *Event Sourcing.* O padrão que I7 e a tese temporal materializam: estado é dobra do log, nunca o contrário.
[29] Google (2025). *A2A — Agent2Agent Protocol.* Padroniza comunicação e capacidade, não autoridade epistêmica (§33).

---

## Apêndice A — Esquemas de contrato consolidados *[E]*

Herdados da v0.4 §12, inalterados: `ChangeProposal`, `ImpactAnalysis`, `AcceptedPredictiveHypothesis`, `ChangeContract`, `WorkOrder`, `ArtifactBundle` — e o par corrigido na rc3:

```
AuditAssessment {                        // julgamento semântico — pode ser probabilístico
  task_id, judgment, reasons[], attempt
}
AuditDecision {                          // consequência governada — segue o protocolo do horizonte
  task_id, assessment_ref,
  verdict: accepted | revise | escalate,   // accepted = admissão da PromotionProposal no médio
  reasons[], attempt
}
```

Novos da v1.0 (definidos em §6.1, §7–§10, §14–§15): `NegotiationSeed`, `PromotionProposal`, `PersistentDelta`, `Contestation`, `RecallNotice`, `OperatorApproval`, `Escalation`.

Proveniência mínima — alinhada a PROV-O [12] no vocabulário, sem importar a ontologia. `derivation` deixa de ser burocracia: é o limite físico do recall (§10.2):

```
Provenance {
  origin_agent, origin_horizon,
  evidence_refs[],
  derivation,           // deps — insumo da regra 1 da propagação E teto do recall
  audited_by?, based_on_seq
}
```

Estados de supersessão — vocabulário de [23] adotado, mapeado sobre o da v0.4 (dimensão STATUS da §11, jamais misturada com posse α/β):

```
ratified ↔ ACTIVE ↔ admitted          superseded ↔ SUPERSEDED ↔ superseded
rejected ↔ REVOKED ↔ revoked          abstained  ↔ CHALLENGED ↔ contested
```

Três vocabulários, uma dimensão — a coluna da direita é o STATUS da §11, e é a forma normativa; as demais são mapeamento histórico ([23]) e legado (v0.4). `suspended` não aparece aqui por definição: é posse, não status (D-16).

## Apêndice B — Workflow Orchestration Statechart *[E]*

Este é o autômato **operacional** do Router — não a Epistemic Lifecycle Machine da §5.1, e não a substitui (§5.1.2). `EXECUTING` no workflow não implica que os OpenGraphs estejam em `CONCRETIZE`: num instante real, WO-1 pode estar em `AUTHORITY`, WO-2 em `VERIFY`, WO-3 em `DELIBERATE`. A composição é coordenação: os hosts possuem os lifecycles; o Router os observa e decide as transições abaixo.

Estados: `CHAT · QUERY · NEGOTIATING · CHANGE_READY · PLANNING · EXECUTING · VERIFYING · WAITING_HUMAN · PROMOTING · DONE · ABORTED`

| Transição | Guarda determinística |
|---|---|
| `CHAT → QUERY` | consulta; nunca instancia horizontes de mutação |
| `QUERY → CHAT` | resposta incorporada ao OpenGraph de sessão |
| `CHAT → NEGOTIATING` | intenção de mudança confirmada pelo operador |
| `NEGOTIATING → CHANGE_READY` | predicado triplo da §13, verificado pelo Router |
| `NEGOTIATING → ABORTED` | abandono/expiração; promoção vazia com `excluded_summary` |
| `CHANGE_READY → PLANNING` | `ChangeContract` emitido; Intermediador + host do médio instanciados |
| `PLANNING → EXECUTING` | WorkOrders emitidas; grafos curtos instanciados com budget |
| `EXECUTING → VERIFYING` | `ArtifactBundle` + `PromotionProposal` recebidos |
| `VERIFYING → EXECUTING` | `AuditDecision(revise)` ∧ `attempt < N` ∧ budget disponível |
| `VERIFYING → WAITING_HUMAN` | `escalate` ∨ `attempt ≥ N` ∨ `BUDGET_EXHAUSTED` ∨ `Contestation(bloqueante)` fora do contrato |
| `VERIFYING → PROMOTING` | todas as WorkOrders com `AuditDecision(accepted)` |
| `PROMOTING → DONE` | `PersistentDelta` admitido pelo gate da baseline; changeset commitado |
| `PROMOTING → WAITING_HUMAN` | `STALE_BASE` ∨ recusa do gate ∨ `Contestation(invalidante)` |
| `WAITING_HUMAN → {options[]}` | `OperatorApproval` válida (escopo, `ttl`, `seq`) para a transição escolhida |
| `WAITING_HUMAN → ABORTED` | `default_on_timeout` — exaustão nunca promove (R9) |
| `* → ABORTED` | aborto preserva audit e `excluded_summary`; efêmeros destruíveis |
| `* → NEGOTIATING` | apenas via `Contestation(invalidante)` sobre a hipótese, decidida pelo Router |

Propriedade global verificável: **não existe caminho para `PROMOTING` ou `DONE` a partir de exaustão, timeout ou abandono.** Abortar preserva mais que promover.

## Apêndice C — Mapa de migração das marcas (v0.4 → v1.0)

| Elemento | v0.4 | Destino exigido na v1.0 final |
|---|---|---|
| Invariantes I1–I10 + máquina de seis estados | [B] / definição | [B] — intocáveis ([G0]) |
| Três planos / coordenadas / horizontes | [E] | [B] por uso na VS-1 |
| Duas rotas, fronteira única | [E] | [B] via gateway §16 + T11 |
| Recursividade instrumentada (operadores de fronteira) | [E] | [B] via VS-1 **ou revogada** (H1) |
| Topologia de horizontes como DAG | — (intuição) | [B] — declarada, testada por `HORIZON_SKIP` |
| `INITIATE` / `NegotiationSeed` | — (fronteira informal) | [B] via VS-1c — contexto atravessa com proveniência, autoridade não |
| Tipagem única de `suspended` (posse) | — (ambíguo desde a baseline) | [B] — vocabulário verificado em logs e telas |
| Semântica universal dos seis estados (§5.1.1) | [E] implícito | [B] — conformidade L3 verifica a relação, não os rótulos |
| Memória = OpenGraph por horizonte | [E] | [B] com semântica normativa + referência (D-12) |
| Scratch não-memorial | — | [B] — teste de reutilização; R6 integral |
| Hipótese Preditiva Aceita / `CHANGE_READY` | [E]/[A] | [B] via predicado §13 [G6] |
| Loop Intermediador↔Técnico (`AuditAssessment`/`AuditDecision`) | [E] | [B] via VS-1b (H2) |
| `PromotionProposal` / `PersistentDelta` | — | [B] com testes [G3, G4] |
| `Contestation` / `RecallNotice` / cascata | — | [B] com teste determinístico [G5] (H10, escopada) |
| `OperatorApproval` / root intencional escopado | — | [B] via VS-1c com T4/T7 |
| Coordenadas + regras de propagação | — | [B] — property-based com as regras como oráculo |
| Taxonomia de recusas | [B] parcial | [B] — Refusal Taxonomy Coverage |
| EAP conformidade L0–L2 (cliente/host) | [B] implícito | [B] explícito via checklist [G2] (H12) |
| Conformidade L3 | [E] | [B] via VS-1 **ou permanece [E] com registro** |
| Proveniência mínima (com `derivation` como teto do recall) | [A] | [B] — schema em uso + Derivation Registration Ratio |
| Greenfield | [C] | [B] mínimo via H5 (D-14) |
| `claims.ts` | [C] | [B] no bootstrap da VS-1 |
| Federação / L4 | [C] | [C] — permanece, 1.x |
| Materiais epistêmicos / cidade | [E] | H7 gradua; o resto é 1.x |

## Apêndice D — Checklist de conformidade EAP (esqueleto) *[E → G2]*

Cada item verificável **por log do host** — autorrelato não conta, nunca. Os níveis L0–L1 certificam **clientes** (agentes); L2–L4 certificam **hosts**. Nenhum agente certifica como host.

**L0 — cliente leitor:** resolve resources; query e `history/since`; distingue recusa de erro de transporte; nunca trata resposta de um horizonte como autoritativa fora dele.

**L1 — cliente propositor:** staging válido; ciclo de changeset; toda claim com âncora e proveniência (incluindo `derivation`); `based_on_seq` em toda proposta; recusa como resultado de primeira classe — exibe código e razões, cumpre a obrigação da taxonomia, não re-submete cegamente.

**L2 — host admissor:** gate cego ao chamador (mesmo conteúdo ⇒ mesmo veredito sob N identidades); recusa com código da taxonomia; âncora verbatim com bloqueio duro; cobertura para posse β; drift graduado; forma canônica de célula em toda borda; verificação 100% offline; audit separado do grafo; aciclicidade do grafo de derivação na admissão.

**L3 — host recursivo:** topologia declarada como DAG; horizontes com perfis semânticos (§19); `PromotionProposal` com as cinco regras da §7; `CHANGE_READY` por predicado; contestação por evento com três severidades; escalonamento sem promoção implícita; budgets com R9; cascata de recall com fechamento calculado sobre o grafo admitido; propriedades de propagação da §11 verificáveis.

**L4 — host federado:** manifesto assinado; refs congeladas por seq de importação; regra 3 da propagação; semver de intenção; recall federado por importação de manifesto, nunca por rede no gate.
