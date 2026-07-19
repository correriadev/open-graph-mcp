# Implementar UI-3, UI-4, UI-5 do roadmap-web-ui

React 18 + @xyflow/react 12 + zustand. CSS vanilla já existe em app.css. Zero novos pacotes exceto react-markdown + rehype-sanitize (se não instalados).

NÃO escreva explicação, plano, ou summary. Só código.

## Status atual

UI-0 (shell React + RF + snapshot read-only) ✅
UI-1 (SSE, presença, toasts, feed) ✅
UI-2 (turnos: modal, draft panel, overlays, my turns) ✅ em src/turn.tsx
UI-3 (leitura/query) ❌ — implementar
UI-4 (nós ricos/zoom) ❌ — implementar
UI-5 (paridade/gate) ❌ — implementar

## Contexto

- store.ts já tem todos os campos (graph, selectedId, roster, locks, events, etc). Leia antes de adicionar algo.
- og.ts já tem connectOg, loadSnapshot, openTurn, claimDraft, commitTurn, abortTurn, extendTurn, listMine, pushToast, setFocus, pollWho, refreshFocus, applyEvent, serverBase, og()
- cells.ts: toServerCell/toUiCell/levelNum
- ghosts.ts: GhostStore, GhostDelta, Lock
- toasts.ts: ToastQueue
- to-flow.ts: toFlow, CellRect, CARD_W, CARD_H
- base-card.tsx: BaseCard memo com Handle, drift, refPicking .pickable, LOD CSS já
- app.css: TODOS os estilos. Og-card, #panel, #modal, .dialog, og-cell-overlay, og-lock-badge, og-ghost-card, #myturns, #openturn, #draft, #dreasons, #dlist, etc.
- app.tsx: App, Topbar, Shell, Roster, TypingIndicator, AvatarsLayer, Toasts, Feed, NodePanel, SettingsModal, CameraDriver, turn.tsx imports
- turn.tsx: TurnModal, DraftPanel, CellOverlays, MyTurns — completos

## UI-3 — Leitura e busca

Modifique app.tsx (e crie componentes em turn.tsx ou novo arquivo ui3.tsx):

### Claims browser (expandir NodePanel em app.tsx)
- Quando nó selecionado, mostrar claims como lista no #panel
- Cada claim: autor, timestamp, status, conteúdo
- Refs como chips clicáveis → select + centra câmera no nó alvo
- "Referenciado por" (reverse index: varre edges)
- Rodapé: csId, seq

### Query bar (na topbar)
- Input ⌘K que chama `og().call("graph.query", { q })`
- Dropdown resultados agrupados por cell
- Gaps visíveis: "sem resultado: '<termo>'" (não lista vazia)
- Selecionar → centra nó no canvas (requestCenter)

### History view
- Botão de toggle na topbar mostra #events expandido com filtros
- Filtros: byUser, target, kind
- Payload completo no clique

### Sidebar navegação (à esquerda, substitui ou ao lado do roster)
- Árvore domínios → níveis com contagem de claims
- Badge de lock em cells locked
- Filtros rápidos: "com turno aberto", "bloqueados", "minhas contribuições"
- Clique centra a cell

## UI-4 — Nós ricos + zoom semântico

### Nó markdown (base-card.tsx)
- Se node.id tem corpo markdown, renderiza com react-markdown + rehype-sanitize
- Card com max-height + overflow interno
- Botão "expandir" abre leitura completa no NodePanel (#panel)
- Tabelas largas com overflow-x

### Zoom semântico (já parcial em app.css data-lod)
- Recalibrar thresholds do lodForZoom pra cards
- data-lod="node" → card completo com markdown
- data-lod="floor" → chip: título + status + avatares
- data-lod="tower" → dot colorido por domínio
- Busca/seleção força card visível (pin temporário overriding LOD)

### Cell containers ricos
- Cada cell wrapper vira container visual com header: nome, contagem, lock badge, avatares

### Estados visuais (já no CSS)
- Publicado verde (og-card-status.ok)
- Turno aberto âmbar (og-card.over)
- Ghost violeta tracejado (og-ghost-card)
- Drift (og-drift)
- Legenda acessível no canvas

### Minimapa
- Ativar `<MiniMap>` do RF

## UI-5 — Paridade + gate

- Preencher checklist em docs/roadmap-web-ui/05-scope-ui-5-paridade-gate.md
- Garantir que toda feature da UI velha tem equivalente
- Suíte e2e completa: adicionar specs que faltam
- Preparar docs/roadmap-web-ui/relatorios/ para ata da mini-sessão

## Regras
- Leia store.ts, og.ts, app.tsx, app.css, base-card.tsx, turn.tsx ANTES de escrever qualquer código. Eles já têm quase tudo que você precisa.
- Código TypeScript estrito
- Estilos em app.css (já tem quase tudo). Novos só se realmente necessário.
- react-markdown + rehype-sanitize: adicionar em package.json se não existir
- NÃO remova ou quebre código existente — adicione
- CI: tsc, bun test, bun run build verdes
