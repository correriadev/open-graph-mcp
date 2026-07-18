# Roadmap-web-ui — índice

> Recriação da web UI **do zero** sobre React Flow: o canvas custom
> atual (`mcp-web/src/render.ts`) renderiza nós como pontos mudos; a
> visão do produto (norte visual em `docs/prompts/ui-concept-generator.md`
> + `assets/prototype/prototype_canvas_v1.png`) exige **nós ricos** —
> cards que renderizam markdown estruturado, metadados, estado de
> turno — sem poluir a tela (zoom semântico). Irmão de `roadmap-mcp/`,
> `roadmap-qa/`, `roadmap-integrations/` e `roadmap-beta-test/`
> (**adiado** até UI-5 verde — ver gate de retomada).

## A tese (ler antes dos escopos)

A UI atual é um espectador com botão de commit: sem busca
(`graph.query` nem existe no `api.ts`), sem leitura de claims
committados, form de delta hardcoded. Numa sessão de co-criação isso
mata a dinâmica — escreve-se, não se lê. A análise de mercado
(Miro/Mural/FigJam/Lucid/Excalidraw) descartou plataformas com engine
colaborativa própria: **o server já é a única verdade** (locks,
changesets, gate, event log); qualquer CRDT de terceiro brigaria com o
modelo de turnos. React Flow é shell de renderização headless: nós são
componentes React arbitrários, edges são relações de dados, estado
externo — o server continua mandando.

"Do zero" aplica-se a `mcp-web/src/`. A infraestrutura sobrevive:
pacote, Vite, harness e2e (QA-2, agnóstico a framework), jobs de CI,
lib `@open-graph-mcp/client` (INT-2/QA-1) e a matemática de
layout/LOD de `graph-core` (`seedLayout`/`lodForZoom`).

## Documentos

| # | Arquivo | Função | Status |
|---|---|---|---|
| 0 | `00-scope-ui-0-spike-fundacao.md` | **Spike de escala (trava tudo)** + shell React+RF, snapshot read-only, layout por cells, CI/e2e nunca vazio. | proposto |
| 1 | `01-scope-ui-1-vivacidade.md` | SSE ao vivo, presença, avatares, typing, toasts, feed, reconnect. | proposto |
| 2 | `02-scope-ui-2-turnos.md` | Abrir turno, draft, form de claim (+ ref por clique), commit/abort/extend, locks com countdown, ghosts, gate-check. | proposto |
| 3 | `03-scope-ui-3-leitura-query.md` | Claims browser, refs navegáveis, `graph.query` com gaps, history. | proposto |
| 4 | `04-scope-ui-4-nos-ricos.md` | Nós markdown, zoom semântico card→chip→dot, cell containers ricos. | proposto |
| 5 | `05-scope-ui-5-paridade-gate.md` | Paridade e2e com a UI velha, checklist, **gate de retomada do beta**. | proposto |
| — | `referencias-dify.md` | Padrões extraídos do editor React Flow do Dify (validações, cópias por fase, anti-padrões). | vivo |

## Decisões (WD)

- **WD1 — Rebuild in-place em `packages/mcp-web`.** Mesmo pacote,
  mesmo Vite, mesmo harness e2e (`e2e/fixture.ts` builda `dist/` real +
  server real — agnóstico ao framework do `src/`), mesmos jobs de CI.
  Pacote novo duplicaria tudo isso e deixaria um morto pra trás.
  `src/` velho morre no primeiro commit da UI-0 — **no mesmo commit**
  entra ≥1 spec e2e novo (o job e2e é blocking por decisão do QA-2;
  Playwright não falha com zero specs, então e2e vazio = gate sem
  dente). *Reabre se:* nunca.
- **WD2 — Stack: React 18 + @xyflow/react 12 + zustand +
  react-markdown.** Zustand só pra estado de UI (câmera, seleção,
  painéis, draft local). Sem UI kit (Tailwind/shadcn fora); CSS
  vanilla/módulos seguindo o norte visual. *Reabre se:* spike UI-0
  reprovar React Flow — fallback documentado no 00.
