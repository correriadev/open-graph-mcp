/**
 * transport.ts — JSON-RPC 2.0 sobre HTTP em /mcp (spec §4.1). Feito à mão (é pequeno: 5 métodos)
 * porque o transport do SDK MCP é Streamable-HTTP-orientado e briga com Bun.serve + o /events SSE
 * próprio (decisão registrada no README). O SDK entra só p/ a constante de versão do protocolo.
 *
 * resources/subscribe NÃO é implementado de propósito: streaming é SÓ pelo SSE próprio /events
 * (ADR nota 2025). Métodos: initialize, tools/list, tools/call, resources/list, resources/read.
 */
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js"
import { DEFAULT_TENANT, type Filter, type ServerState } from "./state"
import { bootstrap, rebuild } from "./tools/graph-bootstrap"
import { query } from "./tools/graph-query"
import { subscribe } from "./tools/graph-subscribe"
import { sessionRegister } from "./tools/session"
import { graphImport } from "./tools/graph-import"
import { changesetOpen, changesetClaim, changesetCommit, changesetAbort, changesetExtend, changesetListMine } from "./tools/changeset"
import { authorityFlip } from "./tools/authority"
import { presenceWho, presenceFocus, presenceBeat } from "./tools/presence"
import { systemPending } from "./system-message"
import { presenceTyping } from "./tools/typing"
import { resolveResource, RESOURCE_LIST } from "./resources"

function tenantOf(state: ServerState, token: unknown): string {
  if (typeof token !== "string" || !token) return DEFAULT_TENANT
  return state.tokens.get(token)?.tenantId ?? DEFAULT_TENANT
}

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: any }
type RpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } }

const TOOLS = [
  {
    name: "graph.bootstrap",
    description: "Publish a graph from a repo path. Loads .graph/graph.json if present, else builds a deterministic structural skeleton. Idempotent.",
    inputSchema: { type: "object", properties: { repoPath: { type: "string" } } },
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
    name: "graph.subscribe",
    description: "Register/replace the SSE session filters. Default [{kind:'all'}].",
    inputSchema: {
      type: "object",
      required: ["sessionId", "filters"],
      properties: { sessionId: { type: "string" }, filters: { type: "array" } },
    },
  },
  { name: "graph.rebuild", description: "Re-read .graph/ and re-emit snapshot to all subscribers.", inputSchema: { type: "object", properties: {} } },
  {
    name: "session.register",
    description: "Register a session under a tenant. Returns { token, userId, tenantId }. Token is in-memory (lost on restart).",
    inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" }, tenant: { type: "string" } } },
  },
  {
    name: "graph.import",
    description: "Migrate a Phase-1 .graph/ into the authoritative SQLite for the caller's tenant (idempotent).",
    inputSchema: { type: "object", required: ["token"], properties: { token: { type: "string" }, repoPath: { type: "string" } } },
  },
  {
    name: "changeset.open",
    description: "Open a turn locking the given β/new cells (pessimistic, atomic). Reuses cs for same holder.",
    inputSchema: { type: "object", required: ["token", "cells", "intent"], properties: { token: { type: "string" }, cells: { type: "array", items: { type: "string" } }, intent: { type: "string" } } },
  },
  {
    name: "changeset.claim",
    description: "Add a delta (claim.add | authority.flip) to an open changeset. Runs the incremental gate.",
    inputSchema: { type: "object", required: ["token", "csId", "delta"], properties: { token: { type: "string" }, csId: { type: "string" }, delta: { type: "object" } } },
  },
  {
    name: "changeset.commit",
    description: "Run the final gate atomically and admit the changeset, or abort it with reasons.",
    inputSchema: { type: "object", required: ["token", "csId"], properties: { token: { type: "string" }, csId: { type: "string" } } },
  },
  { name: "changeset.abort", description: "Discard an open changeset and release its locks.", inputSchema: { type: "object", required: ["token", "csId"], properties: { token: { type: "string" }, csId: { type: "string" } } } },
  { name: "changeset.extend", description: "Renew the TTL of an open changeset's locks.", inputSchema: { type: "object", required: ["token", "csId"], properties: { token: { type: "string" }, csId: { type: "string" } } } },
  { name: "changeset.list_mine", description: "List the caller's open changesets (reattach after reconnect).", inputSchema: { type: "object", required: ["token"], properties: { token: { type: "string" } } } },
  {
    name: "authority.flip",
    description: "Flip a cell's authority (source ↔ graph) via an ephemeral changeset. Runs the full gate pipeline; emits authority.flipped (always broadcast to all connected sessions).",
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
      "Declare (or clear, if cell omitted/null) the focus cell for this session. Broadcasts user.focused after a short settle debounce (spec §6.3). invisible:true hides the session from presence.who and suppresses its broadcasts.",
    inputSchema: {
      type: "object",
      required: ["token", "sessionId"],
      properties: { token: { type: "string" }, sessionId: { type: "string" }, cell: { type: ["string", "null"] }, invisible: { type: "boolean" }, agentKind: { type: "string" } },
    },
  },
  {
    name: "presence.beat",
    description: "Heartbeat for this session's presence. No beat for 60s expires the presence (user.left, reason heartbeat_expired).",
    inputSchema: { type: "object", required: ["token", "sessionId"], properties: { token: { type: "string" }, sessionId: { type: "string" }, agentKind: { type: "string" } } },
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
      return bootstrap(state, args?.repoPath ?? state.repoPath)
    case "graph.query":
      return query(state, { terms: args.terms, domain: args.domain, layer: args.layer, limit: args.limit }, tenantOf(state, args.token))
    case "graph.subscribe":
      return subscribe(state, args.sessionId, (args.filters ?? []) as Filter[])
    case "graph.rebuild":
      return rebuild(state)
    case "session.register":
      return sessionRegister(state, args)
    case "graph.import":
      return graphImport(state, args)
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

export function handleRpc(state: ServerState, req: RpcRequest): RpcResponse | null {
  const id = req.id ?? null
  if (req.id === undefined) {
    // notification — sem resposta
    try {
      dispatch(state, req.method, req.params ?? {})
    } catch {
      /* notifications não retornam erro */
    }
    return null
  }
  try {
    return { jsonrpc: "2.0", id, result: dispatch(state, req.method, req.params ?? {}) }
  } catch (err) {
    const msg = (err as Error).message
    const code = /^method not found:/.test(msg) ? -32601 : /^unknown tool:/.test(msg) ? -32602 : -32603
    return { jsonrpc: "2.0", id, error: { code, message: (err as Error).message } }
  }
}
