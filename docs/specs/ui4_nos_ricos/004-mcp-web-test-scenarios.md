# UI-4 — Nós Ricos e Zoom Semântico: Test Scenarios — mcp-web

## 1. TEST STRATEGY

| Nível | Objetivo | Ferramenta | Evidência |
|---|---|---|---|
| Pure unit | Estado visual, cor, markdown source e layout | Bun test | Helpers determinísticos e casos-limite. |
| Component | Markdown, legenda, header e interações | Bun/DOM harness existente | DOM semântico e callbacks. |
| E2E | LOD, pin, cell turn, minimapa e snapshot | Playwright | Browser real contra harness. |
| Performance | Fluidez no Session Regime | Playwright + `requestAnimationFrame` | FPS alvo 60, piso 50. |
| Build/CI | Integração e tipos | Bun/Vite | Exit code zero. |

## 2. FIXTURES

### Rich ADR-like Node

- Nó com título, parágrafos, lista, tabela, claims, confiança e domínio conhecido.
- Markdown contém HTML cru/script para confirmar bloqueio.
- Conteúdo excede a altura disponível para confirmar overflow contido.

### Collaborative Cell

- Cell com múltiplos nós e claims.
- Lock ativo com TTL futuro.
- Dois participantes com `focusCell` correspondente.
- Um ghost delta e um nó com drift.
- Authority `suspended` em uma cell distinta.

### Session Regime

- Quantidade de nós e edges equivalente à sessão medida no spike UI-0.
- Conteúdo markdown representativo, não placeholders vazios.
- Distribuição em múltiplos domínios e níveis.
- Snapshot e posições determinísticos entre execuções.

## 3. UNIT SCENARIOS

### U1 — Visual state precedence

**Given** um nó publicado em cell locked com drift e authority suspended  
**When** o resolvedor calcula estado e marcadores  
**Then** suspended e drift permanecem perceptíveis, review não mascara falha e labels não dependem somente de cor.

### U2 — Stable domain palette

**Given** dois nós do mesmo domínio e um nó sem domínio  
**When** card, dot e minimapa solicitam cores  
**Then** o mesmo domínio recebe a mesma cor e o domínio ausente recebe fallback estável.

### U3 — Deterministic layout without overlap

**Given** snapshots iguais com ordem de nós diferente  
**When** `toFlow` projeta cards e cells  
**Then** posições e retângulos são idênticos, headers têm espaço e nenhuma cell invade outra banda.

### U4 — Rich-content bounds

**Given** markdown com tabela larga, lista longa, HTML cru e link  
**When** o card renderiza  
**Then** títulos/listas/tabela são legíveis, HTML inseguro não executa e o card não causa overflow horizontal no canvas.

### U5 — Semantic pin

**Given** LOD global tower e um nó selecionado  
**When** a apresentação resolve o regime efetivo  
**Then** o selecionado usa card e os demais usam dot; ao desmarcar, todos retornam a tower.

### U6 — Cell aggregation

**Given** nós, claims, roster e locks com entradas repetidas  
**When** o container agrega seu header  
**Then** contagens são corretas, avatars são deduplicados e nenhuma PII bruta substitui o display name disponível.

## 4. COMPONENT SCENARIOS

### C1 — Rich card semantics

- Renderizar heading, list, table, status label, claim count and confidence.
- Confirmar que dot e chip permanecem na mesma raiz `.og-card`.
- Confirmar nome acessível contendo identidade e estado do nó.

### C2 — Cell header opens turn

- Clicar em `.og-cell-header[data-cell="auth:P2"]`.
- Confirmar `requestOpenTurn("auth:P2")` exatamente uma vez.
- Clicar em nó/ghost dentro da cell e confirmar que o header não recebe o clique.

### C3 — Lock countdown and presence

- Avançar relógio controlado.
- Confirmar countdown regressivo sem remontar todos os nós.
- Confirmar stack `+N`, tooltip/nome acessível e remoção após presence leave.

### C4 — Accessible legend

- Navegar por teclado até o controle da legenda.
- Confirmar labels para Publicado, Em revisão, Rascunho e Drift/Suspended.
- Confirmar que cada entrada contém texto ou ícone nomeado além do swatch.

## 5. END-TO-END SCENARIOS

### E1 — Three visible semantic regimes

**File:** `e2e/semantic-zoom.e2e.ts`

1. Abrir snapshot e registrar o `data-id` do primeiro `.og-card`.
2. Aplicar zoom alto e confirmar markdown, metadados e status visíveis.
3. Aplicar zoom médio e confirmar título/status/avatares visíveis, corpo markdown oculto.
4. Aplicar zoom baixo e confirmar `.og-dot` visível e conteúdo de card/chip oculto.
5. Confirmar que a mesma raiz/data-id permanece conectada ao DOM durante as transições.

### E2 — Selected node remains readable

