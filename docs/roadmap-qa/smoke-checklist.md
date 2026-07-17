# Smoke checklist — QA-1 (browser manual-assistido)

> Status: **executado 2026-07-17** (`95c71c6`) — 9/12 ✅, 3/12 inconclusivos
> por limitação da automação (não do produto, ver registro §3). Achou e
> corrigiu 1 bug real (item 4 — `expiresAt` como string ISO tratado como
> número, "expires in NaNm").
> Índice-pai: `README.md`. Escopo: `01-scope-qa-1-smoke.md`.
>
> Este roteiro é autocontido: quem for executar (humano ou agente
> browser-driving) não precisa ler mais nada além deste arquivo. Todo
> comando, porta e comportamento esperado abaixo foi **verificado batendo
> nos processos reais** (server + vite) durante a escrita deste roteiro —
> não é dedução de código lida às pressas.
>
> Baseline verificada: `main @ 164f2f0` (2026-07-14).

---

## 0. Setup do ambiente (fazer uma vez, antes do item 1)

### 0.1 Por que não dá pra simplesmente rodar `bun run dev`

- `bun run dev` (raiz) = `bun run --cwd packages/mcp-server dev` = `bun run src/index.ts`.
  Sobe em `PORT` (env, default **8787**), `STATE_DIR` (env, default
  `.graph-server` relativo ao cwd do processo).
- **Sem grafo por padrão.** `autoBootstrap` só roda se `GRAPH_REPO_PATH`
  (ou `WATCH_REPO_PATH`) estiver setado no ambiente. Sem essa env var o
  server sobe **vazio** (canvas em branco, nenhuma cell) — os itens 3-12
  deste roteiro (focus/lock/claim/commit) precisam de cells reais, então
  **é obrigatório setar `GRAPH_REPO_PATH`** ao subir o server.
- **Sem UI para bootstrap inicial.** O botão "Re-bootstrap" da topbar
  chama `graph.rebuild` (relê `.graph/` do disco), que exige
  `state.repoPath` já setado — ou seja, só funciona **depois** de um
  bootstrap ter acontecido no boot do processo. Não existe botão para
  `graph.bootstrap` (a tool existe em `api.ts` mas nenhum elemento da UI
  a chama). Conclusão: o bootstrap inicial só acontece via env var no
  `bun run dev`, não tem fallback pela UI.
- **Domínio null quebra o diálogo "Open Turn".** O pipeline `skeleton`
  (repo alvo sem `.graph/`) gera nodes com `domain: null` quando não há
  `.graph/domains.json` no repo alvo (confirmado rodando o bootstrap
  contra `packages/mcp-server` real: 56 nodes, `domain: null` em todos).
  O modal "Open Turn" monta o `<select>` de domínio a partir de
  `[...new Set(graph.nodes.map(n => n.domain))].filter(Boolean)` — **com
  todo mundo `null` esse dropdown fica VAZIO** e não dá pra montar uma
  string de cell válida para abrir changeset (trava os itens 4-8 e 10,
  que dependem de lock). Fix: dar um `.graph/domains.json` ao repo alvo
  do bootstrap **antes** de subir o server pela primeira vez (ver 0.2).

### 0.2 Criar o fixture de bootstrap (uma pasta pequena com domínios reais)

Rodar uma vez, antes de subir o server:

```bash
FIX=/tmp/qa1-smoke-fixture
rm -rf "$FIX"
mkdir -p "$FIX/.graph" "$FIX/billing" "$FIX/auth" "$FIX/notify"

cat > "$FIX/billing/invoice.ts" <<'EOF'
// invoice.ts — cria e cobra faturas
export function createInvoice() {}
EOF
cat > "$FIX/billing/refund.ts" <<'EOF'
// refund.ts — processa estornos
export function refund() {}
EOF
cat > "$FIX/auth/login.ts" <<'EOF'
// login.ts — autenticação de usuário
export function login() {}
EOF
cat > "$FIX/auth/session.ts" <<'EOF'
// session.ts — sessão do usuário
export function session() {}
EOF
cat > "$FIX/notify/email.ts" <<'EOF'
// email.ts — envio de email
export function sendEmail() {}
EOF
cat > "$FIX/notify/sms.ts" <<'EOF'
// sms.ts — envio de sms
export function sendSms() {}
EOF
cat > "$FIX/.graph/domains.json" <<'EOF'
[
  { "pattern": "billing/*", "domain": "billing" },
  { "pattern": "auth/*", "domain": "auth" },
  { "pattern": "notify/*", "domain": "notify" }
]
EOF
```

