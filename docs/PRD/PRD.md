# PRD — OpenGraph v1.0 "Graduação"

**Documento de requisitos de produto · derivado mecanicamente do Working Paper v1.0-rc4 (10 de agosto de 2026)**

> **Regra de precedência.** Este PRD é derivado do `OpenGraph_Working_Paper_v1_0.md` (versão 1.0-rc4) e do registro histórico `OpenGraph_Working_Paper_v0_4.md`. O paper é a fonte de verdade: **onde este documento divergir do paper, este documento está errado.** Nenhum requisito aqui pretende introduzir mecanismo, contrato, métrica ou hipótese que o paper não contenha; o que a execução exige e o paper não decide está registrado na §11 como questão aberta, com recomendação explicitamente marcada como recomendação.

**Marcas de estado, preservadas do paper (§0.3).** **[B]** baseline conquistada, com evidência no repositório · **[C]** construído e desligado, código vendorado e nunca exercitado — não é prova · **[E]** evolução proposta, que precisa de justificativa e de teste de não-regressão · **[A]** aberto, requisito reconhecido com desenho não resolvido · **[G]** critério de graduação.

**Aviso de honestidade sobre este ciclo.** Quase todo o Cognitive Plane está em **[E]** com zero linhas executadas (W1). Este PRD descreve o que **será construído e medido** — não o que existe. Nenhum requisito abaixo pode ser lido como descrição de comportamento atual, exceto os explicitamente marcados [B].

---

## 1. Sumário executivo

O ciclo v1.0 constrói os mecanismos que faltavam para que a arquitetura cognitiva recursiva da v0.4 deixe de ser narrativa e vire propriedade verificável: a **topologia de horizontes como DAG declarado** (§6), a **promoção e a contestação como operadores de fronteira tipados** (§7–§9), a **correção do persistente por recall com cascata calculada** (§10), o **operador humano dentro da máquina como root intencional escopado** (§14), as **três coordenadas ortogonais de autoridade com regras de propagação** (§11) — e propõe a extração de tudo isso como **protocolo independente de implementação (EAP)**, com o servidor do repositório como implementação de referência (§5). A máquina recursiva de seis estados não é tocada: [G0] a blinda, e a rc2 falhou duas vezes nesse teste antes da correção.

**O critério de sucesso deste ciclo não é "funcionar". É "medir".** O paper define três instrumentos em ordem de custo — VS-1 prova mecanismo, alpha v1 prova valor, o checklist de conformidade prova protocolo (§27) — e pré-registra os desfechos antes da execução (§28, §30). Entre os desfechos pré-registrados estão, sem eufemismo:

| Desfecho pré-registrado | Consequência declarada (§28, §30) |
|---|---|
| Pilha completa com invariantes intactos e `Cross-Horizon Leakage = 0` **por mecanismo** | os [E] migram para [B]; a rc vira v1.0 final |
| Leakage zero apenas **por disciplina de prompt** | recursividade revogada como mecanismo e rebaixada a convenção, com registro |
| Loop Intermediador/Técnico não converge em tarefa real | `N`, contratos ou decomposição voltam a desenho |
| Custo por horizonte proibitivo | H9 registra o limite como **achado**, não como falha de execução |
| H1, H3 ou H10 falsificadas | **a tese é revogada, não remendada** — critério de parada honesto |
| H12 falsificada (menos de três flavors em L0–L1 sem adaptação server-side) | a tese de protocolo rebaixa a tese de produto, com registro |

Duas regras de processo governam o ciclo inteiro e são citadas nos requisitos onde couberem. **[G0]** — a v1.0 pode adicionar mecanismos ao redor da máquina recursiva, jamais alterá-la, e jamais confundir autoridade relativa de horizonte com posse α/β da verdade. **[G1]** — a versão final não contém nenhuma tese central em [E]: cada [E] termina em [B] com evidência, revogada com registro, ou rebaixada a 1.x sem fingir prova.

Uma lição de método atravessa todos os critérios de aceite deste documento: **verificação por log do host, nunca por autorrelato do agente** (§0.3, Convenção 2; Apêndice D). Ela foi paga duas vezes — por um instrumento de diagnóstico que registrou `ok:true` 59 vezes seguidas com zero claims produzidas (I6), e pelo alpha v0, cujo braço com MCP não usou o servidor uma única vez, fato descoberto por log e não por relato (§2.5).

---

## 2. Problema e oportunidade

### 2.1 O problema herdado, em treze fraquezas nomeadas

A v0.4 entregou uma arquitetura cuja parte mais importante nunca executou. O paper enumera as fraquezas e onde cada uma é atacada (§3); este ciclo existe para fechá-las:

| # | Fraqueza (§3) | Onde este PRD a ataca |
|---|---|---|
| W1 | Cognitive Plane inteiro em [E], sem uma linha executada | M3–M5 (VS-1a/b/c), épicos A–G |
| W2 | Promoção entre horizontes é narrativa, não mecanismo | Épico B (`PromotionProposal`) |
| W3 | `CHANGE_READY` sem condição determinística | Épico D (predicado triplo) |
| W4 | Programa de avaliação sem harness; métricas jamais coletadas | Épico J (harness D×E) |
| W5 | Custo da recursividade não modelado | Épico G (ledger e budgets) |
| W6 | Proveniência e supersessão em [A] no coração do contrato estável | Épico C (esquema mínimo, Apêndice A) |
| W7 | Capability Gateway é caixa nomeada | Épico F (classes de efeito) |
| W8 | Greenfield declarado "o mecanismo", mas é código morto | Épico I (teste antes de ligar) |
| W9 | R6 exige memória governada; nada mede se isso paga o custo | Épico G (scratch não-memorial) + H4/H9 |
| W10 | `WAITING_HUMAN` sem contrato; operador fora da máquina | Épicos D e E |
| W11 | "E se o persistente estiver errado?" sem resposta | Épico C (recall) |
| W12 | Propagação de degradação entre claims derivadas indefinida | Épico C (coordenadas e propagação) |
| W13 | Topologia de horizontes jamais declarada | Épico B (DAG normativo) |

W11 e W12 tocam a tese central diretamente: um sistema cuja verdade admitida não pode ser corrigida de forma governada apenas mudou o lugar onde a contaminação se esconde, e um gate perfeito com propagação indefinida verifica cada claim isoladamente enquanto a combinação degradada passa incólume.

### 2.2 A oportunidade: a lacuna é de autoridade, não de comunicação

O paper enumera oito paradigmas correntes que a v1.0 rompe (§4) — memória como vector store, capacidade implicando confiabilidade, human-in-the-loop como raiz incontestável, correção por sobrescrita, frameworks que possuem a pilha inteira, integração de conhecimento como pipeline de RAG, confiança expressa em scores, verdade como estado atual do banco. Quatro dessas rupturas são inversões, não refinamentos: memória como jurisdição e não como recuperação; humano como root intencional e não como botão; correção como recall e não como edição; composição como protocolo e não como produto.

A oportunidade central é declarada em §4 e §33: **MCP [24] e A2A [29] padronizam como agentes falam e o que podem fazer; nenhum protocolo corrente padroniza o que agentes têm o direito de afirmar.** Existe interoperabilidade de capacidade sem interoperabilidade de autoridade. Essa é uma alegação sobre ausência — barata de auditar, cara de sustentar, refutável por um único contraexemplo — e é exatamente por isso que o paper a apresenta como aposta estratégica [E] amarrada a H12, e não como fato consumado (D-1).

A janela concreta que torna a aposta executável está no repositório: a fronteira MCP cliente-agnóstica é [B], e o HEAD já contém um registry de adapters com `AgentFlavorDef` para 11 flavors, com `doctor` e `install` (§2.6, §5.5). A borda do ecossistema não é aspiração; é código commitado ao qual faltam duas metades — declarar o nível de conformidade do flavor e declarar a classificação de efeito das tools que ele traz.

---

## 3. Personas e jobs-to-be-done

Os níveis de conformidade certificam dois papéis distintos, e o PRD nunca os mistura: **L0–L1 certificam clientes-agentes; L2–L4 certificam hosts. Nenhum agente é L2, nunca** (ADR-0007, §5.3, §12). A assimetria é o que torna a adoção plausível: a maioria absoluta do ecossistema só precisa de L0–L1 — o análogo de "todo site fala HTTP; pouquíssimos implementam um servidor HTTP".

| Persona | Necessidade real | O que consegue hoje **[B]** | O que este ciclo lhe dá | Conformidade |
|---|---|---|---|---|
| **Operador** (humano que decide a mudança) | decidir intenção, aceitar risco declarado e autorizar o irreversível sem que sua assinatura vire evidência fabricada | ciclo de changeset por cliente MCP genérico; recusa registrada com razões (I6) | `OperatorApproval` escopada, proveniente e expirável; `WAITING_HUMAN` como estado tipado com opções enumeradas; recusa terminal para o inaprovável (§14, §15) | consome hosts L2/L3 |
| **Integrador de flavor** (quem conecta um agente ao OpenGraph) | conectar seu agente sem portar o produto e saber exatamente o que precisa implementar | endpoint compliant + plugin fino; registry com 11 flavors, doctor e install | checklist executável L0–L1 (Apêndice D), taxonomia de recusas com obrigação de cliente, declaração de nível e de classe de efeito no adapter | produz clientes L0/L1 |
| **Mantenedor de torre** (quem publica conhecimento de domínio para terceiros) | publicar um domínio — inclusive sem código — e emitir errata que atravesse o ecossistema | escada 0..5 e gate no brownfield; `greenfield.ts` **[C]**, nunca exercitado | greenfield ligado com teste (H5), fazendo qualquer domínio com texto ancorável hospedar uma torre; desenho de recall federado registrado para compatibilidade — **ativação permanece 1.x** | consumiria L4 **[C]** |
| **Auditor** (quem precisa responder "o que acreditávamos quando decidimos X") | reconstruir crença histórica, alcance de contaminação e quem aprovou o quê | JSONL append-only separado do grafo (I7); `seq` monotônico; recusas registradas | histórico intacto sob recall; fechamento calculado e registrado; `excluded_summary` na destruição de horizonte; `risks_assumed[]` nominal por aprovação | lê logs de hosts L2/L3 |

