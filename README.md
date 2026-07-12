# open-graph-mcp

Serviço MCP de knowledge graph governado — linha de produto derivada dos
conceitos do [open-graph]. Roadmap completo: `docs/roadmap-mcp/` no repo de
origem (ADR + escopos Fase 1–5).

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
bun test                                     # testes de aceite do servidor
```

## Princípios herdados (non-negotiable)

Núcleo determinístico, LLM na borda · porta única (gate) · verdade no grafo ·
autoridade ganha, não herdada · escada bidirecional · humano nos pontos
irreversíveis.
