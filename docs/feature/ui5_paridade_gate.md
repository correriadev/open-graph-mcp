# UI-5 Paridade e Gate de Retomada

## OVERVIEW

Mantenha a paridade da `mcp-web` como um contrato executável entre capacidades, specs E2E e CI. A implementação cobre validação do manifesto, typing enviado pela web, feed ordenado, recuperação de turno, lifecycle abort/extend, artifact de falha e protocolo de mini-sessão LAN.

## FOLDER STRUCTURE

```text
.github/workflows/
└── ci.yml                                      # executa parity gate e publica artifacts

packages/mcp-web/
├── e2e/
│   ├── activity-feed.e2e.ts                   # valida feed por seq e eventos reais
│   ├── parity-manifest.json                   # P01–P18 e G01–G06 com evidências
│   ├── turn-recovery.e2e.ts                   # reattach, abort e extend
│   └── typing-indicator.e2e.ts                # inclui typing originado na web
├── test/
│   └── parity-manifest.test.ts                # valida cobertura e run não-vazio
└── package.json                               # expõe test:parity

docs/roadmap-web-ui/relatorios/
└── UI-5-MINI-SESSION-TEMPLATE.md              # protocolo LAN e friction ledger
```

## PARITY MANIFEST

| Estado | Regra |
|---|---|
| `proven` | REQUIRED: liste pelo menos um spec existente em `evidence`. |
| `pending` | REQUIRED: mantenha o capability explicitamente não resolvido. |
| `waived` | REQUIRED: registre `signer` e data ISO `YYYY-MM-DD`. |

- REQUIRED: mantenha exatamente `P01`–`P18` e `G01`–`G06`, sem duplicatas.
- REQUIRED: faça cada evidence de item `proven` apontar para um arquivo E2E existente.
- REQUIRED: rejeite execução com zero testes, falhas ou skips.
- PROHIBITED: marque capability como comprovado sem evidência automatizada.

## IMPLEMENTED COVERAGE

| Capability | Evidência técnica |
|---|---|
| Outgoing typing | Ação em input web aparece para outra sessão pelo fluxo real. |
| Activity feed | Eventos aparecem em ordem crescente de `seq`. |
| Turn reattach | Reconnect/reauth restaura changeset ativo e draft sem F5. |
| Abort | Libera locks e remove ghosts após recuperação. |
| Extend | Atualiza expiry/countdown do mesmo changeset. |
| Full parity run | Manifest validator precede Playwright Chromium com um worker. |
| Failure artifacts | CI preserva `test-results` e `playwright-report`. |
| LAN protocol | Template fixa pré-requisitos, roteiro, frictions, rechecks e outcome. |

## CI CONTRACT

1. **Execute** o validator `parity-manifest.test.ts`.
2. **Execute** toda a suíte Playwright em Chromium com `--workers=1`.
3. **Falhe** quando a execução for vazia, falhar ou contiver skips.
4. **Publique** artifacts Playwright em falha para diagnóstico.

```bash
# CORRECT: valida manifesto e suíte integrada completa
bun run --cwd packages/mcp-web test:parity

# WRONG: executa somente o manifesto e omite comportamento de browser
bun test packages/mcp-web/test/parity-manifest.test.ts
```

## LAN SESSION CONTRACT

- REQUIRED: use dono, um participante e um agente Claude Code.
- REQUIRED: limite a sessão a 30 minutos, warm-up e uma missão.
- REQUIRED: registre frictions com severidade, owner, disposição e recheck.
- REQUIRED: corrija e revalide blockers antes de qualquer retomada.
- PROHIBITED: trate o template como evidência de sessão executada.

## OPERATIONAL CONSTRAINTS

- **Admin authorization:** o contrato público do servidor não define papel ou credencial administrativa; `graph.bootstrap` não possui boundary de autorização comprovável. `P18` permanece `pending`.
- **LAN validation:** não existe ata datada de mini-sessão real; participantes, endpoint LAN e evidência humana ainda são necessários.
- **Owner decision:** não existe decisão `RESUME` assinada pelo dono com data e revisão.
- **Beta state:** o roadmap beta permanece adiado e não deve ser retomado automaticamente.

## REFERENCES

| Documento | Relação |
|---|---|
| [UI-2 Turnos E2E](./ui2_turnos_e2e.md) | Define lifecycle, locks, ghosts e recuperação exercitados pela paridade. |
| [UI-3 Leitura e Query](./ui3_leitura_query.md) | Define query gaps, claims e histórico cobertos pelo manifesto. |
| [UI-4 Nós Ricos e Zoom Semântico](./ui4_nos_ricos.md) | Define rich cards, zoom, containers e performance incluídos no gate. |
