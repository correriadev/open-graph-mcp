# @open-graph-mcp/mcp-server

Servidor MCP read-only (Fase 1 do roadmap): bootstrap → query → subscribe.

```bash
GRAPH_REPO_PATH=/path/to/repo bun run dev   # porta 8787 (PORT p/ mudar)
bun test                                     # 7 testes de aceite (spec §9)
```

## Endpoints

- `POST /mcp` — JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`,
  `resources/list`, `resources/read`.
  Tools: `graph.bootstrap`, `graph.query`, `graph.subscribe`, `graph.rebuild`.
  Resources: `graph://snapshot`, `graph://history?since=N`,
  `graph://cell/{domain:level}`, `graph://domain/{domain}`.
- `GET /events?since=N&filter=...` — SSE. Primeiro frame `session.created
  { sessionId, graphId }`; depois tail do log + eventos ao vivo, filtrados
  server-side. Envelope: `{ schemaVersion: 1, seq, ts, kind, target, payload,
  graphId }`.

## Decisões de implementação

- **JSON-RPC à mão, SDK só p/ types.** O transport do `@modelcontextprotocol/sdk`
  é Streamable-HTTP-orientado (express/hono) e briga com `Bun.serve` + o SSE
  próprio. São 5 métodos — o dispatcher manual é menor que a adaptação.
- **`resources/subscribe` não implementado de propósito** (ADR nota 2025):
  streaming é só pelo `/events`. Suporte de clientes MCP a subscriptions é
  irregular; a tool `graph.subscribe` + SSE cobre o caso.
- **Bootstrap fresh = esqueleto estrutural determinístico** (1 record por
  arquivo-fonte, âncora = 1ª linha não-vazia; sem LLM, sem claims, sem β),
  marcado `pipeline: "skeleton"` no snapshot. O pipeline brownfield real é uma
  sessão de agente LLM — não é spawnável de dentro do servidor. Fase 1 prova o
  protocolo, não o pipeline de conhecimento.
- **Estado 100% em memória** (spec §6). Restart → novo `graphId` → cliente
  descarta `since` e refaz snapshot.
