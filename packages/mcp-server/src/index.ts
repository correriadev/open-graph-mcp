/**
 * index.ts — HTTP/SSE entrypoint (Bun.serve). Rotas: POST /mcp (JSON-RPC), GET /events (SSE),
 * GET / (health). CORS aberto por padrão (`ALLOWED_ORIGINS` não setado → `*`, decisão D2 single-org
 * trust); configurável via `ALLOWED_ORIGINS` (lista separada por vírgula) para restringir Origin. Além
 * dos headers CORS (que só controlam se o JS de um browser pode LER a resposta), o servidor também
 * valida ativamente o header `Origin` em toda conexão (spec MCP: anti DNS-rebinding) — um `fetch()`
 * cross-origin ainda alcançaria e executaria a chamada mesmo sem CORS, então origins fora da allowlist
 * levam 403 antes de qualquer lógica de rota.
 *
 * Fase 2: o estado durável vive em STATE_DIR (SQLite `state.sqlite` + espelho JSONL por tenant). O grafo
 * de conhecimento (query/watch) segue em memória por tenant. `startServer` é a fábrica testável: porta
 * efêmera, stateDir isolado (temp por padrão nos testes), tick/sweep/flush manuais expostos, intervalos
 * overridáveis. Rodado direto (`bun dev`), sobe na PORT (default 8787) sobre GRAPH_REPO_PATH + STATE_DIR.
 */
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Server } from "bun"
import { createState, DEFAULT_TENANT, type ServerState } from "./state"
import { handleRpc } from "./transport"
import { handleEvents } from "./sse"
import { bootstrap, hydrateFromDb } from "./tools/graph-bootstrap"
import { startWatchLoop, tick } from "./watch-bridge"
import { startSweeper, sweepTtl, flushDeltas } from "./sweeper"
import { sweepPresence } from "./tools/presence"
import { sweepTyping } from "./tools/typing"
import { lookupToken } from "./tokens"
import { createLogger, noopLogger, stripUriQuery, toErrorInfo, type Logger } from "./log"

/** Exact-match only — no wildcard/subdomain matching (that would be too permissive for the check below).
 * A literal empty `Origin: ""` header is folded into the same "treat as absent" path as no header at
 * all — deliberate, not an oversight: browsers never send an empty Origin, so this only ever matters
 * for non-browser callers, which this check isn't concerned with either way. */
function isOriginAllowed(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) return true // non-browser clients (curl, SDKs) don't send Origin — not what this check is for
  if (allowedOrigins.includes("*")) return true
  return allowedOrigins.includes(origin)
}

/**
 * CORS response headers, computed per-request. `access-control-allow-origin` is `"*"` when the
 * allowlist is wildcard-open, echoes back the exact matched Origin when a specific allowlist is
 * configured, or is omitted entirely when the request has no Origin header at all (there's no browser
 * origin to authorize, and non-browser clients don't care about the header).
 *
 * Safe by construction, not by caller convention: this re-runs `isOriginAllowed` itself rather than
 * trusting that the caller already rejected disallowed origins before reaching here. A future call site
 * that calls this directly — skipping the 403 guard — still cannot get an unauthorized Origin echoed
 * back; it just silently omits the header instead, same as the no-Origin case.
 */
function corsHeaders(origin: string | null, allowedOrigins: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, mcp-protocol-version",
    "access-control-expose-headers": "MCP-Protocol-Version",
  }
  if (allowedOrigins.includes("*")) headers["access-control-allow-origin"] = "*"
  else if (origin && isOriginAllowed(origin, allowedOrigins)) headers["access-control-allow-origin"] = origin
  return headers
}

