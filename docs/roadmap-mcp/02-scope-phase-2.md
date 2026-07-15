# Fase 2 — Escopo fechado (changesets + locks)

> Status: **escopo p/ execução** — após Fase 1 verde.
> ADR-pai: `docs/roadmap-mcp/ADR.md`. Fase anterior: `01-scope-phase-1.md`.
>
> **Objetivo da Fase 2:** adicionar mutação viva via protocolo MCP. Um
> usuário abre um **turno** (changeset) sobre células, adiciona deltas de
> claim/autoridade, e admite tudo atomicamente. Outros usuários conectados
> veem ghosts (propostas não-admitidas) e não conseguem abrir turno na mesma
> célula β. É o "multiplayer pesado" — sem presença still (Fase 3) mas com
> locks visíveis desde o primeiro lance.

---

## 1. O que sai pronto no final da Fase 2

1. **SQLite autoritativo** — o servidor deixa de ler `.graph/` em disco do
   repo-alvo. O estado vive no banco do servidor (decisão D3 da ADR). Log
   append-only JSONL persiste como durabilidade git-like; SQLite é o índice
   **e** o estado live.
2. **Tools de mutação** via MCP: `changeset.open`, `changeset.claim`,
   `changeset.commit`, `changeset.abort`.
3. **Lock pessimista por célula β** (modo C da ADR §6 — versão simplificada:
   só pessimista nesta fase; α ainda é read-only p/ mutação, entra em
   otimista na Fase 4).
4. **Ghosts no cliente web**: changeset aberto de **qualquer usuário**
   renderiza como camada overlay (matizada, desaturada).
5. **Reconnect reattach**: cliente cai e volta → seu changeset aberto
   continua lá (até TTL expirar ou abort explícito).
6. **Replay histórico** completo: `graph.history` retorna a timeline dos
   changesets admitidos (quem, quando, intent, blast radius, deltas).

**Definição de pronto (DoD):**

- [ ] Server sobe com SQLite novo em `~/open-graph-server/state.sqlite` (não
      mais lê `.graph/` do repo-alvo).
- [ ] `migrate-from-phase-1.ts` pega um `.graph/` existente e importa pro
      SQLite autoritativo (idempotente — pode rodar duas vezes, segunda é
      no-op).
- [ ] `changeset.open(cells=[ui:4], intent="adicionar validação CPF")` →
      recusa se `[ui:4]` está locked alheio; abre cs_id caso contrário;
      broadcast `changeset.opened`.
- [ ] `changeset.claim(cs_id, delta)` → adiciona ao bag aberto; gate-check
      incremental (scopes roundtrip sobre o subset, não o grafo inteiro);
      broadcast `changeset.delta` agregado por janela de 100ms.
- [ ] `changeset.commit(cs_id)` → gate final (roundtrip scoped + coverage
      balanced da cell + aborta se algo quebrou); admite
      atomicamente; libera locks; broadcast `changeset.committed`.
- [ ] `changeset.abort(cs_id)` → descarta; libera locks; broadcast
      `changeset.aborted`.
- [ ] Locks têm TTL (default 30min); `changeset.extend(cs_id)` renova.
- [ ] Ghosts de changeset alheio aparecem no canvas web de quem observa a
      cell.
- [ ] Reconnect: derrubar SSE e reabrir → servidor identifica session pelo
      token → changeset aberto seu ainda está lá.
- [ ] Dois usuários não conseguem abrir turno na mesma cell β
      simultaneamente (teste de corrida vermelho-verde).
- [ ] `graph.history` retorna eventos admitidos ordenados por seq global.

---

## 2. O que NÃO está na Fase 2

- ❌ Presença ("Alice está olhando [ui:4]" sem estar editando) — Fase 3.
- ❌ Lock otimista (rebase de changeset concorrente) — Fase 4.
- ❌ Modo C completo (α com lock otimista) — Fase 4. Aqui α é read-only p/
  mutação via MCP (mutação só em β pessimista ou cells novas).
