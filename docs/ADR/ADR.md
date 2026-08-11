# ADR — OpenGraph v1.0

**Architecture Decision Records · derivados do Working Paper v1.0-rc4 · 10 de agosto de 2026**

> **Fonte normativa.** Todo registro deste documento deriva de `OpenGraph_Working_Paper_v1_0.md` (versão 1.0-rc4). Onde um ADR divergir do paper, **o paper vence e o ADR está errado**. Dezesseis dos vinte e um registros expandem blocos de decisão `D-1` a `D-16` já presentes no paper; os cinco restantes formalizam decisões tomadas no corpo das seções indicadas, no mesmo padrão.
>
> **Honestidade de status.** Nenhum destes registros descreve algo construído. O invariante I10 do projeto é literalmente *evidência não se fabrica*, e o campo **Status** é o primeiro lugar onde a desonestidade entraria. `Proposta [E]` significa que a decisão está tomada e o mecanismo não existe; `Aceita [E], substitui formulação anterior` significa que a decisão corrige uma regressão de uma versão anterior do próprio paper; `Aceita [B]` seria reservado a decisões cuja implementação já tem evidência no repositório — e **nenhum dos vinte e um o usa**. As âncoras [B] que aparecem nos registros são substrato herdado da baseline, não prova da decisão.
>
> **O que um ADR precisa ter.** Uma decisão sem alternativas rejeitadas não é decisão — é preferência não examinada. Toda verificação proposta aqui é observável **por log**, nunca por autorrelato: é a lição que o alpha v0 pagou e que o invariante I6 codifica.

## Como ler

| Marca | Significa |
|---|---|
| **[B]** | Baseline conquistada — evidência no repositório, teste de regressão, commit identificado |
| **[C]** | Construído e desligado — código vendorado, nunca exercitado. Não é prova |
| **[E]** | Evolução proposta — precisa de justificativa e de teste de não-regressão |
| **[A]** | Aberto — requisito reconhecido, desenho não resolvido |
| **[G]** | Critério de graduação — o que separa a release candidate da versão final |

A regra que governa todos eles é **[G0]**, o teste de compatibilidade do paper: *a v1.0 pode adicionar mecanismos ao redor da máquina recursiva; não pode mudar a máquina recursiva, nem confundir autoridade relativa de horizonte com posse α/β da verdade.* Quatro destes registros existem porque uma versão anterior falhou nesse teste.

## Índice

