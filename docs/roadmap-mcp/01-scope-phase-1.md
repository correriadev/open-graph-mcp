# Fase 1 — Escopo fechado (MCP read-only)

> Status: **escopo p/ execução** — saímos de discussão p/ especificação.
> ADR-pai: `docs/roadmap-mcp/ADR.md` (D1–D5 aceitos com defaults).
>
> **Objetivo da Fase 1:** provar o protocolo MCP sobre um grafo open-graph.
>   Sem mutação live. Sem locks. Sem presença. Apenas: **bootstrap → consultar
>   → receber eventos de drift/democao**. Quem mostrar valor aqui ganha a
>   confiança para patrocinar a Fase 2.
>
> **Gate pré-código:** itens 1 e 2 da pesquisa pendente (README) travam
> ESTA fase, não a Fase 2 — (1) estado do MCP SDK p/ subscribe afeta §4.1;
> (2) os módulos de grafo vivem em `packages/opencode/src/graph/` e não
> são exportados por `packages/core`; extrair um pacote `graph-core`
> consumível vem antes do scaffold.

---

## 1. O que SAI pronto no final da Fase 1

1. Um servidor MCP (TS/Bun, HTTP+SSE) rodando em localhost.
2. Um grafo construído pelo pipeline brownfield do open-graph, **publicado no
   servidor** (não mais lido de `.graph/` na Tree de cada cliente).
3. Cliente web mínimo (página estática + EventSource) que mostra o grafo e
   **atualiza sozinho** quando algo muda (drift detectado pelo watch loop).
4. Um cliente opencode com plug-in MCP consegue `graph.query` e recebe o
   mesmo stream — prova de cliente-agnosticismo.
5. Zero mutação live: qualquer alteração no grafo acontece por **edição
   administrativa do servidor** (script direto, fora do protocolo MCP),
   servindo só p/ **provar que o stream funciona**.

**Definição de pronto (DoD):**

- [ ] Servidor sobe com `bun dev` e responde `initialize` MCP.
- [ ] `graph.bootstrap` (`POST /mcp`, tool call) recebe um repo path local e
      produz um grafo válido ( Lê `.graph/graph.json` se existir, ou dispara
      pipeline brownfield se não).
- [ ] `graph.query` retorna candidates + gaps sobre o grafo publicado.
- [ ] `graph.subscribe` filtra por `{ cell, domain, layer }` e mantém
      SSE aberto; eventos de `watch` aparecem no stream.
- [ ] Cliente web mostra o grafo (mesmo layout determinístico herdado) e
      recebe e exibe eventos novos sem refresh.
- [ ] Watch loop do open-graph (zíper de `watch.ts`) rodando server-side,
      emitindo eventos no log do servidor; SSE é só tail desse log.
- [ ] Log de eventos é replayável: `graph.history.since(seq)` retorna tail.
- [ ] **Nenhum gate de mutação é exposto aqui.** Tudo que vira granted na
      Fase 1 é **leitura e subscrição**.
- [ ] Dois clientes conectados simultaneamente recebem o mesmo evento no
      mesmo tick (prova de broadcast).

---

## 2. O que NÃO está na Fase 1

- ❌ Changesets, locks, turnos (Fase 2).
- ❌ Presença/de user/cell (Fase 3).
- ❌ Mutação do grafo via protocolo. O grafo muda só por watch detectar
  drift (fonte externa) ou por script admin injetar dados p/ teste.
- ❌ Permissões/auth (D2: single-org trust).
- ❌ Reconnect/reatch de changeset (sem changeset p/ reattach).
- ❌ Federação (Fase 5).
- ❌ Reescrita de index ou CRDT (não há SQLite autoritativo ainda — o servidor
  lê `.graph/` direto; só **na Fase 2** o estado promoter-se-a SQLite
  autoritativo).

---

## 3. Topologia (simplificada p/ Fase 1)

