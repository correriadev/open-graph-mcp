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

- [ ] **Tabela do spike preenchida** com data/máquina/versão RF;
      decisão de regime assinada no README se o desejável reprovar.
- [ ] **`src/` velho deletado e ≥1 spec e2e novo no MESMO commit**
      (`e2e/snapshot-render.e2e.ts`: sobe fixture real, vê N nós
      renderizados, pan/zoom altera viewport, painel abre no clique).
      Diretório `e2e/` nunca vazio (WD1).
- [ ] **CI verde**: `tsc --noEmit`, `bun run build`, e2e chromium —
      jobs existentes, sem edição no `ci.yml`.
- [ ] **Zero referência a `api.ts`**; toda chamada via `og.call()`.
- [ ] **Validação real**: server local + `bun run dev:web` → grafo do
      `.graph/` do próprio repo renderiza e navega.

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
