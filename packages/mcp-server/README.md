# @open-graph-mcp/mcp-server

Servidor MCP read-only (Fase 1 do roadmap): bootstrap → query → subscribe.

```bash
GRAPH_REPO_PATH=/path/to/repo bun run dev   # porta 8787 (PORT p/ mudar)
bun test                                     # 7 testes de aceite (spec §9)
```

### Variáveis de ambiente

| Var | Default | Efeito |
|---|---|---|
| `PORT` | `8787` | Porta do `Bun.serve`. Validada no boot: um valor não-inteiro ou fora de 1–65535 falha alto, em vez de virar `NaN` e subir numa porta efêmera aleatória. |
| `STATE_DIR` | `.graph-server` | Diretório do estado durável (SQLite + JSONL). |
| `WATCH` | `true` | `WATCH=false` desliga o loop de watch. |
| `WATCH_TENANT` | `default` | Tenant que o watch acompanha. |
| `ALLOWED_ORIGINS` | (unset → `*`) | Lista separada por vírgula de Origins permitidas (CORS + guard anti-rebinding). Unset ≠ `""` — `""` fecha tudo. |
| `DOMAINS` | (unset → sem regras) | Regras de posse de domínio como array JSON: `DOMAINS='[{"pattern":"sdk/*","domain":"sdk"}]'`. Sem isto, todo nó indexado cai na célula `(unassigned)`. JSON malformado ou itens sem `pattern`/`domain` (string não-vazia) falham o boot com erro nomeando `DOMAINS` — nunca é ignorado silenciosamente. |

> **`pattern` NÃO é glob.** `matchesPattern` (`graph-core/src/domains.ts`) suporta só quatro formas:
> exato (`src/app.ts`), `prefixo*` (`sdk/*` → todo id que começa com `sdk/`), `*sufixo`
> (`*.test.ts`) e `*meio*` (`*runner*`). Um `**` não tem significado especial: `sdk/**` vira
> `startsWith("sdk/*")` e **não casa nada** — silenciosamente, porque uma regra que não casa é
> indistinguível de não ter regra. Use `sdk/*` para pegar a subárvore inteira (o match é sobre o id
> POSIX completo, então `sdk/*` já cobre `sdk/src/agent-runner/X.ts`).
>
> Verificado em 2026-08-06 indexando um repo real de 186 nós: com
> `[{"pattern":"sdk/*","domain":"sdk"},{"pattern":"agents/*","domain":"agents"},{"pattern":"skills/*","domain":"skills"},{"pattern":"docs/*","domain":"docs"}]`
> a distribuição saiu `sdk:149, skills:21, agents:10, docs:4, (unassigned):2` (os 2 são arquivos da
> raiz, que nenhuma regra cobre). Com `sdk/**` no lugar de `sdk/*`, os 186 ficam `(unassigned)`.

## Endpoints

- `POST /mcp` — JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`,
  `resources/list`, `resources/read`.
  Tools: `graph.bootstrap`, `graph.query`, `graph.subscribe`, `graph.rebuild`.
  Resources: `graph://snapshot`, `graph://history?since=N&limit=N`,
  `graph://claims?id=claimId`, `graph://claims?cell=domain:P4&since=N&limit=N`,
  `graph://claims?scope=snapshot&since=N&limit=N`, `graph://cell/{domain:level}`,
  `graph://domain/{domain}`. Claims and history default to 100 records per page,
  accept at most 500, and return `nextCursor` plus `hasMore`.
  SQLite indexes `(tenant_id, seq)` and `(tenant_id, domain, level, seq)` keep
  snapshot and cell continuation queries aligned with their cursor predicates;
  claim levels are canonicalized to `P<n>` so cell reads use indexed equality.
