/**
 * transport.ts — JSON-RPC 2.0 sobre HTTP em /mcp (spec §4.1). Feito à mão (é pequeno: 5 métodos)
 * porque o transport do SDK MCP é Streamable-HTTP-orientado e briga com Bun.serve + o /events SSE
 * próprio (decisão registrada no README). O SDK entra só p/ a constante de versão do protocolo.
 *
 * resources/subscribe NÃO é implementado de propósito: streaming é SÓ pelo SSE próprio /events
 * (ADR nota 2025). Métodos: initialize, tools/list, tools/call, resources/list, resources/read.
 */
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js"
import { DEFAULT_TENANT, type ServerState } from "./state"
import { graphBootstrap, graphRebuild } from "./tools/graph-bootstrap"
import { query } from "./tools/graph-query"
import { impact, DEFAULT_IMPACT_DEPTH, MAX_IMPACT_DEPTH, DEFAULT_IMPACT_LIMIT, MAX_IMPACT_LIMIT } from "./tools/graph-impact"
import { subscribe } from "./tools/graph-subscribe"
import { sessionRegister, requireToken } from "./tools/session"
import { lookupToken } from "./tokens"
import { changesetOpen, changesetClaim, changesetCommit, changesetAbort, changesetExtend, changesetListMine, nodeEdit } from "./tools/changeset"
import { authorityFlip } from "./tools/authority"
import { presenceWho, presenceFocus, presenceBeat } from "./tools/presence"
import { systemPending } from "./system-message"
import { presenceTyping } from "./tools/typing"
import { resolveResource, RESOURCE_LIST } from "./resources"

function tenantOf(state: ServerState, token: unknown): string {
  // Ausência de token é INTENCIONAL e load-bearing (D13): o web client lê graph://snapshot no
  // tenant default ANTES do usuário se registrar uma identidade — isso não pode virar erro.
  if (typeof token !== "string" || !token) return DEFAULT_TENANT
  // Mas token PRESENTE e desconhecido é um caso diferente: era engolido no mesmo `?? DEFAULT_TENANT`
  // de cima, então um token errado/expirado caía silenciosamente no tenant default e devolvia "not
  // bootstrapped" — parecendo repo errado quando na verdade é auth errada. Explicitar aqui (mesma
  // mensagem de requireToken, session.ts) em vez de conflatar os dois casos.
  const info = lookupToken(state, token)
  if (!info) throw new Error("invalid or expired token — call session.register")
  return info.tenantId
}

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: any }
type RpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } }

