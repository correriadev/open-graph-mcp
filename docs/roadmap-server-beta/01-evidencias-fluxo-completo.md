# SB-0b — Exercício do fluxo completo via MCP, com evidências

> Data: 2026-08-07. Antes de empacotar qualquer release, exercitar o produto
> além do `graph.bootstrap`: escada bidirecional (bottom-up e top-down),
> autoridade, análise de impacto, drift, concorrência e notificação.
> Tudo abaixo é saída real de um servidor rodando, não comportamento esperado.

## Montagem

Repo controlado de 3 arquivos (para que a cobertura de uma célula seja
alcançável de verdade — no `harness-kit`, `sdk` tem 149 nós):

```
demo-repo/auth/login.ts      export function login(user, password)  → chama verify()
demo-repo/auth/verify.ts     export function verify(user, password)
demo-repo/billing/invoice.ts import { login } from "../auth/login"
```

`DOMAINS='[{"pattern":"auth/*","domain":"auth"},{"pattern":"billing/*","domain":"billing"}]'`

```
BOOTSTRAP: {"nodes":3,"edges":1,"claims":0,"domains":2,"pipeline":"indexed"}
```

**`claims: 0`.** Um grafo recém-indexado é esqueleto estrutural: nós em `P4`,
âncora = primeira linha não-vazia, uma aresta `depends-on` resolvida. Nenhum
conhecimento. É o ponto de partida de qualquer sessão real.

---

## 1. O que FUNCIONA (e é o coração do produto)

### 1.1 O gate de âncora recusa o que o código não sustenta

```
L4 login  (âncora real):        {"ok":true,...}
L4 verify (âncora real):        {"ok":true,...}
L4 "verify() faz hash bcrypt":  {"ok":false,"reasons":["anchor not found verbatim in auth/verify.ts"]}
```

Esta é a propriedade que separa o produto de um índice qualquer: a LLM propõe,
o gate determinístico decide, e afirmar além do que o arquivo diz é bloqueio
duro — não aviso.

### 1.2 A escada bidirecional (ascent) fecha

```
L5 chão auth/login.ts   {"ok":true}   ← claim-raiz no extremo (level 5, refs [])
L5 chão auth/verify.ts  {"ok":true}
L4 c_login_p4           {"ok":true}   ← refs: ["auth/login.ts"]  (adjacência 5→4)
L4 c_verify_p4          {"ok":true}
COMMIT:                 {"ok":true,"admitSeq":15}
```

O gate final valida o conjunto inteiro atomicamente: adjacência de nível,
raízes só nos extremos (0 ou 5), sem órfão de meio-escada, sem ciclo.

### 1.3 Autoridade β é ganha provando cobertura

```
auth:4 antes:  {"authority":"source","nodeCount":2,"claimCount":2}
flip auth:4 → graph:  {"ok":true,"admitSeq":50}
auth:4 depois: {"authority":"graph","nodeCount":2,"claimCount":2}
```

E recusada quando não há prova:

```
flip billing:4 → graph:
  {"ok":false,"reasons":[
     "coverage not balanced in β cell billing:4: 1 node(s) without claims",
     "authority.flip billing:4: cell coverage not closed"]}
```

### 1.4 Drift demove — β é privilégio revogável

Renomeando `login` → `authenticate` no arquivo (a âncora da claim some), com o
watch ligado:

```
drift.node       @seq54  target auth/login.ts  cause "structural" status "stale"
authority.demoted@seq55  target auth:4         status "suspended"
watch.converged  @seq56
```

O ciclo inteiro — código muda embaixo de um grafo que se dizia autoritativo, o
servidor detecta sozinho e retira o privilégio — funciona ponta a ponta.

### 1.5 Concorrência: trava pessimista e `lock.denied` privado

```
alice abre billing:4 → {"csId":"cs_3549b1e6..."}
bob tenta a mesma    → {"ok":false,"reason":"cell_locked","holder":"u_27a337...","expiresAt":"..."}

quem recebeu lock.denied:  alice 0  |  bob 1
```

O roteador de afinidade restringe `lock.denied` a quem tentou. Ninguém mais
descobre que você bateu numa porta trancada.

### 1.6 Notificação em texto para agente sem canvas