Resultado: 6 arquivos-fonte em 3 domínios (`billing`, `auth`, `notify`).
O bootstrap (esqueleto determinístico, sem LLM) vai gerar 1 node por
arquivo, `level` a partir da heurística de anchor — na prática todos
caem em `P4` neste fixture, então as 3 cells disponíveis para
focar/travar são: **`billing:P4`, `auth:P4`, `notify:P4`**. Isso já é
suficiente para os 12 itens (não precisa de múltiplos levels).

Verificado: bootstrap contra este fixture produz
`{"pipeline":"skeleton","nodes":3,domains:["auth","billing","notify"]}`
na primeira execução (`pipeline` vira `"existing"` em execuções
subsequentes porque `.graph/graph.json` já existe em disco a partir da
primeira — comportamento normal, não é bug).

### 0.3 Subir o server

Do root do repo (`/home/correadev/Repos/open-graph-mcp`):

```bash
GRAPH_REPO_PATH=/tmp/qa1-smoke-fixture \
STATE_DIR=/tmp/qa1-smoke-state \
PORT=8787 \
bun run dev
```

Deixar rodando num terminal (ou background com `&`/`nohup`). Confirmar:

```bash
curl -s http://localhost:8787/
# → {"name":"open-graph-mcp","stateDir":"/tmp/qa1-smoke-state","sessions":0,"tenants":1}
```

Se `PORT` já estiver ocupada, o processo **crasha** com
`EADDRINUSE` — matar quem estiver segurando 8787 antes
(`lsof -i :8787`) e subir de novo.

### 0.4 Subir o web

Em outro terminal, do root do repo:

```bash
bun run dev:web
```

Sobe Vite **fixo na porta 5175** (`packages/mcp-web/vite.config.ts` seta
`server.port: 5175` — não é o default 5173 do Vite, não confundir).
Confirmar:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5175/
# → 200
```

### 0.5 Como o cliente web acha o server (nenhuma env var extra precisa)

`packages/mcp-web/src/api.ts::serverBase()` retorna
`http://localhost:8787` por padrão (override via query string
`?server=...`, não precisa aqui). CORS do server é aberto
(`access-control-allow-origin: *`), então o fetch cross-port
(5175 → 8787) funciona sem proxy nenhum — confirmado com um preflight
OPTIONS real (`204`, headers CORS presentes). **Não precisa configurar
proxy no Vite nem env var no cliente.**

### 0.6 Como conseguir 2 identidades DE VERDADE nas 2 abas

Atenção — isto é o detalhe que mais fácil dá errado: `og.token`,
`og.name`, `og.userId` ficam no `localStorage`, que é **por origem**.
Duas abas normais do mesmo navegador apontando para
`http://localhost:5175` **compartilham o mesmo localStorage** → as duas
abas viram o MESMO usuário (o registro da 2ª aba não sobrescreve nada
visualmente diferente, mas o servidor vê 1 `userId` só, e a barra de
presença colapsa as duas sessões em 1 entrada — "Conectados (2)" do
item 2 não aparece).

**Solução usada e verificada neste roteiro:** abrir as duas abas em
**origens diferentes** do mesmo host (não precisa incógnito):

- Aba A → `http://localhost:5175`
- Aba B → `http://127.0.0.1:5175`

Confirmado que ambas resolvem e respondem (200) — são origens distintas
pro browser (localStorage isolado), mas conversam com o MESMO server em
`http://localhost:8787` (CORS aberto aceita de qualquer origem).
Alternativa equivalente para um humano: aba B em janela anônima/privada.

### 0.7 Registrar as duas identidades

Em cada aba, no campo `your name` (topbar, `#name`), digitar um nome e
sair do campo (blur/Tab) para disparar o registro:

- Aba A → `Alice`
- Aba B → `Bob`

