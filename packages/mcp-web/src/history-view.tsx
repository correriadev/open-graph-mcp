/**
 * history-view.tsx — UI-3 (F002): rota /history. resourceRead('graph://history?since=0&limit=1000')
 * → EventEnvelope[]; filtros byUser/target/kind client-side; clique expande payload (JSON
 * colapsável, read-only). Paridade com a rota velha do norte visual. WD3: resourceRead, sem api.ts.
 *
 * API DOM p/ e2e: .history-row, .history-payload, [#history-byuser,#history-target,#history-kind].
 */
import { useEffect, useMemo, useState } from "react"
import { useUi, type HistoryEvent, type HistoryFilters } from "./store"
import { loadMoreHistory, readHistory } from "./og"

function matchesFilters(e: HistoryEvent, f: HistoryFilters): boolean {
  // RETRY #1 (REWORK-LOG openPoint E): union across payload slot kinds. lock.acquired/released
  // carry holder; authority.demoted carries by; opened/committed carry byUser/openedBy.
  if (f.byUser) {
    const users = [e.payload?.byUser, e.payload?.openedBy, e.payload?.holder, e.payload?.by]
    if (!users.includes(f.byUser)) return false
  }
  if (f.target) {
    const has = e.target === f.target || (e.payload?.cells ?? []).includes(f.target) || (e.payload?.cell === f.target)
    if (!has) return false
  }
  if (f.kind && e.kind !== f.kind) return false
  return true
}

function writeFilterUrl(f: HistoryFilters): void {
  // RETRY #1 (REWORK-LOG openPoint 4 / edgeCase F): replaceState shareable links on filter change.
  if (typeof window === "undefined" || !window.history) return
  const p = new URLSearchParams()
  if (f.byUser) p.set("user", f.byUser)
  if (f.target) p.set("target", f.target)
  if (f.kind) p.set("kind", f.kind)
  const qs = p.toString()
  window.history.replaceState(null, "", `#/history${qs ? `?${qs}` : ""}`)
}

export function HistoryView(): JSX.Element {
  const events = useUi((s) => s.historyEvents)
  const loading = useUi((s) => s.historyLoading)
  const error = useUi((s) => s.historyError)
  const hasMore = useUi((s) => s.historyHasMore)
  const loadingMore = useUi((s) => s.historyLoadingMore)
  const filters = useUi((s) => s.historyFilters)
  const setFilters = useUi((s) => s.setHistoryFilters)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  useEffect(() => { readHistory(0, 100) }, [])

  // Initial filter population from URL params (?user=&target=&kind=)
  useEffect(() => {
    const query = window.location.hash.split("?")[1] ?? ""
    const u = new URLSearchParams(query)
    if ([...u.keys()].length === 0) return
    const f: HistoryFilters = {
      byUser: u.get("user") || undefined,
      target: u.get("target") || undefined,
      kind: u.get("kind") || undefined,
    }
    setFilters(f)
  }, [setFilters])

  // On every filter change, replaceState (?user=&target=&kind=) so the link is shareable and
  // round-trapping away+back preserves the choices (004 §3.3 edge case).
  useEffect(() => { writeFilterUrl(filters) }, [filters])

  const apply = (patch: Partial<HistoryFilters>): void => setFilters({ ...filters, ...patch })

  const users = useMemo(() => {
    const s = new Map<string, string>()
    for (const e of events) {
      for (const u of [e.payload?.byUser, e.payload?.openedBy, e.payload?.holder, e.payload?.by]) {
        if (typeof u === "string" && u) s.set(u, u)
      }
    }
    return [...s.keys()].sort()
  }, [events])

  const kinds = useMemo(() => [...new Set(events.map((e) => e.kind))].sort(), [events])
  const filtered = useMemo(() => events.filter((e) => matchesFilters(e, filters)), [events, filters])

  if (loading && events.length === 0) return <div id="history-view"><div className="skeleton">carregando…</div></div>
  if (error && events.length === 0) return <div id="history-view"><div className="error">{error}</div><button onClick={() => readHistory(0, 100)}>tentar de novo</button></div>

  return (
    <div id="history-view">
      <h3>Histórico</h3>
      <div className="filters">
        <label>user
          <select id="history-byuser" value={filters.byUser ?? ""} onChange={(e) => apply({ byUser: e.target.value || undefined })}>
            <option value="">—</option>
            {users.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <label>target
          <input id="history-target" value={filters.target ?? ""} onChange={(e) => apply({ target: e.target.value || undefined })} />
        </label>
        <label>kind
          <select id="history-kind" value={filters.kind ?? ""} onChange={(e) => apply({ kind: e.target.value || undefined })}>
            <option value="">—</option>
            {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      </div>
      {filtered.length === 0 ? <p className="empty">nenhum evento</p> :
        <ul className="history-rows">
          {filtered.map((e) => {
            const exp = !!expanded[e.seq]
            const tsLabel = (() => {
              // dead ternary guard (REWORK-LOG K): malformed ts → 'Invalid Date' shown as-is is misleading.
              const t = typeof e.ts === "string" ? new Date(e.ts) : (typeof e.ts === "number" ? new Date(e.ts as number) : null)
              return t && !isNaN(t.getTime()) ? t.toLocaleTimeString() : String(e.ts ?? "—")
            })()
            return (
              <li key={e.seq} className="history-row" data-seq={e.seq} data-kind={e.kind} data-target={e.target ?? ""} onClick={() => setExpanded((s) => ({ ...s, [e.seq]: !s[e.seq] }))}>
                <div className="row-head"><span className="seq mono">#{e.seq}</span><span className="ts">{tsLabel}</span><span className="kind">{e.kind}</span>{e.target && <span className="target mono">{e.target}</span>}</div>
                {exp && <pre className="history-payload">{JSON.stringify(e.payload ?? {}, null, 2)}</pre>}
              </li>
            )
          })}
        </ul>}
      {error && <div className="error">{error} <button onClick={() => loadMoreHistory()}>tentar de novo</button></div>}
      {hasMore && <button id="history-load-more" disabled={loadingMore} onClick={() => loadMoreHistory()}>{loadingMore ? "carregando…" : "carregar mais"}</button>}
    </div>
  )
}