```
[open-graph] alice abriu turno em [billing:4]. Sua edição concorrente pode
             depender de mudanças dele — considere esperar ou focar outra cell.
[open-graph] Não foi possível abrir turno em [billing:4] — já travada por alice.
```

Drenado por `system.pending`, sem SSE, de processo novo.

---

## 2. Achados

### F1 (CRÍTICO) — o gate de autoridade falha ABERTO na forma canônica da célula

`nodesOfCell` (`gates.ts`) tira o prefixo `P` do nível do **nó**, mas compara
com o nível da **célula** sem tirar:

```ts
nodes.filter((n) => n.domain === domain && String(n.level).replace(/^P/, "") === level)
//                                         "P4" → "4"        ===        "P4"   ← nunca casa
```

A mesma célula, escrita de duas formas, dá resultados opostos:

```
graph://cell/billing:P4  {"authority":"graph","nodeCount":0,"nodes":[]}
graph://cell/billing:4   {"authority":"source","nodeCount":1,"nodes":[{"id":"billing/invoice.ts",...}]}

flip billing:P4 → graph  {"ok":true,"admitSeq":30}          ← APROVADO sem cobertura nenhuma
flip billing:4  → graph  {"ok":false,"reasons":["coverage not balanced..."]}
```

Com zero nós encontrados, `claimCoverage` recebe `meta: []`, devolve
`balanced: true` **vacuamente**, e o gate β aprova qualquer coisa.

Agrava: **a forma canônica `domain:P4` é a que o resto do sistema usa** — é o
que `node.level` guarda, o que a documentação escreve e o que um cliente
naturalmente digita. A forma que funciona (`domain:4`) é a menos óbvia.

Outros efeitos do mesmo defeito:
- `graph://cell/{key}` e `graph://domain/{d}` reportam `nodeCount: 0`.
- `node.editing`/`node.idle` saem com `nodes: []` (as travas guardam a forma
  canônica), então a projeção F1 "em edição por X" no nível do nó nunca acende.
  Verificado: `ultimo node.editing (nodes listados): [[]]`.

### F2 — `driftGrade` e `stale` são sempre `"fresh"`

`watch-bridge.ts` registra o drift em `state.driftStale` (índice vivo);
`resources.ts` lê `n.stale`, campo que **ninguém escreve**. Com um nó
comprovadamente em drift (F1.4 acima, `drift.node` + demoção emitidos):

```
graph://cell/auth:4 → {"authority":"suspended","driftGrade":"fresh",
                       "nodes":[{"id":"auth/login.ts","stale":"fresh",...}]}
```

A autoridade diz `suspended` e o drift diz `fresh`, na mesma resposta. Quem lê
o recurso não tem como saber quais nós apodreceram — e a âncora exibida ainda é
a antiga.

### F3 — o gate incremental emite `dangling-ref` que o commit desmente

O roundtrip incremental é escopado em (claims já commitadas + a nova), não no
conjunto encenado do turno. Claims perfeitamente válidas avisam:

```
L4 login: {"ok":true,"warnings":["roundtrip dangling-ref: ref \"auth/login.ts\" not found in claim set"]}
...
COMMIT:   {"ok":true,"admitSeq":15}
```

O aviso estava errado. Ruído assim treina o agente a ignorar warnings — que é
exatamente o oposto do que o gate quer.

### F4 — o padrão da claim-chão não está documentado em lugar nenhum

`refs` carrega **dois contratos incompatíveis**:

- `claimCoverage` (β): `claimed = set(claims.flatMap(c => c.refs))`, e o que
  falta é medido contra ids de **NÓ**. → `refs` precisa conter ids de nó.
- `roundtrip.checkClaims` (bloqueante no commit): todo ref tem que existir no
  conjunto de **CLAIMS**, senão `dangling-ref`.

Só existe uma saída, e ela não está escrita em nenhum lugar: **criar uma claim
cujo `id` É o id do nó**, no nível-chão, e apontar as claims de cima para ela.
Foi assim que a §1.2 fechou. Sem descobrir isso, um agente conclui que β é
inalcançável — todo caminho direto falha no commit.

### F5 — não existe tool de análise de impacto

Dá para responder "quem quebra se eu mudar X", mas o cliente tem que baixar o
snapshot inteiro e andar nas arestas sozinho:

```
arestas: [{"from":"billing/invoice.ts","to":"auth/login.ts","type":"depends-on"}]
quem quebra se auth/login.ts mudar: ["billing/invoice.ts"]
células atingidas: ["billing:P4"]
```

`graph.query` é match de token sobre metadados de nó — **não faz traversal**.
`cell-dag.ts` (ordem de cascata de regeneração, com SCC e topológica) existe no
`graph-core` e **não é importado pelo servidor**.

### F7 (CRÍTICO) — a trava pessimista pode ser burlada mudando a grafia da célula

Irmão do F1, encontrado ao auditar o raio de alcance da correção — e **o fix do
`nodesOfCell` NÃO alcança este**. A trava é gravada e consultada por igualdade
de string crua, sem nenhuma canonicalização (`tools/changeset.ts`,
`claimOrOpenCs`):

```ts
const lock = state.db.query("SELECT cs_id, holder FROM locks WHERE tenant_id = ? AND cell = ?").get(tenant, cell)
...
write(state.db, state.stateDir, tenant, "locks", { tenant_id: tenant, cell, cs_id: csId, ... })
```

Como `auth:P4` e `auth:4` são a MESMA célula lógica (provado no F1: as duas
grafias resolvem para o mesmo conjunto de nós assim que a comparação é
corrigida) mas duas strings diferentes, elas viram **duas linhas distintas na
tabela `locks`**. Alice tranca `auth:P4`, Bob tranca `auth:4`, e os dois
recebem `ok: true` sobre a mesma célula.

Isso é mais grave que o F1: o F1 concede autoridade não merecida; este permite
**duas pessoas editando a mesma célula ao mesmo tempo**, que é exatamente o que
o produto existe para impedir. O `blast_cells` do changeset e o escopo do gate
(`claim out of turn scope`) herdam o mesmo problema, porque comparam contra as
mesmas strings cruas.

**CORRIGIDO em 2026-08-07** (commit `aa33248`, junto com o F1 — mesma causa
raiz). Verificação ao vivo contra servidor real, depois da correção:

```
alice tranca auth:P4 → {"ok":true,"csId":"cs_4e4e4c9c95561d21"}
bob tenta   auth:4   → {"ok":false,"reason":"cell_locked","holder":"u_27a337...","csId":"cs_4e4e4c9c95561d21"}
```

E o F1, na mesma rodada, nas duas grafias:

```
authority.flip billing:P4 → {"ok":false,"reasons":["coverage not balanced in β cell billing:4: 1 node(s) without claims", ...]}
authority.flip billing:4  → {"ok":false,"reasons":["coverage not balanced in β cell billing:4: 1 node(s) without claims", ...]}
graph://cell/billing:P4   → {"nodeCount":1,"authority":"source"}
graph://cell/billing:4    → {"nodeCount":1,"authority":"source"}
```

Os testes de regressão do F7 (`test/lock-cell-key-canonicalization.test.ts`)
foram verificados contra a versão sem a correção: **3 dos 4 falham**.

Resíduo conhecido: linhas de `locks`/`authority` gravadas na grafia antiga por
um servidor anterior ficam órfãs (a chave canônica não as encontra). Travas são
índice vivo e expiram por TTL, então se resolvem sozinhas; uma linha de
`authority` legada exigiria re-flip. Aceitável num beta que ainda não tem base
instalada — registrado para não virar surpresa.

### F6 — os motores da escada não estão expostos (e isso é decisão, não bug)

O servidor importa de `graph-core`: `authority`, `boot-gate`, `build`,
`claim-store`, `classify`, `extract`, `indexer`, `meta`, `roundtrip`, `scan`,
`verify`. **Não importa** `ascent.ts`, `expand.ts`, `project.ts`, `descent.ts`,
`cell-dag.ts`.