- `GET /events?since=N&filter=...` — SSE. Primeiro frame `session.created
  { sessionId, graphId }` (o nome do evento vai no campo `event:` do SSE; o
  `data:` é o objeto cru, **sem** campo `kind`); depois tail do log + eventos ao
  vivo, filtrados server-side. Envelope: `{ schemaVersion: 1, seq, ts, kind,
  target, payload, graphId }`.
  `since` aceita só inteiro não-negativo (ou omitido = 0) e `filter` de kind
  conhecido exige valor não-vazio — os dois devolvem **400** em vez de entregar
  um backlog vazio/uma conexão muda em silêncio. Kind de filtro *desconhecido*
  continua caindo pra `{kind:"all"}`, permissivo de propósito.
- **`graph.subscribe` e o dono da sessão.** `token` é propriedade **opcional** do
  `inputSchema`. Quando vem, o servidor valida o binding `sessionId → token`
  (mesmo critério do `presence.ts touch()`) e recusa quem não é dono da sessão
  com `session not owned by caller`. `packages/client` já injeta o token
  resolvido em todo `tools/call`, então o caminho de produção é o validado.
  Chamada sem token segue aceita (compat Fase 1) — residual consciente,
  registrado em `docs/roadmap-server-beta/00-scope-sb-0-hardening-servidor.md`.

## O modelo de claims: escada, `refs` e o padrão da claim-chão

A escada de abstração tem 6 níveis, 5 (código) a 0 (ideação):
`5=código, 4=testes, 3=cenários, 2=arquitetura, 1=concepção, 0=ideação`
(`LEVELS`/`CODE_LEVEL` em `graph-core/src/ascent.ts` — a ordem do array é do 0
ao 5, `["ideação","concepção","arquitetura","cenários","testes","código"]`). Toda claim não-raiz
precisa estar a **exatamente 1 nível** de cada um dos seus `refs`
(`|level(claim) - level(ref)| === 1`, checado por `roundtrip.checkClaims`).
Raízes (`refs: []`) só são válidas nos extremos — nível 0 ou 5; uma claim de
nível intermediário sem `refs` é rejeitada como `orphan-midladder`.

**`refs` carrega dois contratos ao mesmo tempo, e os dois têm que fechar:**

1. **Adjacência da escada** (`roundtrip.checkClaims`, bloqueante no
   `changeset.commit`): todo id em `refs` precisa existir **no conjunto de
   claims** sendo commitado, e estar a 1 nível de distância. Ref para um id
   que não é claim → `dangling-ref`.
2. **Cobertura de nós** (`claimCoverage`, `graph-core/src/claim-store.ts`,
   avaliada pelo gate final de `authority.flip`): `claimed = new
   Set(claims.flatMap(c => c.refs))`, e o gate mede o que falta contra os
   **ids de nó** da célula. Uma célula só fecha cobertura (condição para virar
   `graph`/β) se todo nó dela aparecer em algum `refs`.

Os dois contratos exigem formas diferentes de `refs` (ids de claim vs. ids de
nó) — a única forma de satisfazer ambos é uma **claim-chão**: uma claim de
nível 5 cujo `id` **é literalmente o id do nó** (`file`, ex. `"auth/login.ts"`),
com `refs: []` e `anchor` verbatim do arquivo. Ela funciona como claim (então
uma claim de nível 4 pode referenciá-la sem `dangling-ref`) e simultaneamente
conta como cobertura do nó (porque seu `id` é o id que `claimCoverage`
procura).

**Sem a claim-chão, todo caminho para autoridade β morre no commit.** Uma
claim de nível 4 que referencia o id do nó diretamente é aceita pelo gate
incremental (com um warning de `roundtrip dangling-ref`), mas o
`changeset.commit` bloqueia:

```
changeset.commit → {"ok":false,"reasons":[
  "roundtrip dangling-ref @c_login_p4: ref \"auth/login.ts\" not found in claim set"
]}
```

### Exemplo completo, verificado ao vivo (chão → β)