```
┌──────────────────────────────┐
│   Cliente (web | opencode)   │
│   ─ SSE EventSource          │
│   ─ fetch POST /mcp (tools)  │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│   Servidor MCP (TS/Bun)      │
│   ─ HTTP/JSON-RPC em /mcp    │
│   ─ SSE em /events           │
│   ─ watch loop (fiber)       │
│   ─ lê .graph/ do repo-alvo  │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│   .graph/ (arquivo em disco) │
│   ─ graph.json, claims.jsonl │
│   ─ events.jsonl             │
│   ─ gerado por open-graph    │
└──────────────────────────────┘
```

**Decisão de implementação (não pergunta):** servidor **não cria estado
novo** nesta fase. Ele é um **proxy inteligente** sobre `.graph/`. Toda a
complexidade de servidor (SQLite, locks, changesets) entra em Fase 2 com um
único grande refactor.

Isto está alinhado com os princípios do projeto: **primeiro fazer o minimo
que prova o valor; depois adicionar complexidade**.

---

## 4. Endpoints MCP — Fase 1

### 4.1 Transport

- **JSON-RPC 2.0 sobre HTTP** em `/mcp` p/ tools (initialize, tools/list,
  tools/call, resources/list, resources/read, resources/subscribe).
- **SSE em `/events`** p/ subscriptions (MCP `resources/subscribe` é
  implementado como um SSE por sessão, filtrado server-side pelo filtro da
  subscribe).
- **CORS aberto p/ localhost** (single-org trust — D2).

**Caveat de spec (ver ADR §1, nota 2025):** a spec MCP migrou p/
Streamable HTTP e o suporte de clientes a `resources/subscribe` é
irregular. O caminho primário desta fase é **tools MCP + `/events` SSE
próprio** — funciona independente do estado do SDK. Expor
`resources/subscribe` "de verdade" é camada opcional, condicionada à
verificação da matriz de suporte dos clientes-alvo (item 1 da pesquisa
pré-código).

### 4.2 Tools

| Tool | Input | Output | Semêntica |
|---|---|---|---|
| `graph.bootstrap` | `{ repoPath: string }` | `{ graphId, stats }` | Se `.graph/graph.json` existe → publica; senão dispara open-graph brownfield pipeline (via spawn do binário `graphbuild` ou chamada in-process). **Idempotente.** |
| `graph.query` | `{ terms: string[], domain?, layer?, limit? }` | `{ candidates, gaps }` | Indexer herdado (`indexer.ts`), exatamente como está hoje. |
| `graph.subscribe` | `{ sessionId: string, filters: Filter[] }` | `{ ok }` | Registra/substitui os filtros da sessão SSE (ver §4.4). Sem chamada, default `[{ kind: "all" }]`. |
| `graph.rebuild` | `{}` | `{ ok, stats }` | Força re-leitura de `.graph/` e re-emissão de snapshot para todos subscribers. Útil p/ teste. |

**Mecânica de sessão SSE:** `GET /events?since=N` abre o stream; o
primeiro evento enviado é `session.created` com `{ sessionId, graphId }`.
O cliente então chama `graph.subscribe` (tool) p/ restringir filtros —
ou não chama e recebe tudo. Filtro também aceito inline via query
(`/events?filter=cell:ui:4`) p/ clientes burros; a tool é a via canônica.

### 4.3 Resources (read + subscribe)

| Resource URI | Conteúdo |
|---|---|
| `graph://snapshot` | JSON do grafo publicado (nós, arestas, autoridade, stats). |
| `graph://history` | tail dos eventos desde último seq conhecido pelo cliente (`?since=`). |
| `graph://cell/{cellKey}` | estado da célula: autoridade, nós, claim count, drift grade. |
| `graph://domain/{domain}` | torre inteira: todas as células daquele domain. |

### 4.4 Eventos publicados no stream

Tipados (cada um carrega `schemaVersion`, `seq`, `ts`, `kind`, `target`,
`payload`). O `schemaVersion` entra no envelope **desde a Fase 1** — os
shapes de evento mudam entre fases e clientes antigos precisam detectar
incompatibilidade em vez de quebrar silenciosos. Custa um campo agora;
custa migração depois.