Nota de honestidade para o mantenedor de torre: este ciclo **não** entrega federação operante. O mecanismo permanece [C] com gate de execução válido ("dois times pedindo"), e o único compromisso do ciclo é que o contrato de recall nasça compatível com propagação federada, porque retrofitá-la depois seria redesenho e não extensão (§23, §35).

---

## 4. Objetivos e não-objetivos

### 4.1 Objetivos, mapeados nos critérios de graduação

| # | Objetivo | Critério [G] | Onde gradua |
|---|---|---|---|
| O1 | Formalizar sem editar o formalizado: a máquina de seis estados sobrevive intacta à especificação | **[G0]** | M3 (oráculo semântico, §5.1.1) |
| O2 | Terminar o ciclo sem nenhuma tese central em [E] — cada uma vira [B], revogada ou 1.x | **[G1]** | M8 (revisão de graduação) |
| O3 | Provar que a conformidade vale para o ecossistema real, com três flavors distintos em L0–L1 verificados por log do host | **[G2]** | M6 |
| O4 | Tornar a promoção um objeto de primeira classe, validável por host sem julgamento probabilístico | **[G3]** | M3 |
| O5 | Provar que a promoção ao persistente reusa o gate pago, com veredito idêntico sob identidade hostil | **[G4]** | M5 |
| O6 | Provar que a cascata de recall calcula o fechamento exato sobre o grafo de derivação admitido | **[G5]** | M3 e M5 |
| O7 | Tornar `CHANGE_READY` verificável por predicado, com recomendação de LLM e transição de Router | **[G6]** | M3 |

### 4.2 Não-objetivos deste ciclo (derivados de §35)

| Não-objetivo | Motivo declarado no paper |
|---|---|
| **Federação ativada** | mecanismo [C]; gate de execução ("dois times pedindo") segue válido; só o desenho do recall federado é registrado, para compatibilidade |
| **Sandbox de execução real** | a 1.0 gradua classificação, registro e vínculo ao contrato; isolamento de processo é 1.x |
| **A cidade completa, o airlock, o gesto de explosão, o zoom completo** | só H7 pertence à graduação: quatro estados lado a lado, sem legenda, distinguíveis por não-especialistas |
| **Baselines A–C** (agente único, agente + RAG, multiagente convencional) | D-15: compararia dois sistemas imaturos com três maduros e mediria maturidade, não arquitetura; D×E isola a variável proposta |
| **Replay e retenção avançada de horizontes efêmeros** | não é requisito de 1.0 (§19) |
| **Conflito semântico entre transformações concorrentes** | locks detectam colisão sintática; conflito de significado sem colisão de células permanece o problema mais difícil do Runtime Plane |
| **Critérios de extensão legítima da topologia** | o DAG é extensível por declaração, mas os critérios não estão escritos |
| **Multi-tenant do Cognitive Plane** | a VS-1 é single-operator por desenho |
| **Processo de evolução do próprio EAP** | especificá-lo com uma implementação seria governança de uma comunidade de um |
| **Solução para *derivation coverage*** | o `Derivation Registration Ratio` é termômetro, não solução; a questão fica [A] com nome próprio |

---

## 5. Requisitos funcionais por épico

**Convenções desta seção.** Prioridades: **P0** bloqueia a graduação (liga-se a um [G] ou a uma hipótese existencial H1/H3/H10) · **P1** é necessário para que o desfecho do experimento seja informativo · **P2** fortalece sem bloquear. Todo critério de aceite é **verificável por log do host** — qual teste, contra qual adversário, com qual veredito observável. Requisitos P0 que possuem adversário nomeado no catálogo T1–T14 (§17) carregam o aceite adversarial explícito.

### Épico A — Máquina epistemológica e semântica dos seis estados

O objeto protegido por [G0]. Nada aqui pode alterar a máquina; tudo aqui a instrumenta.

| ID | Requisito | Pri | Aceite verificável por log | ADR | Paper | H/T |
|---|---|---|---|---|---|---|
| FR-A1 | O host expõe a Epistemic Lifecycle Machine com exatamente seis estados (`PROPOSE`, `DELIBERATE`, `ADMIT`, `CONCRETIZE`, `VERIFY`, `AUTHORITY_relativa`), executada integralmente dentro de cada horizonte | P0 | suíte de compatibilidade [G0] falha se qualquer estado sumir, for renomeado ou for substituído por operador de fronteira; log do host registra a sequência de estados por horizonte instanciado | ADR-0002 | §5.1, §1 | H1 |
| FR-A2 | Cada verbo declara pré-condição, pós-condição e modos de recusa conforme a tabela normativa de §5.1 | P0 | teste por verbo: pré-condição ausente produz recusa com código da taxonomia, registrada como recusa (I6); nenhuma execução de verbo sem pré-condição satisfeita aparece no log | ADR-0002 | §5.1 | T1 |
| FR-A3 | `CONCRETIZE` é definido como materialização na forma concreta própria do horizonte; o Capability Gateway é a borda externa em certos horizontes, não a definição | P0 | horizontes de sessão e negociação concretizam sem tocar o gateway, com evento de concretização no log; implementação que exija gateway para concretizar em sessão falha o oráculo semântico | ADR-0003 | §5.1.1, §16 | H1 |
| FR-A4 | As três relações invariantes (`ADMIT` separa candidato de aceito; `VERIFY` confronta o concretizado com o admitido; `AUTHORITY_relativa` habilita governar dentro do horizonte e nada além) valem nas cinco colunas de horizonte | P0 | oráculo de revisão da VS-1a com a tabela de §5.1.1: implementação cujo `ADMIT` de sessão não distingue candidato de aceito é reprovada por semântica — seis labels não são seis estados | ADR-0003 | §5.1.1 | H1 |
| FR-A5 | Os dois autômatos são nomeados e implementados como dois: Epistemic Lifecycle Machine (por OpenGraph, dos hosts) e Workflow Orchestration Statechart (do Router) | P0 | log de um instante real mostra workflow `EXECUTING` com lifecycles simultâneos em `AUTHORITY`, `VERIFY` e `DELIBERATE`; qualquer acoplamento que force os lifecycles a acompanhar o workflow é bug de conformidade | ADR-0004 | §5.1.2, Apêndice B | H1 |
| FR-A6 | Julgamento semântico e transição de autoridade são objetos distintos: `AuditAssessment` (probabilístico, do agente) e `AuditDecision` (governada, do host) | P0 | log contém os dois registros com `assessment_ref` ligando-os; nenhum caminho no host transita autoridade sem `AuditDecision`; assessment positivo isolado não altera estado | ADR-0005 | §5.1, §12, Apêndice A | T3 |
| FR-A7 | A deliberação registra `SUPPORTED`, `UNKNOWN`, `AMBIGUOUS`, `INFERRED` e `CONFLICTING` de forma distinguível, e nenhum `INFERRED` atravessa para `resolved[]` sem virar assumption declarada com dono e consequência | P1 | teste com hipótese contendo `INFERRED` sem assumption: transição recusada e registrada; auditoria do log de negociação mostra a marca original preservada | ADR-0016 | §12.2, §13 | H6 |
| FR-A8 | O horizonte de sessão marca `stale` as entradas derivadas de `based_on_seq` anterior quando o `seq` persistente avança — marcadas, nunca apagadas | P1 | avanço de `seq` no log seguido de consulta que reusa entrada antiga produz exigência de revalidação; a entrada antiga continua legível no registro | ADR-0010 | §12.4, v0.4 §25 | T12 |

### Épico B — Topologia e operadores de fronteira (`INITIATE`, `PROMOTE`, `CONTEST`)

