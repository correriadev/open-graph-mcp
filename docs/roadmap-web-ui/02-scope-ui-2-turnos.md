# UI-2 — Escopo fechado (turnos: criar, editar, commitar)

> Status: **proposto** — depois de UI-1. Índice-pai: `README.md`.
>
> **Objetivo:** o coração do produto na UI nova: abrir turno numa
> cell, montar claims num draft vivo, passar no gate, commitar — com
> lock/TTL/contenção visíveis e compreensíveis (o `lock.denied` é o
> momento-verdade do produto; a UI decide se ele parece disputa
> saudável ou erro).

---

## 1. O que sai pronto no final

1. **Abrir turno**: modal com intent + seleção de cells
   (`domínio:nível` — picker alimentado pelo snapshot); `lock.denied`
   renderizado como estado de primeira classe (quem tem, qual cs,
   quando expira, botões "tentar de novo / trocar de cell"), nunca
   como erro genérico.
2. **Draft panel** (turno ativo): intent, timeline de deltas com
   autor/hora, form estruturado de claim (subject, domain, level,
   refs, anchor) + **ref por clique**: com o form aberto, clicar um nó
   no canvas adiciona o id ao campo refs (fatia antecipada da UI-3 —
   dependência apontada pelo conselheiro); raw JSON colapsável como
   escape hatch; ações Commit/Abort/Extend TTL com countdown visível.
3. **Gate-check visível**: recusa de claim/commit renderiza as
   `reasons` do gate (formato real: `roundtrip <kind> @<id>: <detail>`)
   como lista estruturada no painel, apontando pro nó envolvido quando
   houver id.
4. **Ghosts**: deltas não commitados como sub-cards tracejados
   (violeta, norte visual) presos à cell; refetch debounced de
   `graph://changeset/{id}` (porta a lógica velha).
5. **Locks no canvas**: borda âmbar na cell inteira (nunca em nó
   solto — correção registrada no norte visual), badge com holder +
   countdown; `changeset.list_mine` num widget "meus turnos".
6. **Reattach**: reconectou com turno aberto → draft panel volta
   sozinho (lib entrega o evento; UI projeta).

**Definição de pronto (DoD):**

- [ ] **Turno completo ponta a ponta na UI**: open → 3 claims (um via
      ref-por-clique) → commit → nó novo aparece no canvas de OUTRO
      browser conectado.
- [ ] **Contenção legível**: dois browsers disputam a mesma cell —
      o negado vê quem/até quando e consegue re-tentar ao vivo quando
      o lock cai (via evento, sem F5).
- [ ] **Gate-fail legível**: claim com ref inexistente mostra a reason
      estruturada e não perde o texto digitado.
- [ ] **e2e da fase**: `turn-lifecycle.e2e.ts` (open→claim→commit) e
      `lock-contention.e2e.ts` (deny→release→retry) contra o server
      real do harness.
- [ ] CI verde.

---

## 2. O que NÃO está nesta fase

- ❌ `authority.flip` na UI — raw JSON cobre o caso raro; UI dedicada
  só se virar rotina (backlog).
- ❌ Editar/remover claim commitado — não existe no produto (deltas
  são `claim.add`|`authority.flip`); limitação de PRODUTO registrada,
  não contornada na UI.
- ❌ Templates de claim / votação — anti-escopo herdado do BT-4.
- ❌ Claims browser completo — UI-3 (aqui só a fatia ref-por-clique).

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Modal open + estados de lock/denied | 1 dia |
| Draft panel + form + ref-por-clique + ghosts | 1.5 dia |
| Gate-check UI + reattach + widget list_mine | 0.5-1 dia |
| e2e ×2 | 0.5 dia |
| **Total** | **3-4 dias** |

---

## 4. Riscos

1. **Draft local × verdade do server divergem** (claim aceito no
   server, UI perde resposta). Mitigação: draft panel SEMPRE
   re-hidrata de `graph://changeset/{id}` (server é fonte, WD4);
   estado local é só o form não submetido.
2. **Ref-por-clique vira UX confusa** (modo "escolhendo ref" ambíguo).
   Mitigação: modo explícito com highlight do canvas + esc cancela;
   validar com 1 cobaia antes de fechar a fase.
3. **TTL countdown dessincroniza** (clock do cliente ≠ server).
   Mitigação: countdown deriva de `expiresAt` do server renderizado
   contra `Date.now()` — impreciso em segundos é aceitável; extend
   re-busca o valor novo.
