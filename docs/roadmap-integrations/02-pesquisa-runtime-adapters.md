# Pesquisa — Runtime Adapters do open-design (uso do agente já instalado)

> Data: 2026-07-31. Autor: pesquisa assistida, sob pedido do proprietário.
> Status: **pesquisa congelada** — sem código alterado em open-graph-mcp.
> Fonte: clone raso (`--depth 1`) de `https://github.com/nexu-io/open-design`
> em `C:\Users\User\Documents\open-design`, commit `517f39acde402c1a7af2189167a8d6957a3dac71`
> (2026-07-31). Todas as citações `arquivo:linha` abaixo referem-se a esse
> commit desse clone.

---

## 0. Objetivo

Entender como o daemon do open-design executa turnos de chat usando o CLI
de codificação **já instalado na máquina do usuário** (Claude Code,
OpenCode, Codex, etc.) em vez de exigir API key própria do produto, e
avaliar quanto desse desenho é portável para o open-graph-mcp — hoje um
servidor MCP (`packages/mcp-server`, JSON-RPC + SSE sobre `Bun.serve`) que
**não** executa nenhum agente: ele serve grafo e recebe mutação por tool
chamada por um agente externo.

---

## 1. Achado principal

Não existe um único arquivo "runtime adapter". Existe uma pasta
`apps/daemon/src/runtimes/` com **41 arquivos** (~380 KB de TypeScript) e um
`server.ts` de ~8700 linhas que contém o pipeline de spawn real. O arquivo
âncora do pedido, `opencode-log.ts`, é o menor e mais específico de todos:
ele **não** é o parser do stream ao vivo — é um recuperador post-mortem que
lê o log em disco que o próprio OpenCode escreve, usado só quando o
processo trava silenciosamente. O parser do stream ao vivo é outro arquivo
(`json-event-stream.ts`, 30 KB). Essa distinção é o primeiro ponto que
merece registro porque o pedido original presumia que "opencode-log.ts"
fosse o parser de stream.

A abstração comum entre os ~26 runtimes é o tipo `RuntimeAgentDef`
(`apps/daemon/src/runtimes/types.ts:112-260`), uma struct declarativa com
função `buildArgs` e um campo `streamFormat` (string) que o `server.ts`
usa como chave de despacho para um de ~8 parsers diferentes. Não há uma
interface polimórfica única "um adapter, um `.run()`" — é uma tabela de
configuração + um `switch` central gigante em `server.ts`.

---

## 2. Inventário de runtimes e como cada um é detectado

### 2.1 Lista de defs (`apps/daemon/src/runtimes/registry.ts:30-57`)

`BASE_AGENT_DEFS` registra 26 agentes: `amr`, `claude`, `codex`, `devin`,
`opencode`, `byok-opencode`, `hermes`, `trae-cli`, `grok-build`, `kimi`,
`cursor-agent`, `qwen`, `qoder`, `copilot`, `amp`, `pi`, `kiro`, `kilo`,
`vibe`, `deepseek`, `aider`, `antigravity`, `reasonix`, `codebuddy`,
`mimo`, `atomcode`. Cada um vive em `apps/daemon/src/runtimes/defs/<id>.ts`
e é importado individualmente — sem carregamento dinâmico por diretório.
Além da base, `readLocalAgentProfileDefs()` (`registry.ts:59-67`,
implementado em `local-profiles.ts`) injeta **perfis locais definidos pelo
usuário** derivados de um adapter base — ex.: apontar `claude` para um
binário `openclaude` custom sem editar código (`local-profiles.ts`).
`registry.ts:70-76` garante ids únicos com `throw` em tempo de import se
duas defs colidirem.

### 2.2 Detecção (`apps/daemon/src/runtimes/detection.ts`)

Fluxo por agente, em `probe()` (`detection.ts:238-318`):

1. `resolveAgentLaunch(def, configuredEnv)` (`launch.ts:15-37`) resolve o
   binário: PATH-walk via `resolveOnPath()`/`inspectAgentExecutableResolution`
   (`executables.ts:130`, `:321`), respeitando um env var de override por
   agente (`agentBinEnvKey`, `executables.ts:125`, ex. `CLAUDE_BIN`,
   `CODEX_BIN`) e uma lista de `fallbackBins` na def (ex. `claude.ts:24`
   tenta `openclaude` se `claude` não estiver no PATH). Para `codex`
   especificamente, há uma segunda camada que troca o wrapper Node
   descoberto pelo binário nativo empacotado (`launch.ts:29,88-150`).