| ID | Requisito | Pri | Aceite verificável por log | ADR | Paper | H/T |
|---|---|---|---|---|---|---|
| FR-B1 | O host L3 declara a topologia de horizontes como DAG de fronteiras de promoção, em que `parent` significa fronteira de promoção e nunca "dura mais" ou "contém" | P0 | topologia declarada é legível como recurso e o checklist a verifica; sessão declara pai `∅`; microtask declara como pai a transformação que a instanciou | ADR-0008 | §6 | H1 |
| FR-B2 | Toda promoção atravessa exatamente uma fronteira do DAG; alvo diferente do pai topológico é recusado com `HORIZON_SKIP` | P0 | **adversarial (T8):** microtask roteirizada propõe direto ao persistente; log do host registra `HORIZON_SKIP` e nenhuma alteração de estado no alvo | ADR-0008 | §6, §5.2 | T8 |
| FR-B3 | `PromotionProposal` é objeto tipado com `source_horizon`, `target_horizon`, `source_authority_ref`, `distilled[]`, `excluded_summary`, `evidence[]`, `assumptions[]`, `based_on_seq` e `provenance` | P0 | schema validado no host; proposta faltando campo obrigatório é recusada com código, por log — critério [G3] | ADR-0008 | §7 | H1 |
| FR-B4 | A autoridade de origem é credencial de submissão e não mérito: o host verifica estruturalmente que o ciclo de seis estados se completou no filho e então avalia `distilled[]` do zero, cego ao chamador | P0 | **adversarial (T5):** proposta com `source_authority_ref` forjada recebe `AUTHORITY_REF_INVALID`; o mesmo `distilled[]` submetido com ref válida por duas identidades distintas recebe veredito idêntico | ADR-0008 | §7, §11 regra 2 | H3, T5 |
| FR-B5 | `assumptions[]` são conservadas ou resolvidas com registro, nunca omitidas; omissão é detectada por comparação estrutural com o grafo filho | P0 | **adversarial (T6):** promoção que omite assumption presente no filho recebe `ASSUMPTION_DROPPED` por log | ADR-0008 | §7 regra 4 | T6 |
| FR-B6 | `excluded_summary` é obrigatório e sua contagem tipada entra no audit na destruição do horizonte filho | P0 | destruição de horizonte sem `excluded_summary` no audit é falha de conformidade; log guarda contagens de tentativas, erros e caminhos abandonados sem guardar o conteúdo | ADR-0008 | §7 regra 5, §19 | — |
| FR-B7 | `STALE_BASE` é bifurcado: promover exige rebase ou revalidação explícita, sem exceção; `OperatorApproval` de defasagem autoriza apenas continuar concretizando sob risco declarado | P0 | teste par: (a) promoção com `based_on_seq` defasado recusada mesmo com aprovação de defasagem válida; (b) concretização sob a mesma aprovação prossegue e é registrada como risco assumido | ADR-0010 | §7 regra 3, §13b, §5.2 | T12 |
| FR-B8 | Promoção vazia é desfecho de primeira classe (aceita com `excluded_summary` e evento de encerramento); promoção incremental é permitida; promoção retroativa — reabrir proposta já admitida para carona — é proibida | P1 | log da VS-1a mostra promoção vazia aceita e registrada; tentativa de reabrir proposta admitida é recusada com código | ADR-0008 | §7 casos-limite | — |
| FR-B9 | `INITIATE` registra um `NegotiationSeed` com `intent`, `session_refs[]` (ponteiros, nunca cópia), `operator_decisions[]` com proveniência e `based_on_seq`; tudo que o seed carrega entra no horizonte novo como `proposed` | P0 | teste: preferência declarada em sessão chega à negociação com status `proposed` e proveniência; nenhum item herda status admitido; seed sem referências ou proveniência recebe `PROVENANCE_MISSING` | ADR-0009 | §6.1 | H1 |
| FR-B10 | Toda aresta do DAG tem contrato tipado de iniciação: `NegotiationSeed` (sessão para negociação), `ChangeContract` (negociação para transformação), `WorkOrder` (transformação para microtask) | P1 | inspeção do log de instanciação: nenhum horizonte nasce sem seed tipado registrado | ADR-0009 | §6.1, Apêndice A | H1 |
| FR-B11 | `PersistentDelta` estende `PromotionProposal` com `changeset_plan[]`, `claims_candidate[]`, `coverage_delta` e `rollback_semantics`, e atravessa o **mesmo** gate da baseline — envelope, nunca bypass | P0 | **[G4]:** fluxo `ArtifactBundle` aceito, `PromotionProposal`, `PersistentDelta`, changeset admitido, executado ao vivo; nenhum caminho alternativo de escrita no persistente aparece no log | ADR-0011 | §8 | H1 |
| FR-B12 | A cegueira ao chamador vale para a promoção inteira: mesmo `claims_candidate[]` sob identidade hostil recebe veredito idêntico | P0 | **adversarial (T2, T13):** bundle com claims embutidas não altera o persistente; dupla Intermediador/Técnico em colusão alcança apenas o médio; métrica `Caller-Blindness` com vereditos idênticos sob N identidades | ADR-0011 | §8, §17 | H3, T2, T13 |
| FR-B13 | `changeset_plan[]` adquire os locks por célula da baseline: células disjuntas prosseguem em paralelo, interseção serializa; conflito semântico sem colisão de células é registrado como limitação conhecida, não como resolvido | P1 | teste de concorrência com duas transformações: interseção serializa por log; a limitação semântica aparece na documentação do ciclo como [A] declarada | ADR-0011 | §8, §35 | — |
| FR-B14 | `Contestation` é evento tipado com `source_horizon`, `target_ref`, `evidence[]` e `severity` em três valores (informativa, bloqueante, invalidante), com efeitos distintos por severidade | P0 | teste por severidade: informativa registra questão sem transição; bloqueante impede promoção do alvo até resolução; invalidante reabre negociação no mínimo e, contra o persistente, vira candidata a recall | ADR-0012 | §9, Apêndice B | H1 |
| FR-B15 | Conflito com o horizonte pai produz evento tipado; edição direta é recusada com `DIRECT_EDIT_FORBIDDEN` | P0 | agente roteirizado tenta editar o grafo do pai: recusa registrada com código e nenhum delta aplicado | ADR-0012 | §9, §5.2 | R8 |
| FR-B16 | `CONTEST` viaja por qualquer aresta do DAG, em qualquer direção — desafiar exige evidência, não fronteira de promoção; contestar sem evidência recebe `EVIDENCE_REQUIRED` | P1 | log mostra contestação aceita em aresta que não é fronteira de promoção; contestação sem âncora recusada | ADR-0012 | §6, §9 | — |

### Épico C — Correção e propagação (`RECALL`, coordenadas, cascata)

| ID | Requisito | Pri | Aceite verificável por log | ADR | Paper | H/T |
|---|---|---|---|---|---|---|
| FR-C1 | `RecallNotice` é objeto tipado (`target_claims[]`, `evidence[]`, `discovered_at_seq`, `faulty_since_seq?`) e **atravessa o gate**: recall sem evidência é recusado com `RECALL_UNPROVEN` | P0 | **adversarial (T9):** recall infundado recusado por log; recall com evidência admitido e cascata disparada | ADR-0013 | §10, §10.1 | H10, T9 |
| FR-C2 | A cascata é o fechamento transitivo `deps⁻¹(target_claims)` calculado deterministicamente sobre o **grafo de derivação admitido** — calculada, jamais curada por humano ou LLM | P0 | **[G5]:** teste determinístico em grafo sintético com conjunto suspenso exatamente igual ao esperado sobre as arestas registradas; nenhuma intervenção manual aparece no caminho | ADR-0013 | §10.1, §10.2 | H10 |
| FR-C3 | A degradação atinge duas coordenadas com dois nomes: claims vão de `admitted` para `contested` no **status**; células de posse β vão de `graph` para `suspended` na **posse**, com cicatriz | P0 | inspeção de log e de tela: `suspended` nunca aparece aplicado a uma claim; exibição contrária é bug de conformidade, não estilo | ADR-0015 | §10.1, §11, D-16 | H10 |
| FR-C4 | Reabilitação é célula a célula pelo caminho normal de verificação (âncora, cobertura, roundtrip); atalho recebe `REHAB_WITHOUT_PROOF` | P0 | tentativa de reabilitar em lote ou sem prova nova recusada por log; reabilitação legítima registra a prova e mantém a cicatriz | ADR-0013 | §10.1 propriedade 4 | H10 |
| FR-C5 | O histórico nunca é reescrito: o recall avança o `seq` e a verdade anterior permanece registrada como o que foi admitido entre `faulty_since_seq` e o recall; toda proposta em voo sobre o subgrafo fica `STALE_BASE` sem caso especial | P0 | consulta de auditoria responde "o que o sistema acreditava em `seq` N" após o recall; transformação em voo recebe `STALE_BASE` sem mecanismo dedicado de concorrência | ADR-0013 | §10.1 propriedade 1, casos-limite | H10, T12 |
| FR-C6 | `faulty_since_seq` desconhecido faz a janela de auditoria assumir o pior caso (desde a admissão original) — superestimar contaminação, nunca subestimar | P1 | teste com `faulty_since_seq` ausente: janela calculada cobre desde a admissão; log registra a assunção de pior caso | ADR-0013 | §10.1 casos-limite | H10 |
| FR-C7 | Recall de recall não produz "unrecall": um `RecallNotice` admitido pode ser contestado com evidência nova, o que produz **reabilitação** com essa evidência como prova | P1 | teste de sequência: recall, contestação com evidência nova, reabilitação registrada; nenhuma operação de desfazimento da cascata existe no log | ADR-0013 | §10.1 casos-limite | H10 |
| FR-C8 | As três coordenadas são ortogonais e nunca colapsadas numa escala: **status** (`proposed`, `admitted`, `contested`, `superseded`, `revoked`), **posse** (`source`/α, `graph`/β, `suspended`, exclusiva de células do persistente) e **autoridade relativa** (incompleta, completa) | P0 | suíte [G0]: qualquer composição por `min`, média, voto ou peso sobre α/β reprova; representações de log e de interface carregam as três separadamente | ADR-0014 | §11 | H3 |
| FR-C9 | A propagação segue a pior dependência, por coordenada; nenhuma coordenada melhora por composição, endosso, aprovação ou importação | P0 | property-based com as regras de §11 como oráculo: monotonicidade (ampliar alvos só amplia o fechamento), idempotência (aplicar duas vezes é igual a uma vez) e o diamante (dependência saudável não salva a degradada); **existência de qualquer caminho de melhoria sem prova própria reprova a arquitetura** | ADR-0014 | §11 | H3, H10 |
| FR-C10 | O grafo de derivação é acíclico na admissão: ciclo é recusado com `LADDER_VIOLATION` generalizada | P0 | teste com duas claims que se sustentam mutuamente: admissão recusada por log — petição de princípio não é evidência dupla | ADR-0014 | §11, I4 | H10 |
| FR-C11 | `Provenance` mínima inclui `origin_agent`, `origin_horizon`, `evidence_refs[]`, `derivation`, `audited_by?` e `based_on_seq`; `derivation` é insumo da regra 1 de propagação **e teto físico do recall** | P0 | candidato sem cadeia mínima recebe `PROVENANCE_MISSING`; `Derivation Registration Ratio` é emitido continuamente a partir do log | ADR-0013 | Apêndice A, §10.2 | H10 |
| FR-C12 | O contrato de recall nasce compatível com propagação federada: errata viaja no manifesto novo e a cascata local executaria na importação, nunca por rede no gate — desenho registrado, **execução fora deste ciclo** | P2 | revisão de desenho registra o ponto de extensão; nenhuma chamada de rede aparece no caminho do gate em qualquer teste (I9) | ADR-0013 | §10.1, §23, §35 | T10 |

