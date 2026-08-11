# OpenGraph

## Arquitetura cognitiva recursiva sobre substrato epistêmico verificável: planos, horizontes e promoção de autoridade — e o protocolo que a transforma em ecossistema

**Documento de trabalho · versão 1.0-rc1 · 10 de agosto de 2026**

> **Tese central (inalterada desde a v0.2)**
> Capacidade de inferir não implica autoridade para afirmar. Capacidade de produzir não implica autoridade para persistir.
>
> **Tese de protocolo da v1.0**
> Autoridade epistêmica não é uma feature de um produto — é um **protocolo** que qualquer runtime, qualquer agente e qualquer domínio podem implementar. O que a baseline provou como sistema, a v1.0 formaliza como contrato de conformidade: verbos, níveis, bindings. **OpenGraph deixa de ser "um servidor com um gate" e passa a ser a especificação do que significa admitir, promover, contestar e revogar conhecimento — com o servidor atual como implementação de referência.**
>
> **Tese de simetria da v1.0**
> O operador humano não é a raiz da confiança; é um agente com autoridade escopada. Aprovação humana carrega proveniência, escopo e validade — **pode assumir riscos declarados, não pode fabricar evidência.** A mesma máquina que impede uma LLM de declarar verdade impede um humano de declará-la sem chão.
>
> **Tese temporal da v1.0**
> Verdade admitida é verdade versionada. Quando o persistente está errado, a correção não é edição — é **recall epistêmico**: uma cascata de suspensão calculada sobre o grafo de derivação, admitida pelo mesmo gate, com o histórico intacto. **Corrigir é promover uma contestação, nunca reescrever o passado.**

---

## 0. Enquadramento: da fotografia ao protocolo

Este documento é a formulação completa do sistema no nível 1.0. Ele não substitui a v0.4 como registro histórico; substitui-a como formulação vigente. Preserva a baseline empírica, herda os três planos e a recursividade, e acrescenta quatro movimentos estruturais: protocolo, simetria do operador, verdade versionada e álgebra de autoridade.

```
v0.2 + repo HEAD ──► BASELINE          gates, células, α/β, âncoras — pago com implementação
      │
v0.3 ────────────► TRÊS PLANOS         inteligência separada de autoridade e de mecanismo
      │
v0.4 ────────────► RECURSIVIDADE       a mesma máquina epistemológica em todo horizonte;
      │                                memória governada = OpenGraph por horizonte
      │
AUDITORIA DA v0.4
      │  · Cognitive Plane inteiro em [E], zero execução
      │  · promoção entre horizontes: narrativa, não mecanismo
      │  · operador fora da máquina — raiz de confiança implícita
      │  · "e se o persistente estiver errado?" — sem resposta
      │  · ecossistema (MCP, 11 flavors) sem formalização
      ▼
     v1.0-rc1 ───► PROTOCOLO           verbos, conformidade, promoção mecânica,
                                       operador dentro da máquina, recall governado
```

A pergunta que a v1.0 responde:

> **O que precisa ser verdadeiro — como mecanismo, como contrato e como evidência — para que a arquitetura cognitiva recursiva deixe de ser a hipótese de um paper e vire a propriedade verificável de um ecossistema aberto?**

### 0.1 Nota de versão — o que a rc1 fixa

1. **`rc` significa release candidate no sentido epistemológico exato.** Este documento é uma `PROPOSTA` que completou `DELIBERAÇÃO` e define seu próprio critério de `ADMISSÃO` (§0.2). Ele só perde o sufixo quando a `CONCRETIZAÇÃO` (VS-1, §25) e a `VERIFICAÇÃO` (alpha v1, §26) executarem. A v1.0 aplica a si mesma a máquina que descreve.
2. **O primeiro draft da v1.0 reproduziu o fenômeno que o projeto controla** — pela quarta vez na história do documento (§33). Reduziu a formulação a um contrato de graduação, confundindo prudência com completude. A correção da rc1: **ousadia na arquitetura e honestidade nas marcas são ortogonais.** Pode-se propor rupturas grandes desde que cada uma carregue sua marca e seu teste de falsificação.
3. **Nenhum invariante da baseline é revogado.** I1–I10 permanecem integrais (§1). As nove leis da v0.4 permanecem e ganham três novas (§31).
4. **Seis questões abertas da v0.4 §25 recebem resposta candidata**: promoção `curto→médio` e `médio→longo` (§6–§7), condição de `CHANGE_READY` (§12), contestação ascendente (§8), correção do persistente contaminado (§9), schema por horizonte (§18), escalonamento do loop (§14).
5. **O que não gradua não finge graduar.** Federação ativada, sandbox real, a cidade completa e os baselines externos são explicitamente 1.x (§32), com o motivo registrado.

### 0.2 Regra de graduação *[G]*

Introduz-se uma marca exclusiva desta versão:

| Marca | Significa |
|---|---|
| **[G]** | Critério de graduação — condição objetiva, verificável, que precisa ser satisfeita para a rc1 virar v1.0 final |

A regra é única e sem exceção:

> **[G1] A v1.0 final não contém nenhuma tese central em [E].** Cada [E] termina em um de três destinos: **[B]** (evidência no repositório, teste identificado), **revogada** (com registro em §33), ou **rebaixada a 1.x** (fora do escopo de graduação, sem fingir prova). Um paper que se promove sem atravessar o próprio gate comete a fraude que o sistema existe para impedir.

### 0.3 Marcas de estado

| Marca | Significa |
|---|---|
| **[B]** | Baseline conquistada — evidência no repositório, teste de regressão, commit identificado |
| **[C]** | Construído e desligado — código vendorado, nunca exercitado. Não é prova |
| **[E]** | Evolução proposta nesta versão — precisa de justificativa e de teste de não-regressão |
| **[A]** | Aberto — requisito reconhecido, desenho não resolvido |
| **[G]** | Critério de graduação — o que separa rc1 de final |

---

# Parte I — Baseline e diagnóstico

## 1. Invariantes que a v1.0 não pode destruir *[B]*

Herdados integralmente da v0.4 §1, com a evidência que os pagou. A evolução pode reinterpretar, mover de camada ou renomear. **Não pode revogar.**

| # | Invariante |
|---|---|
| **I1** | Toda claim carrega âncora verbatim re-checável; âncora inexistente é bloqueio duro, não aviso |
| **I2** | β exige prova de cobertura fechada; célula com nó descoberto não promove |
| **I3** | β é privilégio revogável; drift graduado (`structural → suspended`, `gone → source`) |
| **I4** | Escada valida atomicamente no commit: adjacência, raízes nos extremos, sem órfão, sem ciclo |
| **I5** | Chave de célula tem forma canônica única em toda fronteira — pago com F1 e F7 |
| **I6** | Recusa é registrada como recusa, com razões — pago com 59 chamadas que mentiram |
| **I7** | Knowledge graph e audit log permanecem separados: JSONL durável, SQLite derivado |
| **I8** | Camada viva nunca é requisito; todo fluxo tem fallback por polling |
| **I9** | Verificação nunca depende de rede no gate — vale inclusive para refs federadas |
| **I10** | Evidência não se fabrica: feature bloqueada fica bloqueada |

A lição transversal da baseline permanece a carga de projeto mais pesada: **a patologia que a arquitetura existe para impedir numa LLM apareceu na implementação que a impede.** Um gate que falha em silêncio produz confiança sem garantia. Todo mecanismo novo desta versão nasce com um teste que tenta burlá-lo.

## 2. Forças da v0.4 que a v1.0 explora *[B/E]*

1. **A disciplina epistemológica autoaplicada.** Marcas de estado, cicatrizes nomeadas (F1, F7, F8, MP-1..3), meta-análise por versão. É o diferencial metodológico do projeto e a razão de a rc1 poder ser ousada sem mentir.
2. **A recursividade como princípio único.** Uma máquina — `PROPOSTA → DELIBERAÇÃO → ADMISSÃO → CONCRETIZAÇÃO → VERIFICAÇÃO → AUTORIDADE` — em todo horizonte. É a hipótese mais econômica e mais falsificável do sistema, e por isso o alvo primário do programa experimental.
3. **As duas rotas.** Rota epistêmica obrigatória para verdade; rota operacional permitida para ação. Resolve o excesso da v0.3 e é o que o Capability Gateway (§15) concretiza.
4. **A baseline paga.** Gate cego ao chamador, células com forma canônica, drift graduado, changesets atômicos, `seq` monotônico, locks por célula, MCP como fronteira cliente-agnóstica, duas camadas de cliente com fallback. Nada disso é promessa.
5. **O fracasso informativo do alpha v0.** O braço com MCP não usou o servidor uma única vez porque a especificação (199 linhas de teste) era maior que o artefato (184 linhas). A lição — *o grafo só tem valor onde a especificação é menor que o artefato* — redesenha o alpha v1 (§26).
6. **O embrião de ecossistema já commitado.** Registry de adapters com doctor, install e `AgentFlavorDef` para 11 flavors de agente. A fronteira cliente-agnóstica não é aspiração: é o HEAD do repositório.