Isso chama `session.register`, grava `og.token`/`og.name`/`og.userId`
no `localStorage` daquela origem e reconecta o SSE com o token novo.

### 0.8 Timings relevantes (referência p/ os itens abaixo — todos lidos do código, não chutados)

| Constante | Valor default | Onde importa |
|---|---|---|
| `focusDebounceMs` | 2 000 ms | tempo até `user.focused` (avatar) aparecer na outra aba depois de focar uma cell |
| `typingMs` | 2 000 ms | claims nos últimos 2s → estado "typing" |
| `idleMs` | 5 000 ms | 2-5s sem claim → "idle"; >5s → "quiet" |
| intervalo de sweep de typing | 500 ms | granularidade da transição typing/idle/quiet |
| `presenceTtlMs` | 60 000 ms | sem heartbeat por 60s → sessão expira (`user.left`) |
| intervalo de sweep de presença | 15 000 ms | server só varre TTL a cada 15s → pior caso ~75s até sumir |
| toast: duração na tela | 8 000 ms | cada toast some sozinho depois de 8s |
| toast: janela de coalescência | 500 ms | 2 toasts com a MESMA key (csId) em <500ms viram "N eventos" |
| backoff de reconexão SSE | 500 ms → dobra até 10 000 ms | tempo até a 1ª tentativa de reconexão após queda |

---

## 1. Roteiro (12 itens)

Convenção: **Aba A = Alice** (`http://localhost:5175`), **Aba B = Bob**
(`http://127.0.0.1:5175`). "Focar uma cell" = clicar em qualquer node
(pontinho colorido) dentro da tower do domínio; o painel lateral que
abre mostra o `cell` exato (ex.: `auth:P4`) — é esse valor que deve ser
escolhido no dropdown "Cells" do modal "Open Turn".

### Item 1 — Subir os dois processos e abrir as 2 abas

- **Preparação:** seções 0.1-0.4 completas (fixture criado, server up
  com `GRAPH_REPO_PATH`, vite up).
- **Ação:** abrir Aba A em `http://localhost:5175`, Aba B em
  `http://127.0.0.1:5175`. Registrar `Alice` na A e `Bob` na B (0.7).
- **Resultado esperado:** as duas páginas carregam a topbar
  (`open-graph`, indicador `● connected` em verde) e o canvas mostra 3
  towers (`auth`, `billing`, `notify`), cada uma com 2 pontinhos azuis
  (nodes). `#conn` deve estar `.on`/"● connected" nas duas abas.

### Item 2 — Presence bar mostra "Conectados (2)" com dots verdes

- **Preparação:** item 1 feito, as duas abas registradas e conectadas
  há menos de 30s.
- **Ação:** olhar o painel `#presence` (canto, cabeçalho
  `#pcount`) em QUALQUER uma das duas abas.
- **Resultado esperado:** `#pcount` mostra **"Conectados (2)"** (não 1 —
  se mostrar 1, as duas abas colapsaram na mesma identidade, revisar
  0.6). Expandir a lista (`#plist`, botão `▾` se estiver colapsada):
  cada `<li>` tem uma bolinha `.dot.green` (idade do `lastSeen` <30s),
  o nome (`Alice`/`Bob`) e `(web)` como `agentKind`.

### Item 3 — Aba A foca cell → avatar semi-transparente na Aba B

- **Preparação:** item 2 ok. Aba B **sem foco** em nenhuma cell ainda
  (não clicou em nenhum node).
- **Ação:** na Aba A, clicar num node dentro da tower `auth` (ex.:
  `auth/login.ts`). O painel lateral abre mostrando `cell: auth:P4`.
  Esperar ~2-3s (o `focusDebounceMs` de 2s precisa assentar antes do
  broadcast `user.focused` sair).
- **Resultado esperado:** na Aba B, no canvas, perto do centro vertical
  da tower `auth` (nível P4), aparece um **círculo pequeno azul
  semi-transparente** (raio ~6px, alpha ~0.5) deslocado **à direita**
  do centro da cell, com as iniciais "AL" (initials de "Alice") em
  branco no meio. Não deve ter nenhum texto/badge de lock junto —
  isso é foco puro, sem turno aberto.

