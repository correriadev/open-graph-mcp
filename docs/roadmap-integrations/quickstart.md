# Quickstart — conectando ao open-graph-mcp

> Fecha o último item do DoD de `01-scope-int-1-connection-kit.md`.
> Honestidade > cobertura: cada bloco abaixo diz explicitamente se foi
> testado de verdade (e quando) ou só documentado a partir do formato
> conhecido do cliente na data indicada.

O open-graph-mcp fala **MCP puro sobre HTTP** (`POST /mcp`, JSON-RPC 2.0).
Isso significa que **qualquer cliente MCP genérico já funciona sem plugin
nenhum** — os blocos por cliente abaixo são só o "como aponto meu cliente
pra cá", não pré-requisito pra usar o server.

**Índice** — [1. Quickstart genérico](#1-quickstart-genérico-qualquer-cliente-mcp) ·
[2. Por cliente](#2-por-cliente):
[2.1 Claude Code](#21-claude-code) (testado) ·
[2.2 opencode](#22-opencode) (testado) ·
[2.3 Cursor](#23-cursor--documentado-não-verificado-2026-07-16) ·
[2.4 Windsurf](#24-windsurf--documentado-não-verificado-2026-07-16) ·
[2.5 Copilot](#25-github-copilot-vs-code-agent-mode--cli--documentado-não-verificado-2026-07-16) ·
[2.6 Zed](#26-zed--documentado-não-verificado-2026-07-16) ·
[2.7 Gemini CLI](#27-gemini-cli--documentado-não-verificado-2026-07-16) ·
[3. Resumo de verificação](#3-resumo-de-verificação)

Só quer conectar um cliente específico? Pule direto pro bloco dele em §2 —
a §1 é só necessária se você quer entender o protocolo por baixo do plugin.

---

## 1. Quickstart genérico (qualquer cliente MCP)

### 1.1 Suba o server localmente

Da raiz do monorepo:

```bash
cd packages/mcp-server
GRAPH_REPO_PATH=/caminho/do/seu/repo PORT=8799 bun run dev
# ou, direto: bun run src/index.ts
```

(Porta `8799` acima é só pra bater com os exemplos abaixo, que foram
capturados contra essa porta — use qualquer porta livre, é só trocar `8799`
em todos os `curl`/configs deste documento pela sua.)

`GRAPH_REPO_PATH` é opcional — sem ele o server sobe "pure-knowledge" (sem
bootstrap automático; chame `graph.bootstrap` manualmente depois). Com ele
setado, o server faz auto-bootstrap na subida: se `.graph/graph.json`
existir usa ele, senão gera um esqueleto estrutural determinístico (1
record por arquivo-fonte) e **grava um `.graph/` novo dentro do
`GRAPH_REPO_PATH` alvo** (side effect real no disco, não só em memória) —
aponte pra um repo de teste/scratch se não quiser esse diretório aparecendo
como untracked no seu repo real. `STATE_DIR` (default `.graph-server`)
controla onde fica o SQLite + espelho JSONL. Ainda não há build publicado —
hoje `bun run dev`/`bun run src/index.ts` é o único jeito de rodar.

O server responde em `http://localhost:<PORT>` (default `8787`); o endpoint
JSON-RPC é `POST http://localhost:<PORT>/mcp`.

Os exemplos abaixo foram **rodados de verdade** contra uma instância local
(`GRAPH_REPO_PATH` apontando pra `packages/mcp-server/src` deste repo, porta
`8799`) em 2026-07-16 — não é output plausível, é output real copiado do
terminal.

### 1.2 `initialize` (handshake MCP puro, via curl)

```bash
curl -s http://localhost:8799/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"quickstart-curl","version":"0.1"}}}'
```

Resposta real:

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{},"resources":{}},"serverInfo":{"name":"open-graph-mcp","version":"0.1.0"}}}
```

O `protocolVersion` é negociado (INT-0): se o cliente pedir uma versão que o
server suporta, o server ecoa ela de volta; senão devolve a mais recente que
suporta.

### 1.3 `session.register` — toda tool de mutação exige um `token`

`session.register` é ela mesma uma **tool** — chamada via `tools/call`, não
um método JSON-RPC próprio. Esse é o "formato genérico de `tools/call`" que
todo cliente MCP (com ou sem plugin) usa pra chamar qualquer tool deste
server:

```bash
curl -s http://localhost:8799/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"session.register","arguments":{"name":"Alice","tenant":"acme"}}}'
```

Resposta real:

```json
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"token\":\"bd8356061cc1a17b4da1516d2336d81a\",\"userId\":\"u_b27af43349d7ba3d\",\"tenantId\":\"acme\"}"}],"structuredContent":{"token":"bd8356061cc1a17b4da1516d2336d81a","userId":"u_b27af43349d7ba3d","tenantId":"acme"}}}
```

`tenant` é opcional (default `"default"`). O `token` é **em memória no
server** — some num restart (spec §9) — e é o que você passa em `token` para
toda tool que precisar de identidade (changesets, presence, etc). Um
`session.register` repetido com o mesmo `name`/`tenant` reusa o mesmo
`userId` (determinístico) e emite um `token` novo.

> Nota sobre o exemplo acima: registramos sob o tenant `"acme"` só pra
> mostrar o parâmetro `tenant`. Os exemplos seguintes (`graph.query`, o
> turno de changeset) usam um segundo registro sob o tenant `"default"`,
> porque é onde o `GRAPH_REPO_PATH` foi bootstrapado.

### 1.4 `graph.query` — sem precisar de token

```bash
curl -s http://localhost:8799/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"graph.query","arguments":{"terms":["session"]}}}'
```

Resposta real (contra o esqueleto gerado a partir de
`packages/mcp-server/src`):

```json
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\"candidates\":[{\"id\":\"tools/session.ts\",\"domain\":null,\"layer\":\"P4\",\"subject\":\"tools/session.ts\",\"file\":\"tools/session.ts\",\"anchor\":\"/**\",\"score\":1}],\"gaps\":[]}"}],"structuredContent":{"candidates":[{"id":"tools/session.ts","domain":null,"layer":"P4","subject":"tools/session.ts","file":"tools/session.ts","anchor":"/**","score":1}],"gaps":[]}}}
```

Um termo sem match nenhum vira um **gap** (load-bearing — é como o cliente
aprende a perguntar melhor em vez de assumir):

```bash
curl -s http://localhost:8799/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"graph.query","arguments":{"terms":["zzznope"]}}}'
```

```json
{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"{\"candidates\":[],\"gaps\":[\"zzznope\"]}"}],"structuredContent":{"candidates":[],"gaps":["zzznope"]}}}
```

### 1.5 Um turno completo: `changeset.open` → `changeset.claim` → `changeset.commit`

Todo turno "vivo" segue essa sequência fixa (`packages/mcp-server/src/tools/changeset.ts`):
abrir um changeset travando as células (β/novas) que você vai tocar, empilhar
deltas (`claim.add` / `authority.flip`), e então commitar — o commit roda um
gate final atômico: se algo quebrar, **nada** é admitido (rollback total, o
changeset vira `aborted`).

Registro (tenant `default`, onde o grafo está bootstrapado):

```bash
curl -s http://localhost:8799/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"session.register","arguments":{"name":"Alice"}}}'
```

```json
{"jsonrpc":"2.0","id":5,"result":{"content":[{"type":"text","text":"{\"token\":\"69e02174c2241f8f18930c7d6387104a\",\"userId\":\"u_de3ccb4f291c6d94\",\"tenantId\":\"default\"}"}],"structuredContent":{"token":"69e02174c2241f8f18930c7d6387104a","userId":"u_de3ccb4f291c6d94","tenantId":"default"}}}
```

**`changeset.open`** — trava a(s) célula(s) (`cells` no formato
`domínio:nível`; reusa o changeset se você já for o dono das mesmas
células):

```bash
curl -s http://localhost:8799/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"changeset.open","arguments":{"token":"69e02174c2241f8f18930c7d6387104a","cells":["docs:5"],"intent":"quickstart demo"}}}'
```

```json
{"jsonrpc":"2.0","id":6,"result":{"content":[{"type":"text","text":"{\"ok\":true,\"csId\":\"cs_ac16c5b43526b4c7\",\"expiresAt\":\"2026-07-16T14:54:56.211Z\"}"}],"structuredContent":{"ok":true,"csId":"cs_ac16c5b43526b4c7","expiresAt":"2026-07-16T14:54:56.211Z"}}}
```

**`changeset.claim`** — empilha um delta (`claim.add` aqui; o gate
incremental só *avisa* em warnings, não bloqueia neste passo):

```bash
curl -s http://localhost:8799/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"changeset.claim","arguments":{"token":"69e02174c2241f8f18930c7d6387104a","csId":"cs_ac16c5b43526b4c7","delta":{"kind":"claim.add","payload":{"id":"quickstart-node-1","subject":"quickstart-node-1","domain":"docs","level":5,"refs":[]}}}}}'
```

```json
{"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"{\"ok\":true,\"warnings\":[]}"}],"structuredContent":{"ok":true,"warnings":[]}}}
```

**`changeset.commit`** — roda o gate final e admite atomicamente (ou aborta
tudo com `reasons`):

```bash
curl -s http://localhost:8799/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"changeset.commit","arguments":{"token":"69e02174c2241f8f18930c7d6387104a","csId":"cs_ac16c5b43526b4c7"}}}'
```

```json
{"jsonrpc":"2.0","id":8,"result":{"content":[{"type":"text","text":"{\"ok\":true,\"admitSeq\":4}"}],"structuredContent":{"ok":true,"admitSeq":4}}}
```

Outras tools de changeset: `changeset.abort` (descarta e libera locks),
`changeset.extend` (renova TTL) e `changeset.list_mine` (reattach depois de
reconectar).

### 1.6 Modelo de token quando você usa o proxy stdio (`@open-graph-mcp/stdio`)

Tudo acima (§1.3–1.5) é o caminho **HTTP direto**: você mesmo chama
`session.register` e passa `token` em cada `arguments` que precisar dele —
é o que qualquer cliente MCP genérico (sem conhecer o produto) já consegue
fazer sozinho.

Clientes que só falam stdio passam pelo proxy `@open-graph-mcp/stdio`
(bloco de cada cliente na seção 2). O proxy tem dois modos:

- **Sem `--name`**: pass-through puro. Ele repassa `tools/call` pro `/mcp`
  igualzinho o que você mandou — se a tool exigir `token`, você ainda
  precisa registrar e passar `token` você mesmo, como em §1.3.
- **Com `--name <você> [--tenant <t>]`**: bootstrap automático de token.
  Na primeira `tools/call` cujo `inputSchema` declare `token` e cujos
  `arguments` não o tragam, o proxy chama `session.register` sozinho,
  persiste `{server, token, userId}` em `~/.open-graph-mcp/credentials.json`
  (0600) e **injeta o `token` automaticamente** — o agente/cliente nunca
  precisa saber que autenticação existe. Se o token expirar (ex.: restart
  do server), o proxy re-registra com o mesmo `--name`/`--tenant` e repete
  a chamada uma vez, logando cada injeção/re-registro em stderr.

Isso é a "conexão sem precisar entender o produto" que o proxy existe pra
entregar — use `--name` sempre que o cliente stdio não tiver um jeito nativo
de passar `token` pra cada chamada. Ver `packages/stdio-proxy/src/cli.ts`
e `packages/stdio-proxy/test/cli.test.ts` para o comportamento exato
(coberto por teste automatizado: initialize/tools-list/tools-call via
stdio contra um server real, incluindo o caminho de injeção e re-registro).

---

## 2. Por cliente

| Cliente | Status |
|---|---|
| Claude Code | ✅ testado 2026-07-16 |
| opencode | ✅ testado 2026-07-16 |
| Cursor | documentado, não verificado |
| Windsurf | documentado, não verificado |
| Copilot (VS Code) | documentado, não verificado |
| Zed | documentado, não verificado |
| Gemini CLI | documentado, não verificado |

Cada bloco mostra o formato de config vigente na data indicada. Onde
aplicável, a alternativa **stdio via proxy** (`@open-graph-mcp/stdio`)
também é mostrada — ela ainda **não está publicada no npm** (isso é
INT-6), então até lá o comando stdio aponta pra um caminho local do
monorepo em vez de `bunx @open-graph-mcp/stdio`. Trocar
`/path/to/open-graph-mcp` pelo caminho real do checkout quando for usar.
Os exemplos stdio abaixo incluem `--name <você>` — isso liga o bootstrap
automático de token do proxy (§1.6); sem ele, o cliente ainda precisaria
saber chamar `session.register` e passar `token` sozinho.

### 2.1 Claude Code

**Verificado de verdade em 2026-07-16** contra uma instância local
(`http://localhost:8799`). Registro:

