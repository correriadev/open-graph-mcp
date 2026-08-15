---
doc_type: adr
domain: architecture
stack: [TypeScript, Bun, SQLite, MCP, React]
node_id: "adr:architecture"
tags: [architecture, design-patterns, folder-structure]
edges:
  - relation: references
    target: "adr:adr"
updated: 2026-08-15
---
# Arquitetura do Projeto

## OVERVIEW

Monorepo TypeScript sobre Bun com núcleo de domínio determinístico, host MCP multi-tenant e adaptadores de cliente. O fluxo principal atravessa domínio puro, serviços persistentes, adapters MCP e transporte HTTP/SSE; SQLite e um espelho JSONL preservam o estado admitido.

## FOLDER STRUCTURE

```text
# CORRECT: visão arquitetural de alto nível; crie cada tipo de arquivo na camada indicada.
open-graph-mcp/
├── packages/graph-core/     # Crie regras puras, indexadores e tipos do protocolo aqui
├── packages/mcp-server/     # Crie persistência, serviços, tools e transportes do host aqui
├── packages/client/         # Crie a API TypeScript compartilhada pelos clientes aqui
├── packages/stdio-proxy/    # Crie integração stdio para agentes MCP aqui
├── packages/claude-plugin/  # Crie hooks, comandos e skills do Claude Code aqui
├── packages/mcp-web/        # Crie a interface React e seus fluxos E2E aqui
├── scripts/verification/    # Crie gates e geradores de evidência aqui
└── docs/                    # Mantenha decisões, features e índices documentais aqui
```

## LAYERS

- **Domínio puro:** aplique invariantes de grafo e EAP sem depender de transporte ou armazenamento.
- **Serviços persistentes:** coordene admissão, promoção, contestação, recall e capabilities por tenant.
- **Adapters MCP:** valide argumentos e traduza recusas; delegue decisões aos serviços de domínio.
- **Transporte:** exponha JSON-RPC em `/mcp`, recursos MCP e eventos vivos em `/events`.
- **Clientes:** consuma MCP/SSE sem duplicar semântica do servidor.
- **Experiência:** apresente grafo, presença e turnos no plugin Claude ou na interface web.

## MODULES

| Module | Responsibility | Location |
|--------|-----------------|----------|
| Graph Core | Indexação determinística, claims, autoridade e protocolo EAP | `packages/graph-core/` |
| MCP Server | Composição, persistência, tools, resources, HTTP e SSE | `packages/mcp-server/` |
| Client | Conexão, reconexão, presença, store e API EAP | `packages/client/` |
| stdio Proxy | Tradução stdio/HTTP, credenciais e sessão viva | `packages/stdio-proxy/` |
| Claude Plugin | Fluxo assistido, hooks e comandos de coordenação | `packages/claude-plugin/` |
| Web | Canvas colaborativo React/React Flow | `packages/mcp-web/` |

## PATTERNS

REQUIRED: **Delegue regras EAP ao composition root** e mantenha adapters finos.

```ts
// CORRECT: resolva serviços por tenant e delegue a decisão.
const services = eapServices(state, tenantId)
return services.promotions.propose(input)

// WRONG: repita no adapter uma regra que já pertence ao domínio.
if (input.level > 3) return { ok: false }
```

REQUIRED: **Execute read-decide-write persistente em `serialTransaction`** e aloque sequências com `allocateSequence`.
PROHIBITED: **Use o espelho JSONL como snapshot completo**; tabelas de sequência e auditoria de capabilities permanecem somente no SQLite.

## INTEGRATIONS

| External Service / Component | Purpose | Connection / Authentication Method |
|------------------------------|---------|-------------------------------------|
| Cliente MCP | Tools e resources governados | JSON-RPC 2.0 via `POST /mcp`; token em argumento de tool |
| Cliente vivo | Presença, heartbeat e eventos | SSE via `GET /events`; sessão registrada |
| SQLite | Estado durável por tenant | `bun:sqlite` local em `STATE_DIR` |
| JSONL | Espelho append-only para auditoria e rebuild parcial | Arquivos locais por tenant |
| Claude Code | Agente de referência | Plugin local + proxy stdio para o endpoint HTTP |
| Browser | Canvas colaborativo | `@open-graph-mcp/client` sobre HTTP/SSE |

## REFERENCES

- [**ADR.md**](./ADR.md): Decisões normativas do OpenGraph e do EAP.
- [**TESTS.md**](./TESTS.md): Estratégias, evidências e comandos de teste.
- [**markdown_impact_relationships.md**](../feature/markdown_impact_relationships.md): Graph v2 e governança dos quatro horizontes.

