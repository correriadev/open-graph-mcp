/**
 * Conexão única com o server via @open-graph-mcp/client (WD3): connect() é dono
 * de register/SSE/reconnect/reauth/presença (INT-2/QA-1). Este módulo fold-eia
 * cada envelope nos stores puros (PresenceStore da lib; GhostStore/ToastQueue
 * portados da UI velha com seus unit tests) e projeta snapshots imutáveis pro
 * zustand — componentes nunca tocam os singletons. Sem api.ts: tool calls por
 * og().call(), resources pelo resourceRead da lib com o token cacheado.
 */
import {
  connect,
  PresenceStore,
  resourceRead,
  type Envelope,
  type OgHandle,
  type ReauthEvent,
} from "@open-graph-mcp/client"
import { colorForCsId, GhostStore, type GhostDelta } from "./ghosts"
import { localStorageTokenStore } from "./token-store"
import { ToastQueue } from "./toasts"
import { useUi } from "./store"

const DRIFT_KINDS = new Set(["drift.node", "drift.cell"])
const CS_KINDS = new Set([
  "changeset.opened",
  "changeset.delta",
  "changeset.committed",
  "changeset.aborted",
  "lock.acquired",
  "lock.released",
])
const PRESENCE_KINDS = new Set(["user.joined", "user.focused", "user.left", "user.typing_state"])

export function serverBase(): string {
  const q = new URLSearchParams(location.search).get("server")
  return (q || "http://localhost:8787").replace(/\/$/, "")
}

const tenant = new URLSearchParams(location.search).get("tenant") || undefined
const tokenStore = localStorageTokenStore()

// ---- singletons puros (fold) + projeções imutáveis (zustand) ---------------
const presence = new PresenceStore()
const ghosts = new GhostStore()
const toasts = new ToastQueue()
const demotions = new Map<string, number>()

let handle: OgHandle | null = null
export const og = (): OgHandle | null => handle

/** Cell focada localmente — maybeToast precisa dela, e o toggle invisible re-envia a mesma. */
let focusedCell: string | null = null

function projectPresence(): void {
  useUi.setState({ roster: presence.list() })
}

function projectGhosts(): void {
  const locks = Object.fromEntries(ghosts.locks)
  const ghostCells: Record<string, string> = {}
  for (const cs of ghosts.changesets.values())
    for (const cell of cs.cells) ghostCells[cell] = colorForCsId(cs.csId)
  useUi.setState({ locks, ghostCells })
}

function projectToasts(): void {
  const { toasts: list, overflow } = toasts.visible(5)
  useUi.setState({ toasts: { list: [...list], overflow } })
}

function projectDrift(patch: Record<string, string>): void {
  useUi.setState((s) => ({ drift: { ...s.drift, ...patch } }))
}

function refreshDemotions(): void {
  const cutoff = Date.now() - 24 * 3600_000
  useUi.setState({ demotions: [...demotions.values()].filter((ts) => ts >= cutoff).length })
}

// ---- toasts ----------------------------------------------------------------
export function pushToast(key: string, text: string, target?: string): void {
  const t = toasts.push(key, text, { target })
  projectToasts()
  setTimeout(() => {
    toasts.remove(t.id)
    projectToasts()
  }, 8_000)
}

export const toastTarget = (id: string): string | undefined => toasts.all().find((t) => t.id === id)?.target

const myUserId = (): string => useUi.getState().userId || (localStorage.getItem("og.userId") ?? "")
/** userId → nome de exibição via roster vivo (cai pro próprio id). */
const nameOf = (userId: string): string => presence.users.get(userId)?.name ?? userId

/** Regras de toast da UI velha, portadas intactas (spec §7.4). */
function maybeToast(env: Envelope): void {
  const p = env.payload ?? {}
  const settings = useUi.getState().settings
  if (env.kind === "changeset.aborted" && p.reason === "ttl_expired") {
    pushToast(p.csId, `${p.csId} abortado por TTL`, p.cells?.[0])
  } else if (env.kind === "lock.acquired" && focusedCell && p.cell === focusedCell && p.holder !== myUserId()) {
    pushToast(p.csId ?? p.cell, `${nameOf(p.holder)} abriu turno em [${p.cell}] — você perdeu prioridade`, p.cell)
  } else if (env.kind === "changeset.committed" && settings.notifyCommits) {
    // payload não tem byUser — a entrada ghost (removida só depois deste handler) conhece o dono
    const opener = ghosts.changesets.get(p.csId)?.byUser
    if (opener && opener === myUserId()) return // não toastar o próprio commit
    const cell = p.cells?.[0]
    pushToast(p.csId, `${opener ? nameOf(opener) : "alguém"} commitou ${p.csId} em [${cell ?? "?"}]`, cell)
  }
}

// ---- presença --------------------------------------------------------------
export function setFocus(cell: string | null): void {
  focusedCell = cell
  // invisible sempre explícito: o server só atualiza invisibilidade quando o flag é boolean
  handle?.presence
    .focus(cell, { invisible: !useUi.getState().settings.showPresence })
    .catch((e) => console.error("presence.focus failed", e))
}

/** Toggle de invisibilidade re-envia a MESMA cell focada com o flag novo. */
export function refreshFocus(): void {
  setFocus(focusedCell)
}

export async function pollWho(): Promise<void> {
  if (!handle || !tokenStore.get()) return
  try {
    const res: any = await handle.call("presence.who", {})
    presence.mergeWho(res?.users ?? [])
    projectPresence()
  } catch (e) {
    console.error("presence.who failed", e)
  }
}

setInterval(pollWho, 10_000)
// dots de idade (dotColor) mudam sem tráfego novo — re-projeta o roster periodicamente
setInterval(projectPresence, 5_000)