```bash
claude mcp add --transport http open-graph http://localhost:8799/mcp
```

`claude mcp list` confirmou `open-graph: http://localhost:8799/mcp (HTTP) -
✔ Connected` logo em seguida, e foi removido depois com
`claude mcp remove open-graph -s local` (config conferido idêntico ao
estado anterior ao teste).

Para o server publicado (não localhost), o comando é o mesmo trocando a URL:

```bash
claude mcp add --transport http open-graph https://<seu-host>/mcp
```

**Alternativa stdio via proxy** (ainda não publicado — ver nota acima). O
comando `claude mcp add ... -- ...` em si **não foi exercitado de verdade**
contra o Claude Code real (só o transporte HTTP acima foi); o proxy stdio
por trás dele, sim — é exercitado pela suíte de testes de
`packages/stdio-proxy/test/cli.test.ts` (initialize/tools-list/tools-call
via stdio contra um server real, incluindo `--name`):

```bash
claude mcp add open-graph -- bun run /path/to/open-graph-mcp/packages/stdio-proxy/src/cli.ts --server https://<seu-host> --name <você>
```

Depois de publicado (INT-6), isso vira:

```bash
claude mcp add open-graph -- bunx @open-graph-mcp/stdio --server https://<seu-host> --name <você>
```

### 2.2 opencode

