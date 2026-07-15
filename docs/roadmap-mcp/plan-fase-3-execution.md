# Plano de execução — fechamento Fase 2 + Fase 3

> Fonte: `03-scope-phase-3.md` + gap da Fase 2 (authority.flip).
> Execução: subagent-driven, 1 task por vez, review de spec + qualidade após cada.

## Task 1 — authority.flip (fecha Fase 2)
- Tool `authority.flip` via changeset: flip de autoridade de uma cell (code-authoritative ↔ graph-authoritative), registrado como evento `authority.flipped` no history/JSONL.
- `authority.flipped` é broadcast para TODOS os conectados (regra §6.1 Fase 3).
- Teste: flip via tool → evento no history, broadcast recebido por todas as sessions.
- Arquivos: `packages/mcp-server/src/tools/` (novo tool), `state.ts`/`store.ts`, teste em `packages/mcp-server/test/`.

## Task 2 — Presence model + heartbeat + tools
- Estado in-memory (`Presence`: sessionId, userId, agentKind, lastSeen, focusCell, openCsIds, invisible, lastDeltaAt). Não persiste.
- Tools: `presence.who {cell?, cs_id?}`, `presence.focus {cell?|null}`, `presence.beat {}`.
- Sweeper: sem beat por 60s → expira → `user.left` com `reason:"heartbeat_expired"`.
- Events: `user.joined` (broadcast geral), `user.focused`, `user.left`.
- Invisible mode: flag por session; invisível não aparece em `presence.who` nem emite `user.focused`.
- Debounce focus: só conta focus > 2s; troca 3x em <2s → só o último broadcast.
- Testes: join-and-leave, heartbeat-expire, invisible-mode.

## Task 3 — Affinity router + typing aggregation
- Router substitui broadcast simples; tabela §6.1 do scope (quem recebe cada event kind). Filtros composicionais (OR dentro, AND entre), unit-testável puro (sem SSE).
- `lock.denied` → SÓ quem tentou.
- `authority.flipped` → todos.
- Typing: `changeset.claim` atualiza `lastDeltaAt`; fiber 500ms classifica typing (<2s) / idle (2-5s) / quiet (>5s); broadcast `user.typing_state` SÓ em transição.
- Testes: affinity-router, lock-denied-private, broadcast-authority-broad, typing-network-aggregation.

## Task 4 — Cliente web (presence UI)
- Presence bar topbar (~250px): lista conectados, dot verde/amarelo/cinza por lastSeen.
- Avatar overlay no canvas: badge na cell locked; avatar semi-transparente p/ focus sem turno; tooltip hover.
- Typing indicator: "X está editando cs_Y…" com dots.
- Toasts bottom-right: coalescência por cs_id em 500ms, máx 5 na tela (+contador), click → canvas jump, 10 últimas.
- Settings modal: checkbox invisible mode + checkbox notificações de commit. Nada mais.
- Toast em `server.restarted`: "Server reiniciou — sua presença foi resetada".

## Task 5 — System messages MCP + restart + load test
- Eventos relevantes p/ session não-web → MCP notifications (system message texto).
- `server.restarted` broadcast no boot.
- Teste reconnect-after-restart.
- Script de load test: 50 sessions, 10 turnos concorrentes, latência <500ms (85% <250ms).

## Ordem
T1 → T2 → T3 → T4 → T5. Branch: `fase-3`.