### Épico D — Control plane e escalonamento

| ID | Requisito | Pri | Aceite verificável por log | ADR | Paper | H/T |
|---|---|---|---|---|---|---|
| FR-D1 | O Router implementa o Workflow Orchestration Statechart do Apêndice B com guardas determinísticas por transição | P0 | cada transição do apêndice tem teste com guarda satisfeita e guarda violada; transição sem guarda satisfeita não aparece no log | ADR-0004 | Apêndice B, §12 | H1 |
| FR-D2 | `NEGOTIATING` para `CHANGE_READY` exige predicado triplo: `unresolved[]` vazio ou residual aceito com `OperatorApproval`; `based_on_seq` corrente ou defasagem aceita com registro; toda `assumption` com dono e consequência declarada | P0 | **[G6] adversarial:** Guardião hostil declara prontidão com `unresolved[]` não vazio e o Router recusa, por log; hipótese conforme transita; os três predicados são testados independentemente | ADR-0016 | §13 | H6 |
| FR-D3 | O componente probabilístico recomenda e o Router transita: nenhuma transição de autoridade é executada por julgamento de LLM | P0 | log distingue recomendação de transição em todas as transições; substituição do Guardião por adversário não altera o conjunto de transições permitidas | ADR-0016 | §13, §5.1 | H3, T1 |
| FR-D4 | Nenhum caminho de exaustão, timeout ou abandono chega a `PROMOTING` ou `DONE`: exaustão sempre aborta (R9) | P0 | verificação de alcançabilidade sobre o statechart mais teste ao vivo: timeout aborta por log; `Budget Exhaustion Outcomes` em 100% de escalonamento | ADR-0016 | Apêndice B, §15, §20 | T14, R9 |
| FR-D5 | `Escalation` é objeto tipado com `origin`, `frozen_state_ref`, `options[]` e `default_on_timeout`, sendo o default sempre o caminho conservador | P0 | escalonamento aparece no log com as opções enumeradas pelo statechart; opção fora da enumeração é recusada | ADR-0016 | §15 | T14 |
| FR-D6 | A decisão do operador é sobre snapshot identificado: se o mundo muda durante a decisão, a aprovação nasce `APPROVAL_STALE_SEQ` e re-escala | P0 | teste com avanço de `seq` durante a janela de decisão: aprovação invalidada e novo escalonamento registrados | ADR-0017 | §15 | T7 |
| FR-D7 | `N` (tentativas do loop) é configuração por domínio com default conservador `N = 3`, e vira política informada quando `Audit Loop Convergence` existir | P1 | log do ledger mostra `attempt` por WorkOrder e a transição para `WAITING_HUMAN` quando `attempt ≥ N` | ADR-0016 | §15, §12.3 | H2 |
| FR-D8 | O loop Intermediador/Técnico é instrumentado para `Audit Loop Convergence` (tentativas até `accepted` ou escalonamento) | P1 | métrica emitida por WorkOrder na VS-1b; mediana reportada com o veredito de H2 | ADR-0005 | §12.3, §28, §31 | H2 |

### Épico E — Operador escopado (root intencional)

| ID | Requisito | Pri | Aceite verificável por log | ADR | Paper | H/T |
|---|---|---|---|---|---|---|
| FR-E1 | `OperatorApproval` é objeto tipado com `approver`, `scope`, `risks_assumed[]`, `based_on_seq`, `ttl` e `provenance` | P0 | toda aprovação usada em transição está registrada com os seis campos; transição citando aprovação inexistente é recusada | ADR-0017 | §14 | H11 |
| FR-E2 | Aprovação fora do escopo declarado é recusada com `SCOPE_EXCEEDED` | P0 | **adversarial (T7):** aprovação de um contexto reusada em outro é recusada por log; `Operator Scope Violation Rate` mede bloqueadas sobre tentadas | ADR-0017 | §14, §5.2 | T7 |
| FR-E3 | Aprovação expira: `ttl` vencido produz `APPROVAL_EXPIRED` e `based_on_seq` defasado produz `APPROVAL_STALE_SEQ`, ambos re-escalando — consentimento antigo não é consentimento | P0 | teste de expiração e de defasagem, cada um com recusa registrada e novo escalonamento; `Approval Staleness Rate` emitida | ADR-0017 | §14, §15 | T7 |
| FR-E4 | O operador não pode fabricar evidência: criar âncora inexistente, dar cobertura a célula descoberta, converter posse em β por assinatura ou cancelar cascata calculada recebem `EVIDENCE_REQUIRED` — recusa terminal por desenho | P0 | **adversarial (T4):** operador roteirizado com credencial válida tenta as quatro operações; as quatro recusas aparecem no log e nenhuma coordenada muda | ADR-0017 | §14, §5.2 | H3, T4 |
| FR-E5 | Autorização de ação irreversível é single-use e nomeada no contrato | P0 | tentativa de replay da mesma autorização para segunda execução irreversível é recusada por log | ADR-0017 | §14, §16 | T7 |
| FR-E6 | Os defaults iniciais (risco 24h, defasagem 1h, irreversível single-use) são **configuração, não protocolo**, e a fricção resultante é medida | P1 | configuração alterável sem mudança de contrato; H11 reporta tempo, abandono e taxa de contorno | ADR-0017 | §14 | H11 |
| FR-E7 | Contorno sistemático do operador escopado é tratado como falsificação do desenho, não como indisciplina do usuário | P1 | o relatório de H11 declara o veredito antes da execução e registra contornos observados no log, sem reinterpretação posterior | ADR-0017 | §14, §30 | H11 |
| FR-E8 | A soberania intencional permanece integral: o operador decide intenção, preferência entre alternativas válidas, aceitação de risco, decisão de negócio, autorização do irreversível e resolução de conflitos de valor | P1 | o fluxo de negociação da VS-1c mostra o operador decidindo cada item da coluna esquerda de §14, com registro | ADR-0017 | §14 | H11 |

### Épico F — Capability Gateway

| ID | Requisito | Pri | Aceite verificável por log | ADR | Paper | H/T |
|---|---|---|---|---|---|---|
| FR-F1 | Toda tool é classificada em uma de três classes de efeito — idempotente, compensável, irreversível — com a política correspondente | P0 | log de execução carrega a classe por chamada; execução sem classe registrada não ocorre | ADR-0018 | §16 | T11 |
| FR-F2 | Tool não classificada é tratada como irreversível e recebe `TOOL_UNCLASSIFIED` | P0 | **adversarial (T11):** tool de nome inocente com efeito irreversível, sem classificação, é bloqueada por log — na dúvida o custo é fricção, nunca efeito não autorizado | ADR-0018 | §16 | T11 |
| FR-F3 | Para a classe irreversível, o **registro precede a execução** | P0 | teste de falha injetada entre registro e efeito: o log conserva a intenção investigável; nenhuma ordem inversa aparece no código de caminho quente | ADR-0018 | §16 | T11 |
| FR-F4 | Classe irreversível exige autorização nomeada no `ChangeContract`; fora disso, `TOOL_OUT_OF_CONTRACT` e escalonamento ao operador | P0 | Técnico roteirizado tenta irreversível fora do contrato: recusa registrada e `WAITING_HUMAN` no workflow | ADR-0018 | §16 | T11 |
| FR-F5 | A classificação de efeito vive no adapter do flavor e é validada pelo doctor | P0 | `doctor` reprova adapter com tool sem classe; o relatório do doctor entra no log de instalação | ADR-0018 | §5.5, §16 | H12, T11 |
| FR-F6 | O gateway julga autorização e classe, nunca mérito: sucesso operacional não vira conhecimento admitido antes de `VERIFY` | P0 | teste: execução bem-sucedida sem `VERIFY` não altera nenhuma coordenada de autoridade, por log | ADR-0018 | §16, §5.1 | H3 |
| FR-F7 | Ações compensáveis usam idempotency key e registram a compensação | P1 | repetição com a mesma key não duplica efeito; compensação aparece no log quando acionada | ADR-0018 | §16 | — |
| FR-F8 | Cada chamada de tool debita o budget-ledger do horizonte, por classe | P1 | ledger fechado no encerramento do horizonte contém contagem por classe; H9 consome esses números | ADR-0018 | §16, §20 | H9 |

### Épico G — Horizontes, engine e economia