**Verificado de verdade em 2026-07-16** contra a mesma instância local.
Registro:

```bash
opencode mcp add open-graph --url http://localhost:8799/mcp
```

Isso grava em `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "open-graph": {
      "type": "remote",
      "url": "http://localhost:8799/mcp"
    }
  }
}
```

`opencode mcp list` confirmou `✓ open-graph connected`. **Importante:** a
CLI do opencode (na versão testada, 1.17.18) não tem um subcomando de
remoção (`opencode mcp --help` só lista `add`, `list`, `auth`, `logout`,
`debug` — sem `remove`/`rm`); pra desfazer o teste, o arquivo de config foi
restaurado manualmente pro conteúdo exato de antes.

Para o server publicado:

```bash
opencode mcp add open-graph --url https://<seu-host>/mcp
```

opencode fala HTTP nativamente — não precisa do proxy stdio para o caso
comum. Se algum ambiente do opencode só aceitar stdio, o formato de entrada
manual em `opencode.jsonc` seria:

```jsonc
{
  "mcp": {
    "open-graph": {
      "type": "local",
      "command": ["bun", "run", "/path/to/open-graph-mcp/packages/stdio-proxy/src/cli.ts", "--server", "https://<seu-host>", "--name", "<você>"]
    }
  }
}
```

