# INT-2 — Escopo fechado (client lib da camada viva)

> Status: **escopo p/ execução** — após INT-1; base de INT-3/4/5.
> Índice-pai: `README.md`.
>
> **Objetivo:** implementar a camada viva UMA vez (ID3):
> `@open-graph-mcp/client`, lib TS sem dependências, que qualquer plugin
> (e o próprio proxy `--live`) usa. O mcp-web JÁ tem 80% disso escrito e
> testado (subscribe.ts EventStream, presence-state.ts, api.ts) — esta
> fase EXTRAI e generaliza, não reescreve.

---

## 1. O que sai pronto no final

1. Pacote `packages/client/` (`@open-graph-mcp/client`), TS puro,
   roda em Bun e Node ≥20 (fetch/ReadableStream nativos), zero deps.
2. mcp-web refatorado pra consumir a lib (prova de que a extração é real).
3. Proxy stdio ganha `--live` (beat + SSE + injeção de sessionId).

**Definição de pronto (DoD):**

- [ ] **API da lib** (superfície mínima):
  ```ts
  const og = await connect({
    server: "http://host:8787",
    name: "Alice",            // ou token já persistido
    agentKind: "claude-code", // ID5 — obrigatório
    credentialsFile?: string, // default ~/.open-graph-mcp/credentials.json
  })
  og.call(tool, args)          // token/sessionId injetados
  og.on(kind | "*", handler)   // eventos do SSE (afinados pelo server)
  og.subscribe(filters)        // graph.subscribe da sessão
  og.presence.focus(cell)      // beat automático a cada 15s por baixo
  og.systemMessages(handler)   // só chega p/ agentKind non-web (§8)
  og.close()
  ```
- [ ] **Extração do mcp-web**: EventStream (fetch+ReadableStream,
      parseFrame, classifyEnvelope com contrato ephemeral, reconexão com
      generation guard — TUDO já testado lá) move pra lib; mcp-web
      importa da lib. Testes existentes (envelope, eventstream) movem
      junto. `bun test` verde nos dois.
- [ ] **Ciclo de vida completo**: register → SSE → session.created →
      declare presence → beat 15s → reattach pós-drop
      (changeset.list_mine) → auto re-register pós-restart (o gap achado
      na QA-1: token morto + redeclare com token velho falha em silêncio
      — AQUI é onde se conserta de verdade, e o fix beneficia web e
      plugins de uma vez).
- [ ] **Fallback por polling embutido** (ID2): `connect({live:false})` →
      mesma API; `on()` alimentado por poll de graph.history?since=N +
      presence.who a cada Xs. Plugin não escreve dois caminhos.
- [ ] Proxy stdio: flag `--live` usa a lib; presence.focus/beat passam a
      funcionar p/ cliente vanilla (sessionId injetado).
- [ ] Testes: lib contra server real (padrão dos testes atuais);
      ciclo restart; polling fallback.

---

## 2. O que NÃO está nesta fase

- ❌ Client em outras linguagens (Python etc.) — sem demanda; o proxy
  stdio já cobre agente não-TS.
- ❌ Reconexão de token cross-restart sem re-register — é D10 (Fase 4).
- ❌ Cache local do grafo na lib — cliente é fino; grafo vive no server.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Extração EventStream/presence + pacote | 2-3 dias |
| Ciclo de vida (beat/reattach/re-register) | 2-3 dias |
| Polling fallback | 1 dia |
| Proxy `--live` + testes | 1-2 dias |
| **Total** | **1-1.5 semana** |

---

## 4. Riscos

1. **Extração quebra o mcp-web.** Trava: testes atuais movem junto e a
   QA-2 (e2e) roda por cima — sequência ideal é INT-2 depois da QA-2
   existir.
2. **Node vs Bun divergem em stream/fetch.** A lib nasce testada nos
   dois runtimes (CI: job com Node LTS além do Bun) — é a única peça do
   monorepo que promete Node.
3. **Beat em processo de agente efêmero** (CLI que roda 30s): beat timer
   morre com o processo — correto (presença expira). Documentar que
   presença de agente CLI é naturalmente intermitente; invisible default
   configurável pra não poluir a presence bar.