| ID | Requisito | Pri | Aceite verificável por log | ADR | Paper | H/T |
|---|---|---|---|---|---|---|
| FR-G1 | Cada horizonte declara seu perfil semântico conforme a tabela de §19 (assumptions de primeira classe, posse α/β e cobertura, escada 0..5, invalidação por `seq`, budget, destruição legítima) | P0 | checklist L3 verifica capacidade por horizonte contra a tabela; capacidade exercida fora do perfil é recusada por log | ADR-0019 | §19 | H1 |
| FR-G2 | O protocolo normatiza propriedades observáveis; engine única, storage e schema físico permanecem decisão da implementação de referência | P0 | o checklist L3 testa propriedades observáveis e não internals; a especificação do EAP não contém requisito de engine | ADR-0019 | §19 | H12 |
| FR-G3 | Todo horizonte nasce com budget-ledger (tokens, tempo, tentativas, chamadas por classe de tool); cada verbo debita e o ledger entra no audit no encerramento | P0 | ledger presente em 100% dos horizontes instanciados na VS-1b/VS-1c; H9 é calculável a partir dele | ADR-0018 | §20 | H9 |
| FR-G4 | Exaustão de budget escala com `BUDGET_EXHAUSTED` e nunca promove (R9) | P0 | Técnico roteirizado que gira em tentativas queima o próprio budget e escala, por log; nenhuma promoção por exaustão | ADR-0016 | §20, §15 | R9, T14 |
| FR-G5 | Estado transitório não-memorial de execução é legítimo e distinto de memória; o teste é único e mecânico: **reutilização** — o que influencia qualquer decisão posterior ao passo que o criou é memória e pertence ao OpenGraph do horizonte | P0 | teste de vazamento: conteúdo de scratch que influencia decisão posterior é detectado como violação de R6, por log — não como zona cinzenta | ADR-0020 | §20 | H9, R6 |
| FR-G6 | Na destruição de um horizonte, o audit preserva eventos e `excluded_summary`, nunca o conteúdo; destruir memória é legal, destruir sem registro não é | P1 | destruição registrada com contagens; ausência de conteúdo no audit verificada por inspeção | ADR-0020 | §19, §7, Lei 9 | — |
| FR-G7 | Consulta permanece barata: o caminho operador/Maître/Guardião não instancia Intermediador, Técnicos nem horizontes de mutação | P1 | log de sessão de consulta mostra zero instanciações de horizonte médio ou curto | ADR-0019 | §12, v0.4 §13 | H9 |

### Épico H — Protocolo, conformidade e ecossistema

| ID | Requisito | Pri | Aceite verificável por log | ADR | Paper | H/T |
|---|---|---|---|---|---|---|
| FR-H1 | A semântica central é especificada como contrato independente de implementação (EAP), com o servidor do repositório declarado implementação de referência | P0 | a especificação existe como artefato versionado separado do código e é a fonte dos testes de conformidade; a tese permanece [E] até H12 | ADR-0001 | §5 | H12 |
| FR-H2 | A taxonomia de recusas é fechada e faz parte do vocabulário do protocolo, com **obrigação de cliente** associada a cada código | P0 | toda recusa emitida carrega código da taxonomia; cliente que re-submete idêntico após `ANCHOR_NOT_FOUND` é reprovado no checklist como não-conforme | ADR-0006 | §5.2 | H12 |
| FR-H3 | `Refusal Taxonomy Coverage` atinge 100% das recusas emitidas, e cada código nomeia a causa real | P0 | varredura do log de recusas: zero recusas em texto livre; `Refusal Fidelity` avaliada por amostragem contra a causa real | ADR-0006 | §5.2, §31 | H12 |
| FR-H4 | Os níveis de conformidade separam papéis: L0 e L1 certificam clientes-agentes; L2, L3 e L4 certificam hosts | P0 | o checklist recusa certificar um agente como host; a matriz de níveis publicada declara o estado de cada nível no repositório | ADR-0007 | §5.3, §12 | H12 |
| FR-H5 | O checklist de conformidade (Apêndice D) é executável e cada item é verificado **por log do host** | P0 | execução do checklist produz relatório item a item com referência ao evento de log que o comprova; nenhum item aceita autorrelato | ADR-0007 | Apêndice D | H12 |
| FR-H6 | Pelo menos **três flavors distintos** do registry passam L0–L1 contra a implementação de referência, sem adaptação server-side específica por flavor | P1 | **[G2]:** relatório por flavor com `Conformance Pass Rate`; aprovação que exija adaptação server-side por flavor falsifica H12 e rebaixa a tese de protocolo, com registro | ADR-0007 | §5.3, §30 | H12 |
| FR-H7 | O adapter de flavor declara o nível de conformidade do flavor e a classificação de efeito das tools que ele traz | P1 | `doctor` valida as duas declarações; adapter incompleto é reprovado no relatório de instalação | ADR-0001 | §5.5 | H12, T11 |
| FR-H8 | MCP é o primeiro binding de transporte, não o protocolo: trocar o binding não pode alterar o que `ADMIT` significa | P1 | teste de invariância semântica sobre pelo menos um segundo caminho de transporte disponível no repositório; alteração de significado é vazamento de protocolo | ADR-0001 | §5.4, §5 | H12 |
| FR-H9 | Nenhum agente hospeda gate: Maître, Guardião, Intermediador e Técnicos são clientes L0/L1 dos hosts dos horizontes em que operam | P0 | **adversarial (T1, T3):** Guardião hostil tenta persistir e o host exige âncora e cobertura; Intermediador hostil aceita lixo e o gate do persistente recusa — ambos por log | ADR-0007 | §5.3, §12, §17 | H3, T1, T3 |

### Épico I — Código morto e bootstrap

| ID | Requisito | Pri | Aceite verificável por log | ADR | Paper | H/T |
|---|---|---|---|---|---|---|
| FR-I1 | `claims.ts` (claims determinísticas por AST) é ligado no bootstrap da VS-1, precedido de teste — piso determinístico sem custo de LLM e pré-requisito do alpha v1 | P0 | suíte de teste adversarial passa antes do flip; após ligar, o grafo do alpha v1 carrega claims commitadas, verificável por log | ADR-0021 | §21, §29 | H8 |
| FR-I2 | `greenfield.ts` só liga precedido de teste que tente quebrá-lo; o aceite mecânico é o ponto fixo `ascent(project(intent))` reproduzindo `intent`, com bloqueio duro idêntico ao brownfield | P1 | H5: gate que aprove âncora não verificável no chão greenfield é um novo F1 e reprova; teste de ponto fixo por log | ADR-0021 | §21, §22 | H5 |
| FR-I3 | `federation.ts` **não liga** neste ciclo: o gate de execução ("dois times pedindo") segue válido e o módulo permanece [C] | P2 | ausência verificada: nenhum caminho de execução alcança o módulo em qualquer teste do ciclo | ADR-0021 | §21, §23, §35 | — |
| FR-I4 | Código [C] migra para [B] apenas via teste adversarial, ou permanece desligado — sem exceção | P2 | revisão de marca ao final do ciclo: nenhum módulo muda de [C] para [B] sem teste identificado no relatório | ADR-0021 | §21, D-14 | — |

### Épico J — Observabilidade e experimentação

| ID | Requisito | Pri | Aceite verificável por log | ADR | Paper | H/T |
|---|---|---|---|---|---|---|
| FR-J1 | O audit log permanece separado do knowledge graph, append-only e suficiente para reconstruir vereditos, recusas e fechamentos calculados | P0 | replay reconstrói o estado; auditoria responde às perguntas de §10.1 sobre crença histórica; violação de separação é falha de I7 | ADR-0013 | §18, I7 | H10 |
| FR-J2 | O harness experimental executa dois braços — **D** (substrato sem Cognitive Plane) e **E** (a VS-1c completa) — com prompts congelados e veredito pré-registrado | P0 | veredito registrado antes da execução, com hash do prompt; comparação D×E por log, nunca por autorrelato | ADR-0021 | §29, D-15 | H1, H8, H9 |
| FR-J3 | As métricas herdadas de §31 são instrumentadas: contaminação persistente, silent-fail-open, fidelidade de recusa, sobrevivência à substituição adversarial, cegueira ao chamador, staleness de interpretação, vazamento entre horizontes, convergência do loop de auditoria, assumption-to-action, precisão de clarificação, custo e latência contra D | P0 | cada métrica tem definição operacional e origem no log declaradas antes da coleta | ADR-0021 | §31 | H1–H9 |
| FR-J4 | As métricas novas de §31 são instrumentadas: `Recall Propagation Completeness`, `Derivation Registration Ratio`, `Recall-to-Rehabilitation Time`, `Operator Scope Violation Rate`, `Approval Staleness Rate`, `Budget Exhaustion Outcomes`, `Refusal Taxonomy Coverage` e `Conformance Pass Rate` por flavor | P0 | as oito métricas emitidas na VS-1c e no alpha v1, com alvo e significado da falha declarados na §8 deste PRD | ADR-0013 | §31 | H10, H11, H12 |
| FR-J5 | `Cross-Horizon Leakage` distingue leakage zero **por mecanismo** de leakage zero **por disciplina de prompt** | P0 | o experimento inclui braço com prompt hostil à disciplina; leakage zero apenas sob prompt disciplinado dispara o desfecho pré-registrado de revogação da recursividade como mecanismo | ADR-0002 | §28, §31 | H1 |
| FR-J6 | O alpha v1 inverte as condições que o alpha v0 pagou para ensinar: feature transversal **sem teste que a especifique**, grafo carregando claims commitadas, braços D×E, veredito pré-registrado por log | P0 | H8: uso real do servidor no braço E medido por log; zero uso de novo, mesmo com o objeto corrigido, falsifica H8 | ADR-0021 | §29, §2.5 | H8 |
| FR-J7 | O catálogo T1–T14 é uma suíte executável, com componentes adversariais roteirizados, e não uma lista descritiva | P0 | cada ameaça tem teste com defesa mecânica nomeada e veredito por log; T4, T5, T6, T8, T9 e T13 executam na VS-1c | ADR-0002 | §17, §28 | H3 |
| FR-J8 | O teste de substituição adversarial cobre também o operador humano e implementações hostis de cliente EAP no mesmo nível | P0 | operador adversarial roteirizado e cliente hostil de mesmo nível não quebram nenhum invariante de §1, nenhuma regra de §11 e nenhuma fronteira de §6 | ADR-0007 | §17 | H3, T4 |
| FR-J9 | Resultados que falsifiquem hipóteses são registrados como revogação explícita, com destino declarado ([B], revogada ou 1.x), e não silenciosamente reinterpretados | P1 | a revisão de graduação (M8) produz o registro por tese, no formato de §36; [G1] é verificado item a item contra o Apêndice C | ADR-0021 | §0.2, §36, Apêndice C | — |