(Essa forma stdio-local NÃO foi exercitada de verdade — só o `type: "remote"`
acima foi. Formato inferido do schema `type: "local"`/`command` documentado
pelo opencode; confira `opencode mcp add --help` na sua versão antes de
confiar cegamente.)

### 2.3 Cursor — documentado, não verificado (2026-07-16)

Cursor lê `.cursor/mcp.json` na raiz do projeto (ou `~/.cursor/mcp.json`
globalmente). Cursor fala stdio nativamente; HTTP é suportado em versões
recentes via `"url"` — se o seu Cursor for antigo, use a forma stdio.

Via proxy stdio (funciona em qualquer versão):

```json
{
  "mcpServers": {
    "open-graph": {
      "command": "bun",
      "args": ["run", "/path/to/open-graph-mcp/packages/stdio-proxy/src/cli.ts", "--server", "https://<seu-host>", "--name", "<você>"]
    }
  }
}
```

Via HTTP direto (se sua versão do Cursor suportar `"url"` em `mcp.json`):

```json
{
  "mcpServers": {
    "open-graph": {
      "url": "https://<seu-host>/mcp"
    }
  }
}
```

### 2.4 Windsurf — documentado, não verificado (2026-07-16)

Windsurf lê `mcp_config.json` (Windsurf Settings → Cascade → MCP Servers,
ou diretamente em `~/.codeium/windsurf/mcp_config.json`). Formato igual ao
padrão `mcpServers`/`command`/`args` (mesma família de convenção do
Claude Desktop):

