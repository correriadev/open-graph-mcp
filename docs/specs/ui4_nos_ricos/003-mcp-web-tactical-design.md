# UI-4 — Nós Ricos e Zoom Semântico: Tactical Design — mcp-web

## Section 1 — Main Structure

| Elemento | Camada / Tipo | Responsabilidade | Regra técnica |
|---|---|---|---|
| `RichCard` | UI component | Renderizar markdown, metadados, avatares e estado. | Especializar o `BaseCard` memoizado; não criar árvore distinta por LOD. |
| `SemanticNode` | UI composition | Expor card/chip/dot no mesmo mount. | CSS dirigido por `data-lod`; pin local vence LOD global. |
| `SafeMarkdown` | UI adapter | Renderizar títulos, listas e tabelas. | Usar `react-markdown` + `rehype-sanitize` padrão; sem HTML caseiro. |
| `NodeStatus` | UI component | Resolver published/review/draft/drift/suspended. | Texto/ícone além da cor; precedência determinística. |
| `CellContainer` | UI component | Desenhar limite e header clicável da cell. | `ViewportPortal`; fundo não intercepta nós. |
| `CellHeader` | UI component | Mostrar cell, contagem, lock/TTL e avatares. | Clique solicita turno na cell; dados vivos por seletores estreitos. |
| `StateLegend` | UI component | Explicar estados visuais. | Acessível por teclado e sempre disponível no canvas. |
| `GraphMiniMap` | UI adapter | Fornecer visão geral e navegação. | Reusar `MiniMap` do React Flow e cor por domínio/estado. |
| `toFlow` | Projection service | Calcular cards, cells e espaçamento. | Puro, determinístico, dimensionado ao card rico. |
| `SemanticZoomDriver` | UI adapter | Atualizar regime por viewport. | Não gravar zoom por nó no Zustand. |
| `FrameSampler` | Test support | Medir FPS durante pan representativo. | Somente harness/e2e; não produzir telemetria participante. |

## Section 2 — Value Objects / Types / Interfaces

| Nome | Forma | Invariantes |
|---|---|---|
| `SemanticLod` | `"node" | "floor" | "tower"` | Deve corresponder à saída de `lodForZoom`. |
| `NodeVisualState` | `published | review | draft | drift | suspended` | Uma classe primária e marcadores adicionais quando necessário. |
| `RichCardData` | `node`, `cell`, `markdown`, `visualState`, `pinned` | `node.id` permanece identidade estável. |
| `CellContainerData` | `cell`, `rect`, `nodeCount`, `claimCount`, `lock`, `avatars`, `authority` | Contagens não negativas; avatars deduplicados por usuário. |
| `LayoutMetrics` | `cardWidth`, `cardHeight`, `gap`, `cellPadding`, `bandGap`, `columns` | Valores positivos; resultado sem sobreposição. |
| `DomainColor` | domínio para cor CSS | Mesmo domínio produz mesma cor em card, dot e minimapa. |
| `FpsSample` | frames, duration, fps, slowFrames | Duração e frames positivos; cenário nomeado. |

## Section 3 — Aggregates and Domain Services

| Agregado / Serviço | Raiz | Comportamento | Invariantes |
|---|---|---|---|
| Rich Node | `GraphNode.id` | Resolve markdown, metadados, estado e LOD. | Seleção fixa Card Regime; markdown nunca expande largura da cell. |
| Cell Container | cell key | Agrega geometria, nós, claims e colaboração. | Lock pertence ao container; header é alvo de turno. |
| Semantic Zoom | viewport zoom | Converte zoom em regime visual. | Cruzar threshold não remonta nó nem perde foco. |
| Layout Projection | snapshot graph | Ordena nós e calcula retângulos. | Mesmo snapshot gera coordenadas idênticas; cells não se sobrepõem. |
| Domain Palette | domínio | Produz cor consistente. | Fallback explícito para domínio ausente. |
| Visual State Resolver | node + cell projections | Calcula classe e label acessível. | Suspended/drift não são mascarados por published. |

### Visual State Precedence

1. Marcar `suspended` quando authority da cell for suspended.
2. Marcar `drift` quando existir grade para o nó.
3. Marcar `review` quando a cell estiver locked ou ghosted.
4. Marcar `draft` nos ghost cards, nunca em nó publicado por inferência.
5. Usar `published` quando nenhum estado excepcional estiver ativo.

## Section 4 — Domain Events

| Evento | Produtor | Consumidor | Efeito |
|---|---|---|---|
| `ViewportChanged` | React Flow | SemanticZoomDriver | Atualiza `data-lod`. |
| `NodeSelected` | Canvas/query | RichCard, CameraDriver | Aplica pin e mantém Card Regime. |
| `NodeDeselected` | Pane/close | RichCard | Remove pin. |
| `CellHeaderClicked` | CellHeader | TurnModal integration | Preenche e abre turno. |
| `LockProjectionChanged` | SSE fold | CellContainer | Atualiza review, badge e countdown. |
| `PresenceProjectionChanged` | SSE fold | CellHeader | Atualiza avatar stack da cell. |
| `GhostProjectionChanged` | SSE fold | CellContainer | Atualiza borda e draft ghosts. |
| `DriftProjectionChanged` | SSE fold | NodeStatus | Atualiza marcador drift/suspended. |
| `MiniMapClicked` | MiniMap | React Flow viewport | Centraliza viewport. |

## Section 5 — Persistence / Repository / Data Access Interfaces

