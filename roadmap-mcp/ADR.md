# ADR — Serviço MCP open-graph: base de conhecimento centralizada, multi-usuário, rastreada

> Status: **proposta p/ discussão** — não é decisão tomada. Cada seção termina com
> `Decisão:` marcando o que precisa do seu input. Nada aqui é compromisso; é o
> documento que precede o compromisso.
>
> Público: você (proprietário do open-graph) + analista (eu).
> Escopo: desenho de um **serviço MCP** derivado do open-graph, não continuação do
> fork opencode. O código existente é **base de aprendizado**, não alvo de mudança.
>
> Onde mora: `docs/roadmap-mcp/`. Irmão do `docs/specs/`, não filho — é uma linha
> de produto nova que *reusa conceitos* do open-graph sem depender do seu runtime.

---

## 0. O norte (em uma frase)

Transformar o open-graph de "ferramenta que um dev roda dentro de um repo" em
**serviço de base de conhecimento centralizada onde múltiplos agentes e humanos
editam o mesmo grafo em tempo real, com rastreamento de mudanças tipo
versionamento + presença tipo jogo multiplayer: cada um vê o que o outro está
fazendo e pode continuar em outra branch sem conflito silencioso.**

---

## 1. Por que MCP (e não "mais uma ferramenta no fork")

MCP (*Model Context Protocol*) é o ponto de articulação certo por três motivos
que se reforçam:

1. **Cliente-agnostico.** Qualquer IDE/agente que fale MCP (Claude Desktop,
   opencode, Cursor, Continue, Zed, ...) consome o serviço. Não acoplar o
   universo de conhecimento do open-graph a um editor só. Isso é o que torna a
   "base centralizada" realmente central — ela está disponível onde o usuário
   já está, não exige troca de ferramenta.
2. **Two-way por design.** MCP tem **tools** (mutação) E **resources/subscribe**
   (streaming). Isso espelha exatamente o que o open-graph precisa: escrita pela
   porta (gate) E notificação de drift/democao/presenca em tempo real. O
   protocolo carrega as duas direções sem ginástica.
3. **Padrão emergente, não invenção.** Adoção cresce rápido; encarregar-se de um
   server MCP é custo baixo p/ ganho de interoperabilidade alto. Tornar o
   open-graph "o server MCP de knowledge graphs governados" é um posicionamento
   de produto, não um detalhe técnico.

**Nota de realidade (2025):** a spec MCP substituiu o transport HTTP+SSE
por **Streamable HTTP**, e o suporte dos clientes a `resources/subscribe`
é irregular (tools funcionam em todo lugar; subscriptions não). O desenho
assume **tools MCP + endpoint SSE próprio (`/events`) como caminho
primário** de streaming; `resources/subscribe` é camada opcional, ligada
só após verificar a matriz de suporte dos clientes-alvo (ver `01` §4.1).

**Decisão:** MCP é o transporte obrigatório, opcional de descartar. Mantenha?

---

## 2. Conceito norteador: "rastreamento tipo git + presença tipo jogo multiplayer"

Esta frase do seu enunciado é a **inovação defensável** — ela articula algo que
nem git nem jogos resolvem sozinhos, e que combina bem.

- **Git sozinho falha no caso descrito:** é assíncrono, branch-based, conflito é
  pós-fato. "Avisar que alterou" é manual (pull). "Continuar em outra sem
  conflito" é a doença que você quer curar, não o remédio.
- **Jogo sozinho falha no caso descrito:** é síncrono, presença é ótima, mas
  **não há durabilidade/auditoria**: ninguém pode reproduzir "como o grafo
  estava no commit X" ou responder "quem mudou o quê, quando, por quê".

**O que o serviço oferece que nenhum dos dois oferece sozinho:**

|   | git | jogo | **serviço MCP open-graph** |
|---|---|---|---|
| durabilidade versionada | sim | não | **sim** |
| replay histórico | sim | não | **sim** |
| presença live | não (manual) | sim | **sim** |
| lock otimista por célula | rígido (file-level) | zone-level | **cell-level (domain × layer)** |
| notificação de mudança alheia | pull só | broadcast | **push via subscribe** |
| gate determinístico (não confie no LLM) | não tem | não tem | **sim (herdado do open-graph)** |
| racing/conflito explícito | merge conflict tarde | whoops | **lock cell + changeset aberto = turno visível desde o início** |

