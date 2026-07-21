/**
 * Turnos (UI-2): modal de abertura (lock.denied como estado de primeira classe),
 * draft panel (deltas re-hidratados do server — risco 1: estado local é só o form
 * não submetido), overlays de cell (lock âmbar na CELL inteira + ghosts
 * tracejados), widget "meus turnos". Dialeto de cell: exibição "P2" aqui; a
 * fronteira og.ts converte pro numérico do server (cells.ts).
 */
import { ViewportPortal } from "@xyflow/react"
import { useEffect, useRef, useState } from "react"
import type { CellRect } from "./flow/to-flow"
import { abortTurn, claimDraft, commitTurn, extendTurn, openTurn, reopenTurn, signalTyping } from "./og"
import { useUi } from "./store"

const LEVELS = ["P1", "P2", "P3", "P4", "P5"]

/** mm:ss até expiresAt, tick de 1s. Impreciso em segundos é aceitável (risco 3). */
function useCountdown(expiresAt: string | null): string {
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1_000)
    return () => clearInterval(t)
  }, [])
  if (!expiresAt) return "—"
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (Number.isNaN(ms)) return "—"
  if (ms <= 0) return "expirado"
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

// ---- modal de abertura ------------------------------------------------------
export function TurnModal({ open, onClose, initialCell }: { open: boolean; onClose: () => void; initialCell?: string | null }) {
  const graph = useUi((s) => s.graph)
  const denied = useUi((s) => s.denied)
  const locks = useUi((s) => s.locks)
  const roster = useUi((s) => s.roster)
  const [intent, setIntent] = useState("")
  const [rows, setRows] = useState<{ d: string; l: string }[]>([{ d: "", l: "P5" }])
  const [err, setErr] = useState("")
  useEffect(() => {
    if (!open || !initialCell) return
    const cut = initialCell.lastIndexOf(":")
    setRows([{ d: initialCell.slice(0, cut), l: initialCell.slice(cut + 1) }])
  }, [open, initialCell])
  const deniedCountdown = useCountdown(denied?.expiresAt ?? null)
  if (!open) return null

  const domains = graph ? [...new Set(graph.nodes.map((n) => n.domain).filter((d): d is string => !!d))].sort() : []
  const holderName = denied ? (roster.find((u) => u.userId === denied.holder)?.name ?? denied.holder) : ""
  // habilita re-tentar ao vivo: o lock da cell negada caiu (lock.released já projetado)
  const lockGone = denied ? !locks[denied.cell] : false

  async function doOpen() {
    const cells = rows.map((r) => `${r.d || domains[0] || "(unassigned)"}:${r.l}`)
    if (!intent.trim() || !cells.length) {
      setErr("intent e pelo menos uma cell são obrigatórios")
      return
    }
    setErr("")
    const res = await openTurn(cells, intent.trim())
    if (res.ok) onClose()
    else if (!res.denied) setErr("abertura recusada")
  }

  return (
    <div id="modal">
      <div className="dialog">
        <h3>Abrir turno</h3>
        {denied && (
          <div id="denied">
            <div className="denied-head">🔒 cell [{denied.cell}] em uso</div>
            <div className="denied-body">
              {holderName} segura {denied.csId}
              <br />
              expira em <span className="mono">{deniedCountdown}</span>
              {lockGone && <div className="denied-free">lock caiu — pode tentar de novo</div>}
            </div>
            <div className="row">
              <button id="retry" onClick={doOpen}>Tentar de novo</button>
              <button onClick={() => useUi.setState({ denied: null })}>Trocar de cell</button>
            </div>
          </div>
        )}
        <label>Intent</label>
        <input id="intent" value={intent} placeholder="ex.: validar CPF no login" onChange={(e) => setIntent(e.target.value)} />
        <label>Cells</label>
        <div id="cells">
          {rows.map((r, i) => (
            <div className="cellrow" key={i}>
              <select className="cd" value={r.d} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, d: e.target.value } : x)))}>
                <option value="">{domains[0] ?? "(unassigned)"}</option>
                {domains.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <select className="cl" value={r.l} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, l: e.target.value } : x)))}>
                {LEVELS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
              {rows.length > 1 && (
                <button type="button" className="rmcell" onClick={() => setRows(rows.filter((_, j) => j !== i))}>−</button>
              )}
            </div>
          ))}
        </div>
        <button type="button" id="addcell" onClick={() => setRows([...rows, { d: "", l: "P5" }])}>+ cell</button>
        <div id="turnerr" className="err">{err}</div>
        <div className="row">
          <button id="doopen" onClick={doOpen}>Abrir</button>
          <button type="button" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}