## 3. Fraquezas da v0.4 e onde a v1.0 as ataca *[E]*

| # | Fraqueza | Onde é atacada |
|---|---|---|
| W1 | Cognitive Plane inteiro em [E], sem uma linha executada | VS-1 em três fases (§25) |
| W2 | Promoção entre horizontes é narrativa ("vira proposta"), não mecanismo | `PromotionProposal` (§6) |
| W3 | `CHANGE_READY` sem condição determinística | predicado triplo (§12) |
| W4 | Programa de avaliação sem harness; métricas jamais coletadas | harness D×E (§26, §28) |
| W5 | Custo da recursividade não modelado — 5 horizontes × ciclo completo | budgets e degradação (§19) |
| W6 | Proveniência e supersessão [A] no coração do "contrato estável" | esquema mínimo decidido (§10, Apêndice A) |
| W7 | Capability Gateway é caixa nomeada: sem sandbox, idempotência, compensação | classes de efeito (§15) |
| W8 | Greenfield declarado "o mecanismo" da generalização, mas é código morto | teste-antes-de-ligar (§20) |
| W9 | R6 exige memória governada em todo horizonte; nada mede se isso paga o custo | H4/H9 (§27) + perfil degradado (§19) |
| W10 | `WAITING_HUMAN` sem contrato; operador fora da máquina | operador como agente (§13), escalonamento (§14) |
| W11 | "E se o persistente estiver errado?" sem resposta — a maior lacuna da tese | recall epistêmico (§9) |
| W12 | Composição de autoridade indefinida: derivação, federação, atravessamento | álgebra de autoridade (§10) |

Nenhuma dessas fraquezas é vergonha; W1–W10 estão declaradas na própria v0.4. W11 e W12 são as duas que a auditoria da rc1 acrescentou — e são as duas que mais doem, porque tocam a tese central: um sistema cuja verdade admitida não pode ser corrigida de forma governada apenas mudou o lugar onde a contaminação se esconde.

## 4. Os paradigmas que a v1.0 quebra *[E]*

A v0.4 posicionou o OpenGraph contra o estado da arte por negação (§29 herda a lista). A v1.0 explicita as rupturas por afirmação:

| Paradigma vigente (2026) | Ruptura v1.0 |
|---|---|
| Memória de agente é um vector store anexado ao modelo | Memória é um grafo governado por horizonte, com ciclo de admissão próprio e destruição legítima |
| Agente mais capaz ⇒ resultado mais confiável | Capacidade e autoridade são ortogonais; capacidade jamais compra promoção |
| *Human-in-the-loop* como raiz incontestável de confiança | Operador é agente de escopo: aprovação tem proveniência, validade e limite — assume risco, não fabrica evidência (§13) |
| Corrigir conhecimento = sobrescrever / re-treinar / re-indexar | Corrigir = recall governado com cascata calculada e histórico imutável (§9) |
| Frameworks multiagente possuem a pilha inteira | Protocolo com níveis de conformidade; qualquer flavor de agente conecta pela borda (§5) |
| Integração de conhecimento = pipeline de RAG | Gestão de dependência de conhecimento: torres federadas, manifesto assinado, semver de intenção (§22) |
| Confiança expressa em scores probabilísticos | Autoridade conquistada por prova e revogável por drift (α/β), nunca por probabilidade |
| Verdade do sistema = estado atual do banco | Verdade é versionada por `seq`; toda interpretação declara sua base e pode ser contestada retroativamente |

Cada linha da coluna direita é [E] ou [B] conforme a seção que a define. Nenhuma é slogan: todas têm mecanismo, contrato e teste de falsificação neste documento.

---

# Parte II — De sistema a protocolo: o EAP

## 5. Epistemic Admission Protocol *[E — DEFINIÇÃO v1.0]*

A baseline construiu um servidor. A v0.4 construiu uma arquitetura. O que o ecossistema precisa é do que nenhum dos dois é sozinho: **um contrato que outros possam implementar sem herdar o código.**

> **EAP é a formalização da máquina epistemológica como protocolo: um conjunto de verbos com semântica determinística, níveis de conformidade verificáveis e bindings de transporte. O servidor do repositório torna-se a implementação de referência, não o produto.**

A analogia estrutural é deliberada: HTTP não é um servidor web; SemVer não é um package manager; SLSA não é um build system [26]. O valor de cada um está no contrato que sobrevive às implementações. A tese de protocolo aposta que autoridade epistêmica pertence a essa categoria.

### 5.1 Os verbos *[E]*

Sete verbos cobrem a máquina completa. Os cinco primeiros são o ciclo recursivo; os dois últimos são as correções que a v1.0 acrescenta:

| Verbo | Semântica | Determinístico? |
|---|---|---|
| `PROPOSE` | apresentar candidato a conhecimento num horizonte, com âncoras e proveniência | entrada validada por schema |
| `DELIBERATE` | registrar questões, conflitos, resoluções e assumptions sobre a proposta | conteúdo probabilístico; registro estruturado |
| `ADMIT` | gate decide mérito, cego ao chamador; recusa carrega razões (I6) | **sim — inegociável** |
| `VERIFY` | re-checar âncoras, cobertura, roundtrip; conceder/revogar α/β | **sim — offline (I9)** |
| `PROMOTE` | atravessar horizonte via `PromotionProposal` (§6); nunca automático | **sim — guardas mecânicas** |
| `CONTEST` | desafiar conhecimento admitido, em qualquer direção, com evidência | entrada validada; efeito calculado |
| `RECALL` | revogar retroativamente com cascata sobre o grafo de derivação (§9) | **sim — fechamento calculado** |

A linha divisória do protocolo é a mesma da baseline: **conteúdo pode ser probabilístico; mérito, fluxo e autoridade são determinísticos.**

### 5.2 Níveis de conformidade *[E → G]*

Um participante do ecossistema declara — e prova — o que implementa:

| Nível | Nome | Implementa | Estado no repo |
|---|---|---|---|
| **L0** | Leitor | query, `history/since`, resources; entende recusas | **[B]** — qualquer cliente MCP genérico |
| **L1** | Propositor | staging, ciclo de changeset, `PROPOSE`/`DELIBERATE`; recebe recusas com razões | **[B]** — fluxo completo exercitado (F1–F8) |
| **L2** | Admissor | gate, células, escada, α/β, drift, `ADMIT`/`VERIFY` | **[B]** — o servidor de referência |
| **L3** | Hospedeiro recursivo | horizontes, `PROMOTE`, contratos da Parte III, Cognitive Plane operável | **[E]** — gradua com VS-1 |
| **L4** | Par federado | manifesto assinado, torres estrangeiras, semver de intenção, `RECALL` cross-tower | **[C]** — mecanismo vendorado, ativação 1.x |

**[G2]** A rc1 gradua no eixo de protocolo quando existir um checklist de conformidade executável (Apêndice D) e pelo menos **três flavors distintos de agente** do registry passarem L0–L1 contra a implementação de referência, verificado por log — não por autorrelato, que o alpha v0 já mostrou não valer nada.

### 5.3 MCP é o primeiro binding, não o protocolo *[B, reinterpretado]*

A fronteira MCP (tools + resources) da baseline é o **binding de transporte de referência** do EAP — da mesma forma que HTTP/1.1 foi o primeiro binding de REST sem esgotá-lo. A consequência estratégica da v0.4 permanece e ganha nome: não se porta o produto para cada agente; entrega-se o endpoint compliant e um plugin fino por flavor. O que muda na v1.0 é que a semântica dos verbos vive no EAP, e o binding apenas a transporta. Um segundo binding (CLI direto, biblioteca embutida, A2A [29]) não pode alterar o que `ADMIT` significa — **se alterar, o protocolo vazou**, na mesma acepção em que a v0.4 §5 define vazamento do Epistemic Plane.

