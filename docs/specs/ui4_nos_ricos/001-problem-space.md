# UI-4 — Nós Ricos e Zoom Semântico: Problem Space

## 1. SCOPE

Transformar o canvas do `mcp-web` em uma superfície de leitura rica sem sacrificar orientação espacial, colaboração ao vivo ou fluidez. O usuário deve reconhecer conteúdo, estado e contexto de uma cell em qualquer escala, enquanto a seleção mantém detalhe suficiente para concluir a tarefa corrente.

### In Scope

- Conteúdo markdown seguro em nós no regime de maior detalhe.
- Três regimes semânticos: card, chip e dot.
- Cell containers com cabeçalho, contagem, lock/TTL e presença.
- Estados publicado, em revisão, rascunho e drift/suspended.
- Legenda acessível e minimapa.
- Layout recalibrado e medição de pan com nós ricos.

### Out of Scope

- Mini-aplicações ou inputs dentro dos nós.
- Imagens e tipos de conteúdo ainda inexistentes no domínio.
- Persistência de posições manuais.
- Tema claro.
- Mudanças no protocolo MCP ou no modelo persistido do grafo.

## 2. DOMAIN EVENTS

| Ordem | Evento | Gatilho | Resultado observável |
|---:|---|---|---|
| 1 | `SnapshotProjected` | Snapshot chega do servidor | Nós e cells recebem posições e dimensões determinísticas. |
| 2 | `RichNodeRendered` | Nó entra no viewport | Conteúdo, metadados e estado são exibidos no regime ativo. |
| 3 | `SemanticZoomChanged` | Zoom cruza um threshold | O mesmo nó alterna card, chip ou dot sem remount. |
| 4 | `NodePinned` | Busca ou seleção escolhe nó | Nó selecionado permanece em modo card apesar do zoom. |
| 5 | `CellContainerRendered` | Projeção contém uma cell | Header mostra nome, contagem e estado colaborativo. |
| 6 | `CellTurnRequested` | Usuário clica no container | Modal de turno abre com a cell preenchida. |
| 7 | `LiveStateProjected` | Lock, presença, ghost ou drift muda | Container/nó atualiza somente a projeção afetada. |
| 8 | `MiniMapNavigated` | Usuário interage com minimapa | Viewport centraliza a região escolhida. |
| 9 | `PerformanceMeasured` | Cenário de sessão executa pan | FPS medido é registrado contra o gate 60/50. |

## 3. SUBDOMAINS

| Subdomain | Tipo | Responsabilidade |
|---|---|---|
| Semantic Presentation | Core | Decidir qual significado visual permanece em cada regime de zoom. |
| Rich Content Rendering | Core | Renderizar markdown legível, seguro e contido no card. |
| Cell Collaboration Projection | Supporting | Agregar lock, TTL, presença, ghosts e contagem no container. |
| Spatial Layout | Supporting | Dimensionar cells e cards sem sobreposição ou instabilidade. |
| Canvas Navigation | Generic | Fornecer pan, zoom, seleção e minimapa via React Flow. |
| Accessibility | Generic | Expor legenda, estados, nomes e controles por texto/ARIA. |
| Performance Verification | Generic | Medir fluidez do canvas com conteúdo representativo. |

## 4. UBIQUITOUS LANGUAGE

| Termo | Definição |
|---|---|
| Rich Node | Nó que apresenta markdown, metadados vivos, estado e relações relevantes. |
| Semantic Zoom | Mudança deliberada da informação visível conforme a escala, não mera redução geométrica. |
| Card Regime | Regime de alta escala com markdown e metadados completos. |
| Chip Regime | Regime intermediário com título, status e avatares. |
| Dot Regime | Regime baixo com marcador colorido por domínio. |
| Pin | Exceção temporária que mantém o nó selecionado em Card Regime. |
| Cell Container | Limite visual de `domínio:nível` que agrega nós e estado colaborativo. |
| Cell Header | Cabeçalho do container com nome, contagem, lock/TTL e presença. |
| Published | Estado verde de conteúdo admitido e sem revisão ativa. |
| In Review | Estado âmbar de cell com turno aberto/lock ativo. |
| Draft Ghost | Delta ainda não commitado, violeta e tracejado. |
| Drift/Suspended | Estado de divergência ou autoridade suspensa com marcador próprio. |
| Session Regime | Fixture representativa usada para medir pan e FPS. |

## 5. BUSINESS RULES

1. Um nó selecionado deve permanecer legível no Card Regime em qualquer zoom.
2. Alterar o regime não deve trocar a identidade React do nó nem perder seleção.
3. Markdown deve aceitar títulos, listas e tabelas, bloquear HTML inseguro e permanecer dentro do card.
4. Lock pertence à cell, nunca a um nó isolado.
5. Cell container deve ser o alvo para abrir turno naquela cell.
6. Contagem do header deve refletir nós/claims projetados sem duplicação.
7. Estados devem ser distinguíveis por texto ou ícone além da cor.
8. O Dot Regime deve preservar cor de domínio e estado selecionado.
9. O layout deve ser determinístico para o mesmo snapshot.
10. O gate de desempenho exige 60 FPS alvo e mínimo aceitável de 50 FPS no Session Regime.

## 6. CONSTRAINTS AND RISKS

| Risco | Impacto | Mitigação |
|---|---|---|
| Markdown largo ou alto | Canvas transborda ou captura scroll | Sanitização padrão, largura limitada, altura máxima e overflow interno. |
| Re-render de todos os nós no zoom | Jank durante pan/zoom | Manter `BaseCard` memoizado e dirigir LOD por atributo CSS. |
| Containers sobrepõem cards | Interação bloqueada | Separar hit target do fundo e definir ordem/pointer-events explícitos. |
| Presença/TTL atualiza em alta frequência | Re-render amplo | Seletores Zustand por projeção de cell e countdown localizado. |
| Pin conflita com CSS global | Seleção perde detalhe | Atributo local do nó deve sobrepor o `data-lod` do wrapper. |
| Cor como único sinal | Falha de acessibilidade | Legenda textual, labels e símbolos por estado. |

## 7. SOCRATIC QUESTIONS

- Qual campo existente é a fonte canônica do corpo markdown: `responsibility`, `anchor` ou claim selecionado?
- O header contabiliza nós, claims, ou ambos com rótulos separados?
- O clique no fundo do container seleciona a cell antes de abrir o turno, ou abre diretamente?
- Qual política limita links e HTML produzidos pelo markdown sanitizado?
- O limiar 60/50 deve usar média, p95 de frame time ou percentual de frames lentos?
- O estado suspended prevalece visualmente sobre in-review quando ambos coexistem?