**A unidade atômica de jogo = changeset aberto.** Quem abre um changeset em
certa célula ganha o **turno** daquela célula (lock pessimista) ou escreve
otimista e resolve no close (lock otimista — ver §6). Outros que tentem edição
na mesma célula veem "Alice está editando [ui:4], turno aberto cs_abc" desde o
primeiro lance — não descobrem em commit.

**Decisão:** A combinacão "git-like changesets + multiplayer presence" é a tese
de produto. Você confirma que essa é a handle que quer defensar, ou prefere
abandonar a metáfora de jogo e focar só no git-like multi-user?

---

## 3. Pressupostos herdados do open-graph (o que NÃO vamos reinventar)

O serviço MCP **reusa conceitos** do open-graph, não o seu código. Estes
princípios são adquiridos (já provados no código), e o serviço nasce assumindo
eles como lei:

1. **Núcleo determinístico, LLM na borda.** O grafo, os gates, o rastreio, a
   autoridade — tudo matéria de código determinístico. A LLM **propõe**;
   **nunca é autoridade.** Toda proposta carrega ancora verificável
   (token-stream hash, não substring — aprendido com o `excerptCheck`).
2. **Porta única.** Nada entra no grafo sem gate. Nada vira
   realidade sem humano aplicar (ou changeset admitido, no caso servidor).
3. **Verdade no grafo, não na cabeça da LLM nem na sessão.** Sessão é borda
   descartável; o grafo persiste. Conexão cai → reconnect → leu o grafo
   corrente e o changeset aberto seu → continua de onde largou.
4. **Autoridade ganha, não herdada.** Célula nasce `α` (source = verdade);
   ganha `β` (graph = verdade) só depois de provar cobrança + integridade +
   roundtrip. Drift demove. `β` é privilégio revogável, não modo.
5. **Escada bidirecional.** Níveis de abstração 0..5; descida é projeção, subida
   é ancoragem. O rastreio vertical é o que faz "mudar de idéia barato".
6. **Humano nos pontos irreversíveis.** Flip de autoridade, admissão de
   changeset, aplicação de diff — sempre prompt, sempre auditado.

Estes são **o contrato de produto**. O serviço é o open-graph com **mais** uma
camada (estado distribuído), nunca menos.

**Decisão:** estes 6 princípios são inegociáveis. Você quer adicionar algum/outro
como sétimo, ou expurgar algum?

---

## 4. O que é NOVO nesta linha de produto (não existe no open-graph hoje)

O open-graph é single-repo single-user file-in-tree. O serviço MCP adiciona:

### 4.1 Estado de servidor autoritativo (não arquivos no repo)

`graph.json`/`claims.jsonl` no repo era a versão "single-user, com git no
disco". Em servidor:

- **O grafo mora num banco**, não num arquivo. Multi-reader/single-writer pela
  natureza do problema; SQLite (WAL mode) para v1 por hardware barato e
  implantação trivial; Postgres explicitamente **fora** do v1 (nada justifica
  operar cluster antes de ter tráfego).
- **Append log como durabilidade git-like**, **SQLite como índice derivado +
  estado live**. Isso não é novidade — o `state-index.ts` do open-graph já é
  exatamente essa separacão (log = verdade, sqlite = cache rebuildavel). No
  servidor, **a diferença** é que o SQLite também guarda estado **novo**: locks,
  presença, changesets abertos, usuarios.

  **Regra canônica de verdade (vale p/ TODAS as fases; qualquer doc que
  contradiga isto está errado):** JSONL append-only = verdade durável
  (replay reconstrói tudo); SQLite = índice derivado + estado live
  (locks, presença — rebuildável/perdível). Quando um escopo diz "SQLite
  autoritativo", significa apenas "o servidor deixou de ler `.graph/` do
  repo-alvo" — nunca "SQLite é a fonte de verdade última".
