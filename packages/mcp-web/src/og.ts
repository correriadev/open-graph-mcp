/**
 * Conexão única com o server via @open-graph-mcp/client (WD3): connect() é dono
 * de register/SSE/reconnect/reauth (INT-2/QA-1). Este módulo só projeta o handle
 * pro estado de UI. Sem api.ts: tool calls futuras vão por og().call(); leituras
 * de resource pelo resourceRead da lib, sempre com o token cacheado quando
 * existir — o server resolve tenant pelo token (transport.ts tenantOf); sem
 * token (visitante anônimo pré-registro) a leitura cai no tenant default.
 */
import { connect, resourceRead, type OgHandle, type ReauthEvent } from "@open-graph-mcp/client"
import { localStorageTokenStore } from "./token-store"
import { useUi } from "./store"

export function serverBase(): string {
  const q = new URLSearchParams(location.search).get("server")
  return (q || "http://localhost:8787").replace(/\/$/, "")
}

const tenant = new URLSearchParams(location.search).get("tenant") || undefined
const tokenStore = localStorageTokenStore()

let handle: OgHandle | null = null
export const og = (): OgHandle | null => handle

export async function loadSnapshot(): Promise<void> {
  try {
    const res = await resourceRead(serverBase(), "graph://snapshot", tokenStore.get()?.token)
    useUi.getState().setGraph(res.graph)
  } catch (e) {
    console.error("snapshot failed", e)
  }
}

/**
 * (Re)conecta — boot e troca de nome (identidade nova derruba a conexão
 * anterior, mesmo contrato do connectOg antigo). Sem nome nem token cache,
 * conecta anônimo: SSE aberto, snapshot visível, sem identidade.
 */
export async function connectOg(name?: string): Promise<void> {
  const cached = tokenStore.get()
  const finalName = (name || localStorage.getItem("og.name") || "").trim()

  handle?.close()
  try {
    handle = await connect({
      server: serverBase(),
      agentKind: "web",
      tenant,
      ...(cached || finalName ? { store: tokenStore, name: finalName || undefined } : {}),
      onOpen: () => useUi.getState().setConn("on"),
      onClose: () => useUi.getState().setConn("off"),
      onReset: () => loadSnapshot(),
      onReauth: (ev: ReauthEvent) => {
        if (ev.type === "reregistered") useUi.getState().setIdentity(finalName, ev.creds.userId)
        else console.error("auto re-register failed", ev.error)
      },
    })
  } catch (e) {
    console.error("connect failed", e)
    handle = null
    return
  }

  handle.on("*", (env) => {
    // UI-0: só o mínimo que mantém o snapshot verdadeiro; projeção completa é UI-1.
    if (env.kind === "graph.rebuilt" || env.kind === "graph.bootstrapped" || env.kind === "changeset.committed")
      loadSnapshot()
  })

  const creds = tokenStore.get()
  if (creds && finalName) {
    localStorage.setItem("og.name", finalName)
    useUi.getState().setIdentity(finalName, creds.userId)
    // registro pode ter trocado o tenant efetivo (token novo) — re-lê com a credencial certa
    await loadSnapshot()
  }
}