Repo de 2 arquivos, domínio `auth`: `auth/login.ts` (âncora
`export function login(user, password) {`) e `auth/verify.ts` (âncora
`export function verify(user, password) {`). Sequência de deltas num único
`changeset` aberto sobre `["auth:5", "auth:4"]`:

```jsonc
// 1. claim-chão para cada nó — id = id do nó, level 5, refs: []
{ kind: "claim.add", payload: { id: "auth/login.ts",  subject: "login entrypoint",  domain: "auth", level: 5, refs: [], file: "auth/login.ts",  anchor: "export function login(user, password) {" } }
{ kind: "claim.add", payload: { id: "auth/verify.ts", subject: "verify entrypoint", domain: "auth", level: 5, refs: [], file: "auth/verify.ts", anchor: "export function verify(user, password) {" } }

// 2. claims de nível 4 apontam para a claim-chão (adjacência 5→4), não para o nó "cru"
{ kind: "claim.add", payload: { id: "c_login_p4",  subject: "login() delegates credential check to verify()", domain: "auth", level: 4, refs: ["auth/login.ts"],  file: "auth/login.ts",  anchor: "export function login(user, password) {" } }
{ kind: "claim.add", payload: { id: "c_verify_p4", subject: "verify() checks password non-empty",             domain: "auth", level: 4, refs: ["auth/verify.ts"], file: "auth/verify.ts", anchor: "export function verify(user, password) {" } }
```

```
changeset.commit                       → {"ok":true,"admitSeq":17}
graph://cell/auth:4 (antes)            → {"authority":"source","nodeCount":2,"claimCount":2}
authority.flip {cell:"auth:4",to:"graph"} → {"ok":true,"admitSeq":25,"cell":"auth:4","to":"graph"}
graph://cell/auth:4 (depois)           → {"authority":"graph","nodeCount":2,"claimCount":2}
```

**As duas grafias da chave de célula são equivalentes.** `auth:P4` e `auth:4`
são a mesma célula: toda chave que entra por tool ou por URI de recurso passa
por `canonicalCell` (`gates.ts`) antes de qualquer comparação, lookup ou
escrita — travas, autoridade, cobertura e os recursos de leitura. A forma
gravada no banco é sempre a canônica (`domain:<número>`), então existe **uma**
linha de trava e **uma** de autoridade por célula, não uma por grafia.

Isso foi uma família de defeitos reais, corrigida em 2026-08-07 (F1 e F7 em
`docs/roadmap-server-beta/01-evidencias-fluxo-completo.md`): havia três
implementações paralelas dessa comparação, com convenções divergentes, e o
resultado era o gate de autoridade aprovando sem cobertura e a trava
pessimista podendo ser adquirida duas vezes para a mesma célula. Se você for
acrescentar código que receba chave de célula, canonicalize na borda — não
escreva uma quarta cópia.

## Decisões de implementação

- **JSON-RPC à mão, SDK só p/ types.** O transport do `@modelcontextprotocol/sdk`
  é Streamable-HTTP-orientado (express/hono) e briga com `Bun.serve` + o SSE
  próprio. São 5 métodos — o dispatcher manual é menor que a adaptação.
- **`resources/subscribe` não implementado de propósito** (ADR nota 2025):
  streaming é só pelo `/events`. Suporte de clientes MCP a subscriptions é
  irregular; a tool `graph.subscribe` + SSE cobre o caso.
- **Bootstrap fresh = esqueleto estrutural determinístico** (1 record por
  arquivo-fonte, âncora = 1ª linha não-vazia; sem LLM, sem claims, sem β),
  marcado `pipeline: "skeleton"` no snapshot. O pipeline brownfield real é uma
  sessão de agente LLM — não é spawnável de dentro do servidor. Fase 1 prova o
  protocolo, não o pipeline de conhecimento.
- **Estado 100% em memória** (spec §6). Restart → novo `graphId` → cliente
  descarta `since` e refaz snapshot.