/**
 * Parseia `DOMAINS` (env) para o mesmo shape tipado que `StartOptions.domains` espera. Formato: um
 * array JSON num único var, ex. `DOMAINS='[{"pattern":"sdk/**","domain":"sdk"}]'` — é o mais fiel ao
 * shape tipado (`readonly { pattern; domain }[]`) sem inventar uma sintaxe própria (tipo
 * `sdk/**=sdk,web/**=web`) que precisaria de escaping manual pra patterns com vírgula.
 *
 * Extraída como função pura (em vez de inline no bloco `import.meta.main`) por dois motivos: dá pra
 * testar sem spawnar processo, e mantém a MESMA garantia dura que motivou este fix — nunca ignorar
 * silenciosamente. Unset (`undefined`) devolve `undefined` (mantém o comportamento de hoje: sem
 * regras, tudo cai em `(unassigned)`). QUALQUER valor setado que não parseie como JSON, ou que não seja
 * um array de `{ pattern: string não-vazia, domain: string não-vazia }`, é um erro fatal no boot — é
 * exatamente a classe de bug que motivou este fix: `startServer()` aceita `domains` desde sempre, mas
 * o entrypoint de CLI nunca lia do ambiente, então configurar regras de domínio rodando `bun run dev`
 * era impossível e sem nenhum aviso (186 nós indexados caíram todos em uma única célula
 * `(unassigned)`). Falhar alto aqui é melhor que repetir esse silêncio.
 */
export function parseDomainsEnv(raw: string | undefined): readonly { pattern: string; domain: string }[] | undefined {
  if (raw === undefined) return undefined // não setado: sem regras, comportamento de hoje preservado

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `DOMAINS inválido: não é JSON válido (${(err as Error).message}). Esperado um array como ` +
        `'[{"pattern":"sdk/**","domain":"sdk"}]'.`,
    )
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`DOMAINS inválido: esperado um array de { pattern, domain }, recebeu ${typeof parsed}.`)
  }

  parsed.forEach((entry, i) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { pattern?: unknown }).pattern !== "string" ||
      (entry as { pattern: string }).pattern.length === 0 ||
      typeof (entry as { domain?: unknown }).domain !== "string" ||
      (entry as { domain: string }).domain.length === 0
    ) {
      throw new Error(
        `DOMAINS inválido: item [${i}] deve ser { pattern: string não-vazia, domain: string não-vazia }, ` +
          `recebeu ${JSON.stringify(entry)}.`,
      )
    }
  })

  return parsed as readonly { pattern: string; domain: string }[]
}

/**
 * Parseia `PORT` (env) para o inteiro que `Bun.serve({ port })` espera. Extraída como função pura (mesmo
 * padrão de `parseDomainsEnv` acima) por dois motivos: testável sem spawnar processo, e falha alto em vez
 * de deixar `Number(process.env.PORT ?? 8787)` produzir `NaN` silencioso pra `Bun.serve` num valor
 * inválido (`PORT=abc`, `PORT="  "`, `PORT=8080.5`, `PORT=-1`, `PORT=99999`) — `Bun.serve({ port: NaN })`
 * cai pra uma porta efêmera aleatória em vez de recusar, escondendo um erro de configuração atrás de "o
 * servidor subiu em algum lugar". Unset (`undefined`) devolve o default 8787 (comportamento de hoje
 * preservado). Só chamada dentro do bloco `import.meta.main` — NÃO muda a assinatura de `startServer`,
 * que continua aceitando `port` como veio (outros streams e todo teste existente dependem dela).
 */
export function parsePortEnv(raw: string | undefined): number {
  if (raw === undefined) return 8787
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`PORT inválido: esperado um inteiro positivo, recebeu ${JSON.stringify(raw)}.`)
  }
  const value = Number(raw.trim())
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    throw new Error(`PORT inválido: fora do range de portas válidas (1-65535), recebeu ${JSON.stringify(raw)}.`)
  }
  return value
}

/**
 * Parseia `HOST` (env) para o `hostname` que `Bun.serve` recebe. Mesma disciplina de
 * `parsePortEnv`/`parseDomainsEnv`: função pura, testável sem spawnar processo, falha alto em vez de
 * degradar em silêncio. Motivo de existir: `Bun.serve` sem `hostname` explícito faz bind em
 * `0.0.0.0` — todas as interfaces. Rodar isto num café expõe o grafo do repo do usuário pra rede
 * inteira, sem nenhuma auth de transporte (`session.register` não pede segredo). O default seguro é
 * `127.0.0.1` (só loopback); `0.0.0.0` continua disponível, mas como opt-in EXPLÍCITO — quem seta a
 * env sabe o que está fazendo. Unset devolve o default seguro (comportamento novo, não o antigo — o
 * antigo era o bug que isto corrige). String vazia/só-espaço é inválida e falha o boot, mesmo padrão
 * de `ALLOWED_ORIGINS=""` fechando tudo em vez de virar "sem filtro" por acidente.
 */
