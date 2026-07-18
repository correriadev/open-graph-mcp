# UI-1 — Escopo fechado (vivacidade: SSE, presença, notificações)

> Status: **proposto** — depois de UI-0. Índice-pai: `README.md`.
>
> **Objetivo:** a tela sai de foto pra transmissão: eventos SSE
> atualizam o canvas ao vivo, presença multiplayer (avatares, roster,
> typing), toasts e feed de atividade. Tudo em cima do que
> `@open-graph-mcp/client` já entrega (connect/reconnect/reauth/
> presence — WD3); esta fase é projeção React desses eventos, não
> transporte novo.

---

## 1. O que sai pronto no final

1. **Eventos ao vivo**: `og.on("*")` → zustand → React Flow.
   `changeset.*`/`lock.*` atualizam badges/bordas dos nós;
   `graph.rebuilt`/`bootstrapped` recarregam snapshot; `drift.*` e
   `authority.*` marcam nós; seq visível no topbar (mono).
2. **Presença**: roster lateral (avatar, nome, `agentKind` com glyph
   distinto pra agente, linha de atividade, dot de status por
   `lastSeen`), avatares flutuando junto à cell focada no canvas,
   indicador "digitando…". `presence.focus` disparado ao selecionar
   nó/cell (paridade com UI velha) + ~~**typing enviado pela web**~~
   (assimetria da UI velha corrigida — web só exibia).

   > **ADIADO PRA UI-2 (2026-07-18, pendente ratificação do dono):**
   > "typing enviado pela web" é tecnicamente impossível dentro das
   > restrições desta fase: o ÚNICO caminho server que alimenta
   > `user.typing_state` é `changeset.claim` → `touchDelta`
   > (`tools/typing.ts`; call site único em `tools/changeset.ts`), e
   > esta fase proíbe mutação web (UI-2) e "não transporte novo".
   > O envio nasce em UI-2 junto com os claims. O spec
   > `typing-indicator` desta fase cobre RECEPÇÃO apenas (typist
   > dirigido por API autenticada no e2e).
3. **Toasts** (paridade com `maybeToast` velho): perdeu prioridade em
   cell focada, commit de terceiro em cell observada, abort por TTL,
   sessão renovada pós-restart. Clique centra o alvo no canvas.
4. **Feed "Atividade recente"**: eventos em monospace com cor por
   tipo (norte visual), clique navega ao alvo.
5. **Settings**: modo invisível + notificações de commit
   (sessionStorage, como hoje).
6. **Reconnect/reauth**: nada a implementar no transporte (lib cuida);
   a fase entrega a UI disso — pill de conexão, re-render pós-reattach.

**Definição de pronto (DoD):**

- [x] **e2e reescritos desta fase** (2026-07-18): presence-bar,
      typing-indicator, toast-notifications, avatar-overlay,
      settings-invisible, reconnect — os 6 specs QA-2 equivalentes na
      UI nova. Mesmos cenários com DUAS adaptações registradas:
      (a) turnos dirigidos pela API autenticada (token do próprio user
      web, `e2e/driver.ts`) — o modal de turno só nasce em UI-2;
      (b) typing é recepção apenas (nota datada na §1.2 acima).
      Avatares viraram DOM (ViewportPortal) — asserts diretos, sem
      hooks de canvas (`avatarScreenPos`/`getCamera` mortos).
- [x] **Dois browsers lado a lado**: cada spec roda dois
      BrowserContexts reais contra server real — presença, lock badge,
      toast e typing chegam no outro browser dentro dos timeouts
      default (5s) e na prática < 2s (suite inteira em ~23s).
- [x] **Kill do server + restart**: reconnect.e2e.ts mata e reinicia o
      processo real — toasts "Server reiniciou" + "Sessão renovada",
      #conn volta, avatar redeclarado sem F5, reconexões limitadas.
- [x] CI verde (equivalentes locais: tsc, bun test, build, e2e chromium).

---

## 2. O que NÃO está nesta fase

- ❌ Abrir/editar turnos — UI-2 (locks aqui só EXIBEM).
- ❌ Poll `presence.who` substituído por push — mantém o poll de 10s
  da lib como hoje; otimizar é pós-UI-5.
- ❌ Som/notificação nativa do browser — fora, YAGNI.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Projeção de eventos + presença no canvas | 1-1.5 dia |
| Toasts + feed + settings + typing web | 0.5-1 dia |
| 6 e2e reescritos | 1 dia |
| **Total** | **2-3 dias** |

---

## 4. Riscos

1. **Re-render em cascata no React Flow a cada evento SSE** (broadcast
   storm QA-5 vira jank). Mitigação: zustand com seletores por nó
   (só o card afetado re-renderiza); harness de storm do QA-5 apontado
   pra UI no dry-run da fase.
2. **Paridade de toast diverge silenciosamente** (regras `maybeToast`
   são sutis — dono do commit não é toastado etc.). Mitigação: portar
   `toasts.ts` (fila/coalescing) como está — unit tests dele já
   existem e vêm junto.