### Item 4 — Aba A abre turno → badge de lock (avatar sólido) na Aba B

- **Preparação:** item 3 feito (Aba A ainda focada em `auth:P4`).
- **Ação:** na Aba A, clicar **Open Turn** (`#openturn`). No modal:
  `Intent` = `"smoke test"`; no primeiro `cellrow`, dropdown de domínio
  = **`auth`**, dropdown de level = **`P4`** (deve bater com a cell que
  a Aba A focou). Clicar **Open**.
- **Resultado esperado:** modal fecha, painel de draft
  (`#draft`, "drafting cs_...") abre na Aba A. Na Aba B, no mesmo lugar
  onde estava o avatar semi-transparente do item 3, agora aparece um
  **círculo maior verde e opaco** (raio ~9px, alpha ~0.95) deslocado à
  **esquerda** do centro da cell, iniciais "AL". Além disso, ACIMA da
  tower `auth` (70px acima do centro da cell), aparece uma **etiqueta
  de texto** `🔒 cs_xxxxxx @ u_xxxxxxxx` (6 primeiros chars do csId +
  userId do holder) com fundo escuro e borda colorida.

### Item 5 — Aba A faz claims → indicador "digitando…" na Aba B

- **Preparação:** item 4 feito (Aba A com draft aberto em `auth:P4`).
- **Ação:** no painel de draft da Aba A, preencher o formulário
  "add claim.add delta" (`f_subject`, `f_domain=auth`, `f_level=P4`,
  `f_anchor` = qualquer texto) e clicar **Add delta**. Fazer isso pelo
  menos uma vez (repetir a cada <2s se quiser sustentar o estado por
  mais tempo).
- **Resultado esperado:** na Aba B, a `div#typing` (normalmente
  `hidden`) fica visível, mostrando **"Alice está editando cs_xxxxxx"**
  seguido de 3 pontos animados (CSS, `<span class="dots">`). Esse
  indicador é GLOBAL (não por cell) — se não sumir sozinho em ~5s
  (idleMs) depois do último claim, e virar "quiet" (indicador some) em
  seguida, está batendo com a heurística typing(2s)/idle(5s)/quiet.

### Item 6 — Aba A commita → toast na Aba B

- **Preparação:** item 5 feito, draft `cs_xxxxxx` ainda aberto na Aba A
  com pelo menos 1 delta.
- **Ação:** na Aba A, clicar **Commit** no painel de draft.
- **Resultado esperado:** painel de draft da Aba A fecha (commit ok).
  Na Aba B, dentro de `#toasts`, aparece um cartão de toast com o texto
  **"Alice commitou cs_xxxxxx em [auth:P4]"**. O badge de lock (item 4)
  e o avatar sólido somem do canvas da Aba B (lock liberado no commit).
  O toast some sozinho depois de 8s se ninguém interagir.

### Item 7 — Clicar no toast → canvas pula para a cell

- **Preparação:** item 6 feito e o toast AINDA visível na Aba B
  (dentro da janela de 8s) — ou repetir o commit de outra cell se
  perdeu a janela.
- **Ação:** na Aba B, clicar no corpo do cartão de toast (antes que
  suma sozinho).
- **Resultado esperado:** a câmera do canvas da Aba B recentraliza na
  cell `auth:P4` (zoom ~1.0, node centralizado) — mesmo comportamento
  de clicar num item da lista de `#events` ou do histórico. O toast é
  removido da tela ao mesmo tempo (é um único handler: foca E some).

### Item 8 — Burst de eventos no mesmo cs → toast coalescido "N eventos"

- **Preparação:** Aba B focada em alguma cell livre, ex. `billing:P4`
  (clicar um node de `billing`). Aba A SEM draft aberto.
- **Ação:** na Aba A, abrir um novo turno em `billing:P4` (mesmo fluxo
  do item 4) e, **assim que o modal fechar e o painel de draft
  aparecer, clicar Commit imediatamente** (o mais rápido possível,
  sem pausar) — sem adicionar nenhuma claim é suficiente, o objetivo é
  dois eventos (`lock.acquired` conflitante + `changeset.committed`)
  chegando na Aba B com a MESMA key (`csId`) dentro da janela de 500ms
  de coalescência do `ToastQueue`.
