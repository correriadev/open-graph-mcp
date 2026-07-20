# UI-4 — Nós Ricos e Zoom Semântico: Context Map

## 1. BOUNDED CONTEXTS

| Contexto | Modelo proprietário | Responsabilidade | Relação externa |
|---|---|---|---|
| Canvas Presentation | `RichNode`, `SemanticLod`, `PinnedNode` | Projetar conteúdo e detalhe por escala. | Consome snapshot e viewport. |
| Cell Visualization | `CellContainer`, `CellHeader`, `CellVisualState` | Agregar geometria e colaboração por cell. | Consome locks, presença, ghosts e authority. |
| Spatial Projection | `FlowProjection`, `CellRect`, `LayoutMetrics` | Converter grafo em posições e retângulos determinísticos. | ACL sobre `Graph` do graph-core. |
| Collaboration Read Model | `Lock`, `PresenceEntry`, `DraftDelta`, `DriftGrade` | Manter projeções ao vivo recebidas por SSE. | Upstream existente de `og.ts` e Zustand. |
| Canvas Navigation | `Viewport`, `MiniMap`, `Selection` | Controlar pan, zoom, foco e minimapa. | React Flow como serviço genérico. |
| Turn Interaction | `OpenTurnRequest` | Abrir turno com cell preenchida. | Contexto UI-2 downstream. |

## 2. CONTEXT RELATIONSHIPS

| Upstream | Downstream | Padrão | Contrato |
|---|---|---|---|
| graph-core Snapshot | Spatial Projection | Anti-Corruption Layer | `Graph`, `GraphNode`, authority por cell. |
| Spatial Projection | Canvas Presentation | Customer/Supplier | `Node<CardData>[]`, `CellRect`, métricas de layout. |
| Collaboration Read Model | Cell Visualization | Published Language | `locks`, `roster`, `ghostCells`, `ghostDeltasByCell`. |
| Collaboration Read Model | Canvas Presentation | Published Language | `drift[nodeId]`, seleção e estado de revisão. |
| Canvas Navigation | Canvas Presentation | Conformist | Viewport e eventos do React Flow. |
| Cell Visualization | Turn Interaction | Open Host Service | `requestOpenTurn(cell)`. |
| Canvas Presentation | Claims Browser | Shared Kernel | Seleção de nó/cell já existente no store. |

## 3. DATA OWNERSHIP

| Dado | Source of Truth | Projeção UI | Mutação permitida nesta fase |
|---|---|---|---|
| Nós e edges | `graph://snapshot` | `useUi.graph` | Não. |
| Conteúdo do nó | `GraphNode` do snapshot | `CardData.node` | Não. |
| Lock e TTL | Eventos do servidor | `useUi.locks` | Não; somente countdown local. |
| Presença | Eventos de presença | `useUi.roster` | Não. |
| Ghosts | Changeset aberto | `useUi.ghost*` | Não. |
| Drift/authority | Snapshot e eventos | `useUi.drift`, `graph.authority` | Não. |
| Zoom | React Flow viewport | `data-lod` no canvas | Sim, efêmera. |
| Pin | Seleção/busca | Derivado de `selectedId` | Sim, efêmera. |

## 4. INTEGRATION CONTRACTS

### Snapshot to Rich Node

- Receber `id`, `domain`, `level`, `responsibility`, `anchor`, `claims`, `confidence` e `overclaim`.
- Escolher uma fonte de markdown explícita e determinística; nunca concatenar conteúdo arbitrário sem rótulo.
- Preservar o `id` do React Flow entre regimes.

### Live Collaboration to Cell Container

- Resolver chaves de cell no dialeto visual `domínio:Pn`.
- Exibir lock com nome conhecido, `csId` acessível e countdown.
- Agrupar avatares pela `focusCell` sem expor `userId` bruto.
- Mostrar ghosts dentro do limite visual da cell.

### Cell Container to Turn Interaction

- Tratar apenas header/fundo explícito como alvo de abertura.
- Chamar `requestOpenTurn(cell)` com a mesma chave exibida.
- Não interceptar clique de nó, handle, ghost ou controle do minimapa.

### Semantic LOD to CSS

- Mapear `lodForZoom` para `node`, `floor` e `tower`.
- Alterar somente atributos/classes visuais no evento de viewport.
- Aplicar pin como override local do regime global.

## 5. FAILURE TRANSLATION

| Falha upstream | Tradução visual | Comportamento seguro |
|---|---|---|
| Markdown vazio | Corpo `—` ou responsabilidade disponível | Manter metadados e status. |
| Markdown malformado | Texto parcial renderizável | Não quebrar o canvas. |
| Cell sem rect | Omitir container | Manter nós existentes navegáveis. |
| Lock sem roster correspondente | Nome neutro, sem PII adicional | Exibir countdown e cell. |
| Authority ausente | Estado padrão publicado/source | Não inferir suspended. |
| Minimap indisponível | Canvas principal continua funcional | Não bloquear pan/zoom. |

## 6. CONSISTENCY BOUNDARIES

- `FlowProjection` deve produzir nós e cells na mesma operação para evitar geometria divergente.
- `CellVisualState` é uma projeção eventual; não decide autorização ou posse de lock.
- `SemanticLod` é local ao cliente; não altera snapshot, query ou claims.
- `PinnedNode` termina ao remover seleção; não persiste entre sessões.
- Estado de revisão deriva de lock/changeset observado, não de cor codificada no conteúdo.

## 7. DEPENDENCY DIRECTION

1. `graph-core` fornece tipos e `lodForZoom` ao `mcp-web`.
2. `to-flow.ts` adapta o snapshot sem alterar `graph-core`.
3. Componentes de canvas consomem somente projeções e ações do store.
4. React Flow fornece viewport e minimapa; regras semânticas permanecem no `mcp-web`.
5. Nenhuma dependência nova deve acessar servidor diretamente fora de `og.ts`.