**Contagem.** A — 8 · B — 16 · C — 12 · D — 8 · E — 8 · F — 8 · G — 7 · H — 9 · I — 4 · J — 9. Total: **89 requisitos** (P0: 64 · P1: 22 · P2: 3).

---

## 6. Requisitos não-funcionais

Derivados dos invariantes I1–I10 (§1), das regressões proibidas R1–R9 (§17) e das regras duras espalhadas pelo paper. Nenhum deles é revogável por este ciclo: a evolução pode reinterpretar, mover de camada ou renomear — **não pode revogar**.

| ID | Requisito não-funcional | Origem | Verificação |
|---|---|---|---|
| NFR-1 | Toda claim carrega âncora verbatim re-checável; âncora inexistente é bloqueio duro, nunca aviso — sem exceção humana | I1, §14 | recusa ao vivo com código; teste com operador adversarial (T4) |
| NFR-2 | Posse β exige prova de cobertura fechada; célula com nó descoberto não promove | I2 | `COVERAGE_UNBALANCED` por log |
| NFR-3 | Posse β é privilégio revogável, com drift graduado: `structural` suspende, `gone` volta a `source`, `lexical/renamed` não demovem | I3 | tripwire de drift exercitado; nenhuma demoção fora da graduação |
| NFR-4 | Escada valida atomicamente no commit (adjacência, raízes nos extremos, sem órfão, sem ciclo), agora estendida à aciclicidade do grafo de derivação | I4, §11 | commit atômico com `admitSeq`; ciclo de derivação recusado |
| NFR-5 | Chave de célula tem forma canônica única em toda fronteira | I5 | `CELL_KEY_NONCANONICAL` em toda borda; nenhuma criação de célula em grafia nova |
| NFR-6 | Recusa é registrada como recusa, com razões e código — nunca como sucesso vazio | I6 | varredura do log: zero eventos de sucesso sem efeito correspondente |
| NFR-7 | Knowledge graph e audit log permanecem separados: JSONL durável, índice derivado e perdível | I7 | replay reconstrói o estado a partir do log durável |
| NFR-8 | A camada viva nunca é requisito: todo fluxo tem fallback por polling | I8 | fluxo completo exercitado com a camada viva desligada |
| NFR-9 | Verificação nunca depende de rede no gate — vale inclusive para refs federadas e para recall federado | I9 | teste com rede indisponível: gate opera integralmente offline |
| NFR-10 | Evidência não se fabrica: feature bloqueada fica bloqueada | I10 | resultados BLOCKED e FAILED permanecem como tais no relatório |
| NFR-11 | O veredito de mérito é cego ao chamador; o direito de submeter não é | v0.4 §11.2, §8 | `Caller-Blindness`: mesmo conteúdo sob N identidades produz vereditos idênticos |
| NFR-12 | Nenhuma coordenada de autoridade cresce sem sua prova própria (Lei 10) | §11, §34 | property-based com as regras como oráculo; qualquer caminho de melhoria reprova |
| NFR-13 | Registro precede execução para a classe irreversível | §16 | falha injetada entre registro e efeito preserva intenção investigável |
| NFR-14 | Exaustão — de budget, tentativas ou paciência — nunca converte em promoção (R9) | §15, §17, §20 | alcançabilidade sobre o statechart e teste ao vivo de timeout |
| NFR-15 | Nenhuma memória cognitiva vive fora de um OpenGraph governado (R6); scratch é o que nunca foi memória | §20, R6 | teste de reutilização detecta vazamento de scratch como violação |
| NFR-16 | Contratos entre agentes são estruturados nas fronteiras, jamais apenas linguagem natural (R4) | v0.4 §11.3, §12 | schemas validados em toda fronteira do DAG |
| NFR-17 | Interpretação nunca se baseia em estado não versionado (R3): snapshot identificado por `seq` é utilizável, responder como atual sem validar não é | v0.4 §11.3, §17 | `Staleness of Interpretation`; `based_on_seq` obrigatório em toda proposta |
| NFR-18 | **Custo não tem limiar imposto a priori.** O limiar é achado do experimento | §28, H9 | o ledger produz o número; o limite é registrado como achado, e "custo proibitivo" é um desfecho pré-registrado, não uma falha de execução |

---

## 7. Marcos e sequenciamento

> **Regra dura do sequenciamento.** **VS-1a é o gate dos gates.** Ela testa contratos, topologia, cascata e propriedades de propagação **em isolamento, sem LLM envolvida**. Se a mecânica falha sem inteligência, nada mais tem sentido (§28) — e as fases seguintes **não executam**. Nenhum marco posterior a M3 inicia enquanto M3 não fechar.

```
M0 fundações de contrato ──┐
M1 control plane ──────────┼──► M3 VS-1a  ══ GATE DOS GATES ══►  M4 VS-1b ──► M5 VS-1c ──┐
M2 gateway ────────────────┘        (sem LLM)                                             │
                                                                     M6 conformidade ─────┤
                                                                     M7 alpha v1 ─────────┤
                                                                                          ▼
                                                                     M8 revisão de graduação
```

| Marco | Escopo | Requisitos principais | Saída que autoriza o próximo |
|---|---|---|---|
| **M0 — Fundações de contrato** | Especificação EAP versionada; schemas de `NegotiationSeed`, `PromotionProposal`, `PersistentDelta`, `Contestation`, `RecallNotice`, `OperatorApproval`, `Escalation`; taxonomia fechada de recusas; proveniência mínima com `derivation`; topologia declarada; três coordenadas separadas | FR-H1, FR-H2, FR-B1, FR-B3, FR-B9, FR-B11, FR-C8, FR-C11 | schemas validáveis e vocabulário congelado |
| **M1 — Control plane** | Statechart do Apêndice B com guardas; predicado triplo de `CHANGE_READY`; `Escalation` com opções e default conservador; `OperatorApproval` escopada e expirável | FR-D1..FR-D6, FR-E1..FR-E5 | nenhum caminho de exaustão para promoção, verificado por alcançabilidade |
| **M2 — Gateway** | Três classes de efeito; default irreversível; registro antes da execução; autorização nomeada no contrato; classificação no adapter validada pelo doctor; ledger debitado por chamada | FR-F1..FR-F8, FR-G3 | gateway operante com classificação auditável |
| **M3 — VS-1a (contratos em isolamento, sem LLM)** | Todos os contratos, a topologia, as guardas do statechart, a cascata, as propriedades de propagação por property-based e a conformidade **semântica** dos seis estados com a tabela de §5.1.1 como oráculo | FR-A1..FR-A6, FR-B2..FR-B8, FR-C1..FR-C10, FR-D2, FR-G5, FR-I1 | **[G3], [G5], [G6] fechados.** Falha aqui interrompe o ciclo |
| **M4 — VS-1b (um par de horizontes real)** | Intermediador cliente + host do médio + um Técnico em tarefa real: WorkOrder, gateway com as três classes, loop `AuditAssessment`/`AuditDecision` até `accepted` ou escalonamento, promoção curto para médio | FR-A6, FR-B3..FR-B6, FR-D7, FR-D8, FR-F1..FR-F8, FR-G3 | H2 e H1 medidos no par mais barato; primeiros números de H9 |
| **M5 — VS-1c (pilha completa)** | Cenário da Parte VIII ou equivalente: operador real, negociação, `CHANGE_READY` verificado, transformação, contestação, `PersistentDelta`, gate da baseline, recall provocado e os ataques T4, T5, T6, T8, T9, T13 executados por componentes adversariais roteirizados | FR-B11, FR-B12, FR-C1..FR-C7, FR-E4, FR-E8, FR-J7, FR-J8 | **[G4] fechado**; todas as métricas alimentadas |
| **M6 — Conformidade** | Checklist executável do Apêndice D; declaração de nível e de classe de efeito no adapter; três flavors distintos do registry em L0–L1 | FR-H4..FR-H9 | **[G2] fechado** ou H12 falsificada com registro |
| **M7 — Alpha v1** | Feature transversal sem teste que a especifique; grafo com claims commitadas (habilitado por `claims.ts`); braços D×E; veredito pré-registrado por log | FR-I1, FR-J2, FR-J5, FR-J6 | H1, H4, H8, H9 com veredito |
| **M8 — Revisão de graduação** | Aplicação item a item do Apêndice C; verificação de [G0] e [G1]; registro de cada [E] como [B], revogada ou 1.x | FR-J9 | a rc perde o sufixo, ou o registro honesto de qual metade da tese sobreviveu |

O caminho crítico declarado pelo paper (§37) é exatamente este e não admite atalho: VS-1a, VS-1b, VS-1c, depois alpha v1 e checklist de conformidade. **Tudo o mais espera, porque nada do resto falsifica a tese.**

---

## 8. Métricas de sucesso

### 8.1 Métricas herdadas (§31, integrais da v0.4 §20)

