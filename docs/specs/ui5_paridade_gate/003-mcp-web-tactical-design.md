# UI-5 — Paridade e Gate de Retomada: Tactical Design — mcp-web

## Section 1 — Main Structure

| Elemento | Camada / Tipo | Responsabilidade | Regra |
|---|---|---|---|
| `ParityManifest` | Test contract | Mapear capability para specs/scenarios. | Cobertura total; sem item implícito. |
| `ParityChecklist` | Governance document | Registrar evidence ou waiver por item. | Data e estado por linha. |
| `Parity E2E Specs` | Browser integration | Fechar feed, reattach, abort/extend e re-bootstrap. | Reusar harness real; sem mocks de protocolo. |
| `FullUiSuite` | CI orchestration | Executar todos os specs UI-0..UI-5. | Falhar com zero specs e publicar summary/trace. |
| `MiniSessionPlan` | Operational document | Fixar atores, tempo, warm-up e missão. | 30 min; LAN; uma missão. |
| `MiniSessionReport` | Evidence document | Registrar execução e fricções. | Severidade, owner, disposição e recheck. |
| `GateDecision` | Human governance | Autorizar retomada beta. | Dono, data, revisão e zero blockers. |

## Section 2 — Value Objects / Types / Interfaces

| Nome | Campos | Invariantes |
|---|---|---|
| `ParityItem` | id, capability, evidence, status | Status `pending | proven | waived`; waiver exige assinatura. |
| `SuiteEntry` | spec, scenarios, capabilities | Todo spec existe e todo capability aparece ao menos uma vez. |
| `RunSummary` | revision, startedAt, total, passed, failed, skipped | `total > 0`; gate exige failed=0 e skipped=0 salvo waiver. |
| `SessionActor` | role, displayName | Roles: owner, participant, agent; sem token/PII técnica. |
| `Friction` | id, step, severity, evidence, owner, disposition | Severidade `blocker | major | minor | note`. |
| `Recheck` | frictionId, scope, date, result | Blocker resolved exige result `passed`. |
| `GateDecision` | decision, signer, date, revision, rationale | `RESUME | HOLD`; somente dono assina. |

## Section 3 — Aggregates and Domain Services

| Agregado / Serviço | Raiz | Comportamento | Invariantes |
|---|---|---|---|
| Parity Registry | UI-5 capability set | Resolve evidence, waiver e completeness. | Nenhum item silencioso. |
| Suite Manifest | required spec set | Valida descoberta e cobertura. | Todos os arquivos existem; total esperado é explícito. |
| Mini-session | session date | Ordena warm-up, missão e observações. | Duração máxima 30 min; uma missão. |
| Friction Ledger | session id | Classifica, atribui, resolve e revalida. | Zero blockers abertos no RESUME. |
| Beta Gate | decision date | Avalia checklist, CI e session report. | Assinatura humana obrigatória. |

### Gate Policy

1. Requerer todos os Parity Items como `proven` ou `waived`.
2. Requerer FullUiSuite verde, não-vazia e sem skips não dispensados.
3. Requerer ata da mini-sessão com missão concluída ou blocker resolvido.
4. Requerer zero blockers abertos.
5. Requerer decisão e data do dono.
6. Manter beta adiado quando qualquer condição falhar.

## Section 4 — Domain Events

| Evento | Produtor | Consumidor | Efeito |
|---|---|---|---|
| `ParityItemProven` | E2E/CI evidence | Parity Registry | Marca item comprovado. |
| `ParityItemWaived` | Dono | Parity Registry | Marca dispensa datada. |
| `FullSuitePassed` | CI | Beta Gate | Libera etapa de mini-sessão. |
| `MiniSessionCompleted` | Dono | Friction Ledger | Fecha observações da janela. |
| `FrictionClassified` | Dono/equipe | Gate Policy | Determina bloqueio e próxima ação. |
| `BlockerRechecked` | Test owner | Beta Gate | Resolve blocker após correção. |
| `BetaResumeSigned` | Dono | Roadmap beta | Remove adiamento e redespacha fases. |

## Section 5 — Persistence / Repository / Data Access Interfaces

| Artefato / Adapter | Operação | Resultado |
|---|---|---|
| Playwright config | Descobrir/executar specs | Suite real do `mcp-web`. |
| Existing E2E harness | Build web, spawn server, open sessions | Browser/server integrados. |
| GitHub Actions CI | Executar suite e anexar artifacts | Required job com resumo e traces. |
| UI-5 roadmap | Atualizar checklist e gate | Registro de paridade e decisão. |
| Mini-session report | Criar ata datada | Evidence humana e friction ledger. |
| Beta roadmap README | Remover/manter adiamento | Estado canônico do beta. |

## Section 6 — Ordered Development Tasks

