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

F1 e F2 são **read/decide surfaces que falham em silêncio na direção segura**,
a mesma família dos defeitos que a campanha SB-0 corrigiu (`?since=abc`,
`makeReadFile`, `cellState.authority`). F1 é mais grave que qualquer um deles:
não é ruído nem indisponibilidade, é **o gate de integridade aprovando sem
prova**, na grafia que a documentação recomenda.

Recomendo não empacotar release antes de F1 e F2. F3 e F4 são baratos e valem
junto: F4 é documentação + provavelmente uma claim-chão emitida pelo próprio
`graph.bootstrap` (o servidor já sabe os ids dos nós e as âncoras — nada de LLM
aí, continua determinístico e continua não sendo o servidor propondo
conhecimento).

F5 e F6 são de produto, não de correção: decidir se `graph.impact` e a
distribuição da skill via `prompts/` entram no escopo do beta.