```json
{
  "mcpServers": {
    "open-graph": {
      "command": "bun",
      "args": ["run", "/path/to/open-graph-mcp/packages/stdio-proxy/src/cli.ts", "--server", "https://<seu-host>", "--name", "<você>"]
    }
  }
}
```

### 2.5 GitHub Copilot (VS Code agent mode / CLI) — documentado, não verificado (2026-07-16)

No VS Code (agent mode), o arquivo é `.vscode/mcp.json` (workspace) ou via
comando "MCP: Add Server". Copilot no VS Code suporta transporte HTTP
diretamente:

```json
{
  "servers": {
    "open-graph": {
      "type": "http",
      "url": "https://<seu-host>/mcp"
    }
  }
}
```

Alternativa stdio (via proxy), mesmo arquivo:

```json
{
  "servers": {
    "open-graph": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/path/to/open-graph-mcp/packages/stdio-proxy/src/cli.ts", "--server", "https://<seu-host>", "--name", "<você>"]
    }
  }
}
```

### 2.6 Zed — documentado, não verificado (2026-07-16)

Zed usa "context servers" em `settings.json` (`Zed: Open Settings`), sob a
chave `context_servers`. Zed fala stdio para context servers — use o proxy:

```json
{
  "context_servers": {
    "open-graph": {
      "command": {
        "path": "bun",
        "args": ["run", "/path/to/open-graph-mcp/packages/stdio-proxy/src/cli.ts", "--server", "https://<seu-host>", "--name", "<você>"]
      }
    }
  }
}
```

### 2.7 Gemini CLI — documentado, não verificado (2026-07-16)

> Nota de processo: `gemini` está instalado nesta máquina, mas este bloco
> foi escrito só a partir do formato de config conhecido — **nenhum
> comando `gemini mcp *` foi executado e nenhum arquivo de config do Gemini
> CLI foi tocado** durante a escrita deste documento (autorização deste
> quickstart cobriu só Claude Code + opencode).

Gemini CLI lê `mcpServers` em `settings.json` (`~/.gemini/settings.json`
para global, ou `.gemini/settings.json` no projeto). Formato:

```json
{
  "mcpServers": {
    "open-graph": {
      "httpUrl": "https://<seu-host>/mcp"
    }
  }
}
```

Alternativa stdio (via proxy):

```json
{
  "mcpServers": {
    "open-graph": {
      "command": "bun",
      "args": ["run", "/path/to/open-graph-mcp/packages/stdio-proxy/src/cli.ts", "--server", "https://<seu-host>", "--name", "<você>"]
    }
  }
}
```

---

## 3. Resumo de verificação

| Cliente | Status | Data |
|---|---|---|
| Claude Code | testado (HTTP transport, register + list + remove) | 2026-07-16 |
| opencode | testado (`--url` remote, list, cleanup manual do config) | 2026-07-16 |
| Cursor | documentado, não verificado | 2026-07-16 |
| Windsurf | documentado, não verificado | 2026-07-16 |
| Copilot (VS Code) | documentado, não verificado | 2026-07-16 |
| Zed | documentado, não verificado | 2026-07-16 |
| Gemini CLI | documentado, não verificado | 2026-07-16 |

Formatos de config de cliente mudam entre releases — revalide por release
(risco transversal 4 do `README.md` do roadmap).