```json
[
  {
    "id": "01",
    "title": "Create the parity manifest and evidence checklist",
    "description": "Enumerate every legacy capability and rewrite gap, map each to existing or required scenarios, and add explicit proven, pending, or owner-waived states with dates.",
    "files": [
      "packages/mcp-web/e2e/parity-manifest.json",
      "docs/roadmap-web-ui/05-scope-ui-5-paridade-gate.md"
    ],
    "dependsOn": []
  },
  {
    "id": "02",
    "title": "Add parity-manifest consistency validation",
    "description": "Validate that every listed spec exists, every parity capability has evidence, no duplicate identifiers exist, and the suite cannot report success with zero discovered scenarios.",
    "files": [
      "packages/mcp-web/test/parity-manifest.test.ts",
      "packages/mcp-web/e2e/parity-manifest.json"
    ],
    "dependsOn": ["01"]
  },
  {
    "id": "03",
    "title": "Cover activity feed and outgoing typing parity",
    "description": "Extend liveness coverage to assert web-originated typing, activity feed ordering and rendering, and recovery after live events without page reload.",
    "files": [
      "packages/mcp-web/e2e/typing-indicator.e2e.ts",
      "packages/mcp-web/e2e/activity-feed.e2e.ts"
    ],
    "dependsOn": ["01"]
  },
  {
    "id": "04",
    "title": "Cover turn reattach abort and TTL extension parity",
    "description": "Add browser scenarios for reconnect and reauthentication with active-turn reattachment, explicit abort, TTL extension, and preserved draft state without F5.",
    "files": [
      "packages/mcp-web/e2e/reconnect.e2e.ts",
      "packages/mcp-web/e2e/turn-recovery.e2e.ts",
      "packages/mcp-web/src/turn.tsx"
    ],
    "dependsOn": ["01"]
  },
  {
    "id": "05",
    "title": "Cover authorized admin re-bootstrap parity",
    "description": "Expose or verify the existing admin bootstrap action in the new UI, prove graph refresh after success, and assert unauthorized users cannot execute it.",
    "files": [
      "packages/mcp-web/src/app.tsx",
      "packages/mcp-web/src/og.ts",
      "packages/mcp-web/e2e/admin-rebootstrap.e2e.ts",
      "packages/mcp-server/test/web.test.ts"
    ],
    "dependsOn": ["01"]
  },
  {
    "id": "06",
    "title": "Run the full parity suite as a required CI gate",
    "description": "Make the complete UI spec set blocking in CI, verify a non-zero expected scenario count, and retain Playwright traces and summaries on failure.",
    "files": [
      ".github/workflows/ci.yml",
      "packages/mcp-web/playwright.config.ts",
      "packages/mcp-web/package.json"
    ],
    "dependsOn": ["02", "03", "04", "05"]
  },
  {
    "id": "07",
    "title": "Prepare the bounded LAN mini-session protocol",
    "description": "Create a reusable report template with prerequisites, owner plus participant plus agent roles, a timed warm-up, one selected BT-4 mission, observation fields, severity definitions, and stop conditions.",
    "files": [
      "docs/roadmap-web-ui/relatorios/UI-5-MINI-SESSION-TEMPLATE.md"
    ],
    "dependsOn": ["06"]
  },
  {
    "id": "08",
    "title": "Execute the mini-session and triage all friction",
    "description": "Run the 30-minute LAN validation, create the dated report, classify every friction, assign owners, and separate blockers from backlog candidates without expanding scope.",
    "files": [
      "docs/roadmap-web-ui/relatorios/UI-5-MINI-SESSION-YYYY-MM-DD.md"
    ],
    "dependsOn": ["07"]
  },
  {
    "id": "09",
    "title": "Resolve and recheck mini-session blockers",
    "description": "Fix only blocker-level findings, add the smallest regression coverage, rerun the affected block and full parity suite, and record passed rechecks in the session report.",
    "files": [
      "packages/mcp-web/src/",
      "packages/mcp-web/e2e/",
      "docs/roadmap-web-ui/relatorios/UI-5-MINI-SESSION-YYYY-MM-DD.md"
    ],
    "dependsOn": ["08"]
  },
  {
    "id": "10",
    "title": "Record the owner-signed beta resumption decision",
    "description": "Present the completed checklist, CI revision, mini-session report and blocker disposition to the owner; atomically record RESUME or HOLD with signer and date, updating the beta roadmap only for RESUME.",
    "files": [
      "docs/roadmap-web-ui/05-scope-ui-5-paridade-gate.md",
      "docs/roadmap-beta-test/README.md"
    ],
    "dependsOn": ["09"]
  }
]
```

## Section 7 — Cross-Cutting Constraints

- Do not replace human gate approval with automated inference.
- Do not mark a parity item complete without evidence or explicit waiver.
- Keep the mini-session limited to LAN, 30 minutes and one BT-4 mission.
- Keep beta preparation out of this feature.
- Reuse the real server-backed harness for all protocol behavior.
- Treat zero discovered specs, unexpected skips and flaky retries as gate failures.