- **Não há `.graph/` no cliente.** O cliente conversa por MCP. O repo de cada
  usuário **não carrega a verdade** — a verdade está no servidor. Isso
   inverte a doc original do open-graph ("o grafo pertence ao repo que descreve,
   igual `.git/`"), mas essa inversão é o ponto do produto: a base é
   **centralizada**.

Isso gera uma implicação desconfortável que você precisa decidir:

**Decisão (D1):** O servidor é a única fonte de verdade **OU** funciona em modo
"sujo-aceitavel" (cliente tem `.graph/` local + servidor orquestra)?
  - (a) Server-only: simples, escalável, exigē que o cliente não edite offline.
  - (b) Hybrid local-server: cliente pode editar offline, sincroniza depois —
    vira CRDT de grafo, complexidade alta.
  - **Minha recomendacão: (a)** p/ v1 (você descreveu um produto centralizado,
    não um produto de campo offline). (b) fica p/ v3+, se mercado pedir.

### 4.2 Changeset como turno de jogo (a peca realmente nova)

O open-graph tem changesets como "batch de claim deltas + flip atomico". O
serviço vai **2 alem**:

- **Ciclo de vida do turno**: `open → drafting → proposing → admitting →
  committed | aborted` — cada transição é evento público (broadcast a
  subscribers).
- **Lock por célula associada**: abrir um changeset sobre a célula `[ui:4]`
  notifica quem já observa `[ui:4]`. Três modos de lock (ver §6).
- **Continuidade offline-parcial**: cliente cai e reconecta → seu changeset
  `cs_abc` continua aberto até timeout/abort explícito; ele reattach e
  continua onde parou.

### 4.3 Presença

Estado de "quem está onde, fazendo o que" é **estado de live, não durável**.
Mas é o que faz a metáfora de jogo funcionar:

- `user.joined` (com agent/IDE que fala por ele), `user.left`
- `cell.focused` (estou olhando, não editando), `cell.editing` (tenho turno),
  `cell.idle` (sai)
- `changeset.opened · by · cell`, `changeset.delta · by` (broadcast em
  scroll, nâo por lance individual — agrega por janela p/ não inundar)
- `drift.detected · cell`, `authority.demoted · cell · grade`, `authority.flipped
  · cell · by`

### 4.4 Notification router (not all events to all clients)

Eventos são roteados por **subscription affinity**:

- Quem está observando `[ui:4]` recebe tudo de `[ui:4]`
- Quem está em `cs_abc` (mesmo como observador) recebe tudo de `cs_abc`
- Eventos de drift de celulas que ninguem observa **não sao push** (vão pro log,
  são pull p/ quem perguntar)
- Eventos de democao sao **sempre broadcast p/ admins do repo**

### 4.5 Identidade e permissoes

Multi-user exige authn/authz que o open-graph não tem. mínimo:

- **Identidade do usuário humano** (SSO/Token) e **identidade do agente** (qual
  cliente MCP, qual modelo, qual sessão — não cual "máquina de Alice").
- **Permissões por dominio/celula**: ler tudo, propor changeset, admitir
  changeset, executar flip (admin), aplicar diff (admin).
- **Auditoria**: cada changeset carrega author + agent_id + intent; o log é a
  historia legal.

**Decisão (D2):** v1 traz auth desde o início, **OU** v1 é single-org
"confiança total entre usuários" e auth é v2?
  - Minha recomendacão: v1 é single-org, muito menos atrito para **provar
    produto**. Auth/admine entra em v2 quando **multi-org** aparecer como caso.
    Mas auditoria (quem fez o que) entra já no v1 — é barata.

---

## 5. Topologia do serviço

```
                                  ┌─────────────────────────────────┐
   Cliente MCP (IDE/agente)       │      Servidor open-graph MCP     │
   ─────────────────────────  ◀──┤                                  │
   tools (mutacão) +                │   ┌────────────────────────┐    │
   resources/subscribe (eventos)    │   │  Transport MCP (SSE)    │    │
                                   │   │  ─ stdio bridge p/ local │    │
                                   │   └──────────┬─────────────┘    │
                                   │              ▼                  │
                                   │   ┌────────────────────────┐    │
                                   │   │ Gateway de Gates         │    │
                                   │   │ (determinístico, herdado│    │
                                   │   │  do open-graph)          │    │
                                   │   └──────────┬─────────────┘    │
                                   │              ▼                  │
                                   │   ┌────────────────────────┐    │
                                   │   │ Changeset Manager        │    │
                                   │   │ (lock, turno, presenca) │    │
                                   │   └──────────┬─────────────┘    │
                                   │              ▼                  │
                                   │   ┌────────────────────────┐    │
                                   │   │ State Store              │    │
                                   │   │  ─ append log (durável) │    │
                                   │   │  ─ SQLite (live index)  │    │
                                   │   │  ─ presence (in-mem)     │    │
                                   │   └────────────────────────┘    │
                                   │                                  │
                                   └─────────────────────────────────┘
```

**Decisão (D3):** v1 é um **único servidor** (single-node, SQLite WAL) **OU**
nasce pensado p/ cluster (Postgres, Redis, broker)?
  - Minha recommandacão: single-node p/ v1. Cluster é resposta a tráfego que
    ainda não existe. Single-node SQLite WAL já aguenta de forma tranquila
    dezenas de usuários ativos simultâneos. Cluster é custo de operacão
    prematuro e fonte de bugs de consistência.

---

## 6. Lock por célula: três modos (a decisão de produto mais importante aqui)

Esta é a escolha que define o "feel" do produto. Você descreveu "jogo
multiplayer", então o modelo mais convencional é pessimista. Mas times
diferentes precisam de coisas diferentes:

### Modo A — Pessimista (estilo "reservation")

abrir um changeset em `[ui:4]` → a cell fica **reservada**; outros recebem
"editing: alice, cs_abc" e só podem abrir changeset lá depois de alice
fechar ou abortar.

- **Vantagem:** zero conflito; cada um sabe o que é seu; muito previsível.
- **Desvantagem:** bloqueio longo = gargalo; se alice for pegar café e
  esquecer, ninguem trabalha. Exige **expiracão automática + propriedade
  transferível** (admin força release).

### Modo B — Otimista (estilo "Google Docs sem sugerir")

todos podem abrir changeset em `[ui:4]`; ao admitir, o gate verifica
conflito; se confitar com changeset anterior (seq base != corrente), aborta
ou pede rebase.

- **Vantagem:** zero lock, zero espera; fluido.
- **Desvantagem:** trabalho perdido no abort; "continuar em outra sem
  conflito" falha quando ambos tocam o mesmo codigo.

### Modo C — Hibrido (pessimista em células-β, otimista em α)

- Células β (graph = verdade) são high-stakes → lock pessimista; .
- Células α (source = verdade) são low-stakes → lock otimista, rebasa fácil
  (corrente muda mesmo, então rebase direto).

**Minha recomendacão: Modo C.** Defende o alto valor (β) sem sufocar a
exploracão (α). Mas é o mais complexo dos três.

**Decisão (D4):** modo A, B, ou C?

---

## 7. Protocolo MCP — tools e resources (escopo v1)

### Tools (mutacão, vai pelo gate)

| Tool | O que faz | Análogo open-graph |
|---|---|---|
| `graph.bootstrap` | recebe repo URL ou snapshot, roda o pipeline brownfield, gera grafo inicial | `graphbuild` |
| `graph.query` | consulta index (terms + domain + layer); retorna candidates + gaps | `graphindex` |
| `graph.subscribe` | registra interesse em cell/changeset/repo → client recebe stream | **novo** |
| `changeset.open` | abre turno em cell(s), retorna cs_id | **novo** (base: changeset-store) |
| `changeset.claim` | adiciona claim delta ao changeset aberto (dentro do turno) | `graphascend`/`graphexpand` (mais batch) |
| `changeset.commit` | fecha turno e admite atômico (gate+roundtrip scoped); broadcast | `changeset-store.admit` |
| `changeset.abort` | descarta turno | **novo** |
| `authority.flip` | promote α→β (admin) | `graphauthority` |
| `authority.reconcile` | suspended→graph fast-path | `graphreconcile` |
| `graph.rebase` | rebase um changeset aberto sobre o corrente (otimista) | **novo** |
| `graph.history` | replay de timeline (quem, o quê, quando) | **novo** |

### Resources/subscribe (leitura + streaming)

| Resource | Conteúdo |
|---|---|
| `graph://current` | snapshot do grafo corrente |
| `graph://cell/{id}` | estado da cell + autoridade + locks |
| `graph://changeset/{id}` | estado + deltas + participantes do turno |
| `graph://events` | stream ao vivo (filtrado por subscription) |
| `graph://history/since/{seq}` | tail do log desde seq |
| `graph://presence` | quem está onde agora |

Isto são considerações de implementação, não decisões de produto. Mantém?

---

## 8. Fronteira entre "serviço" e "cliente"

Para o cliente (IDE/agente) ser **burro**, o servidor faz **todo o gate**. O
cliente:

- não conhece `tokenHash`, `roundtrip`, `cell-DAG` — tudo é server-side;
- pode exibir quem está com turno em que cell (presença);
- pode exibir ghosts: changeset aberto (delta não admitido) mostra como
  **preenchido com matizado** sobre o grafo (eco do "hand-drawn ghosts" do ADR
  original — agora **multi-usuário**: ghosts de **outrem**).

**Decisão (D5):** O cliente de referência v1 é **opencode com plug-in MCP**,
**uma página web apartada (Fluid Explorer)**, **ou ambos**?
  - Minha recomendacão: **web apartada p/ v1** — captura o caso "jogo
    multiplayer" melhor (varias pessoas, browsers diferentes), não acopla
    a uma IDE, e deixa o produto mostrável palestra. Integracao com opencode
    vem em v2.

---

## 9. Modelo de dados do servidor (não é o grafo — é o que envolve o grafo)

**Grafo (já desenhado no open-graph):** nós, arestas, claims, células α/β,
autoridade, drift.

**Estado novo do servidor (around the grafo):**

```
users        (id, name, role, created_at)
sessions     (id, user_id, agent_kind, started_at, last_seen)
changesets   (id, intent, parent_id, status, opened_by, opened_at,
              closed_at, base_seq, admit_seq, blast_radius_cells)
cs_deltas    (cs_id, seq, kind, payload)  ── append-only p/ replay
locks        (cell, cs_id, mode, acquired_at, expires_at)
events       (seq, ts, kind, target_cell/cs_id/user, payload) ── append log
presence     (session_id, cell_or_cs, kind, since) ── in-memory só
subs         (session_id, filter) ── in-memory só
```

**Princípios:**

- **Log primeiro, tabelas depois.** `cs_deltas`, `events` são append-only; o
  resto é derivado, reprocessável.
- **Seq monotonico global.** Toda mutação tem um `seq` global; resolve L WW
  sem ambiguidade e suporta `history/since/{seq}` sem reconstruir tudo.
- **Locks com TTL.** Ninguem segura um turno p/ sempre; admin pode forçar
  release; expiração é automática.

---

## 10. O ciclo de vida de uma edição (história de uso)

Alice pede ao seu agente: "adicione validacão de CPF em xpto seguindo a nova
norma SC-2026/04".

1. Agente consulta `graph.query` → resultado + gap ("norma SC-2026/04"
   não casou nada).
2. Agente pede `changeset.open(cells=[ui:4,knowledge:4], intent="adicionar
   validação CPF conforme SC-2026/04") → server verifica lock em `ui:4` →
   livre → cria `cs_abc`, loca cell, broadcast `changeset.opened · alice.
3. Bob, em outra janela, tenta `changeset.open(cells=[ui:4], ...)` → recusado
   (modo C pessimista em β) com mensagem "alice tem o turno, cs_abc, abra em
   outra cell ou espere".
4. Agente de Alice constrói claims via `changeset.claim(cs_abc, ...)` (tres
   calls, agrega ao bag aberto). Cada call: gate-check incremental (não
   WAIT pro commit); broadcast de delta é agregado, não por lance.
5. Alice vê no canvas que o ghost de cada claim aparece (seleção não-admitida,
   matizada).
6. Agente termina: `changeset.commit(cs_abc)` → server valida gates completos
   (roundtrip scoped, coverage balanced, ...), admite; **grava no log com
   seq**, desloca locks, broadcast `changeset.committed` + `authority.maybe-
   ready` (se cobertura fechou).
7. Bob recebe `changeset.committed` para `ui:4` (observa) → seu canvas
   atualiza; ele pode agora abrir turno em `ui:4` (livre) ou em `ui:3` (a
   cell acima que agora tem payload p/ propagar).

Repare: **Bob nunca precisou do pull**. Ele recebeu a mudança do servidor. Isso
é o que **não é git**, e é o que é **jogo**.

---

## 11. Dividas e riscos honestos (já comecando a lista)

1. **LLM edge pode ser adversário.** O gate determinístico e o que separa
   "auto-LLM" de "auto-LLM concorrente" — mas no servidor, dois agentes
   representam dois humanos com objetivos diferentes. O gate é justo o que
   garante que ambos joguem pelas mesmas regras. **Risco:** o gate é
   single-process no open-graph; no servidor é aproveitado de máquina
   concorrente. Implementação tem que garantir que o gate **não tenha estado
   compartilhado mutável fora do SQLite/lock** ( invariant ).
2. **Presença é baixa confiabilidade.** Se um cliente cair sem `user.left`,
   `presence` fica suja. Mecanismo heartbeat + TTL resolve — não é dificil,
   mas é **necessário desde v1**.
3. **SQLite single-writer pode ser gargalo.** WAL é bom, mas escritas muito
   frequente serializam. Mitigação: agregar deltas p/ log em batches (janela
   50-100 ms).
4. **Hosted vs self-hosted.** Modelo de negocio implicacoes:
   - Self-hosted (single-tenant docker compose): barato p/ voce, simples
     para 1-3 times, mas "base centralizada" é fração fraca do pitch.
   - Hosted (multi-tenant): exatoramento o pitch, mas mais operacão.
   A decisão é comercialmente importante — decidir antes de v2.
5. **"MCP é cedo".** Padrao muito novo, mudancas quebram. Mitigação: ficar
   fiel as ferramentas padrao (tools/resources) que já trabalham em todos os
   clientes; evitar features experimentais do MCP até amadurecer.

---

## 12. Roadmap macro (sem datas, com dependencias)

```
FASE 1 — MCP "read-only" (prototype de protocolo)
   ─ graph.query via MCP
   ─ graph.bootstrap (input: snapshot/repo) → grafo publicado
   ─ graph.subscribe → events stream
   ─ 1 cliente web mostra o grafo + recebe eventos ao vivo
   ─ ❌ sem mutação live

FASE 2 — Changesets turno
   ─ changeset.open/claim/commit/abort via MCP
   ─ Locks pessimistas (simples), uma cell por changeset
   ─ Reconnect reattach
   ─ Preserve o escopão de gate determinístico
   ─ Ghosts de changeset aberto no canvas web

FASE 3 — Presença e notificação
   ─ Presence live, heartbeat, TTL
   ─ Broadcast agregado por janela
   ─ Notification router por subscription affinity
   ─ Ghosts de **outrem** no canvas de cada um

FASE 4 — Alfa multiplayer
   ─ Modo C (pessimista β / otimista α)
   ─ Rebase de changeset otimista
   ─ History timeline UI
   ─ Permissões por cell (admin mantém β)

FASE 5 — Federacao entre servidores (p/ v2+)
   ─ Manifestos assinados (herdado de federation.ts)
   ─ Foreign towers
   ─ Multi-org hosted

FASE 6 — CRDT / offline (apenas se tráfego/produto pedir)
   ─ Hybrid local-server (D1 opcao b)
```

Dependencia: F2 precisa F1. F3 paralelo com F2. F4 precisa F3. F5/F6 sao
exploratorios, dependentes de adocão.

---

## 13. Decisões que eu preciso de você hoje (check-list)

As **5** que travam o design. Respostas default (recomendadas) marcadas **(R)**:

- **D1.** Server-only vs hybrid local-server p/ v1? **(R) server-only**
- **D2.** Auth desde v1 vs single-org trust v1? **(R) single-org com auditoria**
- **D3.** Single-node SQLite vs cluster desde v1? **(R) single-node**
- **D4.** Lock por cell: A pessimista / B otimista / C hibrido? **(R) C**
- **D5.** Cliente de referência: opencode plug / web apartado / ambos? **(R) web apartado**

Se vir default em todas, eu parto p/ detalhar a **Fase 1** (escopo, schema, fluxo bootstrap) com as cinco já tomadas. Se discordar de qualquer uma, avise qual e porquê antes de avançar.

---

## 14. O que este NÃO é

- Não é continuação do fork opencode. O open-graph original segue seu rumo;
  este ADR abre uma **linha de produto paralela** que se serve dos conceitos.
- Não é promessa de que a Fase 1 sai daqui a duas semanas. Sem decisões, nada
  sai; com decisões, ainda assim é MVP de produto, não brincadeira de tutorial.
- Não repõe documentação existente. O `docs/specs/` e `docs/plans/` do
  open-graph continuam validos para o fork; aqui é **paralelo**.

---

## 15. Próximo passo

Você valida as defaults ou edita. Em seguida:
- Eu escrevo `01-scope-phase-1.md` (escopo fechado da Fase 1: endpoints, schema SQLite, fluxo bootstrap, cliente web minimo, testes de aceite).
- Antes disso, pergunta/affirmativa: você quer que eu já inclua um orçamento de
  esforço (semanas) ou mantemos só dependências? O orçamento é chute educado;
  sem datas concretas fica menos corroído.