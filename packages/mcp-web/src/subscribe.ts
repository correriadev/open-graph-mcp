import { serverBase } from "./api"

export type Envelope = {
  schemaVersion: 1
  seq: number
  ts: number
  kind: string
  target: string
  payload: any
  graphId: string
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
  if (env.seq <= lastSeq) return "duplicate"
  return "apply"
}

// ---- EventSource wiring (impure) ------------------------------------------

export type StreamHandlers = {
  onEvent: (env: Envelope) => void
  onReset: () => void
  onOpen: () => void
  onClose: () => void
}

export class EventStream {
  private es: EventSource | null = null
  private backoff = 500
  private closed = false
  graphId: string | null = null
  lastSeq = 0

  constructor(private readonly h: StreamHandlers) {}

  start() {
    this.closed = false
    this.open()
  }

  stop() {
    this.closed = true
    this.es?.close()
    this.es = null
  }

  /** Drop local cursor and reconnect from scratch — used after a graphId reset. */
  reset() {
    this.graphId = null
    this.lastSeq = 0
    this.reconnect(0)
  }

  private open() {
    this.es = new EventSource(`${serverBase()}/events?since=${this.lastSeq}`)
    this.es.onopen = () => {
      this.backoff = 500
      this.h.onOpen()
    }
    this.es.onmessage = (ev) => this.dispatch(ev.data)
    this.es.onerror = () => {
      this.h.onClose()
      this.reconnect(this.backoff)
      this.backoff = Math.min(this.backoff * 2, 10_000)
    }
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
        this.lastSeq = env.seq
        this.h.onEvent(env)
    }
  }

  private reconnect(delay: number) {
    this.es?.close()
    this.es = null
    if (this.closed) return
    setTimeout(() => {
      if (!this.closed) this.open()
    }, delay)
  }
}