const TOOLS = [
  {
    name: "graph.bootstrap",
    description:
      "Index a repo path and persist the graph into the caller's tenant (nodes + import edges, deterministic, no LLM). The repo is only READ — the graph lives in the server. Idempotent per tenant.",
    inputSchema: { type: "object", required: ["token"], properties: { token: { type: "string" }, repoPath: { type: "string" } } },
  },
  {
    name: "graph.query",
    description: "Query the published graph by terms (+ optional domain/layer/limit). Returns candidates + gaps.",
    inputSchema: {
      type: "object",
      required: ["terms"],
      properties: {
        terms: { type: "array", items: { type: "string" } },
        domain: { type: "string" },
        layer: { type: "string", enum: ["P1", "P2", "P3", "P4", "P5"] },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "graph.impact",
    description:
      `What breaks if I change this file? Traverses the published graph's depends-on edges from a node id (repo-relative POSIX file path, e.g. "auth/login.ts"). Returns dependents (nodes that depend on id — the blast radius) and dependencies (nodes id depends on), up to depth hops (default ${DEFAULT_IMPACT_DEPTH}, max ${MAX_IMPACT_DEPTH}, silently clamped), plus the authority/lock state of every cell touched — so an agent can tell if the impact lands on a cell someone else is editing right now. Unknown id returns an explicit gap, never a silent empty result. ` +
      `dependents/dependencies/cells are each capped at limit (default ${DEFAULT_IMPACT_LIMIT}, max ${MAX_IMPACT_LIMIT}; a value above the max is a named error, NOT clamped — unlike depth). A hub file in a large repo can have thousands of dependents; the returned lists are sorted by depth ascending then id (deterministic, stable across calls) and cut to limit, but totalDependents/totalDependencies/totalCells always report the REAL count computed before any cut, and dependentsTruncated/dependenciesTruncated/cellsTruncated say explicitly when the returned list is smaller than the total — truncation is never silent, and the total is never approximated.`,
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" }, depth: { type: "number" }, limit: { type: "number" }, token: { type: "string" } },
    },
  },
  {
    name: "graph.subscribe",
    description: "Register/replace the SSE session filters. Default [{kind:'all'}].",
    inputSchema: {
      type: "object",
      required: ["sessionId", "filters"],
      // `token` OPCIONAL de propósito (SB-0 §5): quando vem, subscribe() valida o binding
      // sessionId→token e recusa quem não é dono da sessão; quando não vem, o comportamento antigo é
      // preservado — packages/client `subscribe()` chama sem token e não pode quebrar nesta campanha.
      properties: { sessionId: { type: "string" }, filters: { type: "array" }, token: { type: "string" } },
    },
  },
  {
    name: "graph.rebuild",
    description: "Re-index the caller tenant's repo, persist the result, and re-emit its snapshot to that tenant's subscribers.",
    inputSchema: { type: "object", required: ["token"], properties: { token: { type: "string" } } },
  },
  {
    name: "session.register",
    description:
      "Register a session under a tenant. Returns { token, userId, tenantId, expiresAt }. Call this FIRST — every other tool except graph.query requires the token it returns. The token survives a server restart (persisted, 90-day expiry); if a call ever fails with 'invalid or expired token', call this again with the same name to get a fresh one — the identity (and any open changeset) is preserved.",
    inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" }, tenant: { type: "string" } } },
  },
  {
    name: "changeset.open",
    description: "Open a turn locking the given β/new cells (pessimistic, atomic). Reuses cs for same holder.",
    inputSchema: { type: "object", required: ["token", "cells", "intent"], properties: { token: { type: "string" }, cells: { type: "array", items: { type: "string" } }, intent: { type: "string" } } },
  },
  {
    name: "changeset.claim",
    description:
      "Add a delta (claim.add | authority.flip) to an open changeset. Runs the incremental gate. csId is OPTIONAL (F1): without a turn already open on the delta's cell, opens one implicitly (intent \"\") and returns its csId. " +
      "claim.add payload: id, subject, domain, level (0-5, 5=code…0=ideation), refs (ids of OTHER CLAIMS exactly 1 level away — never a bare node id), file, anchor (verbatim substring of file's source, or blocked). refs:[] only valid at level 0 or 5, else orphan-midladder. " +
      "refs double as node coverage for authority.flip's gate, but that gate reads node ids while this one requires claim ids — reconcile by adding a floor claim per node (id = the node's id, level 5, refs: [], anchor verbatim) and pointing level-4 claims at that floor claim's id, not at the raw node id. Skipping the floor claim is accepted here (warns roundtrip dangling-ref) but changeset.commit then hard-blocks with the same dangling-ref.",
    inputSchema: { type: "object", required: ["token", "delta"], properties: { token: { type: "string" }, csId: { type: "string" }, delta: { type: "object" } } },
  },
  {
    name: "changeset.commit",
    description: "Run the final gate atomically and admit the changeset, or abort it with reasons. intent is required here (F1: migrated from changeset.open).",
    inputSchema: { type: "object", required: ["token", "csId", "intent"], properties: { token: { type: "string" }, csId: { type: "string" }, intent: { type: "string" } } },
  },
  { name: "changeset.abort", description: "Discard an open changeset and release its locks.", inputSchema: { type: "object", required: ["token", "csId"], properties: { token: { type: "string" }, csId: { type: "string" } } } },
  { name: "changeset.extend", description: "Renew the TTL of an open changeset's locks.", inputSchema: { type: "object", required: ["token", "csId"], properties: { token: { type: "string" }, csId: { type: "string" } } } },
  { name: "changeset.list_mine", description: "List the caller's open changesets (reattach after reconnect).", inputSchema: { type: "object", required: ["token"], properties: { token: { type: "string" } } } },
  {
    name: "node.edit",
    description:
      "F1 lock implícito: gatilho da UI ao ENTRAR em edição num nó, antes de existir delta. Abre/reusa o turno da célula do nó. Returns { ok:true, csId, cell } or { ok:false, editingBy, holderName, since } on contention.",
    inputSchema: { type: "object", required: ["token", "nodeId"], properties: { token: { type: "string" }, nodeId: { type: "string" } } },
  },
  {
    name: "authority.flip",
    description:
      "Flip a cell's authority (source ↔ graph) via an ephemeral changeset. Runs the full gate pipeline; emits authority.flipped (always broadcast to all connected sessions). " +
      "source→graph (β) requires CLOSED coverage: every node in the cell must appear in some committed claim's refs (see changeset.claim for the floor-claim pattern that makes this reachable) — otherwise rejected as \"cell coverage not closed\". cell is \"domain:level\" — both spellings are equivalent and interchangeable (\"auth:4\" and \"auth:P4\" are the same cell; the server canonicalizes).",
    inputSchema: {
      type: "object",
      required: ["token", "cell", "to"],
      properties: { token: { type: "string" }, cell: { type: "string" }, to: { type: "string", enum: ["source", "graph"] } },
    },
  },
  {
    name: "presence.who",
    description: "List currently present users (excludes invisible sessions). Filterable by cell (focusing it) or cs_id (has it open).",
    inputSchema: { type: "object", required: ["token"], properties: { token: { type: "string" }, cell: { type: "string" }, cs_id: { type: "string" } } },
  },
  {
    name: "presence.focus",
    description:
      "Declare (or clear, if cell omitted/null) the focus cell for this session. Broadcasts user.focused after a short settle debounce (spec §6.3). invisible:true hides the session from presence.who and suppresses its broadcasts. " +
      "sessionId is OPTIONAL: a client that never opened GET /events (no SSE — e.g. `claude mcp add --transport http`) has none to pass. Omit it and the server derives one from your token and returns it in `sessionId`; pass that back on later calls to keep updating the SAME presence entry instead of registering a new one each time. This session has no push channel (there is nothing to stream to), but it IS visible in presence.who and IS a valid recipient for lock.denied/etc — pair with a non-\"web\" agentKind to also start receiving text via system.pending.",
    inputSchema: {
      type: "object",
      required: ["token"],
      properties: { token: { type: "string" }, sessionId: { type: "string" }, cell: { type: ["string", "null"] }, invisible: { type: "boolean" }, agentKind: { type: "string" } },
    },
  },
  {
    name: "presence.beat",
    description:
      "Heartbeat for this session's presence. No beat for 60s expires the presence (user.left, reason heartbeat_expired). " +
      "sessionId is OPTIONAL: omit it if you never opened GET /events (no SSE) — the server derives a stable id from your token and returns it in `sessionId`; reuse that id on later beats.",
    inputSchema: { type: "object", required: ["token"], properties: { token: { type: "string" }, sessionId: { type: "string" }, agentKind: { type: "string" } } },
  },
  {
    name: "presence.typing",
    description: "Record authenticated web input activity for the typing-state aggregator.",
    inputSchema: { type: "object", required: ["token"], properties: { token: { type: "string" } } },
  },
  {
    name: "system.pending",
    description: "Drain (return and clear) system.message text queued for the caller since their last poll. Stateless — safe to call from a fresh process with no live SSE connection.",
    inputSchema: { type: "object", required: ["token"], properties: { token: { type: "string" } } },
  },
]

function callTool(state: ServerState, name: string, args: any): unknown {
  switch (name) {
    case "graph.bootstrap":
      // Um comando só: indexa o repo E persiste no tenant do chamador. Eram dois
      // (`graph.bootstrap` publicava em memória, `graph.import` levava ao banco) e ninguém
      // encadeava — o grafo sumia no restart. requireToken (não tenantOf, que cai em
      // DEFAULT_TENANT em silêncio): indexar ESCREVE.
      return graphBootstrap(state, args)
    case "graph.query":
      return query(state, { terms: args.terms, domain: args.domain, layer: args.layer, limit: args.limit }, tenantOf(state, args.token))
    case "graph.impact":
      return impact(state, args, tenantOf(state, args.token))
    case "graph.subscribe":
      // Sem default de filters aqui: inputSchema já marca `filters` required, e subscribe() valida
      // Array.isArray explicitamente — um `?? []` aqui mascararia um caller que manda `filters`
      // ausente/malformado atrás de um "sucesso" silencioso em vez do erro que ele devia ver.
      return subscribe(state, args.sessionId, args.filters, args.token)
    case "graph.rebuild":
      return graphRebuild(state, args)
    case "session.register":
      return sessionRegister(state, args)
    case "changeset.open":
      return changesetOpen(state, args)
    case "changeset.claim":
      return changesetClaim(state, args)
    case "changeset.commit":
      return changesetCommit(state, args)
    case "changeset.abort":
      return changesetAbort(state, args)
    case "changeset.extend":
      return changesetExtend(state, args)
    case "changeset.list_mine":
      return changesetListMine(state, args)
    case "node.edit":
      return nodeEdit(state, args)
    case "authority.flip":
      return authorityFlip(state, args)
    case "presence.who":
      return presenceWho(state, args)
    case "presence.focus":
      return presenceFocus(state, args)
    case "presence.beat":
      return presenceBeat(state, args)
    case "presence.typing":
      return presenceTyping(state, args)
    case "system.pending":
      return systemPending(state, args)
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}

function dispatch(state: ServerState, method: string, params: any): unknown {
  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion
      const protocolVersion =
        typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION
      return {
        protocolVersion,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "open-graph-mcp", version: "0.1.0" },
      }
    }
    case "tools/list":
      return { tools: TOOLS }
    case "tools/call": {
      try {
        const result = callTool(state, params.name, params.arguments ?? {})
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result }
      } catch (err) {
        // callTool's own `default: throw new Error("unknown tool: ...")` is the SINGLE source of
        // truth for "is this a valid tool name" (vs. keeping a second TOOLS-array lookup in sync by
        // hand). Re-throw that specific case so it escapes to handleRpc's outer catch → -32602
        // (protocol error), instead of being swallowed here into isError:true like a normal
        // tool-execution failure.
        if (/^unknown tool:/.test((err as Error).message)) throw err
        return { content: [{ type: "text", text: (err as Error).message }], isError: true }
      }
    }
    case "resources/list":
      return { resources: RESOURCE_LIST }
    case "resources/read": {
      const contents = resolveResource(state, params.uri, tenantOf(state, params.token))
      return { contents: [{ uri: params.uri, mimeType: "application/json", text: JSON.stringify(contents) }] }
    }
    default:
      throw new Error(`method not found: ${method}`)
  }
}