// ---- ghost deltas: refetch com debounce de graph://changeset/{id} ----------
const refetchTimers = new Map<string, ReturnType<typeof setTimeout>>()
function refetchDeltas(csId: string): void {
  clearTimeout(refetchTimers.get(csId))
  refetchTimers.set(
    csId,
    setTimeout(async () => {
      try {
        const res: any = await resourceRead(serverBase(), `graph://changeset/${csId}`, tokenStore.get()?.token)
        const raw: any[] = res?.deltas ?? res?.changeset?.deltas ?? []
        ghosts.setDeltas(csId, raw.map(toGhostDelta))
        projectGhosts()
      } catch (e) {
        console.error("changeset refetch failed", e)
      }
    }, 150),
  )
}

function toGhostDelta(d: any): GhostDelta {
  const pl = d.payload ?? {}
  return { kind: d.kind, subject: pl.subject, domain: pl.domain ?? null, level: pl.level, summary: pl.subject ?? pl.cell ?? d.kind, at: d.createdAt ?? d.at }
}

async function loadOpenChangesets(): Promise<void> {
  try {
    const res: any = await resourceRead(serverBase(), "graph://changesets?status=open", tokenStore.get()?.token)
    const list: any[] = res?.changesets ?? res ?? []
    for (const cs of list) {
      ghosts.track({
        csId: cs.csId ?? cs.id,
        intent: cs.intent ?? "",
        cells: cs.cells ?? [],
        byUser: cs.byUser ?? "?",
        openedAt: cs.openedAt ?? 0,
        expiresAt: cs.expiresAt ?? "",
        deltaCount: 0,
        deltas: [],
      })
      refetchDeltas(cs.csId ?? cs.id)
    }
    projectGhosts()
  } catch (e) {
    console.error("open changesets failed", e)
  }
}

// ---- snapshot --------------------------------------------------------------
export async function loadSnapshot(): Promise<void> {
  try {
    const res = await resourceRead(serverBase(), "graph://snapshot", tokenStore.get()?.token)
    useUi.getState().setGraph(res.graph)
    await loadOpenChangesets()
  } catch (e) {
    console.error("snapshot failed", e)
  }
}

// ---- projeção de eventos ---------------------------------------------------
function applyEvent(env: Envelope): void {
  useUi.setState((s) => ({
    seq: env.seq ?? s.seq,
    events: [{ seq: env.seq ?? 0, ts: env.ts || Date.now(), kind: env.kind, target: env.target }, ...s.events].slice(0, 20),
  }))

  if (DRIFT_KINDS.has(env.kind) && env.target) projectDrift({ [env.target]: env.payload?.grade ?? "drift" })
  if (env.kind === "authority.demoted" && env.target) {
    demotions.set(env.target, env.ts || Date.now())
    refreshDemotions()
  }
  if (env.kind === "authority.reconciled" && env.target) {
    demotions.delete(env.target)
    refreshDemotions()
  }
  if (env.kind === "graph.rebuilt" || env.kind === "graph.bootstrapped") loadSnapshot()

  if (env.kind === "server.restarted") {
    // presença vive só na memória do server (spec §9.1); a recuperação em si é do connect()
    pushToast("server", "Server reiniciou — sua presença foi resetada")
  }

  if (PRESENCE_KINDS.has(env.kind)) {
    presence.apply(env)
    projectPresence()
  }

  maybeToast(env)

  if (CS_KINDS.has(env.kind) || env.kind === "authority.flipped") {
    const r = ghosts.apply(env)
    if (r.refetch) refetchDeltas(r.refetch)
    if (r.committed) loadSnapshot()
    projectGhosts()
  }
}

/**
 * (Re)conecta — boot e troca de nome (identidade nova derruba a conexão
 * anterior). Sem nome nem token cache, conecta anônimo: SSE aberto, snapshot
 * visível, sem identidade.
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
      // pós-(re)conexão: user.* efêmeros não são re-emitidos pra sessão nova — poll imediato;
      // changesets ainda abertos desta identidade voltam pros ghosts (spec §9)
      onReattach: (res: any) => {
        const mine: any[] = res?.changesets ?? res ?? []
        for (const cs of mine) {
          ghosts.track({
            csId: cs.csId ?? cs.id,
            intent: cs.intent ?? "",
            cells: cs.cells ?? [],
            byUser: cs.byUser ?? myUserId(),
            openedAt: cs.openedAt ?? 0,
            expiresAt: cs.expiresAt ?? "",
            deltaCount: 0,
            deltas: [],
          })
          refetchDeltas(cs.csId ?? cs.id)
        }
        projectGhosts()
        pollWho()
      },
      onReauth: (ev: ReauthEvent) => {
        if (ev.type === "reregistered") {
          useUi.getState().setIdentity(finalName, ev.creds.userId)
          localStorage.setItem("og.userId", ev.creds.userId)
          // prova visível de que a auto-recuperação QA-1 rodou (dupla com o toast de server.restarted — intencional)
          pushToast("reauth", "Sessão renovada automaticamente após reinício do servidor")
        } else console.error("auto re-register failed", ev.error)
      },
    })
  } catch (e) {
    console.error("connect failed", e)
    handle = null
    return
  }

  handle.on("*", applyEvent)

  const creds = tokenStore.get()
  if (creds && finalName) {
    localStorage.setItem("og.name", finalName)
    localStorage.setItem("og.userId", creds.userId)
    useUi.getState().setIdentity(finalName, creds.userId)
    // registro pode ter trocado o tenant efetivo — re-lê com a credencial certa
    await loadSnapshot()
    pollWho()
  }
}