### 5.4 O registry de adapters é a borda do ecossistema *[B → E]*

O HEAD do repositório contém o embrião concreto: `AgentFlavorDef` com 11 flavors, doctor e install. Hoje ele resolve a pergunta operacional ("que ambiente é este e como me instalo nele"). Na v1.0 ele ganha a segunda metade: **declarar o nível de conformidade do flavor e a política de capacidades que ele recebe** (§15). O adapter deixa de ser só instalação e vira o ponto onde o ecossistema negocia o que cada agente pode fazer — sem jamais negociar o que o gate aceita.

---

# Parte III — A máquina de promoção

Esta parte fecha as perguntas 1, 2 e 7 do Apêndice B da v0.4 e a maior lacuna da tese (W11). A alegação central — *autoridade no filho não é autoridade no pai* — só é arquitetura se o atravessamento for mecanismo. Aqui está o mecanismo.

## 6. `PromotionProposal`: o atravessamento como objeto de primeira classe *[E → G]*

```
PromotionProposal {
  source_horizon        // microtask | transformação | negociação | sessão
  target_horizon        // o pai imediato — NUNCA salta níveis
  source_authority_ref  // o que adquiriu autoridade relativa no filho (id + seq local)
  distilled[]           // nós/claims/evidências destiladas que pretendem atravessar
  excluded_summary      // contagem tipada do que NÃO atravessa (tentativas, erros, ruído)
  evidence[]            // âncoras re-checáveis no horizonte de origem
  assumptions[]         // herdadas ou novas — nunca desaparecem implicitamente
  based_on_seq          // versão do persistente contra a qual tudo foi construído
  provenance            // cadeia: quem produziu, quem auditou, em qual tentativa
}
```

Cinco regras, todas verificáveis pelo gate do horizonte receptor sem julgamento probabilístico:

1. **Adjacência de horizonte.** `target_horizon` é o pai imediato. Um Técnico não propõe ao persistente; um Intermediador não promove microtask diretamente ao longo. Materializa o teste entre horizontes da v0.4 §11.1.
2. **Autoridade de origem é credencial de submissão, não mérito.** O gate verifica que `source_authority_ref` completou o ciclo no filho — e então avalia `distilled[]` do zero, cego ao chamador. **Autoridade no filho compra o direito de propor; não compra um voto.** É a formulação mecânica de R5.
3. **`based_on_seq` obrigatório e validado.** Se o persistente avançou, a proposta não é recusada automaticamente — é marcada `STALE_BASE` e exige rebase explícito ou aceite de defasagem pelo operador (§13). Estende R3 para o atravessamento.
4. **`assumptions[]` conservadas ou resolvidas, nunca omitidas.** Assumption que chega sem resolução vira `unresolved[]` do pai. A lavanderia de suposições fica proibida também na fronteira.
5. **`excluded_summary` obrigatório.** O receptor sabe *quanto* ficou para trás sem receber o ruído. A destruição do OpenGraph filho é permitida (Lei 9); o audit log registra o evento com essa contagem — destruir memória é legal, destruir sem registro não é.

**[G3]** Gradua quando o schema estiver validado em gate e existir teste adversarial demonstrando que: (a) salto de horizonte é recusado; (b) `source_authority_ref` forjado é recusado; (c) assumption omitida é detectada; (d) `STALE_BASE` é emitido quando o `seq` avançou.

## 7. `PersistentDelta`: da transformação ao objeto oficial *[E → G]*

A promoção `médio → longo` é caso especial porque o receptor é o OpenGraph governado da baseline, com α/β e cobertura próprios. O contrato **reusa o mecanismo pago em vez de criar um segundo gate**:

```
PersistentDelta = PromotionProposal + {
  changeset_plan[]      // células afetadas, na forma canônica única (I5)
  claims_candidate[]    // claims com âncora verbatim (I1) prontas para o gate
  coverage_delta        // o que muda na prova de cobertura das células β (I2)
  rollback_semantics    // o que é compensável e o que exige intervenção
}
```

`claims_candidate[]` entra pelo **mesmo gate** que qualquer claim da baseline. A única novidade é a origem — um horizonte médio auditado — registrada em `provenance` sem alterar o mérito. Um `PersistentDelta` vindo do Intermediador e uma claim submetida por um cliente MCP hostil recebem o mesmo veredito para o mesmo conteúdo (§11.2 da v0.4, agora estendida à promoção).

**[G4]** Gradua com um fluxo completo `ArtifactBundle aceito → PersistentDelta → changeset admitido` exercitado ao vivo na VS-1.

## 8. Contestação: o atravessamento descendente é assimétrico *[E]*

O caminho para baixo não é promoção — é desafio:

```
Contestation {
  source_horizon        // onde a evidência apareceu
  target_ref            // nó/claim/hipótese contestada, em qualquer horizonte acima
  evidence[]            // âncoras verificáveis
  severity              // informativa | bloqueante | invalidante
}
```

Uma descoberta de microtask que conflita com hipótese do médio, ou um fato do médio que conflita com o persistente, produz um evento tipado — **nunca edição direta do grafo pai.** O agente do horizonte pai não "corrige a realidade": registra a contestação e o Router decide a transição permitida (revisar, reabrir negociação, escalar, abortar). Severidade `invalidante` sobre o persistente converte-se em candidata a `RECALL` (§9). Isso responde a pergunta 7 do Apêndice B da v0.4.

## 9. Recall epistêmico: quando o próprio persistente está errado *[E — DEFINIÇÃO CRÍTICA v1.0]*

A v0.4 deixou aberta a pergunta mais desconfortável do sistema: *como detectar e corrigir contaminação quando o próprio persistente estiver errado?* Sem resposta, a tese tem um buraco fatal — um sistema cuja verdade admitida é incorrigível de forma governada apenas mudou o lugar onde a contaminação se esconde. A resposta da v1.0:

> **Corrigir o persistente é uma promoção, não uma edição. O mecanismo é o recall: uma contestação invalidante que, admitida pelo gate, dispara uma cascata de suspensão calculada deterministicamente sobre o grafo de derivação — com o histórico intacto.**

```
RecallNotice {
  target_claims[]       // o que se afirma estar errado
  evidence[]            // por que — âncoras, contradição com fonte, prova externa
  discovered_at_seq     // quando o erro foi descoberto
  faulty_since_seq?     // desde quando a verdade estava errada, se determinável
}
```

O processamento é inteiramente mecânico:

```
RecallNotice admitido pelo gate           ◄── um recall também pode ser RECUSADO:
      │                                       afirmar que algo está errado
      ▼                                       exige evidência, como tudo
fechamento sobre o grafo de derivação
      │   deps⁻¹(target_claims) transitivamente
      ▼
toda claim/célula no fechamento:
      β → suspended    (com cicatriz — §24)
      α → challenged
      │
      ▼
audit log: evento de recall + fechamento calculado + contagem
      │
      ▼
reabilitação célula a célula, pelo caminho normal:
      re-verificação de âncora, cobertura, roundtrip
```

Quatro propriedades definem o mecanismo:

1. **O histórico nunca é reescrito.** O JSONL append-only (I7) preserva a verdade errada *como tendo sido a verdade admitida entre `faulty_since_seq` e o recall*. Auditoria de "o que o sistema acreditava em `seq` N" continua possível — inclusive quando a crença era falsa. Verdade é versionada; vergonha também.
2. **A cascata é calculada, não curada.** Ninguém decide manualmente "o que mais suspender". O grafo de derivação decide, pela álgebra da §10. Curadoria manual de cascata seria autoridade probabilística com outro nome.
3. **Recall passa pelo gate.** Um agente (ou operador) hostil não pode usar `RECALL` como arma de negação de conhecimento: a evidência do recall é verificada como a de qualquer claim. Recusa de recall é registrada com razões (I6).
4. **Reabilitação não tem atalho.** Célula suspensa por recall volta pelo caminho de qualquer célula suspensa: prova nova. Não existe "unrecall".

