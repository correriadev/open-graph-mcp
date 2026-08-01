/**
 * Turnos (F1 — lock implícito): sem modal de abertura — o gatilho é `node.edit` (og.ts), disparado ao
 * entrar em edição num nó (app.tsx NodePanel). Draft panel (deltas re-hidratados do server — risco 1:
 * estado local é só o form não submetido), overlays de cell (ghosts tracejados), widget "meus turnos".
 * `intent` migrou pro commit (decisão 2 do plano F1) — pedido aqui, não mais na abertura. Dialeto de
 * cell: exibição "P2" aqui; a fronteira og.ts converte pro numérico do server (cells.ts).
 */
import { ViewportPortal } from "@xyflow/react"
import { useEffect, useRef, useState } from "react"
import type { CellRect } from "./flow/to-flow"
import { abortTurn, claimDraft, commitTurn, extendTurn, reopenTurn, signalTyping } from "./og"
import { useUi } from "./store"

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
  // F1: intent migrou pro commit — campo simples aqui, não mais pré-declarado num modal.
  const [intent, setIntent] = useState("")
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
      <div className="cells mono">{cs.cells.join(" · ")}</div>
      <div className="ttl">
        TTL <span id="ttl" className="mono">{countdown}</span>
      </div>
      <label htmlFor="intent">Intent</label>
      <input id="intent" value={intent} placeholder="ex.: validar CPF no login" onChange={(e) => setIntent(e.target.value)} />
      <div className="acts">
        <button id="commit" onClick={() => run(() => commitTurn(intent.trim()))}>Commit</button>
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

// ---- overlays de cell (badge "em edição" + ghosts) — filho de <ReactFlow> ---
/** F1: estado ("em edição por X"), não cadeado — sem emoji de lock, texto direto. */
function LockBadge({ cell, holder, csId, expiresAt }: { cell: string; holder: string; csId: string; expiresAt: string }) {
  const roster = useUi((s) => s.roster)
  const countdown = useCountdown(expiresAt)
  const name = roster.find((u) => u.userId === holder)?.name ?? holder
  return (
    <div className="og-lock-badge" data-cell={cell} title={csId}>
      em edição por {name} · <span className="mono">{countdown}</span>
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