- ❌ Permissões/auth (D2: single-org com auditoria; auditoria entra nesta
  fase, authz não).
- ❌ Federação (Fase 5).
- ❌ Refino do watch (heal, A2/A3) — o watch **continua rodando** nesta
  fase (D7 revisado), mas como está, sem melhorias.

**Watch na Fase 2 (D7 revisado):** o drift ao vivo é exatamente o que a
Fase 1 demonstra como valor; desligá-lo aqui seria regressão de demo.
Portanto: servidor com `WATCH_REPO_PATH` configurado mantém o watch loop
da Fase 1, agora escrevendo via adapter `watch-bridge → appendEvent`
(SQLite + JSONL, ~2 dias — mecânica que antes estava na Fase 4 §13.2).
Sem `WATCH_REPO_PATH`, o servidor opera em **modo puro knowledge** (como
o brain-boilerplate: grafos de documentação/agentes/contratos, sem chão
de código) — este é o default. A Fase 4 só *valida* o modo repo-linked
em cenário multi-dev; não o reintroduz.

---

## 3. O grande refactor: SQLite autoritativo

Esta é a transição mais cara do projeto. Vale detalhar.

### 3.1 Por que agora

Fase 1 usou `.graph/` direto por causa do ponytail principle: menos
complexidade p/ provar o protocolo. Fase 2 precisa de:

- **Estado de mutação persistente** (changesets abertos, locks) — em
  memória perde-se no restart.
- **Concorrência** (dois usuários abrindo turno simultâneo) — precisa
  serialização no banco, não in-process locks.
- **Auditabilidade legal** (D2) — log de eventos tem que ser
  tamper-resistant dentro do nosso alcance (SQLite WAL + hashes).

### 3.2 Schema SQLite (índice live)

> **D13 (decidida 2026-07-12): multi-tenant.** Todas as tabelas abaixo
> ganham coluna `tenant_id TEXT NOT NULL`; toda query é escopada por
> tenant; `seq` de eventos é monotônico POR TENANT; espelho JSONL vive em
> `STATE_DIR/tenants/<tenantId>/`. O schema abaixo mostra a forma
> single-tenant original — ler com o addendum.