**[G5]** Gradua quando o fechamento da cascata tiver teste determinístico (grafo sintético com derivações conhecidas → conjunto suspenso exato) e um recall de ponta a ponta tiver sido exercitado na VS-1.

## 10. Álgebra de autoridade *[E — DEFINIÇÃO v1.0]*

W12: a v0.4 define autoridade por célula (α/β) e por horizonte (relativa), mas não define **composição**. A v1.0 fixa três regras, pequenas o bastante para caber num gate:

```
ordem:      none < proposto < admitido(α) < possuído(β)
            suspended = degradação anotada de β, com cicatriz

(1) DERIVAÇÃO      autoridade(c) ≤ min{ autoridade(d) : d ∈ deps(c) }
                   — uma claim não pode ter mais autoridade que aquilo de que depende;
                     suspensão propaga por deps⁻¹ (é isso que o recall calcula)

(2) ATRAVESSAMENTO promote(autoridade_relativa_filho) = proposto(pai)
                   — TODA promoção entra no pai como proposta; R5 numa linha

(3) FEDERAÇÃO      autoridade_local(ref_estrangeira) ≤ autoridade_no_manifesto,
                   congelada no seq de importação
                   — conhecimento estrangeiro nunca ganha autoridade localmente
                     que não possui na origem; quebra de ref ⇒ suspended (I3 estendido)
```

As três regras compartilham uma forma: **autoridade nunca cresce por composição — só por prova.** Crescer exige atravessar um gate com evidência; compor, derivar, importar e promover apenas conservam ou reduzem. Esse é o teorema informal que a VS-1 tenta violar adversarialmente: se algum caminho do sistema permitir que autoridade cresça sem prova, a arquitetura falhou por construção, não por bug.

---

# Parte IV — O Cognitive Plane graduado

## 11. Agentes e horizontes — o que a v1.0 muda *[E]*

A estrutura da v0.4 permanece: Maître (sessão), Guardião (negociação + leitura do persistente), Intermediador (transformação), Técnicos (microtask), Router como control plane determinístico e não-agente. Consulta continua barata: `Operador → Maître → Guardião → Maître → Operador`, sem instanciar Intermediador, Técnicos ou horizontes médios/curtos.

O que a v1.0 acrescenta são três precisões:

1. **Todo agente é um cliente EAP com nível de conformidade declarado.** O Guardião é L0/L1 sobre o persistente; o Intermediador é L2 sobre o próprio horizonte médio e L1 em direção ao longo; um Técnico é L1 sobre o horizonte curto. A tabela de agentes vira tabela de conformidade — e o teste de substituição adversarial (§16) vira teste de protocolo, executável contra qualquer implementação, não só contra a nossa.
2. **O loop Intermediador ↔ Técnico é herdado intacto** (v0.4 §9.6), com uma adição: o veredito `AuditDecision` do Intermediador referencia explicitamente a `PromotionProposal` que o Técnico submeteu — o loop de qualidade e a máquina de promoção são o mesmo mecanismo visto de dois ângulos, não dois mecanismos.
3. **O Maître ganha uma obrigação de invalidação.** Quando o `seq` do persistente avança, entradas do OpenGraph de sessão construídas sobre `based_on_seq` anterior são marcadas `stale` — não apagadas, marcadas. Responde à questão aberta da v0.4 §25 sobre quando o Maître invalida sessão.

## 12. `CHANGE_READY`: a condição determinística *[E → G]*

O pivô do statechart deixa de depender de interpretação. A transição `NEGOTIATING → CHANGE_READY` exige uma `AcceptedPredictiveHypothesis` que satisfaça três predicados mecânicos:

> **(a)** `unresolved[]` está vazio, **ou** cada item residual foi aceito pelo operador como risco assumido, com registro (§13);
> **(b)** `based_on_seq` é o `seq` corrente do persistente, **ou** o operador aceitou a defasagem com registro;
> **(c)** toda entrada de `assumptions[]` tem dono e consequência declarada.

O Guardião pode *recomendar* prontidão; o Router *verifica* os três predicados — todos checáveis por estrutura, sem julgamento. A inferência probabilística fica onde deve: no conteúdo (resolver as questões). **[G6]** Gradua com teste em que um Guardião adversarial declara prontidão com `unresolved[]` não vazio e o Router recusa a transição.

## 13. O operador como agente de escopo *[E — QUEBRA DE PARADIGMA]*

Todo o edifício até aqui tem um pressuposto não examinado: o operador humano como raiz incontestável de confiança. A v1.0 remove o pressuposto:

> **O operador é um agente do Cognitive Plane com autoridade escopada. Sua aprovação carrega proveniência, escopo e validade — e o gate a trata como fecho de deliberação, jamais como substituto de verificação.**

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

A linha divisória, que é a contribuição conceitual desta seção:

> **O operador pode assumir riscos declarados. Não pode fabricar evidência.**

Aprovação humana pode: fechar `unresolved[]` como risco assumido (§12a), aceitar defasagem de `seq` (§12b), autorizar ações irreversíveis no contrato (§15), escolher transições no escalonamento (§14). Aprovação humana **não pode**: fazer uma âncora inexistente existir (I1), dar cobertura a uma célula descoberta (I2), promover β sem prova, cancelar uma cascata de recall calculada (§9). O gate recusa aprovações fora de escopo pela mesma via que recusa claims sem chão — com registro (I6).

Três consequências práticas:

1. **O teste de substituição adversarial passa a incluir o humano.** Um operador hostil — ou uma credencial de operador roubada, ou um operador cansado às 3h da manhã — não pode converter conteúdo arbitrário em β. Engenharia social contra o operador tem o mesmo teto que prompt injection contra o Guardião. Isso não é desconfiança do humano; é a constatação de que **a raiz de confiança de um sistema epistemológico não pode ser um ponto único probabilístico — nem de silício, nem de carbono.**
2. **Aprovação expirada é aprovação inexistente.** `ttl` vencido ou `based_on_seq` defasado invalidam a aprovação; o fluxo re-escala. Consentimento é versionado como tudo mais.
3. **`WAITING_HUMAN` deixa de ser um buraco na máquina de estados e vira um estado dela** (§14) — com entrada, saídas permitidas e default conservador.

## 14. Escalonamento: o contrato de `WAITING_HUMAN` *[E]*

```
Escalation {
  origin                // loop excedeu N | contestação severa | STALE_BASE | gate recusou K vezes
                        //  | budget exausto | aprovação expirada
  frozen_state_ref      // OpenGraph do horizonte congelado por seq/snapshot
  options[]             // transições permitidas pelo statechart a partir daqui
  default_on_timeout    // sempre o caminho conservador: abortar preserva mais que promover
}
```

O operador escolhe entre transições que o statechart já permite. `N` (tentativas do loop Intermediador↔Técnico) nasce como configuração por domínio com default conservador `N = 3` e vira política informada por dados quando `Audit Loop Convergence` (§28) existir. A regra dura: **nenhum caminho de escalonamento termina em promoção implícita.** Timeout aborta; abandono aborta; exaustão aborta. Promover exige o ciclo, sempre.

## 15. Capability / Tool Gateway: do nome ao desenho *[E]*

Todo efeito de Técnico no mundo atravessa o gateway, que classifica cada tool em três classes de efeito com política própria:

| Classe | Exemplos | Política |
|---|---|---|
| **Idempotente** | leitura, análise, dry-run, render, query | repetição livre |
| **Compensável** | escrever em workspace, branch Git, container efêmero | idempotency key + compensação registrada (Sagas [19]) |
| **Irreversível** | push, deploy, chamada externa com efeito, e-mail, pagamento | autorização prévia nomeada no `ChangeContract` + registro *antes* da execução |

Três regras completam o desenho:

1. **A classificação vive no adapter do flavor** (§5.4) — é lá que o ecossistema declara o que cada ferramenta faz. Ferramenta não classificada é tratada como irreversível por default: na dúvida, o custo é fricção, nunca efeito não autorizado.
2. **Registro precede execução para a classe irreversível.** Se o processo morrer entre o registro e o efeito, o audit mostra a intenção; se morrer entre o efeito e o registro, existiria efeito sem rastro — por isso a ordem é inegociável.
3. **O gateway não julga mérito.** Ele julga autorização e classe. Um Técnico autorizado pode executar uma ação tola; o que ele não pode é executar uma ação fora de contrato, nem transformar o sucesso da ação em conhecimento admitido (rota operacional ≠ rota epistêmica, herdado da v0.4 §3.1).

