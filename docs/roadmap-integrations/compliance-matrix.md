# Matriz de validação — `/mcp` × clientes reais (INT-0)

> Item de DoD do `00-scope-int-0-mcp-compliance.md`: linhas = MCP
> Inspector, SDK TS `Client` + `StreamableHTTPClientTransport`, Claude
> Code (`claude mcp add --transport http`), curl cru; colunas =
> `initialize`, `tools/list`, `tools/call` ok, `tools/call` erro
> (`isError`), `resources/read`. Cada célula ✅/❌ + data + versão do
> cliente.

**Escopo**: prova que o `POST /mcp` (transport.ts, feito à mão) fecha os
5 desvios de spec corrigidos nas Tasks 1-4 desta branch (negociação de
`protocolVersion`, `result.isError` em erro de execução de tool, `GET
/mcp` → 405, header `MCP-Protocol-Version`, validação ativa de `Origin`)
contra clientes de fato — não só contra os próprios testes do servidor.
Duas linhas (curl, SDK TS oficial) foram executadas de verdade nesta
sessão, com comandos e saídas reais abaixo. Duas linhas (MCP Inspector,
Claude Code CLI) ficam **pending-manual**: a primeira por exigir UI de
browser interativa (sem caminho headless limpo neste ambiente
sandboxado), a segunda porque `claude mcp add` mutaria a config
persistente do Claude Code do próprio usuário fora do escopo desta
tarefa — nenhuma das duas foi executada autonomamente.

Servidor testado: `bun run src/index.ts` em `packages/mcp-server`,
`STATE_DIR` temporário, porta efêmera local (`localhost`, sem rede
pública). Repo usado para `graph.bootstrap`/`resources/read`: cópia
temporária de `packages/mcp-server/test/fixtures/fresh` (mesmo fixture
que os testes bun já usam) — nenhum arquivo do repo real foi escrito.

## Matriz

| Cliente | `initialize` | `tools/list` | `tools/call` ok | `tools/call` erro (`isError`) | `resources/read` |
|---|---|---|---|---|---|
| **MCP Inspector** | ❌ pending-manual | ❌ pending-manual | ❌ pending-manual | ❌ pending-manual | ❌ pending-manual |
| **SDK TS `Client` + `StreamableHTTPClientTransport`** (`@modelcontextprotocol/sdk` 1.29.0) | ✅ 2026-07-15 | ✅ 2026-07-15 | ✅ 2026-07-15 | ✅ 2026-07-15 | ✅ 2026-07-15 |
| **Claude Code CLI** (`claude mcp add --transport http`, `claude` 2.1.211) | ❌ pending-manual | ❌ pending-manual | ❌ pending-manual | ❌ pending-manual | ❌ pending-manual |
| **curl cru** (curl 8.14.1) | ✅ 2026-07-15 | ✅ 2026-07-15 | ✅ 2026-07-15 | ✅ 2026-07-15 | ✅ 2026-07-15 |

## Evidência — curl cru (curl 8.14.1)

Servidor local: `STATE_DIR=<tmp> PORT=8799 bun run src/index.ts`.

### `initialize`

```
curl -sS -i -X POST http://localhost:8799/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'
```

```
HTTP/1.1 200 OK
mcp-protocol-version: 2025-06-18
...
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{},"resources":{}},"serverInfo":{"name":"open-graph-mcp","version":"0.1.0"}}}
```

Confirma negociação de `protocolVersion` (Task 1) e eco do header
`MCP-Protocol-Version` (Task 3) no mesmo request.

### `tools/list`