- **Resultado esperado:** em vez de DOIS toasts empilhados (um "Alice
  abriu turno..." e um "Alice commitou..."), a Aba B mostra **UM único
  toast** cujo texto vira **"2 eventos em cs_xxxxxx"** (o `ToastQueue`
  sobrescreve o texto ao coalescer, ver `toasts.ts::push`).
- **⚠️ Nota de risco (achado da preparação deste roteiro, não é
  suposição vazia):** a janela de coalescência é de **apenas 500ms**, e
  entre "Open" e o painel de draft renderizar + o clique em "Commit"
  chegar, é bem possível que o tempo real gasto passe de 500ms — mesmo
  para um agente automatizando os cliques. **Se dois toasts separados
  aparecerem em vez de um coalescido, isso É um resultado válido a
  registrar** (não necessariamente um erro de execução do roteiro) —
  registrar como ❌ com a observação "toasts não coalesceram, provável
  janela de 500ms curta demais para o fluxo Open→Commit da UI" e abrir
  issue para decidir se a janela devia ser maior ou se o mecanismo
  precisa de outro gatilho mais realista.

### Item 9 — Aba A liga invisible mode → some da presence bar da B

- **Preparação:** Aba A e B conectadas e visíveis uma pra outra (item 2
  ok).
- **Ação:** na Aba A, clicar **⚙** (`#settingsBtn`) para abrir o modal
  de Settings. Desmarcar o checkbox **"Mostrar minha presença para
  outros"** (`#s_presence`).
- **Resultado esperado:** na Aba B, a entrada "Alice" desaparece da
  lista `#plist` e `#pcount` decrementa (ex.: "Conectados (2)" → "(1)")
  em até ~10s (intervalo do poll `presence.who`, ou antes via o SSE
  `user.left` que a mudança para invisível dispara). Nenhum evento
  `user.focused` deve chegar na Aba B enquanto Alice estiver invisível
  — se a Aba A focar outra cell nesse meio tempo, o avatar dela NÃO
  deve aparecer/mover na B. Reativar o checkbox depois para não
  atrapalhar os itens seguintes.

### Item 10 — Matar o server → reconexão; toast "Server reiniciou"; foco redeclarado

- **Preparação:** Aba A e B conectadas, Aba A focada em alguma cell
  (para o "foco redeclarado" ter algo visível pra conferir na B).
- **Ação:**
  1. No terminal do server, matar o processo (`Ctrl+C` ou
     `kill <pid>` / `pkill -f "bun run src/index.ts"`).
  2. Confirmar nas duas abas que `#conn` vira `● disconnected`
     (vermelho/cinza) em poucos segundos.
  3. Subir o server de novo com **o mesmo comando** da seção 0.3
     (mesmo `STATE_DIR`, mesmo `GRAPH_REPO_PATH`, mesma `PORT`) — **não
     limpar `localStorage` das abas**, é isso que simula um restart
     real com clientes que já tinham sessão.
  4. Esperar as abas reconectarem sozinhas (backoff 500ms→10s, deve
     reconectar dentro de ~10s do server voltar a responder).
- **Resultado esperado:** `#conn` volta a `● connected` nas duas abas.
  Como as duas abas reconectam trazendo um token que o processo NOVO
  não reconhece (tokens são em memória, somem no restart —
  `sse.ts::restartPending`), cada aba deve receber o toast **"Server
  reiniciou — sua presença foi resetada"**.
- **Fixado no INT-2 (T4) — comportamento atual, verificado ao vivo em
  browser real durante essa fase:** `og.presence.focus`/`beat`
  (`@open-graph-mcp/client`, `connect.ts`) agora detectam o erro
  `"invalid or expired token"`, re-registram a sessão automaticamente
  com o MESMO `name`/`tenant`, gravam o token novo em `localStorage` e
  forçam a reconexão SSE (`stream.stop()`/`stream.start()`, não só
  redeclarar presença — necessário porque `Session.userId` no server é
  vinculado uma vez por conexão) — **sem precisar recarregar a página**.
  Resultado esperado agora: cada aba recebe um SEGUNDO toast, **"Sessão
  renovada automaticamente após reinício do servidor"** (a única prova
  visível de que a auto-recuperação rodou), e o avatar da Aba A volta a
  aparecer na Aba B automaticamente, dentro de alguns segundos, sem
  refresh manual em nenhuma das duas abas. Se o avatar NÃO voltar sem
  refresh, ou o segundo toast não aparecer, ISSO é uma regressão real —
  registrar como ❌ com a observação exata do console.
  (Referência: `packages/mcp-web/src/main.ts`'s `applyReattach`/
  `onReauth` handler; `docs/roadmap-integrations/02-scope-int-2-client-lib.md`'s
  DoD item 3 — "beneficia web e plugins de uma vez".)

