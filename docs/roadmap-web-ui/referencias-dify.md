# Referências — Dify workflow editor (React Flow em produção)

> Fonte: `~/Documentos/Repos/dify/web/app/components/workflow/` —
> editor de workflow colaborativo sobre React Flow **v11**
> (`reactflow`, não `@xyflow/react` 12), Next.js, zustand, colaboração
> CRDT (Loro) via socket.io. Explorado em 2026-07-18. Paths abaixo são
> relativos a `web/app/components/workflow/`.

## A. Validações das nossas decisões (WD)

1. **Zustand com slices é o padrão de produção** (`store/workflow/index.ts`):
   ~15 slices compostos (node-slice, panel-slice, help-line-slice,
   history-slice…) num `createStore` vanilla + hook `useStore(selector)`.
   Valida WD2 e o risco 1 da UI-1 (seletores finos evitam re-render em
   cascata). Copiar o padrão de composição de slices, não a lib deles.
2. **Nós ricos sem iframe funcionam** — nó inteiro é componente React
   com editor DENTRO (`note-node/index.tsx`: editor de texto com
   toolbar, temas, resize via `NodeResizer`, `useClickAway` pra
   desselecionar). Prova a tese da UI-4; nosso nó markdown é o
   note-node deles com react-markdown no lugar do editor.
3. **Dify NÃO usa `onlyRenderVisibleElements`** (props do `<ReactFlow>`
   em `index.tsx:710-752`) — workflows são dezenas de nós, escala nunca
   foi problema pra eles. Confirma o alerta do conselheiro: ninguém no
   regime deles testou milhares de nós; nosso spike UI-0 continua
   obrigatório, sem atalho.
4. **Custom node base único** (`nodes/_base/node.tsx`): TODOS os ~30
   tipos de nó renderizam por um `BaseNode` memoizado com seções
   (NodeHeaderMeta/NodeBody/NodeDescription) e o específico como child.
   Adotar na UI-0: um `BaseCard` + variantes por tipo, não N componentes
   soltos.

## B. Padrões a copiar (por fase do roadmap)

### UI-0 (fundação)
- **Props do canvas** (`index.tsx:735-752`) — receita testada:
  `deleteKeyCode={null}` e `multiSelectionKeyCode={null}` (atalhos
  controlados por hotkey manager próprio, não pelo RF),
  `SelectionMode.Partial`, `minZoom` fixo, `panOnScroll` condicionado a
  modo pointer/hand (`ControlMode` — vale copiar o conceito de modos de
  cursor). `nodesDraggable`/`nodesConnectable`/`nodesFocusable` como
  função de readonly — nosso análogo: participante sem turno aberto.
- **`nodeTypes`/`edgeTypes` como constantes de módulo** (fora do
  componente — RF exige identidade estável; erro clássico evitado).

### UI-1 (vivacidade)
- **Cursores remotos** (`collaboration/services/cursor-service.ts`):
  throttle 300ms + distância mínima 10px antes de emitir; coordenadas
  convertidas pro espaço do flow via `reactFlowInstance`. Nosso análogo
  de baixo custo: emitir só cell focada (já temos `presence.focus`) e,
  se quisermos cursor real, copiar o throttle/min-distance.
- **Presença por painel de nó** (`collaboration/types`:
  `NodePanelPresenceMap` — quem está com o painel de QUAL nó aberto,
  com avatar no nó): idêntico ao nosso "quem está focando esta cell";
  a UI deles mostra `UserAvatarList` no header do nó (`_base/node.tsx`).
  Reusar o conceito de mapa `nodeId → {user → info}` no zustand.

### UI-2 (turnos)
- **Diagnóstico defensivo de sync** (`collaboration-manager.ts`:
  `SetNodesAnomalyReason = 'node_count_decrease' | 'start_removed'`):
  eles detectam estados impossíveis ANTES de aplicar (contagem de nós
  caiu? nó obrigatório sumiu?) e logam com estágio. Adotar no nosso
  apply de eventos SSE: snapshot novo com menos nós que o atual sem
  evento de abort/rebuild = anomalia logada, não aplicada em silêncio.
- **`_isTempNode`** (note-node): nó existe no canvas antes de
  confirmado — análogo exato do nosso ghost/draft; eles desabilitam
  edição até efetivar. Mesmo padrão pros nossos claims em draft.

### UI-3 (leitura/busca)
- **Busca "goto anything"** (`hooks/use-workflow-search.tsx` +
  `goto-anything-search.ts`): nós se REGISTRAM num índice de busca
  central (`registerWorkflowNodeSearch`) e a seleção navega/centra via
  `node-navigation.ts` (`selectWorkflowNode`). Arquitetura melhor que
  buscar no array de nós ad-hoc: nosso ⌘K registra providers (nós,
  claims, cells, eventos) e cada um resolve navegação própria.