export function parseHostEnv(raw: string | undefined): string {
  if (raw === undefined) return "127.0.0.1"
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw new Error(`HOST inválido: string vazia. Omita a env var para o default (127.0.0.1) ou passe um host válido.`)
  }
  // Permissivo o bastante para IPv4, IPv6 (com colchetes), hostnames e "localhost"/"0.0.0.0" — mas
  // recusa espaços e caracteres claramente inválidos em vez de repassar qualquer string pro Bun.serve.
  if (!/^[a-zA-Z0-9.:_[\]-]+$/.test(trimmed)) {
    throw new Error(`HOST inválido: ${JSON.stringify(raw)} não parece um hostname/IP válido.`)
  }
  return trimmed
}

export type StartOptions = {
  repoPath?: string
  stateDir?: string
  port?: number
  watch?: boolean
  watchIntervalMs?: number
  watchTenant?: string
  autoBootstrap?: boolean
  ttlMs?: number
  sweepIntervalMs?: number
  aggIntervalMs?: number
  presenceTtlMs?: number
  presenceSweepIntervalMs?: number
  focusDebounceMs?: number
  typingMs?: number
  idleMs?: number
  tokenTtlMs?: number
  typingIntervalMs?: number
  /** Origin allowlist for the active DNS-rebinding check (spec: "MUST validate the Origin header on
   * all incoming connections"), exact-match only. Default `["*"]` preserves today's fully-open,
   * single-org-trust behavior (D2) — pass a specific list to restrict which browser Origins may reach
   * this server at all (not just which ones can read the response). */
  allowedOrigins?: string[]
  /** Regras de posse de domínio (`{ pattern, domain }`). CONFIG DO SERVIDOR: vinham de
   *  `.graph/domains.json` no repo-alvo, mas o repo não hospeda mais nada de grafo. */
  domains?: readonly { pattern: string; domain: string }[]
  /** Interface de bind do `Bun.serve`. Default `"127.0.0.1"` (loopback only) — ver `parseHostEnv`
   *  acima para o porquê. `"0.0.0.0"` é opt-in explícito. */
  host?: string
  /** Liga o log estruturado em arquivo (`log.ts`). Default `false`: ~290 testes chamam `startServer`
   *  e um default ligado encheria o disco de `server.log` por teste e sujaria stdout com falhas de
   *  escrita silenciosas de mais. Testes que QUEREM cobrir o log passam `log: true` + `logFile`
   *  explícito (ver test/server-log.test.ts). O entrypoint de CLI (`import.meta.main` abaixo) passa
   *  `log: true` sempre — é o único caminho de produção real. */
  log?: boolean
  /** Caminho do arquivo de log. Default (quando `log: true` e isto não é passado): `<stateDir>/server.log`. */
  logFile?: string
}
export type RunningServer = {
  state: ServerState
  server: Server
  url: string
  tick: () => Promise<unknown>
  sweep: () => void
  flush: () => void
  sweepPresenceNow: () => void
  tickTypingNow: () => void
  stop: () => void
}

