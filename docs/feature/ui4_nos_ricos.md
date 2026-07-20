# UI-4 Nós Ricos e Zoom Semântico

## OVERVIEW

Renderize o knowledge graph como cards ricos e seguros, preservando contexto em três regimes de zoom. Agrupe nós em containers de cell com colaboração ao vivo, ofereça legenda e minimapa, e mantenha pan fluido em snapshots densos.

## FOLDER STRUCTURE

```text
packages/mcp-web/
├── e2e/
│   ├── fixture.ts                         # suporta fixtures densas e medição real de pan
│   ├── rich-canvas-performance.e2e.ts     # mede 202 rich nodes em Chromium
│   ├── semantic-zoom.e2e.ts               # valida card, chip, dot e pin
│   └── snapshot-render.e2e.ts              # valida snapshot com cards ricos
├── src/
│   ├── app.tsx                             # integra LOD, containers, legenda e minimapa
│   ├── app.css                             # estilos de regimes, estados e cells
│   ├── cell-container.tsx                  # header, contagens, locks, presença e ghosts
│   ├── state-legend.tsx                    # legenda acessível de estados
│   └── flow/
│       ├── base-card.tsx                   # card memoizado com markdown e estado vivo
│       ├── rich-node.ts                    # regras puras de LOD, estado e cor
│       ├── safe-markdown.tsx               # markdown sanitizado e tabelas
│       └── to-flow.ts                      # layout determinístico calibrado para rich cards
└── test/
    ├── cell-container.test.tsx
    ├── rich-card.test.tsx
    ├── rich-node.test.ts
    └── state-legend.test.tsx
```

## COMPONENTS

| Componente | Responsabilidade | Regra principal |
|---|---|---|
| `BaseCard` | Renderizar conteúdo, metadados, avatares e estado | REQUIRED: mantenha a mesma raiz React nos três regimes. |
| `SafeMarkdown` | Renderizar markdown em React | REQUIRED: use `rehype-sanitize`; PROHIBITED: habilitar HTML cru. |
| `rich-node` | Resolver LOD efetivo, estado e cor de domínio | REQUIRED: mantenha funções puras e determinísticas. |
| `CellContainers` | Agregar geometria e colaboração por cell | REQUIRED: associe lock à cell, nunca ao nó isolado. |
| `StateLegend` | Explicar estados visuais | REQUIRED: exponha texto além da cor. |
| `GraphMiniMap` | Navegar no canvas em escala reduzida | REQUIRED: use as mesmas cores determinísticas de domínio. |

## SEMANTIC ZOOM

| Regime | Conteúdo visível | Identificador |
|---|---|---|
| `node` | Markdown, domínio, nível, claims, status e avatares | `[data-lod="node"]` |
| `floor` | Título, domínio, status e avatares | `[data-lod="floor"]` |
| `tower` | Dot colorido por domínio | `[data-lod="tower"]` |

- REQUIRED: derive o regime global com `lodForZoom` no wrapper do canvas.
- REQUIRED: preserve o nó selecionado em `node` com `data-pinned="true"`.
- PROHIBITED: grave o zoom por nó no Zustand ou remonte nós ao cruzar thresholds.

## VISUAL STATES

| Estado | Origem | Apresentação |
|---|---|---|
| `published` | Nenhuma exceção ativa | Verde e label Publicado. |
| `review` | Lock ou ghost na cell | Âmbar e contexto do turno. |
| `draft` | Ghost delta | Violeta tracejado. |
| `drift` | Grade de drift do nó | Marcador próprio e label Drift. |
| `suspended` | Authority suspensa da cell | Marcador próprio e label Suspenso. |

REQUIRED: preserve todos os marcadores aplicáveis; use a precedência `suspended`, `drift`, `review`, `draft`, `published` para o estado primário.

## CELL CONTAINERS

1. **Projete** um `.og-cell-container[data-cell]` para cada cell com geometria.
2. **Exiba** nome, claims únicos, lock/countdown e participantes no header.
3. **Abra** turno pela ação explícita `.og-cell-header[data-cell]`.
4. **Mantenha** nós e ghosts clicáveis sem propagação acidental ao header.
5. **Liste** locks de cells vazias em `#empty-cell-locks` sem inventar geometria.

## DOM CONTRACT

| Seletor | Contrato |
|---|---|
| `.og-card[data-id]` | Raiz estável do nó em qualquer zoom. |
| `.og-card[data-pinned="true"]` | Nó selecionado forçado ao card completo. |
| `.og-markdown` | Conteúdo markdown sanitizado. |
| `.og-node-status[data-state]` | Estado primário e labels visuais. |
| `.og-dot[data-domain]` | Marcador e domínio no regime baixo. |
| `.og-cell-container[data-cell]` | Limite visual da cell. |
| `.og-cell-header[data-cell]` | Alvo para abrir turno. |
| `.og-lock-badge` | Nome amigável e countdown do lock. |
| `.og-cell-avatars` | Participantes deduplicados na cell. |
| `#state-legend` | Legenda acessível. |
| `.react-flow__minimap` | Minimapa do React Flow. |

## PERFORMANCE

- Use o cenário de **202 rich nodes** em Chromium headless.
- Meça três execuções de dois segundos com pan real.
- Mantenha mediana de **60 FPS** e piso obrigatório de **50 FPS**.
- Preserve `BaseCard` memoizado, LOD por CSS e `onlyRenderVisibleElements`.

## VALIDATION

1. **Execute** os testes focados:

```bash
# CORRECT: valida regras puras e componentes UI-4
bun test packages/mcp-web/test/rich-node.test.ts packages/mcp-web/test/rich-card.test.tsx packages/mcp-web/test/cell-container.test.tsx packages/mcp-web/test/state-legend.test.tsx

# WRONG: validar somente o build sem exercitar contratos visuais
bun run --cwd packages/mcp-web build
```

2. **Execute** os cenários de browser:

```bash
# CORRECT: valida zoom, snapshot rico e performance de pan
bun run --cwd packages/mcp-web test:e2e -- e2e/semantic-zoom.e2e.ts e2e/snapshot-render.e2e.ts e2e/rich-canvas-performance.e2e.ts
```

## REFERENCES

| Documento | Relação |
|---|---|
| [UI-3 Leitura e Query](./ui3_leitura_query.md) | Define seleção, claims e navegação que fixam rich nodes no regime completo. |
| [UI-2 Turnos E2E](./ui2_turnos_e2e.md) | Define locks, presença e ghosts projetados nos cell containers. |