```
curl -sS -i -X POST http://localhost:8799/mcp \
  -H 'content-type: application/json' \
  -H 'mcp-protocol-version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

`HTTP/1.1 200 OK`, header `mcp-protocol-version: 2025-06-18` ecoado de
volta, corpo com os 16 tools registrados (`graph.bootstrap`,
`graph.query`, `session.register`, `authority.flip`, `presence.*`,
`changeset.*` etc.).

### `tools/call` — sucesso

```
curl -sS -i -X POST http://localhost:8799/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"session.register","arguments":{"name":"curl-verify-user"}}}'
```

```
HTTP/1.1 200 OK
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\"token\":\"2148a14f8020fbcade34a86854c0eaaf\",\"userId\":\"u_e80480b7023fa6c4\",\"tenantId\":\"default\"}"}],"structuredContent":{"token":"2148a14f8020fbcade34a86854c0eaaf","userId":"u_e80480b7023fa6c4","tenantId":"default"}}}
```

Sem `isError`, `result.structuredContent` presente — caminho normal.

### `tools/call` — erro de execução → `isError:true`

```
curl -sS -i -X POST http://localhost:8799/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"graph.query","arguments":{"terms":["x"]}}}'
```

```
HTTP/1.1 200 OK
{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"not bootstrapped"}],"isError":true}}
```

`graph.query` antes do bootstrap do tenant lança "not bootstrapped";
chega como `result.isError:true` com `HTTP 200` — **não** vira erro
JSON-RPC (`-32603`), confirmando o desvio de spec fechado na Task 2.

### `resources/read`

Bootstrap primeiro (fixture temporário, fora do repo real):

```
curl -sS -X POST http://localhost:8799/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"graph.bootstrap","arguments":{"repoPath":"<tmp-repo>"}}}'
# → {"result":{"structuredContent":{"graphId":"b506676b967f1ec9","stats":{...,"pipeline":"skeleton"}}}}

curl -sS -i -X POST http://localhost:8799/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":6,"method":"resources/read","params":{"uri":"graph://snapshot"}}'
```

```
HTTP/1.1 200 OK
{"jsonrpc":"2.0","id":6,"result":{"contents":[{"uri":"graph://snapshot","mimeType":"application/json","text":"{\"graphId\":\"b506676b967f1ec9\",\"pipeline\":\"skeleton\",...}"}]}}
```

`graphId` no `resources/read` bate com o `graphId` devolvido pelo
`graph.bootstrap` anterior — round-trip correto.

### Bônus: `GET /mcp` → 405

```
curl -sS -i -X GET http://localhost:8799/mcp
```

```
HTTP/1.1 405 Method Not Allowed
allow: POST
```

Confirma a Task 3 (405 explícito em vez do 404 genérico anterior).

## Evidência — SDK TS `Client` + `StreamableHTTPClientTransport` (`@modelcontextprotocol/sdk` 1.29.0)

Executado como teste bun real (não script descartável) em
`packages/mcp-server/test/sdk-client-compliance.test.ts` — mantido no
repo como teste de regressão permanente, porque exercita o **SDK
oficial** de ponta a ponta sobre HTTP real (não a lógica interna do
servidor, e não o cliente cru de `test/helpers.ts`). Roda junto da
suíte normal (`bun test`).

Sequência exercitada pelo teste, usando os métodos do próprio SDK (não
JSON-RPC cru):

1. `client.connect(transport)` — o SDK faz o handshake `initialize` +
   `notifications/initialized` internamente (não existe
   `client.initialize()` público separado); o teste valida
   `getServerVersion()` e `getServerCapabilities()` depois.
2. `client.listTools()` → confirma `session.register` e `graph.query`
   na lista.
3. `client.callTool({ name: "session.register", ... })` → sucesso,
   `isError` undefined, `structuredContent.token` presente.
4. `client.callTool({ name: "graph.query", arguments: { terms: ["x"] } })`
   **antes** do bootstrap → `isError: true`, mensagem contém "not
   bootstrapped". Confirma que o SDK oficial não trata isso como
   exceção JSON-RPC (ele só lançaria em erro de protocolo real).
5. `client.callTool({ name: "graph.bootstrap", ... })` seguido de
   `client.readResource({ uri: "graph://snapshot" })` → `graphId`
   bate entre os dois.

Resultado real desta sessão:

```
$ cd packages/mcp-server && bun test test/sdk-client-compliance.test.ts
bun test v1.3.14 (0d9b296a)

 1 pass
 0 fail
 11 expect() calls
