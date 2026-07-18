# UI-5 — Escopo fechado (paridade + gate de retomada do beta)

> Status: **proposto** — último; exige UI-0..4 verdes. **Gate de
> retomada do roadmap-beta-test** (WD5). Índice-pai: `README.md`.
>
> **Objetivo:** provar que a UI nova cobre tudo que a velha cobria
> MAIS os gaps que motivaram a reescrita, com e2e completo — e
> destravar o beta com checklist assinado, não com sensação.

---

## 1. O que sai pronto no final

1. **Checklist de paridade** (neste doc, preenchido com data):
   - Da UI velha: presença/roster/typing, toasts (4 regras
     `maybeToast`), feed, reconnect+reauth sem F5, reattach de turno,
     settings (invisível/notificações), history filtrável, painel de
     nó, open turn multi-cell, draft+claim+commit/abort/extend,
     ghosts, re-bootstrap (botão admin).
   - Gaps fechados (razão da reescrita): `graph.query` com gaps,
     claims browser navegável, typing enviado pela web, nós ricos
     markdown, zoom semântico, cell containers com lock legível.
2. **Suíte e2e completa**: os specs das fases (snapshot-render,
   6 de vivacidade, turn-lifecycle, lock-contention, query-and-read,
   history, semantic-zoom) rodando verdes no CI — cobertura ≥ QA-2
   original.
3. **Mini-sessão de validação real**: dono + 1 cobaia + 1 agente
   Claude Code (plugin), 30 min na LAN, percorrendo warm-up + 1 missão
   do roteiro BT-4 inteiramente na UI nova — fricções viram issues
   com severidade (bloqueante corrige antes do gate; resto é backlog).
4. **Gate de retomada assinado**: seção final deste doc com decisão
   datada do dono — reabre `roadmap-beta-test` (status volta de
   "adiado"; BT-2/BT-3/BT-4 redespacham; BT-1 já está pronto e
   independe da UI).

**Definição de pronto (DoD):**

- [ ] Checklist de paridade 100% marcado (item impossível = decisão
      explícita do dono, não silêncio).
- [ ] CI verde com a suíte completa; nenhum spec da UI velha
      "esquecido" sem equivalente ou dispensa registrada.
- [ ] Ata da mini-sessão em `docs/roadmap-web-ui/relatorios/`.
- [ ] Bloqueantes da mini-sessão corrigidos e re-verificados.
- [ ] **Gate assinado**: nota de retomada no README do
      roadmap-beta-test (remove o aviso de adiamento, com data).

---

## 2. O que NÃO está nesta fase

- ❌ A preparação do beta em si (túnel, telemetria, carga, artefato) —
  é o roadmap-beta-test retomado DEPOIS do gate.
- ❌ Feature nova de UI — paridade + gaps declarados; o resto é
  backlog pós-retomada.
- ❌ Segunda mini-sessão por default — só o bloco que falhou repete
  (mesma regra do BT-5).

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Checklist + varredura de paridade + ajustes | 0.5-1 dia |
| Mini-sessão + ata + correções | 0.5-1 dia |
| **Total** | **1-2 dias** |

---

## 4. Riscos

1. **Paridade revela buraco estrutural tarde** (algo da UI velha não
   mapeia na nova). Mitigação: o checklist acima já é a lista — cada
   fase deveria consultá-lo ao fechar; UI-5 é conferência, não
   descoberta.
2. **Mini-sessão vira beta informal** (escopo cresce no dia).
   Mitigação: 30 min, 1 missão, roteiro BT-4 existente — o resto é o
   beta de verdade, que tem roadmap próprio.
3. **Pressa de retomar o beta pula o gate.** O gate existe porque a
   primeira impressão do produto não se remarca (risco 1 do BT-5);
   assinatura datada é o freio.