| Adapter | Operação | Retorno / Uso |
|---|---|---|
| `graph://snapshot` via `og.ts` | Leitura existente | `Graph` com nós, edges e authority. |
| Zustand `useUi` | Seleção e projeções ao vivo | `selectedId`, `locks`, `roster`, `ghost*`, `drift`. |
| React Flow viewport | `onViewportChange`, `setCenter` | Zoom semântico e navegação. |
| `sessionStorage` | Configurações existentes | Não adicionar persistência de layout ou pin. |

### Dependency Additions

| Package | Purpose | Constraint |
|---|---|---|
| `react-markdown` | Renderização markdown React | Não habilitar HTML cru. |
| `rehype-sanitize` | Sanitização pela política padrão | Não criar sanitizador próprio. |

## Section 6 — Ordered Development Tasks

```json
[
  {
    "id": "01",
    "title": "Define semantic presentation contracts and deterministic visual-state resolution",
    "description": "Add focused types and pure helpers for semantic LOD overrides, domain colors, markdown source selection, and node/cell visual-state precedence.",
    "files": [
      "packages/mcp-web/src/flow/rich-node.ts",
      "packages/mcp-web/test/rich-node.test.ts"
    ],
    "dependsOn": []
  },
  {
    "id": "02",
    "title": "Recalibrate deterministic layout for rich cards and cell headers",
    "description": "Extend the flow projection with explicit layout metrics and header-safe cell rectangles while preserving stable ordering and non-overlap.",
    "files": [
      "packages/mcp-web/src/flow/to-flow.ts",
      "packages/mcp-web/test/to-flow.test.ts"
    ],
    "dependsOn": ["01"]
  },
  {
    "id": "03",
    "title": "Render sanitized markdown and complete rich-node metadata",
    "description": "Upgrade the memoized base card with safe markdown, claim metadata, accessible state labels, avatar stack, bounded overflow, and published/review/drift/suspended styling.",
    "files": [
      "packages/mcp-web/package.json",
      "packages/mcp-web/src/flow/base-card.tsx",
      "packages/mcp-web/src/app.css",
      "packages/mcp-web/test/rich-card.test.tsx"
    ],
    "dependsOn": ["01", "02"]
  },
  {
    "id": "04",
    "title": "Complete three semantic zoom regimes without node remounts",
    "description": "Keep CSS-driven node, floor, and tower regimes, add selected-node pinning, and expose stable DOM state for card, chip, and dot assertions.",
    "files": [
      "packages/mcp-web/src/app.tsx",
      "packages/mcp-web/src/flow/base-card.tsx",
      "packages/mcp-web/src/app.css",
      "packages/mcp-web/test/semantic-lod.test.ts"
    ],
    "dependsOn": ["03"]
  },
  {
    "id": "05",
    "title": "Promote overlays into interactive rich cell containers",
    "description": "Render every projected cell with a header, node and claim counts, lock countdown, presence avatars, ghost state, and an explicit open-turn target without blocking node interactions.",
    "files": [
      "packages/mcp-web/src/cell-container.tsx",
      "packages/mcp-web/src/turn.tsx",
      "packages/mcp-web/src/app.tsx",
      "packages/mcp-web/src/app.css",
      "packages/mcp-web/test/cell-container.test.tsx"
    ],
    "dependsOn": ["02", "04"]
  },
  {
    "id": "06",
    "title": "Add accessible state legend and React Flow minimap",
    "description": "Add a keyboard-readable legend and minimap whose colors match domain and exceptional states while preserving canvas navigation.",
    "files": [
      "packages/mcp-web/src/state-legend.tsx",
      "packages/mcp-web/src/app.tsx",
      "packages/mcp-web/src/app.css",
      "packages/mcp-web/test/state-legend.test.tsx"
    ],
    "dependsOn": ["04", "05"]
  },
  {
    "id": "07",
    "title": "Cover semantic zoom and rich snapshot behavior end to end",
    "description": "Add the three-regime scenario, selected-node pin assertion, cell-header turn flow, minimap visibility, and update snapshot rendering expectations for rich cards.",
    "files": [
      "packages/mcp-web/e2e/semantic-zoom.e2e.ts",
      "packages/mcp-web/e2e/snapshot-render.e2e.ts"
    ],
    "dependsOn": ["03", "04", "05", "06"]
  },
  {
    "id": "08",
    "title": "Measure rich-canvas pan performance in the session regime",
    "description": "Add a deterministic session-size fixture and frame sampler, assert the 50 FPS floor with a 60 FPS target, and report the measured result in the UI-0 performance table.",
    "files": [
      "packages/mcp-web/e2e/rich-canvas-performance.e2e.ts",
      "packages/mcp-web/e2e/fixture.ts",
      "docs/roadmap-web-ui/00-scope-ui-0-spike-fundacao.md"
    ],
    "dependsOn": ["07"]
  },
  {
    "id": "09",
    "title": "Close UI-4 acceptance and continuous integration gates",
    "description": "Run focused unit, end-to-end, build, and workspace checks; update only the UI-4 roadmap status and DoD after every scenario and performance gate passes.",
    "files": [
      "docs/roadmap-web-ui/04-scope-ui-4-nos-ricos.md"
    ],
    "dependsOn": ["08"]
  }
]
```

## Section 7 — Cross-Cutting Constraints

- Preserve the existing `BaseCard` node type and React Flow node IDs.
- Keep live server access behind existing `og.ts` adapters.
- Avoid storing viewport-scale state per node.
- Keep markdown content read-only and sanitized.
- Prevent cell backgrounds from capturing node, ghost, or minimap interactions.
- Expose stable selectors for all acceptance scenarios.