Ran 1 test across 1 file. [564.00ms]
```

**Achado relevante (não é bug, é confirmação de spec):** ao chamar
`connect()`, o `StreamableHTTPClientTransport` do SDK abre por conta
própria um `GET` no mesmo endpoint tentando um stream SSE
server→cliente opcional. O código-fonte do SDK
(`client/streamableHttp.js`, `_startOrAuthSse`) trata `HTTP 405`
explicitamente como caminho esperado ("*server does not offer an SSE
stream at GET endpoint* ... *should not trigger an error*") e segue
sem erro. Isso é evidência direta e independente de que o `405` da
Task 3 é exatamente o que a spec Streamable HTTP pede — o cliente
oficial já sabe lidar com ele.

## Linhas pending-manual — como completar

### MCP Inspector

Não executado nesta sessão: `@modelcontextprotocol/inspector` sobe uma
UI web interativa (abre browser, requer clique humano por operação);
não há modo headless limpo para automação neste ambiente sandboxado, e
instalar/iniciar um servidor de browser aqui estaria fora do escopo
desta tarefa (documentação + verificação, sem tocar em transporte/rede
adicional).

Comando para um humano rodar:

```bash
# a partir de packages/mcp-server
bun run dev   # sobe o servidor em http://localhost:8787

# em outro terminal
npx @modelcontextprotocol/inspector http://localhost:8787/mcp
```

Abrir a URL impressa pelo Inspector no browser, conectar via
"Streamable HTTP" apontando para `http://localhost:8787/mcp`, e
exercitar manualmente: `initialize` (automático na conexão),
`tools/list`, `tools/call` (`session.register`, depois `graph.query`
sem bootstrap para ver o `isError`), `resources/read` (`graph.bootstrap`
primeiro, depois `graph://snapshot`). Atualizar a célula da matriz com
✅/❌ + data + versão do Inspector (`npx @modelcontextprotocol/inspector
--version` ou a versão resolvida no `npx`).

### Claude Code CLI

Não executado nesta sessão: `claude mcp add` grava a registration do
servidor MCP na config persistente do **Claude Code do próprio
usuário** (fora do escopo local desta task) — mudar isso é uma decisão
do usuário, não algo para uma sessão autônoma decidir por conta
própria. Confirmado apenas `claude mcp add --help` (somente leitura) —
versão instalada nesta sessão: `2.1.211 (Claude Code)`.

Comando para um humano rodar (com o servidor já de pé em
`http://localhost:8787/mcp`, via `bun run dev` em
`packages/mcp-server`):

```bash
claude mcp add open-graph-mcp --transport http http://localhost:8787/mcp
```

Depois, dentro de uma sessão Claude Code com esse servidor registrado,
confirmar que os 5 tools/resource aparecem e respondem via `/mcp` (ou
o comando equivalente de listagem de servidores MCP do Claude Code) —
`initialize`/`tools/list` acontecem no handshake automático da conexão;
exercitar manualmente um `tools/call` de sucesso, um de erro (mesmo
par `session.register` / `graph.query` sem bootstrap usado acima), e
um `resources/read` de `graph://snapshot` depois de um
`graph.bootstrap`. Atualizar a célula da matriz com ✅/❌ + data +
`claude --version`.

## Como reproduzir as linhas já verificadas

```bash
# curl
cd packages/mcp-server
STATE_DIR=$(mktemp -d) PORT=8799 bun run src/index.ts &
# ... comandos curl acima contra http://localhost:8799/mcp ...

# SDK TS Client
cd packages/mcp-server
bun test test/sdk-client-compliance.test.ts
```
