# INT-2 — Escopo fechado (client lib da camada viva)

> Status: **implementado** (branch `int-2-client-lib`) — 6/6 DoD
> fechados (2 com ressalva documentada, ver notas abaixo).
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

- [x] **API da lib** (superfície mínima) — implementada em
      `packages/client/src/connect.ts`, com uma mudança deliberada em
      relação ao sketch abaixo: `credentialsFile?: string` virou uma
      dupla mais geral, `store?: TokenStore` (interface `{get, set}`) +
      `token?: string` — o path override do `fileTokenStore()` (entry
      point separado `@open-graph-mcp/client/node-store`) cumpre o mesmo
      papel do `credentialsFile` original, mas permite injetar qualquer
      storage (o localStorage-backed store do mcp-web, por exemplo).
      `og.presence` também ganhou `.beat()` explícito (não estava no
      sketch original — necessário pro proxy stdio relayar um
      `presence.beat` real vindo de um cliente MCP vanilla):
  ```ts
  const og = await connect({
    server: "http://host:8787",
    name: "Alice",            // ou token já persistido (token/store)
    agentKind: "claude-code", // ID5 — obrigatório
    store?: TokenStore,       // default nenhum; node-store.ts p/ Node/Bun
  })
  og.call(tool, args)          // token/sessionId injetados
  og.on(kind | "*", handler)   // eventos do SSE (afinados pelo server)
  og.subscribe(filters)        // graph.subscribe da sessão
  og.presence.focus(cell)      // beat automático a cada 15s por baixo
  og.presence.beat()           // beat explícito (INT-2 T6, proxy stdio)
  og.systemMessages(handler)   // só chega p/ agentKind non-web (§8)
  og.close()
  ```
- [x] **Extração do mcp-web**: EventStream/parseFrame/classifyEnvelope/
      PresenceStore movidos pra `packages/client/src/`, testes movidos
      junto (convertidos de `bun:test` pra `node:test` — ver §Node dual-
      runtime abaixo), mcp-web importa da lib. `bun test` verde nos dois.
- [x] **Ciclo de vida completo**: register → SSE → session.created →
      declare presence → beat 15s → reattach pós-drop
      (changeset.list_mine) → auto re-register pós-restart. O gap da
      QA-1 (token morto + redeclare com token velho falha em silêncio)
      está consertado de verdade: detecção do erro "invalid or expired
      token", re-registro automático com o mesmo name/tenant, persistência
      do token novo, retry único da chamada, e reconexão SSE forçada
      (necessária pro `Session.userId` do server, vinculado por conexão,
      não ficar stale). **Verificado ao vivo** contra servidor real
      (matar+subir o processo, 3 ciclos consecutivos) durante esta fase —
      não só testes mockados. `docs/roadmap-qa/smoke-checklist.md` item 10
      atualizado pra refletir o comportamento pós-fix.
- [x] **Fallback por polling embutido** (ID2): `connect({live:false})`
      implementado atrás da MESMA `OgHandle` (`on`/`presence`/`call`
      idênticos; só o "como aprendo de eventos novos" e o cleanup do
      `close()` divergem internamente). **Ressalva**: nenhum consumidor
      real desta fase (mcp-web, proxy `--live`) usa `live:false` hoje —
      só a suíte de testes unitários da própria lib exercita esse
      caminho. Aceitável pro objetivo desta fase (a capacidade existe,
      ID2 não exige que todo consumidor a use já) — os consumidores reais
      de polling são as plataformas restritas (Cursor/Windsurf/Copilot),
      escopadas pra INT-5, não aqui. Primeiro consumidor real de
      `live:false` fica como trabalho futuro, não um gap desta fase.
- [x] Proxy stdio: flag `--live` usa a lib; presence.focus/beat passam a
      funcionar p/ cliente vanilla (sessionId injetado), verificado
      contra servidor real (não só mockado) em `live.test.ts`.
- [x] Testes: `bun test` (44 arquivos) cobre lib+mcp-web+stdio-proxy;
      ciclo restart verificado ao vivo (ver acima); polling fallback
      coberto por 7 testes unitários (mockados — sem consumidor real,
      ver ressalva acima). Não existe teste automatizado de e2e real
      (QA-2 ainda é só doc de escopo) — a verificação do ciclo de restart
      foi manual/ao-vivo nesta sessão, não uma suíte repetível em CI.

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

---

## 5. Fechamento — achados da revisão final de branch (não bloqueiam, rastrear)

1. **QA-2 (e2e) ainda não existe** — o risco #1 acima previa INT-2 depois
   da QA-2; essa fase rodou sem ela, como o usuário decidiu explicitamente
   aceitar o risco. Mitigação real usada: testes unitários movidos +
   verificação manual ao vivo do ciclo de restart (ver DoD acima). Sem
   suíte e2e repetível em CI cobrindo isso ainda.
2. **"Ponte de token duplo" no mcp-web**: `api.ts` mantém seu próprio
   token sincronizado à mão a partir do `onReauth` do `og` (comentário em
   `main.ts`). Consequência mais afiada do que o comentário original
   dizia: numa janela estreita entre o server reiniciar e essa
   sincronização acontecer, uma ação de mutação (commit/claim/abort/
   extend changeset) pode mostrar o erro cru `"invalid or expired
   token"` na UI sem retry automático (diferente de presence/SSE, que já
   se recupera sozinho). Candidato a resolver rotiando `api.ts` pelo
   `og.call()` diretamente numa fase futura (INT-3 é a próxima que mexe
   nesse arquivo).
3. **Três implementações de credential store** (`fileTokenStore` no Node,
   `localStorageTokenStore` no browser, `stdio-proxy/credentials.ts`
   parcialmente delegando pro primeiro) — justificado pelas necessidades
   genuinamente diferentes de cada ambiente, não duplicação acidental;
   revisado e confirmado inofensivo (mesmo `userId` determinístico dos
   dois lados no proxy `--live`, sem fragmentação de ownership). Mantido
   como está; reavaliar se um quarto consumidor aparecer.
4. **CI do `client-node`** usa `node-version: lts/*`, que hoje é mais
   recente que o piso "≥20" documentado — o piso real (consumo do
   `dist/` já buildado) nunca roda literalmente contra Node 20 em CI,
   só localmente (ver `packages/client/README.md`). Considerar pinar uma
   versão LTS antiga explícita como segunda perna do job se isso importar
   antes do Node 20 sair de suporte.