### UI-4 (nós ricos)
- **`NodeResizer` + `use-node-resize-observer`** (`_base/`): resize de
  card rico com observer — resolver o risco "markdown quebra layout"
  com card redimensionável + max default, como o note-node.
- **Temas por nó** (`note-node/constants.ts` `THEME_MAP`): mapa
  cor→classes; nosso análogo é o mapa de estado (Publicado/Em
  revisão/Rascunho) do norte visual.

### Transversal (qualquer fase)
- **Hotkeys centralizados** (`shortcuts/definitions.ts` +
  `hotkeys.ts`): registro único de atalhos com guard de
  `preventDefault` browser (Mod+S etc.), kbd component pra exibir.
  Adotar cedo (UI-1) — retrofit de atalho é chato.
- **Help lines** (`help-line-slice` + `use-helpline.ts`): guias de
  alinhamento ao arrastar. Só se arrastarmos nós manualmente algum dia
  — nosso layout é `seedLayout` (WD4); registrar e ignorar por ora.
- **Undo/redo com zundo** (`workflow-history-store.ts`: middleware
  `temporal` do zustand): barato e pronto. MAS: nosso undo de grafo é
  o event log do server, não estado local — zundo serve só pra undo de
  UI (form de claim antes do submit). Não confundir os dois.
- **Auto-layout com ELK** (`utils/elk-layout` via
  `use-workflow-organize`): eles usam elkjs pra "organizar" o grafo
  sob demanda. Se `seedLayout` ficar ruim pra cards grandes (risco 2
  da UI-0), elkjs é o plano B maduro — botão "organizar", não layout
  contínuo.

## C. O que NÃO copiar (e por quê)

1. **CRDT (Loro) + socket.io** (`collaboration/core/crdt-provider.ts`:
   doc local exporta update → socket → import no peer): modelo
   last-writer-merge SEM lock — o oposto do nosso produto. Nosso
   changeset/lock/gate É a feature; CRDT aqui destruiria a tese.
   Confirma a análise de mercado: engine colaborativa própria briga
   com server autoritativo. (A camada de TRANSPORTE deles — socket.io
   com auth guard e re-emissão — também não precisamos: nossa lib
   INT-2 já resolve SSE+reconnect.)
2. **reactflow v11**: API antiga (`NodeProps` de `reactflow`). Nossos
   exemplos de referência precisam de tradução v11→v12 (`@xyflow/react`:
   `useStore` novo, `NodeProps<Node<T>>`, medidas em `node.measured`).
   Não copiar código literal — copiar padrão.
3. **use-nodes-interactions.ts com 86KB**: deixar o hook de interações
   virar monólito é o anti-padrão deles documentado por tamanho.
   Nossas interações por fase, hooks pequenos.
4. **Draft sync automático** (`use-nodes-sync-draft`): eles salvam o
   grafo inteiro como draft do servidor a cada mudança — faz sentido
   pra editor de workflow, não pro nosso modelo (draft nosso é
   changeset com claim explícito; autosave contínuo mudaria a semântica
   de turno).

## D. Fora do roadmap-web-ui (outros contextos)

1. **Checklist de publicação** (`hooks/use-checklist.ts`, 29KB): antes
   de publicar workflow, varredura estrutural com problemas navegáveis
   (clique → vai pro nó). Padrão pro nosso **go/no-go do BT-5**: em vez
   de checklist só em markdown, uma variante viva na UI do facilitador
   pós-retomada (backlog, não agora).
2. **Modo comentário** (`comment/`, `ControlMode.Comment`): camada de
   anotação sobre o canvas sem tocar no grafo. Ideia pós-beta para
   retro/facilitação: comentários de sessão que NÃO viram claims
   (hoje nosso único canal é `system.message`).
3. **`variable-inspect`/painel de execução** (`run/`): inspeção de
   execução passo-a-passo — análogo conceitual do nosso replay do
   event log (`graph://history`) como "timeline scrubber" pós-beta.
4. **i18n desde o dia 1** (strings em `web/i18n/en-US/`): nosso
   INSTALL.md é EN, UI é PT-BR — quando internacionalizar for pauta
   (INT-6/público), o padrão deles (chave por namespace) é o caminho;
   por ora só não hardcodar strings em componente compartilhado.
5. **Estrutura de testes co-localizados** (`__tests__/` por diretório
   de feature, inclusive pra hooks e collaboration): bate com nosso
   estilo de teste por pacote; manter na UI nova (unit de
   slices/hooks junto do código, e2e no harness).

## Consulta futura

Arquivos-chave pra revisitar quando a fase correspondente começar:
`index.tsx` (props canvas, UI-0) · `nodes/_base/node.tsx` (BaseCard,
UI-0/4) · `note-node/` (nó rico, UI-4) · `store/workflow/index.ts`
(slices, UI-0) · `collaboration/services/cursor-service.ts` (UI-1) ·
`hooks/use-workflow-search.tsx` (UI-3) · `shortcuts/definitions.ts`
(UI-1) · `utils/elk-layout` (plano B de layout).
