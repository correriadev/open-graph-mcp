/**
 * query-bar.tsx — UI-3 (F002): ⌘K barra no topbar. Debounce 200ms sobre og.call('graph.query',
 * {terms:[term]}) → {candidates, gaps}. Gaps são resultado de 1ª classe (não = lista vazia muda);
 * sugestões de refinamento derivadas do léxico de domínios do snapshot. WD3: og.call, sem api.ts.
 *
 * API DOM p/ e2e: #query-input, #query-backdrop, .query-results, .query-result, .query-gap,
 * .refinement-suggestion. Dev-only: window.__og_query_call_count (e2e counter, gated behind
 * import.meta.env.DEV — NOT shipped to prod namespace, RETRY #1 REWORK-LOG openPoint 6).
 */
import { useEffect, useRef, useState } from "react"
import { useUi } from "./store"
import { queryClaims } from "./og"

let debounce: ReturnType<typeof setTimeout> | null = null
let callCounter = 0
// ponytail: dev-only introspection hook — gating here keeps the prod global namespace clean.
if (import.meta.env && (import.meta.env as any).DEV) {
  ;(window as any).__og_query_call_count = () => callCounter
}

export function QueryBar(): JSX.Element | null {
  const open = useUi((s) => s.queryOpen)
  const results = useUi((s) => s.queryResults)
  const loading = useUi((s) => s.queryLoading)
  const error = useUi((s) => s.queryError)
  const setOpen = useUi((s) => s.openQuery)
  const setResults = useUi((s) => s.setQueryResults)
  const setLoading = useUi((s) => s.setQueryLoading)
  const setError = useUi((s) => s.setQueryError)
  const setSelectedCell = useUi((s) => s.setSelectedCell)
  const setSelectedId = useUi((s) => s.select)
  const requestCenter = useUi((s) => s.requestCenter)
  const graph = useUi((s) => s.graph)
  const inputRef = useRef<HTMLInputElement>(null)
  const [term, setTerm] = useState("")

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(true)
      } else if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setOpen])

  useEffect(() => {
    if (open) inputRef.current?.focus()
    else { setTerm(""); setResults(null); setError(null) }
  }, [open, setResults, setError])

  const onChange = (v: string) => {
    setTerm(v)
    if (debounce) clearTimeout(debounce)
    if (!v.trim()) { setResults(null); return }
    debounce = setTimeout(async () => {
      setLoading(true); setError(null)
      try {
        callCounter++
        const r = await queryClaims(v.trim())
        setResults(r)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    }, 200)
  }

  if (!open) return null

  type Cand = { id: string; domain: string | null; layer?: string; file: string; subject: string; score: number }
  const grouped = new Map<string, Cand[]>()
  for (const c of results?.candidates ?? []) {
    const d = c.domain ?? "(unassigned)"
    if (!grouped.has(d)) grouped.set(d, [])
    grouped.get(d)!.push(c)
  }

  const matchSelect = (c: Cand) => {
    const node = graph?.nodes.find((n) => n.id === c.id)
    const cell = node ? `${node.domain ?? c.domain ?? "(unassigned)"}:${node.level}` : (c.domain ? `${c.domain}:${c.layer ?? "P5"}` : null)
    setSelectedId(c.id)
    if (cell) { setSelectedCell(cell); requestCenter(cell) }
    else if (node) requestCenter(node.id)
    setOpen(false)
  }

  return (
    <div id="query-backdrop" onClick={() => setOpen(false)}>
      <div className="query-modal" onClick={(e) => e.stopPropagation()}>
        <input
          id="query-input"
          ref={inputRef}
          placeholder="buscar nós / domínios…"
          value={term}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
        {loading && <div className="spinner" />}
        {error && <div className="error">{error}</div>}
        <div className="query-results">
          {results && results.gaps.map((g) => (
            <div key={g.term} className="query-gap" data-term={g.term}>
              <span className="gap-text">sem resultado: '{g.term}'</span>
              {(g.suggestions ?? []).length > 0 && (
                <div className="refinements">
                  {g.suggestions.map((s) => <span key={s} className="refinement-suggestion" data-domain={s}>{s}</span>)}
                </div>
              )}
            </div>
          ))}
          {[...grouped.entries()].map(([domain, rows]) => (
            <div key={domain} className="query-group" data-domain={domain}>
              <div className="group-header">{domain}</div>
              {rows.map((c) => (
                <button key={c.id} className="query-result" data-id={c.id} onClick={() => matchSelect(c)}>
                  <span className="id mono">{c.id}</span>
                  <span className="resp">{c.subject}</span>
                  <span className="score">{c.score.toFixed(2)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}