| Métrica | Alvo de graduação | O que a falha significa |
|---|---|---|
| **Persistent Contamination Rate** (primária) | zero contaminação persistente sob a suíte adversarial | a tese central não se sustenta no persistente |
| **Silent-Fail-Open Rate** | zero — foi paga com F1 e F7 | o gate voltou a produzir confiança sem garantia (Lei 6) |
| **Refusal Fidelity** | cada recusa nomeia a causa real | recusa genérica é quase tão inútil quanto aprovação vácua |
| **Adversarial Substitution Survival** | 100% dos invariantes I1–I10 sobrevivem a T1–T14 | H3 falsificada: **tese revogada, não remendada** |
| **Caller-Blindness** | vereditos idênticos sob N identidades | autoridade voltou para a identidade (R2) |
| **Staleness of Interpretation** | nenhuma resposta apresentada como atual sem validar `seq` | R3 reintroduzida |
| **Cross-Horizon Leakage** | zero **por mecanismo** | zero só por disciplina de prompt rebaixa a recursividade de mecanismo a convenção |
| **Audit Loop Convergence** | mediana abaixo de `N` em tarefas médias | H2 falsificada: `N`, contratos ou decomposição voltam a desenho |
| **Assumption-to-Action Rate** | suposições que produziram efeito são todas declaradas com dono | lavanderia de suposições operando |
| **Clarification Precision** | perguntas realmente necessárias | fricção sem informação |
| **Cost / Latency contra D** | **sem limiar a priori** | o limiar é achado de H9; custo proibitivo é desfecho registrado, não fracasso de execução |

### 8.2 Métricas novas da v1.0 (§31)

| Métrica | Testa | Alvo | Significado da falha |
|---|---|---|---|
| **Recall Propagation Completeness** | tese temporal (H10) | **100% sobre o grafo de derivação admitido** | **assimetria declarada:** um único falso negativo sobre arestas registradas falsifica H10; falsos positivos são tolerados — falso positivo custa re-verificar o que estava certo, falso negativo custa uma verdade falsa operante, que é a definição do fracasso do sistema |
| **Derivation Registration Ratio** | a sombra de §10.2 | **termômetro, não alvo** — mede o teto do que qualquer recall consegue alcançar | tendência de queda indica que o ecossistema está escolhendo hoje o tamanho da contaminação incorrigível de amanhã |
| **Recall-to-Rehabilitation Time** | tese temporal | medida, com a assimetria explícita: suspender é em cascata, reabilitar é célula a célula com prova nova | tempo alto é custo esperado do desenho, não defeito |
| **Operator Scope Violation Rate** | tese de simetria | 100% das aprovações fora de escopo bloqueadas | R7: aprovação humana substituindo evidência |
| **Approval Staleness Rate** | tese de simetria | aprovações vencidas por `ttl` ou `seq` são invalidadas antes do uso | consentimento antigo tratado como consentimento |
| **Budget Exhaustion Outcomes** | R9 | 100% terminando em escalonamento | exaustão convertida em promoção: a política real do sistema virou o cansaço |
| **Refusal Taxonomy Coverage** | D-3 | 100% das recusas com código da taxonomia | recusa em texto livre não interopera e não mede |
| **Conformance Pass Rate por flavor** | tese de protocolo (H12) | três flavors em L0–L1, por log do host | H12 falsificada rebaixa a tese de protocolo a tese de produto, com registro |

### 8.3 Critério de parada honesto (§30)

**H1, H3 e H10 são existenciais**: falhando, a tese é revogada, não remendada. **H4, H7, H9 e H11** podem falhar derrubando escopo, não arquitetura. **H12** falhando é doloroso, sobrevivível e registrado.

---

## 9. Riscos e mitigações

| # | Risco | Prob. | Impacto | Mitigação declarada no paper |
|---|---|---|---|---|
| RK-1 | **Formalizar editando o formalizado** — a especificação troca a máquina que pretende descrever (foi o defeito da rc2, duas vezes) | Média | Fatal | [G0] como tripwire; oráculo semântico da tabela de §5.1.1; toda formalização é traduzir, não editar, e cada desvio deliberado é declarado com marca, justificativa e teste |
| RK-2 | **Gate que falha em silêncio** na implementação nova, reproduzindo em código a patologia que a arquitetura impede na LLM | Média | Fatal | todo mecanismo novo nasce com um teste que tenta burlá-lo; catálogo T1–T14 como suíte executável; `Silent-Fail-Open Rate` com alvo zero |
| RK-3 | **Grafo de derivação incompleto** limita o alcance do recall (a sombra de §10.2) | Alta | Alto | garantia escopada e declarada como escopada; `derivation` obrigatória na proveniência; `Derivation Registration Ratio` como termômetro contínuo; a questão fica [A] com nome próprio |
| RK-4 | **Custo multiplicativo** de cinco horizontes executando o ciclo completo | Alta | Médio | contabilidade por ledger antes de decisão; budgets com R9; scratch não-memorial e perfis por horizonte como válvula; o limiar é achado de H9, não requisito |
| RK-5 | **Fricção do operador escopado** leva a contorno sistemático | Média | Alto | H11 mede tempo, abandono e taxa de contorno; contorno sistemático é tratado como **falsificação do desenho**, não indisciplina; TTLs e escopos são configuração calibrável |
| RK-6 | **Fadiga como vetor de ataque** (T14): inundar o operador até o "aprovar" automático | Média | Alto | `default_on_timeout = abortar`; expiração re-escala; aprovação universal é evitada por desenho — exigir operador sempre vira aprovação automática na prática |
| RK-7 | **H12 falha**: nenhum conjunto de três flavors passa L0–L1 sem adaptação server-side | Média | Alto | consequência pré-registrada: a tese de protocolo rebaixa a tese de produto, com registro — o EAP colapsa a documentação interna sem perda de mecanismo (reversibilidade alta em D-1) |
| RK-8 | **Recall como arma de negação** (T9): recalls infundados suspendem conhecimento alheio | Baixa | Alto | recall atravessa o gate com `RECALL_UNPROVEN`; re-conquista custa ao autor do recall leviano |
| RK-9 | **Conflito semântico entre transformações concorrentes** passa pelos locks | Média | Médio | limitação declarada e **não resolvida** neste ciclo: locks detectam colisão sintática, não conflito de significado; permanece [A] sem disfarce |
| RK-10 | **Alpha v1 repete o alpha v0**: o braço E não usa o servidor | Média | Alto | condições invertidas uma a uma (feature transversal sem teste que a especifique, claims commitadas, D×E, veredito pré-registrado); zero uso de novo falsifica H8 explicitamente |
| RK-11 | **Homogeneização estética** na avaliação da linguagem material anula o sinal que o desenho existe para produzir | Baixa | Baixo | risco de método registrado no paper; mitigação por geração isolada por estado e composição posterior |
| RK-12 | **Ligar código [C] sem teste**, repetindo a gênese de F1 e F7 | Baixa | Alto | D-14 sem exceção: teste antes de ligar; `federation.ts` não liga; o inventário [C] derrete na velocidade dos testes, não da vontade |
| RK-13 | **Risco meta: o experimento confirma D ≈ E** — o Cognitive Plane e a recursividade não acrescentam sobre o substrato sozinho | Média | — | **isto não é risco de projeto: é o propósito do experimento.** D é o baseline mais informativo justamente porque isola quanto a recursividade acrescenta; o desenho pré-registra a revogação como desfecho legítimo, e um resultado negativo registrado vale mais que uma confirmação não falsificável |

---

## 10. Dependências

### 10.1 No repositório

| Dependência | Onde | Estado | Papel neste ciclo |
|---|---|---|---|
| Gate de admissão, células, escada, cobertura, drift graduado | `packages/mcp-server/src/gates.ts`, `packages/graph-core/src/authority.ts` | **[B]** | recebe `PersistentDelta` sem segundo gate (FR-B11); `Authority = source \| graph \| suspended` já é a coordenada de posse de FR-C3 |
| Recusas do gate hoje em texto livre (`anchor not found verbatim`, `coverage not balanced in β cell`, `out of turn scope`) | `packages/mcp-server/src/gates.ts` | **[B]** parcial | precisa ganhar código da taxonomia fechada e obrigação de cliente (FR-H2, FR-H3) |
| `seq` monotônico, changesets atômicos, locks por célula, JSONL append-only com índice derivado | `packages/mcp-server/src/{store,db,state}.ts` | **[B]** | base de `based_on_seq`, `STALE_BASE`, cascata de recall e concorrência de `changeset_plan[]` |
| Fronteira MCP (tools + resources), SSE com fallback por polling | `packages/mcp-server/src/{tools,resources,sse,transport}.ts` | **[B]** | primeiro binding do EAP (FR-H8); I8 preservado |
| Registry de adapters com `AgentFlavorDef` (11 flavors), `doctor`, `install` | `packages/mcp-server/src/{agent-registry,doctor,install}.ts` | **[B]** | borda do ecossistema; ganha declaração de nível de conformidade e de classe de efeito (FR-H7, FR-F5) |
| `claims.ts` — claims determinísticas por AST | `packages/graph-core/src/claims.ts` | **[C]** | **liga no bootstrap da VS-1, com teste** (FR-I1); pré-requisito do alpha v1 |
| `greenfield.ts` — chão de âncora sem código | `packages/graph-core/src/greenfield.ts` | **[C]** | liga **precedido** de teste que tente quebrá-lo (FR-I2, H5) |
| `federation.ts` — torres estrangeiras, manifesto | `packages/graph-core/src/federation.ts` | **[C]** | **não liga neste ciclo** (FR-I3); só o desenho de recall federado é registrado para compatibilidade |
| Módulos vizinhos alcançáveis e nunca executados (`project.ts`, `expand.ts`, `ascent.ts`, `cell-dag.ts`, `graphci.ts`, `merge-driver.ts`) | `packages/graph-core/src/` | **[C]** | fora do caminho crítico; regem-se por D-14 (FR-I4) |
| Clientes e superfícies de interface | `packages/client`, `packages/mcp-web`, `packages/stdio-proxy`, `packages/claude-plugin` | **[B]** parcial | renderização das três coordenadas separadas e da cicatriz (§26); só H7 pertence à graduação |

