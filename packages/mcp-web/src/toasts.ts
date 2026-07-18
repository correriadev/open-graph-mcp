// ---------------------------------------------------------------------------
// Pure toast queue (unit-tested). Coalesces bursts of events about the same
// origin (cs_id) within a short window into a single "N eventos em cs_abc"
// toast, and caps how many pile up (spec §7.4 / §12.4).
// ---------------------------------------------------------------------------

export type Toast = {
  id: string
  key: string
  text: string
  count: number
  ts: number
  target?: string
}

const MAX_KEPT = 10

export class ToastQueue {
  private items: Toast[] = [] // most recent first
  private seq = 0

  /**
   * Push a toast under `key` (e.g. csId). If the most recent toast has the same key and arrived less
   * than `windowMs` ago, coalesce into it (bump count, relabel "N eventos em {key}") instead of adding
   * a new one. Oldest toasts beyond MAX_KEPT are discarded.
   */
  push(key: string, text: string, opts: { now?: number; target?: string; windowMs?: number } = {}): Toast {
    const now = opts.now ?? Date.now()
    const windowMs = opts.windowMs ?? 500
    const top = this.items[0]
    if (top && top.key === key && now - top.ts < windowMs) {
      top.count += 1
      top.text = `${top.count} eventos em ${key}`
      top.ts = now
      if (opts.target) top.target = opts.target
      return top
    }
    const toast: Toast = { id: `t${++this.seq}`, key, text, count: 1, ts: now, target: opts.target }
    this.items.unshift(toast)
    if (this.items.length > MAX_KEPT) this.items.length = MAX_KEPT
    return toast
  }

  /** First `max` toasts (newest first) to render, plus how many more are hidden past that cap. */
  visible(max = 5): { toasts: Toast[]; overflow: number } {
    return { toasts: this.items.slice(0, max), overflow: Math.max(0, this.items.length - max) }
  }

  remove(id: string): void {
    this.items = this.items.filter((t) => t.id !== id)
  }

  all(): readonly Toast[] {
    return this.items
  }
}
