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
import { claimsPaginationControls, useUi, type ClaimRecord } from "./store"
import { readClaims, loadMoreClaims, loadMoreCellClaims, navigateToClaim, buildReverseIndexStatic } from "./og"

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
  const cellError = useUi((s) => s.claimsCellError)
  const snapshotError = useUi((s) => s.claimsSnapshotError)
  const selectedClaimId = useUi((s) => s.selectedClaimId)
  const openClaim = useUi((s) => s.openClaim)
  const setSelectedCell = useUi((s) => s.setSelectedCell)
  const reverseIndex = useUi((s) => s.reverseIndex)
  const claimsByCell = useUi((s) => s.claimsByCell)
  const claimsHasMore = useUi((s) => s.claimsHasMore)
  const claimsLoadingMore = useUi((s) => s.claimsLoadingMore)
  const cellPage = useUi((s) => cell ? s.claimCellPages[cell] : undefined)
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
  const controls = claimsPaginationControls({ hasOpenClaim: !!active, cellHasMore: !!cellPage?.hasMore, snapshotHasMore: claimsHasMore, cellError, snapshotError })

  // Derive from pages already owned by the UI. Missing targets are resolved individually by RefChip;
  // opening a claim must never trigger an implicit full-snapshot fallback.
  const visibleReverseIndex = useMemo(
    () => reverseIndex ?? buildReverseIndexStatic(Object.values(claimsByCell).flat()),
    [reverseIndex, claimsByCell],
  )

  if (!cell) return null as unknown as JSX.Element
  if (loading && !claims) return <div id="claims-panel"><div className="skeleton">carregando claims…</div></div>
  if (cellError && !claims?.length) return (
    <div id="claims-panel">
      <div className="error">{cellError}</div>
      <button onClick={() => cell && readClaims(cell)}>tentar de novo</button>
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
          referencedBy={visibleReverseIndex.get(active.id) ?? []}
          onRefClick={navigateToClaim}
          canOpenTurn={activeCsNull}
          onOpenTurn={() => cell && requestOpenTurn(cell)}
        />
      )}
      {controls.showSnapshotContinuation && (
        <button id="load-more-claim-refs" disabled={claimsLoadingMore} onClick={() => loadMoreClaims()}>
          {claimsLoadingMore ? "carregando referências…" : "carregar mais referências"}
        </button>
      )}
      {controls.showCellContinuation && (
        <button id="load-more-cell-claims" disabled={cellPage?.loading} onClick={() => cell && loadMoreCellClaims(cell)}>
          {cellPage?.loading ? "carregando claims…" : "carregar mais claims"}
        </button>
      )}
      {controls.retryCell && claims?.length ? <div className="error cell-error">{cellError} <button onClick={() => cell && loadMoreCellClaims(cell)}>tentar de novo claims</button></div> : null}
      {controls.retrySnapshot ? <div className="error snapshot-error">{snapshotError} <button onClick={() => loadMoreClaims()}>tentar de novo referências</button></div> : null}
      <button id="close-claims" onClick={() => setSelectedCell(null)} aria-label="fechar">×</button>
    </div>
  )
}
