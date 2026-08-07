# @open-graph-mcp/mcp-server

Servidor MCP read-only (Fase 1 do roadmap): bootstrap → query → subscribe.

```bash
GRAPH_REPO_PATH=/path/to/repo bun run dev   # porta 8787 (PORT p/ mudar)
bun test                                     # 7 testes de aceite (spec §9)
```

### Variáveis de ambiente

| Var | Default | Efeito |
|---|---|---|
| `PORT` | `8787` | Porta do `Bun.serve`. |
| `STATE_DIR` | `.graph-server` | Diretório do estado durável (SQLite + JSONL). |
| `WATCH` | `true` | `WATCH=false` desliga o loop de watch. |
| `WATCH_TENANT` | `default` | Tenant que o watch acompanha. |
| `ALLOWED_ORIGINS` | (unset → `*`) | Lista separada por vírgula de Origins permitidas (CORS + guard anti-rebinding). Unset ≠ `""` — `""` fecha tudo. |
| `DOMAINS` | (unset → sem regras) | Regras de posse de domínio como array JSON: `DOMAINS='[{"pattern":"sdk/*","domain":"sdk"}]'`. Sem isto, todo nó indexado cai na célula `(unassigned)`. JSON malformado ou itens sem `pattern`/`domain` (string não-vazia) falham o boot com erro nomeando `DOMAINS` — nunca é ignorado silenciosamente. |

> **`pattern` NÃO é glob.** `matchesPattern` (`graph-core/src/domains.ts`) suporta só quatro formas:
> exato (`src/app.ts`), `prefixo*` (`sdk/*` → todo id que começa com `sdk/`), `*sufixo`
> (`*.test.ts`) e `*meio*` (`*runner*`). Um `**` não tem significado especial: `sdk/**` vira
> `startsWith("sdk/*")` e **não casa nada** — silenciosamente, porque uma regra que não casa é
> indistinguível de não ter regra. Use `sdk/*` para pegar a subárvore inteira (o match é sobre o id
> POSIX completo, então `sdk/*` já cobre `sdk/src/agent-runner/X.ts`).
>
> Verificado em 2026-08-06 indexando um repo real de 186 nós: com
> `[{"pattern":"sdk/*","domain":"sdk"},{"pattern":"agents/*","domain":"agents"},{"pattern":"skills/*","domain":"skills"},{"pattern":"docs/*","domain":"docs"}]`
> a distribuição saiu `sdk:149, skills:21, agents:10, docs:4, (unassigned):2` (os 2 são arquivos da
> raiz, que nenhuma regra cobre). Com `sdk/**` no lugar de `sdk/*`, os 186 ficam `(unassigned)`.

## Endpoints

- `POST /mcp` — JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`,
  `resources/list`, `resources/read`.
  Tools: `graph.bootstrap`, `graph.query`, `graph.subscribe`, `graph.rebuild`.
  Resources: `graph://snapshot`, `graph://history?since=N&limit=N`,
  `graph://claims?id=claimId`, `graph://claims?cell=domain:P4&since=N&limit=N`,
  `graph://claims?scope=snapshot&since=N&limit=N`, `graph://cell/{domain:level}`,
  `graph://domain/{domain}`. Claims and history default to 100 records per page,
  accept at most 500, and return `nextCursor` plus `hasMore`.
  SQLite indexes `(tenant_id, seq)` and `(tenant_id, domain, level, seq)` keep
  snapshot and cell continuation queries aligned with their cursor predicates;
  claim levels are canonicalized to `P<n>` so cell reads use indexed equality.
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
