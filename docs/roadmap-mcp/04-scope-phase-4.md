# Fase 4 — Escopo fechado (alfa multiplayer completo)

> Status: **escopo p/ execução** — após Fase 3 verde.
> ADR-pai: `docs/roadmap-mcp/ADR.md`. Anteriores: `01`, `02`, `03`.
>
> **Objetivo da Fase 4:** completar a metáfora de jogo multiplayer — lock
> otimista (além do pessimista de Fase 2) p/ permitir concorrência em cells
> α; rastreamento com rebase de changeset concorrente; permissões granular;
> validar drift detection (opcional desde a Fase 2) com código real de
> múltiplos devs.

Esta é a fase onde "continuar em outra sem conflito" passa de slogan p/
mecanismo real.

---

## 1. O que sai pronto no final da Fase 4

1. **Lock otimista** (modo C da ADR §6): cells α suportam múltiplos changesets
   concorrentes; commit verifica `base_seq` e rebasa ou aborta.
2. **Rebase de changeset**: servidor oferece `changeset.rebase` que pega um
   cs aberto e o re-aplica sobre o estado corrente (após outro cs admitido
   no meio).
3. **Permissões granular**: roles (admin, editor, observer) + permissões
   por cell.
4. **Auditoria exportável**: timeline exportável em JSON/CSV p/ auditoria
   externa.
5. **Watch/drift validado em cenário multi-dev**: o modo repo-linked é
   opcional desde a Fase 2 (D7 revisado); a Fase 4 o valida com múltiplos
   devs editando código real + corrida watch-vs-changeset (D11).
6. **Authz real**: tokens com permissões; não é só declarar `name`.

**Definição de pronto (DoD):**

- [ ] `changeset.open(cells=[X], mode='optimistic')` em cell α (não-β) →
      aceito mesmo que outro cs esteja aberto na mesma cell.
- [ ] Quando dois cs otimistas tocam a mesma cell e um commit:
      primeiro commit OK; segundo commit detecta `base_seq` mismatch →
      retorna `{ ok: false, reason: "stale_base", current_seq, rebaseable: true }`.
      Cliente pode chamar `changeset.rebase` explicitamente.
- [ ] `changeset.rebase(cs_id)` → re-aplica deltas sobre estado corrente;
     Falha se conflito de semântica (mesma claim sobrevida por dois cs);
      sucesso em caso contrario (broadcast `changeset.rebased`).
- [ ] Roles: admin (pode flip, pode force-release lock), editor (pode
      abrir/commit cs), observer (só recebe eventos). Configurável por user
      via `user.role` em SQLite.
- [ ] Permissões por cell: admin pode setar `cell_perms` (tabela nova)
      restringindo quem pode mutar qual cell.
- [ ] Token de sessão tem `role` embedded; ferramentas privilegiadas validam
      role no entrypoint.
- [ ] Watch loop opcional: servidor configurado com `WATCH_REPO_PATH` →
      detecta drift em nodes com `file` field e broadcasta `drift.node`
      (reaproveita `watch.ts` herdado).
- [ ] `graph.history.export(format='json'|'csv')` retorna timeline p/
      download.
- [ ] Teste de corrida: 10 cs otimistas abertos na mesma cell α;
      commitando em sequência; apenas o último rebase precisa; todos
      commitados OK sem abort manual.

---

## 2. O que NÃO está na Fase 4

- ❌ Federação cross-org (Fase 5).
- ❌ CRDT p/ offline (Fase 6).
- ❌ Hosted multi-tenant (decisão comercial separada — ver `roadmap-mcp/05-...`).
- ❌ Notificações push externas (e-mail/desktop) — continuação de Fase 3.
- ❌ Auth provedores externos (SSO/OAuth) — v1 usa tokens emitidos pelo
  server. SSO entra num futuro `auth-providers.md`.

---

## 3. Lock otimista — mecânica detalhada

### 3.1 Estados de uma cell