```
users
  id            TEXT PRIMARY KEY
  name          TEXT NOT NULL
  created_at    TEXT NOT NULL

sessions
  id            TEXT PRIMARY KEY
  user_id       TEXT NOT NULL REFERENCES users(id)
  agent_kind    TEXT        -- 'web' | 'opencode' | 'cursor' | ...
  started_at    TEXT NOT NULL
  last_seen     TEXT NOT NULL
  token         TEXT UNIQUE  -- p/ reconnect

-- Grafo autoritativo
nodes
  id            TEXT PRIMARY KEY
  domain        TEXT
  level         TEXT        -- 'P1'..'P5'
  file          TEXT        -- nullable p/ greenfield-only cells
  kind          TEXT
  sig           TEXT
  anchor        TEXT        -- verbatim excerpt (herdado)
  symbol_path   TEXT        -- nullable p/ legado
  token_hash    TEXT        -- nullable p/ legado
  exposed       INTEGER     -- 0/1
  responsibility TEXT
  confidence    REAL
  created_seq   INTEGER     -- seq do changeset que criou
  supersede_seq INTEGER     -- seq do changeset que substituiu (null = vivo)

edges
  id            TEXT PRIMARY KEY
  from_id       TEXT NOT NULL REFERENCES nodes(id)
  to_id         TEXT NOT NULL REFERENCES nodes(id)
  kind          TEXT NOT NULL  -- 'ownership' | 'reference' | 'projection' | 'depends-on'
  created_seq   INTEGER
  supersede_seq INTEGER

claims
  id            TEXT PRIMARY KEY
  seq           INTEGER NOT NULL
  subject       TEXT
  domain        TEXT
  level         TEXT
  refs          TEXT       -- JSON array
  anchor        TEXT
  verdict_confidence  REAL
  verdict_overclaim   INTEGER
  supersedes    TEXT       -- id do claim que substituiu

authority
  cell          TEXT PRIMARY KEY  -- 'domain:level'
  value         TEXT NOT NULL     -- 'source' | 'graph' | 'suspended'
  last_flip_seq INTEGER
  last_flip_by  TEXT

-- Mutação viva
changesets
  id            TEXT PRIMARY KEY
  intent        TEXT NOT NULL
  parent        TEXT        -- cs_id do changeset anterior (lineage)
  status        TEXT NOT NULL  -- 'open' | 'admitted' | 'aborted'
  opened_by     TEXT NOT NULL REFERENCES users(id)
  opened_at     TEXT NOT NULL
  closed_at     TEXT
  base_seq      INTEGER     -- seq-corrente quando aberto (p/ otimista em Fase 4)
  admit_seq     INTEGER     -- seq do commit admitido
  blast_cells   TEXT        -- JSON array

cs_deltas
  cs_id         TEXT NOT NULL REFERENCES changesets(id)
  seq           INTEGER NOT NULL   -- local ao changeset
  kind          TEXT NOT NULL      -- 'claim.add' | 'authority.flip' | 'authority.demote'
  payload       TEXT NOT NULL      -- JSON
  created_at    TEXT NOT NULL
  PRIMARY KEY (cs_id, seq)

locks
  cell          TEXT PRIMARY KEY
  cs_id         TEXT NOT NULL REFERENCES changesets(id)
  mode          TEXT NOT NULL     -- 'pessimistic' (Fase 2 só)
  acquired_at   TEXT NOT NULL
  expires_at    TEXT NOT NULL     -- TTL
  holder        TEXT NOT NULL REFERENCES users(id)

-- Log de eventos
events
  seq           INTEGER PRIMARY KEY AUTOINCREMENT
  ts            TEXT NOT NULL
  kind          TEXT NOT NULL
  target_kind   TEXT        -- 'node' | 'cell' | 'changeset' | 'user' | 'authority'
  target_id     TEXT
  payload       TEXT        -- JSON
  by_user       TEXT        -- REFERENCES users(id)

-- Subscriptions (in-memory idealmente; persistente só se fizer sentido)
-- Fica em memória; SSE mantém o filtro. Não persistir.
```

### 3.3 Log append-only JSONL (paralelo)

SQLite é autoritativo p/ **consulta e estado live**. JSONL persiste como
**durável auditável**: para cada tabela mutável acima, um log JSONL espelha
os writes. Razões:

- Git-friendly (`.graph-server/*.jsonl` são diff-friendly, auditáveis em PR).
- Replay p/ auditoria: posso apagar o SQLite, replay JSONL, recuperar
  estado idêntico.
- **SQLite nunca é fonte de verdade última; JSONL é.** SQLite é cache
  rebuildável (mesmo princípio do `state-index.ts` do open-graph — aprendido).

### 3.4 Migration da Fase 1

`migrate-from-phase-1.ts`:

1. Lê `.graph/graph.json` (se existir) e `claims.jsonl`, `meta/*.jsonl`.
2. Popula `nodes`, `edges`, `claims`, `authority` no SQLite.
3. Cria changeset "bootstrap" (intent="phase-1 import", status='admitted',
   admit_seq=0, blast_cells=all).
4. Idempotente: rodar de novo → vê que `nodes` já tem rows com created_seq=0,
   skip.

---

## 4. Lock pessimista por célula — mecânica detalhada

### 4.1 Estados de uma cell

```
FREE ── changeset.open(cells=[X]) ──► LOCKED ── changeset.commit/abort ──► FREE
                                         │
                                         └── TTL expira ──► FREE (cs_id marcado 'aborted')
```

### 4.2 Regras