1. Selecionar um nó em zoom alto.
2. Reduzir até Dot Regime.
3. Confirmar nó selecionado ainda em Card Regime e vizinhos como dots.
4. Fechar seleção e confirmar nó volta a dot.

### E3 — Rich snapshot and safe markdown

**File:** atualização de `e2e/snapshot-render.e2e.ts`

1. Ler `graph://snapshot` e confirmar a quantidade de raízes `.og-card`.
2. Abrir o nó ADR-like e confirmar heading, lista e tabela.
3. Confirmar ausência de `script`, iframe e overflow horizontal do canvas.
4. Clicar no nó e confirmar painel/seleção ainda funcionais.

### E4 — Rich cell container and turn target

1. Confirmar `.og-cell-container` para cada cell projetada.
2. Confirmar header com cell, contagem e avatares.
3. Abrir um turno concorrente e observar lock âmbar + countdown no container.
4. Clicar no header de uma cell livre e confirmar modal de turno com cell preenchida.
5. Confirmar que clique no card continua selecionando o nó, não abrindo turno.

### E5 — Complete visual states

1. Confirmar published com label verde.
2. Confirmar locked/open-turn como review âmbar no container.
3. Confirmar ghost violeta tracejado e identificado como rascunho.
4. Injetar/observar drift e authority suspended e confirmar marcadores próprios.
5. Abrir legenda e associar cada marcador ao texto correspondente.

### E6 — MiniMap navigation

1. Confirmar minimapa visível e com nós coloridos por domínio.
2. Interagir com uma região distante.
3. Confirmar mudança do viewport principal.
4. Confirmar que minimapa não abre turno nem seleciona cell acidentalmente.

## 6. PERFORMANCE SCENARIO

### P1 — Session-regime pan gate

1. Carregar a fixture Session Regime com Rich Nodes reais.
2. Aquecer renderização e aguardar estabilização de fontes/layout.
3. Executar pan determinístico por duração fixa usando frames do browser.
4. Contar frames por `requestAnimationFrame` e frames acima do orçamento.
5. Repetir ao menos três vezes e usar a mediana.
6. Registrar hardware/browser/quantidade de nós no resultado.

**Acceptance:**

- Target: mediana igual ou superior a 60 FPS.
- Hard floor: mediana igual ou superior a 50 FPS.
- Falhar abaixo de 50 FPS.
- Não aceitar medição com conteúdo vazio, aba em background ou animação menor que dois segundos.

## 7. NEGATIVE AND EDGE CASES

| Caso | Resultado esperado |
|---|---|
| Markdown vazio | Card mantém título, metadados e placeholder neutro. |
| Tabela extremamente larga | Card contém overflow; canvas não ganha scroll horizontal. |
| HTML/script no markdown | Não executa nem injeta elemento inseguro. |
| Cell sem nós mas com lock | Não renderiza geometria falsa; lock permanece disponível por UI existente. |
| Lock expira durante interação | Header remove review/lock sem recarregar página. |
| Participante sai | Avatar desaparece sem alterar posição dos cards. |
| Zoom oscila no threshold | Identidade/seleção do nó permanece; sem remount storm. |
| Domínio ausente | Dot e minimapa usam fallback acessível. |
| Nó selected + suspended + tower | Card pinned mostra suspended e permanece legível. |
| Minimap sobre container | Eventos do minimapa não propagam para abertura de turno. |

## 8. STABLE DOM CONTRACT

| Selector / Attribute | Contract |
|---|---|
| `.og-card[data-id]` | Raiz estável do nó em todos os regimes. |
| `[data-lod="node|floor|tower"]` | Regime global atual do canvas. |
| `.og-card[data-pinned="true"]` | Override de seleção para Card Regime. |
| `.og-markdown` | Conteúdo markdown somente no Card Regime efetivo. |
| `.og-node-status[data-state]` | Estado textual e visual do nó. |
| `.og-dot[data-domain]` | Marcador do Dot Regime. |
| `.og-cell-container[data-cell]` | Limite visual da cell. |
| `.og-cell-header[data-cell]` | Alvo explícito para abrir turno. |
| `.og-lock-badge` | Holder amigável e countdown. |
| `.og-cell-avatars` | Stack de presença da cell. |
| `#state-legend` | Legenda acessível. |
| `.react-flow__minimap` | Minimapa React Flow. |

## 9. DEFINITION OF DONE

- Todos os cenários unitários, componentes e E2E passam.
- `semantic-zoom.e2e.ts` comprova três regimes e pin sem remount.
- `snapshot-render.e2e.ts` valida card rico e markdown seguro.
- Cell container abre turno e mantém lock/presença/ghost corretos.
- Minimapa e legenda são acessíveis e não conflitam com canvas.
- Mediana de pan atende ao piso de 50 FPS e registra alvo de 60 FPS.
- Build e CI do workspace terminam com exit code zero.