| ADR | Decisão | Fonte | Status |
|---|---|---|---|
| **Camada de protocolo** ||||
| [0001](#adr-0001--extrair-a-semântica-como-protocolo-eap-servidor-como-implementação-de-referência) | Extrair a semântica como protocolo (EAP); servidor como implementação de referência | D-1, §5 | Proposta [E] |
| [0002](#adr-0002--máquina-recursiva-intocada-promotecontestinitiate-como-operadores-de-fronteira) | Máquina recursiva intocada; PROMOTE/CONTEST/INITIATE como operadores de fronteira | D-2, §5.1 | Aceita [E] — corrige rc2 |
| [0003](#adr-0003--concretize-é-materialização-própria-do-horizonte-o-capability-gateway-é-sua-borda-externa) | `CONCRETIZE` é materialização própria do horizonte; o gateway é sua borda externa | §5.1.1, §16 | Proposta [E] |
| [0004](#adr-0004--dois-autômatos-declarados-epistemic-lifecycle-machine--workflow-orchestration-statechart) | Dois autômatos declarados: Epistemic Lifecycle × Workflow Orchestration | §5.1.2, Ap. B | Proposta [E] |
| [0005](#adr-0005--fronteira-determinísticoprobabilístico-por-natureza-não-por-verbo) | Fronteira determinístico/probabilístico por natureza, não por verbo | §5.1, §12 | Aceita [E] — corrige rc2 |
| [0006](#adr-0006--taxonomia-fechada-de-recusas-com-obrigação-de-cliente) | Taxonomia fechada de recusas com obrigação de cliente | D-3, §5.2 | Proposta [E] |
| [0007](#adr-0007--conformidade-separa-cliente-agente-de-horizon-host-nenhum-agente-é-l2) | Conformidade separa cliente-agente de horizon host; nenhum agente é L2 | §5.3, §12 | Aceita [E] — corrige rc2 |
| **Fronteiras entre horizontes** ||||
| [0008](#adr-0008--topologia-de-horizontes-como-dag-de-fronteiras-de-promoção) | Topologia de horizontes como DAG de fronteiras de promoção | D-4, §6 | Proposta [E] |
| [0009](#adr-0009--initiatenegotiationseed-iniciar-carrega-contexto-nunca-autoridade) | `INITIATE`/`NegotiationSeed`: iniciar carrega contexto, nunca autoridade | §6.1 | Proposta [E] |
| [0010](#adr-0010--stale_base-bifurcado-defasagem-operacional-é-aprovável-frescor-epistemológico-não) | `STALE_BASE` bifurcado: defasagem operacional é aprovável, frescor não | §7, §13, §14 | Aceita [E] — endurece rc3 |
| [0011](#adr-0011--nenhum-segundo-gate-persistentdelta-é-envelope-não-bypass) | Nenhum segundo gate: `PersistentDelta` é envelope, não bypass | D-5, §8 | Proposta [E] |
| [0012](#adr-0012--contestação-por-evento-tipado-com-três-severidades-nunca-edição) | Contestação por evento tipado com três severidades, nunca edição | D-6, §9 | Proposta [E] |
| **Autoridade, correção e propagação** ||||
| [0013](#adr-0013--recall-cascata-calculada-garantia-escopada-ao-grafo-admitido-reabilitação-célula-a-célula) | Recall: cascata calculada, garantia escopada, reabilitação célula a célula | D-7, §10 | Proposta [E] |
| [0014](#adr-0014--três-coordenadas-ortogonais-de-autoridade-propagação-pela-pior-dependência) | Três coordenadas ortogonais de autoridade; propagação pela pior dependência | D-8, §11 | Aceita [E] — corrige rc2 |
| [0015](#adr-0015--suspended-é-posse-e-só-posse) | `suspended` é posse, e só posse | D-16, §11 | Aceita [E] — corrige rc3 |
| **Plano cognitivo e operador** ||||
| [0016](#adr-0016--change_ready-por-predicado-triplo-llm-recomenda-router-transita) | `CHANGE_READY` por predicado triplo; LLM recomenda, Router transita | D-9, §13 | Proposta [E] |
| [0017](#adr-0017--operador-é-root-intencional-não-root-epistemológico) | Operador é root intencional, não root epistemológico | D-10, §14 | Proposta [E] |
| [0018](#adr-0018--default-irreversível-para-tool-não-classificada) | Default irreversível para tool não classificada | D-11, §16 | Proposta [E] |
| **Runtime e economia** ||||
| [0019](#adr-0019--semântica-normativa-no-protocolo-engine-única-só-na-implementação-de-referência) | Semântica normativa no protocolo; engine única só na referência | D-12, §19 | Proposta [E] |
| [0020](#adr-0020--scratch-não-memorial-legítimo-memória-sempre-no-grafo) | Scratch não-memorial legítimo; memória sempre no grafo | D-13, §20 | Aceita [E] — corrige rc2 |
| **Processo** ||||
| [0021](#adr-0021--processo-teste-antes-de-ligar-código-c-dxe-antes-de-baselines-externos) | Teste antes de ligar código [C]; D×E antes de baselines externos | D-14/D-15, §21, §29 | Aceita [E] |

---

## ADR-0001 — Extrair a semântica como protocolo (EAP); servidor como implementação de referência

| | |
|---|---|
| **Status** | Proposta [E] — pendente de VS-1 e de [G2]/H12 |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §5 (bloco D-1), §5.4, §5.5, §33 |
| **Marca** | [E] |
| **Relaciona** | ADR-0002, ADR-0003, ADR-0006, ADR-0007 |

### Contexto

A baseline construiu um servidor; a v0.4 construiu uma arquitetura. Nenhum dos dois implica sozinho o passo que a v1.0 propõe. A força que produziu a decisão é uma pergunta que a fronteira MCP tornou inevitável: **se MCP é apenas transporte, que semântica permanece quando o binding troca?** A auditoria da v0.4 registrou a lacuna correspondente — "ecossistema (MCP, 11 flavors) sem formalização" — e o quadro de rupturas da §4 nomeia o paradigma atacado: frameworks multiagente possuem a pilha inteira, e o resultado é interoperabilidade de capacidade sem interoperabilidade de autoridade. MCP [24] e A2A [29] padronizam como agentes falam e o que podem fazer; nenhum padroniza *o que agentes têm o direito de afirmar*.

A analogia estrutural que orienta a proposta é deliberada — HTTP não é um servidor web, SemVer não é um package manager, SLSA não é um build system [26] — mas o paper é explícito em que ela é **aspiração, não estado**: esses protocolos provaram valor com múltiplas implementações interoperando, e o EAP tem exatamente uma. Por isso a formulação correta não é "OpenGraph deixa de ser produto e passa a ser protocolo"; é: a v1.0 propõe a extração, define o critério de conformidade e amarra a tese a H12.

### Decisão

> **O protocolo adota a extração da semântica central do OpenGraph — a máquina recursiva, os operadores de fronteira, a correção, as recusas e as regras de propagação — como contrato de conformidade independente de implementação, sob o nome Epistemic Admission Protocol (EAP), com o servidor do repositório como implementação de referência.**

A direção da dependência é fixada agora, antes de qualquer prova de interoperabilidade:

```
semântica dos verbos   ──vive em──►  EAP
binding (MCP, outro)   ──apenas──►  transporta

se trocar o binding altera o que ADMIT significa, o protocolo vazou
— na mesma acepção em que a v0.4 §5 define vazamento do Epistemic Plane
```

A tese permanece **[E]**, amarrada a H12: se três flavors reais não passarem L0–L1 sem adaptação server-side específica por flavor, **a tese de protocolo rebaixa a tese de produto, com registro** — não é remendada.

### Alternativas rejeitadas

**(a) Declarar o protocolo como fato consumado.** Foi o erro de formulação da rc2, corrigido nesta versão. Perdeu porque fabricaria por linguagem exatamente aquilo que só interoperabilidade real prova — a forma mais barata da patologia que o sistema existe para impedir, cometida pelo próprio documento que a define. Um protocolo com uma implementação é uma documentação interna com nome ambicioso.

**(b) Não extrair protocolo e escalar produto fechado.** Perdeu porque obriga a portar o produto para cada agente, contrariando a consequência estratégica já paga pela fronteira MCP: entrega-se o endpoint compliant e um plugin fino por flavor, não uma integração por flavor (§5.4).

**(c) Framework de agentes com grafo embutido.** Negado desde a v0.2 e mantido negado em §32. Perdeu porque acopla a semântica de autoridade a um desenho de agentes, isto é, torna o mérito epistêmico dependente de quem o hospeda — o oposto do gate cego ao chamador.

### Consequências

**Custa.** Especificar tem preço: verbos, taxonomia de recusas, níveis de conformidade, checklist executável e — no limite — um processo de evolução do próprio protocolo, que §35 deixa explicitamente aberto ("especificá-lo antes seria governança de uma comunidade de um"). Custa também aceitar publicamente que a tese pode ser rebaixada.

**Habilita.** O teste adversarial deixa de ser teste de produto e vira teste de protocolo: uma implementação hostil do mesmo nível de conformidade passa a ser um alvo enumerável (§17). A fronteira cliente-agnóstica deixa de ser propriedade do servidor e vira propriedade do contrato.

**Desconfortável.** Enquanto H12 não graduar, tudo que este ADR estabelece é uma proposta bem especificada. O documento que a contém não pode se promover sozinho — é a aplicação de [G1] ao próprio paper.

### Reversibilidade

**Alta.** Falhando H12, o EAP colapsa em documentação interna sem perda de mecanismo: nada do que a implementação de referência faz depende de o contrato ter nome próprio. O que se perde é a alegação de novidade da camada 3 da §33 — que é, por desenho, uma alegação sobre ausência e portanto refutável por um único contraexemplo.

### Verificação

Critério **[G2]**: checklist executável do Apêndice D e **pelo menos três flavors distintos** do registry passando L0–L1 contra a implementação de referência, cada item verificado **por log do host** — nunca por autorrelato do agente, lição que o alpha v0 pagou. Hipótese **H12** ("a conformidade vale para o ecossistema real"), falsificada se a aprovação só ocorrer com adaptação server-side por flavor. Métrica: *Conformance Pass Rate por flavor*. Ameaça correspondente: a extensão do teste de substituição adversarial a **implementações hostis do mesmo nível** (§17), com T1 como instância concreta no lado cliente.

### Notas de implementação

Afeta `packages/mcp-server` como implementação de referência — a fronteira MCP em `src/tools/` e `src/resources.ts` é o binding, não o protocolo. Afeta `packages/mcp-server/src/agent-registry.ts` (`AgentFlavorDef`, 11 flavors) com `doctor.ts` e `install.ts`: §5.5 exige que o adapter ganhe duas metades — declarar o nível de conformidade do flavor (insumo de [G2]) e declarar a classificação de efeito das tools que o flavor traz (insumo do gateway). `packages/client` e `packages/stdio-proxy` são superfícies L0/L1. Nada no HEAD implementa uma especificação de protocolo: o que existe é a implementação que a especificação descreveria.

---

## ADR-0002 — Máquina recursiva intocada; PROMOTE/CONTEST/INITIATE como operadores de fronteira

| | |
|---|---|
| **Status** | Aceita [E], substitui formulação anterior (rc2) |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §5.1 (bloco D-2), §0.1 item 2, §36; v0.4 §4.2 |
| **Marca** | [E] — os operadores; a máquina de seis estados é definição protegida por [G0] |
| **Relaciona** | ADR-0001, ADR-0003, ADR-0004, ADR-0008, ADR-0009 |

### Contexto

Esta é a correção mais importante do documento, e sua história é parte do seu valor. A rc2 apresentou "cinco verbos de ciclo" em que `CONCRETIZE` havia desaparecido e `PROMOTE` entrara no lugar. Não era uma formalização da v0.4 — **era outra máquina**. O erro não parecia erro: parecia rigor. Ao dar nomes de protocolo à máquina, a notação removeu o estado onde a rota operacional inteira vive e embutiu no ciclo um operador que existe precisamente para atravessar ciclos.

A meta-análise da §36 classifica o episódio com precisão: *formalização que troca o formalizado*. E o corolário que a §1 elevou ao nível dos invariantes: uma formalização que falha em silêncio é igual a um gate que falha em silêncio — produz a sensação de rigor enquanto troca aquilo que formaliza. Daí a regra que passou a existir:

> **[G0] Teste de compatibilidade v0.4 → v1.0.** A v1.0 pode adicionar mecanismos **ao redor** da máquina recursiva; não pode mudar a máquina recursiva, nem confundir autoridade relativa de horizonte com posse α/β da verdade. Qualquer formulação que falhe neste teste é regressão, não evolução.

A fraqueza atacada é W2 — promoção entre horizontes como narrativa ("vira proposta") e não como mecanismo.

### Decisão

> **O EAP formaliza a máquina de seis estados exatamente como a v0.4 a define, e adiciona `PROMOTE`/`CONTEST` como operadores de fronteira e `RECALL` como mecanismo de correção sobre o persistente. A máquina não muda; ganha operadores ao redor.**

```
MÁQUINA RECURSIVA — executa INTEIRA dentro de cada horizonte

PROPOSE → DELIBERATE → ADMIT → CONCRETIZE → VERIFY → AUTHORITY_relativa
                                                       ▲ estado resultante, não verbo

OPERADORES DE FRONTEIRA — entre ciclos, nunca dentro deles

PROMOTE   autoridade_relativa completa no filho ──► PROPOSE no pai (topologia §6)
CONTEST   evidência em qualquer horizonte       ──► desafio a conteúdo admitido em outro
INITIATE  contexto com proveniência             ──► PROPOSE em horizonte novo,
                                                    sem transferir autoridade

CORREÇÃO — sobre o estado persistente

RECALL    contestação invalidante admitida      ──► cascata calculada (§10)
```

Cada elemento tem pré-condição, pós-condição e modos de recusa declarados (§5.1). Duas pós-condições são normativas e não admitem leitura frouxa: `PROMOTE` produz candidato `proposed` no pai — **nunca mais que isso**; `AUTHORITY_relativa` habilita exatamente o que a tabela do horizonte lista — **e nada além**.

### Alternativas rejeitadas

**(a) O ciclo de cinco verbos da rc2, com `PROMOTE` embutido.** Perdeu por dois motivos independentes, e qualquer um bastaria: muda a máquina, violando [G0]; e apaga a `CONCRETIZAÇÃO`, que é onde a rota operacional inteira vive — a decisão apagaria do protocolo o único estado em que o sistema toca o mundo.

**(b) API CRUD sobre nós e claims.** Perdeu porque dissolve a distinção entre **escrever** e **admitir**, que é a tese. Um `PUT /claims/:id` é uma promoção sem gate com sintaxe de banco de dados.

**(c) Verbos livres por extensão** (cada implementação acrescenta os seus). Perdeu porque cada extensão é um vetor de contorno do gate: o caminho mais barato para readmitir autoridade probabilística é um verbo novo cuja semântica ninguém precisou justificar.

### Consequências

**Custa.** A especificação carrega uma assimetria visível — máquina ≠ operadores ≠ correção — que toda implementação precisa respeitar e que nenhuma notação uniforme vai esconder. É deliberado: **a assimetria *é* a arquitetura**.

**Habilita.** A recursividade da v0.4 fica preservada *e* instrumentada: a promoção deixa de ser narrativa e passa a ter objeto (`PromotionProposal`), fronteira (topologia) e recusa (`HORIZON_SKIP`, `AUTHORITY_REF_INVALID`, `ASSUMPTION_DROPPED`, `STALE_BASE`).

**Desconfortável.** [G0] é um tripwire sobre o próprio processo de escrita, não sobre o software. Ele já disparou duas vezes contra a rc2, e nada garante que a próxima regressão de notação seja percebida pela auditoria seguinte.

### Reversibilidade

**Nenhuma dentro de [G0].** Voltar atrás é, por definição, a regressão que [G0] existe para recusar. O único caminho legítimo para alterar a máquina é revogá-la com registro em §36 — e revogar a máquina recursiva é revogar a Lei 8 e a tese da v0.4 inteira.

### Verificação

**[G0]** é o critério que rege esta decisão, e é honesto dizer o que ele é: um teste **documental**, verificado por auditoria de formulação contra a v0.4, não por log. O que é verificável por log são os mecanismos que ele protege — e é isso que a **VS-1a** testa: contratos e guardas em isolamento, sem LLM; e a conformidade **semântica** dos seis estados por horizonte (ADR-0003). Ameaça **T8** (salto de horizonte) e **T2** (exfiltração de autoridade via artefato) atacam diretamente a separação ciclo/fronteira. Hipótese **H1** (promoção explícita reduz contaminação entre horizontes sem custo proibitivo), com métrica *Cross-Horizon Leakage*; o desfecho pré-registrado é duro: leakage zero apenas **por disciplina de prompt** revoga a recursividade como *mecanismo* e a rebaixa a *convenção*, com registro.

### Notas de implementação

Nenhum dos três operadores de fronteira existe no HEAD. O que existe é o ciclo do horizonte persistente parcialmente materializado: `packages/mcp-server/src/gates.ts` e `src/tools/changeset.ts` implementam `ADMIT` daquele horizonte; `packages/graph-core/src/verify.ts` e `roundtrip.ts` implementam parte do `VERIFY`; `authority.ts` mantém a posse. `PROMOTE`, `CONTEST`, `INITIATE` e `RECALL` são [E] sem código correspondente — e este ADR não fixa o desenho de sua implementação, apenas o contrato.

---

## ADR-0003 — `CONCRETIZE` é materialização própria do horizonte; o Capability Gateway é sua borda externa

| | |
|---|---|
| **Status** | Proposta [E] — pendente de VS-1a (conformidade semântica dos seis estados) |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §5.1.1, §16 |
| **Marca** | [E] |
| **Relaciona** | ADR-0002, ADR-0004, ADR-0007 |

### Contexto

A rc3, ao restaurar `CONCRETIZE` no ciclo, associou-o à rota operacional e ao Tool Gateway. A associação é verdadeira **apenas onde há efeito externo** — microtask e transformação. Tomada como definição, produz um defeito sutil: a máquina fica nominalmente recursiva e semanticamente definida só no horizonte técnico. Uma sessão que "não concretiza" tem cinco estados; um horizonte de negociação que "não concretiza" tem cinco estados; e a alegação central da v0.4 — *uma máquina em todo horizonte* — vira uma coincidência de nomes.

Esta é uma das cinco ambiguidades de segunda ordem que a rc4 fecha: o tipo de ambiguidade que só aparece quando a arquitetura fica formal o suficiente para ser implementada.

### Decisão

> **`CONCRETIZE` significa materializar o conteúdo admitido na forma concreta própria daquele horizonte. O Capability Gateway é a implementação da sua borda externa em certos horizontes — não a sua definição.**

E o mesmo vale para os outros cinco estados: implementações diferem por horizonte; **a relação abstrata precisa sobreviver aos cinco**. A tabela normativa:

| | Sessão | Negociação | Transformação | Microtask | Persistente |
|---|---|---|---|---|---|
| `PROPOSE` | pergunta / intenção do operador | questão, hipótese candidata | decomposição / WorkOrder candidata | abordagem candidata da tarefa | claim / delta candidato |
| `DELIBERATE` | confronto com o já respondido | questões, conflitos, assumptions | dependências, riscos, ordenação | tentativas e alternativas | análise de impacto, revisão |
| `ADMIT` | ponto aceito como resolvido na sessão | questão aceita no escopo da negociação | WorkOrder emitida sob contrato | abordagem aceita para execução | claim admitida pelo gate |
| `CONCRETIZE` | resposta contextualizada | hipótese preditiva / contrato candidato | composição coerente dos resultados aceitos | artefato / teste / ação (via gateway §16) | delta incorporado ao objeto oficial |
| `VERIFY` | resposta confrontada com o persistente (`seq`) | hipótese confrontada com estado e operador | resultados confrontados com o contrato | evidência de execução re-checável | âncora, cobertura, roundtrip |
| `AUTHORITY_relativa` | não reabrir o ponto na sessão | instanciar a transformação | propor promoção ao persistente | devolver resultado aceito ao médio | compor o estado oficial versionado |

As três relações que **nunca** mudam de significado, em qualquer coluna:

- `ADMIT` sempre significa: *algo saiu de candidato e foi aceito como base legítima para a concretização naquele horizonte.*
- `VERIFY` sempre significa: *confrontar o concretizado com aquilo que foi admitido.*
- `AUTHORITY_relativa` sempre significa: *o verificado passa a poder governar operações dentro daquele horizonte — e nada além.*

Somente onde a materialização produz efeito fora do OpenGraph — arquivo, processo, rede — ela atravessa o gateway por ferramentas classificadas em idempotente, compensável e irreversível; e **nada do que a ação produz é conhecimento até `VERIFY`**. A política de classificação e o default irreversível para tool não classificada são objeto de decisão própria (§16, D-11).

### Alternativas rejeitadas

**(a) `CONCRETIZE` ≡ rota operacional / Tool Gateway** (formulação da rc3). Perdeu porque define a máquina universal por um caso particular: o horizonte com efeito externo. O resultado seria recursividade nominal — a pior espécie, porque passa no teste de nomes e falha no de semântica.

**(b) Permitir que horizontes sem efeito externo pulem o estado.** Perdeu porque produz cinco estados com seis nomes, e a conformidade não teria como distinguir uma implementação que materializa de outra que apenas rotula. É a versão de estado da patologia que I5 pagou.

**(c) Definir `CONCRETIZE` por implementação, deixando cada host escolher o significado.** Perdeu pela mesma razão que a §5 dá para a direção da dependência: se a implementação define a semântica, o protocolo vazou.

### Consequências

**Custa.** A conformidade L3 passa a exigir um oráculo semântico, não um oráculo sintático: a VS-1 verifica **a relação, não os rótulos**. Revisar relação é mais caro do que casar strings, e depende de logs que distingam candidato de aceito em cada horizonte.

**Habilita.** A recursividade fica verificável fora do horizonte técnico, o que é a condição para a §22 valer: greenfield e domínios sem código podem hospedar torres porque a máquina não pressupõe filesystem. Habilita também a leitura correta do gateway — que julga autorização e classe, nunca mérito.

**Desconfortável.** Uma implementação cujo `ADMIT` de sessão não distingue candidato de aceito **falha a conformidade L3 por semântica, não por sintaxe** — e falhará mesmo tendo os seis nomes no log. Seis labels não são seis estados.

### Reversibilidade

**Baixa.** Voltar a definir `CONCRETIZE` pela borda externa é reinstalar a regressão que a rc3 herdou e a rc4 fechou, e arrasta consigo a universalidade dos outros cinco estados. Alta apenas no que toca à *implementação* do gateway, que é decisão da referência.

### Verificação

**VS-1a** cobre a conformidade semântica dos seis estados por horizonte, **com a tabela acima como oráculo de revisão**. Checklist **L3** do Apêndice D ("horizontes com perfis semânticos"). Hipótese **H1**; ameaça **T11** (tool camuflada) no lado do gateway. Nota de falsificabilidade honesta: a parte mecanicamente falsificável é a existência de estados distinguíveis por log em cada horizonte; a verificação de que a *relação* se preserva é uma revisão contra oráculo escrito — mais forte que autorrelato, mais fraca que um teste determinístico. O paper não define um teste automático para isso, e este ADR não inventa um.

### Notas de implementação

No HEAD, apenas o horizonte persistente tem os estados materializados (gate, cobertura, roundtrip em `packages/graph-core/src/verify.ts`, `roundtrip.ts`, `ascent.ts`, `project.ts`). Não existe host de sessão, negociação, transformação ou microtask. O Capability Gateway não tem módulo correspondente; a classificação de efeito das tools é insumo declarado no adapter (`packages/mcp-server/src/agent-registry.ts`) e validado pelo `doctor.ts` — ambos [E] quanto a esse campo.

---

## ADR-0004 — Dois autômatos declarados: Epistemic Lifecycle Machine × Workflow Orchestration Statechart

| | |
|---|---|
| **Status** | Proposta [E] — pendente de VS-1 |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §5.1.2, Apêndice B |
| **Marca** | [E] |
| **Relaciona** | ADR-0002, ADR-0003, ADR-0005 |

### Contexto

O documento contém dois autômatos, e até a rc3 o leitor precisava descobri-lo sozinho. Um descreve o estágio **epistemológico** de um conhecimento dentro de um OpenGraph; o outro descreve o estágio **operacional** da sessão ou mudança como um todo. Ambos têm estados, transições e guardas; ambos usam vocabulário próximo. A força que produziu a decisão é o risco de implementação: confundi-las produziria a versão de statechart do erro que I5 pagou — **duas semânticas sob um nome**, que é exatamente como F1 e F7 nasceram.

### Decisão

> **O protocolo declara dois autômatos distintos, com nomes próprios, e proíbe tratá-los como um.**

```
EPISTEMIC LIFECYCLE MACHINE          "em que estágio epistemológico está este
  (§5.1 — um por OpenGraph)           conhecimento, neste OpenGraph?"
  PROPOSE · DELIBERATE · ADMIT · CONCRETIZE · VERIFY · AUTHORITY_relativa

WORKFLOW ORCHESTRATION STATECHART    "em que estágio operacional está a
  (Apêndice B — um, do Router)        sessão/mudança como um todo?"
  CHAT · QUERY · NEGOTIATING · CHANGE_READY · PLANNING · EXECUTING ·
  VERIFYING · WAITING_HUMAN · PROMOTING · DONE · ABORTED
```

A posse é assimétrica e explícita: **os hosts possuem os lifecycles; o Router os observa e decide as transições do workflow.** A composição é *coordenação de autômatos* — um produto coordenado, não uma máquina única. O exemplo normativo do paper fixa a leitura:

```
instante real de uma transformação com três WorkOrders:

   WO-1 → AUTHORITY        │
   WO-2 → VERIFY           │  e o workflow, simplesmente:  EXECUTING
   WO-3 → DELIBERATE       │
```

`Workflow: EXECUTING` **não** significa que todos os OpenGraphs estão em `CONCRETIZE`.

### Alternativas rejeitadas

**(a) Uma máquina única, com os estados do workflow mapeando os do lifecycle.** Perdeu por falsidade demonstrável: o exemplo acima é um estado legítimo do sistema que o mapeamento não representa. Um mapeamento que precisa mentir sobre instantes reais não é uma abstração, é uma perda de informação.

**(b) Deixar a distinção implícita** (estado da rc3). Perdeu porque a ambiguidade só se paga na implementação, e sempre no pior lugar: o momento em que alguém escreve uma guarda que lê o estado errado.

**(c) O Router possuir os lifecycles.** Perdeu porque converteria o control plane determinístico em detentor do estado epistêmico dos horizontes — e o Router é não-agente justamente porque sua responsabilidade é determinística (§12). Quem possui o lifecycle possui `ADMIT`; quem possui `ADMIT` é host, não coordenador.

### Consequências

**Custa.** Dois vocabulários coexistem em logs, telas e código, com risco permanente de confusão e necessidade de disciplina de nomenclatura. Mais eventos observáveis, mais superfície de teste.

**Habilita.** WorkOrders progridem em ritmos diferentes sem que o workflow precise inventar um estado agregado falso; o Router observa sem acoplar; e as guardas do Apêndice B ficam expressáveis como predicados sobre *observações* dos lifecycles (`todas as WorkOrders com AuditDecision(accepted)` ⇒ `VERIFYING → PROMOTING`).

**Desconfortável.** Não existe uma "barra de progresso" epistemologicamente honesta: o estágio operacional não resume o estágio epistêmico, e qualquer interface que finja o contrário estará mentindo por agregação.

### Reversibilidade

**Média.** Enquanto os dois vocabulários não estiverem gravados em logs, guardas e clientes, renomear ou fundir é barato. Depois disso, o custo é o mesmo que D-16 registra para vocabulário estabelecido: reescrever logs históricos e quebrar clientes que dependem dos nomes.

### Verificação

**VS-1a** testa as guardas do statechart em isolamento, sem LLM. A propriedade global do Apêndice B é verificável por log e é a mais importante: **não existe caminho para `PROMOTING` ou `DONE` a partir de exaustão, timeout ou abandono** — R9. Ameaça **T14** (fadiga como vetor), com `default_on_timeout = abortar`. Hipótese **H2** (convergência do loop Intermediador↔Técnico), medida em **VS-1b** por *Audit Loop Convergence*; métrica *Budget Exhaustion Outcomes*, com alvo 100% de exaustões terminando em escalonamento.

### Notas de implementação

O Router não existe no HEAD. O que existe é infraestrutura de sessão e turno — `packages/mcp-server/src/tools/session.ts`, `affinity.ts`, `sweeper.ts` — que **não** é o Workflow Orchestration Statechart e não deve ser apresentada como tal; o escopo de turno produz `out of turn scope`, que é uma recusa de autorização, não uma transição de workflow. O lado do lifecycle existe apenas no horizonte persistente (ADR-0003).

---

## ADR-0005 — Fronteira determinístico/probabilístico por natureza, não por verbo

| | |
|---|---|
| **Status** | Aceita [E], substitui formulação anterior (rc2) |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §5.1 (linha divisória do protocolo), §12 item 3, Apêndice A |
| **Marca** | [E] |
| **Relaciona** | ADR-0002, ADR-0004, ADR-0006 |

### Contexto

A rc2 afirmou: "DELIBERATE é o único verbo probabilístico; todos os que decidem são determinísticos". A formulação é atraente e falsa, e sua falsidade é interna à própria arquitetura: **o Intermediador existe *porque* avaliar qualidade exige inteligência.** "Esta arquitetura está coerente?", "este contrato satisfaz a intenção?", "este layout resolve a necessidade?" não têm teste determinístico. Se apenas `DELIBERATE` pudesse ser probabilístico, o loop de auditoria da §12 seria impossível — ou, pior, seria implementado com um julgamento probabilístico disfarçado de verificação.

A decisão ataca a Lei 5 no ponto em que ela era grossa demais: *LLMs decidem conteúdo; o protocolo decide fluxo e autoridade* — verdadeira, mas enunciada como se conteúdo e fluxo se distribuíssem entre verbos diferentes.

### Decisão

> **Julgamento semântico pode ser probabilístico — em qualquer verbo cujo conteúdo o exija. Transição de autoridade é governada deterministicamente — sem exceção.**

Conteúdo e fluxo **não se separam por verbo; separam-se por natureza, dentro de cada verbo.** O par de contratos do Apêndice A materializa a linha:

```
AuditAssessment {                     // julgamento semântico — pode ser probabilístico
  task_id, judgment, reasons[], attempt
}
AuditDecision {                       // consequência governada — segue o protocolo do horizonte
  task_id, assessment_ref,
  verdict: accepted | revise | escalate,   // accepted = admissão da PromotionProposal no médio
  reasons[], attempt
}
```

Um agente pode concluir probabilisticamente "considero adequado, pelas razões R"; a consequência disso — admitir no OpenGraph daquele horizonte — segue o protocolo do horizonte, com registro, razões e as guardas mecânicas de sempre. Em uma linha: **o modelo recomenda; a estrutura transita.**

### Alternativas rejeitadas

**(a) "Apenas `DELIBERATE` é probabilístico"** (rc2). Perdeu por contradizer a existência do Intermediador — cuja função é julgar qualidade que não tem teste determinístico — e por empurrar o julgamento inevitável para dentro de um verbo que decide, onde ele ficaria invisível.

**(b) Tornar o julgamento semântico determinístico por rubrica.** Perdeu por impossibilidade declarada: as perguntas que o Intermediador responde não têm teste determinístico. Uma rubrica que fingisse tê-lo produziria a pior combinação — arbitrariedade com aparência de mecanismo.

**(c) Deixar a consequência seguir o julgamento** (aceito pelo Intermediador ⇒ admitido). Perdeu porque é R5 com outro nome: converteria a avaliação probabilística em transição de autoridade. `accepted` **é** a admissão da proposta *no médio* — e apenas no médio; o gate do longo reavalia do zero.

### Consequências

**Custa.** Dois objetos onde ingenuamente bastaria um, e um registro obrigatório para cada julgamento — inclusive os positivos. A cerimônia é o preço de tornar auditável o momento exato em que inteligência encosta em autoridade.

**Habilita.** Torna nomeável e testável a fronteira que o sistema inteiro protege; e dá ao loop `AuditAssessment`/`AuditDecision` a forma de um mecanismo, com `revise` sendo recusa com razões e `escalate` sendo escalonamento — um mecanismo, dois ângulos.

**Desconfortável.** O sistema aceita que um julgamento probabilístico esteja no caminho crítico de quase toda transição. A garantia não é que o julgamento seja bom; é que ele nunca é a transição.

### Reversibilidade

**Nenhuma dentro da tese.** Colapsar `AuditAssessment` em `AuditDecision` é R5, e revoga a Lei 5. O que é calibrável — quais verbos exigem julgamento em cada horizonte — não altera a linha.

### Verificação

**VS-1b** exercita o loop `AuditAssessment`/`AuditDecision` até `accepted` ou escalonamento, no par cliente/host mais barato. Ameaças **T3** (Intermediador carimba sem auditar — o gate do longo reavalia do zero) e **T13** (colusão Intermediador + Técnico — a colusão inteira só alcança o médio). Hipótese **H2**, com *Audit Loop Convergence*; e **H3** no que toca a mérito cego ao chamador, com *Refusal Fidelity* medindo se `revise` nomeia a causa real.

### Notas de implementação

Os dois contratos estão no Apêndice A e não têm código no HEAD. O lado determinístico já tem sua encarnação de referência: `packages/mcp-server/src/gates.ts` decide admissão sem consultar identidade de chamador, e `packages/graph-core/src/authority.ts` transita posse por prova, não por avaliação. Nenhum componente probabilístico existe no repositório — o Cognitive Plane inteiro é W1.

---

## ADR-0006 — Taxonomia fechada de recusas com obrigação de cliente

| | |
|---|---|
| **Status** | Proposta [E] — pendente de VS-1; núcleo de admissão já [B] no repositório |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §5.2 (bloco D-3), invariante I6 |
| **Marca** | [B → E] |
| **Relaciona** | ADR-0001, ADR-0005, ADR-0007, ADR-0010 |

### Contexto

I6 foi pago caro: **59 chamadas logadas `ok:true` e zero claims** — um gate que aprovava vacuamente enquanto o log dizia que tudo estava bem. A cicatriz produziu o invariante "recusa é registrada como recusa, com razões". A v1.0 dá o passo seguinte, exigido pela proposta de protocolo: **um ecossistema não nasce sobre recusas de texto livre que cada implementação inventa.** Sem vocabulário comum, *Refusal Fidelity* não é mensurável, clientes não podem reagir corretamente e a conformidade não tem o que verificar.

### Decisão

> **Os códigos de recusa são vocabulário fechado do EAP, e cada código carrega a obrigação do cliente conforme.**

| Grupo | Códigos | Obrigação do cliente conforme |
|---|---|---|
| Admissão | `ANCHOR_NOT_FOUND` *[B]*, `COVERAGE_UNBALANCED` *[B]*, `CELL_KEY_NONCANONICAL` *[B]*, `LADDER_VIOLATION` *[B]*, `PROVENANCE_MISSING` *[E]* | corrigir a âncora sem re-submeter idêntico; completar cobertura ou renunciar a β; normalizar — jamais criar a célula na grafia nova; reestruturar o changeset; completar proveniência |
| Fronteira | `HORIZON_SKIP`, `AUTHORITY_REF_INVALID`, `ASSUMPTION_DROPPED`, `STALE_BASE` *[E]* | propor ao pai topológico; completar o ciclo na origem; reintroduzir ou resolver com registro; rebase/revalidação para promover (ADR-0010) |
| Operador | `SCOPE_EXCEEDED`, `APPROVAL_EXPIRED`, `APPROVAL_STALE_SEQ`, `EVIDENCE_REQUIRED` *[E]* | re-escalar com escopo correto; obter aprovação nova — consentimento antigo não é consentimento; **não existe caminho** — recusa terminal por desenho |
| Execução | `TOOL_UNCLASSIFIED`, `TOOL_OUT_OF_CONTRACT`, `BUDGET_EXHAUSTED` *[E]*, `TURN_SCOPE` *[B]* | classificar no adapter; escalar ao operador; escalonamento — **nunca** promoção (R9); aguardar/adquirir o turno |
| Correção | `RECALL_UNPROVEN`, `REHAB_WITHOUT_PROOF`, `DIRECT_EDIT_FORBIDDEN` *[E]* | apresentar evidência — recall também atravessa gate; percorrer o caminho normal de verificação; **não existe caminho legítimo** (R8) |

Duas propriedades importam mais que os códigos. Primeira: **cada código nomeia a causa real** — uma recusa genérica é quase tão inútil quanto uma aprovação vácua. Segunda, e é a que faz da taxonomia um contrato e não uma lista: **a obrigação do cliente faz parte do protocolo.** Quem re-submete cegamente após `ANCHOR_NOT_FOUND` não é persistente; **é não-conforme.** A recusa não é apenas uma resposta — é uma instrução de conduta cujo descumprimento é observável no log do host, e é por isso que ela pertence ao checklist L1 e não à documentação de erros.

Três códigos são **terminais por desenho** — `EVIDENCE_REQUIRED`, `DIRECT_EDIT_FORBIDDEN` e, para promoção, `STALE_BASE`: não existe re-submissão que os satisfaça, apenas um caminho diferente.

### Alternativas rejeitadas

**(a) Recusa em texto livre.** Perdeu por não interoperar e não medir: cada implementação inventaria sua redação, nenhum cliente poderia reagir programaticamente, e *Refusal Taxonomy Coverage* seria incalculável.

**(b) Códigos numéricos sem semântica de obrigação.** Perdeu porque dizem *o que houve* e não *o que fazer*. Um código que não obriga permite que o cliente conforme e o cliente teimoso sejam indistinguíveis no log — e a distinção entre eles é precisamente o que a conformidade certifica.

### Consequências

**Custa.** Recusa nova exige revisão do protocolo. A fricção é deliberada: cada código é uma promessa a clientes existentes.

**Habilita.** Torna mensuráveis *Refusal Fidelity* e *Refusal Taxonomy Coverage*; dá ao checklist L1 um item verificável por log; e transforma cada ameaça do catálogo em uma expectativa concreta ("T6 deve produzir `ASSUMPTION_DROPPED`, por log").

**Desconfortável.** Um cliente pode ficar permanentemente bloqueado sem ter feito nada de errado — `EVIDENCE_REQUIRED` não tem contorno, nem para o operador humano. É a tese funcionando na única forma que ela tem: **evidência não se fabrica** (I10).

### Reversibilidade

**Média.** Adicionar códigos é barato; remover um código ou alterar sua semântica quebra clientes que já implementaram a obrigação correspondente.

### Verificação

Itens de **L1** (exibe código e razões, cumpre a obrigação, não re-submete cegamente) e **L2** (recusa com código da taxonomia) do Apêndice D, verificados por log do host. **VS-1a** para os contratos e **VS-1c** para o fluxo completo; **[G3]** exige que `HORIZON_SKIP`, `AUTHORITY_REF_INVALID`, `ASSUMPTION_DROPPED` e `STALE_BASE` apareçam por log em testes adversariais. Ameaças **T5, T6, T8, T9, T11** têm cada uma seu código esperado. Hipótese **H3**; métricas *Refusal Fidelity* e *Refusal Taxonomy Coverage*.

### Notas de implementação

Cinco códigos já têm comportamento pago no repositório, hoje emitidos como razões textuais: `packages/mcp-server/src/gates.ts` produz `out of turn scope` e as recusas de âncora e cobertura; a canonicalização de chave de célula vive em `src/cell.ts` com teste de regressão dedicado; a validação atômica da escada está em `packages/graph-core` (`cell-dag.ts`, `claim-store.ts`). **Codificar essas razões na taxonomia fechada e expor o código na fronteira MCP é trabalho [E]**, não estado atual. `src/log.ts` é a superfície de observabilidade sobre a qual as métricas de recusa serão calculadas. As obrigações de cliente afetam `packages/client`, `packages/stdio-proxy` e `packages/claude-plugin`.

---

## ADR-0007 — Conformidade separa cliente-agente de horizon host; nenhum agente é L2

| | |
|---|---|
| **Status** | Aceita [E], substitui formulação anterior (rc2) — L0–L2 descrevem [B]; L3 pendente de VS-1, L4 é [C] |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §5.3, §12 item 1, Apêndice D |
| **Marca** | [E → G] |
| **Relaciona** | ADR-0001, ADR-0005, ADR-0006 |

### Contexto

A rc2 atribuiu "L2" ao Intermediador. A atribuição parecia natural — o Intermediador governa o horizonte médio — e era exatamente o erro que a v0.2 pagou para banir: reaproximar o agente de ser a autoridade. Um agente L2 é um agente que admite; um agente que admite é uma LLM com credencial de escrita autoritativa, que é R1.

A correção não é cosmética porque muda o objeto da certificação. Havia uma escada só, e ela misturava dois papéis com naturezas opostas: um probabilístico que propõe, outro determinístico que decide.

### Decisão

> **A conformidade EAP certifica dois papéis distintos: L0–L1 certificam clientes (agentes); L2–L4 certificam hosts. Nenhum agente certifica como host.**

```
AGENTE  =  cliente cognitivo do EAP     (propõe, delibera, concretiza, recomenda)
HOST    =  componente que hospeda o     (gate, células, admissão, verificação,
           protocolo em um horizonte     propagação — determinístico)
```

| Nível | Certifica | Implementa | Estado no repo |
|---|---|---|---|
| **L0** | cliente leitor | query, `history/since`, resources; entende recusas; nunca trata resposta de um horizonte como autoritativa fora dele | **[B]** — qualquer cliente MCP genérico |
| **L1** | cliente propositor | staging, ciclo de changeset, `PROPOSE`/`DELIBERATE`; recusa como resultado de primeira classe; `based_on_seq` sempre | **[B]** — fluxo completo exercitado (F1–F8) |
| **L2** | **host** admissor | gate, células, escada, posse α/β, drift, `ADMIT`/`VERIFY`; cego ao chamador; offline | **[B]** — o servidor de referência |
| **L3** | **host** recursivo | horizontes com perfis, topologia declarada, `PROMOTE`/`CONTEST`, contratos da Parte III, statechart | **[E]** — gradua com VS-1 |
| **L4** | **host** federado | manifesto assinado, torres estrangeiras, semver de intenção, `RECALL` federado por importação | **[C]** — mecanismo vendorado, ativação 1.x |

A consequência normativa, escrita sem eufemismo:

> **Nenhum agente é L2. Nunca.** O Maître, o Guardião, o Intermediador e os Técnicos são clientes L0/L1 dos hosts dos horizontes em que operam. O Intermediador **governa cognitivamente** a transformação — decompõe, avalia, recomenda; o **Medium Horizon Host** governa epistemicamente o estado — admite, recusa, propaga.

E a assimetria que torna a adoção plausível: **a maioria absoluta do ecossistema só precisa de L0–L1.** Um flavor que sabe propor bem e ler recusas honestamente já participa de tudo que importa; hospedar horizontes é papel de infraestrutura — o análogo de "todo site fala HTTP; pouquíssimos implementam um servidor HTTP".

### Alternativas rejeitadas

**(a) Escada única, com agentes elegíveis a L2** (rc2). Perdeu porque certifica como admissor um componente probabilístico — R1 com selo de conformidade. A escada única não é apenas imprecisa: ela cria um caminho institucional para a regressão que o sistema inteiro existe para impedir.

**(b) Certificar apenas hosts, sem níveis de cliente.** Perdeu porque a maioria do ecossistema é cliente, e sem L0–L1 não haveria caminho de adoção nem insumo para H12: a conformidade seria uma exigência dirigida a quem não precisa dela.

**(c) Certificação por autodeclaração do flavor.** Perdeu pela lição do alpha v0, elevada a método: **autorrelato não conta, nunca.** Todo item do Apêndice D é verificável por log do host.

### Consequências

**Custa.** Duas trilhas de certificação, dois conjuntos de itens, e a manutenção de um checklist executável. Um flavor que quiser "governar" um horizonte descobrirá que a conformidade não oferece esse degrau.

**Habilita.** Adoção barata na borda; e a lista de vereditos da v0.4 — `Guardião ≠ autoridade`, `Intermediador ≠ autoridade`, `Técnico ≠ autoridade`, `Maître ≠ autoridade` — deixa de ser uma afirmação de intenção e ganha forma de conformidade verificável.

**Desconfortável.** Um agente arbitrariamente capaz permanece L1. Capacidade não compra nível, do mesmo modo que não compra promoção — é a ortogonalidade entre capacidade e autoridade aplicada à própria certificação.

### Reversibilidade

**Baixa.** Depois que flavors certificarem e a certificação for citada, alterar o significado dos níveis invalida certificações emitidas e quebra a comparabilidade de *Conformance Pass Rate*. Adicionar itens a um nível é barato; mover a fronteira cliente/host não é.

### Verificação

**[G2]**: checklist do Apêndice D com **três flavors distintos** passando L0–L1 contra a referência, item a item **por log do host**. Hipótese **H12**, falsificada se a aprovação exigir adaptação server-side por flavor — caso em que a tese de protocolo rebaixa a tese de produto, com registro. Ameaças **T1** (prompt injection no Guardião — defendida por o Guardião não possuir verbo de escrita autoritativa), **T3** e **T13**. Métrica: *Conformance Pass Rate por flavor*. **L3** gradua com a VS-1; **L4** permanece [C] e não finge graduar.

### Notas de implementação

`packages/mcp-server` é o host L2 já pago: gate cego ao chamador (`src/gates.ts`), células com forma canônica (`src/cell.ts`), posse e drift (`packages/graph-core/src/authority.ts`), verificação offline. `packages/mcp-server/src/agent-registry.ts` precisa do campo de nível de conformidade por flavor (§5.5), validado por `src/doctor.ts` — hoje o `AgentFlavorDef` declara transporte, instalação, tier de camada viva e regras, mas não conformidade. `packages/client` e `packages/stdio-proxy` são as superfícies onde as obrigações L0/L1 se verificam. Nenhum host L3 existe.

---

## ADR-0008 — Topologia de horizontes como DAG de fronteiras de promoção

| | |
|---|---|
| **Status** | Proposta [E] — pendente de VS-1a |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §6 (bloco D-4) |
| **Marca** | [E] |
| **Relaciona** | ADR-0002, ADR-0006, ADR-0009 |

### Contexto

A fraqueza W13 é a condição de possibilidade de todas as outras da Parte III: **"não pode saltar o pai" não significa nada até que se declare quem é pai de quem** — e a v0.4 nunca declarou. Onde havia declaração, havia intuição: uma cadeia linear por duração, `sessão → negociação → transformação → microtask`.

A intuição está **errada em dois pontos**, e ambos importam. Primeiro: a sessão **não** é pai de promoção da negociação — ela é o horizonte de continuidade do Maître, e pode existir uma sessão inteira sem mutação alguma. Segundo: a microtask promove **para cima**, para a transformação que a instanciou — a cadeia por duração inverte a direção justamente na aresta mais movimentada do sistema.

### Decisão

> **Toda promoção atravessa exatamente uma fronteira do DAG normativo declarado, em que `parent` significa exatamente *fronteira de promoção* — nunca "dura mais" e nunca "contém".**

```
                sessão
                  │  inicia (não é fronteira de promoção:
                  ▼  nada da sessão atravessa por aqui — ADR-0009)
             negociação
                  │  PROMOTE: hipótese aceita → contrato
                  ▼
             transformação
               ▲  ▲  ▲   PROMOTE: PromotionProposal
             micro micro micro
                  │  PROMOTE: PersistentDelta
                  ▼
             persistente
```

| Horizonte | Fronteira de promoção (pai topológico) | O que atravessa |
|---|---|---|
| sessão | **∅** — continuidade não é promoção | nada; a sessão *inicia* negociações, não promove conteúdo |
| negociação | transformação | `AcceptedPredictiveHypothesis` via `ChangeContract` |
| microtask | transformação (a que a instanciou) | `PromotionProposal` |
| transformação | persistente | `PersistentDelta` |
| persistente | ∅ — é o topo; só o recall o corrige | — |

Três consequências normativas: `HORIZON_SKIP` ganha definição precisa — recusa quando `target_horizon` não é o pai **na topologia declarada**, não "um nível acima numa fila imaginária"; `CONTEST` viaja por **qualquer** aresta do DAG, em qualquer direção, porque desafiar não exige fronteira de promoção, exige evidência; e a topologia é **declarada pelo host L3 e verificável pelo checklist** — implementações podem estender o DAG com horizontes especializados, nunca torcê-lo silenciosamente.

### Alternativas rejeitadas

**(a) Cadeia linear por duração.** Perdeu por ser **falsa** no caso da sessão e **ambígua** entre negociação e microtask: duas arestas diferentes chegariam à transformação com o mesmo nome e semânticas distintas.

**(b) Salto com "endosso" do horizonte intermediário.** Perdeu porque é autoridade por assinatura — R1 com passos extras. Se um endosso pode substituir um ciclo, o ciclo é decorativo.

**(c) Promoção direta com auditoria posterior.** Perdeu porque **auditoria posterior de contaminação é limpeza, não prevenção**: o custo de descobrir depois é exatamente o custo que a arquitetura inteira existe para não pagar.

### Consequências

**Custa.** Latência estrutural: uma descoberta de microtask relevante ao persistente atravessa **dois gates**. A via rápida legítima para urgência é `CONTEST`, que não exige promoção — a dúvida viaja mais leve que a afirmação.

**Habilita.** Torna mecânica a alegação central *autoridade no filho não é autoridade no pai*: com pai declarado, `HORIZON_SKIP` é computável e T8 é testável. Habilita também a extensão do DAG por declaração, sem alterar o protocolo.

**Desconfortável.** Os critérios de uma extensão legítima do DAG **não estão escritos** — §35 registra isso como questão aberta. A topologia é declarável e verificável; o que torna uma declaração *boa* permanece [A].

### Reversibilidade

**Assimétrica, e é o ponto.** Estender o DAG é barato e previsto. Permitir salto é afrouxamento de contrato — **baixa reversibilidade**: uma vez que promoções saltadas existam no histórico, a garantia "todo conteúdo do persistente atravessou N fronteiras" deixa de valer retroativamente e não há como reconstruí-la.

### Verificação

**[G3]**, item (a): alvo fora do DAG produz `HORIZON_SKIP` **por log**. Ameaça **T8** (microtask propõe direto ao persistente). **VS-1a** testa a topologia com os demais contratos, sem LLM. Checklist **L3**: "topologia declarada como DAG". Hipótese **H1**, com *Cross-Horizon Leakage* — e o desfecho pré-registrado vale aqui integralmente: leakage zero obtido por disciplina de prompt, e não por mecanismo, revoga a recursividade como mecanismo.

### Notas de implementação

Nada no HEAD declara topologia de horizontes, porque nenhum horizonte além do persistente existe. **Cuidado de nomenclatura, registrado para evitar um F1 de vocabulário:** `packages/graph-core/src/cell-dag.ts` é o DAG de **células** do horizonte persistente — outra estrutura, outro propósito; a topologia de horizontes não deve reusar esse nome nem esse módulo. A declaração da topologia é responsabilidade de host L3, inexistente.

---

## ADR-0009 — `INITIATE`/`NegotiationSeed`: iniciar carrega contexto, nunca autoridade

| | |
|---|---|
| **Status** | Proposta [E] — pendente de VS-1a (contrato) e VS-1c (fluxo) |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §6.1, Apêndice C |
| **Marca** | [E] |
| **Relaciona** | ADR-0002, ADR-0006, ADR-0008 |

### Contexto

A aresta `sessão —inicia→ negociação` da topologia (ADR-0008) estava **correta e incompleta**: correta porque continuidade não é promoção; incompleta porque **alguma coisa precisa atravessar**. O cenário concreto do paper mostra por quê. Operador e Maître discutem gateways de pagamento por vinte minutos; na sessão já existem a preferência pelo Stripe, as razões que descartaram a alternativa, a constraint de recorrência, a decisão de não armazenar cartão. O operador diz: *"então vamos implementar."*

A negociação não pode nascer amnésica — seria absurdo operacionalmente. E também não pode nascer por **cópia de memória da sessão**: isso seria exatamente o canal inter-horizonte não governado que R6 proíbe, e a v0.4 §4.3 já havia enunciado que promoção é mudança de horizonte, não cópia de memória. A lacuna era um contrato de iniciação — uma das cinco ambiguidades de segunda ordem fechadas na rc4.

### Decisão

> **`INITIATE` registra um seed no horizonte novo. Tudo que o seed carrega entra como `proposed`, com proveniência. Referências e contexto atravessam; autoridade não atravessa nunca.**

```
NegotiationSeed {
  intent                // a intenção declarada que abre a negociação
  session_refs[]        // referências ao OpenGraph de sessão — ponteiros, não cópia
  operator_decisions[]  // decisões já explicitadas na sessão, com proveniência
  based_on_seq
}
```

A preferência pelo Stripe chega à negociação **como contexto proposto com proveniência, não como fato**. A negociação delibera a partir dele; nada herda autoridade por ter sido dito na sessão. Seed sem referências ou proveniência: `PROVENANCE_MISSING`.

E a generalização que fecha o desenho — **`INITIATE` já existia disfarçado**:

```
negociação → transformação   :  ChangeContract    (iniciação, já contratada)
transformação → microtask    :  WorkOrder         (iniciação, já contratada)
sessão → negociação          :  NegotiationSeed   (a que faltava)
```

Com isso, **toda aresta do DAG passa a ter contrato tipado**, e os três tipos ficam distinguíveis por aquilo que carregam: iniciação carrega contexto sem autoridade; promoção carrega autoridade destilada sob nova admissão; contestação carrega evidência.

### Alternativas rejeitadas

**(a) Cópia de memória da sessão para a negociação.** Perdeu por R6: memória cognitiva atravessando horizontes por canal não governado é estado invisível influenciando promoção sem proveniência. É também a forma mais confortável de lavanderia de autoridade, porque parece apenas conveniência.

**(b) Negociação amnésica — nada atravessa.** Perdeu porque força o operador a reafirmar tudo, e a reafirmação chega sem a proveniência que a sessão tinha: o sistema perderia justamente o registro de *por que* a alternativa foi descartada.

**(c) Herdar autoridade do que foi dito na sessão** ("o operador já decidiu Stripe, logo é fato na negociação"). Perdeu por ser promoção implícita — R5 — e por confundir soberania intencional com admissão: o operador decide a intenção; a negociação delibera o conteúdo.

### Consequências

**Custa.** Para poder semear, a sessão precisa registrar suas decisões com proveniência — o que só é possível se o horizonte de sessão for de fato um OpenGraph governado (W1). O seed também obriga referências resolvíveis: ponteiros que apontam para um grafo destruído são um problema real que este ADR não resolve.

**Habilita.** Toda aresta do DAG com contrato tipado, o que é pré-requisito para a conformidade L3 verificar atravessamentos em vez de confiar em convenção; e uma negociação que nasce com contexto sem nascer com conclusões.

**Desconfortável.** A preferência do próprio operador chega à negociação como `proposed` — ou seja, a negociação pode reabrir algo que o operador considera decidido. Não é atrito de UX mal desenhado: é a distinção entre soberania sobre a intenção e admissão do conteúdo (ADR-0017 trata o primeiro lado).

### Reversibilidade

**Assimétrica.** O schema do `NegotiationSeed` é alta — campos adicionais não quebram a forma. A regra "tudo entra como `proposed`" é **baixa**: relaxá-la é R5, e uma vez que conteúdo de sessão tenha entrado como admitido, não há como reconstruir quais admissões da negociação foram herdadas.

### Verificação

Apêndice C fixa o destino: `INITIATE`/`NegotiationSeed` → **[B] via VS-1c** — contexto atravessa com proveniência, autoridade não. **VS-1a** valida o contrato em isolamento, junto com os demais. Recusa observável: `PROVENANCE_MISSING` por log, em seed sem referências ou proveniência. Nota honesta de cobertura: **o catálogo T1–T14 não enumera um ataque específico à iniciação**; os vizinhos são T2 (carona de claims em artefato) e T6 (lavanderia de assumptions), ambos sobre promoção, não sobre seed. O ADR registra a lacuna sem preenchê-la.

### Notas de implementação

Não existe horizonte de sessão como OpenGraph no HEAD. O que existe é escopo de turno e sessão de transporte — `packages/mcp-server/src/tools/session.ts`, `src/affinity.ts`, `src/state.ts` — que governa concorrência e roteamento, não memória epistêmica; tratar essa sessão como o "OpenGraph de sessão" seria o mesmo erro de duas semânticas sob um nome que ADR-0004 previne. `WorkOrder` e `ChangeContract` existem apenas como esquemas no Apêndice A da v0.4.

---

## ADR-0010 — `STALE_BASE` bifurcado: defasagem operacional é aprovável, frescor epistemológico não

| | |
|---|---|
| **Status** | Aceita [E], substitui formulação anterior — endurecimento da regra 3 na rc4 |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §7 regra 3, §5.2, §13(b), §14, §10.1 |
| **Marca** | [E] |
| **Relaciona** | ADR-0006, ADR-0008, ADR-0017 |

### Contexto

`based_on_seq` vem de R3 — *interpretação baseada em estado não versionado reintroduz uma cópia stale da verdade* — e é o mecanismo mais barato e mais reusado do sistema: o mesmo `seq` monotônico serve a `STALE_BASE`, ao recall e à invalidação de sessão.

A tensão que a rc4 precisou resolver estava entre duas passagens legítimas. A §13(b) permite que `CHANGE_READY` transite com defasagem de `seq` **aceita pelo operador**, porque exigir base perfeitamente corrente a cada avanço do persistente pararia o trabalho. A §7 regra 3 exige, para promover, base corrente. Sem bifurcação explícita, a leitura permissiva se instalaria sozinha: uma `OperatorApproval` de defasagem seria lida como autorização geral, e o sistema teria criado um caminho em que **aprovação converte defasagem em atualidade** — isto é, em que um clique fabrica evidência. É R7 entrando pela porta mais discreta que existe.

### Decisão

> **`STALE_BASE` tem tratamento distinto por verbo, e a distinção é normativa:**

```
PROPOSE      base defasada  ──►  AVISO
                                  (registra-se; a proposta não muda nada de autoridade)

CONCRETIZE   base defasada  ──►  APROVÁVEL sob risco declarado
                                  OperatorApproval com risks_assumed[], scope, ttl, based_on_seq
                                  autoriza continuar concretizando — e nada além

PROMOTE      base defasada  ──►  RECUSA, sem exceção
                                  exige rebase ou revalidação explícita
                                  não existe aprovação que a dispense
```

A formulação que fecha o argumento, e que este ADR adota como enunciado normativo:

> **Risco é decidível; atualidade não.** O que o operador pode aceitar é a defasagem *operacional* — continuar trabalhando sobre base antiga, sob risco declarado. O que ninguém pode aprovar é a **conversão de defasagem em frescor epistemológico**.

É a tese do root intencional (ADR-0017) aplicada a `seq`, e estende R3 ao atravessamento de fronteiras. No statechart, a consequência é `PROMOTING → WAITING_HUMAN` sob `STALE_BASE` — o operador escolhe entre transições permitidas, e nenhuma delas é "promover assim mesmo".

### Alternativas rejeitadas

**(a) `STALE_BASE` dispensável por aprovação do operador em qualquer verbo.** Perdeu porque é `EVIDENCE_REQUIRED` disfarçado: a aprovação passaria a atestar um fato — "esta base é atual" — que não se decide. Cai na coluna direita da §14, onde nenhuma espécie tem soberania, e é R7 explícito.

**(b) `STALE_BASE` bloqueante em todos os verbos, inclusive na concretização.** Perdeu porque revoga a assunção legítima de risco, que a §14 trata como insubstituível, e porque qualquer avanço de `seq` no persistente pararia transformações em curso — inclusive avanços irrelevantes ao escopo da mudança.

**(c) Tratamento uniforme por fronteira** (sempre aviso, ou sempre recusa). Perdeu porque os verbos diferem naquilo que alteram: `PROPOSE` não altera autoridade, `CONCRETIZE` altera o mundo mas não a verdade admitida, `PROMOTE` altera a verdade admitida. Uma política única trataria como equivalentes três consequências de naturezas distintas.

### Consequências

**Custa.** Transformações longas sobre um persistente que avança pagam rebase ou revalidação **no fim**, quando o custo já foi incorrido. O recall amplifica isso deliberadamente: **o recall avança o `seq`, e toda proposta em voo sobre o subgrafo fica `STALE_BASE` automaticamente, sem caso especial** (§10.1). Não há economia de mecanismo aqui, e o paper é explícito quanto a isso ser desejável: reusar `seq` é a garantia de que não existem duas noções de "atual".

**Habilita.** Fecha estruturalmente o caminho aprovação→atualidade; permite que a concorrência de promoção não precise de mecanismo novo (a regra 3 cobre, reusando `seq` e locks já pagos); e dá a T12 (cache stale como verdade) e T7 (replay de aprovação) uma defesa comum.

**Desconfortável.** Um operador pode aceitar um risco, ver o trabalho concluir, e ainda assim receber recusa na promoção. Do ponto de vista de UX parece incoerência; do ponto de vista da tese é a única coerência possível — ele aprovou continuar, não aprovou que o mundo tivesse parado.

### Reversibilidade

**Baixa.** Afrouxar a regra reabre a conversão risco→atualidade, e conteúdo promovido sob base defasada não é distinguível *a posteriori* de conteúdo promovido sobre base corrente sem reconstruir toda a linha do `seq`. Alta apenas para os *defaults* de `ttl` da aprovação (risco 24h, defasagem 1h, irreversível single-use), que a §14 declara configuração, não protocolo.

### Verificação

**[G3]**, item (d): defasagem produz `STALE_BASE` **por log**. Ameaças **T12** (responder de snapshot antigo como atual) e **T7** (replay de `OperatorApproval` — defendido por `scope` + `based_on_seq` + single-use). Hipóteses: **H10** indiretamente, porque a cascata do recall avança `seq` e o efeito em voo é parte do fechamento observável; **H11**, porque o custo de fricção desta regra é o tipo de coisa que o operador contorna — e contorno sistemático é falsificação do desenho, não indisciplina. Métricas: *Staleness of Interpretation*, *Approval Staleness Rate* e *Operator Scope Violation Rate*. **VS-1a** para a guarda em isolamento; **VS-1c** para o caso completo, com o operador adversarial roteirizado (T4).

### Notas de implementação

O `seq` monotônico por tenant é [B] e vive no substrato: `packages/mcp-server/src/store.ts` e `src/db.ts`, com commit atômico de changeset carregando `admitSeq`; `packages/graph-core/src/state-index.ts` e `events-snapshot.ts` participam da derivação de estado a partir do log. A validação de base defasada existe hoje apenas na fronteira do changeset do horizonte persistente — **a bifurcação por verbo, a `OperatorApproval` e o comportamento `PROMOTING → WAITING_HUMAN` são [E], sem código correspondente**. Nenhum objeto de aprovação escopada existe no repositório.
## ADR-0011 — Nenhum segundo gate: `PersistentDelta` é envelope, não bypass

| | |
|---|---|
| **Status** | Proposta [E] — pendente de VS-1 (VS-1c, [G4]) |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §8 (bloco D-5); §5.1 (pré/pós-condições de `PROMOTE`), §26, §35 |
| **Marca** | [E] — sobre mecanismo de gate [B] herdado da baseline |
| **Relaciona** | ADR-0010, ADR-0012, ADR-0013, ADR-0014 |

### Contexto

A fraqueza W2 da v0.4 é que a promoção entre horizontes era narrativa — "vira proposta" — e não mecanismo. A Parte III do paper converte cada aresta da topologia em contrato tipado, e a aresta `transformação → persistente` é o caso especial: o receptor não é um horizonte efêmero qualquer, é o OpenGraph governado da baseline, com posse α/β, prova de cobertura censitária, escada 0..5 e forma canônica de célula — tudo já pago com implementação e com duas cicatrizes (F1, F7).

Exatamente por isso, a tentação de desenho é forte e específica: como o conteúdo que chega já foi auditado pelo Intermediador e aceito no horizonte médio, parece econômico dar-lhe uma porta própria — um gate "de promoção" que reconheça a auditoria anterior e não repita o trabalho. Essa economia é a confiança transitiva que R5 proíbe, e é o vetor de duas ameaças catalogadas: T3 (o Intermediador carimba sem auditar) e T13 (colusão Intermediador + Técnico). Se existisse porta própria, a colusão inteira do horizonte médio alcançaria o persistente; com uma porta só, ela alcança o médio e para ali.

Há ainda o argumento de I5. Duas grafias da mesma célula produziram dois críticos. Dois gates para a mesma noção de admissão seriam a versão de nível superior do mesmo erro: duas semânticas de verdade sob um nome.

### Decisão

A promoção ao persistente atravessa **o gate existente**. `PersistentDelta` é um envelope de transporte e planejamento, nunca um caminho alternativo de admissão:

```
PersistentDelta = PromotionProposal + {
  changeset_plan[]      // células afetadas, na forma canônica única (I5)
  claims_candidate[]    // claims com âncora verbatim (I1) prontas para o gate
  coverage_delta        // o que muda na prova de cobertura das células de posse β (I2)
  rollback_semantics    // o que é compensável e o que exige intervenção
}
```

`claims_candidate[]` entra pelo mesmo gate que qualquer claim submetida por qualquer cliente. A origem auditada fica registrada em `provenance` e **não altera o mérito**: um `PersistentDelta` do Intermediador e a mesma claim submetida por um cliente hostil recebem veredito idêntico. A cegueira ao chamador da baseline deixa de ser propriedade de uma chamada e passa a ser propriedade da promoção inteira.

Concorrência não introduz mecanismo novo: `changeset_plan[]` adquire os locks por célula já pagos pela baseline; células disjuntas prosseguem em paralelo, interseção serializa; e `based_on_seq` cobre a defasagem pela regra 3 do atravessamento (§7).

### Alternativas rejeitadas

**(a) Gate dedicado de promoção.** Perde porque dois gates são duas semânticas de verdade. A lição de I5 é que duas representações da mesma coisa divergem, e divergem silenciosamente; a divergência entre "o que o gate normal exige" e "o que o gate de promoção exige" seria, por construção, o buraco por onde passa tudo que o gate normal recusaria.

**(b) Fast-path para deltas "pré-auditados".** Perde porque é a confiança transitiva que R5 proíbe enunciada como otimização. Autoridade relativa completa no filho compra o direito de propor; não compra dispensa de avaliação no pai. Aceitar o fast-path seria aceitar que a qualidade do julgamento probabilístico do Intermediador determina o que entra no persistente — a tese central negada em um parágrafo de performance.

### Consequências

**Ganho.** A superfície de ataque do horizonte médio fica contida: T3 e T13 alcançam no máximo o médio. A cegueira ao chamador vira propriedade verificável de ponta a ponta. E o custo de implementação é negativo — reusar o gate é menos código que escrever o segundo.

**Custo desconfortável, que este ADR registra sem atenuação.** O Intermediador **não pode prometer ao operador** que "aceito no médio" implica "entrará no longo". Do ponto de vista de produto isso parece um defeito de UX: o sistema aceita trabalho e depois o recusa. Não é defeito — é a tese funcionando. A admissão no médio é admissão *no escopo do médio*, e nada além; prometer o contrário seria vender autoridade que o horizonte não tem. A obrigação que nasce daí é da interface: "aceito no médio" e "admitido no persistente" precisam ser **materiais visualmente diferentes** (§26), porque a interface é onde o operador aprende a distinção sem ler o paper.

**Limite reconhecido.** Os locks por célula detectam **colisão sintática**, não **conflito semântico**. Duas transformações concorrentes cujo significado conflita sem tocar as mesmas células passam ambas. O paper registra isso como questão aberta [A] de primeira classe (§35), e é o problema declarado como o mais difícil do Runtime Plane. Este ADR não o resolve e não finge resolvê-lo.

### Reversibilidade

**Nenhuma.** Abrir um segundo caminho de admissão ao persistente é revogar a tese, não ajustar um parâmetro. Toda a Parte III depende de existir exatamente uma porta.

### Verificação

Critério [G4]: fluxo completo `ArtifactBundle aceito → PromotionProposal → PersistentDelta → changeset admitido` executado ao vivo na **VS-1c**, e o mesmo `claims_candidate[]` submetido sob identidade hostil recebendo veredito idêntico — **por log do host**, nunca por relato do agente. Ameaças cobertas: T2 (artefato com claims embutidas), T3, T13. Métricas: *Caller-Blindness*, *Persistent Contamination Rate* (primária). Hipótese associada: H3.

O que **não** é falsificável por este ADR: a ausência de conflito semântico entre transformações concorrentes. Nenhum teste aqui proposto o detecta, e isso é informação registrada, não lacuna escondida.

### Notas de implementação

O gate existe em `packages/mcp-server/src/gates.ts` (`incrementalGate`, `finalGate`, `blastRadius`), a forma canônica em `packages/mcp-server/src/cell.ts`, o ciclo de changeset em `packages/mcp-server/src/tools/changeset.ts` e a serialização por afinidade em `packages/mcp-server/src/affinity.ts`. Nenhum tipo `PersistentDelta` existe no repositório; sua introdução deve ser feita como estrutura de entrada que **desmonta** em chamadas ao gate atual — se a implementação precisar alterar `finalGate` para aceitar deltas promovidos, a alteração é o segundo gate nascendo disfarçado.

---

## ADR-0012 — Contestação por evento tipado com três severidades, nunca edição

| | |
|---|---|
| **Status** | Proposta [E] — pendente de VS-1 (VS-1a para as guardas, VS-1c para o fluxo) |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §9 (bloco D-6); Apêndice B (statechart), §5.1, §17 |
| **Marca** | [E] |
| **Relaciona** | ADR-0011, ADR-0013, ADR-0014, ADR-0017 |

### Contexto

A promoção resolve como conhecimento sobe. Falta o movimento oposto: o que acontece quando um horizonte descobre evidência que **derruba** algo já admitido em outro horizonte. Sem mecanismo, restam dois comportamentos, ambos patológicos. O primeiro é o agente do horizonte superior "corrigindo a realidade" — o Intermediador que recebe uma descoberta do Técnico e ajusta o grafo médio para acomodá-la. Isso é julgamento probabilístico decidindo significado sem que o desacordo fique registrado em lugar nenhum: a contradição desaparece e resta apenas o resultado da contradição. O segundo é a propagação automática para cima, em que qualquer Técnico com uma objeção viraria veto ambulante sobre o persistente.

A fraqueza atacada é W12 na sua metade descendente — a propagação de degradação entre claims derivadas era indefinida — e, transversalmente, a exigência de I6 de que recusa seja registrada como recusa. Um desacordo não registrado é uma recusa que falhou em silêncio.

### Decisão

Todo desafio a conteúdo admitido é um **evento tipado**, com evidência obrigatória e severidade declarada. Edição direta é proibida em qualquer horizonte (`DIRECT_EDIT_FORBIDDEN`).

```
Contestation {
  source_horizon        // onde a evidência apareceu
  target_ref            // nó/claim/hipótese contestada, em qualquer horizonte
  evidence[]            // âncoras verificáveis — contestar exige chão (EVIDENCE_REQUIRED)
  severity              // informativa | bloqueante | invalidante
}
```

Efeitos precisos por severidade, sobre o Workflow Orchestration Statechart (Apêndice B):

| Severidade | Efeito no alvo | Efeito no statechart |
|---|---|---|
| **informativa** | registrada no alvo como questão aberta | nenhuma transição forçada |
| **bloqueante** | o alvo não promove enquanto não resolver | `VERIFYING → WAITING_HUMAN` se o Intermediador não a absorver com nova WorkOrder dentro do contrato |
| **invalidante** | premissa falsa | reabre negociação no mínimo (`* → NEGOTIATING`, decidido pelo Router); contra o persistente, vira candidata a `RECALL` |

`CONTEST` viaja por **qualquer aresta do DAG de horizontes, em qualquer direção** — desafiar não exige fronteira de promoção; exige evidência. Quem decide a transição é o Router, sobre guardas determinísticas; o componente cognitivo registra o evento e nada mais.

### Alternativas rejeitadas

**(a) O Intermediador "corrige" o médio ao receber a descoberta.** Perde porque coloca o probabilístico decidindo significado sem registro do desacordo. O resultado observável seria um grafo coerente cuja coerência foi produzida por edição, e não por resolução — precisamente a contaminação silenciosa que a arquitetura existe para tornar impossível.

**(b) Propagação automática de contestações para cima.** Perde porque converte qualquer Técnico em veto ambulante sobre o persistente. Um desafio precisa atravessar decisão de Router e, contra o persistente, atravessar o gate como `RecallNotice` — caso contrário `CONTEST` seria a porta dos fundos que `PROMOTE` fecha pela frente, e a ameaça T9 (recall como arma de negação) valeria também para a contestação simples.

### Consequências

**Ganho.** Resolução de conflito auditável passo a passo: quem desafiou, com que evidência, em que severidade, e qual transição o Router decidiu. No exemplo operado da Parte VIII, a assumption derrubada por `WO-3` **não** foi silenciosamente corrigida — sua queda está registrada com autor e evidência, e é isso que permite reconstruir por que o contrato foi ampliado.

**Custo.** Mais eventos e mais estados visíveis. O sistema fica verborrágico onde um sistema convencional ficaria mudo, e parte desse ruído chega ao operador via `WAITING_HUMAN`.

**A assimetria, registrada como escolha deliberada.**

> Subir exige destilação e nova admissão; descer — desafiar — exige apenas evidência.

A dúvida viaja mais leve que a afirmação porque os custos de erro são assimétricos: o custo de uma dúvida falsa é atenção desperdiçada e algum retrabalho de verificação; o custo de uma afirmação falsa é contaminação do persistente, que se propaga por derivação e só se corrige por recall. Barateando a dúvida e encarecendo a afirmação, o sistema erra para o lado barato.

### Reversibilidade

**Média.** As três severidades e seus efeitos podem ser recalibrados (por exemplo, uma severidade nova entre informativa e bloqueante) sem quebrar a forma do contrato. O que não é reversível é a proibição de edição direta: relaxá-la é a regressão R8 pelo flanco da contestação.

### Verificação

**VS-1a** valida o schema `Contestation` e as guardas do statechart em isolamento, sem LLM — inclusive a recusa `EVIDENCE_REQUIRED` para contestação sem âncora e `DIRECT_EDIT_FORBIDDEN` para tentativa de escrita fora de changeset. **VS-1c** executa o fluxo com contestação bloqueante fora de contrato levando a `WAITING_HUMAN`, conforme o cenário da Parte VIII. Ameaças: T9 (contestação infundada), T1 (Guardião hostil sem verbo de escrita autoritativa). Métricas: *Refusal Fidelity*, *Refusal Taxonomy Coverage*.

Ponto não falsificável nesta faixa: se a severidade *escolhida* pelo emissor é a severidade *correta* é julgamento semântico, portanto probabilístico por natureza (§5.1) — o protocolo governa a consequência de cada severidade, nunca a acurácia da escolha.

### Notas de implementação

Nenhum evento de contestação existe no repositório; o audit log append-only (`packages/mcp-server/src/log.ts`) e a separação grafo/audit (I7) são o substrato onde ele nasce. O statechart do Router (Apêndice B) não tem implementação — é integralmente [E]. A recusa `DIRECT_EDIT_FORBIDDEN` precisa ser exigível na borda MCP inteira (`packages/mcp-server/src/tools/`), não apenas no caminho de changeset, sob pena de existir uma tool de escrita que a contorne.

---

## ADR-0013 — Recall: cascata calculada, garantia escopada ao grafo admitido, reabilitação célula a célula

| | |
|---|---|
| **Status** | Proposta [E] — pendente de VS-1 ([G5]: teste determinístico em VS-1a, recall ponta a ponta em VS-1c) |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §10, §10.1, §10.2 (bloco D-7); §35 (*derivation coverage*), §31, Apêndice A |
| **Marca** | [E] |
| **Relaciona** | ADR-0011, ADR-0012, ADR-0014, ADR-0015 |

### Contexto

A v0.4 deixou aberta a pergunta mais desconfortável do projeto (W11): *e se o persistente estiver errado?* Todo o edifício impede que inferência não verificada entre — e não dizia nada sobre a premissa que entrou legitimamente, atravessou o gate com âncora e cobertura, e depois foi desmentida pelo mundo. Um sistema epistemológico sem resposta para isso apenas mudou o lugar onde a contaminação se esconde: da entrada para a permanência.

A resposta padrão da computação — sobrescrever — é inaceitável aqui por dois motivos independentes. Primeiro, destrói o rastro: a pergunta "o que acreditávamos quando decidimos X?" deixa de ser respondível, e é justamente ela que explica por que X foi decidido e o que mais está contaminado pela mesma crença. Segundo, viola a regressão R8: corrigir por edição direta esconde a contaminação dentro da própria correção.

### Decisão

> Corrigir o persistente é uma promoção, não uma edição. O mecanismo é o **recall**: uma contestação invalidante que, admitida pelo gate, dispara uma cascata de suspensão calculada deterministicamente **sobre o grafo de derivação admitido** — com o histórico intacto.

```
RecallNotice {
  target_claims[]       // o que se afirma estar errado
  evidence[]            // por que — âncoras, contradição com fonte, prova externa
  discovered_at_seq     // quando o erro foi descoberto
  faulty_since_seq?     // desde quando a verdade estava errada, se determinável
}
```

Processamento mecânico:

```
RecallNotice admitido pelo gate      ◄── pode ser RECUSADO (RECALL_UNPROVEN)
      │
      ▼
fechamento = deps⁻¹(target_claims), transitivo, sobre o grafo ADMITIDO
      │
      ▼
degrada DUAS coordenadas, cada uma no seu tipo (ADR-0014, ADR-0015):
      claims:             status  admitted → contested
      células de posse β: posse   graph → suspended   (com cicatriz)
      │
      ▼
audit: evento + fechamento calculado + contagem; o seq avança
      │   ──► toda proposta em voo sobre o subgrafo fica STALE_BASE, sem caso especial
      ▼
reabilitação célula a célula pelo caminho normal (âncora, cobertura, roundtrip)
      REHAB_WITHOUT_PROOF caso contrário
```

Quatro propriedades, cada uma respondendo a um ataque:

1. **O histórico nunca é reescrito.** O JSONL append-only (I7) preserva a verdade errada *como tendo sido a verdade admitida* entre `faulty_since_seq` e o recall. Verdade é versionada; vergonha também.
2. **A cascata é calculada, não curada.** O grafo de derivação decide. Curadoria manual seria autoridade probabilística no ponto de maior tensão: quem errou escolhendo o que acreditar escolheria o que desacreditar.
3. **Recall atravessa o gate.** A evidência é verificada como a de qualquer claim; recusa com razões (I6, `RECALL_UNPROVEN`). Recall não é arma gratuita de negação (T9).
4. **Reabilitação não tem atalho e não é simétrica.** Suspender é em cascata; reabilitar é célula a célula com prova nova. Falso positivo custa re-verificar o que estava certo — horas. Falso negativo custa uma verdade falsa operante — a definição do fracasso do sistema.

Casos-limite decididos: **recall de recall** — um `RecallNotice` admitido é contestável com evidência nova, o que não desfaz a cascata: produz reabilitação com essa evidência como prova; não existe "unrecall", existe re-conquista. **Transformações em voo** — nenhum mecanismo especial: o recall avança o `seq` e `STALE_BASE` captura tudo. **`faulty_since_seq` desconhecido** — a janela de auditoria assume o pior caso, desde a admissão original: superestimar contaminação, nunca subestimar. **Recall federado** — a errata viaja no manifesto novo e a cascata local executa na importação, nunca por rede no gate (I9).

### Alternativas rejeitadas

**(a) Sobrescrita com changelog.** Perde porque destrói a auditabilidade da contaminação (R8): o changelog registra que houve mudança, não o que a crença antiga contaminou enquanto vigorava.

**(b) Cascata curada por humano ou por LLM.** Perde por ser julgamento probabilístico exatamente onde o incentivo de subdimensionar o estrago é máximo.

**(c) Reabilitação em lote.** Perde porque trataria autoridade como transacional quando ela é conquistada por célula; um lote reabilitado é um conjunto de células recuperando posse sem cada uma ter re-provado a sua.

**(d) Prometer completude sobre as dependências *reais*.** Perde por ser impossível de garantir e, portanto, desonesto de prometer. **Esta alternativa não é hipotética: era a formulação da rc2** ("zero falsos negativos no fechamento"), e a rc3 a corrigiu.

### Consequências

**Ganho.** Contaminação vira quantidade calculável, e não narrativa. O painel mostra a fratura, não um reset.

**Custo.** Recalls em subgrafos densos suspendem muito — e esse é o custo visível de ter deixado muita coisa depender de uma premissa. O sistema não esconde a concentração de risco; exibe-a no pior momento possível, que é o momento correto.

**A honestidade escopada, e o que ela cria.** A garantia é:

> **Recall Propagation Completeness = 100% sobre o grafo de derivação admitido.** Toda dependência *registrada* é alcançada, sem exceção. A derivação causal que nunca foi registrada não é alcançada — não por defeito do fechamento, mas por incompletude do registro.

Disso nascem duas coisas concretas. Primeira, uma questão aberta [A] de primeira classe, com nome próprio: **derivation coverage** (§35). A cobertura censitária (I2) prova cobertura de **nós** de uma célula; não prova cobertura das **arestas de derivação semântica** — são reivindicações diferentes, e confundi-las seria fabricar garantia. Segunda, uma métrica-termômetro: **Derivation Registration Ratio** (arestas de derivação registradas / derivações declaráveis na admissão), explicitamente *tendência, não alvo* — ela mede o **teto** do recall. O corolário prático: registrar `derivation` na proveniência deixa de ser burocracia e vira o limite físico do que o recall consegue corrigir. Um ecossistema que registra derivações preguiçosamente está escolhendo hoje o tamanho da sua contaminação incorrigível de amanhã.

### Reversibilidade

**Baixa.** Afrouxar a cascata — permitir exceções, curadoria ou reabilitação em lote — seria anistia retroativa de contaminação. O que permanece calibrável é a política de janela quando `faulty_since_seq` é desconhecido, e mesmo essa só no sentido conservador.

### Verificação

Critério [G5]: (i) teste **determinístico** de fechamento em grafo sintético — o conjunto suspenso exatamente igual ao esperado **sobre as arestas registradas** —, complementado por property-based testing com as regras da §11 como oráculo (monotonicidade, idempotência, diamante, aciclicidade); (ii) recall de ponta a ponta na **VS-1c**, incluindo `RECALL_UNPROVEN` e `REHAB_WITHOUT_PROOF` recusados **por log**. Hipótese: **H10**, existencial — falsificada por **um** falso negativo *sobre aresta registrada*; falsos positivos são tolerados por desenho. Ameaça: T9. Métricas: *Recall Propagation Completeness* (alvo 100%), *Recall-to-Rehabilitation Time*, *Derivation Registration Ratio*.

Não falsificável, e declarado como tal: a completude do grafo de derivação em si. Nenhum teste do escopo 1.0 mede quantas derivações reais deixaram de ser declaradas — só o termômetro, que compara com as *declaráveis*.

### Notas de implementação

A durabilidade append-only e o `seq` monotônico por tenant já existem (`packages/mcp-server/src/log.ts`, `store.ts`, `db.ts`) e são o substrato do "histórico intacto". A degradação de posse por drift já existe em `packages/graph-core/src/authority.ts` (`demoteGraded`: `structural → suspended`, `gone → source`) — o recall é o **segundo gatilho da mesma propagação**, não um caminho paralelo, e a implementação deve convergir para o mesmo ponto de degradação. `Provenance.derivation` não é hoje um campo obrigatório em nenhum caminho de admissão; torná-lo obrigatório é o pré-requisito silencioso deste ADR.

---

## ADR-0014 — Três coordenadas ortogonais de autoridade; propagação pela pior dependência

| | |
|---|---|
| **Status** | Aceita [E], substitui a formulação anterior (rc2) — mecanismo pendente de VS-1a |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §11 (bloco D-8); v0.4 §4 e §11.2; §0.1 item 2(b), §0.2 [G0] |
| **Marca** | [E] |
| **Relaciona** | ADR-0013, ADR-0015, ADR-0012, ADR-0011 |

### Contexto

Este ADR registra uma das duas correções mais importantes do documento, e a história da correção é parte do seu valor.

A rc2, ao tentar dar álgebra à autoridade, introduziu uma **escala total** — `none < proposto < admitido(α) < possuído(β)` — com composição por `min`. Parecia rigor: uma ordem, um operador, uma regra de propagação em uma linha. Era um **erro de tipo conceitual**, e a v0.4 já havia avisado nominalmente contra ele em dois pontos: *autoridade relativa não é β*, e α/β responde **quem possui a verdade da célula**, não **quanta verdade ela tem**.

```
α  =  source-authoritative   — a fonte mantém a posse da verdade
β  =  graph-authoritative    — o grafo conquistou a posse, por prova de cobertura
```

Uma célula α **não é "menos verdadeira"** que uma célula β. São regimes de posse diferentes. Ordená-los numa régua de confiabilidade mistura três dimensões que não se somam, e a mistura tem consequência operacional imediata: com `min` sobre a escala, uma claim derivada de duas fontes α "vale menos" que uma derivada de uma célula β — o que é uma afirmação sobre confiança, exatamente o gradiente probabilístico que a tese recusa. A regressão foi flagrada por [G0], que é o tripwire criado para este tipo de falha: **formalização que troca o formalizado**.

A fraqueza atacada é W12 — propagação de degradação entre claims derivadas indefinida — com a observação que a torna urgente: um gate perfeito com propagação indefinida verifica cada claim individualmente enquanto a *combinação* degradada passa incólume.

### Decisão

Três coordenadas **ortogonais**. Um mesmo elemento tem posição nas três; nenhuma se converte na outra.

```
STATUS EPISTÊMICO        proposed · admitted · contested · superseded · revoked
   trajetória de qualquer claim, em qualquer horizonte

POSSE DA VERDADE         source (α) · graph (β) · suspended
   exclusiva das células do persistente; responde QUEM possui, não QUANTO vale
   conquista-se por prova (cobertura ⇒ β); degrada por drift ou recall

AUTORIDADE RELATIVA      incompleta · completa
   o horizonte completou seu ciclo de seis estados?
   completa habilita o que a tabela do horizonte lista — e PROMOTE
```

Sobre essas coordenadas, **três regras de propagação — nenhuma delas um `min` sobre α/β**:

```
(1) DEGRADAÇÃO
    se dep(c) degrada — status contested/revoked na claim, ou posse suspended
    na célula que a sustenta — c não permanece admitted: a degradação
    propaga por deps⁻¹. É o fechamento que o recall calcula e o mesmo
    gatilho que o drift (I3) já dispara: recall e drift são dois gatilhos
    da mesma propagação.

(2) ATRAVESSAMENTO
    PROMOTE(completa no filho) = proposed no pai — sempre, sem exceção.
    Autoridade relativa NUNCA atravessa como autoridade.

(3) FEDERAÇÃO
    ref estrangeira entra com o status e a posse do manifesto, congelados
    no seq de importação. Quebra de ref ⇒ regra (1) local. Conhecimento
    estrangeiro nunca ganha localmente o que não possui na origem.
```

E o teorema informal central, agora enunciável **por coordenada**:

> Nenhuma coordenada melhora por composição, endosso, aprovação ou importação. Status só melhora por `VERIFY` com evidência nova; posse só vai a β por prova de cobertura; autoridade relativa só se completa completando o ciclo. Derivar, promover, importar e aprovar **conservam ou degradam** — sempre.

### Alternativas rejeitadas

**(a) A escala total da rc2 com composição por `min`.** Perde por erro de tipo: colapsa posse em quantidade e contradiz a v0.4 explicitamente. É a formulação que este ADR substitui, e [G0] é o critério que a recusa.

**(b) Média ponderada, voto ou peso de evidência.** Perde por reintroduzir scores probabilísticos pela porta dos fundos. É a alternativa mais sedutora, porque parece resolver o caso do diamante de forma "justa".

**(c) Política por domínio ("aqui 2-de-3 basta").** Perde porque cada política local é uma semântica de verdade local, e o protocolo existe precisamente para haver uma só.

**(d) Endosso por reputação.** Perde porque autoridade não acumula por histórico de acertos: um agente com mil acertos submete a claim mil e uma ao mesmo gate cego.

### Consequências

**Ganho.** A lavanderia de autoridade fica estruturalmente ausente, e não apenas desencorajada: não existe caminho em que uma coordenada melhore sem sua prova própria. Além disso, cada coordenada ganha seu próprio vocabulário de degradação, o que torna logs legíveis — a cascata do recall degrada duas coordenadas com **dois nomes** (ADR-0015).

**Custo.** O sistema é deliberadamente conservador. Uma dependência degradada rebaixa conclusões inteiras, e o custo aparece como re-prova — trabalho real, repetido, em cima de coisas que possivelmente estavam certas.

**O caso do diamante, explicitado.** `c` depende de `a` (suspensa) e de `b` (admitted): **`c` degrada**. O caminho saudável não salva, porque a regra 1 propaga pela **pior** dependência. Qualquer alternativa — voto, média, peso — reintroduziria o gradiente probabilístico.

**Propriedades verificáveis** que a decisão obriga: **conservação por coordenada** (nenhuma operação eleva); **monotonicidade** (ampliar os alvos de um recall só amplia o fechamento); **idempotência** (aplicar a propagação duas vezes = uma); **aciclicidade do grafo de derivação** — o fechamento só é computável sem ciclos, e a v1.0 estende I4: ciclo de derivação é recusado na admissão (`LADDER_VIOLATION` generalizada), porque duas claims que se sustentam mutuamente não são duas evidências, são uma petição de princípio com dois nomes.

### Reversibilidade

**Nenhuma dentro da tese.** Recompor as três coordenadas numa régua única é repetir a regressão que este ADR corrige, e [G0] a rejeita por construção.

### Verificação

**VS-1a**, property-based, com as três regras como **oráculo**: conservação por coordenada, monotonicidade, idempotência, diamante e aciclicidade. O teste adversarial é existencial e o paper o formula como tal: se existir *qualquer* caminho em que uma coordenada melhora sem sua prova própria, a arquitetura falhou por construção. Hipóteses: **H3** (existencial), **H10** (o fechamento é a regra 1 instanciada). Ameaças: T10 (manifesto federado que infla a própria autoridade), T5, T6. Critério de conformidade: item L3 do Apêndice D — "propriedades de propagação da §11 verificáveis".

### Notas de implementação

A coordenada de posse já existe, tipada, em `packages/graph-core/src/authority.ts` (`type Authority = "source" | "graph" | "suspended"`), com a demoção graduada de I3 implementada em `demoteGraded`. A coordenada de status existe apenas de forma parcial e com outro vocabulário em `packages/graph-core/src/claim-store.ts` (`status?: "pending-verification" | "verified" | "contradicts-floor" | "test-spec"`) — a reconciliação desse campo com `proposed · admitted · contested · superseded · revoked` é trabalho de migração, não de desenho, e o Apêndice A do paper fixa o mapeamento normativo. A coordenada de autoridade relativa não tem representação alguma no repositório: não existem horizontes. O grafo de derivação (`Provenance.derivation`) tampouco — e sem ele nem a regra 1 nem o recall são computáveis.

---

## ADR-0015 — `suspended` é posse, e só posse

| | |
|---|---|
| **Status** | Aceita [E], substitui formulação anterior (rc3) — vocabulário verificado pendente de VS-1a |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §11 (bloco D-16); §10.1, §26, Apêndice A, Apêndice C |
| **Marca** | [B] no comportamento herdado da baseline · [E] na tipagem única |
| **Relaciona** | ADR-0014, ADR-0013 |

### Contexto

Esta é uma ambiguidade **herdada da própria baseline**, que permaneceu invisível enquanto as três coordenadas estavam misturadas e só ficou exposta quando a rc3 as separou (ADR-0014). A baseline sempre tratou `α / β / suspended` como o gradiente da célula, e o comportamento pago pelo tripwire de drift confirma a leitura: `structural drift → suspended` e `gone → source` são transições de **posse**. Mas a rc3, ao enumerar os estados de status de claim, listou `suspended` também ali — criando duas semânticas sob a mesma palavra.

O paper classifica isso pelo que é: **um F1 em potencial**. F1 foi o crítico pago por duas grafias da mesma célula; a mesma palavra com dois tipos é o mesmo defeito uma camada acima. A correção pertence à classe de ambiguidades de segunda ordem que a rc4 fecha — as que só aparecem quando a arquitetura fica formal o suficiente para ser implementada.

### Decisão

> **`suspended` é um valor de POSSE, e só de posse.** Uma palavra, um tipo.

À pergunta que decide a questão — *"quando uma célula está suspensa, quem possui a verdade?"* — a resposta normativa é:

> **Ninguém, plenamente.** O grafo perdeu a prova que sustentava β, e a fonte **não reassume automaticamente**: a célula fica sem possuidor pleno, com cicatriz, até re-prova (⇒ β) ou demoção explícita (⇒ `source`, o caminho que `gone` já executa).

Claims degradadas usam `contested` ou `revoked` no **status** — nunca `suspended`. `suspended` não aparece no vocabulário de status do Apêndice A **por definição**, não por omissão.

### Alternativas rejeitadas

**(a) `suspended` nas duas dimensões** (o estado herdado pela rc3). Perde porque é a receita exata de F1: duas representações da mesma palavra com semânticas diferentes, que divergem em silêncio até que um log, uma tela ou uma consulta trate uma pela outra.

**(b) `suspended` como status de claim e um nome novo — "broken" ou equivalente — para a célula.** Perde porque inventa vocabulário para a semântica que a baseline **já pagou sob o nome existente**: I3 usa `suspended` para células desde o tripwire, e há logs, testes e código com essa grafia. Renomear o lado provado para acomodar o lado não implementado inverte o ônus.

### Consequências

**Ganho.** O vocabulário fica decidível por inspeção: se a palavra aparece, o objeto é uma célula do persistente. Isso torna verificável por log uma propriedade que de outro modo seria estilo.

**Consequência operacional, com dois efeitos precisos.** Primeiro: a cascata do recall **degrada duas coordenadas com dois nomes** — `admitted → contested` no status das claims e `graph → suspended` na posse das células de posse β. Uma implementação que use uma palavra só para ambas está errada, mesmo que o comportamento pareça correto. Segundo: **logs e interfaces jamais exibem `suspended` para uma claim** — violação disso é bug de conformidade, não preferência de nomenclatura.

**Consequência de interface.** A renderização precisa distinguir as coordenadas (§26): posse não é degradê de confiança, é regime; status é trajetória. Desenhá-las numa régua visual única seria a versão pictórica do erro corrigido em ADR-0014. E a cicatriz de uma célula reabilitada é **história, não estado transitório** — permanece após a re-prova, como osso soldado em radiografia.

### Reversibilidade

**Baixa depois que logs e clientes dependerem do vocabulário.** Antes disso é uma renomeação; depois, quebra consumidores e invalida a leitura retroativa do audit — o que, num sistema cuja tese é que o histórico é interpretável, custa mais do que uma migração de schema.

### Verificação

**VS-1a**: as guardas de tipo do contrato — nenhuma claim aceita `suspended` como status, nenhuma célula aceita `contested` como posse. **Verificação por log**, e apenas por log: varredura do audit e das respostas do host procurando `suspended` associado a objeto de tipo claim; qualquer ocorrência é falha. O Apêndice C do paper fixa o destino: *tipagem única de `suspended` (posse)* precisa migrar para **[B]** com "vocabulário verificado em logs e telas". Item de conformidade L2/L3 do Apêndice D.

### Notas de implementação

O lado provado está em `packages/graph-core/src/authority.ts` — `type Authority = "source" | "graph" | "suspended"`, com `demoteGraded` produzindo `suspended` para drift `structural` e `source` para `gone`, e o fast-path de reconciliação `suspended → graph`. Esse tipo é a forma normativa e **não deve ser tocado**. O trabalho recai sobre o lado de claims (`packages/graph-core/src/claim-store.ts`) e sobre a camada de apresentação (`packages/mcp-web/src/state-legend.tsx`, `cells.ts`), que precisam de vocabulários explicitamente distintos e de uma legenda que não os aproxime visualmente.

---

## ADR-0016 — `CHANGE_READY` por predicado triplo; LLM recomenda, Router transita

| | |
|---|---|
| **Status** | Proposta [E] — pendente de VS-1 ([G6], VS-1a) |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §13 (bloco D-9); §5.1 (fronteira determinístico/probabilístico), Apêndice B |
| **Marca** | [E] |
| **Relaciona** | ADR-0017, ADR-0012, ADR-0011 |

### Contexto

A fraqueza W3 da v0.4 é direta: `CHANGE_READY` existia como estado sem condição determinística de entrada. Na prática isso significa que a transição mais consequente do fluxo — a que autoriza instanciar o horizonte de transformação, gastar budget e produzir efeito no mundo — dependia do julgamento de um agente sobre estar ou não pronto. É a Lei 5 sendo violada no ponto de maior custo: o modelo decidindo fluxo, não conteúdo.

A formulação corrigida da fronteira (§5.1) dá a granularidade que faltava: julgamento semântico pode ser probabilístico em qualquer verbo cujo conteúdo o exija; **transição de autoridade é governada deterministicamente, sem exceção**. `CHANGE_READY` é transição, portanto é do segundo tipo.

### Decisão

A transição `NEGOTIATING → CHANGE_READY` exige uma `AcceptedPredictiveHypothesis` satisfazendo **três predicados mecânicos**:

> **(a)** `unresolved[]` vazio, **ou** cada residual aceito pelo operador como risco assumido, com `OperatorApproval` registrada;
> **(b)** `based_on_seq` corrente, **ou** defasagem aceita com registro — o aceite autoriza **iniciar e concretizar** sob risco; a promoção final ao persistente continua exigindo rebase;
> **(c)** toda `assumption` com **dono** e **consequência declarada**.

A divisão de papéis é normativa: **o Guardião *recomenda* prontidão; o Router *verifica* os predicados.** Estrutura, não julgamento. O Guardião é cliente L0/L1 e não possui verbo capaz de transitar o workflow.

### Alternativas rejeitadas

**(a) O Guardião declara prontidão.** Perde por definição: é o componente cognitivo transformando sua própria avaliação em transição de autoridade — a regressão que a Lei 5 e o teste de substituição adversarial existem para impedir. Um Guardião hostil declararia prontidão sempre.

**(b) Um segundo modelo "juiz".** Perde porque coloca *Agent-as-a-Judge* exatamente no ponto onde julgamento viraria transição de autoridade. Dois modelos concordando não são uma prova; são dois palpites correlacionados.

**(c) Sempre exigir aprovação do operador.** Perde por um argumento empírico, não teórico: aprovação universal vira aprovação automática na prática. Fadiga é o contorno mais barato que existe (T14), e um desenho que produz fadiga estrutural está desenhando o próprio contorno.

### Consequências

**Ganho.** A prontidão passa a ser verificável, recusável e auditável, com recusa registrada como recusa (I6).

**Custo, e a decisão de aceitá-lo.** O predicado deliberadamente **não captura se a hipótese é *boa***. Uma hipótese ruim com todas as questões honestamente fechadas — sem `unresolved[]`, com `based_on_seq` corrente, com assumptions donas e consequências declaradas — **passa, e deve passar**. Isso parece um defeito e é uma escolha: o lugar de pagar por hipótese ruim é a concretização e a verificação, onde o custo é evidência real; não um juiz probabilístico na transição, onde o custo seria autoridade fabricada. O sistema pode, portanto, iniciar transformações tecnicamente prontas e substancialmente ruins — e o loop de auditoria (`AuditAssessment`/`AuditDecision`) e a contestação (ADR-0012) existem para pagá-las barato.

**Efeito colateral positivo.** O predicado (c) mata a erosão silenciosa de inferência: nenhum `INFERRED` atravessa para `resolved[]` sem virar assumption com dono.

### Reversibilidade

**Alta.** Predicados adicionais não quebram a forma da decisão — a estrutura é "conjunção de predicados mecânicos verificados pelo Router", e ampliá-la é aditivo. O que não é reversível é a inversão dos papéis: devolver a decisão de transição ao componente cognitivo.

### Verificação

Critério [G6]: **Guardião adversarial** declara prontidão com `unresolved[]` não vazio → **o Router recusa, por log**; hipótese conforme transita; os três predicados testados **independentemente**, um a um. Fase: **VS-1a** (guardas do statechart sem LLM), reexercitado em **VS-1c** com operador real. Hipótese: **H6** — falsificada se qualquer transição com `unresolved[]` não vazio e sem `OperatorApproval` for aceita. Ameaça: T1. Métricas: recusas do Router a prontidão indevida; *Assumption-to-Action Rate*.

### Notas de implementação

Não há Router, statechart nem contrato de hipótese no repositório — este ADR é integralmente [E]. A verificação do predicado (b) reusa o `seq` monotônico por tenant já existente (`packages/mcp-server/src/store.ts`, `db.ts`), que é a mesma fonte de `STALE_BASE`; reusar um único conceito de "atual" é requisito, não conveniência.

---

## ADR-0017 — Operador é root intencional, não root epistemológico

| | |
|---|---|
| **Status** | Proposta [E] — pendente de VS-1 (VS-1c, ataques T4 e T7) |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §14 (bloco D-10); §4 (a inversão do humano), §15, §32, Lei 11 |
| **Marca** | [E] |
| **Relaciona** | ADR-0010, ADR-0016, ADR-0018, ADR-0013 |

### Contexto

O edifício inteiro carregava um pressuposto não examinado: o operador humano como raiz incontestável de confiança — a fraqueza W10, em que `WAITING_HUMAN` não tinha contrato e o operador estava fora da máquina. "Human-in-the-loop" no sentido corrente é um botão de aprovação fora do sistema: o humano vê algo, clica, e o clique é tratado como verdade. O clique não carrega escopo, não carrega proveniência e não expira.

A v1.0 examina o pressuposto e — este é o ponto — **o divide em vez de removê-lo**. A inversão é precisa e parcial.

### Decisão

> **O operador não é root epistemológico, mas continua sendo root intencional.** A intenção é dele. A verificação não é de ninguém — é do protocolo.

```
O OPERADOR É SOBERANO SOBRE                 O OPERADOR NÃO É SOBERANO SOBRE

intenção e objetivo da mudança              existência de evidência
preferência entre alternativas válidas      integridade de âncora (I1)
aceitação de risco declarado                cobertura de célula (I2)
decisão de negócio                          roundtrip
autorização de ação irreversível            propriedades mecanicamente verificáveis
resolução de conflitos de valor             cascatas calculadas de recall
```

A decisão vira objeto governado:

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

A linha entre as colunas, em uma frase: **o operador pode assumir riscos declarados; não pode fabricar evidência.** "Aceito esse risco" é uma decisão, e é dele. "Essa evidência existe" é um fato, e não se decide.

O que a aprovação **pode**: fechar `unresolved[]` como risco assumido (ADR-0016a); aceitar defasagem de `seq` para continuar concretizando sob risco (ADR-0016b) — **nunca** para promover, pela regra 3 do atravessamento fixada em ADR-0010, cuja formulação é a aplicação desta tese a `seq`: **risco é decidível; atualidade não**; autorizar irreversíveis nomeados no contrato (ADR-0018); escolher transições no escalonamento. O que **não pode**, com a recusa correspondente: fazer âncora inexistente existir, dar cobertura a célula descoberta, converter posse em β por assinatura, cancelar cascata calculada — todos `EVIDENCE_REQUIRED`, **recusa terminal por desenho**, sem caminho alternativo. I1 e I2 não têm exceção humana.

**A nuance que não pode ser perdida.** Isto **não** é tratar pessoa e LLM como equivalentes, e a arquitetura o diz estruturalmente: a **soberania intencional é exclusiva do humano — nenhum agente de silício possui uma célula sequer da coluna esquerda**. O que é simétrico é apenas a coluna direita: a impossibilidade de fabricar evidência. Falíveis diante do gate, ambos são; equivalentes, não.

Três razões sustentam a simetria estrita da coluna direita:

1. **Empírica.** O elo humano é o elo atacado na prática — phishing, fadiga, o deploy das 3h. Um sistema cuja garantia final é "um humano olhou" tem como garantia final o pior momento do seu humano mais cansado. A baseline já viu a versão de máquina disso: o gate que aprovava vacuamente produzia confiança sem garantia — 59 chamadas logadas `ok:true` e zero claims. Um operador exausto clicando "aprovar" é o mesmo fenômeno em carbono.
2. **Arquitetural.** A raiz de *verificação* de um sistema epistemológico não pode ser um ponto único probabilístico — nem de silício nem de carbono. O que a tese central nega à LLM não é a natureza; é a combinação de falibilidade com autoridade incontestável sobre **fatos**.
3. **De dignidade.** Escopar a aprovação **protege** o operador. `risks_assumed[]` registra exatamente o que ele aceitou e, por complemento, tudo que ninguém jamais lhe pediu para aceitar. No incidente, a diferença entre "aprovou o risco X, registrado, com a informação Y disponível" e "aprovou" é a diferença entre responsabilidade delimitada e bode expiatório.

### Alternativas rejeitadas

**(a) Humano como root total.** Perde pelas três razões acima, e a primeira é decisiva porque é empírica: a garantia se torna o pior momento da pessoa mais cansada.

**(b) Humano como "apenas mais um agente".** **Esta era a formulação da rc2, e foi rejeitada por ser forte demais.** Ela apaga a soberania intencional, que é real, exclusiva e constitutiva do papel do operador na negociação — o Guardião levanta questões, o Maître apresenta, **o operador decide**. Uma simetria total teria sido mais simples de especificar e teria dito algo falso sobre o sistema.

**(c) Full-auto.** Perde porque revoga a assunção legítima de risco, que é insubstituível: máquinas verificam; humanos respondem por consequências.

**(d) Escopo sem expiração.** Perde por ser cheque em branco temporal — e por habilitar T7 (replay de aprovação).

### Consequências

**Ganho.** O teste de substituição adversarial passa a incluir o humano (T4): credencial roubada ou engenharia social não convertem conteúdo sem chão em posse β, porque não existe verbo que o faça. `WAITING_HUMAN` deixa de ser buraco e vira estado da máquina com entrada tipada e saídas enumeradas.

**Custo.** Fricção real de UX. Aprovação expirada é aprovação inexistente (`APPROVAL_EXPIRED` / `APPROVAL_STALE_SEQ` re-escalam), e re-escalar irrita. Os defaults iniciais — risco 24h, defasagem 1h, irreversível single-use — são **configuração, não protocolo**.

**A consequência mais desconfortável, e ela é metodológica.** Contorno sistemático do escopo será tratado como **falsificação do desenho (H11), não como indisciplina do operador**. Se as pessoas rotineiramente burlam a estrutura, a estrutura está errada — e o projeto se compromete de antemão a ler o dado dessa forma, em vez de culpar o usuário.

### Reversibilidade

**Média.** Escopos e TTLs são calibráveis sem tocar a forma; o vocabulário de recusas do operador é extensível. Remover a estrutura — voltar ao clique sem escopo — é a regressão **R7**: reintroduz raiz de verificação probabilística e revoga a tese de simetria.

### Verificação

**VS-1c**, com **operador adversarial roteirizado**: T4 (aprovação por engano ou roubo de credencial) e T7 (replay de `OperatorApproval` em outro contexto), verificados por `SCOPE_EXCEEDED` e `APPROVAL_STALE_SEQ` **no log do host**. Hipótese: **H11** — falsificada por contorno sistemático. Métricas: *Operator Scope Violation Rate* (aprovações fora de escopo bloqueadas / tentadas), *Approval Staleness Rate*, e fricção medida como tempo, abandono e taxa de contorno. A coluna esquerda — a soberania intencional — **não é falsificável por teste mecânico**: é uma alocação normativa de responsabilidade, não uma hipótese empírica, e este ADR o declara em vez de fingir métrica.

### Notas de implementação

Não existe representação de operador, aprovação ou identidade escopada no repositório; o que existe é autenticação de transporte (`packages/mcp-server/src/tokens.ts`, `packages/stdio-proxy/src/credentials.ts`), que é outra coisa — autorização de canal, não soberania intencional. Confundir as duas na implementação produziria exatamente o "clique sem escopo" que a decisão recusa. `EVIDENCE_REQUIRED` precisa ser recusa **terminal** no gate (`packages/mcp-server/src/gates.ts`): não pode existir flag, parâmetro ou modo de manutenção que a contorne, porque um caminho de bypass administrativo é a exceção humana a I1 entrando pela porta de serviço.

---

## ADR-0018 — Default irreversível para tool não classificada

| | |
|---|---|
| **Status** | Proposta [E] — pendente de VS-1 (VS-1b, ameaça T11) |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §16 (bloco D-11); §5.1.1, §5.5, §35 |
| **Marca** | [E] |
| **Relaciona** | ADR-0017, ADR-0020, ADR-0011 |

### Contexto

A fraqueza W7 é que o Capability Gateway era uma caixa nomeada: a v0.4 declarava que toda ação no mundo atravessa a rota operacional, sem dizer o que o gateway faz com cada ação. A precisão da rc4 delimita o objeto: **o gateway não define `CONCRETIZE`** — implementa sua **borda externa**. Todo horizonte concretiza na forma que lhe é própria (uma resposta na sessão, uma hipótese na negociação, uma composição na transformação); somente onde a materialização produz efeito **fora** do OpenGraph — arquivo, processo, rede — ela atravessa o gateway por ferramentas classificadas.

O problema concreto é a extensibilidade da borda: o registry de adapters traz tools de cada flavor, e uma tool nova chega sem nada dito sobre o que ela faz no mundo. Alguém precisa decidir o que acontece com o não declarado, e essa decisão é a ameaça T11 (tool camuflada: efeito irreversível declarado inofensivo).

### Decisão

Três classes de efeito, com política própria:

| Classe | Exemplos | Política |
|---|---|---|
| **Idempotente** | leitura, análise, dry-run, render, query | repetição livre; conta no budget |
| **Compensável** | escrever em workspace, branch Git, container efêmero | idempotency key + compensação registrada |
| **Irreversível** | push, deploy, chamada externa com efeito, e-mail, pagamento | autorização nomeada no `ChangeContract` + **registro antes da execução** |

Três regras:

1. **A classificação vive no adapter do flavor**, validada pelo doctor. **Não classificada = irreversível** (`TOOL_UNCLASSIFIED`). Na dúvida, o custo é fricção — nunca efeito não autorizado.
2. **Registro precede execução para a classe irreversível.** O argumento é de **assimetria de falha**, e é o que fixa a ordem: morrer entre o registro e o efeito deixa **intenção investigável** — sabe-se o que se pretendia fazer e pode-se verificar se aconteceu; morrer entre o efeito e o registro deixaria **efeito sem rastro**, que é o oposto exato de tudo que o sistema promete. As duas ordens têm o mesmo custo em caminho feliz; só a primeira degrada bem.
3. **O gateway não julga mérito** — julga autorização e classe. Um Técnico autorizado pode executar uma ação tola; não pode executar fora de contrato (`TOOL_OUT_OF_CONTRACT`) nem converter sucesso operacional em conhecimento admitido. Nada do que a ação produz é conhecimento até `VERIFY`.

### Alternativas rejeitadas

**(a) Default compensável.** Perde porque otimismo é exatamente o que um atacante explora ao registrar uma tool com nome inocente (T11). O default é a política real do sistema para tudo que ninguém revisou — e a maior parte das tools nunca será revisada.

**(b) Bloquear as não classificadas.** Perde porque mata a extensibilidade na borda em que ela mais importa: o registry de flavors é o mecanismo de adoção do ecossistema inteiro, e uma borda que rejeita o desconhecido rejeita a adoção.

### Consequências

**Ganho.** O pior caso do não declarado é fricção — uma autorização nomeada a mais — em vez de efeito irreversível não autorizado. E a classificação vira dado auditável, não convenção.

**Custo.** Fricção na adoção de tools novas: toda tool nova nasce cara até ser classificada. O registry reduz isso a um passo (declarar a classe no `AgentFlavorDef`), mas o passo existe e alguém precisa dá-lo.

**Escopo explicitamente não coberto.** **Sandbox de execução real permanece [A] para 1.x.** O que gradua em 1.0 é **classificação + registro + vínculo ao contrato** — não isolamento de processo. Uma tool classificada como idempotente que mente sobre sua natureza executa com liberdade de idempotente; nada no escopo 1.0 a impede tecnicamente. O sistema detecta pelo registro, não pelo confinamento, e este ADR não pretende o contrário.

### Reversibilidade

**Alta.** O default é um parâmetro de política; classes adicionais são aditivas; e a migração de uma tool entre classes é declarativa. A ordem registro-antes-de-execução, essa sim, não é negociável — inverter é destruir a assimetria de falha que a justifica.

### Verificação

**VS-1b**, no par cliente/host real: as três classes exercitadas com tools reais; tool sem classe declarada recebendo `TOOL_UNCLASSIFIED` e sendo tratada como irreversível, **por log**; tentativa de irreversível fora de contrato recebendo `TOOL_OUT_OF_CONTRACT`. Ameaça: **T11**. Hipótese: H3 (sobrevivência à substituição adversarial na fronteira operacional). Métricas: *Refusal Taxonomy Coverage*, *Silent-Fail-Open Rate*. Critério de conformidade: item do checklist ligado ao adapter (§5.5).

Um teste específico que o paper obriga e que é fácil esquecer: verificar que o **registro precedeu** o efeito, o que exige inspeção da ordem no audit log — não basta que ambos existam.

### Notas de implementação

O registry existe em `packages/mcp-server/src/agent-registry.ts`, com `AgentFlavorDef` cobrindo 11 flavors, e é validado por `doctor.ts` / `install.ts`. O tipo atual **não tem** campo de classificação de efeito de tools **nem** campo de nível de conformidade — as duas metades que §5.5 identifica como faltantes. Este ADR depende da primeira; ADR-0019 e o checklist [G2] dependem da segunda. O gateway em si não existe: as tools MCP atuais (`packages/mcp-server/src/tools/`) são de leitura e de changeset, e nenhuma atravessa classificação de efeito.

---

## ADR-0019 — Semântica normativa no protocolo; engine única só na implementação de referência

| | |
|---|---|
| **Status** | Proposta [E] — pendente de VS-1 (checklist L3); a camada de referência é [B] parcial no persistente |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §19 (bloco D-12); §5, §18, Apêndice D |
| **Marca** | [E] na camada normativa · [B] parcial na camada de referência |
| **Relaciona** | ADR-0020, ADR-0011, ADR-0015 |

### Contexto

A v0.4 deixou uma pergunta em aberto: schema universal para todos os horizontes, ou schema por horizonte? A rc2 respondeu escolhendo **engine única como requisito** — e ao fazê-lo criou uma tensão com a própria tese de protocolo, que este ADR existe para resolver.

A tensão é a seguinte. Se o EAP pretende ser um protocolo **independente de implementação** — com o servidor do repositório como implementação *de referência*, não como definição —, então exigir engine única no protocolo é **overfitting da implementação ao protocolo**: transforma uma escolha de arquitetura da referência em obrigação de conformidade para terceiros. Nenhum protocolo que se leve a sério faz isso; HTTP não exige um modelo de threads, SemVer não exige um resolvedor. E a v0.4 já havia dito exatamente o contrário do que a rc2 fixou: ser OpenGraph no horizonte **não obriga o mesmo storage físico ou schema completo** — define a semântica.

### Decisão

A resposta é dada em **duas camadas explicitamente separadas**.

**Camada normativa (EAP).** O que o protocolo exige de qualquer implementação L3: todo horizonte é um OpenGraph com nós, relações, claims, lacunas, evidências e o ciclo de seis estados; as capacidades por horizonte seguem o perfil semântico; e as **propriedades observáveis** — recusas, propagação, promoção, invalidação por `seq` — são idênticas às da referência. **O protocolo não exige engine única, storage único nem schema físico.**

**Camada de implementação (referência).** A implementação de referência escolhe: engine única com perfis declarativos e namespace por horizonte; o persistente mantém JSONL durável + SQLite derivado (I7).

Perfis por horizonte, como semântica normativa:

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

A regra que decorre disso, e que é o teste de que a separação foi feita corretamente:

> **Outra implementação pode usar vários stores — cinco, se quiser — e permanecer conforme, desde que as propriedades observáveis sejam idênticas.** O checklist L3 testa **propriedades**, não internals.

Na destruição de um horizonte, o audit preserva eventos e `excluded_summary` — nunca o conteúdo. Replay de horizonte efêmero não é requisito de 1.0.

### Alternativas rejeitadas

**(a) Engine única como requisito do protocolo** (a formulação da rc2). Perde por overfitting: contradiz a independência de implementação que a própria tese de protocolo exige, e contraria a v0.4, que deixara o storage explicitamente livre.

**(b) Na referência, engines distintas por horizonte.** Perde — e note que perde na camada de **implementação**, não na normativa — porque a fronteira entre "scratchpad" e "conhecimento" é justamente onde a lavanderia de autoridade aconteceria, e I5 já ensinou o que duas grafias da mesma semântica produzem. A referência escolhe engine única **por prudência própria**, não porque o protocolo mande.

**(c) Schema físico único total, sem perfis.** Perde porque peso sem significado vira campo ignorado, que vira campo mentiroso — um `coverage` obrigatório num horizonte de sessão seria preenchido com qualquer coisa em três semanas.

### Consequências

**Ganho.** A tese de protocolo fica coerente consigo mesma: a conformidade é testável de fora, por comportamento observável, e não por inspeção de arquitetura interna. Isso é também o que torna H12 mensurável — flavors distintos podem conformar sem adotar a pilha da referência.

**Custo.** O checklist de conformidade fica mais caro de escrever: testar propriedades observáveis exige enumerar quais são, com que oráculo e sob que sequência de operações — bem mais trabalho do que checar "usa a engine X". Além disso, duas camadas significam dois lugares onde uma decisão pode divergir, e a disciplina de manter a distinção viva é permanente.

### Reversibilidade

**Alta na camada de referência** — trocar engine, storage ou layout físico é decisão interna e não afeta conformidade, que é precisamente o ponto da decisão. **A camada normativa segue [G0]**: o conjunto de propriedades observáveis não pode encolher sem alterar o que o protocolo significa.

### Verificação

Item **L3** do checklist do Apêndice D: topologia declarada, horizontes com perfis semânticos, e as propriedades observáveis verificadas **por log do host**. **VS-1a** verifica adicionalmente a conformidade **semântica** dos seis estados por horizonte, usando a tabela de semântica universal como oráculo de revisão — porque **seis labels não são seis estados**: uma implementação cujo `ADMIT` de sessão não distingue candidato de aceito tem cinco estados com seis nomes e falha L3 por semântica, não por sintaxe. Hipótese: **H12** (≥ 3 flavors do registry em L0–L1). Métrica: *Conformance Pass Rate por flavor*.

### Notas de implementação

A camada de referência já existe **apenas para o horizonte persistente**: JSONL append-only + SQLite derivado (`packages/mcp-server/src/log.ts`, `db.ts`, `store.ts`), com `seq` monotônico por tenant e a separação grafo/audit de I7. Os outros quatro horizontes não existem — não há namespace, perfil nem budget. A decisão que este ADR fixa **não** obriga a criá-los como tabelas novas: obriga a que, quando existirem, suas propriedades observáveis sejam as da tabela de perfis. O checklist do Apêndice D não tem forma executável no repositório e é pré-requisito de [G2].

---

## ADR-0020 — Scratch não-memorial legítimo; memória sempre no grafo

| | |
|---|---|
| **Status** | Aceita [E], substitui a formulação anterior (rc2) — teste de reutilização pendente de VS-1 |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §20 (bloco D-13); Lei 9, R6, R9, §15, §30 (H4, H9) |
| **Marca** | [E] |
| **Relaciona** | ADR-0019, ADR-0018, ADR-0017 |

### Contexto

Este é o segundo dos dois erros críticos que este conjunto de ADRs registra, e é do mesmo tipo do primeiro: uma formalização que trocou o objeto formalizado enquanto parecia rigor.

O problema legítimo é a fraqueza W5: cinco horizontes executando o ciclo completo é custo multiplicativo se implementado ingenuamente. É verdade que existe estado transitório de execução — o buffer de uma ferramenta, a chain de uma única chamada, o workspace efêmero de um passo — que seria absurdo governar com cerimônia de admissão.

A rc2 chamou isso de **"memória de trabalho crua fora do OpenGraph"**. E a palavra *memória*, ali, contradiz a definição constitutiva do sistema: **toda memória governada é um OpenGraph no horizonte em que vive** (Lei 9), e **R6 proíbe memória cognitiva fora de OpenGraph governado**. Admitida a expressão, R6 fica relaxada **por vocabulário** — não por decisão, não por argumento, não com registro: por escolha de palavra. É a mesma classe de falha da escala de autoridade da rc2 e da máquina de cinco verbos: nenhuma parecia erro, cada uma parecia rigor.

A correção é **conceitual, não cosmética**. Não se trata de renomear para evitar constrangimento; trata-se de reconhecer que o objeto descrito **nunca foi memória**, e que descrevê-lo como memória criava uma categoria — "memória legítima não governada" — que a arquitetura não pode conter sem se contradizer.

### Decisão

Três peças compõem a economia dos horizontes.

**1. Contabilidade.** Todo horizonte nasce com **budget-ledger**: tokens, tempo, tentativas, chamadas por classe de tool. Cada verbo debita; o ledger entra no audit no encerramento. Sem contabilidade não há H9 — **"custa caro" precisa virar número antes de virar decisão**.

**2. Budgets, com R9.** **Exaustão nunca promove**: escala (`BUDGET_EXHAUSTED`), nunca promove. O budget é também defesa econômica — um Técnico hostil que gira em tentativas queima o **próprio** budget e escala, sem desgastar o gate.

**3. Estado transitório não-memorial de execução.**

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

O critério é **único e mecânico: reutilização.**

> Se um conteúdo influencia **qualquer** decisão posterior ao passo que o criou, ele é memória e pertence ao grafo do horizonte. Se pode evaporar sem que nada mude, é scratch.

A Lei 9 e R6 ficam **integrais**: a v1.0 não relaxa a governança de memória — **distingue o que nunca foi memória**.

### Alternativas rejeitadas

**(a) A formulação da rc2** — "memória crua não governada, desde que não atravesse". Perde porque contradiz a definição de memória do sistema e relaxa R6 por vocabulário. É a formulação que este ADR substitui, e [G0] é o critério que a recusa.

**(b) Governar todo estado transitório.** Perde por custo e por incentivo: cerimônia em cada buffer inviabiliza economicamente a recursividade **e convida ao contorno** — e um contorno rotineiro é pior que uma regra ausente, porque produz a aparência de governança.

**(c) Scratch com promoção direta "quando óbvio".** Perde porque "óbvio" é julgamento probabilístico exatamente na fronteira, o que R5 proíbe. Seria o canal inter-horizonte não governado nascendo de novo, com nome simpático.

### Consequências

**Ganho.** O custo da recursividade passa a ser mensurável (H9) em vez de estimado, e W5 sai do estado de fraqueza declarada. A distinção também dá ao implementador uma regra que ele pode aplicar sem consultar o paper: *isto vai ser reusado? então é grafo.*

**Custo.** O critério de reutilização exige **disciplina de implementação**, e a consequência é dura no sentido correto: **um scratch que "vazou" para uma decisão é uma violação detectável de R6, não uma zona cinzenta.** Não há categoria intermediária onde apoiar um vazamento — o que significa que erros honestos serão classificados como violações. É deliberado: a alternativa é uma zona cinzenta, e zonas cinzentas em fronteiras de memória são onde a lavanderia mora.

**Consequência sobre R9.** A regra "exaustão nunca promove" fecha o flanco econômico da Lei 8: um sistema que promove quando ninguém decide é um sistema cuja política real é o cansaço. Nenhum caminho de escalonamento termina em promoção implícita — timeout aborta, abandono aborta, exaustão aborta.

### Reversibilidade

**Alta.** As três peças são calibráveis: budgets são números, o ledger é observabilidade, e a fronteira scratch/memória é aplicada no ponto de escrita. O que **não** é reversível é a categoria: reintroduzir "memória não governada" é a regressão R6 e a repetição literal do erro corrigido.

### Verificação

**VS-1b** produz os primeiros números do ledger (insumo de H9) no par cliente/host real. **VS-1a/1c** verificam a regra R9 por log: toda exaustão terminando em escalonamento, alvo 100% — métrica *Budget Exhaustion Outcomes*. Hipóteses: **H9** (governar horizontes curtos paga o próprio custo; falsificada por overhead multiplicativo sem ganho mensurável) e **H4** (memória governada de sessão reduz reaberturas). Desfecho pré-registrado associado: se o custo por horizonte for proibitivo, H9 registra o limite como achado — e o scratch não-memorial e os perfis são a válvula.

**Ponto de honestidade sobre falsificabilidade.** O teste de reutilização é mecânico **na especificação** e difícil de verificar exaustivamente **na prática**: detectar que um scratch influenciou uma decisão posterior exige instrumentação do ponto de leitura, não apenas do ponto de escrita. Nenhum critério [G] do escopo 1.0 prova ausência de vazamento de scratch — prova apenas que os vazamentos detectados são tratados como violação. Isso é registrado como limite, não escondido como cobertura.

### Notas de implementação

Não existe budget, ledger nem noção de horizonte no repositório — a busca por `budget`/`ledger` em `packages/mcp-server/src` retorna apenas uma menção a orçamento de latência em `resources.ts`, sem relação com esta decisão. A infraestrutura reusável é o audit append-only (`log.ts`), que é onde o ledger deve desaguar no encerramento do horizonte. A fronteira de escrita a instrumentar é a borda MCP (`packages/mcp-server/src/tools/`): tudo que persiste passa por ali, e é o único ponto onde "isto está entrando no grafo" é observável de forma centralizada.

---

## ADR-0021 — Processo: teste antes de ligar código [C]; D×E antes de baselines externos

| | |
|---|---|
| **Status** | Aceita [E] — regra de processo vigente; nenhum dos dois testes foi escrito ainda |
| **Data** | 2026-08-10 |
| **Fonte normativa** | Working Paper v1.0-rc4 §21 (bloco D-14) e §29 (bloco D-15); §2 item 5, §27, §33, Apêndice C |
| **Marca** | [C] → [E] |
| **Relaciona** | ADR-0013, ADR-0014, ADR-0019 |

### Contexto

Estas são duas decisões de processo, e estão no mesmo ADR porque têm a mesma raiz metodológica: **o projeto já foi enganado duas vezes — por código que parecia correto e por experimento que parecia informativo.**

O primeiro engano tem nome e custo. F1 e F7 foram críticos nascidos de código correto no desenho que aprovava vacuamente na prática; e o log que registrou 59 chamadas `ok:true` com zero claims é a forma mais nítida do fenômeno: um gate que falha em silêncio produz confiança sem garantia. O inventário [C] do repositório — `claims.ts`, `greenfield.ts`, `federation.ts` — é exatamente código nessa categoria: vendorado, nunca exercitado, e **não é prova**. A fraqueza W8 registra o caso mais agudo: greenfield foi declarado "o mecanismo" da generalização enquanto era código morto.

O segundo engano é o alpha v0. O braço com MCP não usou o servidor uma única vez, verificado **por log**; e a especificação (199 linhas) era maior que o artefato (184) — ou seja, o objeto escolhido não tinha a propriedade que tornaria o grafo valioso. Foi um fracasso informativo, e a lição que ele pagou é dupla: **autorrelato não conta, nunca**, e um experimento mal desenhado consome o orçamento de credibilidade sem produzir conhecimento.

### Decisão

#### 21.1 — Teste antes de ligar código [C] (D-14)

> Código [C] migra para [B] **via teste adversarial**, ou permanece desligado. Sem exceção.

Ordem e regra fixadas para o inventário atual:

| Módulo | Decisão | Razão |
|---|---|---|
| `claims.ts` | **liga no bootstrap da VS-1** | claims determinísticas por AST dão um piso sem custo de LLM; é pré-requisito do alpha v1, que exige o grafo carregando claims commitadas |
| `greenfield.ts` | **liga precedido de teste que tenta quebrá-lo** | é o mecanismo da generalização (H5: `ascent(project(intent))` como ponto fixo, e I1 sem exceção no chão greenfield) |
| `federation.ts` | **não liga** | o gate de execução declarado desde a v0.4 — "dois times pedindo" — segue válido; permanece [C] até 1.x |

O motivo de `federation.ts` **não** ligar merece registro explícito, porque é uma decisão de *não fazer* e essas somem do histórico: não é falta de código nem falta de desenho — o mecanismo existe (torre estrangeira read-only por manifesto assinado, verificação por Merkle sem rede) e o **desenho do recall federado está registrado** justamente para que o contrato de recall nasça compatível. O que falta é **demanda real**, e ligar federação sem ela produziria uma superfície de ataque (T10) e um custo de manutenção a serviço de nenhum usuário.

#### 21.2 — D×E antes dos baselines externos A–C (D-15)

> O primeiro experimento comparativo é **D × E**: D é o substrato sem Cognitive Plane; E é a VS-1c completa. Os baselines externos A–C — agente único, RAG, multiagente convencional — vêm **depois**.

O alpha v1 inverte, uma a uma, as condições que fizeram o alpha v0 falhar: **feature transversal sem teste que a especifique** (o valor do grafo só existe onde *o que quebra se eu mexer* não é óbvio); **grafo carregando claims commitadas**, com julgamento humano admitido — habilitado por `claims.ts`, o que amarra 21.2 a 21.1; **braços D × E**; e **veredito pré-registrado, verificado por log**.

### Alternativas rejeitadas

**(a) Ligar e observar** (alternativa a 21.1). Perde porque **é como F1 e F7 nasceram**: correto no desenho, aprovando vacuamente na prática. Observar código ligado detecta o que se manifesta; o teste adversarial procura o que se esconde — e a patologia relevante deste projeto é a que se esconde.

**(b) Benchmark imediato contra agente único, RAG e multiagente convencional** (alternativa a 21.2). Perde porque compararia **dois sistemas imaturos com três maduros** e mediria maturidade, não arquitetura. O braço D isola exatamente a variável proposta — a presença do Cognitive Plane sobre o mesmo substrato — e é o único contraste que responde à pergunta em questão.

### Consequências

**Ganho (21.1).** O inventário [C] **derrete na velocidade dos testes, não da vontade**, e cada migração [C] → [B] carrega evidência nomeada. O efeito colateral é disciplinar: a tentação de "só ligar para ver" fica sem caminho legítimo.

**Custo (21.1).** Código pago e parado. `greenfield.ts` sustenta a tese de que o EAP é protocolo de **conhecimento**, não de código — sem ele, L2 só seria implementável sobre repositórios — e ainda assim permanece desligado até que exista teste que tente quebrá-lo.

**Custo (21.2), assumido explicitamente.** A **alegação de novidade externa espera mais um ciclo**. O paper aceita adiar a comparação que mais interessaria a um leitor externo em troca de uma comparação que efetivamente isola a variável. É uma escolha de rigor sobre marketing, e o custo é real: durante todo o intervalo, a alegação de posicionamento permanece condicionada.

**Consequência comum às duas.** Ambas herdam o método que o alpha v0 acertou mesmo errando o objeto: **prompts congelados, veredito pré-registrado, verificação por log — nunca por autorrelato.**

### Reversibilidade

**n/a — são regras de processo.** Não há artefato para reverter; há apenas a possibilidade de descumpri-las, e o descumprimento é observável no repositório: código [C] ligado sem teste adversarial associado é evidência direta da violação, verificável por inspeção de commit.

### Verificação

Para 21.1: cada migração [C] → [B] exige teste identificado e commit identificado — é a definição da marca [B] (§0.3). `claims.ts` gradua no bootstrap da VS-1; `greenfield.ts` gradua por **H5** (recusa dura no chão greenfield e ponto fixo `ascent(project(intent))`), com falsificação declarada: se o gate aprovar âncora não verificável, é um **novo F1**. `federation.ts` permanece [C] no Apêndice C, sem fingir graduação.

Para 21.2: **H8** — o valor do grafo aparece quando a especificação é menor que o artefato; medida como **uso real do servidor no braço E, por log**; falsificada por zero uso de novo, mesmo com o objeto corrigido. As comparações D×E alimentam H1 (*Cross-Horizon Leakage*, *Cost/Latency* contra D) e H9.

**Limite de falsificabilidade registrado.** 21.2 mede a arquitetura contra sua própria ausência, não contra o estado da arte. É a comparação correta para a pergunta atual e **não** sustenta alegação competitiva — o que o paper declara ao manter as camadas 2 e 3 do posicionamento condicionadas.

### Notas de implementação

Os três módulos estão em `packages/graph-core/src/`: `claims.ts` (schema e IO de claims determinísticas por AST, com `Confidence` e veredito automático, sobre `extract.ts`), `greenfield.ts` e `federation.ts` (manifesto assinado, raiz de Merkle fixada em `.graph/federation.lock`, verificação sem rede — coerente com I9). Nenhum deles é importado pelo servidor MCP hoje. Ligar `claims.ts` significa torná-lo alcançável a partir de `packages/mcp-server/src` — e o teste que autoriza a ligação precisa ser adversarial no sentido do paper: tentar fazer o gate aceitar uma claim cuja âncora não resolve verbatim, não apenas confirmar que o caminho feliz funciona.
---

# Apêndice A — Ambiguidades detectadas na derivação *[A]*

A derivação dos vinte e um registros e do PRD expôs onze pontos em que o paper v1.0-rc4 não determina o comportamento. Nenhum deles é regressão: são lacunas de segunda ordem, do tipo que só aparece quando alguém tenta implementar. **Nenhuma foi resolvida por conta própria** — resolver por inferência aqui seria exatamente a patologia que o sistema existe para impedir. Cada uma traz uma recomendação explicitamente marcada como recomendação, para decisão do operador.

### A1 — `STALE_BASE` como aviso em `PROPOSE`

A tabela de verbos (§5.1) marca `STALE_BASE` como *aviso* em `PROPOSE`, enquanto §5.2 e §7 o tratam como recusa com obrigação de cliente. "Aviso" não tem definição mecânica no protocolo, e I6 exige que recusa seja registrada como recusa. **Importa porque** um código que às vezes é recusa e às vezes não é um código que os clientes aprendem a ignorar. *Recomendação:* tratar como recusa não-bloqueante tipada — registrada, com razão, sem impedir o `PROPOSE` — e nomear essa categoria no protocolo, já que ela é a única do gênero.

### A2 — Interação entre aprovação de defasagem e rebase obrigatório

§13(b) permite ao operador aceitar defasagem para continuar concretizando; §7 regra 3 exige rebase para promover. Não está dito o que acontece com uma `OperatorApproval` de defasagem ainda dentro do `ttl` no momento da promoção: ela é simplesmente irrelevante ali, ou precisa ser encerrada e registrada como consumida? **Importa porque** aprovação viva e inaplicável é a matéria-prima do T7 (replay de aprovação). *Recomendação:* declarar a aprovação de defasagem como escopada ao verbo `CONCRETIZE`, logo inaplicável a `PROMOTE` por construção, sem consumo explícito.

### A3 — Escopo do rebase sob `STALE_BASE`

§7 regra 3 exige "rebase ou revalidação explícita" sem dizer se o alvo é todo o `distilled[]` ou apenas as evidências afetadas pelo avanço do `seq`. **Importa porque** a diferença é entre uma promoção cara e uma promoção proibitiva em grafos ativos. *Recomendação:* revalidação por interseção — só o que depende do subgrafo que mudou —, com o fechamento da §11 como cálculo do conjunto afetado.

### A4 — `INITIATE` incompleto no statechart e nas recusas

O operador `INITIATE` (§6.1) não aparece no Workflow Orchestration Statechart (Apêndice B): a guarda de `CHAT → NEGOTIATING` não menciona o `NegotiationSeed`. Também não tem ameaça correspondente em T1–T14, e seus modos de recusa listam apenas `PROVENANCE_MISSING`, embora o seed carregue `based_on_seq`. **Importa porque** uma fronteira sem ameaça catalogada é uma fronteira que ninguém tentou burlar. *Recomendação:* acrescentar a guarda ao Apêndice B e catalogar a ameaça correspondente — um seed que carrega decisões de sessão como se fossem admitidas é o vetor óbvio.

### A5 — Status de destino da cascata rio abaixo

§10.1 diz que o fechamento leva as claims alvo de `admitted → contested`; §11 regra 1 diz apenas que a dependente "não permanece admitted", sem nomear o destino. Não está dito se dependentes indiretas viram `contested` como as alvo ou algo mais fraco. **Importa porque** define se a cicatriz é uniforme ou graduada por distância da causa. *Recomendação:* destino uniforme `contested` para todo o fechamento, com a distância registrada na proveniência — graduar status por distância reintroduziria um gradiente de confiança.

### A6 — `RecallNotice` e `Contestation(invalidante)`

§5.1 dá como pré-condição de `RECALL` uma `Contestation(invalidante)` admitida; §10 apresenta `RecallNotice` como objeto próprio, com campos próprios, admitido pelo gate. Se o `RecallNotice` é o payload da contestação invalidante ou um segundo objeto admitido em separado não está escrito. **Importa porque** decide se são um ou dois atravessamentos de gate — e quem tem legitimidade para emitir o segundo.

### A7 — `faulty_since_seq` desconhecido: janela de auditoria ou fechamento?

§10.1 diz que o pior caso é assumido pela "janela de auditoria". Não fica claro se ele alarga apenas a janela ou também o **fechamento** da cascata. **Importa porque** as duas leituras têm custos operacionais radicalmente diferentes: uma amplia o que se investiga, a outra amplia o que se suspende.

### A8 — Cascata em horizontes efêmeros

A regra 1 da §11 é enunciada por dependência, não por horizonte. Não está dito se uma contestação ou recall propaga para dentro de OpenGraphs de microtask e transformação em curso, ou apenas marca as promoções em voo como `STALE_BASE`. *Recomendação:* apenas `STALE_BASE` nas fronteiras, sem cascata dentro do efêmero — que é destrutível de todo modo e cujo custo de recomputar é menor que o de propagar.

### A9 — Budget do horizonte persistente

A tabela de perfis (§19) marca o persistente sem budget próprio (`○`); §20 afirma que **todo** horizonte nasce com budget-ledger. Tensão direta entre as duas seções. *Recomendação:* a tabela está certa e o enunciado é que precisa da ressalva — o persistente não é um horizonte de execução com custo próprio; quem gasta é quem propõe a ele.

### A10 — Verificação por revisão em §5.1.1 e o denominador do `Derivation Registration Ratio`

Dois pontos onde a Convenção 2 (aceite verificável por log) não é atingida. A conformidade semântica dos seis estados usa a tabela 6×5 como *oráculo de revisão* — o único item do programa experimental cujo veredito não é mecânico. E o denominador do `Derivation Registration Ratio` ("derivações declaráveis na admissão") não tem definição operacional. **Importam porque** são as duas medições que hoje dependem de julgamento, e o paper proíbe exatamente isso nas transições.

### A11 — Vocabulário de status legado no repositório *[achado de código]*

`packages/graph-core/src/claim-store.ts:27` define o status de claim como `"pending-verification" | "verified" | "contradicts-floor" | "test-spec"`. O Apêndice A do paper mapeia o vocabulário de [23] e o da v0.4 para a dimensão STATUS normativa (`proposed · admitted · contested · superseded · revoked`), **mas não mapeia o vocabulário que o código realmente usa**. É trabalho de migração real, hoje não especificado: não está dito qual valor legado vai para qual coordenada — e `test-spec`, em particular, parece codificar uma categoria que a dimensão normativa não tem.

### A12 — Decisões de execução não fixadas *[A, por desenho]*

O paper deliberadamente não fixa: qual feature transversal real será objeto do alpha v1 (critério em §29: sem teste que a especifique, especificação menor que o artefato); quem executa o papel de operador adversarial na VS-1c (roteiro fixo ou red team); quais três flavors dos onze vão a [G2]; e os defaults de `ttl` de `OperatorApproval` para classes de decisão além das três citadas. São decisões de execução, não de arquitetura — mas nenhuma VS-1c começa sem elas.

---

# Apêndice B — Achados de código na derivação *[B]*

Dois achados verificados diretamente no repositório durante a derivação, um a favor e um contra a formulação atual do paper. Ambos foram checados no código, não relatados por inferência.

### B1 — A tipagem de `suspended` já era posse no código *(sustenta ADR-0015)*

`packages/graph-core/src/authority.ts:19`:

```typescript
export type Authority = "source" | "graph" | "suspended"
```

e, na degradação por drift, `authority.ts:124`:

```typescript
const next: Authority = worst === "gone" ? "source" : "suspended"
```

O código sempre tratou `suspended` como valor do tipo `Authority` — a coordenada de **posse** —, nunca como status de claim, e a demoção graduada (`gone → source`, o resto → `suspended`) está implementada exatamente como o invariante I3 descreve. A decisão D-16/ADR-0015 não inventa semântica nova: **escreve a semântica que a implementação já tinha** e que a rc3 havia duplicado ao listar `suspended` também como status. É o caso raro em que a baseline arbitra uma ambiguidade do paper, e não o contrário.

### B2 — As recusas do gate ainda são texto livre *(dívida contra ADR-0006)*

A taxonomia fechada de recusas (ADR-0006) exige códigos com obrigação de cliente associada. As recusas emitidas hoje pelo gate são mensagens de texto — o que significa que a métrica *Refusal Taxonomy Coverage* nasce perto de zero e que o item correspondente do checklist L2 **hoje não passa**, apesar de o gate em si ser [B]. É dívida de conformidade conhecida, não defeito descoberto: o mecanismo existe e o vocabulário é que falta.