- Locks são **por cell** (`domain:level`), não por node. Uma célula pode ter
  N nós; o turno trava a toda a cell p/ simplicidade de gate.
- Quem tenta `changeset.open(cells=[X])` em cell LOCKED:
  - se lock holder = próprio user → ok, reusa cs_id (idempotente).
  - se lock holder = alheio → **recusado** com `{ ok: false, reason:
    "cell_locked", cell: X, holder, cs_id, expires_at }`.
- Locks têm TTL (default 30min, configurável por user? NÃO — p/ simplicidade
  v1 usa um valor fixo p/ todo servidor. Customização é Fase 4+).
- `changeset.extend(cs_id)` renova TTL se cs_id ainda aberto e holder =
  próprio user.
- TTL expira: server-side fiber varre `locks` a cada 1min; expirados viram
  `changesets.status='aborted'` com motivo `ttl_expired`; broadcast
  `changeset.aborted`.

### 4.3 Lock multi-cell

`changeset.open(cells=[A,B,C])` — tranca todas atomicamente. Se qualquer uma
está locked alheio, **nenhuma tranca** (fail atomically). Espelha o
princípio do `changeset-store.admitChangeset` do open-graph: tudo ou nada.

### 4.4 Conflito de multi-cell quando TTLs diferentes

Não pode acontecer: TTL é server-side constant em Fase 2. Se um dia variar,
turnstile renova TODAS as locks do cs_id ao chamar `extend`.

---

## 5. Gate incremental (durante drafting) vs gate final (no commit)

### 5.1 Por que dois gates

- **Gate incremental** (por `changeset.claim`): feedback imediato ao
  agente/usuario. "Esta claim sobe pendurada em nada? Recusado agora, não
  espere o commit." Reduz desperdício.
- **Gate final** (no `changeset.commit`): atomicidade real. Tudo foi
  admitido incrementalmente, mas o commit valida o **conjunto completo**
  como uma unidade (roundtrip scoped sobre o changeset inteiro, coverage da
  cell inteira, não por peça).

### 5.2 Gate incremental (o que roda por `changeset.claim`)

RÁPIDO, não pode demorar. Faz:

1. **Structure check**: `delta.payload` tem shape esperado (`claim.add`
   precisa `claim` válido; `authority.flip` precisa `cell` válido).
2. **Anchor check** (se claim.anchor): `excerptCheck`/structural anchor no
   fonte referenciado **ou** se cell é greenfield (Fase 4+), anchor no claim
   pai.
3. **Scope check**: o claim cai na cell trancada pelo cs_id? Se não → erro
   ("claim fora do escopo do turno").
4. **Quick roundtrip scoped**: only new claim + parent ladder local (não
   grafo inteiro). Avisa dangling cedo.

NÃO faz:

- Coverage balanced da cell (caro, faz no commit).
- Roundtrip global (não é ele p/ isso).
- Verifies de integrity (são p/ commit).

### 5.3 Gate final (no `changeset.commit`)

RODA TUDO, atomicamente, dentro de uma transação SQLite:

1. **Roundtrip scoped** completo sobre todas as claims do changeset + solera
   existente naquela cell (usa `intent-changeset.ts` do open-graph — já faz
   exatamente isto via `roundtripScoped`).
2. **Coverage balanced** por cell afetada (quantos nós tem claims vs
   quantos nós existem na cell).
3. **Verify integrity** para cells β (meta↔realidade).
4. **Autoridade**: se changeset pede `authority.flip`, roda `canFlip` do
   `authority.ts` (cobertura + verify + roundtrip green).

Transação: tudo verde → COMMIT; um vermelho → ABORT (changeset persiste
como 'aborted' c/ razões).

### 5.4 Invariante do gate

**INV-1 (Fase 2):** o gate nunca tem estado mutável compartilhado fora da
transação SQLite. Funções puras (hertadas do open-graph) operam sobre
snapshots; transação SQLite segura a atomicidade.

---