// ---- draft panel ------------------------------------------------------------
export function DraftPanel() {
  const cs = useUi((s) => s.activeCs)
  const deltas = useUi((s) => s.draftDeltas)
  const refPicking = useUi((s) => s.refPicking)
  const refDraft = useUi((s) => s.refDraft)
  const setRefPicking = useUi((s) => s.setRefPicking)
  const clearRefDraft = useUi((s) => s.clearRefDraft)
  const countdown = useCountdown(cs?.expiresAt ?? null)
  const [form, setForm] = useState({ id: "", subject: "", domain: "", level: "P5", refs: "", anchor: "", file: "" })
  const [rawJson, setRawJson] = useState("")
  const [reasons, setReasons] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const refsInput = useRef(form.refs)
  refsInput.current = form.refs
  const updateForm = (patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }))
    signalTyping()
  }

  // ref-por-clique: ids escolhidos no canvas entram no campo refs (texto do form preservado)
  useEffect(() => {
    if (!refDraft.length) return
    const cur = refsInput.current.split(",").map((s) => s.trim()).filter(Boolean)
    const merged = [...new Set([...cur, ...refDraft])]
    setForm((f) => ({ ...f, refs: merged.join(", ") }))
  }, [refDraft])

  // esc cancela o modo ref-por-clique (risco 2: modo explícito)
  useEffect(() => {
    if (!refPicking) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearRefDraft()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [refPicking, clearRefDraft])

  if (!cs) return null

  async function submitClaim() {
    setReasons([])
    setWarnings([])
    let res: { ok: boolean; reasons: string[]; warnings: string[] }
    if (rawJson.trim()) {
      res = await claimDraft({}, rawJson.trim())
    } else {
      res = await claimDraft({
        id: form.id.trim(),
        subject: form.subject.trim(),
        domain: form.domain.trim(),
        level: form.level,
        refs: form.refs.split(",").map((s) => s.trim()).filter(Boolean),
        ...(form.anchor.trim() ? { anchor: form.anchor.trim() } : {}),
        ...(form.file.trim() ? { file: form.file.trim() } : {}),
      })
    }
    setReasons(res.reasons)
    setWarnings(res.warnings)
    if (res.ok) {
      // form limpo SÓ no aceite — recusa preserva o texto digitado (DoD)
      setForm({ id: "", subject: "", domain: "", level: form.level, refs: "", anchor: "", file: "" })
      setRawJson("")
      clearRefDraft()
    }
  }

  async function run(fn: () => Promise<{ ok: boolean; reasons: string[] }>) {
    setReasons([])
    const res = await fn()
    if (!res.ok) setReasons(res.reasons)
  }

  return (
    <section id="draft">
      <h3>drafting {cs.csId}</h3>
      <div className="intent">{cs.intent}</div>
      <div className="cells mono">{cs.cells.join(" · ")}</div>
      <div className="ttl">
        TTL <span id="ttl" className="mono">{countdown}</span>
      </div>
      <div className="acts">
        <button id="commit" onClick={() => run(commitTurn)}>Commit</button>
        <button id="abort" onClick={() => run(abortTurn)}>Abort</button>
        <button id="extend" onClick={() => run(extendTurn)}>Extend TTL</button>
      </div>
      {(reasons.length > 0 || warnings.length > 0) && (
        <ul id="dreasons">
          {reasons.map((r, i) => (
            <li key={`r${i}`} className="reason">{r}</li>
          ))}
          {warnings.map((w, i) => (
            <li key={`w${i}`} className="warning">{w}</li>
          ))}
        </ul>
      )}
      <h4>deltas ({deltas.length})</h4>
      <ul id="dlist">
        {deltas.map((d, i) => (
          <li key={i}>
            {d.kind} · {d.summary}
            {d.at ? ` · ${new Date(d.at).toLocaleTimeString()}` : ""}
          </li>
        ))}
      </ul>
      <h4>novo claim</h4>
      <input id="f_id" placeholder="id (obrigatório no gate)" value={form.id} onChange={(e) => updateForm({ id: e.target.value })} />
      <input id="f_subject" placeholder="subject" value={form.subject} onChange={(e) => updateForm({ subject: e.target.value })} />
      <input id="f_domain" placeholder="domain" value={form.domain} onChange={(e) => updateForm({ domain: e.target.value })} />
      <input id="f_level" placeholder="level (P1..P5)" value={form.level} onChange={(e) => updateForm({ level: e.target.value })} />
      <div className="refsrow">
        <input id="f_refs" placeholder="refs (vírgula)" value={form.refs} onChange={(e) => updateForm({ refs: e.target.value })} />
        <button
          type="button"
          id="refpick"
          className={refPicking ? "on" : ""}
          title="clicar nós/ghosts no canvas adiciona o id aos refs; esc cancela"
          onClick={() => setRefPicking(!refPicking)}
        >
          {refPicking ? "escolhendo… (esc)" : "ref por clique"}
        </button>
      </div>
      <input id="f_anchor" placeholder="anchor (trecho verbatim)" value={form.anchor} onChange={(e) => updateForm({ anchor: e.target.value })} />
      <input id="f_file" placeholder="file (pro anchor check)" value={form.file} onChange={(e) => updateForm({ file: e.target.value })} />
      <details>
        <summary>raw JSON payload</summary>
        <textarea id="f_json" rows={4} placeholder='{"id":..., "subject":...}' value={rawJson} onChange={(e) => { setRawJson(e.target.value); signalTyping() }} />
      </details>
      <button id="addclaim" onClick={submitClaim}>Add delta</button>
    </section>
  )
}

