/**
 * claims-browser.tsx — UI-3 (F002): painel por cell. Lista ClaimRow[] ordered by seq desc;
 * OpenClaim render subject + anchor verbatim + verdict metadados + RefChip por ref id +
 * seção 'referenciado por' (ReverseIndex) + Provenance footer (csId?/seq). WD2: texto puro,
 * sem react-markdown — anchor em <pre>, refs como chips, sem rich formatting.
 *
 * API DOM p/ e2e (fixture): #claims-panel, .claim-row, .open-claim, .ref-chip,
 * .referenced-by, .provenance, .refinement-suggestion (reuso do QueryBar).
 */
import { useEffect, useMemo } from "react"
import { useUi, type ClaimRecord } from "./store"
import { readClaims, readSnapshotClaims, invalidateReverseIndex, buildReverseIndexStatic, navigateToClaim } from "./og"

function Provenance({ c }: { c: ClaimRecord }) {
  return <div className="provenance">
    <span className="seq">seq {c.seq ?? "—"}</span>
    {c.supersedes && <span className="supersedes">supersedes {c.supersedes}</span>}
  </div>
}

function RefChip({ refId, onNavigate }: { refId: string; onNavigate: (refId: string) => void }) {
  return <button className="ref-chip" onClick={() => onNavigate(refId)} title={`navegar p/ ref ${refId}`}>{refId}</button>
}

function OpenClaim({ claim, referencedBy, onRefClick, onOpenTurn, canOpenTurn }: {
  claim: ClaimRecord
  referencedBy: string[]
  onRefClick: (refId: string) => void
  onOpenTurn?: () => void
  canOpenTurn?: boolean
}) {
  return (
    <div className="open-claim" data-id={claim.id}>
      <h4>{claim.subject}</h4>
      {claim.anchor && <pre className="anchor">{claim.anchor}</pre>}
      {claim.verdict && (
        <div className="verdict">
          {typeof claim.verdict.confidence === "number" && <span>confiança {claim.verdict.confidence.toFixed(2)}</span>}
          {claim.verdict.overclaim && <span className="overclaim">OVERCLAIM</span>}
        </div>
      )}
      <div className="refs">
        <span className="label">refs:</span>
        {(claim.refs ?? []).length === 0 ? <span className="none">—</span> :
          claim.refs.map((r) => <RefChip key={r} refId={r} onNavigate={onRefClick} />)}
      </div>
      <div className="referenced-by">
        <span className="label">referenciado por:</span>
        {referencedBy.length === 0 ? <span className="none">nenhum referenciado</span> :
          referencedBy.map((id) => <RefChip key={id} refId={id} onNavigate={onRefClick} />)}
      </div>
      <Provenance c={claim} />
      {canOpenTurn && (
        <div className="open-claim-footer">
          <button id="open-turn-from-claim" onClick={() => onOpenTurn?.()}>abrir turno nesta cell</button>
        </div>
      )}
    </div>
  )
}

export function ClaimsBrowser(): JSX.Element {
  const cell = useUi((s) => s.selectedCell)
  const claims = useUi((s) => (cell ? s.claimsByCell[cell] : undefined))
  const loading = useUi((s) => s.claimsLoading)
  const error = useUi((s) => s.claimsError)
  const selectedClaimId = useUi((s) => s.selectedClaimId)
  const openClaim = useUi((s) => s.openClaim)
  const setSelectedCell = useUi((s) => s.setSelectedCell)
  const reverseIndex = useUi((s) => s.reverseIndex)
  const setReverseIndex = useUi((s) => s.setReverseIndex)
  const graph = useUi((s) => s.graph)
  const activeCsNull = useUi((s) => s.activeCs === null)
  const requestOpenTurn = useUi((s) => s.requestOpenTurn)

  useEffect(() => {
    if (cell) {
      // invalidate maps cached for this cell when snapshot changes (graphId pivots) — ponytail: simple discard.
      readClaims(cell)
    }
  }, [cell, graph])

  const bySeqDesc = useMemo(() => [...(claims ?? [])].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0)), [claims])

  const active = useMemo(() => bySeqDesc.find((c) => c.id === selectedClaimId) ?? null, [bySeqDesc, selectedClaimId])

  // Lazy reverse-index build (RETRY #1): snapshot-wide (Object.values(claimsByCell).flat()) so a ref
  // from cell B pointing at a claim in cell A is captured — not just refs within the current cell.
  // Built on first OpenClaim AND whenever claimsByCell grows (a new cell loaded after the first build
  // would otherwise miss edges from new claims). Invalidated by graph.rebuilt (og.ts sets
  // reverseIndex=null + claimsByCell={}); next OpenClaim rebuilds fresh from current cells.
  const claimsByCell = useUi((s) => s.claimsByCell)
  useEffect(() => {
    if (selectedClaimId) {
      readSnapshotClaims().then(() => {
        const snapshotClaims = useUi.getState().claimsByCell
        if (Object.values(snapshotClaims).some((cellClaims) => cellClaims.length > 0)) {
          setReverseIndex(buildReverseIndexStatic(snapshotClaims))
        }
      })
    }
  }, [selectedClaimId, graph, setReverseIndex])

  if (!cell) return null as unknown as JSX.Element
  if (loading && !claims) return <div id="claims-panel"><div className="skeleton">carregando claims…</div></div>
  if (error) return (
    <div id="claims-panel">
      <div className="error">{error}</div>
      <button onClick={() => { invalidateReverseIndex(); cell && readClaims(cell) }}>tentar de novo</button>
    </div>
  )
  return (
    <div id="claims-panel" data-cell={cell}>
      <h3>Claims · {cell}</h3>
      {bySeqDesc.length === 0 ? <p className="empty">nenhum claim nesta cell</p> :
        <ul className="claim-rows">
          {bySeqDesc.map((c) => (
            <li key={c.id} className="claim-row" data-id={c.id} onClick={() => openClaim(c.id)}>
              <span className="id mono">{c.id}</span>
              <span className="subject">{c.subject}</span>
              <span className="seq">#{c.seq ?? "—"}</span>
              {c.verdict?.overclaim && <span className="badge overclaim">overclaim</span>}
            </li>
          ))}
        </ul>}
      {active && (
        <OpenClaim
          claim={active}
          referencedBy={reverseIndex?.get(active.id) ?? []}
          onRefClick={navigateToClaim}
          canOpenTurn={activeCsNull}
          onOpenTurn={() => cell && requestOpenTurn(cell)}
        />
      )}
      <button id="close-claims" onClick={() => setSelectedCell(null)} aria-label="fechar">×</button>
    </div>
  )
}
