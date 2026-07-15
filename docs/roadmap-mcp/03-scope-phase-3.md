# Fase 3 — Escopo fechado (presença + notificação)

> Status: **escopo p/ execução** — após Fase 2 verde.
> ADR-pai: `docs/roadmap-mcp/ADR.md`. Anteriores: `01-scope-phase-1.md`,
> `02-scope-phase-2.md`.
>
> **Objetivo da Fase 3:** adicionar presença viva ("quem está onde, fazendo o
> que") e roteamento de notificação por afinidade. Transforma o servidor de
> "múltiplos usuários editam isolados em paralelo" para "cada um sente os
> outros em tempo real". É onde a metáfora de jogo se completa.

---

## 1. O que sai pronto no final da Fase 3

1. **Presença live**: o servidor sabe quem está conectado, em qual cell está
   focado, qual changeset tem aberto (se algum).
2. **Broadcast heartbeat**: cada cliente envia ping a cada N segundos; server
   expira usuários silenciosos.
3. **Roteamento por afinidade** completo (subscription affinity) — eventos
   só vão pra quem importam; não inunda todos.
4. **Cliente web mostra presença**: na topbar ("3 usuários conectados"),
   em cada cell ("Alice focando, Bob tem turno"), no side panel de um cs
   aberto (lista de participantes observando).
5. **Notificação para dispositivos sem canvas** (opencode e companhia):
   eventos prioritários viram "system messages" no cliente MCP.

**Definição de pronto (DoD):**

- [ ] `presence.join` (`POST /mcp` tool call) registra a chegada de uma
      session. Retorna lista de presentes.
- [ ] `presence.focus(cell)` declara focus numa cell. Broadcast
      `user.focused` p/ quem observa aquela cell.
- [ ] `presence.leave` (ou detecção de heartbeat morto) → broadcast
      `user.left` p/ quem estava vendo.
- [ ] Heartbeat: cliente envia ping a cada 15s; ausência de ping p/ 60s =
      expiração implícita.
- [ ] Subscription affinity completa:
  - Foco em cell X → recebe tudo de X.
  - Observador de cs_id Y → recebe tudo de Y (mesmo que não holder).
  - Admin de grafo → recebe todos `authority.flipped` & `drift`.
- [ ] Cliente web mostra (visualmente) quem está em cada cell.
- [ ] Cliente MCP não-web (opencode) recebe system messages p/ eventos
      relevantes (de changeset seu abortado por TTL, p ex).
- [ ] Agregação de "digitando" por janela 500ms (NÃO por keystroke) —_VER §5.
- [ ] Performance: 50 usuários simultâneos conectados, 10 abrindo turno
      concorrentemente, todos recebem seus eventos < 500ms (85% < 250ms).

---

## 2. O que NÃO está na Fase 3

- ❌ Lock otimista (rebase de cs) — Fase 4.
- ❌ Permissões/authz granular (admin pode, editor pode, observer não pode)
  — D2: single-org trust. Em Fase 3 todos podem tudo (ainda). Authz é
  Fase 4.
- ❌ Mudanças no watch/drift (segue como na Fase 2, D7 revisado: opcional
  via `WATCH_REPO_PATH`; Fase 3 não mexe nele).
- ❌ "digitando-character-level" (cada caractere vira evento) — custoso
  demais. "Digitando" agregado por janela é o que v1 entrega.
- ❌ Notificações push (p/ browsers fechados, e-mail, etc) — cena de produto
  desktop-aaS futuro, fora de v1.

---

## 3. Modelo de presença

### 3.1 Estado

Presença é **em memória** — não persistente. Restart do server = esquece
todos. Sessions se reidentificam via token (de Fase 2) e re-declaram
presence.

```ts
type Presence = {
  sessionId: string          // FK p/ sessions.token-resolved
  userId: string
  agentKind: string          // 'web' | 'opencode' | 'cursor' | ...
  lastSeen: number          // high-resolution ms
  focusCell: string | null  // cell atualmente focada
  openCsIds: string[]       // changesets este session tem aberto
  // OBSERVAÇÕES:
  //  - em Fase 3, cada session tem UM usuário; multi-janela = sessions
  //    separadas (decisão de ponytail — abaixo)
  //  - openCsIds é derivado do SQLite (changesets where opened_by=user AND
  //    status='open'); não é separado. Mantemos só em memória p/ lookup
  //    rápido.
}
```

### 3.2 Por que em memória (não SQLite)

- Presença é efêmera. Persistir cria estado sujo todo restart.
- SQLite consulta `sessions` + `changesets` é suficiente p/ reconstruir o
  essencial. Presença viva completa não precisa de disco.
- PostgreSQL teria `LISTEN/NOTIFY` p/ isto; SQLite não tem. Mas não justifica
  migrating — affinity router in-mem é suficiente p/ 50 usuários na Fase 3.

### 3.3 Por que uma session uma janela

Multi-janela no mesmo browser = duas abas = dois SSE connections = dois
sessions. Justificativa:

- Se uma janela fecha, a outra não deve herdar módos estranhos.
- SSE é 1:1; separar é mais simples.
- Cliente web pode identificar via `sessionStorage` (não `localStorage`)
  para ter tokens distintos por aba.

Se no futuro precisar de "uma conta, múltiplas abas compartilham turnos",
pode ser Fase 4+ — recurso, não núcleo.

---

## 4. API nova (tools)

Em cima dos de Fase 2:

| Tool | Input | Output | Descrição |
|---|---|---|---|
| `presence.who` | `{ cell?: string, cs_id?: string }` | `{ users: [{id, name, agentKind, focusCell, openCount}] }` | Lista quem está presente. Filtrável. |
| `presence.focus` | `{ cell?: string, cs_id?: string }` | `{ ok }` | Declara focus cell atual (broadcast `user.focused`). Null limpa focus. |
| `presence.beat` | `{}` | `{ ok, serverTs }` | Heartbeat. |

Heartbeats são baratos. Pode ser chamada por cliente a cada 15s sem
sobrecarregar.

---

## 5. "Digitando" — sem TRACK POR KEYSTROKE

Esta é a maior pegadinha de multiplayer. Você não quer N eventos por segundo
por usuário; você quer um signal agregado.

### 5.1 Mecânica

- Cada call de `changeset.claim` atualiza um `lastDeltaAt` no Presence
  (in-mem).
- Server-side fiber a cada 500ms varre Presence:
  - se `now - lastDeltaAt < 2s` → estado `typing`.
  - se entre 2-5s → `idle`.
  - se > 5s → `quiet` (default).
- Broadcast `user.typing_state` somente em TRANSIÇÃO (typing → idle, idle →
  quiet, etc.). Não a cada tick — só quando muda.

### 5.2 Por que isto é suficiente

- O "digitando" serve para **comunicar intenção social** ("Alice está
  fazendo algo, vou esperar"): 500ms de latência é imperceptível p/ isto.
- Implementação simples: uma métrica em memória + uma varredura por tick.
  Sem debounce de cliente.
- Custo de rede: na maioria dos casos, ZERO mensagens por segundo; quando
  todos estão typing, alguns `typing_state` events a cada ~1s.

### 5.3 Risco aceito

- Se alice add 100 deltas duma vez (script), "typing" fica acessa por 2s
  apos o último. Aceitável — comunica "alguém está editando", não "alguém
  está escrevendo caractere". Compatível com a metáfora de jogo.

---

## 6. Roteamento de notificação (affinity)

Atualizado de Fase 2 (que era simples: broadcast p/ quem observa cell).

### 6.1 Regras detalhadas

Para cada event emitido, o router calcula **quem recebe**:

| Event | Recebe quem |
|---|---|
| `changeset.opened` | observadores da cell + admins |
| `changeset.delta` | observadores da cell + observadores do cs_id + holder |
| `changeset.committed` | observadores da cell + observadores do cs_id + todos com focus na cell (mesmo não-inscritos) |
| `changeset.aborted` | observadores do cs_id + holder (se diferente) |
| `lock.acquired` | observadores da cell |
| `lock.denied` | só o user que tentou (não broadcast) |
| `lock.released` | observadores da cell |
| `authority.flipped` | todos conectados (sempre broadcast) |
| `user.focused` | observadores com focus na mesma cell |
| `user.left` | observadores com focus na mesma cell + observadores de cs do qual participavam |
| `user.typing_state` | observadores da cell que o user tem focus |
| `user.joined` | todos com focus em qualquer cell (broadcast geral p/ contagem da topbar atualizar) |

### 6.2 Subscription modes

Cliente pode explicitamente:

- `graph.subscribe(filter)` — recebe tudo respectivo ao filtro.
- `presence.subscribe(filter)` — recebe só events de presença.

Em Fase 3 vamos consolidar tudo num único stream (SSE), com filtros
combináveis. Cliente escolhe o que filtra (corte de servidor) eventualmente.

### 6.3 Política anti-spam

Broadcasts de `user.focused`/`user.left`/`user.joined` podem ficar barulhentos
se 50 usuários alternam cells. Mitigação:

- Server-side debounce por user: se um user alterna cells 3x em < 2s, só o
  último broadcast. Rejeita os intermediarios.
- "Focus" real só conta se ficar > 2s. Rápido clique/scroll não conta.

---

## 7. Cliente web — novas peças UI

### 7.1 Presence bar (topbar)

Width fixa (~250px). Mostra:

```
┌─ Conectados (5) ─────────┐
│ ● Alice (web)            │
│   focando [ui:4]         │
│   turno cs_abc (ui:4)    │
│                          │
│ ● Bob (opencode)         │
│   idle                   │
│                          │
│ ● Charlie (web)          │
│   observando cs_def      │
│                          │
│ ...
└──────────────────────────┘
```

Botão expand mostra todos. Dot verde = active (heartbeat < 30s); amarelo =
idle 30-60s; cinza = >60s (vai cair a qualquer momento).

### 7.2 Avatar overlay no canvas

- Cell LOCKED pelo user X → badge da cell mostra avatar de X (mini circular).
- User focando cell Y (sem turno) → avatar menor, semi-transparente perto
  da cell.
- Hover sobre o avatar → tooltip com nome + agentKind + lastDeltaAt.

### 7.3 Indicator "digitando"

- Holder do cs_id com estado `typing` → no canto inferior do canvas: "alice
  está editando cs_abc…" com animação typing dots (três pontos que pulam).
- Em transições typing → idle, o indicator some.

### 7.4 Notificações para o usuário atual

- Toast notifications bottom-right p/ eventos relevantes ao user atual:
  - "cs_abc abortado por TTL"
  - "Bob abriu turno em [ui:4] — você perdeu prioridade"
  - "Alice commitou cs_def em [ui:3]"
- Hover mostra timestamp. Click → canvas jump p/ alvo relevante.
- 10 últimas notificações; mais antigas são descartadas.

### 7.5 Settings (mínimo)

Modal:

- Checkbox "Mostrar minha presença para outros" (default on; permite
  "invisible mode").
- Checkbox "Receber notificações de commit em cells que observo" (default on).
- Sem mais nada — sem gradient settings, sem tema. Ponytail.

---

## 8. Cliente MCP não-web (ex: opencode)

Clientes sem canvas precisam de uma rota p/ receber o state de presença e as
notificações. Sem canvas, isto é texto.

### 8.1 System messages

Quando servidor considera evento relevante p/ uma session, pode emitir
"suggestion" via MCP `notifications`. Formato:

```
[open-graph] Bob abriu turno em [ui:4]. Sua edição concorrente pode
depender de mudanças dele — considere esperar ou focar outra cell.
```

Cliente (opencode) pode apresentar como system message na sessão do user.
Não é prompt — não injects prompt. É notification p/ humano decidir.

### 8.2 Query presets via tools:

- `presence.who` → recebe lista JSON; o agente no opencode pode formatar
  como tabela Markdown p/ usuario ver no chat.
- `graph.history?since=X` → mesma rota Fase 2.

Cliente MCP não-web trata estado de presença como "lookup no agente", não
como ambient UI. Decisão assumida: **não há equivalente visual** p/
canvas; presença fica explícita via system messages.

---

## 9. Edge cases

### 9.1 Server restart

- Presence em memória se vai. Usuários reconectam (reauth via token de
  sessão, mesmo processo de Fase 2).
- Server emite `server.restarted` broadcast no boot; clientes checam seus
  changesets abertos via `changeset.list_mine` p/ saber onde estão.
- Não há "auto-refocus" — se user estava focando [ui:4] e servidor voltou,
  o cliente tem que declarar `presence.focus` denovo. Pode ser implícito
  no cliente (redeclara foco após reconexão). Simples.

### 9.2 Network drops no meio de um turno

- SSE cai durante 30s: heartbeat falha; server expira a Presence, mas
  changeset fica aberto (lock ainda tem 30min TTL).
- Cliente reabre SSE → server vê token → resolve session_id → permite
  reattach (igual Fase 2 §9).
- Nenhum delta foi perdido (todos já estavam no SQLite via cs_deltas).

### 9.3 Ghosts conflitantes de dois holders

- A tem cs_abc com focus em [ui:4].
- B tem cs_def com focus em [ui:4] (impossível p/ β, mas possível p/
  observers-only em uma cell sem lock — ver abaixo).
- **Decisão D8 (minha):** em Fase 3, server permite múltiplos observers em
  uma mesma cell sem nenhum ter turno (sem cs abert — só focus para visualização).
  Se múltiplos holders tentam abrir turno → já coberto pelo lock (Fase 2,
  pessimista).

### 9.4 "Stalker mode"

- Alguém só focando cells mas nunca editando; pode ser chato.
- Mitigação: "invisible mode" (setting do cliente); se todos fazem, ninguém
  mais vê ninguém. OK.
- Server não tem `presence.who` privado — se está visível, qualquer
  observador da cell vê você.  Aceitável.

---

## 10. Testes de aceite (Fase 3)

1. **join-and-leave.test.ts**: 5 sessions abrem; quem focus em [ui:4] recebe
   `user.focused` dos outros; saem → broadcast `user.left`.
2. **heartbeat-expire.test.ts**: uma session para de pingar; em 60s, expira;
   broadcast `user.left` emitido com `reason: "heartbeat_expired"`.
3. **typing-network-aggregation.test.ts**: user A dá 100 lances de
   `changeset.claim` em 500ms; assina `typing_state` emite uma transição
   `quiet → typing` no início e **nenhuma** entre os 100 lances.
4. **affinity-router.test.ts**: specifica filtros p/ três sessions (S1
   focusa [ui:4], S2 focusa [domain:__], S3 não focusa). Emite 5 events de
   kinds distintos; assertão exata de quem recebeu o quê.
5. **lock-denied-private.test.ts**: S1 tem lock em [ui:4]; S2 tenta abrir
   turno → `lock.denied` enviado SÓ a S2; assina que S1 e S3 não receberam.
6. **broadcast-authority-broad.test.ts**: authority.flipped emitido → TODAS
   as 5 sessions recebem, independente de focus/subscription.
7. **toast-notifications.test.ts** (e2e web): S1 faz commit; S2 tem toast
   "S1 commitou cs_X em cell Y". Clica toast → canvas jump p/ a cell.
8. **invisible-mode.test.ts**: S1 marca `invisible=true`; S2 não recebe
   `user.focused` de S1; S1 não aparece em `presence.who`.
9. **reconnect-after-restart.test.ts**: derrubar server; reabrir; assina
   que S1 declara focus de novo (explicit) e recebe usuarios
   reconectados.

---

## 11. Esforço estimado

| Item | Estimativa |
|---|---|
| Presence model + heartbeat fiber | 2 dias |
| Subscription affinity router (substitui Fase 2 simples) | 2-3 dias |
| "Typing" detection (in-mem metrics + fiber) | 1-2 dias |
| Tools `presence.who/focus/beat` | 1 dia |
| Event routing (atualização broadcaster) | 2 dias |
| Cliente web: presence bar, avatar overlay, typing indicator, toast notifications, invisible mode setting | 4-5 dias |
| System messages MCP (p/ clientes não-web) | 1-2 dias |
| Script de load test (50 sessions simuladas; valida DoD de latência <500ms/85%<250ms) | 1 dia |
| Testes (9 scripts) | 2-3 dias |
| **Total** | **4-5 semanas** (1 dev, ~50% dedicação) |

---

## 12. Riscos e travas

1. **Heartbeat can bombard.** 50 users pingando a cada 15s = 200 req/min.
   Isto é brincadeira p/ Bun em localhost. Sem preocupação real.
2. **Affinity router tem bugs.** Roteamento errado = ou notificação
   fantasma (usuário recebeu o que não devia) ou invisível (não recebeu o
   que devia). Travas:
   - Filtros são **mathematicamente composicionais** (OR no mesmo filtro,
     AND entre filtros), não exception-driven.
   - Suite de unit tests p/ affinity router isolado (sem SSE, puro lógico).
3. **"Typing" indicator pode lag.** Se user para de digitar mas o fiber está
   em janela de 2s antes de transição, indicação fica acessa mais de 2s
   depois do último keystroke. Aceitável (recebe importância social, não
   precisa ser preciso).
4. **Toast notifications acumulam.** Usuário recebe 30 notificações em 10s;
   canvas fica ruim de ver. Travas:
   - Coalescência: p/ mesma origem (cs_id), janela 500ms → agrupa numa só
     toast "X eventos em cs_abc".
   - Máximo 5 toasts na tela; mais = fica em contador "(+12)".
5. **Sem authz granular, qualquer um pode ver presença.** "Stalker" e
   "invisible mode" cobrem o lado humano. Em Fase 4 com permissões, refine.
6. **Server restart perde presence toda.** Todos tem que redeclarar focus.
   Isto é proposital (estado efêmero), mas **UX precisa guiar isto**:
   quando `server.restarted` vem, cliente mostra toast "Server reiniciou —
   sua presença foi resetada". Click → reabre settings de focus antigo.

---

## 13. Perguntas p/ você (específicas desta fase)

1. **"Typing" aggregation window 500ms** OK ou prefere 1s/250ms? Pessoas
   com alto tráfego podem preferir maior; pessoal artísticos menor.
   **Minha proposta: 500ms default; configurar server-side.**
2. **Múltiplos observadores de uma cell** sem lock (D8): OK p/ você, ou
   prefere limitar a 1 observador por cell em Fase 3 (mais restritivo)?
   Minha proposta: mantém D8 como decidido: múltiplos observers OK, lock
   pessimista só p/ mutantes (Fase 2).
3. **Toast notifications no cliente web**: clique no toast → jump canvas
   p/ alvo. OK? Ou prefere só dismiss, sem jump? Jump reforça conexão
   notificação/evento.

---

## 14. Resumo executivo

**Fase 3 entrega:** presença live + roteamento de eventos por afinidade +
"digitando" agregado + notificações p/ clientes web (toasts) e não-web
(system messages) + invisible mode.

**Fase 3 NÃO entrega:** authz granular, push externo (e-mail/desktop),
typing carácter-level, notificações filtráveis por usuário individual.

**Risco principal:** affinity router é a peça sutil; tudo o mais é
composição. Estimativa 4-5 sem p/ 1 dev ~50%.

---

## 15. Próximo documento

Após Fase 3 verde:

- `04-scope-phase-4.md` — alfa multiplayer completo: lock otimista p/ α,
  rebase de changeset, permissions, validação watch multi-dev, federação
  self-hosted sandbox.