// ---- overlays de cell (lock âmbar + ghosts) — filho de <ReactFlow> ----------
function LockBadge({ cell, holder, csId, expiresAt }: { cell: string; holder: string; csId: string; expiresAt: string }) {
  const roster = useUi((s) => s.roster)
  const countdown = useCountdown(expiresAt)
  const name = roster.find((u) => u.userId === holder)?.name ?? holder
  return (
    <div className="og-lock-badge" data-cell={cell} title={csId}>
      🔒 {name} · <span className="mono">{countdown}</span>
    </div>
  )
}

export function CellOverlays({ cells }: { cells: Record<string, CellRect> }) {
  const locks = useUi((s) => s.locks)
  const ghostCells = useUi((s) => s.ghostCells)
  const ghostDeltas = useUi((s) => s.ghostDeltasByCell)
  const refPicking = useUi((s) => s.refPicking)
  const pickRef = useUi((s) => s.pickRef)
  const keys = new Set([...Object.keys(locks), ...Object.keys(ghostCells)])
  return (
    <ViewportPortal>
      {[...keys].flatMap((cell) => {
        const rect = cells[cell]
        if (!rect) return [] // cell sem nós no grafo (ex.: nível vazio) — sem rect, sem overlay
        const lock = locks[cell]
        const ghost = ghostCells[cell]
        const PAD = 10
        return [
          <div
            key={cell}
            className={`og-cell-overlay${lock ? " locked" : ""}${ghost ? " ghosted" : ""}`}
            data-cell={cell}
            style={{
              transform: `translate(${rect.x - PAD}px, ${rect.y - PAD}px)`,
              width: rect.w + PAD * 2,
              height: rect.h + PAD * 2,
              ...(ghost && !lock ? { borderColor: ghost } : {}),
            }}
          >
            {lock && <LockBadge cell={cell} holder={lock.holder} csId={lock.csId} expiresAt={lock.expiresAt} />}
            {(ghostDeltas[cell] ?? []).length > 0 && (
              <div className="og-ghosts">
                {(ghostDeltas[cell] ?? []).map((d, i) => (
                  <div
                    key={i}
                    className={`og-ghost-card${refPicking && d.id ? " pickable" : ""}`}
                    data-claim={d.id ?? ""}
                    onClick={() => refPicking && d.id && pickRef(d.id)}
                  >
                    {d.summary}
                  </div>
                ))}
              </div>
            )}
          </div>,
        ]
      })}
    </ViewportPortal>
  )
}

// ---- widget "meus turnos" ---------------------------------------------------
export function MyTurns() {
  const myTurns = useUi((s) => s.myTurns)
  const active = useUi((s) => s.activeCs)
  if (!myTurns.length) return null
  return (
    <div id="myturns">
      <h4>meus turnos</h4>
      <ul>
        {myTurns.map((t) => (
          <li key={t.csId} className={active?.csId === t.csId ? "active" : ""} onClick={() => reopenTurn(t)}>
            <span className="mono">{t.csId}</span> · {t.intent} · {t.cells.join(", ")}
          </li>
        ))}
      </ul>
    </div>
  )
}