Ou seja: via MCP existe o **gate que julga** a escada, não o **motor que a
constrói**. Coerente com a ADR §3.1 ("LLM na borda; propõe, nunca é
autoridade"), mas a consequência prática é que "top-down" e "bottom-up" via MCP
significam *submeter claims nível a nível na mão* — e nada no servidor ensina
como.

---

## 3. Consequência para o beta

F1, F7 e F2 são **superfícies que falham em silêncio na direção insegura**,
a mesma família dos defeitos que a campanha SB-0 corrigiu (`?since=abc`,
`makeReadFile`, `cellState.authority`). F1 é mais grave que qualquer um deles:
não é ruído nem indisponibilidade, é **o gate de integridade aprovando sem
prova**, na grafia que a documentação recomenda.

A raiz comum de F1 e F7 é a mesma: **a chave de célula (`domain:level`) não tem
uma forma canônica única aplicada nas fronteiras**. Ela entra pelo cliente em
duas grafias, é gravada crua na tabela `locks`, canonicalizada em alguns pontos
(`cellOfClaim`, `canonicalCell` no escopo do gate) e não canonicalizada em
outros (`nodesOfCell`, lookup de lock). Corrigir os sintomas um a um deixa a
causa de pé; a correção que fecha a família é canonicalizar na borda — toda
chave de célula que entra por tool ou por URI de recurso vira forma canônica
antes de qualquer comparação ou escrita.

Recomendo não empacotar release antes de F1, F7 e F2. F3 e F4 são baratos e valem
junto: F4 é documentação + provavelmente uma claim-chão emitida pelo próprio
`graph.bootstrap` (o servidor já sabe os ids dos nós e as âncoras — nada de LLM
aí, continua determinístico e continua não sendo o servidor propondo
conhecimento).

F5 e F6 são de produto, não de correção: decidir se `graph.impact` e a
distribuição da skill via `prompts/` entram no escopo do beta.

---

## 4. Situação depois das correções (2026-08-07)

| Achado | Status | Onde |
|---|---|---|
| **F1** — gate de autoridade aprovava sem cobertura | **corrigido** | `aa33248` |
| **F7** — trava pessimista burlável pela grafia | **corrigido** | `aa33248` |
| **F2** — `driftGrade`/`stale` sempre `"fresh"` | **corrigido** | `7e5a4a9` |
| **F3** — `dangling-ref` falso no gate incremental | **corrigido** | `5dd7b8c` |
| **F4a** — padrão da claim-chão indescobrível | **documentado** | `f45882a` |
| **F4b** — `bootstrap` emitir claims-chão | **em aberto — decisão do dono** | — |
| **F5** — sem tool de análise de impacto | **em aberto — produto** | — |
| **F6** — motores da escada não expostos | **em aberto — produto** (ADR §3.1) | — |

Suíte: **497 verdes, 0 falhas, 1 `test.todo`** (era 468 antes desta rodada),
com o gate de flake de 8 rodadas consecutivas limpo.

### Resíduos técnicos registrados (nesta rodada)

1. **`"gone"` nunca é produzido.** O `tick()` distingue "arquivo sumiu" de
   "âncora sumiu", mas só o id do nó sobrevive em `state.driftStale` — a causa
   não fica consultável depois. O grau permanece no tipo (contrato de resposta)
   e nunca é emitido. Fechar exige o índice carregar a causa por nó.
2. **Linhas legadas na grafia antiga** (`locks`, `authority`) ficam órfãs após
   a canonicalização. Travas expiram por TTL sozinhas; uma autoridade legada
   exigiria re-flip. Sem base instalada, é aceitável.
3. **F4b é o que ainda deixa o produto mudo na primeira impressão.** Um
   bootstrap devolve `claims: 0` e nenhuma célula pode ser β até alguém montar
   a escada à mão. Emitir as claims-chão no bootstrap continua determinístico
   (o servidor já conhece ids e âncoras) e não viola a ADR — mas muda o dado
   que o produto gera e o que muitos testes afirmam. É decisão de produto.

> Os itens 1 e o par F5/F6 desta lista são revisitados abaixo (§5, §6): o
> item 1 foi fechado no exercício multiplayer; F5 ganhou tool própria; F6
> segue em aberto.

---

## 5. Exercício multiplayer (2026-08-08)

### Montagem

Dois agentes de código, cada um sem saber da existência do outro, apontados
para o **mesmo servidor local** já rodando, contra o **mesmo repo real**
(`harness-kit`, indexado com domínios — não o repo de 3 arquivos de §0). Os
dois receberam a mesma tarefa no domínio `docs`, de propósito: forçar
contenção real na mesma célula em vez de dois agentes trabalhando em paralelo
sem nunca se cruzar.

### Corte

O exercício **não terminou**. Um agente de outra tarefa, na mesma máquina,
rodou `taskkill /F /IM bun.exe` — matou todo processo `bun` do sistema,
inclusive o servidor que os dois agentes multiplayer estavam usando, no meio
da sessão. Os achados abaixo são o que deu tempo de observar até esse ponto,
não uma varredura completa do desenho original. Célula única + colisão
imediata também significou que, quando a primeira trava azedou, um dos dois
agentes nunca chegou a produzir nada — registrado como resíduo em §7.

### MP-1 (CRÍTICO) — presença exigia SSE que um cliente `POST /mcp` puro nunca tem

Um agente recebeu `cell_locked` e, no mesmo instante, `presence.who` devolveu
`{"users":[]}` — um lock com dono vivo e ninguém presente. Nas palavras do
próprio agente que reportou: *"um lock pessoal sem ninguém presente é uma
inconsistência que a documentação não antecipa"*.

Causa: `presence.beat`/`presence.focus` exigiam um `sessionId`, e esse id só
nasce de `GET /events` (SSE). Um cliente que fala só `POST /mcp` — o caso de
`claude mcp add --transport http`, a instalação padrão e o público do beta —
nunca abre SSE, logo nunca declara presença, nunca aparece em `presence.who` e
nunca recebe `system.message`.

**Corrigido** (`387de2c`). `sessionId` vira opcional em `beat`/`focus`; sem
ele, o servidor resolve uma Session sintética sem canal de push, derivada
deterministicamente de `(tenant, userId)` e inserida no mesmo mapa que
`sse.ts` popula — `affinity.ts` e `pushEnvelope` passam a tratá-la como
destinatária de primeira classe, sem caso especial. Ganho colateral
confirmado: com presença, `system.pending` passa a entregar a notificação de
`lock.denied` para um cliente que só usou `POST /mcp`. Regressão em
`test/presence-without-sse.test.ts` (233 linhas): cliente sem SSE aparece em
`presence.who`, beats repetidos caem na mesma entrada sintética, o holder de
uma trava é visível como presente mesmo sem nenhum lado ter aberto SSE,
tentativa de sequestrar o `sessionId` sintético alheio é recusada, e o
caminho SSE original permanece intacto.

Ressalva do próprio agente, que fica como característica conhecida (§7): é
preciso bater presença **antes** do evento acontecer — quem só chama tools
reativamente não tem sessão para rotear.

### MP-2 — recusa por trava dava só um hash opaco; o agente bloqueado ficou girando até desistir

`cell_locked` e a recusa equivalente em `node.edit` devolviam só um `holder`
opaco (hash de usuário). O agente bloqueado não tinha o que fazer com isso —
ficou em polling até desistir.

**Corrigido** (`164d8e3`), no mesmo commit do MP-3. Campos aditivos
(`holderName`, `retryAfterMs`, `hint`) em `OpenResult` e `NodeEditResult` —
sem fila nem espera bloqueante, só tornando legível e acionável o que o
servidor já calculava. Saída ao vivo citada no commit:

```
held by alice (u_27a337...) — expires at ... (~1800s); retry after it
expires, or ask alice to commit/abort to release it sooner
```

### MP-3 — o turno declarava uma célula enquanto segurava duas travas

Capturado ao vivo: um turno com `blast_cells: ["docs:4"]` segurando travas em
`docs:4` **e** `docs:1`. `blast_cells` era gravado uma única vez, na criação
do turno, e nunca reescrito; um turno **expandido** (reusa o `csId` e tranca
uma célula nova) ficava subdeclarado no registro de auditoria.

**Corrigido** (`164d8e3`) — mas não do jeito óbvio. O comentário existente em
`gates.ts` sugeria recalcular `blast_cells` no commit; a auditoria mostrou que
isso não fecha a família: o **sweeper de TTL** lê `blast_cells` para montar o
payload de `changeset.aborted` a partir da tabela `locks`, e um turno
expandido que morre por TTL **nunca passa pelo commit** — o sweeper se
contradiria dentro da própria transação, do mesmo jeito que o commit
corrigido não mais faria. A correção reescreve `blast_cells` a partir de
`locks` (fonte de verdade real) na **mesma transação que grava a trava nova**,
em `claimOrOpenCs` — fecha os dois caminhos (commit e TTL) com uma única
fonte, sem tocar `sweeper.ts`.

O teste `blast-radius.test.ts` afirmava literalmente o bug ("blast_cells
segue congelado", esperando só `["ui:5"]`); a asserção foi corrigida para
exigir as duas células. Regressão nova em
`test/changeset-scope-and-contention.test.ts` cobre o turno expandido tanto
no caminho de commit (registro reflete as duas células já enquanto aberto,
não só depois do commit) quanto no caminho de TTL (o `changeset.aborted`
declara as duas células, coerente com os `lock.released` emitidos).

`intent: ""` num turno implícito foi deixado como está, de propósito: é
decisão deliberada (F1 moveu `intent` para o commit, que passa a exigi-lo);
inventar um `intent` sintético seria declarar uma intenção que o usuário não
teve.

### Dois achados de instrumentação

**Log registrava recusa do gate como sucesso.** Duas sessões do exercício
produziram 59 chamadas de `changeset.claim` registradas como `ok:true` no
log — e **zero** claims commitadas. As duas coisas eram verdade ao mesmo
tempo: uma claim recusada pelo gate devolve `{ok:false, reasons}` como
`structuredContent`, não como `isError`, então para o transporte a chamada
foi sucesso. Só que o log existe para o dono diagnosticar "por que nada
entrou", e `ok:true` 59 vezes responde o contrário da verdade — a mesma
classe de falha silenciosa que este servidor já havia corrigido quatro vezes
antes (`?since=abc`, `nodesOfCell`, `driftGrade`, filtro vazio), desta vez
dentro do próprio instrumento de diagnóstico. **Corrigido** (`403240c`): `ok`
mantém o significado de transporte e ganha `verdict: "refused"` + `reasons`
ao lado. As `reasons` viajam para o log porque são o dado que responde à
pergunta; exposição consciente e documentada no commit — contêm ids de claim
e caminhos **relativos** de arquivo, nunca subject/anchor. Regressão:
`test/server-log.test.ts`, teste "VEREDITO: recusa do gate é registrada como
refused + reasons, não como sucesso".

**`graph://guide` afirmava algo falso sobre `presence.who`.** O guia dizia
que `presence.who {cell}` mostra quem segura a trava. Verificado ao vivo
contra servidor real: **falso**. Aquele filtro é por foco **declarado**
(`presence.focus`), não por trava — a holder aparecia em `presence.who` sem
filtro, com `openCount: 1`, e sumia ao filtrar pela célula que ela tinha
travado (porque nunca tinha focado ali via `presence.focus`). **Corrigido**
(`65ff0d5`): o guia foi reescrito para apontar o `holderName` que a resposta
de `cell_locked` já traz (ganho do MP-2) e para avisar da diferença entre
foco declarado e trava. Regressão: `test/resources-guide.test.ts` — cobre que
`graph://guide` está listado, é lido por `resources/list`/`resources/read`, e
o texto cobre o fluxo central (`session.register`, `graph.query`,
`graph.impact`, `changeset.open/claim/commit`, `cell_locked`,
`system.pending`).

---

## 6. Situação atual (2026-08-08)

| Achado | Status | Onde |
|---|---|---|
| **F1** — gate de autoridade aprovava sem cobertura | corrigido | `aa33248` |
| **F7** — trava pessimista burlável pela grafia | corrigido | `aa33248` |
| **F2** — `driftGrade`/`stale` sempre `"fresh"` | corrigido | `7e5a4a9` |
| **F3** — `dangling-ref` falso no gate incremental | corrigido | `5dd7b8c` |
| **F4a** — padrão da claim-chão indescobrível | documentado | `f45882a` |
| **F4b** — separação `refs`/`covers` | corrigido | `d85477a` (+ `7766f84`, F8) |
| **F5** — sem tool de análise de impacto | corrigido — `graph.impact` | `74b9b0f` (tool), `7bf5227` (limite) |
| **F6** — motores da escada não expostos | em aberto — produto (ADR §3.1); falta validar Caminho B com sessão real do Claude Code (dono) | — |
| **`"gone"` nunca era produzido** (resíduo §4.1) | corrigido | `65ff0d5` |
| **MP-1** — presença exigia SSE, ausente em cliente `POST /mcp` puro | corrigido | `387de2c` |
| **MP-2** — recusa por trava sem holder legível/acionável | corrigido | `164d8e3` |
| **MP-3** — `blast_cells` subdeclarado em turno expandido | corrigido | `164d8e3` |
| Log registrava recusa do gate como `ok:true` | corrigido | `403240c` |
| `graph://guide` afirmava filtro errado em `presence.who` | corrigido | `65ff0d5` |

Suíte no root: **569 verdes, 0 falhas, 1 `test.todo`** (2026-08-08, após o
fechamento dos resíduos 5 e 6 abaixo).

### 7. Resíduos em aberto (2026-08-08)

Registrados com o cuidado de não inflar nem minimizar — cada um é o que as
fontes acima sustentam, nada além:

1. ~~**F4b — separação de `refs`/`covers`.**~~ **FECHADO** em `d85477a`, e o
   F8 que ele revelou (universo de resolução de refs é global, escopo de
   revisão é a célula) em `7766f84`.
2. **F6 — validação do Caminho B com sessão real.** `graph://guide` e as
   descrições de tool cobrem `claude mcp add --transport http`, mas ninguém
   ainda conectou uma sessão real do Claude Code contra o servidor para
   confirmar. É a tarefa do dono descrita em `README.md` (SB-2).
3. **Refazer o exercício multiplayer com o desenho corrigido.** O corte por
   `taskkill` interrompeu antes do desenho original rodar por completo, e a
   escolha de forçar colisão na mesma célula desde o primeiro turno significa
   que a primeira trava azedou o resto da sessão — um dos dois agentes nunca
   chegou a produzir nada. Repetir com células **diferentes primeiro**,
   colisão **depois**, dá sinal sobre o caminho feliz de dois agentes
   independentes antes de testar contenção.
4. **`presence.beat` precisa vir antes do evento.** Quem só chama tools
   reativamente nunca abre uma sessão para o servidor rotear notificação, e
   não recebe `system.message`. Não é bug — está documentado em
   `graph://guide` — mas é característica que vale manter registrada: um
   agente que não bate presença cedo fica, na prática, sem os avisos em
   texto da §1.6.
5. ~~**`graph.impact` sem paginação de continuação.**~~ **CORRIGIDO.** Ganhou
   `cursor`/`nextCursor`: paginação por **chave** (a última `[depth, id]`
   emitida por lista), não por offset, porque o grafo pode ser republicado
   entre duas páginas e um offset sobre uma lista que mudou pula ou duplica
   item em silêncio — a mesma classe de defeito que F1/F2/F7 corrigiram. As
   três listas avançam independentes; o cursor carrega `id`/`depth`/`limit`,
   então mandar valor divergente junto com ele é erro nomeado, não
   reparametrização silenciosa; e cursor corrompido é erro, nunca reinício do
   zero (que faria um laço de paginação girar para sempre). `l` forjado não
   escapa do teto de `limit`. `*Truncated` passou a significar "há mais depois
   desta página" — idêntico ao antigo `total > limit` na primeira página.
6. ~~**Linhas legadas de `locks`/`authority` na grafia antiga.**~~
   **CORRIGIDO.** `openDb` migra as duas tabelas em uma transação idempotente,
   ao lado da migração de `claims.covers` que já existia. Colisão entre as duas
   grafias não é resolvida por `INSERT OR REPLACE` cego — cada tabela usa o
   critério que sua própria semântica já implica: `locks` mantém o
   `expires_at` mais distante (descartar a trava viva liberaria uma célula que
   alguém segura), `authority` mantém o `last_flip_seq` maior (é como
   `authorityOf` já lê a tabela). Como `authority` é durável, o
   `rebuildFromJsonl` desfaria a migração ao replayar o JSONL append-only —
   por isso o replay também canonicaliza a célula, pelo mesmo motivo que já
   normalizava o nível da claim.

   Efeito colateral de desenho: `canonicalCell` mudou de `gates.ts` para
   `cell.ts`, módulo **folha sem imports**. `db.ts → gates.ts` seria import
   para cima e reabriria a porta do ciclo que já custou um **segfault** do Bun
   nesta base (ver `tokens.ts`). `gates.ts` reexporta o símbolo: todo import
   existente segue válido e continua havendo uma implementação só.