- `graph.bootstrapped` — grafo publicado (inicial ou re-bootstrap).
- `graph.rebuilt` — snapshot re-emissão.
- `drift.node` — nó do chão mudou (ver Heranca de `watch.ts`).
- `drift.cell` — célula inteira afetada.
- `authority.demoted` — β→source/suspended (grade incluída).
- `authority.reconciled` — suspended→graph.
- `authority.flipped` — α→β (administrativo).
- `watch.healed` — rename/lexical heal (estado de intendê-se).
- `watch.converged` — watch cycle completo, 0 novas mudanças (útil p/ telemetria).

**Filtro de subscription (server-side):**

```ts
type Filter =
  | { kind: "all" }
  | { kind: "cell", cell: string }
  | { kind: "domain", domain: string }
  | { kind: "changeset", id: string }    // placeholder p/ Fase 2; ignored agora
  | { kind: "event", events: string[] }  // lista de kinds
```

Filtros podem ser combinados (OR no mesmo filtro, AND entre filtros
múltiplos num subscription só — decisão: fica simples).

---

## 5. Processo bootstrap (sequência detalhada)

```
1. Admin starta servidor: bun dev
   └─ servidor lê var de ambiente GRAPH_REPO_PATH (default: ./dev-repo)

2. Admin chama graph.bootstrap { repoPath }
   ├─ (a) Se .graph/graph.json existe:
   │     └─ servidor lê, valida schemaVersion (boot-gate.ts — heranca direta),
   │        publica em memória (Map<graphId, Graph>), broadcast graph.bootstrapped.
   ├─ (b) Se .graph/ ausente:
   │     └─ servidor dispara pipeline brownfield do open-graph (chamada
   │        in-process ou spawn do CLI `graph build`). Aguarda conclusão.
   │        Em seguida (a).

3. Watch loop starta (fiber separado, Bun):
   ├─ intervalo de 5s (configurável, default p/ dev;    │  watcher seria melhor, mas p/ Fase 1 intervalo basta — drift não e
   │  urgente em read-only).
   ├─ chama watch.ts herdado; eventos novos (seq > lastSeen) são publicados
   │  no stream SSE de cada subscription que casa.
   └─ usa events-snapshot.ts para bound replay.

4. Cliente conecta:
   ├─ tools/list → descobre graph.query, graph.subscribe, etc.
   ├─ tools/call graph.bootstrap (ou assume já pronto)
   ├─ fetch graph://snapshot → renderiza grafo
   └─ resources/subscribe graph://history?since=0 → SSE abre, recebe
      eventos novos e tail desde 0.

5. Edição externa (caminho de teste):
   ├─ Admin edita algum arquivo de código no repo-alvo diretamente (vim).
   ├─ Próximo watch cycle detecta drift → eventos emitidos.
   └─ Todos os clientes conectados recebem drift.node, drift.cell e (se
      β) authority.demoted — atualização ao vivo no canvas.
```

**Vantagem desta sequência:** prova a "base centralizada" (várias pessoas
veem o mesmo grafo) E "notificação tipo jogo" (um edita o código, todos
veem o drift em tempo real) — **sem sequer ter locks/changesets**.

---

## 6. Schema de dados que o servidor mantém em memória

Nada persistente novo. Tudo derivado do `.graph/` do repo-alvo.

```ts
type ServerState = {
  graph: Graph | null                  // herdado de build.ts
  graphId: string                      // sha256(repoPath + bootstrappedAt)
  bootstrappedAt: string               // ISO; NÂO usado p/ seq (seq é do log)
  lastEventSeq: number                 // high-water p/ replay incremental
  subscriptions: Map<SessionId, Filter[]>  // filtros ativos
  sessionCounter: number               // p/ sessionId p/ SSE
}
```

**Nada de SQLite aqui.** O SQLite autoritativo (decisão de D3 na ADR) entra
na Fase 2 quando precisamos de changesets e locks. Aqui, SSE em memória.

