# UI-5 — Paridade e Gate de Retomada: Problem Space

## 1. SCOPE

Provar que a nova `mcp-web` preserva capacidades da UI anterior, fecha os gaps que justificaram a reescrita e suporta uma mini-sessão real antes de reabrir o roadmap beta. A entrega é evidência rastreável: checklist, suíte completa, ata com fricções e decisão humana datada.

### In Scope

- Matriz de paridade entre capacidade, implementação e teste.
- Cobertura E2E para lacunas ainda sem cenário equivalente.
- Execução integral da suíte no CI com falha quando nenhum spec roda.
- Mini-sessão LAN de 30 minutos com dono, participante e agente Claude Code.
- Classificação e correção de bloqueantes encontrados na mini-sessão.
- Gate humano datado para retomar `roadmap-beta-test`.

### Out of Scope

- Preparar túnel, telemetria, carga ou artefato do beta.
- Adicionar novas features além da paridade declarada.
- Transformar a mini-sessão em beta informal.
- Exigir segunda sessão completa quando somente um bloco falhou.
- Assinar a decisão em nome do dono.

## 2. DOMAIN EVENTS

| Ordem | Evento | Gatilho | Resultado |
|---:|---|---|---|
| 1 | `ParityInventoryBuilt` | Capacidades antigas e gaps são enumerados | Cada item recebe evidência ou dispensa explícita. |
| 2 | `ParityGapDetected` | Item não possui equivalência verificável | Cenário/correção entra no plano antes do gate. |
| 3 | `ParitySuiteExecuted` | CI executa matriz completa | Resultado contém specs, testes e falhas reais. |
| 4 | `MiniSessionScheduled` | Suíte técnica está verde | Participantes, roteiro, ambiente e critérios são fixados. |
| 5 | `MiniSessionStarted` | Dono inicia janela LAN | Warm-up e uma missão BT-4 são executados na nova UI. |
| 6 | `FrictionRecorded` | Participante encontra impedimento | Evidência recebe severidade, owner e reprodução. |
| 7 | `BlockerResolved` | Correção e revalidação terminam | Bloqueante deixa de impedir o gate. |
| 8 | `ParityAccepted` | Checklist está 100% resolvido | Nenhum item permanece silencioso. |
| 9 | `BetaResumptionSigned` | Dono decide com evidências | Roadmap beta sai de adiado com data e escopo reaberto. |

## 3. SUBDOMAINS

| Subdomain | Tipo | Responsabilidade |
|---|---|---|
| Parity Assurance | Core | Demonstrar equivalência e gaps fechados por capacidade. |
| Session Validation | Core | Observar uso real, fricção e conclusão de missão. |
| Beta Resumption Governance | Core | Bloquear retomada sem decisão humana rastreável. |
| E2E Harness | Supporting | Executar browsers contra web e server reais. |
| CI Enforcement | Supporting | Tornar a matriz obrigatória e não-vazia. |
| Issue Triage | Generic | Classificar achados e acompanhar bloqueantes. |

## 4. UBIQUITOUS LANGUAGE

| Termo | Definição |
|---|---|
| Parity Item | Capacidade da UI anterior que exige equivalente ou dispensa explícita. |
| Rewrite Gap | Capacidade ausente na UI anterior e entregue pela reescrita. |
| Evidence | Spec, execução, captura ou ata que comprova um item. |
| Explicit Waiver | Decisão datada do dono que aceita um item impossível sem implementação. |
| Complete Suite | Todos os specs UI-0..UI-4 e cenários de paridade requeridos. |
| Mini-session | Validação LAN de 30 minutos, limitada a warm-up e uma missão. |
| Friction | Obstáculo observável enfrentado por um participante. |
| Blocker | Friction que impede missão, entrada, recuperação ou integridade do trabalho. |
| Recheck | Reexecução somente do bloco que falhou após correção. |
| Resume Gate | Decisão humana que autoriza reabrir o roadmap beta. |

## 5. PARITY INVENTORY

| Capability | Expected Evidence |
|---|---|
| Presence, roster, avatars and typing | Existing liveness specs plus outgoing typing assertion. |
| Toast rules and activity feed | Rule-specific toast scenarios and feed ordering/filter scenario. |
| Reconnect, reauth and turn reattach | Browser recovery without F5 and active-turn restoration. |
| Invisible/notification settings | Settings persistence and visibility behavior. |
| History filters and node panel | URL/filter/detail assertions and node panel selection. |
| Multi-cell turn lifecycle | Open, claim, commit, abort and extend paths. |
| Lock contention and ghosts | Deny/retry/countdown, remote ghost projection and cleanup. |
| Admin re-bootstrap | Authorized action, graph refresh and unauthorized denial. |
| Query gaps and claims browser | Match/gap, claim detail and cross-cell refs. |
| Rich nodes, semantic zoom and containers | Markdown, card/chip/dot, pin, lock header and minimap. |

## 6. BUSINESS RULES

1. Todo Parity Item deve terminar como comprovado ou explicitamente dispensado pelo dono.
2. Spec omitido, pulado ou não descoberto deve falhar o gate, não contar como verde.
3. A suíte deve usar web build e server reais pelo harness existente.
4. A mini-sessão só inicia após suíte técnica completa verde.
5. A missão deve ocorrer inteiramente na nova UI; o agente é adicional, não substituto.
6. Todo achado deve ter severidade, evidência, owner e disposição.
7. Bloqueante exige correção e recheck antes da assinatura.
8. Fricções não bloqueantes podem virar backlog sem impedir o gate.
9. Apenas o dono pode assinar a retomada do beta.
10. A assinatura deve atualizar o roadmap beta com data e remover o aviso de adiamento.

## 7. RISKS AND CONTROLS

| Risco | Controle |
|---|---|
| Checklist marca intenção, não evidência | Exigir link/identificador de spec e resultado datado por item. |
| CI verde com zero specs | Adicionar contagem mínima explícita e reporter verificável. |
| Flakiness mascara regressão | Repetir falha, registrar trace e corrigir causa; não aumentar timeout cegamente. |
| Mini-sessão cresce em escopo | Cronômetro de 30 min, warm-up e uma única missão pré-selecionada. |
| Participante usa CLI para contornar UI | Registrar como blocker da UI; agente pode apoiar, não substituir fluxo web. |
| Assinatura prematura | Exigir checklist completo, ata e zero bloqueantes abertos. |

## 8. SOCRATIC QUESTIONS

- Qual missão BT-4 oferece maior cobertura sem exceder 30 minutos?
- Qual formato de evidência o dono considera suficiente para uma dispensa?
- Re-bootstrap é requisito acessível ao participante ou somente ao dono/admin?
- Qual severidade aplica a uma recuperação que exige F5, mas não perde dados?
- Como registrar identidade do agente sem confundir suas ações com as do participante?
- Qual commit/run do CI será anexado à assinatura do gate?