2. Se não resolveu path → `unavailableAgent()` com diagnóstico
   (`detection.ts:252-253`, `269-273`) — o agente aparece na UI como "não
   instalado", nunca é spawnado.
3. Se resolveu → probe de versão via `execFile(bin, def.versionArgs)`
   (`detection.ts:146-175`, ex. `['--version']`), com timeout (default
   3000 ms, `versionProbeTimeoutMs`). `probeVersionAtPath` distingue
   `EACCES`/exit 126 ("não executável") de `ENOENT`/exit 127 ("alvo
   ausente") para diagnóstico específico (`detection.ts:159-174`).
4. Em paralelo (`Promise.all`, `detection.ts:279-284`): probe de
   `--help` para capability flags (`probeCapabilities`, `:214-236`,
   ex. `claude.ts:31-39` detecta se o `claude` instalado suporta
   `--include-partial-messages`/`--add-dir` fazendo grep no texto do
   `--help`), listagem/fetch de modelos (`fetchModels`/`listModels` —
   ex. `opencode.ts:21-25` roda `opencode models` e faz parse
   linha-a-linha), e **probe de autenticação declarativo** via
   `authProbe` (`types.ts:216-232`, ex. `claude.ts:26-29` roda
   `claude auth status`; `auth.ts` classifica o texto de saída em
   `ok`/`missing`/`unknown`).
5. `safeProbe()` (`detection.ts:350-366`) isola falhas por agente: uma
   exceção em um probe não derruba a lista inteira (`/api/agents`
   retornava `[]` antes desse guard — issue #2297 citada no comentário).

Detecção roda tanto em lote (`detectAgents`, `:384-399`) quanto em stream
incremental (`detectAgentsStream`, `:407-424`, um `AsyncGenerator` que
resolve em ordem de conclusão, não de registro, para a UI pintar cada
card assim que chega).

---

## 3. Como o processo é lançado e a saída é consumida

### 3.1 Spawn (`apps/daemon/src/server.ts`)

O spawn real acontece em `server.ts:6787-6797`:

```ts
child = spawn(invocation.command, invocation.args, {
  env,
  stdio: [stdinMode, 'pipe', 'pipe'],
  cwd: effectiveCwd,
  shell: false,
  detached: process.platform !== 'win32',
  windowsVerbatimArguments: invocation.windowsVerbatimArguments,
});
```

- `stdinMode` é `'pipe'` quando `def.promptViaStdin` ou o adapter fala
  `acp-json-rpc`, senão `'ignore'` (`server.ts:6746-6749`).
- `args` vem de `def.buildArgs(prompt, imagePaths, extraAllowedDirs,
  options, runtimeContext)` (assinatura em `types.ts:129-135`; chamada em
  `server.ts:6279`), uma função por-adapter que monta o argv. Ex.
  `opencode.ts:45-70` monta `['run', '--format', 'json', ...]`;
  `claude.ts:52-89` monta `['-p', '--input-format', 'stream-json',
  '--output-format', 'stream-json', '--verbose', ...]`.
- `env` é composto em camadas: env do processo do daemon +
  `createAgentRuntimeEnv()` + `def.env` (env fixo por adapter) + env de
  browser-use + env de MCP externo injetado (`OPENCODE_CONFIG_CONTENT` /
  `MIMOCODE_CONFIG_CONTENT`, `server.ts:6765-6777`) + PATH ajustado por
  `applyAgentLaunchEnv` (`launch.ts:39-86`, prepend do dir do Node em uso
  e do dir do binário resolvido, append dos dirs de toolchain do usuário
  — necessário porque um app com GUI no macOS/Windows herda um PATH
  mínimo, não o do shell do usuário).
- `cwd` é `effectiveCwd` — o diretório do projeto do usuário, não o do
  daemon.
- `shell: false` sempre — nunca passa por `cmd.exe`/`sh` (evita
  reinterpretação de argv), exceto quando `invocation` decide envolver um
  `.cmd`/`.bat` do Windows explicitamente (daí o
  `windowsVerbatimArguments`, comentário em `server.ts:6793-6796`
  referencia a issue #315 sobre paths com espaço).
- Entrega do prompt: **stdin é o caminho universal por padrão**
  (`server.ts:6744-6749` comentário: "Prompt delivery via stdin is now
  the universal default. This bypasses both the cmd.exe 8KB limit and the
  CreateProcess 32KB limit"). Só quando `promptViaFile` está setado o
  adapter lê de um arquivo temporário que o daemon cria antes do
  `buildArgs` e remove depois (`types.ts:150-153`). Argv puro (sem stdin
  nem arquivo) é o caso residual para adapters sem flag de prompt-file
  nem leitura de stdin.

### 3.2 Consumo de saída — 8 formatos, um `switch` em `server.ts`

O despacho por `def.streamFormat` (constantes usadas: `'plain'`,
`'claude-stream-json'`, `'qoder-stream-json'`, `'copilot-stream-json'`,
`'pi-rpc'`, `'acp-json-rpc'`, `'json-event-stream'`) acontece a partir de
`server.ts:7516` até `~7845`. Cada branch:

- `'claude-stream-json'` (`server.ts:7516`): parser dedicado em
  `claude-stream.ts` (26 KB) para o formato Claude Code
  `--output-format stream-json`.
- `'json-event-stream'` (`server.ts:7790-7802`): usado por `opencode` e
  `byok-opencode` (`opencode.ts:78-79`, `byok-opencode.ts:33-34`, ambos
  `eventParser: 'opencode'`). `createJsonEventStreamHandler(def.eventParser
  || def.id, sendAgentEvent)` (`json-event-stream.ts`) é alimentado por
  `child.stdout.on('data', chunk => handler.feed(chunk))` e drenado em
  `child.on('close', () => handler.flush())` — isto é **streaming
  incremental do stdout ao vivo do processo**, não leitura de arquivo de
  log. `json-event-stream.ts` implementa parsers para múltiplos
  `ParserKind` (cursor, codex, opencode — ver `ParserState` em
  `json-event-stream.ts:6-18` com campos específicos por parser) dentro do
  mesmo módulo, cada linha JSONL virando um evento tipado (`agent`,
  `stdout`, `error`, etc.) repassado por SSE ao cliente web.
- `'acp-json-rpc'` (`server.ts:7701` região): Agent Client Protocol
  (JSON-RPC bidirecional sobre stdio) — usado por Hermes/Kimi/Kilo/Kiro/
  Vibe/Devin/AMR conforme os comentários em `types.ts:163-171` sobre
  `externalMcpInjection: 'acp-merge'`.
- `'pi-rpc'`, `'qoder-stream-json'`, `'copilot-stream-json'`: parsers
  próprios por vendor (`qoder-stream.ts`, `plain-stream.ts` cobre o
  `'plain'` — a maioria dos CLIs sem streaming estruturado, onde o
  stdout bruto é filtrado/sanitizado linha a linha e reenviado como texto
  visível, `server.ts:7818-7839`).

### 3.3 `opencode-log.ts` — o arquivo âncora do pedido

Este módulo **não** faz parsing do stream de execução. É documentado no
próprio topo do arquivo (`opencode-log.ts:1-7`):

> "OpenCode swallows provider failures in headless `run --format json`
> mode: on a 429 usage-limit (and similar), it marks the error retryable,
> retries silently, and emits NOTHING on stdout/stderr — so the daemon
> only sees an inactivity-watchdog timeout with no reason. The real error
> is recorded only in OpenCode's own session log (`service=llm …
> error={…}`)."

Comportamento:

- **Localização do log**: `resolveOpenCodeLogDir()` (`opencode-log.ts:24-32`)
  replica a resolução de path do próprio OpenCode —
  `$XDG_DATA_HOME/opencode/log` ou `$HOME/.local/share/opencode/log`.
  Retorna `null` se nem `XDG_DATA_HOME` nem `HOME` estiverem no env
  (nenhuma tentativa de adivinhar).
- **Como acompanha**: **não é tail nem watch** — é leitura síncrona
  pontual e sob demanda (`readLatestOpenCodeLogTail`,
  `opencode-log.ts:48-78`), disparada só quando o watchdog de inatividade
  já detectou silêncio (`server.ts:6552-6571`) ou no fechamento do run
  sem sinal claro de erro (`server.ts:8175-8207`). Lista arquivos
  `*.log`, ordena lexicograficamente (nomes são timestamp ISO-like, então
  ordem lexicográfica = ordem cronológica), pega o mais recente cujo
  `mtimeMs >= since` (o `run.createdAt`, para não atribuir erro de uma
  sessão OpenCode anterior/concorrente a este run — limitação
  reconhecida no comentário `:38-40`: não desambigua duas sessões
  concorrentes na mesma HOME, porque o stdout — única fonte do session id
  real — está vazio no caso que dispara essa leitura). Lê até 2 MB do
  final do arquivo (`maxBytes = 2_000_000`).
- **Como sabe que "terminou"/falhou**: não é sinal de fim de sessão —
  é reação a um evento já detectado por OUTRO mecanismo (o watchdog de
  inatividade do daemon, ver §5). O módulo só extrai e classifica a
  causa depois que o daemon já decidiu que o run travou.
- **Formato do log e extração**: linhas de texto livre contendo
  `service=llm`, `ERROR`, e um campo `error=` com JSON embutido
  (`extractOpenCodeServiceFailure`, `opencode-log.ts:131-163`). Extrai
  `"statusCode":NNN` via regex (`:150`) e a última chave `"message":"…"`
  plausível via regex + `JSON.parse` do valor escapado
  (`pickServiceErrorMessage`, `:91-107`), com uma lista de gate-keywords
  (`SERVICE_ERROR_MESSAGE_RE`, `:85-86`) para não confundir texto do
  prompt/schema de tool embutido na mesma linha de log com a mensagem de
  erro real. Classifica em `AGENT_AUTH_REQUIRED` / `RATE_LIMITED` /
  `UPSTREAM_UNAVAILABLE` por status HTTP primeiro, texto como fallback
  (`codeFromStatus`, `:109-114`; delega a `classifyAgentServiceFailure`
  de `auth.ts` para o caso texto-only).
- **Não extrai mensagens/tool-calls/tokens de execução normal** — só
  extrai a causa de uma falha silenciosa. Extração de mensagens/tool
  calls/tokens do caminho feliz é responsabilidade de
  `json-event-stream.ts` (via stdout), não deste módulo.

---

## 4. Interface comum entre runtimes

`RuntimeAgentDef` (`types.ts:112-260`) é a struct compartilhada. Campos
que determinam o custo de portar um novo runtime:

- `id`, `name`, `bin`, `fallbackBins`, `versionArgs` — identidade e
  detecção.
- `buildArgs(prompt, imagePaths, extraAllowedDirs?, options?,
  runtimeContext?) => string[]` — o único ponto obrigatório de lógica
  imperativa por adapter.
- `streamFormat: string` — não é um union type fechado no `types.ts`
  (`streamFormat: string` puro, `types.ts:132`); a lista de valores
  válidos vive implicitamente no `switch` do `server.ts`. **Adicionar um
  formato de stream novo exige editar `server.ts`, não só a def** — não
  há registro plugável de parsers.
- `promptViaStdin` / `promptViaFile` / `promptInputFormat` — como o
  prompt chega ao processo.
- `resumesSessionViaCli`, `capturesSessionIdFromStream`,
  `resumesSessionViaAcpLoad`, `defaultModelEnvVar` — três estratégias
  distintas e mutuamente exclusivas de continuidade de sessão
  multi-turno (documentadas em detalhe nos comentários de
  `types.ts:154-249`), refletindo que cada CLI de terceiro tem seu
  próprio (ou nenhum) mecanismo de resume.
- `externalMcpInjection: 'claude-mcp-json' | 'acp-merge' |
  'opencode-env-content' | 'mimo-env-content' | undefined` — como o
  daemon repassa os MCP servers configurados pelo usuário para o CLI
  spawnado (`types.ts:158-183`). Este é o ponto mais relevante para o
  open-graph-mcp: **o daemon do open-design é ele mesmo um consumidor
  MCP** — ele injeta config de MCP externo no CLI que spawna, não expõe
  um MCP server para outros.
- `authProbe`, `capabilityFlags`/`helpArgs`, `inactivityTimeoutMs`,
  `acpTurnEndCompletesPrompt`, `acpMcpEnvFormat` — hints declarativos
  que existem porque CLIs de terceiro divergem em detalhes minúsculos
  (flag suportada só em versão nova, watchdog padrão curto demais para
  um agente específico, etc.).

`DetectedAgent` (`types.ts:263-282`) é a projeção pública de
`RuntimeAgentDef` que sai em `/api/agents` — remove funções (`buildArgs`,
`listModels`, `fetchModels`) e campos só-de-spawn (`env`, `authProbe`,
`inactivityTimeoutMs`), via `stripFns()` (`detection.ts:320-348`).

**Conclusão sobre "interface comum determina custo de portar"**: a
interface é rica o bastante para declarar diferenças (stdin vs argv vs
arquivo; resume; MCP injection) sem reescrever o spawn genérico, mas o
**parsing do stream não é polimórfico** — é um dispatcher central por
string em `server.ts` que só sabe lidar com os 8 formatos já
implementados. Portar um runtime cujo formato de saída já existe
(`plain`, ou reaproveitar `json-event-stream`) é barato; portar um
formato novo é caro porque toca o arquivo monolítico de 8700 linhas.

---

## 5. Escolha/configuração do runtime pelo usuário

- `GET /api/agents` (`apps/daemon/src/routes/static-resource.ts:111-125`,
  também espelhado em `server.ts:2522`, `:3175`, `:8507`, `:8679`) chama
  `detectAgents(config.agentCliEnv ?? {})` e devolve a lista de
  `DetectedAgent` (instalado/não, versão, modelos, auth status) para a
  UI.
- No app web (`apps/web/src/components/EntryShell.tsx:1500-1508`), o
  usuário escolhe `config.agentId` a partir dessa lista
  (`selectedAgent = visibleAgents.find(a => a.id === config.agentId)`),
  e opcionalmente um modelo por agente (`config.agentModels?.[id]`).
- O turno de chat é disparado em `POST /api/chat` com `body.agentId`
  obrigatório (`apps/daemon/src/routes/chat.ts:318-322`,
  `getAgentDef(body.agentId)`); o `runId` resultante carrega o `agentId`
  escolhido (`chat.ts:367`) e é ele quem seleciona a `RuntimeAgentDef`
  usada no spawn em `server.ts`.
- Override de binário por env var (`<AGENT>_BIN`, ex. `CLAUDE_BIN`,
  `CODEX_BIN`, `apps/daemon/src/runtimes/executables.ts:125`) e "perfis
  locais" (`local-profiles.ts`, um agente base clonado com bin/nome
  customizados) são as duas formas de configuração fora da escolha
  simples na UI.

---

## 6. Caminho alternativo por API key direta — como convivem

Existem **dois** caminhos de API key distintos e não devem ser
confundidos:

1. **`byok-opencode`** (`apps/daemon/src/runtimes/defs/byok-opencode.ts`,
   `apps/daemon/src/runtimes/byok-opencode.ts`): é um agente na mesma
   lista `AGENT_DEFS`, com `id: 'byok-opencode'`
   (`byok-opencode.ts` def, linha 10). **Ainda spawna o binário
   `opencode-cli`** (`bin: 'opencode-cli'`, `fallbackBins: ['opencode']`,
   linhas 12-13) — não é uma chamada HTTP direta ao provedor. O que muda
   é que o daemon monta um `OpenCodeByokProviderConfig`
   (`runtimes/byok-opencode.ts:26-30`) a partir da chave/URL fornecida
   pelo usuário (`ByokChatProviderConfig`, protocolos `anthropic`/
   `openai`/`azure`/`google`/`ollama`/`senseaudio`/`aihubmix`, mapa de
   URLs default em `runtimes/byok-opencode.ts:11-18`) e injeta isso como
   env do processo `opencode-cli` spawnado
   (`server.ts:6754`: `...(byokOpenCodeProvider ? byokOpenCodeProvider.env
   : {})`). Ou seja: **BYOK aqui = "traga sua própria chave para dentro
   do OpenCode local"**, não elimina a dependência do CLI instalado —
   ela troca só a fonte de credencial/roteamento de modelo dentro dele.
2. **`memory-llm.ts`** (`apps/daemon/src/memory-llm.ts:631-634`, `:235`):
   um caminho **totalmente separado e sem CLI**, usado só para uma
   feature interna de extração de memória (não para os turnos de chat
   do usuário) — chama `ANTHROPIC_API_KEY` do env do processo do daemon
   diretamente contra `https://api.anthropic.com`
   (`memory-llm.ts:156`). Este é o único lugar do daemon, entre os
   arquivos inspecionados, onde uma chamada de API de LLM acontece sem
   passar por um processo filho.

Convivência: os dois caminhos de "chat com agente" (CLI instalado vs.
BYOK-via-OpenCode) usam a **mesma** `RuntimeAgentDef`/spawn pipeline —
BYOK é só mais uma entrada em `AGENT_DEFS`, selecionável pelo mesmo
`agentId` do fluxo normal. O caminho `memory-llm.ts` é ortogonal e não
concorre com a escolha de runtime do usuário.

---

## 7. Tratamento de erro

- **Agente ausente**: `resolveAgentLaunch` falha em resolver path →
  `unavailableAgent()` na detecção (agente nunca aparece "disponível" na
  UI); no spawn, se ainda assim chegar sem `launchPath` resolvido, erro
  SSE explícito `AGENT_UNAVAILABLE` apontando para reinstalar e atualizar
  `/api/agents` (`server.ts:6650-6660`), citando a issue #10 do próprio
  projeto como precedente do bug que essa checagem evita (spawn cego do
  `def.bin` sem checar resolução).
- **Versão incompatível / flag não suportada**: não há bloqueio duro —
  `probeCapabilities` (`detection.ts:214-236`) faz probe de `--help` e
  cacheia quais flags existem (`agentCapabilities`); `buildArgs` consulta
  esse cache e omite flags não suportadas (ex. `claude.ts:63-65`,
  `:74`), então uma CLI mais antiga simplesmente roda com menos recursos
  em vez de falhar.
- **Sessão travada**: watchdog de inatividade
  (`resolveChatRunInactivityTimeoutMs`, `server.ts:6436`, default global
  configurável por `OD_CHAT_RUN_INACTIVITY_TIMEOUT_MS`, override por
  adapter via `def.inactivityTimeoutMs` — comentário em `types.ts:236-242`
  cita o caso Copilot precisando de teto maior). Ao expirar: para
  `opencode`, tenta recuperar a causa real via `opencode-log.ts` (§3.3,
  `server.ts:6552-6571`); senão emite `AGENT_EXECUTION_FAILED` genérico
  com detalhes de fase (`server.ts:6572-6579`). Escalada de sinal:
  SIGTERM primeiro, SIGKILL depois, endereçada ao **process group**
  inteiro quando possível (`design.runs.signalChild`/
  `signalChildProcess`, `server.ts:6520-6523`, `detached: process.platform
  !== 'win32'` no spawn para permitir isso — `server.ts:6792`).
- **Cancelamento**: `run.cancelRequested` é checado em múltiplos pontos
  do pipeline antes de cada side-effect relevante (`server.ts:6198,
  6209, 6528, 6701, 7135, 7416, 7525, 7673, 7723`); o encerramento do
  processo filho passa pelo mesmo `signalChild(run, 'SIGTERM')` do
  watchdog, com uma janela de graça antes de escalar para SIGKILL
  (comentário `server.ts:5458-5484` sobre correção de um bug em que um
  SIGTERM tardio de retry acertava o child errado).
- **Falha de serviço do provedor** (auth/quota/rate-limit/5xx): dupla
  camada — (a) classificação textual genérica por regex em `auth.ts`
  (`classifyAgentServiceFailure`, `auth.ts:258-263`, com regex dedicada
  para auth em `auth.ts:235-237`) aplicada ao stderr/stdout de qualquer
  adapter; (b) para `opencode` especificamente, o fallback de log em
  disco do §3.3 quando (a) não encontra nada porque o CLI não imprimiu
  nada.

---

## 8. Avaliação de portabilidade para o open-graph-mcp

### 8.1 O que muda de papel

O open-design é um **orquestrador que spawna agentes de codificação como
processo filho e fala com eles via stdio/ACP**; o open-graph-mcp hoje é
um **servidor MCP que é chamado por um agente externo via tool call** —
papéis invertidos. Portar "runtime adapters" para o open-graph-mcp não é
plugar um módulo — é adicionar uma capacidade nova e estrutural: o
mcp-server passaria a, opcionalmente, **spawnar** um agente (ex. para
alguma automação server-side), o que ele não faz hoje em nenhum lugar de
`packages/mcp-server/src` (confirmado por inspeção de
`packages/mcp-server/src/tools/*.ts` — nenhum deles chama
`child_process`/`Bun.spawn`).

### 8.2 O que dá para reusar quase direto (conceito, não código — licenças diferem, ver §8.4)

- **O formato de `RuntimeAgentDef`** como inspiração de design: campos
  declarativos (`bin`, `versionArgs`, `buildArgs`, `promptViaStdin`) são
  um padrão limpo e replicável do zero em TypeScript, sem dependência do
  open-design.
- **A estratégia de detecção**: PATH-walk + probe de `--version` com
  timeout + `<AGENT>_BIN` de override + fallback bins é um padrão simples
  o bastante para reimplementar em ~100-150 linhas, sem puxar
  `executables.ts`/`detection.ts` inteiros (que carregam lógica
  específica de Codex/AMR/antigravity irrelevante para um MCP server).
- **A estratégia de log post-mortem do OpenCode** (§3.3): a *técnica*
  (ler o log em `$XDG_DATA_HOME/opencode/log` quando o stdout fica mudo)
  é reaproveitável como ideia, mas é acoplada a um bug específico do
  OpenCode (issue #982 do open-design) — só vale a pena se o
  open-graph-mcp de fato spawnar OpenCode e observar o mesmo sintoma.

### 8.3 O que teria que ser reescrito (a maior parte)

- **O `switch` de `streamFormat` em `server.ts`** não é portável como
  módulo — é entrelaçado com o modelo de SSE/`send()` específico do
  daemon do open-design (payloads `agent`/`stdout`/`stderr`/`error`
  próprios). O open-graph-mcp já tem seu próprio mecanismo de SSE
  (`packages/mcp-server/src/sse.ts`, `transport.ts`) com semântica de
  protocolo MCP (JSON-RPC), incompatível com o formato de evento do
  open-design sem uma camada de tradução inteira.
  `json-event-stream.ts` (30 KB) e `claude-stream.ts` (26 KB) seriam a
  parte de maior esforço a portar — cada um é um parser stateful por
  vendor, não uma função pura reaproveitável isoladamente.
- **Resume de sessão** (`resumesSessionViaCli`/`capturesSessionIdFromStream`
  /`resumesSessionViaAcpLoad`) depende de um modelo de conversa
  persistida por-turno (`RuntimeContext`, transcript rendering) que o
  open-graph-mcp não tem — ele é stateless por request MCP, com estado no
  grafo, não em "conversa com um CLI".
- **Injeção de MCP externo no CLI spawnado**
  (`externalMcpInjection`) é conceitualmente invertida: no open-design, o
  *daemon* configura o CLI de terceiro para falar com um MCP server (que
  pode ser o próprio open-design ou outro). No open-graph-mcp, seria o
  próprio produto sendo o MCP server — não faz sentido portar esse
  campo, a menos que o open-graph-mcp decida também *consumir* outros
  MCP servers a partir de um agente que ele spawne (caso de uso não
  descrito no pedido).

### 8.4 Dependências novas que entrariam

- `node:child_process` (`spawn`/`execFile`) — hoje o mcp-server roda em
  Bun; `Bun.spawn` seria o análogo nativo (o open-design usa Node puro,
  não Bun, então mesmo o wrapper de spawn precisaria reescrita, não só
  port).
- Nenhuma lib externa nova é estritamente necessária para o core do
  padrão (detecção + spawn + parse de linha) — é tudo `fs`/`child_process`
  no open-design. O custo é de **linhas de lógica própria**, não de
  `package.json`.
- Se se quiser paridade com resume/ACP, entraria a necessidade de um
  cliente JSON-RPC sobre stdio (o open-design não usa uma lib de terceiro
  publicada para isso — implementação própria não vista em detalhe nesta
  pesquisa; **não confirmei** se há um pacote `acp` externo ou se é tudo
  hand-rolled em `apps/daemon/src`).

### 8.5 Onde encaixaria no open-graph-mcp

Não há um encaixe natural nos tools atuais
(`packages/mcp-server/src/tools/{authority,changeset,graph-bootstrap,
graph-query,graph-subscribe,presence,session,typing}.ts`) porque nenhum
deles orquestra processos. Um encaixe hipotético seria um **novo tool**
(ex. algo como `agent.run` ou um pipeline server-side de indexação
automática que precise chamar um LLM local) — mas isso é uma mudança de
escopo de produto, não uma integração incremental. Vale registrar que o
`docs/roadmap-mcp/06-audit-e-reestruturacao.md:52-56` já observa que "o
pipeline brownfield REAL é uma sessão de agente LLM; não é spawnável" —
ou seja, o próprio projeto já tem uma nota reconhecendo que hoje ele
depende de uma sessão de agente *externa* (não spawnada por ele), o que é
consistente com o achado desta pesquisa: portar "runtime adapters" seria
o open-graph-mcp assumir um papel novo, não replicar um já existente.

### 8.6 Riscos

1. **Licença do open-design: Apache License 2.0**, confirmado lendo
   `LICENSE` na raiz do clone (cabeçalho "Apache License, Version 2.0,
   January 2004"). O open-graph-mcp declara `"license": "MIT"` em
   `packages/mcp-server/package.json:7` (não há arquivo `LICENSE` na raiz
   do open-graph-mcp — **não confirmei** se há um arquivo de licença em
   outro lugar do repo). Apache-2.0 é permissiva e compatível com
   reuso em projeto MIT **desde que se preserve o aviso de copyright e
   se inclua o texto da licença Apache para o código copiado/derivado**
   (a Apache-2.0 exige isso mesmo quando redistribuída dentro de um
   projeto sob outra licença permissiva) — se algum trecho de código
   literal for copiado (não só o padrão de design), isso precisa de
   atribuição explícita no open-graph-mcp. Reescrever do zero a partir do
   entendimento do padrão (como recomendado em §8.2) evita essa questão.
2. **Acoplamento a versão de CLI de terceiro**: o próprio código do
   open-design está cheio de comentários citando issues numeradas sobre
   comportamento específico de versão (`claude.ts:36`
   "Fixes issue #430", `opencode.ts:18-20` sobre latência de `opencode
   models`, `opencode-log.ts` inteiro sobre um bug de retry silencioso do
   OpenCode). Isso é evidência direta de que manter esses adapters é
   trabalho contínuo de acompanhamento de mudanças upstream, não um
   custo único de implementação.
3. **Segurança de spawnar processo**: o open-design mitiga com
   `shell: false` sempre (`server.ts:6791`), PATH controlado
   explicitamente (não herda cegamente), e prompt via stdin/arquivo em
   vez de argv interpolado (evita injeção via argv longo/mal escapado).
   Um MCP server que hoje só responde a JSON-RPC ganharia uma superfície
   de execução de processo arbitrário — isso muda o perfil de risco do
   open-graph-mcp de "serve grafo" para "executa binários locais do
   usuário", o que provavelmente merece uma decisão de produto explícita
   antes de portar, não só uma decisão técnica.

---

## 9. O que NÃO foi verificado

- Não rodei nenhum runtime real (nenhum CLI de terceiro foi invocado);
  toda a análise é leitura estática do código do open-design.
- Não testei o comportamento real de `json-event-stream.ts` /
  `claude-stream.ts` contra uma saída real do Claude Code/OpenCode —
  descrevi a partir da leitura do parser, não de execução observada.
- Não confirmei se existe uma lib externa publicada para ACP
  (Agent Client Protocol) usada pelo open-design ou se a implementação é
  inteiramente própria dentro de `apps/daemon/src` (arquivos como
  `terminal-control.ts`/`terminal-launch.ts` sugerem implementação
  própria, mas não fiz uma leitura completa desses arquivos). ACP em si
  é um protocolo aberto (Zed/Agent Client Protocol) — não confirmei a
  origem exata da implementação usada aqui.
- Não li `chat-prompt-inputs.ts`, `chat-run-context.ts`,
  `chat-run-lifecycle.ts`, `chat-run-messages.ts`,
  `run-lifecycle-analytics.ts`, `run-terminal-reconciliation.ts` em
  detalhe — são grandes (11-43 KB) e ficaram fora do escopo direto do
  pedido (runtime adapters + caller), mas compõem o pipeline de chat
  mais amplo em torno do spawn.
- Não verifiquei se há arquivo `LICENSE` do open-graph-mcp fora da raiz
  (só o campo `"license": "MIT"` no `package.json` do `mcp-server` foi
  inspecionado).
- Não medi esforço em dias/pessoas para a reescrita — a avaliação em §8
  é qualitativa (o que muda de papel / o que se reescreve), não uma
  estimativa de cronograma.

---

## 10. Recomendação

**Não portar como está.** O padrão de `RuntimeAgentDef` (detecção +
buildArgs declarativo) é bom o suficiente para servir de *referência de
design* caso o open-graph-mcp algum dia precise spawnar um agente de
codificação a partir do servidor MCP — mas hoje essa necessidade não
existe no produto (nenhum tool atual orquestra processo). O parsing de
stream (`json-event-stream.ts`, `claude-stream.ts`) é o componente mais
valioso e também o mais caro e mais acoplado ao modelo de evento do
open-design — reescrever do zero, sob medida para o protocolo MCP/SSE do
open-graph-mcp, é mais barato e mais seguro do que adaptar esses
arquivos. Se a demanda de produto para "usar o CLI já instalado do
usuário" surgir concretamente, o próximo passo recomendado é um
protótipo mínimo (1 runtime só, formato `plain`, sem resume, sem ACP) —
não um port do subsistema inteiro.
