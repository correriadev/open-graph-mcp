# UI-0 — Escopo fechado (spike de escala + fundação)

> Status: **proposto** — primeiro; o spike trava o roadmap inteiro.
> Índice-pai: `README.md`.
>
> **Objetivo:** provar com número que React Flow aguenta o grafo real
> ANTES de comprometer 5 fases; depois, o shell mínimo: app React
> renderizando o snapshot read-only com a matemática de layout que já
> existe. `src/` velho morre aqui — com e2e novo no mesmo commit (WD1).

---

## 1. O que sai pronto no final

### Parte A — Spike (descartável, trava)

1. Protótipo descartável (`packages/mcp-web/spike-rf/`, fora do build):
   React Flow 12 renderizando grafos sintéticos N ∈ {200, 1000, 5000}
   nós × grupos {6, 30}, com `onlyRenderVisibleElements` on/off.
2. Medições registradas no próprio doc (tabela com data + máquina):
   FPS de pan/zoom contínuo, tempo de mount inicial, custo de
   drag de grupo com muitos filhos.
3. **Critério de aceite** (decide o roadmap):
   - Regime sessão (≤500 nós, 6 grupos): pan/zoom ≥ 50 FPS — obrigatório.
   - Regime explorer (5000 nós): pan ≥ 30 FPS com culling — desejável;
     reprovou, o gate registra explicitamente "UI nova promete regime
     sessão; explorer de milhares fica no canvas legado ou híbrido" —
     decisão do dono, datada, no README (WD2 *reabre*).

   **RESULTADO (2026-07-18, chromium headless 149 via playwright,
   @xyflow/react 12.11.2, linux x64 8-core — números comparativos;
   protótipo em `packages/mcp-web/spike-rf/`, `bun spike-rf/measure.ts`):**

   | nós | grupos | culling | FPS pan/zoom (5s contínuos) |
   |---|---|---|---|
   | 200 | 6 | on | 60 |
   | 500 | 6 | on | 59 |
   | 1000 | 6 | on | 53 |
   | 1000 | 6 | off | 54 |
   | 5000 | 6 | on | 40 |
   | 5000 | 30 | on | 49 |
   | 5000 | 6 | off | **15** |

   **GATE: APROVADO nos dois regimes.** Obrigatório: 59-60 FPS ≥ 50 ✅.
   Desejável: 40-49 FPS ≥ 30 ✅. Conclusões vinculantes:
   (a) `onlyRenderVisibleElements` é OBRIGATÓRIO — sem ele, 5000 nós
   caem pra 15 FPS; (b) grupos menores/mais numerosos MELHORAM perf
   (49 vs 40 em 5000 nós — culling por grupo mais efetivo); (c) cards
   ricos (nó com chip+corpo+badge) e cell-groups (`parentId` +
   `extent:"parent"`) funcionam — pesquisa #2 respondida: **subflow
   RF nativo**, não nó custom com layout interno.
4. Resposta da pesquisa #2: cell containers = subflow RF ou nó custom
   com layout interno próprio (testado no spike, registrado).

### Parte B — Fundação

1. `packages/mcp-web/src/` novo: React 18 + @xyflow/react + zustand.
   Vite/tsconfig/e2e harness/CI intocados (WD1).
2. Snapshot read-only: `graph://snapshot` via `@open-graph-mcp/client`
   (`og.call()` desde o dia 1 — `api.ts` não renasce, WD3), nós
   posicionados por `seedLayout` e LOD básico por `lodForZoom`
   (`@open-graph-mcp/graph-core/layout`) — card simples por nó
   (título + domínio + badge de authority), edges `depends-on`/`refs`.
3. Pan/zoom/fit, seleção de nó com painel lateral básico (id,
   responsibility, anchor, authority — paridade com o painel velho).
4. Identidade: campo de nome + register + token persistido
   (localStorage via `tokenStore` da lib, como hoje).

**Definição de pronto (DoD):**

- [x] **Tabela do spike preenchida** com data/máquina/versão RF;
      desejável aprovou — sem decisão de regime pendente.
- [x] **`src/` velho deletado e ≥1 spec e2e novo no MESMO commit**
      (`e2e/snapshot-render.e2e.ts`: sobe fixture real, vê N nós
      renderizados, pan/zoom altera viewport, painel abre no clique,
      LOD atinge "tower" — pega o `minZoom` default do RF (0.5) que
      tornaria o tower inatingível). Diretório `e2e/` nunca vazio (WD1).
- [x] **CI verde**: `tsc --noEmit`, `bun run build`, e2e chromium —
      jobs existentes, sem edição no `ci.yml`. (O tsc de CI falhava em
      main por resolver o client via `dist/` nunca buildado; corrigido
      com `paths` no tsconfig espelhando o alias do vite — 2026-07-18.)
- [x] **Zero referência a `api.ts`**; toda chamada via `og.call()`.
- [x] **Validação real** (2026-07-18): server local + preview → grafo do
      `.graph/` do próprio repo (177 nós) renderiza, navega e cruza LOD.

---

## 2. O que NÃO está nesta fase

- ❌ SSE/eventos ao vivo — UI-1 (aqui só snapshot no load).
- ❌ Qualquer mutação (turnos) — UI-2.
- ❌ Markdown nos nós / zoom semântico completo — UI-4 (aqui só LOD
  básico de esconder labels).
- ❌ Estética final do norte visual — estrutura primeiro; polish
  contínuo até UI-5.
- ❌ Persistir posições de layout — WD4; `seedLayout` determinístico.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Spike + medições + decisão | 0.5-1 dia |
| Shell React + snapshot + layout reusado | 1-1.5 dia |
| Painel de nó + identidade + e2e novo | 0.5-1 dia |
| **Total** | **2-3 dias** (+ spike) |

---

## 4. Riscos

1. **Spike reprova o regime sessão** (≤500 nós < 50 FPS). Improvável
   (RF sustenta apps maiores), mas se ocorrer: tldraw é o fallback
   avaliado na análise de mercado; decisão do dono antes de qualquer
   linha da Parte B.
2. **`seedLayout` produz layout ruim pra cards grandes** (foi
   calibrado pra pontos). Mitigação: é função pura — ajustar espaçamento
   por parâmetro na UI, sem tocar graph-core; se precisar de mudança
   estrutural, vira PR separado em graph-core com teste próprio.
3. **Tentação de "só mais um feature" na fundação.** Anti-escopo
   explícito acima; fase seguinte existe pra isso.
