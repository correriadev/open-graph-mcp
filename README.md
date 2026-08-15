# open-graph-mcp

[![CI](https://github.com/correriadev/open-graph-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/correriadev/open-graph-mcp/actions/workflows/ci.yml)

Servidor MCP de knowledge graph governado e multi-tenant. Indexa repositórios de
forma determinística, coordena presença e turnos de edição, persiste o estado em
SQLite + JSONL e expõe o Epistemic Admission Protocol (EAP) pela mesma superfície MCP.

O servidor não pertence a um único repositório. Cada tenant informa o seu
`repoPath` na primeira chamada a `graph.bootstrap`; o vínculo e as regras de domínio
ficam persistidos em `STATE_DIR` e sobrevivem a reinícios.

## Pacotes

| Pacote | Responsabilidade |
|---|---|
| `packages/graph-core` | Indexação, grafo, claims, autoridade e regras puras do EAP |
| `packages/mcp-server` | Host HTTP: JSON-RPC em `/mcp`, eventos SSE em `/events`, SQLite e JSONL |
| `packages/client` | Cliente TypeScript para MCP, SSE, presença, reconexão e EAP |
| `packages/stdio-proxy` | Ponte stdio → HTTP com credenciais e camada viva para agentes MCP |
| `packages/claude-plugin` | Plugin local do Claude Code com MCP, hooks, skill e comandos de turno |
| `packages/mcp-web` | Interface React/React Flow para consulta e colaboração no grafo |

## Pré-requisitos

- [Bun](https://bun.sh/) `1.3.14` (versão fixada em `package.json` e no CI).
- Claude Code atualizado e autenticado para testar o plugin.
- Git Bash no Windows; `curl` e `jq` habilitam os hooks auxiliares do plugin.
  Sem eles, o MCP continua funcionando, mas os hooks falham silenciosamente.

## Rodar localmente

```powershell
# CORRECT: execute na raiz deste checkout.
bun install --frozen-lockfile
bun run dev
```

O servidor sobe por padrão em `http://127.0.0.1:8787`, inicialmente sem grafo.
Não defina `GRAPH_REPO_PATH`: essa variável pertence ao modelo antigo e não é mais
lida pelo servidor.

Para atribuir arquivos a domínios no primeiro bootstrap:

```powershell
# CORRECT: `pattern` aceita prefixo com um único `*`; não é glob.
$env:DOMAINS='[{"pattern":"packages/mcp-server/*","domain":"server"},{"pattern":"packages/graph-core/*","domain":"core"}]'
bun run dev
```

Sem `DOMAINS`, os nós são indexados em `(unassigned)`. Consulte
[`packages/mcp-server/README.md`](./packages/mcp-server/README.md) para todas as
variáveis e para o contrato de tools/resources.

## Testar com Claude Code

Mantenha `bun run dev` aberto em um terminal. Em outro terminal, na raiz deste
checkout, carregue o plugin diretamente — ele ainda depende do `stdio-proxy` vizinho
no monorepo e não está publicado no npm:

```powershell
# CORRECT: carregamento local do plugin durante o desenvolvimento.
claude --plugin-dir "$PWD/packages/claude-plugin"
```

Ao iniciar, informe:

| Campo | Valor local |
|---|---|
| `server` | `http://localhost:8787` |
| `name` | Um nome de usuário para presença, turnos e auditoria |

Na primeira sessão, peça ao Claude para chamar `graph.bootstrap` com o caminho
absoluto do repositório que será indexado. O proxy registra a sessão e injeta o token
automaticamente. Depois valide a integração:

1. Execute `/open-graph:who` para conferir presença.
2. Peça uma `graph.query` sobre um módulo conhecido.
3. Execute `/open-graph:turno server:4 "teste com Claude Code"` para abrir um turno.
4. Finalize com `/open-graph:abort` ou `/open-graph:commit`.

Use `/mcp` no Claude Code para confirmar que `open-graph` está conectado. Detalhes do
plugin, hooks e statusline estão em
[`packages/claude-plugin/README.md`](./packages/claude-plugin/README.md).

## Interface web

Com o servidor ativo, rode:

```powershell
# CORRECT: inicia o Vite em outro terminal.
bun run dev:web
```

Se necessário, passe `?server=http://localhost:8787` na URL da interface.

## Verificação

| Comando | O que verifica |
|---|---|
| `bun run verify` | Gate de typecheck contra o baseline congelado + suítes `bun test` |
| `bun run test` | Suítes Bun do monorepo, sem o E2E Playwright separado |
| `bun run --cwd packages/mcp-web test:parity` | Paridade da UI + E2E Chromium |
| `bun scripts/verification/quarantine-gate.ts` | Violações das ambiguidades em quarentena |
| `bun scripts/verification/coverage-gate.ts` | Ratchet bloqueante da cobertura EAP |

O CI também prova o pacote `client` no Node LTS e executa carga de forma consultiva
em pull requests para `main`.

## Princípios

Núcleo determinístico, LLM na borda · porta única (gate) · verdade no grafo ·
autoridade ganha, não é herdada · escada bidirecional · humano nos pontos
irreversíveis.

Documentação normativa, arquitetura e estado de desenvolvimento estão em
[`docs/`](./docs/README.md).