**Semântica de `since=seq` pós-restart:** o log de eventos é em memória
nesta fase; restart do servidor zera o seq. Regra: re-bootstrap gera novo
`graphId`; todo evento carrega o `graphId` corrente; cliente que detecta
`graphId` diferente do seu descarta o `since` local, refaz
`graph://snapshot` completo e reassina de `since=0`. Sem isso, cliente
com `since=500` contra log zerado recebe lixo silencioso.

---

## 7. Cliente web (mínimo viável)

**Stack (decidido por mim, justificável):** Vite + TS + Canvas 2D. Nada de
React — página única com template literals. Razões:

- Tem que renderizar milhares de nós potencial. Canvas 2D aguenta (WebGL
  seria overkill p/ MVP). `quadtree.ts` e `layout.ts` do open-graph já são
  determinísticos e cliente-agnosticos.
- Menor fricção: uma página `index.html` + `main.ts` + `render.ts`.
- Exige zero build de tags externas — Vite é o que já se usa no open-graph
  (pacote `app`).

**O que mostra:**

- Canvas full-screen com **view minimizada ao início**: torres de domain
  renderizadas como colunas (cores por % β, heatmap por claim count).
- Hover em uma torre → expansão p/ mostrar andares (layout.ts seedLayout).
- Clique em um nó → side panel com `id`, `responsibility`, `anchor`, `authority`,
  `drift grade` (se writable).
- Topbar: estado do servidor (conectado/desconectado, `lastEventSeq`), um botão
  "Re-bootstrap" que chama `graph.rebuild`.
- **Barra de eventos ao vivo** (right sidebar): últimos 20 eventos, cada um
  uma linha `ts · kind ·target`. Clique posiciona canvas no target.
- **Indicador de drift**: se qualquer célula demoveu nas ùltimas 24 h,
  badge vermelho "X drifts unresolved" na topbar.

**O que NÃO mostra:**

- Sem ghosts (sem changeset — Fase 2).
- Sem presença de outros (Fase 3).
- Sem inscrição por filter — recebe tudo (`kind: "all"` como default).
  When Fase 2 entra filtros.

---

## 8. Cliente opencode (smoke de interoperabilidade)

Plug-in MCP simples em TS:

```ts
// exemplos/opencode-mcp-plugin/index.ts (não existe ainda — placeholder)
export const plugin = {
  name: "open-graph-viewer",
  mcp: { transport: "http", url: "http://localhost:8787/mcp" },
}
```

opencode já suporta MCP servers via config. Para Fase 1, basta registrar o
servidor MCP na configuração de opencode e verificar que
`graph.query` e `graph.subscribe` funcionam quando invocadas por um agente
dentro do opencode.

**Smoke de aceite:** uma sessão opencode em outro repo perguntar ao agente
"o que o grafo do brain-boilerplate sabe sobre adversarial audit?" → agente
chama `graph.query`, recebe candidates, responde. **Sem install de nada
extra no repo do brain-boilerplate.**

Isso completa a prova de que o servidor é **cliente-agnostico** (web + IDE).

---

## 9. Testes de aceite (Fase 1)

Scripts de testes ponta-a-ponta, sem framework — assertions em `bun test`.

1. `bootstrap-fresh.test.ts` — diretório sem `.graph/` → chamar
   `graph.bootstrap` → aguardar pipeline → confirmar `graph://snapshot` retorna
   `stats.nodes > 0`.
2. `bootstrap-existing.test.ts` — diretório com `.graph/` já válido
   → `graph.bootstrap` retorna em <500ms; `stats` confere o conteúdo.
3. `query.test.ts` — termos conhecidos (ex.: `"adversarial"`, `"refinement"`)
   → candidates não-vazíos; gap reportado    referênciado é consultado.
4. `subscribe-drift.test.ts` — sobe servidor, sobe web client (em simulador),
   edita arquivo de código no repo-alvo (script `sed` p/ renomear função
   ancorada), espera 5-10s (cycle watch), **assert** que o cliente recebeu
   `drift.node` event correspondente.
5. `subscribe-demote.test.ts` — com uma célula β fixture (pequeno Fake repo
   p/ testes), hold edit que demove → assina social que o cliente recebeu
   `authority.demoted` com grade `gone`.
