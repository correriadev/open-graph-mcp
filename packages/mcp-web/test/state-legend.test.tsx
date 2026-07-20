import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { StateLegend } from "../src/state-legend"

test("state legend exposes named states beyond color", () => {
  const html = renderToStaticMarkup(<StateLegend />)
  for (const label of ["Publicado", "Em revisão", "Rascunho", "Drift / Suspended"]) expect(html).toContain(label)
})
