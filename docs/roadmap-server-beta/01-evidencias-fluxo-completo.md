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

### Resíduos técnicos registrados

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