6. `history-replay.test.ts` — gera 5 eventos, consulta
   `graph://history?since=3` → assert que recebeu 2 eventos (4, 5).
7. **broadcast.test.ts** — sobe DOIS clients (EventSource), edita arquivo,
   assert que ambos receberam o mesmo evento no mesmo ciclo de watch.

Critério de "verde" Fase 1: **todos os 7 testes passam com servidor rodando
em background**.

---

## 10. Árvore de arquivos (proposta p/ execução)

```
roadmap-mcp/
├─ ADR.md                          (escrito)
├─ 01-scope-phase-1.md              (este arquivo)
├─ 02-scope-phase-2.md              (a ser escrito após Fase 1 verde)
├─ ...
packages/
├─ mcp-server/                     (NOVO — separado do packages/opencode)
│  ├─ package.json
│  ├─ tsconfig.json
│  ├─ src/
│  │  ├─ index.ts                   HTTP/SSE entrypoint
│  │  ├─ transport.ts               JSON-RPC over HTTP
│  │  ├─ sse.ts                     EventSource (events stream)
│  │  ├─ state.ts                   ServerState em memória
│  │  ├─ tools/
│  │  │  ├─ graph-bootstrap.ts
│  │  │  ├─ graph-query.ts
│  │  │  └─ graph-rebuild.ts
│  │  ├─ resources/
│  │  │  ├─ snapshot.ts
│  │  │  ├─ history.ts
│  │  │  ├─ cell.ts
│  │  │  └─ domain.ts
│  │  ├─ watch-bridge.ts            fiber que invoca watch.ts (de packages/opencode)
│  │  └─ effect-run.ts              Effect runtime compartilhado (se necessário)
│  └─ test/
│     ├─ bootstrap-fresh.test.ts
│     ├─ bootstrap-existing.test.ts
│     ├─ query.test.ts
│     ├─ subscribe-drift.test.ts
│     ├─ subscribe-demote.test.ts
│     ├─ history-replay.test.ts
│     └─ broadcast.test.ts
└─ mcp-web/                        (NOVO)
   ├─ index.html
   ├─ src/
   │  ├─ main.ts
   │  ├─ render.ts                  Canvas 2D com quadtree+layout
   │  ├─ subscribe.ts               SSE EventSource
   │  └─ api.ts                    fetch p/ tools
   └─ vite.config.ts
```

**Pacotes novos, separados.** O `packages/opencode` (o fork) não é
modificado — é **importado como dependência**:
`opencode/graph/*` (deep import do pacote `opencode`, `workspace:*`) traz os módulos determinísticos (build, indexer,
watch, authority, layout, quadtree). O uso é só de **leitura e
orquestração** — sem mutação via protocolo MCP nesta fase.

---

## 11. Dependências externas (lista de bibliotecas)

| Pacote | Por quê | Alt |
|---|---|---|
| `@modelcontextprotocol/sdk` (TS oficial) | Transport MCP (tools + resources + subscribe). Sem reinventar roda. | próprio JSON-RPC — |
| `bun:sqlite` *(não nesta fase)* | Reservado p/ Fase 2. | mocked placeholder |
| `opencode` (pacote local, deep import `opencode/graph/*`) | Importa graph modules (build, watch, indexer, etc.). | Fork copies — resistir. |
| Vite | Cliente web. Já usado em `packages/app`. | — |

**Sem dependência nova além de MCP SDK.** Ponytail: adicionar libs só
quando stdlib falhar.

---

## 12. Riscos e suas travas (Fase 1 específica)

1. **`watch` tem 74 testes red hoje (A2/A3 do roadmap-alpha-v2).** O serviço
   Fase 1 usa `watch.ts` que perde rename heal e lexical refresh. **Trava:**
   é aceitável para read-only? Sim — drift ainda é DETECTADO, apenas heal
   incompleto. A UI mostra o drift; não há necessidade de auto-heal p/ MVP.
   Mesmo assim, bloqueia `_lab/roadmap-mcp/Fase-1` até A2/A3 serem
   estabilizados no open-graph-base? **Decisão D6 (minha):** não. Serviço
   Fase 1 lê `watch` como está. Drift aparece com `stale`/`gone` mesmo
   quando podia ser `renamed`/`lexical`. **É preferível provar o protocolo
   antes de perfeiçoar a heranca.**
