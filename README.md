# open-graph-mcp

[![CI](https://github.com/correriadev/open-graph-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/correriadev/open-graph-mcp/actions/workflows/ci.yml)

Serviço MCP de knowledge graph governado — linha de produto derivada dos
conceitos do [open-graph]. Documentação vigente em [`docs/`](./docs/README.md):
paper normativo, PRD e ADR. Base histórica em `docs/CHANGELOG.md`.

**Estado atual: Fase 1 (MCP read-only)** — bootstrap → query → subscribe,
zero mutação via protocolo.

## Pacotes

| Pacote | O quê |
|---|---|
| `packages/graph-core` | Módulos determinísticos de grafo vendorados do open-graph (ver `PROVENANCE.md`) |
| `packages/mcp-server` | Servidor MCP: JSON-RPC `/mcp` + SSE `/events` (ver README do pacote) |
| `packages/mcp-web` | Cliente web mínimo: Canvas 2D, eventos ao vivo, sem framework |

## Rodar

```bash
bun install
GRAPH_REPO_PATH=/path/to/repo bun run dev   # servidor em :8787
bun run dev:web                              # cliente web (vite; ?server= p/ apontar)
bun run verify                               # ENTRYPOINT local: typecheck + suíte completa
bun run test                                 # só a suíte (idêntica ao job `test` do CI)
```

`bun run verify` é o único comando de verificação local: roda o gate de typecheck contra o
baseline congelado (`docs/verification/typecheck-baseline.json`) e, em seguida, a suíte inteira do
monorepo. `bun run test` é exatamente o que o job `test` do CI executa — mesmo conjunto de arquivos,
mesma contagem. Nenhum script de pacote reduz esse conjunto: `bun run --cwd packages/mcp-server test`
delega para a raiz. Para rodar só um pacote durante o desenvolvimento, use `bun test` dentro do
diretório dele e saiba que isso **não** é o que o gate avalia.

Regras de posse de domínio (usadas pra agrupar nós em células no grafo/UI) vêm da env var
`DOMAINS`, um array JSON — ex. `DOMAINS='[{"pattern":"sdk/*","domain":"sdk"}]'`. Sem ela, todo nó
indexado cai em `(unassigned)`. `pattern` não é glob (`sdk/**` não casa nada) — as quatro formas
suportadas estão em `packages/mcp-server/README.md`.

## Princípios herdados (non-negotiable)

Núcleo determinístico, LLM na borda · porta única (gate) · verdade no grafo ·
autoridade ganha, não herdada · escada bidirecional · humano nos pontos
irreversíveis.