```
FREE ── open(mode='pessimistic') ──► LOCKED ── commit/abort/TTL ──► FREE
FREE ── open(mode='optimistic') ───► OPEN_SHARED
                                       │
                                       ├─ outro open(mode='optimistic') ──► OPEN_SHARED (N holders)
                                       │
                                       └─ commit(cs_id):
                                              ├─ se base_seq == current_seq → ADMIT
                                              ├─ se base_seq != current_seq:
                                              │    ├─ se rebaseável → REBASE (re-aplica deltas)
                                              │    └─ se não rebaseável → ABORT (conflito semântico)
                                              └─ broadcast changeset.committed|aborted|rebased
```

### 3.2 Regras

- **β cell**: só pessimista (estilo Fase 2). Modo otimista é recusado em
  cells β explicitamente (`reason: "beta_requires_pessimistic"`).
- **α cell**: aceita ambos modos; pessimista em α ainda funciona (não
  proibido, só menos útil).
- **Greenfield cell** (sem código, só intenção no grafo): tratada como α
  p/ efeito de lock.
- **base_seq**: cada cs aberto captura `current_seq` do server no momento
  do `open`. Commit compara com o `current_seq` do momento do commit.
  - Se `current_seq == base_seq`: ninguem cometeu nada desde que abri.
  - Se `current_seq > base_seq`: alguém admitiu algo. Rebase necessário.
- **Rebase**: re-aplica os deltas do cs sobre o estado corrente. Falha se:
  - Delta é `claim.add` mas o claim id já existe (criado por outro cs).
  - Delta é `authority.flip` mas a cell já flipou por outro cs.
  - Delta é `authority.demote` mas cell está em estado diferente.
  Em todos os casos, retorna `{ ok: false, reason: "conflict", conflict_detail`
  `}` com o delta problemático identificado; cliente decide abort ou editar.

### 3.3 Rebase é deterministicamente decidido

- Não há arbitragem LLM. O gate determinístico do open-graph decide se o
  rebase é válido.
- Se o rebase passa no gate final (`roundtrip scoped` + coverage + verify),
  vira o novo estado corrente.
- Se falha no gate incremental: detalha qual delta quebrou; cliente pode
  não resolver automaticamente.

### 3.4 Push-to-rebase vs explicit-rebase

- A commit-time detecta `stale_base` e retorna `rebaseable: true`.
- **PONTO DECISIVO D9:** rebase automático no commit (server tenta sem
  perguntar) ou explícito (cliente precisa chamar `changeset.rebase`)?
  - Auto: mais fluido ("Google Docs"); mas colapsa mudanças sem consentimento.
  - Explícito: mais controle; mas usuário precisa agir.
  - **Minha proposta D9: explícito.** Cliente MCP (web ou opencode) sempre
    tem UI/agente p/ resolver. Auto-rebase sem consentimento é hostil p/
    auditoria ("eu commitei A e o server gravou A+B?").
  - Mas cliente web tem um botão "Rebase & Commit" ao lado de "Commit"
    para fazer os dois em sequência (UX p/ produtivo sem perder
    explicidade).

---

## 4. Permissões granular

### 4.1 Roles (3 p/ v1)

- **admin**: tudo. Pode `authority.flip`, `force-release` locks, ver todos
  cs abertos (mesmo não seus), editar roles.
- **editor**: pode `changeset.open/claim/commit/abort`, ver todos cs
  públicos.
- **observer**: só pode ler (`graph.query`, `graph.history`, `presence.who`) e
  receber streams. Sem mutação.

### 4.2 Permissões por cell (opcional)

Tabela nova `cell_perms`:

```
cell_perms
  cell          TEXT
  user_id       TEXT
  perm          TEXT  -- 'edit' | 'observe' | 'admin'
  granted_by    TEXT
  granted_at    TEXT
  PRIMARY KEY (cell, user_id)
```

- Ausência de row: herda do role global do user.
- Presença de row: override granular.
- Admin pode revogar; editor não pode criar rows.

**Fase 4 entrega só** a estrutura; UI de gestão pode ser CLI/script admin
(inicial), não painel web. A especificação completa de UI admin é
pós-Fase 4 (recurso separado).

### 4.3 Token com role embedded

`session.token` (hex random) + `role` em SQLite (`sessions.role`). Server
valida role em cada tool call privilegiada. Tokens antigos (Fase 2/3) são
default editor (p/ não quebrar presença existente).