export function handleRpc(state: ServerState, req: unknown): RpcResponse | null {
  // Envelope malformado → -32600 Invalid Request, NUNCA deixar passar pra baixo. index.ts já cobre
  // JSON não-parseável (-32700) antes de chamar isto; aqui é sobre o valor que SURVIVE ao JSON.parse
  // mas não é um request JSON-RPC conforme. Dois casos reais achados em probe ao vivo:
  //  - body `null` (`curl -d 'null'`): `req.id` num `null` bruto explode em TypeError, que escapava
  //    do handler do Bun.serve e virava um 500 cru sem corpo JSON-RPC nenhum — cliente sem como parsear o erro.
  //  - body `[{...}]` (batch array): batching foi removido na rev 2025-06-18 do MCP, mas antes disto
  //    `req.id` num array dava `undefined`, o request era tratado como "notification" (silenciosa por
  //    design), o dispatch por baixo explodia e o catch de notification engolia tudo → 204 silencioso.
  //    Rejeitar array é correto; fazer isso em silêncio não é — tem que ser um -32600 explícito.
  if (typeof req !== "object" || req === null || Array.isArray(req) || typeof (req as { method?: unknown }).method !== "string") {
    const maybeId = (req as { id?: unknown } | null)?.id
    const id = typeof maybeId === "string" || typeof maybeId === "number" ? maybeId : null
    return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } }
  }
  const validReq = req as RpcRequest
  const id = validReq.id ?? null
  if (validReq.id === undefined) {
    // notification — sem resposta
    try {
      dispatch(state, validReq.method, validReq.params ?? {})
    } catch {
      /* notifications não retornam erro */
    }
    return null
  }
  try {
    return { jsonrpc: "2.0", id, result: dispatch(state, validReq.method, validReq.params ?? {}) }
  } catch (err) {
    const msg = (err as Error).message
    const code = /^method not found:/.test(msg) ? -32601 : /^unknown tool:/.test(msg) ? -32602 : -32603
    return { jsonrpc: "2.0", id, error: { code, message: (err as Error).message } }
  }
}