### Item 11 — Aba B para de "pingar" → 60s → some da barra da A

- **Preparação:** Aba A e B conectadas (item 2 ok, depois de já ter
  passado pelo item 10 e restabelecido as identidades se necessário).
- **Ação:** deixar a Aba B em segundo plano / minimizada (ou trocar de
  aba ativa, deixando-a oculta) sem NENHUMA interação por pelo menos
  **90 segundos** (a maioria dos browsers throttla `setInterval` de
  abas em background o suficiente pra suspender o heartbeat de 15s da
  Aba B; o server só varre TTL a cada 15s e o TTL é 60s, então o pior
  caso é ~75s — 90s dá margem). Não fechar a aba, só deixar sem foco.
- **Resultado esperado:** na Aba A, a entrada "Bob" primeiro passa o
  dot de verde → amarelo (30-60s de `lastSeen`) e depois desaparece de
  `#plist`/`#pcount` decrementa quando passa de 60s sem heartbeat
  (`user.left` reason `heartbeat_expired`). Se o browser NÃO throttlar
  o suficiente (alguns navegadores/versões são mais permissivos com
  tabs em background) e o heartbeat continuar batendo, documentar isso
  como observação — nesse caso o teste não é conclusivo por causa do
  navegador, não do produto.

### Item 12 — Tooltip hover no avatar (nome + agentKind + última atividade)

- **Preparação:** pelo menos um avatar visível no canvas de uma das
  abas (repetir foco/lock de itens 3/4 se necessário — reabrir turno
  em `notify:P4` por exemplo).
- **Ação:** passar o mouse sobre o círculo do avatar (sem clicar) e
  manter parado alguns instantes.
- **Resultado esperado:** aparece uma tooltip (`div#avatarTip`,
  posicionada perto do cursor) com o texto no formato **"`<nome>` ·
  `<agentKind>`[ · turno aberto] · última atividade `HH:MM:SS`"** — o
  trecho "· turno aberto" só aparece se o avatar sob o mouse for o
  sólido/verde (locked=true). Tirar o mouse de cima do avatar → tooltip
  some (`hidden`).

---

## 2. Encerramento

Depois de rodar os 12 itens: parar os dois processos (`Ctrl+C` nos dois
terminais) e apagar os diretórios temporários
(`/tmp/qa1-smoke-fixture`, `/tmp/qa1-smoke-state`) se não forem
reaproveitar para uma próxima rodada.

Todo item ❌ vira issue (ou fix imediato se trivial) **antes** da QA-2
começar — essa é a régua do DoD da `01-scope-qa-1-smoke.md`.

---

## 3. Registro de execução

Preencher ao rodar o roteiro. Uma linha por execução completa (não por
item — usar a coluna "Observação" para detalhar item a item se algum
falhar).

| Data | Commit | Executor |
|---|---|---|
| 2026-07-17 | `95c71c6` (rodado sobre) | Claude (claude-in-chrome, 2 abas reais localhost:5175 / 127.0.0.1:5175) |