export function startServer(opts: StartOptions = {}): RunningServer {
  const stateDir = opts.stateDir ?? mkdtempSync(path.join(tmpdir(), "og-state-"))
  const state = createState({
    repoPath: opts.repoPath,
    stateDir,
    ttlMs: opts.ttlMs,
    presenceTtlMs: opts.presenceTtlMs,
    focusDebounceMs: opts.focusDebounceMs,
    typingMs: opts.typingMs,
    idleMs: opts.idleMs,
    tokenTtlMs: opts.tokenTtlMs,
    domains: opts.domains,
  })
  const watchTenant = opts.watchTenant ?? DEFAULT_TENANT
  const allowedOrigins = opts.allowedOrigins ?? ["*"]
  const host = opts.host ?? "127.0.0.1"

  // Log estruturado (log.ts) — desligado por default (ver StartOptions.log). `noopLogger` faz cada
  // call site abaixo custar uma chamada de função vazia em vez de um `if (logger)` espalhado.
  const logger: Logger = opts.log ? createLogger(opts.logFile ?? path.join(stateDir, "server.log")) : noopLogger

  // Hidrata os grafos do BANCO antes de qualquer coisa: com o grafo persistido por tenant, subir o
  // servidor sobre um stateDir existente já devolve o grafo. Antes disto o estado era 100% em
  // memória e um restart respondia "not bootstrapped" até alguém reindexar na mão.
  const tenantsHydrated = hydrateFromDb(state)

  if (opts.autoBootstrap && opts.repoPath) {
    try {
      bootstrap(state, opts.repoPath)
    } catch {
      /* repo ilegível: sobe vazio, admin chama graph.bootstrap depois */
    }
  }

  // `tenantOf`-like lookup, mas SÓ para o log: nunca lança (token ausente/inválido vira `null`/
  // DEFAULT_TENANT no log em vez de derrubar a requisição), e nunca grava o token em si — só o
  // `tenantId` que ele resolve (já opaco). Espelha a lógica de `transport.ts` `tenantOf` sem
  // duplicar comportamento — aqui é só observabilidade, a decisão de autorização real continua
  // 100% em transport.ts.
  function tenantForLog(token: unknown): string | null {
    if (typeof token !== "string" || !token) return DEFAULT_TENANT
    const info = lookupToken(state, token)
    return info ? info.tenantId : null
  }

  /**
   * Veredito de DOMÍNIO, separado do sucesso de TRANSPORTE.
   *
   * Achado do exercício multiplayer (2026-08-07): duas sessões de agente produziram 59
   * `changeset.claim` registradas como `ok:true` e ZERO claims commitadas. As duas coisas eram
   * verdade ao mesmo tempo — uma claim recusada pelo gate devolve `{ok:false, reasons:[...]}` como
   * `structuredContent`, NÃO como `isError`; para o transport a chamada foi um sucesso. Só que o log
   * existe para o dono diagnosticar "por que nada entrou", e `ok:true` 59 vezes responde o contrário
   * da verdade. É a mesma classe de falha silenciosa que este servidor já corrigiu quatro vezes,
   * agora dentro do próprio instrumento de diagnóstico.
   *
   * `reasons` viaja porque é exatamente o dado que responde a pergunta. Exposição consciente e
   * registrada: as reasons contêm ids de claim (escolhidos pelo cliente) e caminhos de arquivo
   * RELATIVOS ao repo. Não contêm `subject` nem `anchor` — o conteúdo do código do testador continua
   * fora do arquivo, que é a regra dura de privacidade do log.
   */
  function toolVerdict(res: { result?: unknown } | null): { verdict?: "refused"; reasons?: string[] } {
    const sc = (res?.result as { structuredContent?: { ok?: unknown; reasons?: unknown } } | undefined)?.structuredContent
    if (!sc || sc.ok !== false) return {}
    const reasons = Array.isArray(sc.reasons) ? sc.reasons.filter((r): r is string => typeof r === "string") : []
    return { verdict: "refused", reasons }
  }

  function rpcErrorInfo(res: { error?: { message: string }; result?: unknown } | null): { message: string } | undefined {
    if (!res) return undefined
    if (res.error) return { message: res.error.message }
    const result = res.result as { isError?: boolean; content?: { type: string; text?: string }[] } | undefined
    if (result?.isError === true) {
      const text = result.content?.[0]?.text
      return { message: typeof text === "string" ? text : "tool error" }
    }
    return undefined
  }

  async function handleFetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const origin = req.headers.get("origin")

    // Active DNS-rebinding guard (spec: "MUST validate the Origin header on all incoming
    // connections"). CORS headers alone only stop a browser from READING a cross-origin response —
    // they don't stop the request from reaching here and running. Reject before any route logic.
    // No Origin header at all (curl, the MCP SDK over Node, CLI clients) → not a browser, proceed.
    if (!isOriginAllowed(origin, allowedOrigins)) {
      return new Response("origin not allowed", { status: 403 })
    }

    const headers = corsHeaders(origin, allowedOrigins)
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers })

    if (url.pathname === "/events" && req.method === "GET") {
      // sse.ts hardcodes its own access-control-allow-origin: "*" on the Response it builds;
      // override it here (rather than touching that file — scope containment) so /events gets the
      // same computed, allowlist-aware CORS headers as every other route.
      const res = handleEvents(state, url)
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
      if (!("access-control-allow-origin" in headers)) res.headers.delete("access-control-allow-origin")
      return res
    }

    if (url.pathname === "/mcp" && req.method === "GET") {
      return new Response("method not allowed", { status: 405, headers: { ...headers, allow: "POST" } })
    }

    if (url.pathname === "/mcp" && req.method === "POST") {
      let body: any
      try {
        body = await req.json()
      } catch {
        return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { headers })
      }
      const method = typeof body?.method === "string" ? body.method : null
      const start = Date.now()
      const res = handleRpc(state, body)
      const durationMs = Date.now() - start

      // Log só o que interessa pro beta: chamada de tool e leitura de resource. NUNCA os `arguments`/
      // `params` crus (podem carregar token, subject, anchor, caminho de arquivo) — só nome/URI +
      // tenant resolvido + duração + ok/erro. `res === null` é notification (sem resposta, transport
      // engole qualquer erro interno) — nada de útil pra logar sobre ok/erro nesse caso.
      if (method === "tools/call" && body?.params?.name) {
        logger.toolCall({
          target: String(body.params.name),
          tenant: tenantForLog(body.params?.arguments?.token),
          durationMs,
          ok: res !== null && !rpcErrorInfo(res),
          error: res !== null ? rpcErrorInfo(res) : undefined,
          ...toolVerdict(res),
        })
      } else if (method === "resources/read" && typeof body?.params?.uri === "string") {
        logger.resourceRead({
          target: stripUriQuery(body.params.uri),
          tenant: tenantForLog(body.params?.token),
          durationMs,
          ok: res !== null && !rpcErrorInfo(res),
          error: res !== null ? rpcErrorInfo(res) : undefined,
        })
      }

      if (res === null) return new Response(null, { status: 204, headers })

      // Stateless server (no Mcp-Session-Id — token lives in tool args, per D2): echo the
      // negotiated protocol version rather than tracking it per-session. A well-behaved client
      // sends MCP-Protocol-Version on every request after its initial `initialize` call, so echo
      // that back. The `initialize` call itself has no such header yet (that's what it's
      // negotiating) — for that one response, use the protocolVersion just negotiated in the
      // result body. Otherwise omit the header rather than send a garbage/empty value.
      const incomingVersion = req.headers.get("mcp-protocol-version")
      const negotiatedVersion = (res?.result as { protocolVersion?: string } | undefined)?.protocolVersion
      const protocolVersion = incomingVersion ?? negotiatedVersion
      const rpcHeaders = protocolVersion ? { ...headers, "mcp-protocol-version": protocolVersion } : headers
      return Response.json(res, { headers: rpcHeaders })
    }

    if (url.pathname === "/") {
      return Response.json({ name: "open-graph-mcp", stateDir, sessions: state.sessions.size, tenants: state.graphs.size }, { headers })
    }
    return new Response("not found", { status: 404, headers })
  }

  const server = Bun.serve({
    port: opts.port ?? 0,
    hostname: host,
    idleTimeout: 0,
    async fetch(req) {
      try {
        return await handleFetch(req)
      } catch (err) {
        // Rede de segurança: handleRpc já captura tudo que é erro de negócio (tool/resource) e devolve
        // como JSON-RPC error, não como throw. Chegar aqui é um bug real não previsto — registra com
        // stack (isto SIM tem stack: é um Error de verdade, não uma mensagem já achatada por
        // transport.ts) e devolve 500 em vez de deixar o Bun estourar sem log nenhum.
        logger.fetchError({ path: new URL(req.url).pathname, error: toErrorInfo(err) })
        return new Response("internal server error", { status: 500 })
      }
    },
  })

  // watch não depende mais de `opts.repoPath`: o tick lê o repo do TENANT (banco) e não faz nada
  // se aquele tenant ainda não indexou nenhum.
  const stopWatch = opts.watch === true ? startWatchLoop(state, opts.watchIntervalMs ?? 5000, watchTenant) : () => {}
  const stopSweeper = startSweeper(state, {
    sweepIntervalMs: opts.sweepIntervalMs,
    aggIntervalMs: opts.aggIntervalMs,
    presenceSweepIntervalMs: opts.presenceSweepIntervalMs,
    typingIntervalMs: opts.typingIntervalMs,
  })

  logger.boot({ port: server.port, host, stateDir, version: "0.1.0", tenantsHydrated })

  return {
    state,
    server,
    url: `http://localhost:${server.port}`,
    tick: () => tick(state, watchTenant),
    sweep: () => sweepTtl(state),
    flush: () => flushDeltas(state),
    sweepPresenceNow: () => sweepPresence(state),
    tickTypingNow: () => sweepTyping(state),
    stop: () => {
      logger.shutdown()
      stopWatch()
      stopSweeper()
      for (const t of state.focusDebounce.values()) clearTimeout(t)
      state.focusDebounce.clear()
      server.stop(true)
      state.db.close()
    },
  }
}

