# @open-graph-mcp/graph-core

Módulos determinísticos de grafo vendorados do `open-graph` — ver
`PROVENANCE.md` para origem e regras de re-sincronização.

## Contribuindo

**Tocou num módulo aqui → deixa um teste unit atrás.** Este pacote é
read-mostly e usado como dependência pura por `packages/mcp-server`'s
`gates.ts` (o gate de autoridade/integridade do protocolo) — uma
regressão silenciosa aqui vaza direto pro comportamento de commit/flip
do servidor, sem nenhum teste de integração do server necessariamente
pegar o caso exato. Regra (QA-4, `docs/roadmap-qa/04-scope-qa-4-graph-core.md`):

- PR que edita um arquivo em `src/` sem teste correspondente em `test/`
  não passa review.
- Não é sprint de cobertura retroativa: só o que a PR TOCA precisa de
  teste, não o módulo inteiro nem os módulos vizinhos.
- `test/` roda via `bun test` (nenhuma dependência de teste nova; ver
  `docs/roadmap-qa/README.md`'s QD3).

Cobertura mínima já garantida (funções que `gates.ts` importa
diretamente): `authority.ts` (`canFlip`), `roundtrip.ts`
(`roundtripScoped`), `verify.ts` (`verifyIntegrity`), `claim-store.ts`
(`claimCoverage`), `extract.ts` (`excerptCheck`).