### 10.2 Fora do repositório

| Dependência | Necessária para | Observação |
|---|---|---|
| **Três flavors de agente de terceiros**, distintos, do conjunto coberto pelo registry | [G2] e H12 (FR-H6) | a aprovação vale apenas se **sem adaptação server-side específica por flavor**; a escolha de quais três não está fixada pelo paper (ver §11) |
| **Operador humano real** na VS-1c | H11, T4, FR-E8 | a VS-1 é single-operator por desenho (§35) |
| **Não-especialistas** para o teste de linguagem material | H7 | quatro estados lado a lado, sem legenda |
| Uma **feature transversal real**, sem teste que a especifique, num objeto governado | alpha v1 (FR-J6) | objeto não escolhido pelo paper (ver §11) |
| Torre de domínio sem código, mantida por especialista do domínio | ilustração de §24 e ambição de §22 | **fora do escopo de graduação**; federação permanece 1.x |

---

## 11. Questões abertas do PRD

Estas são decisões que a execução precisa fixar e que **o paper não decide**. Cada uma traz uma recomendação — e a recomendação está marcada como recomendação, jamais como requisito. Nenhuma delas foi resolvida por invenção neste documento.

**Q1 — Qual feature transversal real será o objeto do alpha v1?** O paper fixa as propriedades exigidas (transversal, sem teste que a especifique, num contexto em que *o que quebra se eu mexer* não é óbvio, com o grafo carregando claims commitadas) mas não nomeia o objeto. *Recomendação:* escolher o objeto **antes** de congelar os prompts e registrar a escolha junto com o veredito pré-registrado, para que a seleção não seja ajustável depois pelo resultado.

**Q2 — Quem executa o operador adversarial da VS-1c?** §17 (T4) e §28 exigem "operador adversarial roteirizado", e §14 exige que o teste de substituição inclua o humano; o paper não diz se o papel é desempenhado por pessoa seguindo roteiro, por script com credencial de operador, ou por ambos. *Recomendação:* script determinístico para as quatro operações de `EVIDENCE_REQUIRED` (reprodutível em CI) e pessoa roteirizada para a medição de fricção de H11, que exige comportamento humano real.

**Q3 — Defaults de TTL de aprovação por classe de decisão.** §14 dá três valores iniciais (risco 24h, defasagem 1h, irreversível single-use) e declara explicitamente que são configuração, não protocolo. As demais classes de decisão não têm default. *Recomendação:* não inventar defaults por classe antes que H11 produza dados de fricção; até lá, herdar o valor mais conservador aplicável.

**Q4 — O que exatamente "rebase ou revalidação explícita" exige na promoção sob `STALE_BASE`.** §7 regra 3 endurece a exigência e §13b permite continuar concretizando sob risco, mas o paper não especifica se o rebase revalida todo o `distilled[]` ou apenas as evidências afetadas pelo avanço de `seq`. *Recomendação:* registrar como decisão de implementação da referência, com o comportamento observável documentado no checklist L3, e não como semântica do protocolo enquanto não houver segunda implementação.

**Q5 — O `STALE_BASE` "(aviso)" de `PROPOSE`.** A tabela de §5.1 lista `STALE_BASE (aviso)` entre os modos de recusa de `PROPOSE`, enquanto §5.2 e §7 tratam `STALE_BASE` como recusa dura na promoção. O paper não define o que um "aviso" é mecanicamente, e I6 exige que recusa seja registrada como recusa. *Recomendação:* tratá-lo como evento registrado que não bloqueia a proposta, jamais como recusa silenciosa — mas registrar a ambiguidade para revisão do paper, porque a decisão pertence ao protocolo.

**Q6 — Onde `INITIATE` aparece no statechart do Router.** §6.1 define o operador e o `NegotiationSeed`, mas o Apêndice B não tem transição correspondente: a aresta `CHAT → NEGOTIATING` tem como guarda "intenção de mudança confirmada pelo operador", sem mencionar o seed. *Recomendação:* implementar o seed como pré-condição observável da transição existente e registrar a questão para o paper, sem criar estado novo.

**Q7 — Se um host L3 precisa implementar o statechart do Router.** O Apêndice D lista "statechart" entre os itens de L3, enquanto §5.1.2 declara que o statechart é o autômato **operacional do Router** e não a Epistemic Lifecycle Machine que os hosts possuem. *Recomendação:* o checklist L3 verificar propriedades observáveis do fluxo (nenhuma promoção por exaustão, escalonamento tipado) sem exigir o statechart específico da referência — mas a decisão é do protocolo, não da implementação.

**Q8 — Denominador operacional do `Derivation Registration Ratio`.** §31 o define como "arestas de derivação registradas sobre derivações declaráveis na admissão", e "declarável" não tem definição operacional no paper — quem decide o que era declarável. *Recomendação:* fixar um denominador conservador e explícito antes da primeira coleta e publicá-lo junto da métrica, já que a métrica é termômetro e não alvo.

**Q9 — Quem classifica a severidade de uma `Contestation` e quem arbitra reclassificação.** §9 define os três valores e seus efeitos, e §10 diz que uma invalidante contra o persistente "vira candidata a `RECALL`"; o paper não diz quem promove a candidatura nem o que acontece se emissor e alvo discordarem da severidade. *Recomendação:* tratar a severidade como declaração do emissor com evidência exigida, e a promoção a recall como decisão do Router sobre predicado — registrando a lacuna, porque o mecanismo de discordância não existe no paper.

**Q10 — Contestação e recall em horizontes efêmeros.** O recall é definido sobre o persistente. O paper não diz se claims degradadas em horizontes efêmeros disparam cascata local antes da destruição do horizonte. *Recomendação:* não implementar cascata efêmera neste ciclo e registrar a questão; a regra 1 de propagação de §11 é enunciada por dependência, não por horizonte, o que torna a questão legítima e não decidida.

**Q11 — Quais três flavors do registry serão submetidos a [G2].** §5.3 exige "três flavors distintos" sem nomeá-los; o registry tem 11. *Recomendação:* escolher os três **antes** da execução do checklist e registrar a escolha, para que a amostra não seja selecionada pelo resultado — o mesmo princípio que rege o veredito pré-registrado.

**Q12 — Quem paga o budget do horizonte persistente.** A tabela de §19 marca "Budget próprio" como ausente no persistente, e §20 exige que todo horizonte nasça com ledger. O paper não reconcilia os dois pontos. *Recomendação:* registrar a assimetria como intencional (o persistente é a fonte do `seq` e não um horizonte efêmero com ciclo de vida próprio) e não criar budget onde o paper não o pede.

---

## Apêndice do PRD — Rastreabilidade ADR

| ADR | Título | Requisitos que o citam |
|---|---|---|
| ADR-0001 | Extrair a semântica como protocolo (EAP); servidor como implementação de referência | FR-H1, FR-H7, FR-H8 |
| ADR-0002 | Máquina recursiva intocada; PROMOTE/CONTEST/INITIATE como operadores de fronteira | FR-A1, FR-A2, FR-J5, FR-J7 |
| ADR-0003 | CONCRETIZE é materialização própria do horizonte; o gateway é sua borda externa | FR-A3, FR-A4 |
| ADR-0004 | Dois autômatos declarados: Epistemic Lifecycle Machine × Workflow Orchestration Statechart | FR-A5, FR-D1 |
| ADR-0005 | Fronteira determinístico/probabilístico por natureza, não por verbo | FR-A6, FR-D8 |
| ADR-0006 | Taxonomia fechada de recusas com obrigação de cliente | FR-H2, FR-H3 |
| ADR-0007 | Conformidade separa cliente-agente de horizon host; nenhum agente é L2 | FR-H4, FR-H5, FR-H6, FR-H9, FR-J8 |
| ADR-0008 | Topologia de horizontes como DAG de fronteiras de promoção | FR-B1..FR-B6, FR-B8 |
| ADR-0009 | INITIATE/NegotiationSeed: iniciar carrega contexto, nunca autoridade | FR-B9, FR-B10 |
| ADR-0010 | STALE_BASE bifurcado | FR-A8, FR-B7 |
| ADR-0011 | Nenhum segundo gate: PersistentDelta é envelope, não bypass | FR-B11, FR-B12, FR-B13 |
| ADR-0012 | Contestação por evento tipado com três severidades, nunca edição | FR-B14, FR-B15, FR-B16 |
| ADR-0013 | Recall: cascata calculada, garantia escopada, reabilitação célula a célula | FR-C1..FR-C7, FR-C11, FR-C12, FR-J1, FR-J4 |
| ADR-0014 | Três coordenadas ortogonais; propagação pela pior dependência | FR-C8, FR-C9, FR-C10 |
| ADR-0015 | `suspended` é posse, e só posse | FR-C3 |
| ADR-0016 | CHANGE_READY por predicado triplo; LLM recomenda, Router transita | FR-A7, FR-D2..FR-D5, FR-D7, FR-G4 |
| ADR-0017 | Operador é root intencional, não root epistemológico | FR-D6, FR-E1..FR-E8 |
| ADR-0018 | Default irreversível para tool não classificada | FR-F1..FR-F8, FR-G3 |
| ADR-0019 | Semântica normativa no protocolo; engine única só na implementação de referência | FR-G1, FR-G2, FR-G7 |
| ADR-0020 | Scratch não-memorial legítimo; memória sempre no grafo | FR-G5, FR-G6 |
| ADR-0021 | Processo: teste antes de ligar código [C]; D×E antes de baselines externos | FR-I1..FR-I4, FR-J2, FR-J3, FR-J9 |
