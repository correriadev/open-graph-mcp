/**
 * Marshalling de dialeto de cell na fronteira UI ↔ server (achado do revisor de
 * arquitetura, UI-2): o server processa cells/levels de changeset NUMÉRICOS
 * ("auth:2") — nodesOfCell (gates.ts) stripa o "P" só do lado do nó, então uma
 * cell "auth:P2" nunca encontra nó e o gate de coverage/verify em células β
 * ficaria vacuamente verde. "P2" existe SÓ como dialeto de exibição (picker,
 * to-flow.cells, overlays); toda chamada changeset.* converte aqui.
 */

/** "auth:P2" → "auth:2" (idempotente pra cells já numéricas). */
export const toServerCell = (uiCell: string): string => uiCell.replace(/:P(\d+)$/, ":$1")

/** "auth:2" → "auth:P2" (idempotente pra cells já em dialeto de exibição). */
export const toUiCell = (serverCell: string): string => serverCell.replace(/:(\d+)$/, ":P$1")

/** "P2" | "2" | 2 → 2. NaN se não-numérico (deixa o gate do server reclamar). */
export const levelNum = (level: string | number): number =>
  typeof level === "number" ? level : Number(String(level).replace(/^P/, ""))