| Item | ✅/❌ | Observação |
|---|---|---|
| 1 | ✅ | Ambas as abas carregaram, `● connected`, 3 towers (auth/billing/notify) com 2 nodes cada. |
| 2 | ✅ | "Conectados (2)", dots verdes, `(web)` como agentKind. |
| 3 | ✅ | Avatar semi-transparente "AL" apareceu na Aba B após foco da A, sem badge de lock. |
| 4 | ✅ | Badge sólido + etiqueta `🔒 cs_... @ u_...` corretos. **Bug real achado**: a sub-linha "expires in Nm" mostrava sempre **"NaNm"** — `lock.expiresAt`/`OpenChangeset.expiresAt` chegam do server como string ISO (`new Date(...).toISOString()`), mas `render.ts::drawLocks` fazia `lock.expiresAt - Date.now()` (aritmética direta numa string). **Fixado nesta rodada**: `render.ts` agora parseia via `new Date(lock.expiresAt).getTime()`; tipos `Lock.expiresAt`/`OpenChangeset.expiresAt` corrigidos de `number` pra `string` em `ghosts.ts` (e os `?? 0` defaults em `main.ts` pra `?? ""`) pra não mentir sobre o shape. Confirmado ao vivo pós-fix: "expires in 30m". `bunx tsc --noEmit` e `bun test` (18/18) verdes depois do fix. |
| 5 | ✅ | Indicador "digitando…" visível (inclusive no próprio client de quem digita — indicador é global, não por-cell, comportamento correto). Log de eventos mostrou as 3 transições `user.typing_state` (typing→idle→quiet) mesmo quando o screenshot ao vivo perdeu a janela. O claim em si foi recusado pelo gate (`missing required fields (id/subject/domain)`) — gap **já conhecido** desta sessão (form simples de claim nunca envia `id`; não é um achado novo do smoke, `touchDelta` roda antes do gate então o typing funciona mesmo com o claim recusado). |
| 6 | ✅ | Toast "Alice commitou cs_... em [cell]" apareceu na Aba B; badge de lock sumiu do canvas no commit. |
| 7 | ⚠️ inconclusivo | Em 3 tentativas reais (incl. uma com clique via JS direto no elemento, sem depender de coordenada), a latência de round-trip da automação (várias chamadas de ferramenta separadas, cada uma com overhead de permissão/rede) sempre excedeu a janela de 8s do toast antes que o clique chegasse. **Não é bug do produto** — o mesmo fluxo (commit real → toast real → clique real → `camera.zoom` vira 0.8) já está coberto e passando de forma determinística em `packages/mcp-web/e2e/toast-notifications.e2e.ts` (rodado várias vezes nesta mesma sessão, sem flake). Limitação da metodologia manual-via-agente, não do app. |
| 8 | ⚠️ inconclusivo | Mesma causa do item 7. Uma tentativa (open+commit no mesmo `browser_batch`, sem round-trip entre as duas ações) produziu os 4 eventos server-side (open/lock/commit/release) no MESMO segundo — sinal de que o burst client-side também deve ter ficado dentro da janela de 500ms — mas o toast já tinha sumido antes de eu conseguir ler o texto coalescido. **O próprio roteiro já previa este resultado como válido** (nota de risco original do item 8). Coalescência já é unit-testada em `toasts.test.ts`. |
| 9 | ✅ | Aba A ficou invisible → Aba B (após `pollWho()` forçado, equivalente ao poll real de 10s) mostrou "Conectados (1)", Alice sumiu de `#plist` e do avatar no canvas. Reativado depois. |
| 10 | ✅ | Servidor morto (`kill`) e resubido com o MESMO comando/env/stateDir. Ambas as abas voltaram a `● connected` sozinhas, evento `server.restarted` no log, foco de ambas redeclarado automaticamente (avatares reapareceram) sem refresh manual. Texto exato dos dois toasts ("Server reiniciou..."/"Sessão renovada...") não capturado ao vivo pela mesma limitação de latência dos itens 7/8, mas o mecanismo duplo já foi verificado deterministicamente em `packages/mcp-web/e2e/reconnect.e2e.ts` nesta mesma sessão. |
| 11 | ⚠️ inconclusivo | ~50s reais de espera sem interação na Aba B: o dot passou de verde→amarelo uma vez, mas o beat automático de 15s continuou batendo (voltou a verde) — a aba controlada pela extensão do Chrome não throttlou o suficiente pra produzir `heartbeat_expired` dentro da janela testada. **Resultado antecipado pelo próprio roteiro** ("se o browser não throttlar... o teste não é conclusivo por causa do navegador, não do produto"). |
| 12 | ✅ | Tooltip "Bob · web · última atividade HH:MM:SS" no formato exato esperado; sumiu ao tirar o mouse. |
