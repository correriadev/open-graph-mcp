const STATES = [
  ["published", "Publicado"],
  ["review", "Em revisão"],
  ["draft", "Rascunho"],
  ["drift", "Drift / Suspended"],
] as const

export function StateLegend() {
  return <details id="state-legend"><summary>Legenda de estados</summary><ul>{STATES.map(([state, label]) => <li key={state} data-state={state}><span className="legend-swatch" />{label}</li>)}</ul></details>
}
