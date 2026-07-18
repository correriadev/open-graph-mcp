# UI Concept Generator — prompts visuais (norte pro designer)

> Objetivo: materializar via IA geradora de imagem (Midjourney/DALL-E/Flux)
> a interface ideal do open-graph-mcp. **Referência visual aprovada:**
> `PROTIPO.png` (estilo "Nebula") — fundo quase-preto com grid pontilhado,
> nodes como cards ricos em metadados, acento violeta, feeds monospace,
> interface em PT-BR. Os prompts abaixo replicam ESSE estilo aplicado às
> features reais do produto: cells `domínio:nível` (P1–P5) com lock
> pessimista e TTL, turnos (changesets) com deltas/gate, ghosts de draft,
> presença humano×agente, `graph.query` com gaps, event log, telemetria
> de sessão (BT-2, visão do facilitador — nunca do participante).

---

## 1. Diretrizes estéticas base (extraídas da referência aprovada)

| Eixo | Direção |
|---|---|
| Fundo | Quase-preto (#0a0a0f) com grid de pontos sutil; painéis #121218 com borda 1px #26262e |
| Acento primário | Violeta (#8b5cf6) — seleção, links, botão primário, bordas de draft |
| Semântica de estado | Verde (#10b981) = commitado/publicado/saudável · Âmbar (#f59e0b) = lock/turno aberto/em revisão · Vermelho (#ef4444) = `lock.denied`/erro · Violeta tracejado = rascunho (ghost) |
| Nodes | **Cards**, não pontos: ícone + chip de tipo, título, stack de avatares dos contribuidores, descrição 1-2 linhas, contadores (claims/refs), badge de status no rodapé; marcador "Você está aqui" no card focado |
| Tipografia | Sans grotesca (Inter/Geist) na UI; monospace (JetBrains Mono) em feeds de evento, IDs, seq, latências |
| Idioma | Interface em **PT-BR** (Presença, Atividade recente, Camadas, Turnos) |
| Layout | Sidebar esquerda: árvore hierárquica + filtros rápidos + tags · Rail direito: presença + atividade + saúde do sistema · Barra inferior: comando/IA · Minimapa no canto |
| Multiplayer | Avatares empilhados no topo (+N), roster com linha de atividade por pessoa, dots coloridos de status |
| Densidade | Alta mas respirada — cards com padding generoso, feeds compactos monospace |

**Mapeamento estilo → produto** (pro designer não se perder):

| Elemento da referência | Feature real |
|---|---|
| Camadas "01 Fundamentação / 2.3 Entidades 🔒" | Domínios × níveis: `historia:P1..P5`, `mecanicas:P2`… com badge de lock por cell |
| Badge "Publicado / Em revisão / Rascunho" | committed / changeset aberto / ghost delta |
| Chip de tipo do card ("Conceito", "Regra") | domínio do claim (`historia`, `regras`…) |
| Filtros "Bloqueados 3 🔒 / Minhas contribuições" | locks ativos / `changeset.list_mine` |
| Feed "lock.denied [Resolução de Conflitos] por Thais" | event log real: `lock.denied`, `changeset.opened/committed/aborted`, `lock.released` |
| "Sistema · Saudável · 42ms" | telemetria BT-2 — **só na visão do facilitador** |
| Barra "peça algo à IA" | agentes MCP na mesa (BD5) — comando dispara agente, não chat genérico |

---

## 2. Prompts de geração (EN, copiar e colar)

Bloco de estilo comum — **prefixar em todos os prompts**:

```
Dark professional SaaS collaboration app UI, near-black background
(#0a0a0f) with subtle dot grid, high-fidelity product screenshot,
Portuguese (Brazil) interface labels, violet (#8b5cf6) primary accent,
rounded metadata-rich node cards with soft glow, Inter-style grotesque
sans for UI and JetBrains Mono for event feeds and IDs, status color
system: green=published, amber=locked/in-review, red=denied, dashed
violet=draft. Aesthetic like Linear meets Figma multiplayer, calm,
premium, data-dense but airy.
```

### Prompt 1 — Dashboard geral (canvas de co-criação)

```
[bloco de estilo] Main screen of a collaborative knowledge-graph game
design tool. Top bar: logo, breadcrumb "beta-20260718 / Knowledge
Canvas", global search "Buscar em tudo... ⌘K", online pill, stacked
user avatars "+3", violet "Abrir Turno" primary button. Center canvas:
five node CARDS arranged as a loose graph connected by thin curved
edges with arrowheads — each card has a type chip ("historia",
"mecanicas", "gameloop"), a title like "Premissa do Mundo", contributor
avatar stack, two-line description, footer with claim count and status
badge: one card green "Publicado", one amber "Em revisão" with a small
amber padlock and TTL countdown "04:32", one with dashed violet border
badge "Rascunho", one highlighted with a violet "Você está aqui"
marker. An amber lock icon floats on the edge between two cards. Left
sidebar: "CÉLULAS" hierarchical tree — domains "historia, personagens,
mecanicas, gameloop, mundo, regras" each expanding into levels P1–P5
with counts and small lock badges; below it "FILTROS RÁPIDOS" (Com
turno aberto 3, Bloqueados 2 🔒, Minhas contribuições 12, Alterados
hoje 8) and colored TAGS. Right rail: "PRESENÇA" roster of six users
with avatar, name, activity line ("Editando Mecânica de Combate",
"Navegando no canvas") and colored status dots, one entry labeled
"agente" with a robot glyph; below it "ATIVIDADE RECENTE" monospace
feed with colored event kinds — "11:42:01 Ana abriu turno em
[mecanicas:P2]", "11:41:32 lock.denied [gameloop:P3] por Thais" in
red, "changeset.committed [historia:P1] por Lucas" in green. Bottom
center: slim command bar "Digite um comando ou peça algo ao agente..."
with context and mode chips. Bottom right: small minimap. --ar 16:9
--style raw
```

### Prompt 2 — Turno aberto (draft, deltas, gate-check)

```
[bloco de estilo] Detail screen of an open editing turn in a
collaborative knowledge-graph tool. Canvas zoomed on one large focused
node card "mecanicas:P2 — Sistema de Combate" with amber border,
padlock badge "seu turno · expira em 04:32", neighboring cards dimmed;
two attached draft sub-cards with dashed violet borders labeled
"Rascunho". A hovering avatar near the card border with tooltip "Rui ·
agente · aguardando lock". Right side panel titled "Turno cs-7f3a" in
monospace: intent text field, vertical timeline of claim deltas with
timestamps and author avatars, structured claim form (Assunto, Domínio
dropdown, Nível P1–P5 dropdown, Refs tag input, Trecho âncora
textarea), collapsed "JSON bruto" code section with syntax
highlighting, then a gate-check strip: green check "regras 1-5 ok" and
amber warning "roundtrip: referência não resolvida", and three
buttons — solid green "Commitar", ghost "Abortar", outline violet
"Estender TTL". Below the panel a compact list "Meus turnos abertos
(2)" with TTL countdowns. No system logs or latency charts anywhere —
participant view only. --ar 16:9 --style raw
```

### Prompt 3 — Leitura de claims (browser do conteúdo criado)

```
[bloco de estilo] Reading and exploration screen of a collaborative
knowledge-graph tool — a claims browser. Left sidebar: same "CÉLULAS"
tree with "historia:P2" selected. Main area: two-column layout — left
column is a scrollable list of claim cards for the selected cell, each
with title, author avatar + name, timestamp, status badge "Publicado"
in green, and small ref chips linking to other cells
("[mecanicas:P1]", "[mundo:P3]") rendered as clickable violet pills;
right column shows the opened claim in full: rendered text content,
"Referências" section with navigable cards of the referenced claims,
"Referenciado por" reverse-links section, and a muted metadata footer
(committed via cs-3fa1, seq 214). Top of main area: a query bar with
results dropdown showing matched claims AND a distinct amber "gaps"
section listing search terms that matched nothing ("sem resultado:
'combate corpo-a-corpo' — refine o termo"). A subtle violet "Abrir
turno nesta cell" button floats top-right. Calm reading-focused
composition, generous line height. --ar 16:9 --style raw
```

### Prompt 4 — Visão do facilitador (telemetria da sessão, BT-2)

```
[bloco de estilo] Operations dashboard for a live co-creation session,
facilitator-only view of a collaborative graph tool. Header: session
name "beta-20260718", elapsed timer, participant count, tunnel status
pill "túnel ativo" in green. Grid of telemetry panels over the dark
background: line chart "Presença simultânea" over session time; bar
chart "Commits por participante" with avatar-labeled bars; funnel
widget "abrir → claim → commit" with drop-off percentages; stat tiles
"p95 latência 38ms", "reconexões SSE 2", "lock.denied 14" with a
small red trend; a contention heat list "Cells mais disputadas" with
amber bars per cell ("historia:P2", "gameloop:P1"); monospace live
event stream column on the right with colored tool-call entries and
millisecond latencies ("changeset.claim · 12ms · ok"). Small footer
note area with mission checklist progress ("Missão 2/4 · Premissa
definida ✓"). All charts in violet/green/amber on near-black, no
participant-facing creation UI anywhere. --ar 16:9 --style raw
```

---

## 3. Parâmetros técnicos de geração

- **Aspect ratio:** `--ar 16:9` desktop; variação mobile `--ar 9:16` (trocar sidebars por bottom tab bar + sheet modals).
- **Midjourney:** `--style raw --v 6 --q 2`; se degradar pra arte abstrata: `realistic software screenshot::2 abstract art::-1`.
- **DALL-E/Flux/Gemini:** manter âncoras `high-fidelity product screenshot`, `realistic browser chrome` (ou remover chrome pra mock full-bleed), `sharp UI details, 4k`.
- **Tags de reforço:** `UI/UX, tech dashboard, high fidelity, developer tool, dark theme, node cards, figma-style multiplayer, data-dense`.
- **Negative prompt:** `abstract art, sci-fi hologram, HUD gauges, neon cyberpunk clutter, lens flare, glassmorphism heavy blur, english-only labels`.
- **Consistência:** o bloco de estilo comum prefixado é obrigatório em todo prompt — é o que amarra as 4 telas como um sistema. Não trocar violeta por outro acento entre gerações.
- **Correções conhecidas ao iterar** (erros da 1ª rodada de geração): taxonomia de cell é sempre `domínio:nível` (nunca "P1-P2"); cadeado é da CELL, nunca de node solto; telemetria/logs só no Prompt 4 (facilitador), jamais nas telas de participante.
- **Iteração:** 4 sementes por prompt, escolher pela composição estrutural (posição dos painéis), refinar com vary subtle. A imagem é wireframe de referência, não spec final de cor.
