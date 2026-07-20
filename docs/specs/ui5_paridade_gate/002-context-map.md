# UI-5 — Paridade e Gate de Retomada: Context Map

## 1. BOUNDED CONTEXTS

| Contexto | Modelo | Responsabilidade |
|---|---|---|
| Parity Registry | `ParityItem`, `Evidence`, `Waiver` | Manter cobertura completa e resolução explícita. |
| E2E Verification | `SpecRun`, `SuiteManifest`, `Trace` | Executar e provar comportamentos integrados. |
| CI Gate | `RequiredJob`, `RunSummary` | Bloquear merge quando suite falha ou está vazia. |
| Mini-session | `SessionPlan`, `Mission`, `Observation` | Coordenar validação real limitada. |
| Friction Triage | `Friction`, `Severity`, `Disposition`, `Recheck` | Transformar observações em ações verificáveis. |
| Beta Governance | `GateDecision`, `Signer`, `EffectiveDate` | Autorizar ou negar retomada do beta. |

## 2. CONTEXT RELATIONSHIPS

| Upstream | Downstream | Padrão | Contrato |
|---|---|---|---|
| UI-0..UI-4 implementation | Parity Registry | Conformist | Capacidades e seletores existentes. |
| Parity Registry | E2E Verification | Customer/Supplier | Cada item aponta para spec ou waiver. |
| mcp-server | E2E Verification | Open Host Service | Recursos, tools, SSE e controle do harness. |
| E2E Verification | CI Gate | Published Language | Exit code, quantidade, failures, retries e artifacts. |
| BT-4 mission | Mini-session | Conformist | Warm-up e uma missão sem expandir beta. |
| Mini-session | Friction Triage | Customer/Supplier | Observações datadas com reprodução. |
| Parity Registry + CI + Triage | Beta Governance | Policy | Todos resolvidos, CI verde e zero blockers. |
| Beta Governance | roadmap-beta-test | Human Gate | Decisão datada do dono. |

## 3. SOURCE OF TRUTH

| Informação | Fonte | Consumidores |
|---|---|---|
| Capacidades de paridade | UI-5 roadmap checklist | Parity Registry. |
| Resultados automatizados | Playwright/Bun/CI | Parity Registry e GateDecision. |
| Comportamento real | Ata da mini-sessão | Friction Triage. |
| Severidade/disposição | Ata/issues | GateDecision. |
| Estado do beta | README do roadmap beta | Planejamento posterior. |
| Assinatura | Dono humano | README e checklist UI-5. |

## 4. EVIDENCE CONTRACT

| Evidence Type | Required Fields | Acceptance |
|---|---|---|
| Automated spec | file, scenario, run date, result | Spec executado e não pulado. |
| CI run | workflow/job, revision, result, test count | Job obrigatório e contagem maior que zero. |
| Session observation | timestamp, actor role, step, observed behavior | Reproduzível e ligado à missão. |
| Friction | severity, reproduction, owner, disposition | Nenhum blocker sem resolução/recheck. |
| Waiver | item, rationale, signer, date | Somente decisão explícita do dono. |
| Gate decision | decision, signer, date, evidence revision | Somente após todos os critérios. |

## 5. ANTI-CORRUPTION BOUNDARIES

- O harness traduz controle de servidor e autenticação; specs não dependem de armazenamento interno.
- A matriz usa nomes de capacidade, não seletores, como identidade durável.
- Seletores permanecem detalhes da Evidence automatizada.
- A ata registra observação e severidade sem transformar opinião em resultado técnico.
- O gate não infere assinatura de CI verde; exige ação humana explícita.

## 6. FAILURE TRANSLATION

| Falha | Tradução | Próxima ação |
|---|---|---|
| Spec não descoberto | Parity item sem evidência | Falhar CI e corrigir manifest/config. |
| Spec flaky | Evidência inválida | Capturar trace e corrigir determinismo. |
| Capacidade impossível | Item unresolved | Solicitar waiver humana; não marcar automaticamente. |
| Mini-sessão não conclui missão | Blocker candidato | Triage e reprodução antes do gate. |
| Agente funciona, web falha | Paridade web ausente | Corrigir UI; agente não satisfaz item. |
| Blocker corrigido sem recheck | Blocker aberto | Reexecutar bloco afetado. |
| Dono não assina | Gate pending | Beta permanece adiado. |

## 7. CONSISTENCY RULES

1. Matriz, suite manifest e checklist devem conter o mesmo conjunto de capacidades.
2. Toda evidência deve referir uma revisão executável do repositório.
3. Um blocker só muda para resolved após recheck registrado.
4. A decisão do gate e a mudança do README beta devem ser atômicas.
5. BT-2/BT-3/BT-4 só retomam após decisão `RESUME`; BT-1 permanece independente.

