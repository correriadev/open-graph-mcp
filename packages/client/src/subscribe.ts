export type Envelope = {
  schemaVersion: 1
  seq: number
  ts: number
  kind: string
  target: string
  payload: any
  graphId: string
  /** Server contract: ephemeral events (presence) reuse the current durable seq — never advance `since`, never dedup by seq. */
  ephemeral?: true
}

// ---- pure logic (unit-tested) ---------------------------------------------

/** Parse an SSE data line into an Envelope, or null if malformed / wrong schema. */
export function parseEnvelope(raw: string): Envelope | null {
  let v: any
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (!v || v.schemaVersion !== 1) return null
  if (typeof v.seq !== "number" || typeof v.kind !== "string" || typeof v.graphId !== "string") return null
  return v as Envelope
}

/**
 * Reconnection rule (spec §6): a graphId mismatch means the server re-bootstrapped and our
 * `since` is meaningless — the caller must drop it, refetch the snapshot and resubscribe from 0.
 */
export function classifyEnvelope(
  env: Envelope,
  knownGraphId: string | null,
  lastSeq: number,
): "reset" | "apply" | "duplicate" {
  if (knownGraphId !== null && env.graphId !== knownGraphId) return "reset"
  // Ephemeral events (presence) intentionally reuse the current durable seq — they are exempt from
  // seq dedup and must NOT advance lastSeq (the dispatch loop guards the cursor update too).
  if (env.ephemeral === true) return "apply"
  if (env.seq <= lastSeq) return "duplicate"
  return "apply"
}

/**
 * Split one raw SSE frame (everything between two blank lines) into its `event:` name and joined
 * `data:` lines. The server (mcp-server/src/sse.ts) names every frame after its envelope kind — e.g.
 * `event: drift.node` — instead of the SSE default (`message`/unnamed). `EventSource#onmessage` only
 * ever fires for the default-named event, so a plain EventSource silently drops every frame the server
 * sends; this parser is why the client reads the stream with `fetch` + `ReadableStream` (below) rather
 * than the EventSource API. Returns null for a frame with no `data:` line (keep-alive comments etc).
 */
export function parseFrame(raw: string): { event: string; data: string } | null {
  let event = "message"
  let data: string | null = null
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim()
    else if (line.startsWith("data:")) {
      // SSE strips exactly ONE leading space after "data:", not arbitrary whitespace — full trim()
      // would corrupt payloads whose significant content is (or ends with) whitespace.
      const value = line.slice(5).replace(/^ /, "")
      data = (data === null ? "" : `${data}\n`) + value
    }
  }
  return data === null ? null : { event, data }
}

// ---- fetch/ReadableStream wiring (impure) ---------------------------------

export type StreamHandlers = {
  onEvent: (env: Envelope) => void
  onReset: () => void
  onOpen: () => void
  onClose: () => void
  /** First frame of a connection (spec §3.3/§9.1): the SSE session id presence.beat/focus need. */
  onSessionId?: (sessionId: string) => void
}

/**
 * Connection-level config, injected by the caller rather than imported from a fixed module.
 *
 * The original mcp-web implementation this class was extracted from (INT-2 T2) imported
 * `getToken`/`serverBase` directly from mcp-web's local `./api` module. That module is app-specific
 * (session/changeset/audit RPCs) and can't be a dependency of this zero-runtime-dep package without
 * creating a cycle (mcp-web already depends on @open-graph-mcp/client). Threading them through the
 * constructor instead keeps this class's behavior byte-for-byte identical — same URL, same token
 * query param — while letting any consumer supply its own token/base-URL source.
 */
export type EventStreamOptions = {
  /** Compute the SSE server base URL (no trailing slash) at connect time. */
  serverBase: () => string
  /** Return the current auth token, or null if unauthenticated. Omit if the caller has no auth concept. */
  getToken?: () => string | null
}

export class EventStream {
  private abort: AbortController | null = null
  private backoff = 500
  private closed = false
  private generation = 0
  graphId: string | null = null
  lastSeq = 0

  private readonly h: StreamHandlers
  private readonly opts: EventStreamOptions

  constructor(h: StreamHandlers, opts: EventStreamOptions) {
    this.h = h
    this.opts = opts
  }

  start() {
    this.closed = false
    this.open()
  }

  stop() {
    this.closed = true
    this.generation++ // suppress the stale read loop's catch (its abort rejection must not reconnect)
    this.abort?.abort()
    this.abort = null
  }

  /** Drop local cursor and reconnect from scratch — used after a graphId reset. */
  reset() {
    this.graphId = null
    this.lastSeq = 0
    this.reconnect(0)
  }

  private async open() {
    const gen = ++this.generation
    const ac = new AbortController()
    this.abort = ac
    const token = this.opts.getToken?.() ?? null
    const tokenQ = token ? `&token=${encodeURIComponent(token)}` : ""
    try {
      const res = await fetch(`${this.opts.serverBase()}/events?since=${this.lastSeq}${tokenQ}`, {
        signal: ac.signal,
        headers: { accept: "text/event-stream" },
      })
      if (!res.ok || !res.body) throw new Error(`events → HTTP ${res.status}`)
      this.backoff = 500
      this.h.onOpen()
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (gen !== this.generation) return // superseded by a reset()/reconnect — drop stale reads
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let cut: number
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, cut)
          buf = buf.slice(cut + 2)
          this.dispatchFrame(raw)
        }
      }
      if (gen === this.generation) this.onDisconnect()
    } catch {
      if (gen === this.generation) this.onDisconnect()
    }
  }

  private dispatchFrame(raw: string) {
    const frame = parseFrame(raw)
    if (!frame) return
    if (frame.event === "session.created") {
      try {
        const { sessionId } = JSON.parse(frame.data)
        if (typeof sessionId === "string") this.h.onSessionId?.(sessionId)
      } catch {
        /* malformed session.created frame — ignore */
      }
      return
    }
    this.dispatch(frame.data)
  }

  private dispatch(raw: string) {
    const env = parseEnvelope(raw)
    if (!env) return
    switch (classifyEnvelope(env, this.graphId, this.lastSeq)) {
      case "reset":
        this.h.onReset()
        this.reset()
        return
      case "duplicate":
        return
      case "apply":
        this.graphId = env.graphId
        if (!env.ephemeral) this.lastSeq = env.seq // ephemeral seq never moves the replay cursor
        this.h.onEvent(env)
    }
  }

  private onDisconnect() {
    this.h.onClose()
    this.reconnect(this.backoff)
    this.backoff = Math.min(this.backoff * 2, 10_000)
  }

  private reconnect(delay: number) {
    // Bump generation BEFORE aborting: the in-flight read loop's reader.read() will reject, but its
    // catch guards on `gen === this.generation` — now false — so it won't fire a second onDisconnect
    // (which would leak an orphaned connection by overwriting this.abort without aborting the first).
    this.generation++
    this.abort?.abort()
    this.abort = null
    if (this.closed) return
    setTimeout(() => {
      if (!this.closed) this.open()
    }, delay)
  }
}