2. **`watch` é file-system-reading.** Se servidor roda em container, o
   repo-alvo precisa ser mount nele. Para v1 single-node single-tenant, isto
   é trivial mas o readme precisa ser explícito.
3. **SSE não escala bem p/ muitas subscriptions.** Para dezenas de clients
   vai bem. Para centenas, trocar p/ WebSocket ou Redis pubsub. **Fase 1
   não se preocupa com isso** — é tráfego que justifica o custo de cluster
  	em Fase 4+.
4. **MCP SDK TS é cedo.** Versões quebram. Travados a específica** tag
   version no `package.json` e atualização voluntária (não `^`).

---

## 13. Esforço estimado (chute educado)

Se executado por um dev que já conhece os internals do open-graph (você):

| Item | Estimativa |
|---|---|
| Pacote `packages/mcp-server/` scaffold + transport base | 1 dia |
| Tools (`bootstrap`, `query`, `rebuild`) | 2 dias |
| Resources (`snapshot`, `history`, `cell`, `domain`) | 1-2 dias |
| Watch bridge (fiber + tail + SSE broadcast) | 2 dias |
| Cliente web (Canvas com layout herdado + SSE `receive` + barra de eventos) | 3-4 dias |
| Testes de aceite (7 scripts) | 2 dias |
| Plug MCP opencode (smoke + readme) | 1 dia |
| **Total** | **2-3 semanas** (1 dev, ~50% dedicação) |

Suave para um MVP. **Sem grandes incertezas técnicas** — modules já existe,
resta composição.

---

## 14. O que vem depois (transition para Fase 2)

Pré-requisito p/ abrir `02-scope-phase-2.md`:

- Todos os 7 testes de aceite verdes.
- Cliente web mostrando drift ao vivo em um demo gravado.
- Um segundo usuário de verdade (não só teste) já consumindo via opencode.

A transição Fase 1 → Fase 2 envolve o **refactor SQLite grande**:

- Estado em memória (`ServerState.subscriptions`, `lastEventSeq`) → SQLite
  tabelas `events`, `subs`, `sessions`.
- Log append-only passa a ser autoritativo (não derivado do `.graph/` em
  disco do repo-alvo).
- Repo-alvo deixa de ser esperado. O grafo vive no servidor.

Este refactor é o limite claro entre "MCP proxy" (Fase 1) e "MCP serviço
autônomo" (Fase 2 e adiante).

---

## 15. Questões que eu não estou perguntando (pois são decisões de
implementação e não de produto) — e como estão decididas

- **Porta do servidor:** 8787 (pode cair). Configurável via env.
- **Estrutura do `package.json`:** seguir padrão do repo (workspaces bun).
- **Test framework:** `bun test` (alinhado com restante do monorepo).
- **Linter/formatter:** Biome (já alinhado com open-graph).
- **Forma do `effect-run.ts`:** se Effect for preciso p/ invocar Layer-based
  services do pacote `opencode`, usar `makeRuntime` do open-graph. Se for
  mais simples chamar funções puras diretamente, sem Effect. Ponytail: começar
  sem Effect, adicionar só se forçar.

Se discordar de qualquer uma, diga antes de eu começar a code.

---

## 16. Próximo passo

Você diz `siga` de novo e eu começo a scaffold de `packages/mcp-server`/. Mas
antes disso, meu conselho de analista: **releia a ADR e este escopo, e
edite qualquer coisa que cheire a overdesign ou falta de clareza**. Eu
prefiro passar uma tarde editando especificação do que uma semana
escrevendo código que depois tem que ser reescrito porque **eu imagino mal o
que você quer**.

Confirma? Edito algo? Sigo?