## 6. Eventos novos (Fase 2)

Adicionados ao stream SSE (em cima dos de Fase 1):

- `changeset.opened` — `{ cs_id, intent, cells, by_user, opened_at, expires_at }`
- `changeset.delta` — `{ cs_id, delta_count_since_last, by_user }` (agregado
  por janela 100ms, NÃO por lance; payload só `count` p/ não inundar cliente).
- `changeset.committed` — `{ cs_id, admit_seq, cells, blast_radius }`
- `changeset.aborted` — `{ cs_id, reason: 'user' | 'ttl_expired', cells }`
- `lock.acquired` — `{ cell, cs_id, holder, expires_at }`
- `lock.released` — `{ cell, cs_id, reason }`
- `lock.denied` — `{ cell, attempted_by, holder, cs_id }` (não broadcast
  geral; só p/ o usuário que tentou. Não vira evento público p/ todos.)
- `authority.flipped` — `{ cell, by_user, via_cs_id }`

Roteamento (subscription affinity, igual Fase 1):

- Quem observa cell X → recebe `lock.acquired`, `lock.released`,
  `changeset.opened` p/ cs que trancam X, `changeset.delta` p/ cs abertos em
  X, `changeset.committed`/`aborted` de cs que trancavam X.
- Quem abriu cs_id → recebe `lock.denied` (p/ cells dele), `changeset.delta`
  de todos os participantes em cs_id (Fase 3 pode ter múltiplos; em Fase 2
  só UM holder por cs, então delta sempre do próprio holder).
- `authority.flipped` é **sempre broadcast** (relevant p/ todos observadores
  do grafo). Pouco frequent, barato.

---

## 7. Cliente web — novas peças UI

Em cima do cliente Fase 1:

### 7.1 Ghost overlay