- **WD3 — `@open-graph-mcp/client` reusado integralmente; `api.ts`
  morre.** Toda tool call roteia por `og.call()` — executa o TODO já
  escrito em `main.ts:308-315` (seam de token duplicado). Nada de SSE/
  reconnect/reauth reimplementado.
- **WD4 — Server permanece autoritativo; layout é apresentação.**
  React Flow renderiza projeção derivada de `graph://snapshot` +
  eventos SSE. Nenhuma mutação fora de `changeset.open→claim→commit`.
  Posições: `seedLayout` + `lodForZoom` de
  `@open-graph-mcp/graph-core/layout` (já existem, puros, testados) —
  o server **não** ganha conceito de x/y. (`loadLayout`/`saveLayout`
  de layout.ts são dead code hoje; persistir layout de usuário só se
  virar demanda real pós-UI-5.)
- **WD5 — Beta adiado; UI-5 é o gate de retomada.** `roadmap-beta-test`
  congelado com nota datada; BT-1 (release.yml, já implementado) não
  se perde — artefato do proxy independe da web UI. BT-4/BT-2
  redespacham depois do gate.

## Sequência de execução

```
SPIKE (escala RF) ══ trava ══► UI-0 (fundação) ──► UI-1 (vivacidade)
                                                        │
                              UI-3 (leitura/query) ◄── UI-2 (turnos)
                                       │
                              UI-4 (nós ricos/zoom)
                                       │
                              UI-5 (paridade + GATE retomada beta)
```

Ordem turnos→leitura mantida com uma ressalva explícita: o form de
claim (UI-2) precisa de refs pra nós existentes — a fatia "clicar nó
no canvas pra adicionar ref" pertence à UI-2; o browser completo de
claims é UI-3. Cada fase termina com CI verde e os e2e da fase
passando — o diretório `e2e/` nunca fica vazio entre fases (WD1).

## Esforço estimado (1 dev, ~50% dedicação)

- Spike: 0.5-1 dia · UI-0: 2-3 dias · UI-1: 2-3 dias · UI-2: 3-4 dias
- UI-3: 2-3 dias · UI-4: 2-3 dias · UI-5: 1-2 dias
- **Total: ~2.5-3.5 semanas**

## Riscos transversais

1. **React Flow não sustenta o requisito de escala documentado**
   (`layout.ts:1-3`: "milhares de nós, custo O(visível)" — hoje
   cumprido por canvas+Quadtree). RF renderiza um elemento DOM por nó;
   `onlyRenderVisibleElements` é opt-in e paga mount/unmount no pan;
   grupos com centenas de filhos recalculam posição em cascata.
   Mitigação: **spike é trava, não fase** — número medido antes da
   primeira linha do shell; reprovou, fallback (tldraw ou híbrido
   canvas-para-dots + RF-para-cards) decidido com dado. Nota de
   escala: a sessão beta usa dezenas-centenas de nós; "milhares" é o
   requisito do explorer de código — o spike mede os DOIS regimes e o
   gate aceita explicitamente qual regime a UI nova promete.
2. **Reescrever 6 specs e2e por fase atrasa cada fase.** Aceito de
   propósito: e2e é onde QA-2 provou que regressão de presença/toast/
   reconnect aparece; fase sem e2e é fase não entregue.
3. **Paridade vira perfeccionismo.** UI-5 tem checklist fechado
   (features da UI velha + gaps que motivaram a reescrita); o que não
   estiver lá é backlog pós-retomada, não bloqueio.

## Pesquisa pré-código (trava UI-0)

1. **Spike de escala React Flow** (detalhe no 00): render de N nós
   {200, 1000, 5000} × cell-groups {6, 30} com `onlyRenderVisibleElements`,
   medir FPS de pan/zoom e custo de mount. Critério de aceite no 00.
2. **Compatibilidade do norte visual com nós-grupo RF**: os cell
   containers do conceito (cards agrupando claims por `domínio:nível`)
   mapeiam pra subflows RF ou pra nós custom com layout próprio?
   Decidir no spike com protótipo descartável.