Sandbox de execução real (isolamento de processo/filesystem) permanece [A] para 1.x. O que gradua em 1.0 é **classificação + registro + vínculo ao contrato**, porque são eles que sustentam o teste adversarial: um Técnico hostil não pode executar classe irreversível fora de contrato.

## 16. Falsificação estendida do Cognitive Plane *[E]*

O teste de substituição adversarial da v0.4 §11.1 permanece o instrumento central e ganha dois alvos novos:

> **Substitua qualquer componente cognitivo — incluindo o operador — por um adversário com as mesmas credenciais. Substitua qualquer cliente EAP por uma implementação hostil do mesmo nível de conformidade. Se um invariante da §1, uma regra da álgebra da §10 ou uma fronteira de promoção quebrar, aquele componente possuía autoridade disfarçada.**

As seis regressões proibidas da v0.4 §11.3 permanecem (R1–R6) e ganham três:

| # | Regressão | Por que é fatal |
|---|---|---|
| **R7** | Aprovação humana substituindo evidência — operador "fabrica" verdade por assinatura | reintroduz raiz de confiança probabilística; revoga a tese de simetria |
| **R8** | Correção do persistente por edição direta, contornando o recall | histórico deixa de ser auditável; contaminação passa a se esconder na correção |
| **R9** | Exaustão — de budget, de tentativas, de paciência — convertida em promoção implícita | "terminou por cansaço" vira autoridade; destrói a Lei 8 pelo flanco econômico |

---

# Parte V — O Runtime Plane

## 17. O substrato herdado *[B]*

Integralmente da v0.4 §14, sem alteração: JSONL append-only (durabilidade da verdade, replay total), SQLite derivado e perdível, `seq` monotônico por tenant, changesets atômicos, locks por célula, roteador de afinidade, MCP tools + resources, camada viva SSE opcional com fallback por polling (I8). Duas camadas de cliente. Nada disso é promessa; é o chão sobre o qual a Parte III executa.

## 18. Engine única, perfis por horizonte *[E — decisão que sai de [A]]*

A pergunta 3 do Apêndice B da v0.4 — schema universal ou schema por horizonte? — recebe decisão:

> **Núcleo universal + perfis declarativos.** Todo OpenGraph tem nós, relações, claims, lacunas, evidências e o ciclo recursivo. Cada horizonte ativa um perfil: sessão não tem células α/β; microtask não tem cobertura censitária; negociação tem `assumptions[]` de primeira classe; só o persistente tem a escada completa e o gradiente α/β.

Uma engine, perfis declarativos, semântica única. Storage: horizontes efêmeros usam a mesma engine com namespace e política de retenção própria; o persistente mantém JSONL + SQLite (I7 intacto). Replay de horizonte efêmero **não** é requisito de 1.0 — o que o audit log preserva na destruição de um horizonte é o `excluded_summary` e os eventos, não o conteúdo.

Se a VS-1 mostrar que o núcleo universal é pesado demais para sessão/microtask (H9), a válvula é o perfil degradado da §19 — não um segundo mecanismo. A alternativa rejeitada (engines distintas por horizonte) morreria da doença que I5 já pagou para diagnosticar: duas grafias da mesma semântica produzem autoridade não merecida.

## 19. Economia: budgets e degradação graciosa *[E]*

Cinco horizontes executando o ciclo completo é custo multiplicativo se implementado ingenuamente (W5). Duas regras:

1. **Todo horizonte nasce com budget** — tokens, tempo, tentativas. Exaustão nunca promove: escala (§14). Um horizonte não "termina por cansaço" adquirindo autoridade implícita (R9).
2. **Perfil degradado é legítimo.** Um horizonte pode operar como rascunho não governado — memória de trabalho crua, sem ciclo — **desde que nada dele atravesse fronteira.** O que a Lei 9 exige não é cerimônia em todo pensamento; é que *atravessar custe admissão*. Um Técnico pode rabiscar à vontade; o rabisco não vira `PromotionProposal` sem antes virar um OpenGraph curto mínimo com evidências.

A segunda regra é a resposta economicamente viável a W9: **governança total é o teto; a fronteira é o piso inegociável.** R6 fica assim refinado sem ser revogado: memória fora de OpenGraph governado é permitida exatamente enquanto não influencia promoção — no instante em que influencia, precisa de proveniência, e proveniência exige o grafo.

## 20. Ligando o código morto *[C → E]*

A v0.4 §15 inventariou 21 módulos alcançáveis e nunca executados. A v1.0 fixa a ordem e a regra:

1. **`claims.ts` (claims determinísticas por AST) liga no bootstrap da VS-1** — é o piso determinístico que dá ao grafo conteúdo sem custo de LLM, e é pré-requisito do alpha v1 (grafo carregando claims commitadas).
2. **`greenfield.ts` liga com teste antes** — a ressalva da própria v0.4 vira regra geral: **código [C] só liga precedido de teste que tente quebrá-lo.** [C] nunca migra direto para produção; migra para [B] via teste ou permanece desligado.
3. **`federation.ts` não liga.** O gate de execução ("dois times pedindo") segue válido; permanece [C] até 1.x.

---

# Parte VI — Ecossistema além do código

## 21. Greenfield é o mecanismo da generalização *[C → E, herdado e elevado]*

A tese da v0.4 §16 permanece integral: a regra de âncora não muda — muda a fonte do chão. No brownfield a claim ancora em arquivo; no greenfield, no texto da claim-pai, com bloqueio duro idêntico. Um domínio sem código — legislação, contrato, plano, design system — é uma escada que nunca alcança o nível 5. O aceite mecânico `ascent(project(intent)) = intent` (ponto fixo, não julgamento de LLM) é o teste que H5 executa.

O que a v1.0 acrescenta é a leitura de protocolo: **greenfield é o que faz o EAP ser um protocolo de conhecimento, não um protocolo de código.** Sem ele, L2 só seria implementável sobre repositórios; com ele, qualquer domínio com texto ancorável pode hospedar uma torre.

## 22. Federação como cadeia de suprimento de conhecimento *[C → A, com tese nova]*

O mecanismo permanece o da v0.4 §17: torre estrangeira read-only importada por manifesto assinado; diff de Merkle detecta refs quebradas; células β dependentes viram `suspended`; verificação sempre offline (I9); semver de intenção — se o código mudou e a intenção não, é patch.

A v1.0 acrescenta o enquadramento que faltava e que a álgebra (§10, regra 3) formaliza:

> **Federação é gestão de dependência de conhecimento — o análogo epistêmico do que SemVer [25], lockfiles e SLSA [26] fizeram pela cadeia de suprimento de software.** Uma torre é um pacote; o manifesto assinado é o lockfile; o semver de intenção é o contrato de compatibilidade; o recall (§9) atravessa a fronteira como um advisory de segurança atravessa o ecossistema de pacotes.

Um recall publicado pela torre de origem propaga aos consumidores como `RecallNotice` federado: as células locais que dependem das claims recalled entram na cascata da §9 no próximo diff de manifesto — **sem rede no gate** (I9): a propagação acontece na importação do manifesto novo, nunca na verificação. Ativação operacional permanece 1.x; o desenho fica registrado porque o contrato de recall (§9) precisa nascer compatível com ele.

## 23. Domínios sem código *[E]*

A composição §21 + §22 fecha o ciclo prometido desde a v0.1: uma torre de legislação mantida por quem entende de legislação, consumida read-only por quem constrói o produto; a escada da legislação para no nível "cenários"; a escada do produto desce até código; as claims do produto que citam a legislação obedecem à regra 3 da álgebra. Conhecimento que você não possui ganha presença de primeira classe — e revogabilidade de primeira classe.

---

# Parte VII — A camada de interface

## 24. Materiais epistêmicos e a cidade *[E, herdado; H7 gradua]*

A linguagem da v0.4 §18 permanece: o estado de confiança muda a substância do desenho, não um selo sobre ele — proposto é esboço a lápis, α é tinta limpa, β é desenho técnico de precisão, suspended é fratura com cicatriz permanente. A descontinuidade estética é carga útil; coerência estética é passivo. Cicatriz é estado, não decoração — a mesma exigência que separa `SUPERSEDED` de sobrescrever, e que o recall (§9) agora torna visível: **uma célula que passou por recall carrega a cicatriz mesmo depois de reabilitada.** A interface é onde a tese temporal fica legível para humanos.