- Cada changeset aberto renderiza seus deltas como **nós/arestas ghosts**
  sobre o grafo admitido. Estilo: matizado (`opacity: 0.4`), traços dashed,
  deslocados 4px (princípio do ADR open-graph §"Seeing it" — "dashed, sketchy,
  visibly *not yet real*").
- Ghosts são uma **camada separada no canvas** (mesma técnica que o spec H3
  do blindspot roadmap recomendava: renderer não pode desenhar unadmitted
  como solid porque o estilo derivada da origem do dado — SQLite admitido
  vs cs_deltas).
- Múltiplos changesets abertos por múltiplos holders → ghosts de cada um
  em **cores de holder diferentes** (Fase 3 tem presença real p/ isso;
  aqui, cor por `cs_id` hash é suficiente).

### 7.2 Lock indicator

- Cell LOCKED no canvas: badge sobre a torre/andar "🔒 cs_abc @ alice".
  Minimal — não fazer complicado.
- Hover mostra `expires_at` (em Fase 2 com auditoria, já sabe o holder; em
  Fase 3 terá presença mais rica).

### 7.3 Botão "Open Turn"

- Modal p/ usuário:
  ```
  Intent: [________________]   -- texto livre
  Cells:  [ui:4] [+] [-]      -- picker (domain + level dropdowns)
  [Open]   [Cancel]
  ```
- Emite `changeset.open` via MCP tool.
- Em sucesso: canvas entra em modo "drafting" p/ aquele cs_id (lado do
  holder) — clique em nó admitido na cell trancada abre opção "Add claim
  delta" no side panel.

### 7.4 Side panel p/ drafting

- Quando cs_id aberto e selecionado:
  - Lista de deltas adicionados (cada um: `kind`, `payload` resumido,
    `timestamp`).
  - Botão **Commit**, **Abort**, **Extend TTL**.
  - Formulário p/ adicionar novo delta (`claim.add` com fields mínimos:
    `subject`, `domain`, `level`, `refs`, `anchor`).
- Não é editor de texto de claim completo — é suficiente p/ MVP. Agente faz
  o trabalho pesado; humano revisa e commita. Em MVP humano pode colar
  JSON de claim via textarea sem validação de schema rica; o gate
  incremental pega o ruim.

---

## 8. Auditoria (entra aqui, D2)

D2: single-org com auditoria. A auditoria === log de events + log de
changesets + linhagem de quem fez o quê.

**Limite honesto:** até a Fase 4, identidade é auto-declarada (`name` sem
senha, token em memória). Auditoria nas Fases 2–3 é **best-effort para
coordenação interna, sem valor probatório** — não chamar de "história
legal" antes do authz real. Se um early adopter precisar de auditoria
com identidade desde já, antecipar o token emitido por admin (Fase 4
§6.1, ~1-2 dias) para esta fase.

### 8.1 O que é capturado automaticamente

- `events` table: cada mudança com `by_user`, `ts`, `kind`, `target`,
  `payload`.
- `changesets` table: `opened_by`, `opened_at`, `closed_at`, `admit_seq`.
- `cs_deltas` table: cada delta com `created_at` (p/ replay).

### 8.2 UI de auditoria (mínimo)

- Rota separada no cliente web: `/history`.
- Timeline list: `seq · ts · kind · target · by_user`.
- Clique num event → side panel mostra payload completo + lineage de
  changeset (parent chain).
- Filtro por `by_user`, `cell`, `kind`.
- Sem export p/ CSV/etc em Fase 2 — acesso via web client só. Adicionar
  exportação é Fase 4 se pedir.

### 8.3 Linhagem de changesets (parents)

`parent` field em `changesets` permite encadear. Motivo:

- "Continue from cs_abc" abre cs_def com `parent=cs_abc`.
- Permite "branch de intenção" — Alice abre cs_abc (intent: "validação CPF
  simples"), Bob abre cs_def (intent: "validação CPF + anti-fraude
  adicional", parent=cs_abc) — dois caminhos a partir do mesmo ponto.
- Não é merge complicado p/ Fase 2; é só rastreio. Merge/competing intents é
  cena de Fase 4+.

---

## 9. Reconnect (mecânica)

- Cliente conecta pela primeira vez → server gera `session.token` (random
  32 bytes hex) → client salva em `localStorage`.
- SSE abre com `?token=...`.
- Server mantém `(token, session_id, cs_ids_abertos)` em memória (não
  persistente — se server restarta, sessions se reconstroem, cs_ids persistem pois
  estão no SQLite).
- Cliente cai (SSE fecha) → server não descarta cs_ids abertos do
  session_id (locks têm TTL, cs sobrevive).
- Cliente reabre com `?token=...` → resolve session_id → ver cs_ids
  abertos → reattach (envia `changeset.list_mine` para que cliente sabe onde
  está).
- Server restarta: tokens perdem validade (estão em memória). Cliente
  precisa reautenticar (em Fase 2 single-org trust, não faz nada além de
  declarar `name` — sem senha; usuário de auditoria sabe quem é pelo nome).
  Escolha: **não persistir tokens** p/ ponytail; em Fase 4+ com auth real
  isto muda.

---

## 10. Testes de aceite (Fase 2)

1. **migrate-from-phase-1.test.ts** — diretório com `.graph/` da Fase 1 →
   roda `migrate-from-phase-1.ts` → SQLite populado com nodes/claims
   idênticos (comparar contagens). Rodar de novo → no-op (contagens iguais).
2. **open-pessimistic.test.ts** — usuário A abre turno em `[ui:4]`; usuário
   B tenta abrir turno em `[ui:4]` → recusado com `cell_locked` e nome de A
   no erro.
3. **commit-atomic.test.ts** — Adiciona 3 deltas válidos + 1 delta inválido
   (referência dangling) → commit falha → assert que **nenhum** delta foi
   persistido (rollback atomico). Changeset marcado `aborted`.
4. **incremental-gate-early.test.ts** — `changeset.claim` com `anchor`
   inexistente → recusado na hora (não espere commit).
5. **ttl-expire.test.ts** — Abre cs com TTL 1seg (forçado p/ teste);
   espera 2s → assina `changeset.aborted` com `reason: 'ttl_expired'`; lock
   liberado.
6. **reconnect-reattach.test.ts** — Abre cs; derruba SSE (simula tab
   close); reabre SSE com mesmo token → assina `changeset.list_mine`
   retorna cs_id aberto.
7. **ghost-render.test.ts** (e2e cliente web) — usuário A abre cs em
   `[ui:4]`; usuário B conectado na mesma cell vê ghost overlay aparecer
   quando A adiciona delta (via SSE).
8. **history-query.test.ts** — admite 5 changesets em sequência; query
   `graph.history?since=0` retorna 5 eventos de `changeset.committed`
   ordenados por seq.
9. **broadcast-fairness.test.ts** — 3 clients conectados; admite um cs;
   assina que TODOS os 3 receberam `changeset.committed` no mesmo tick de
   broadcast (prova de fair fanout).
10. **commit-stress.test.ts** — N commits concorrentes (Promise.all de
    10+ changesets, cells distintas + tentativas na mesma cell) → assert
    de serialização: seqs globais únicos e monotônicos, nenhum delta
    perdido, locks consistentes ao final. Exercita INV-2 de verdade: o
    risco em Bun single-process não é multi-processo, é **interleaving
    async entre leitura do snapshot e commit da transação** — o teste
    tem que intercalar awaits no meio do gate.

---

## 11. Esforço estimado

| Item | Estimativa |
|---|---|
| SQLite schema + migration script | 2 dias |
| Refactor state.ts p/ ler de SQLite (saída de .graph/ direto) | 2 dias |
| Tools `changeset.open/claim/commit/abort/extend` | 4 dias |
| Lock pessimista (aquisição, negociação, TTL fiber) | 2-3 dias |
| Gate incremental + gate final (composição de módulos open-graph) | 3 dias |
| Events novos + router por subscription affinity | 2 dias |
| Reconnect + token | 1-2 dias |
| Watch-bridge adapter (`appendEvent` SQLite+JSONL, D7 revisado) | 2 dias |
| Cliente web: ghosts, lock indicator, side panel drafting, history view | 4-5 dias |
| Testes (10 scripts) | 3 dias |
| Docs p/ operar (README, exemplo de `.env`) | 1 dia |
| **Total** | **5-7 semanas** (1 dev, ~50% dedicação) |

Mais caro que Fase 1 (2-3 sem). Justificado: SQLite refactor + mutação
viva + locks.

---

## 12. Riscos e travas

1. **Gate determinístico em processo concorrente.** `intent-changeset.ts`
   do open-graph presume processo único. AQUI, múltiplos requests podem
   bater ao mesmo tempo. Travas:
   - SQLite WAL é single-writer serializado natural — toda mutação entra
     numa transação SQLite.
   - Gates rodam numa snapshot lida dentro da transação; nunca estado
     compartilhado mutável.
   - **INV-2 (Fase 2):** toda mutação passa por uma transação SQLite; nada
     escreve direto em memória.
2. **Watch herdado escreve direto no `.graph/` JSONL.** Com SQLite como
   índice live, o watch precisa escrever pelos dois caminhos. **D7
   (revisado):** adapter `watch-bridge` injeta `appendEvent` que grava em
   SQLite + JSONL simultaneamente (mesma mecânica que estava planejada na
   Fase 4 §13.2, antecipada p/ cá). Modo repo-linked é opcional via
   `WATCH_REPO_PATH`; default é puro knowledge.
3. **TTL fiber bloqueia o processo.** Fibre a cada 1min varre `locks` —
   barato. Mas tem que ser Bun-fiber, não setInterval que trava tudo.
   Usar `Effect.repeat` com `Effect.schedule` (effect-run.ts do open-graph
   base) p/ ficar consistente com o resto do monorepo.
4. **History sem paginação.** `graph.history` retorna TUDO desde seq. Para
   servers vivos meses, isto explode. **D7 (decidido):** limite default
   1000 eventos; `?limit=` para mais; `?since=` p/ paginação eficiente.
5. **SQLite em disco local.** Se servidor roda em container, volume do
   SQLite precisa ser mount persistente. README tem que explicitar.

---

## 13. Pesquisa pendente (não bloqueia spec, mas bloqueia código)

**Correção de gate (ver README):** itens 1 e 2 abaixo travam já a
**Fase 1** — o transport da Fase 1 depende do estado do SDK, e a Fase 1
já importa os módulos de grafo. Só o item 3 é exclusivo da Fase 2.

Antes de começar a scaffold, preciso ler:

1. **`@modelcontextprotocol/sdk` state-of-art:** a versão corrente suporta
   `resources/subscribe` nativamente ou foi renomeado? A ultima vez que
   olhei, MCP estava movendo subscriptions pra uma API separada. Travas
   spec: se mudou, seição 4.1 do `01-scope-phase-1.md` precisa atualizar
   também (mesma análise p/ Fase 1).
2. **exports dos módulos de grafo (RESOLVIDO):** os módulos `intent-changeset`,
   `roundtrip.scoped`, `authority.canFlip` estão efetivamente **exportados**
   pelo pacote `core`, ou só disponíveis dentro de `packages/opencode/src`?
   Se só dentro, preciso discussãotrade-off: copiar para `mcp-server` ou
   mover para `core`. Esta é uma decisão de **empacotamento**, não de
   produto; mas bloqueia código.
3. **`bun:sqlite` API de transactions em workers.** SQLite WAL no Bun:
   transações em workers separados de fibres precisam de cuidado
   para não serializar morto. Compatibility check.

---

## 14. Próximo documento

**Checkpoint de adoção (ver README):** antes de abrir a Fase 3, 2+
usuários reais usando o serviço semanalmente. Fases 3+4 somam 9–12
semanas de polish multiplayer; sem tração pós-Fase 2, pivô.

Após Fase 2 verde:

- `03-scope-phase-3.md` — presença live, broadcast agregado, router por
  subscription affinity completa.
- Cliente web: "quem está em que cell agora" (presença), diffs de changeset
  de outros holders em tempo real (não só ghosts, e;sinais de "digitando"),
  differencing visual.

---

## 15. Perguntas que eu tenho p/ você antes de seguir p/ Fase 3 spec

Após esta spec, antes de escrever `03-scope-phase-3.md`:

1. **Editor de claim rica no web client:** em Fase 2, formulário de claim é
   cru (textarea + JSON). Faz sentido investir UI de claim mais rica (com
   typeahead de refs, autocomplete de claims alvo de refs) em Fase 3 ou
   adiar p/ Fase 4?
2. **"Digitando" no multiplayer:** Fase 3 inclui presença; mas "digitando
   agora" é mais caro (frequent updates). Faz sentido deixar p/ Fase 4?
3. **Notificações em clientes MCP não-web (como opencode):** quando opencode
   não tem UI de canvas, como usuario recebe "seu changeset foi abortado por
   TTL"? Toast? System message? Decidir antes de implementar router de
   eventos em Fase 3.

---

## 16. Resumo executivo p/ você lembrar quando reler

**Fase 2 entrega:** mutação viva via changeset (turno) + locks pessimistas p/
β + SQLite autoritativo + ghosts alheios + reconnect reattach + auditoria
mínima.

**Fase 2 NÃO entrega:** presença rica, lock otimista, authz, federação.
Watch/drift **continua** (opcional, repo-linked — D7 revisado).

**Risco principal:** refactor SQLite autoritativo é a transição mais cara
do projeto inteiro. Estimativa honesta: 5-7 semanas p/ um dev júnior/pleno.
Tudo resto depois disso é composição em cima do SQLite.