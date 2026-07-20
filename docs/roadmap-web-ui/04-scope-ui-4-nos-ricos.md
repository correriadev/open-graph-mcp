# UI-4 — Escopo fechado (nós ricos + zoom semântico)

> Status: **concluído** — depois de UI-3. Índice-pai: `README.md`.
>
> **Objetivo:** a razão estética da reescrita: nós deixam de ser
> cards básicos e viram entidades que renderizam o próprio conteúdo
> (markdown estruturado, metadados vivos) SEM poluir — zoom semântico
> decide quanto conteúdo aparece. Referências: protótipo v1
> (`assets/prototype/prototype_canvas_v1.png`, nó `ADR.md`) e norte
> visual (`docs/prompts/ui-concept-generator.md`).

---

## 1. O que sai pronto no final

1. **Nó markdown**: claim/nó com corpo em markdown renderiza nativo
   no card (react-markdown, WD2) — títulos, listas, tabelas; sem
   iframe, sem sanitização caseira (rehype-sanitize default).
2. **Zoom semântico (3 regimes, herdando `lodForZoom`)**:
   card completo (zoom alto) → chip título+status+avatares (médio) →
   dot colorido por domínio (baixo). Transição por thresholds do
   `lodForZoom` recalibrados pra cards; SEM re-mount (mesmo nó, render
   condicional) — o custo medido no spike UI-0 vale aqui.
3. **Cell containers ricos**: o agrupamento `domínio:nível` vira
   container visual (conforme decisão do spike: subflow RF ou nó
   custom) com header (nome da cell, contagem, lock/countdown,
   avatares de quem está lá) — o lock âmbar da cell mora aqui.
4. **Estados visuais completos do norte visual**: Publicado (verde) /
   Em revisão-turno aberto (âmbar) / Rascunho-ghost (violeta
   tracejado) / drift/suspended (marcador próprio) — legenda acessível.
5. **Minimapa** (RF `<MiniMap>`) e polish de densidade (espaçamento
   `seedLayout` calibrado pra cards — risco 2 do UI-0 paga aqui).

**Definição de pronto (DoD):**

- [x] **Nó ADR-like renderiza** markdown com seções/listas legíveis
      no card, e degrada pra chip/dot nos regimes de zoom.
- [x] **60/50 FPS de pan mantidos** no regime sessão com nós ricos
      (re-medição do spike com conteúdo real; número na tabela do 00).
- [x] **Cell container** exibe lock/countdown/presença e é o alvo de
      clique para "abrir turno aqui".
- [x] **e2e da fase**: `semantic-zoom.e2e.ts` (3 regimes visíveis) e
      atualização de `snapshot-render.e2e.ts` pros cards ricos.
- [x] CI verde.

---

## 2. O que NÃO está nesta fase

- ❌ Nós interativos com estado próprio (mini-apps, inputs vivos no
  card estilo FigJam widget) — leitura rica sim, aplicação embutida
  não; backlog pós-retomada.
- ❌ Design tokens ativos / nó de imagem (protótipo mostra; produto
  não tem esses tipos de claim hoje) — quando o produto tiver tipo de
  conteúdo, a UI acompanha.
- ❌ Layout manual persistido — WD4.
- ❌ Tema claro — dark-first (norte visual); light é backlog.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Nó markdown + estados visuais | 1 dia |
| Zoom semântico 3 regimes sem re-mount | 0.5-1 dia |
| Cell containers ricos + minimapa + calibração | 0.5-1 dia |
| e2e + re-medição de FPS | 0.5 dia |
| **Total** | **2-3 dias** |

---

## 4. Riscos

1. **Markdown arbitrário quebra o layout do card** (tabela larga,
   imagem gigante). Mitigação: card com max-height + overflow interno
   e "expandir" abre painel de leitura (UI-3) — canvas nunca rola
   horizontal por causa de conteúdo.
2. **FPS degrada com cards ricos** (o spike mediu cards simples).
   Mitigação: DoD re-mede; regime chip vira default mais cedo
   (threshold é parâmetro, não arquitetura).
3. **Zoom semântico esconde informação que o usuário procurava**
   (sumiu o card, virou dot). Mitigação: busca/seleção força card da
   seleção visível independente do regime (pin temporário).