Da parte visual, só uma coisa pertence à graduação: **H7 — o teste dos quatro estados lado a lado, sem legenda, distinguíveis por não-especialistas** (v0.4 §18.3). É barato e falsifica a premissa antes de investir no resto. A cidade, o zoom semântico completo (três regimes já entregues [B] parcial), o gesto de explosão e o airlock são 1.x.

---

# Parte VIII — Programa experimental

## 25. VS-1: a fatia vertical que gradua a arquitetura *[G — o experimento central]*

Uma única transformação real atravessando todos os horizontes, com instrumentação completa — executada em três fases para que cada falha seja informativa:

**VS-1a — contratos em isolamento (sem LLM).** `PromotionProposal`, `PersistentDelta`, `Contestation`, `RecallNotice`, `OperatorApproval`, guardas de `CHANGE_READY` e a cascata de recall, todos com testes unitários e adversariais determinísticos. Se a mecânica falha sem inteligência envolvida, nenhuma fase seguinte tem sentido. Cobre [G3], [G5], [G6] e parte de [G4].

**VS-1b — um par de horizontes real.** Intermediador + um Técnico sobre uma tarefa real: OpenGraph médio, WorkOrder, gateway com as três classes, loop de auditoria até `accepted` ou escalonamento, `PromotionProposal` curto→médio. Mede `Audit Loop Convergence` (H2) e `Cross-Horizon Leakage` (H1) no par mais barato.

**VS-1c — a pilha completa.** Operador → Maître → Guardião (negociação, hipótese aceita, `CHANGE_READY` verificado) → Intermediador → Técnicos → `PersistentDelta` → gate da baseline → changeset admitido. Inclui um recall provocado deliberadamente e um operador adversarial roteirizado (§13, §16). Fecha [G4] e alimenta todas as métricas.

**O que a VS-1 decide — com os quatro desfechos pré-registrados:**

| Resultado | Consequência |
|---|---|
| Pilha completa, invariantes intactos, leakage = 0 **por mecanismo** | definições [E] migram para [B]; a rc1 vira v1.0 final |
| Pilha completa, mas leakage = 0 apenas **por disciplina de prompt** | a recursividade é revogada como *mecanismo* e rebaixada a *convenção* — registro em §33; tese central enfraquecida honestamente |
| Loop Intermediador↔Técnico não converge em tarefas reais | `N`, contratos ou decomposição voltam a desenho antes de qualquer graduação |
| Custo por horizonte proibitivo | perfis degradados (§19) viram obrigatórios, não opcionais; H9 registra o limite |

## 26. Alpha v1: o desenho que o alpha v0 pagou para ensinar *[G]*

O alpha v0 falhou informativamente: ambos os braços reconstruíram a feature; o braço com MCP não usou o servidor uma única vez, verificado por log. Causa raiz: especificação maior que o artefato. O alpha v1 inverte cada condição:

1. **Feature transversal sem teste que a especifique** — o valor do grafo só pode existir onde *o que quebra se eu mexer* não é óbvio.
2. **Grafo carregando claims commitadas** — julgamento humano admitido, não apenas estrutura derivável do código (habilitado por `claims.ts`, §20).
3. **Braços: D × E.** D = substrato sem Cognitive Plane (a fotografia atual); E = VS-1c completa. Os baselines A–C (agente único, RAG, multiagente convencional) ficam para depois: **comparar contra o mundo antes de comparar consigo mesmo é vaidade** — D isola exatamente o que o Cognitive Plane e a recursividade acrescentam.
4. **Veredito pré-registrado, verificação por log, nunca por autorrelato** — o método que o alpha v0 acertou mesmo errando o objeto.

## 27. Hipóteses sob avaliação *[G]*

| # | Hipótese | Métrica primária | Falsificada se |
|---|---|---|---|
| **H1** | Promoção explícita reduz contaminação entre horizontes sem custo proibitivo | Cross-Horizon Leakage · Cost/Latency vs D | leakage > 0 por mecanismo, ou custo acima do limiar de H9 |
| **H2** | O loop Intermediador↔Técnico converge em tarefas reais | Audit Loop Convergence | mediana de tentativas ≥ N em tarefas médias |
| **H3** | Mérito cego ao chamador sobrevive a substituição adversarial em toda fronteira | Adversarial Substitution Survival · Caller-Blindness | qualquer I1–I10 quebra com componente hostil |
| **H4** | Memória governada de sessão reduz reaberturas e retrabalho | reaberturas de ponto resolvido, por sessão | sem diferença mensurável contra sessão sem OpenGraph |
| **H5** | Greenfield preserva I1 ancorando na claim-pai em domínio sem código | recusa dura de âncora inexistente no chão greenfield | gate aprova âncora não verificável (um novo F1) |
| **H6** | `CHANGE_READY` é verificável sem esconder inferência | recusas do Router a prontidão indevida | Router aceita transição com `unresolved[]` não vazio |
| **H7** | A linguagem material comunica sem legenda | teste de 4 estados com não-especialistas | distinção exige explicação |
| **H8** | O valor do grafo aparece quando a espec é menor que o artefato | uso real do servidor no braço E, por log | novamente zero uso em tarefa transversal |
| **H9** | Governar horizontes curtos paga o próprio custo | overhead por horizonte vs ganho em H1+H4 | overhead multiplicativo sem ganho em contaminação/retrabalho |
| **H10** | A cascata de recall calcula o fechamento exato | teste determinístico em grafo sintético | falso negativo (dependente não suspenso) — falso positivo é tolerável, falso negativo não |
| **H11** | O operador-como-agente não inviabiliza o uso | fricção de aprovação (tempo, abandono) | operadores contornam o mecanismo sistematicamente — contorno é falsificação, não indisciplina |
| **H12** | A conformidade L0–L1 vale para o ecossistema real | ≥ 3 flavors do registry passando o checklist, por log | flavors só passam com adaptação server-side específica |

**Critério de parada honesto:** H1, H3 e H10 são existenciais — se falharem, a tese é revogada, não remendada. H4, H7, H9 e H11 podem falhar derrubando escopo, não arquitetura (R6 relaxaria onde governança não paga, com registro). H12 falhando rebaixa a tese de protocolo a tese de produto — dolorosa, mas sobrevivível.

## 28. Métricas *[G]*

Herdadas da v0.4 §20: Persistent Contamination Rate (primária), Silent-Fail-Open Rate, Refusal Fidelity, Adversarial Substitution Survival, Caller-Blindness, Staleness of Interpretation, Cross-Horizon Leakage, Audit Loop Convergence, Assumption-to-Action Rate, Clarification Precision, Cost/Latency contra D.

Novas na v1.0:

| Métrica | Camada que testa |
|---|---|
| **Recall Propagation Completeness** | temporal — o fechamento calculado cobre todos os dependentes (H10) |
| **Recall-to-Rehabilitation Time** | temporal — quanto custa reconquistar autoridade após recall |
| **Operator Scope Violation Rate** | simetria — aprovações fora de escopo bloqueadas / tentadas (§13) |
| **Approval Staleness Rate** | simetria — aprovações invalidadas por `ttl`/`seq` antes de uso |
| **Budget Exhaustion Outcomes** | economia — 100% das exaustões devem terminar em escalonamento, 0% em promoção (R9) |
| **Conformance Pass Rate por flavor** | protocolo — checklist do Apêndice D, por log (H12) |

Sem essas métricas, as teses novas da v1.0 seriam acréscimos não falsificáveis — precisamente o que a §16 existe para impedir.

---

# Parte IX — Fechamento

## 29. O que o OpenGraph não é

Herdado da v0.4 §22, integral: não é RAG, não é GraphRAG, não é Graph of Thoughts, não é multi-agent debate, não é empresa de agentes, não é swarm, não é memória infinita, não é framework de agentes com grafo embutido, não é cadeia linear curto→médio→longo.

A v1.0 acrescenta três negações próprias:

- **Não é blockchain nem DAO** — não há consenso distribuído nem token: há um gate determinístico por tenant e manifestos assinados entre pares. Descentralização é de implementação (L0–L4), não de autoridade.
- **Não é "human-in-the-loop" no sentido corrente** — o humano não é um botão de aprovação fora da máquina; é um agente dentro dela, com escopo, proveniência e expiração (§13).
- **Não é um sistema de reputação** — autoridade não acumula por histórico de acertos do agente; conquista-se por prova, por célula, e revoga-se por drift ou recall. Um agente com mil acertos submete a claim mil e um ao mesmo gate cego.

## 30. Posicionamento — agosto de 2026 *[B + E]*

A varredura da v0.4 §23 permanece válida: proveniência, supersessão e propagação governada são estado da arte, não diferencial [16][21][22][23]. A baseline diferencia-se por autoridade granular por região do grafo, conquistada por prova de regeneração, revogada por drift, sustentada por âncora verificável.

A v1.0 reposiciona a alegação de novidade em três camadas, da mais defensável à mais especulativa:

1. **[B]** A semântica α/β por célula com âncora verbatim e revogação por drift — já implementada e exercitada.
2. **[E]** A preservação recursiva dessa semântica através de horizontes, com promoção mecânica e agentes sem direito de promoção implícita — a tese da v0.4, agora com mecanismo (Parte III) e programa de falsificação (Parte VIII).
3. **[E]** A composição como protocolo: EAP com níveis de conformidade, operador escopado, recall governado e álgebra de autoridade. No levantamento corrente, protocolos de interoperabilidade de agentes (MCP [24], A2A [29]) padronizam *comunicação e capacidade*; nenhum padroniza *autoridade epistêmica* — quem pode afirmar o quê, com que prova, revogável como. **Essa é a lacuna que o EAP pretende ocupar.**

A alegação de novidade científica das camadas 2 e 3 permanece condicionada a revisão sistemática e ao experimento comparativo. A camada 1 não precisa de condicional.

## 31. Doze leis de projeto

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

> **Lei 10** *(v1.0)* — Autoridade nunca cresce por composição — só por prova. Derivar, promover, importar e aprovar conservam ou reduzem; crescer exige atravessar um gate com evidência.
> **Lei 11** *(v1.0)* — Aprovação humana é autoridade escopada com proveniência e validade: assume riscos declarados, não fabrica evidência. A raiz de confiança é o protocolo, não uma espécie.
> **Lei 12** *(v1.0)* — Verdade admitida é verdade versionada. Corrigir é promover uma contestação com cascata calculada; reescrever o passado é a única correção proibida.

A Lei 6 foi paga com F1, F7 e um log que mentiu 59 vezes. As Leis 10–12 registram as três definições que a auditoria da v0.4 revelou como faltantes — e todas as três permanecem [E] até que a VS-1 as pague ou as revogue.

## 32. Questões abertas *[A]* — o que a v1.0 explicitamente não promete

Rebaixado a 1.x, sem disfarce, com o motivo:

- **Federação ativada** — mecanismo [C]; gate de execução ("dois times pedindo") segue válido. O desenho do recall federado (§22) fica registrado apenas para que o contrato nasça compatível.
- **Sandbox de execução real para Técnicos** — 1.0 gradua classificação, registro e vínculo ao contrato (§15); isolamento de processo é 1.x.
- **A cidade completa, o airlock, o gesto de explosão** — só H7 pertence à graduação.
- **Baselines A–C** — o mundo externo vem depois de D×E.
- **Replay e retenção avançada de horizontes efêmeros.**
- **Transformações concorrentes sobre o mesmo objeto persistente** — unidade de versionamento entre `ChangeContract`s simultâneos permanece o problema aberto mais difícil do Runtime Plane.
- **Multi-tenant do Cognitive Plane** — a VS-1 é single-operator por desenho.
- **Correção do próprio EAP** — o processo de evolução do protocolo (como um RFC muda de versão) fica para quando houver mais de uma implementação.

## 33. Meta-análise *[histórica]*

A concepção do OpenGraph reproduziu, em cada versão, o fenômeno que pretende controlar:

**v0.1** — inferência preenchendo lacunas de descrição; o operador precisou separar o definido do imaginado.
**v0.2** — o oposto: tratar só o que tinha código como a totalidade do conceito.
**v0.3** — separou os planos, mas diluiu a recursividade e proibiu demais (`Cognitive → System`).
**v0.4** — restaurou a recursividade, mas deixou a promoção como narrativa, o operador fora da máquina e a correção do persistente sem resposta.
**v1.0 draft 1** — a quarta instância do padrão, em variante nova: **conservadorismo como fabricação às avessas.** Reduziu a formulação a um contrato de graduação, confundindo o medo de afirmar demais com completude. Não inventou evidência — inventou modéstia, e modéstia não especificada também é lacuna.

A correção consolidada da rc1:

> **Ousadia arquitetural e honestidade epistêmica são ortogonais. Um paper pode propor rupturas grandes desde que cada uma carregue marca, mecanismo e teste de falsificação. O erro não está em imaginar; está em imaginar sem declarar que imagina — ou em não imaginar e chamar isso de rigor.**

A cadeia de versões continua sendo, ela mesma, uma cadeia de promoção conceitual: cada versão é a `PROPOSTA` que a auditoria seguinte delibera. Nenhuma é apagada; todas são evidência das hipóteses que sobreviveram, foram revogadas ou precisaram de reespecificação.

## 34. Conclusão

Grande parte da evolução de agentes LLM busca mais capacidade. O OpenGraph mantém a pergunta complementar — como permitir que modelos conversem, naveguem, negociem e ajam sem que capacidade se confunda com o direito de transformar conclusão em verdade — e a v1.0 a estende três vezes:

```
para o ecossistema:   qualquer agente, qualquer domínio, qualquer runtime — um protocolo
para o humano:        aprovação é autoridade escopada, não raiz incontestável
para o tempo:         verdade é versionada; correção é governada; o passado é imutável
```

A baseline respondeu com mecanismos verificáveis. A v0.3 recolocou inteligência sobre o substrato sem entregar o gate. A v0.4 tornou a máquina recursiva por horizonte. A v1.0 fecha o que faltava: **a promoção como mecanismo, o operador como agente, a correção como recall, a composição como álgebra e o conjunto como protocolo.**

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

> **OpenGraph é um protocolo de autoridade epistêmica — e sua implementação de referência. Conhecimento vive em OpenGraphs por horizonte; em cada um, percorre recursivamente proposta, deliberação, admissão, concretização, verificação e autoridade; atravessar horizonte exige nova admissão; autoridade nunca cresce por composição, só por prova; humanos assumem riscos, não fabricam evidência; verdade é versionada e corrigível por recall, nunca por reescrita. Agentes — de silício ou de carbono — podem inferir e agir; nenhum resultado persiste como verdade apenas porque foi gerado, executado ou aprovado.**

O caminho crítico da graduação tem quatro passos, nesta ordem: **(1)** VS-1a — contratos e cascata com testes adversariais [G3, G5, G6]; **(2)** VS-1b — o par Intermediador↔Técnico real com gateway [G4 parcial]; **(3)** VS-1c — a pilha completa com recall provocado e operador adversarial [G4]; **(4)** alpha v1 com o desenho corrigido e o checklist de conformidade [G2]. Tudo o mais espera, porque nada do resto falsifica a tese.

Se a VS-1 e o alpha v1 confirmarem H1, H3 e H10, a v1.0 final será este documento com as marcas trocadas. Se falsificarem, será mais valioso ainda: o registro de qual metade da tese sobreviveu. Nas duas hipóteses, o documento seguinte será escrito com a única tinta que o projeto aceita — evidência.

---

## Referências

[1]–[23] — herdadas integralmente da v0.4 (Lewis 2020; Yao 2023; Sumers 2024/CoALA; Packer 2023/MemGPT; Hong 2024/MetaGPT; Wu 2023/AutoGen; Edge 2024/GraphRAG; Dongre 2024/ReSpAct; Shinn 2023/Reflexion; Madaan 2023/Self-Refine; Zhuge 2024/Agent-as-a-Judge; W3C PROV-O; Yang 2024/SWE-agent; Roynard 2026; Du 2026; Margalit 2026; Jamshidi 2026; Harel 1987/Statecharts; Garcia-Molina & Salem 1987/Sagas; Hewitt 1973/Actors; Taheri 2026; Lam 2026/SSGM; *Governed Collaborative Memory* 2026).