---

## 5. Watch/drift — validação multi-dev (herdado da Fase 2)

### 5.1 Configuração

Server pode ser iniciado em dois modos:

- **Modo puro knowledge** (default): sem watch. Grafo vive no
  SQLite; sem chão de código p/ ancorar.
- **Modo repo-linked** (existe desde a Fase 2, D7 revisado): env
  `WATCH_REPO_PATH=/path/to/repo`. Server
  lê nodes onde `file` non-null, roda `watch` herdado do open-graph sobre
  estes arquivos. Drift detectado vira `drift.node` event; se β cell →
  `authority.demoted` como em Fases anteriores.

### 5.2 Por que opcional

- O modo repo-linked existe desde a Fase 2 (D7 revisado); default sem
  `WATCH_REPO_PATH` é "knowledge graph sem código" (como
  brain-boilerplate).
- Fase 4 valida o modo com âncora em código sob concorrência real
  (múltiplos devs + changesets otimistas + corrida D11).
- Default continua: **watch desligado** sem `WATCH_REPO_PATH` configurado.

### 5.3 Implantação tópica (typical scenario)

- Time com 5 devs + 1 repo de código.
- Servidor open-graph dedicado p/ este repo: bootstrap inicial gera o
  grafo; env `WATCH_REPO_PATH` aponta p/ repo.
- Devs codam usual; `watch` fiber pega edits; eventos drift vão p/SSE;
  devs com canvas aberto vêem "drift em [ui:5]" em tempo real.
- Devs podem abrir cs (turnos) p/ atualizar intenção no grafo
  (re-ancorar o que mudou); commit admite; drift resolvido.

---

## 6. Authz — decisões específicas

### 6.1 Login p/ Fase 4

- **Não introduzimos OAuth/SSO ainda.** Token emitido pelo admin
  via CLI: `open-graph-admin token issue --name Alice --role editor`.
- Admin gera tokens; envia p/ users; users usam `?token=...` como antes.
- Rotate tokens: `--revoke`. Tokens em SQLite `sessions` table.
- **Decisão D10 (minha):** tokens têm expiração (default 90 dias); renew
  precisa admin. Isto é mínimo p/ auditoria.

### 6.2 Por que não SSO

- SSO exige provedor externo (Google, GitHub, Okta) — setup não trivial.
- v1 é single-org; admin gerencia tokens é suficiente.
- SSO entra quando **multi-org** aparece (Fase 5+).

---

## 7. Auditoria exportável

### 7.1 `graph.history.export`

- Query: `?format=json&since=2026-07-01&cell=ui:4&by_user=alice&kind=changeset.*`
- Output:
  - `format=json` → download `.json` arquivo.
  - `format=csv` → download `.csv` (mesmos campos, sem aninhamento).
- Limite default 10000 eventos; clique p/ next page.
- Admin role necessário p/ export completo (editor pode exportar só
  suas próprias actions).

### 7.2 Campos exportados

`seq, ts, kind, target_kind, target_id, by_user, by_session_agent,
payload(json), cs_id_if_applicable, intent_if_applicable`

Payload fica como JSON string em CSV; em JSON output é object nested.

---

## 8. Cliente web — novos pedaços UI

### 8.1 Modo-based picking

- Modal "Open Turn" em Fase 2 ganha botão **radio**:
  - `Pessimistic (lock-exclusive)` [default p/ β]
  - `Optimistic (rebase-on-commit)` [default p/ α; desativado p/ β]

### 8.2 Rebase UI

- Quando commit retorna `stale_base` + `rebaseable: true`:
  - Toast: "cs_abc em [ui:4] tem base velha. Rebase & Commit?"
  - Botões: `Rebase & Commit` / `Resolve deltas` (abre visual diff) /
    `Abort`.
- `Resolve deltas` mostra lista de deltas com checks (aplica/não aplica);
  usuário marcar um como "discarded" e commit sem ele.

### 8.3 Role indicator

