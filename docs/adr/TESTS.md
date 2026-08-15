---
doc_type: adr
domain: testing
stack: [Bun Test, Playwright, TypeScript]
node_id: "adr:tests"
tags: [testing, unit-tests, e2e-tests, coverage]
edges:
  - relation: references
    target: "adr:architecture"
updated: 2026-08-15
---
# Testing Protocol

## OVERVIEW

Use Bun Test para domínio, integração e contratos; use Playwright contra build real para os fluxos do browser. Trate typecheck, quarentena, paridade e cobertura EAP como gates explícitos e reproduzíveis, sem substituir evidência por autorrelato.

## COMMANDS

| Type | Command | Description |
|------|---------|-------------|
| Unit/Integration | `bun run test` | Executa as suítes Bun do monorepo |
| Verification | `bun run verify` | Executa o typecheck com baseline e depois as suítes Bun |
| E2E | `bun run --cwd packages/mcp-web test:parity` | Executa paridade da UI e Playwright Chromium |
| Client Node | `bun run --cwd packages/client build` e `node --test packages/client/test/*.test.ts` | Prova o artefato no Node LTS |
| Coverage | `bun scripts/verification/coverage-gate.ts` | Mede e compara o ratchet bloqueante do escopo EAP |
| Quarantine | `bun scripts/verification/quarantine-gate.ts` | Recusa descarga não autorizada de ambiguidades abertas |

## MINIMUM COVERAGE

REQUIRED: Mantenha a figura exata registrada no ratchet; qualquer queda falha e qualquer melhora deve ser medida e registrada no mesmo change.

| Layer | Coverage | Description |
|-------|----------|-------------|
| Client EAP | 100% linhas / 100% funções | `packages/client/src/eap.ts` |
| Protocol Core | 84.35% linhas / 76.79% funções | `packages/graph-core/src/eap` |
| Host EAP | 94.44% linhas / 93.89% funções | `packages/mcp-server/src/eap` |
| Global EAP Scope | 91.93% linhas / 91.02% funções | Baseline medido de 24 arquivos |

## PATTERNS & BEST PRACTICES

REQUIRED: **Use diretórios temporários, SQLite real e a fábrica `startServer`** nos testes de integração.
REQUIRED: **Use knobs determinísticos** para TTL, sweeps e falhas; valide o build real com `vite preview` no E2E.
REQUIRED: **Anote cenários EAP** para manter a rastreabilidade bidirecional e respeite as famílias em quarentena.
PROHIBITED: **Dependa da ordem de execução**, de retry silencioso ou de `sleep` calibrado em timers de produção.
PROHIBITED: **Faça mock do domínio interno** quando uma fixture isolada pode exercitar o caminho real.

## TOOLING

- **Framework:** Bun Test com Bun `1.3.14`; Playwright `1.61.1` para E2E.
- **Assertions:** API `expect` do Bun Test e do Playwright.
- **Mocks/Stubs:** Fábricas locais, bancos temporários e interceptação de browser nas bordas.
- **Coverage:** LCOV do Bun, registrado em `docs/verification/coverage-baseline.json`.
- **CI Integration:** Jobs bloqueantes para tests, typecheck, E2E e coverage; load permanece consultivo.

## TROUBLESHOOTING

- **Flaky tests:** Reexecute o job para confirmar flake e preserve o log; não adicione retry automático silencioso.
- **Debug mode:** Execute `bun test caminho/do/arquivo.test.ts` para isolar Bun Test.
- **E2E local:** Instale Chromium com `bunx playwright install chromium` dentro de `packages/mcp-web` antes de `test:parity`.
- **Coverage:** Consulte `.verification/coverage-gate-run.log` quando o gate não produzir figura.

## REFERENCES

- [**README.md**](../README.md): Índice principal da documentação.
- [**ARCHITECTURE.md**](./ARCHITECTURE.md): Camadas, módulos e padrões do sistema.
- [**ADR.md**](./ADR.md): Decisões de conformidade e verificação por evidência.