[24] Anthropic (2024–2026). *Model Context Protocol — Specification.* — binding de transporte de referência do EAP.
[25] Preston-Werner, T. *Semantic Versioning 2.0.0.* semver.org — contrato de compatibilidade que o semver de intenção estende do código para a intenção.
[26] OpenSSF. *SLSA — Supply-chain Levels for Software Artifacts.* — níveis de conformidade verificáveis como modelo para L0–L4.
[27] C2PA. *Coalition for Content Provenance and Authenticity — Technical Specification.* — proveniência assinada de artefatos como precedente para manifestos de torre.
[28] Fowler, M. (2005). *Event Sourcing.* — o padrão que I7 e a tese temporal materializam: estado é dobra do log, nunca o contrário.
[29] Google (2025). *A2A — Agent2Agent Protocol.* — protocolo de interoperabilidade de agentes; padroniza comunicação e capacidade, não autoridade epistêmica (§30).

---

## Apêndice A — Esquemas de contrato consolidados *[E]*

Contratos herdados da v0.4 §12, inalterados: `ChangeProposal`, `ImpactAnalysis`, `AcceptedPredictiveHypothesis`, `ChangeContract`, `WorkOrder`, `ArtifactBundle`, `AuditDecision`.

Contratos novos da v1.0:

```
PromotionProposal {                      // §6 — atravessamento ascendente
  source_horizon, target_horizon,
  source_authority_ref, distilled[],
  excluded_summary, evidence[],
  assumptions[], based_on_seq, provenance
}

PersistentDelta : PromotionProposal {    // §7 — caso especial médio → longo
  changeset_plan[], claims_candidate[],
  coverage_delta, rollback_semantics
}

Contestation {                           // §8 — desafio descendente
  source_horizon, target_ref,
  evidence[], severity
}

RecallNotice {                           // §9 — correção do persistente
  target_claims[], evidence[],
  discovered_at_seq, faulty_since_seq?
}

OperatorApproval {                       // §13 — o humano dentro da máquina
  approver, scope, risks_assumed[],
  based_on_seq, ttl, provenance
}

Escalation {                             // §14 — WAITING_HUMAN como estado
  origin, frozen_state_ref,
  options[], default_on_timeout
}
```

Proveniência mínima (decisão que sai de [A], alinhada a PROV-O [12] no vocabulário, sem importar a ontologia):

```
Provenance {
  origin_agent, origin_horizon,
  evidence_refs[], derivation,
  audited_by?, based_on_seq
}
```

Estados de supersessão — vocabulário de [23] mapeado sobre o da v0.4:

```
ratified   ↔ ACTIVE      superseded ↔ SUPERSEDED
rejected   ↔ REVOKED     abstained  ↔ CHALLENGED
```

## Apêndice B — Statechart com guardas *[E]*

Estados: `CHAT · QUERY · NEGOTIATING · CHANGE_READY · PLANNING · EXECUTING · VERIFYING · WAITING_HUMAN · PROMOTING · DONE · ABORTED`

| Transição | Guarda determinística |
|---|---|
| `CHAT → QUERY` | consulta recebida; nunca instancia horizontes médios/curtos (§11) |
| `QUERY → CHAT` | resposta incorporada ao OpenGraph de sessão |
| `CHAT → NEGOTIATING` | intenção de mudança confirmada pelo operador; Guardião instancia negociação |
| `NEGOTIATING → CHANGE_READY` | predicado triplo da §12 — verificado pelo Router, recomendado no máximo pelo Guardião |
| `CHANGE_READY → PLANNING` | `ChangeContract` emitido; Intermediador e OpenGraph médio instanciados |
| `PLANNING → EXECUTING` | WorkOrders emitidas; OpenGraphs curtos instanciados com budget |
| `EXECUTING → VERIFYING` | `ArtifactBundle` + `PromotionProposal` recebidos |
| `VERIFYING → EXECUTING` | `AuditDecision(revise)` e `attempt < N` |
| `VERIFYING → WAITING_HUMAN` | `AuditDecision(escalate)` ∨ `attempt ≥ N` ∨ budget exausto ∨ `Contestation(bloqueante)` |
| `VERIFYING → PROMOTING` | todas as WorkOrders com `AuditDecision(accepted)` |
| `PROMOTING → DONE` | `PersistentDelta` admitido pelo gate da baseline; changeset commitado |
| `PROMOTING → WAITING_HUMAN` | `STALE_BASE` ∨ gate recusou ∨ `Contestation(invalidante)` |
| `WAITING_HUMAN → {options[]}` | `OperatorApproval` válida (escopo, `ttl`, `seq`) para a transição escolhida |
| `WAITING_HUMAN → ABORTED` | `default_on_timeout` — exaustão nunca promove (R9) |
| `* → ABORTED` | aborto preserva audit log e `excluded_summary`; horizontes efêmeros podem ser destruídos |

Nenhuma transição para `DONE` ou `PROMOTING` existe a partir de exaustão, timeout ou abandono. É a forma mecânica da regra: **abortar preserva mais que promover.**

## Apêndice C — Mapa de migração das marcas (v0.4 → v1.0)

| Elemento | v0.4 | Destino exigido na v1.0 final |
|---|---|---|
| Invariantes I1–I10 | [B] | [B] — intocáveis |
| Três planos / coordenadas / horizontes | [E] | [B] por uso na VS-1 |
| Duas rotas, fronteira única | [E] | [B] via gateway §15 + teste adversarial |
| Recursividade da máquina | [E] | [B] via VS-1 **ou revogada** (H1) |
| Memória = OpenGraph por horizonte | [E] | [B] com engine única + perfis §18 **ou relaxada** (H9) |
| Hipótese Preditiva Aceita / `CHANGE_READY` | [E]/[A] | [B] via predicado §12 [G6] |
| Loop Intermediador↔Técnico | [E] | [B] via VS-1b (H2) |
| Contratos de fronteira v0.4 §12 | [E] | [B] — schemas validados em gate |
| `PromotionProposal` / `PersistentDelta` | — | [B] com testes [G3, G4] |
| `Contestation` / `RecallNotice` / cascata | — | [B] com teste determinístico [G5] (H10) |
| `OperatorApproval` / operador escopado | — | [B] via VS-1c com operador adversarial |
| Álgebra de autoridade | — | [B] — as três regras como propriedades testadas |
| EAP: verbos e conformidade L0–L2 | [B] implícito | [B] explícito via checklist [G2] (H12) |
| Conformidade L3 | [E] | [B] via VS-1 **ou permanece [E] com registro** |
| Proveniência mínima | [A] | [B] — schema do Apêndice A em uso |
| Supersessão/contestação | [A] | [E→B] com vocabulário de [23] |
| Greenfield | [C] | [B] mínimo via H5 — teste antes de ligar |
| `claims.ts` determinístico | [C] | [B] no bootstrap da VS-1 |
| Federação / L4 | [C] | [C] — permanece, rebaixada a 1.x |
| Materiais epistêmicos / cidade | [E] | H7 gradua; o resto é 1.x |

## Apêndice D — Checklist de conformidade EAP (esqueleto) *[E → G2]*

**L0 — Leitor:** resolve resources; executa query e `history/since`; distingue recusa de erro de transporte; nunca trata resposta de horizonte como autoritativa fora dele.

**L1 — Propositor:** monta staging válido; submete pelo ciclo de changeset; toda claim carrega âncora e proveniência; trata recusa como resultado de primeira classe (exibe razões, não re-tenta cegamente); declara `based_on_seq` em toda proposta.

**L2 — Admissor:** gate cego ao chamador (mesmo conteúdo ⇒ mesmo veredito sob N identidades); recusa com razões; âncora verbatim com bloqueio duro; cobertura para β; drift graduado; forma canônica de célula em toda borda; verificação 100% offline; audit log separado do grafo.

**L3 — Hospedeiro recursivo:** horizontes com perfis; `PromotionProposal` com as cinco regras da §6; adjacência obrigatória; `CHANGE_READY` por predicado; escalonamento sem promoção implícita; budgets com R9.

**L4 — Par federado:** manifesto assinado; refs congeladas por seq de importação; regra 3 da álgebra; recall federado por importação de manifesto, nunca por rede no gate.

Cada item do checklist deve ser verificável **por log da implementação de referência** — a lição do alpha v0 elevada a método: autorrelato não conta, nunca.