if (import.meta.main) {
  const subcommand = Bun.argv[2]
  if (subcommand === "doctor") {
    const { runDoctor, printDoctorTable } = await import("./doctor")
    const results = await runDoctor()
    printDoctorTable(results)
    process.exit(0)
  }

  if (subcommand === "install" && Bun.argv[3]) {
    const { runInstall } = await import("./install")
    const agentKind = Bun.argv[3]
    const args = Bun.argv.slice(4)
    const serverIdx = args.indexOf("--server")
    const nameIdx = args.indexOf("--name")
    const dryRun = args.includes("--dry-run")
    const result = await runInstall(agentKind, {
      server: serverIdx !== -1 ? args[serverIdx + 1] : undefined,
      name: nameIdx !== -1 ? args[nameIdx + 1] : undefined,
      dryRun,
    })
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.success ? 0 : 1)
  }

  // SEM GRAPH_REPO_PATH. O servidor não é de um repo — o repo é ARGUMENTO de `graph.bootstrap`, e
  // qual repo cada tenant indexou fica no banco (tabela `tenants`). Amarrar o processo a um repo
  // por env var era o resquício do modelo em que o grafo morava dentro dele: contradizia
  // multi-tenant (um servidor, N tenants, N repos) e era load-bearing depois de todo restart.
  // Estado vazio na primeira subida é o correto: um cliente chama graph.bootstrap e pronto.
  //
  // Leave ALLOWED_ORIGINS unset for the open default (*). Setting it to "" is NOT the same as
  // unsetting it — it filters down to [], which fails closed (every Origin rejected), not open.
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const stateDir = process.env.STATE_DIR ?? ".graph-server"
  // Falha alto aqui, ANTES de startServer(): DOMAINS malformado tem que travar o boot com uma
  // mensagem apontando a env var, nunca cair silenciosamente pra "sem regras" (essa era a falha —
  // ver o comentário de parseDomainsEnv acima).
  const domains = parseDomainsEnv(process.env.DOMAINS)
  // Mesma disciplina do DOMAINS acima: falha alto ANTES de startServer() em vez de deixar um PORT
  // malformado virar NaN silencioso (ver comentário de parsePortEnv).
  const port = parsePortEnv(process.env.PORT)
  // Mesma disciplina: HOST malformado trava o boot (ver parseHostEnv acima) — o default seguro,
  // 127.0.0.1, evita o servidor de um beta local ficar exposto na rede inteira (bug corrigido aqui:
  // Bun.serve sem hostname faz bind em 0.0.0.0).
  const host = parseHostEnv(process.env.HOST)
  const logFile = process.env.LOG_FILE ?? path.join(stateDir, "server.log")
  const running = startServer({
    stateDir,
    port,
    host,
    watch: process.env.WATCH !== "false",
    watchTenant: process.env.WATCH_TENANT ?? DEFAULT_TENANT,
    allowedOrigins,
    domains,
    log: true,
    logFile,
  })
  const tenants = running.state.graphs.size
  // Comportamento de stdout preservado (não removido, só complementado pelo arquivo em log.ts).
  console.log(
    `open-graph MCP server on ${running.url} (host: ${host}, state: ${stateDir}, ${tenants} tenant(s) hidratado(s) do banco, log: ${logFile})`,
  )
}