- Topbar: avatar + role badge (ADMIN · EDITOR · OBSERVER).
- Admin vê extra: "Force Release Lock" button em cada cell LOCKED que não
  sua; clicar libera lock alheio (com mensagem "force-released by admin
  [name]; logged").

### 8.4 Cell perms mini-panel

- Em cells LOCKED: clicar → ver quem tem perm; admin pode adicionar/remover
  permissões inline. Novo users nao listados herdam role.

### 8.5 Drift indicator (se WATCH_REPO_PATH ativo)

- Sidebar inferior: "3 drifts unresolved" badge vermelha com contagem.
- Clique → lista de cells com drift; clique numa → canvas jump + side panel
  com `cause` (qual arquivo mudou, qual ancora quebrou).
- Resolve via criar cs que re-ancora.

---

## 9. Cliente MCP não-web

Semelhante a Fase 3, mas:

- `lock.denied` em β inclui mensagem sobre modo otimista disponível em α.
- `stale_base` vira system message com prompt action: "rebase? (yes/no)".
- Para opencode, agente pode responder yes automaticamente se   conflict detail; ou perguntar ao humano.

---

## 10. Schema SQLite novas tabelas

```sql
-- Em cima das de Fase 2
cell_perms
  cell          TEXT
  user_id       TEXT REFERENCES users(id)
  perm          TEXT NOT NULL  -- 'edit' | 'observe' | 'admin'
  granted_by    TEXT REFERENCES users(id)
  granted_at    TEXT NOT NULL
  PRIMARY KEY (cell, user_id)

-- Alteração em sessions:
ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'editor';
ALTER TABLE sessions ADD COLUMN expires_at TEXT;  -- D10

-- Alteração em changesets:
ALTER TABLE changesets ADD COLUMN lock_mode TEXT NOT NULL DEFAULT 'pessimistic';
```

Migration script `migrate-from-phase-3.ts` vai cuidar destas adições p/
instâncias pré-existentes.

---

## 11. Testes de aceite (Fase 4)

1. **optimistic-concurrent.test.ts**: 2 cs abertos otimista na mesma cell α;
   S1 commit OK; S2 commit → `stale_base` + `rebaseable: true`.
2. **rebase-success.test.ts**: cs_abc com 3 deltas; outro cs commit entre;
   chamar `changeset.rebase(cs_abc)` → 3 deltas re-aplicados;
   `changeset.commit` agora OK.
3. **rebase-conflict.test.ts**: dois cs tentam criar claim com mesmo id;
   segundo commit detecta conflito; rebase falha específico p/ aquele delta
   com `conflict_detail` nomeando o claim id contentious.
4. **beta-rejects-optimistic.test.ts**: open otimista em cell β → recusado
   com `reason: "beta_requires_pessimistic"`.
5. **role-enforcement.test.ts**: observer tentando `changeset.open` → 403;
   editor tentando `authority.flip` → 403; admin fazendo ambos → OK.
6. **cell-perms-override.test.ts**: editor X sem cell_perms em [ui:4]; admin
   seta `cell_perms(ui:4, X, observe)`; X agora não pode editar [ui:4]
   mesmo sendo editor global.
7. **token-expiry.test.ts**: token com expires_at no passado → todas tools
   Retorna 401.
8. **watch-reactivation.test.ts**: servidor startado com `WATCH_REPO_PATH`;
   drift edit em arquivo referenciado → `drift.node` broadcast; β cell
   demoted; visualizar na timeline.
9. **history-export.test.ts**: admite 10 cs; chamar `graph.history.export(
   format='json', since='...')` → JSON com 10 entries; `format='csv'` →
   CSV com mesmo conteúdo.
10. **force-release.test.ts**: cs_abc LOCKED por Alice; admin Bob chama
    `lock.force_release(cell, cs_id)` → lock liberado; cs_abc marcado
    `aborted` com reason `force_released`; broadcast.

---

## 12. Esforço estimado

| Item | Estimativa |
|---|---|
| Lock otimista + rebase mecânica | 4-5 dias |
| Permissões + integration em cada tool | 3 dias |
| Token com role + expiry | 1-2 dias |
| Validação watch multi-dev + corrida D11 (adapter já feito na Fase 2) | 1-2 dias |
| History export (JSON + CSV) | 1 dia |
| Cliente web update (rebase UI, role indicator, cell perms, drift panel) | 4-5 dias |
| System messages MCP (stale_base, permit denied) | 1 dia |
| Migration script Phase 3 → 4 | 1 dia |
| Testes (10 scripts) | 3-4 dias |
| Docs + README update | 1 dia |
| **Total** | **5-7 semanas** (1 dev, ~50% dedicação) |

---

## 13. Riscos e travas

1. **Rebase é não-trivial.** Pensar que é simplesmente "re-aplica os deltas"
   é falso: mudanças em Cells transitórias (authority, refs) tornam
   semântica complexa. Travas:
   - Implementar com `intent-changeset.ts` existente — já lida com atomicidade
     scoped.
   - Teste e2e: dois cs concorrendo em cascatas: A→B, B→C, cs_X  
     transverse-cascade. (Teste unitário isola.)
2. **Watch drift com SQLite como índice live.** Resolvido na Fase 2 (D7
   revisado): o adapter `watch-bridge → appendEvent` já escreve em
   SQLite + JSONL. Fase 4 só valida sob concorrência.
3. **Race entre watch drift e cs de usuários.** Cs admite com novo `token_hash`
   p/ um nó que watch (em paralelo) detecta como "gone" — quem ganha?
   - **D11 (revisado):** resolvido por **ordenação de seq global**, não
     por prioridade fixa. Eventos de watch e commits de changeset entram
     no mesmo log serializado pela transação SQLite; quem grava primeiro
     ganha aquele seq. Se o drift entra antes do commit, o commit detecta
     `stale_base` e rebasa sobre a demoção; se o commit entra antes, o
     próximo ciclo de watch reavalia contra o estado já admitido. Sem
     regra "watch ganha sempre" — a atomicidade da transação é a única
     árbitra.
4. **Sem authz granular em células que ninguem administrou.** Se todos herdam
   `editor` (default p/ Fase 2/3 existente), upgrade p/ Fase 4 não muda
   permissões de ninguem. Para habilitar cell_perms, admin tem que
   voluntariamente revogar `editor` p/ alguns users. Não é ação automática.
5. **CSV export p/ eventos com JSONPayload nested.** CSV stringify nested JSON
   precisa de escape de quotes. Fazer testes com casos patológicos (payload
   com newlines).
6. **Token expiry gracefully.** Usuário no meio de um turno longo → token
   expira → server não aborta seu cs (lock TTL cuida disso), mas tools
   novos recusados. UX toast: "Seu token expirou. Peça renewal ao admin."

---

## 14. Perguntas p/ você

1. **D9 (rebase explícito vs automático)**: proponho explícito (com botão
   "Rebase & Commit" como atalho). Confirma?
2. **D10 (tokens expiram em 90 dias)**: OK p/ v1? Ou prefere sem expiração
   p/ reduzir fricção? Minha prop: expira, renew fácil p/ admin via CLI.
3. **D11 (ordenação por seq global)**: corrida watch-vs-cs resolvida por
   quem grava primeiro no log (transação SQLite); o segundo rebasa.
   Confirma?
4. **Cell perms UI admin panel** — adiar p/ depois de Fase 4? Minha prop:
   sim, UI admin rica é produto separado (tipo "admin console"), não 
   parte do MVP multiplayer.

---

## 15. Resumo executivo

**Fase 4 entrega:** lock otimista + rebase + permissões granular + authz
REAL com tokens/roles + watch/drift validado multi-dev + export de
auditoria.

**Fase 4 NÃO entrega:** SSO, federação cross-org, push notifications
externos, CRDT offline, hosted multi-tenant.

**Risco principal:** rebase é a peça sutil; erros aqui = perda de dados
silenciosa. Estimativa 5-7 sem p/ 1 dev. Testes de corrida são o coração.

---

## 16. Próximo documento

Após Fase 4 verde, duas linhas possíveis:

- `05-scope-phase-5-federacao.md` — federação entre servidores (manifestos
  assinados Merkle, cross-org hosted).
- `05-business-hosted-vs-self-hosted.md` — discussão comercial / decisões
  de implantação multi-tenant. NÃO é código — é produto.

Ambas são v2+. A escolha entre as duas depende de adoção observada pós-Fase
4.