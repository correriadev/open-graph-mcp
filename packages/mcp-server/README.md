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
| `HOST` | `127.0.0.1` | Interface de bind do `Bun.serve`. Default é loopback-only: sem isto, o default do próprio Bun é `0.0.0.0` (todas as interfaces) — rodar um beta local num café expõe o grafo do repo do usuário pra rede inteira, sem auth de transporte nenhuma. `0.0.0.0` continua disponível como opt-in explícito. Validado no boot: string vazia ou com caracteres inválidos falha alto, mesma disciplina de `PORT`/`DOMAINS`. |
| `STATE_DIR` | `.graph-server` | Diretório do estado durável (SQLite + JSONL). |
| `LOG_FILE` | `<STATE_DIR>/server.log` | Caminho do log estruturado JSONL (`log.ts`). Uma linha por evento: boot, cada `tools/call`, cada `resources/read`, erros não tratados e shutdown. Nunca contém token, conteúdo de claim, conteúdo de arquivo, caminho absoluto do repo do usuário ou os `arguments` crus de uma tool — só nome/URI, `tenantId`, duração e ok/erro. Rotaciona sozinho (sem lib externa): ao passar de 10MB, o arquivo vira `.1` e recomeça. |
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
  registrado em `docs/CHANGELOG.md`.

## O modelo de claims: escada, `refs` e o padrão da claim-chão

A escada de abstração tem 6 níveis, 5 (código) a 0 (ideação):
`5=código, 4=testes, 3=cenários, 2=arquitetura, 1=concepção, 0=ideação`
(`LEVELS`/`CODE_LEVEL` em `graph-core/src/ascent.ts` — a ordem do array é do 0
ao 5, `["ideação","concepção","arquitetura","cenários","testes","código"]`). Toda claim não-raiz
precisa estar a **exatamente 1 nível** de cada um dos seus `refs`
(`|level(claim) - level(ref)| === 1`, checado por `roundtrip.checkClaims`).
Raízes (`refs: []`) só são válidas nos extremos — nível 0 ou 5; uma claim de
nível intermediário sem `refs` é rejeitada como `orphan-midladder`.

**`refs` carregava dois contratos ao mesmo tempo (F4), e os dois têm que
fechar. Desde a correção do F4, cada um tem seu próprio campo:**

1. **Adjacência da escada** — `refs` (`roundtrip.checkClaims`, bloqueante no
   `changeset.commit`): todo id em `refs` precisa existir **no conjunto de
   claims** sendo commitado, e estar a 1 nível de distância. Ref para um id
   que não é claim → `dangling-ref`. `refs` é **só** isso — nunca aponte para
   id de nó nele. Como célula é `(domínio, nível)` e adjacência exige nível
   `±1`, uma ref válida aponta **quase sempre para outra célula** — isso é
   normal, não um erro (ver F8 abaixo: `verifyIntegrity`, chamado por
   `finalGate` no gate de `authority.flip`, resolve refs contra o universo
   **global** de claims do changeset, não contra a célula sendo revisada;
   só o CONJUNTO revisado — que claims entram no relatório de breaches — é
   que fica escopado à célula).
2. **Cobertura de nós** — `covers` (`claimCoverage`,
   `graph-core/src/claim-store.ts`, avaliada pelo gate final de
   `authority.flip`): lista de **ids de nó** que a claim cobre. Uma célula só
   fecha cobertura (condição para virar `graph`/β) se todo nó dela aparecer em
   algum `covers` (ou, legado, em algum `refs` — ver abaixo).

Uma claim pode ter os dois campos preenchidos, um só, ou nenhum — `covers` não
precisa espelhar `refs` nem vice-versa. O caminho recomendado é simples: put
os ids de nó que a claim sustenta em `covers`, e use `refs` só para apontar
para outras claims na escada.

### Caminho legado: a claim-chão (compatibilidade, não recomendado)

Antes de `covers` existir, a única forma de fechar cobertura era uma
**claim-chão**: uma claim de nível 5 cujo `id` **é literalmente o id do nó**
(`file`, ex. `"auth/login.ts"`), com `refs: []` e `anchor` verbatim do
arquivo. Ela funciona como claim (então uma claim de nível 4 pode referenciá-la
sem `dangling-ref`) e simultaneamente contava como cobertura do nó — porque
`claimCoverage` também soma `refs`, por compatibilidade retroativa: claims já
gravadas antes de `covers` existir (SQLite + espelho JSONL) não podem deixar
de cobrir o que cobriam.

Esse padrão **continua funcionando** — nada foi removido — mas é desencorajado
daqui em diante. Prefira `covers` explícito: mais direto, e não força uma
claim-por-nó artificial na escada.

**Correção histórica (F8, `docs/CHANGELOG.md`):**
até essa correção, a frase acima — "desencorajado, não recomendado" — não era
verdade para **célula de meio-escada** (nível entre 0 e 5 exclusive). Antes de
F8, `verifyIntegrity` (chamado por `finalGate` com `metaIds`/`claimIds`
**escopados à célula** sendo revisada) exigia que toda `ref` resolvesse
**dentro da mesma célula**. Como a regra de adjacência (acima) força a ref pra
nível ±1, e célula = `(domínio, nível)`, uma ref adjacente aponta
necessariamente pra OUTRA célula — logo sempre "danglava". Meio-escada só
fechava um caminho limpo até `authority.flip -> graph` reusando o truque da
claim-chão (id de claim = id de nó) DENTRO da própria célula — mesmo com
`covers` disponível. `classify.ts` faz nós comuns nascerem em P4, então
meio-escada não era o caso raro: era o comum. `verifyIntegrity` agora aceita
um 4º parâmetro opcional (o universo global de ids contra o qual uma ref pode
resolver, distinto do conjunto revisado); `finalGate` passa o conjunto
agregado de claims do changeset. Uma ref para um id que não existe em lugar
nenhum continua `dangling-ref` — a correção troca o universo de resolução, não
afrouxa a checagem. Com isso fechado, a claim-chão passa a ser de fato
legado/opcional em qualquer nível, inclusive meio-escada.

**Sem `covers` NEM a claim-chão, todo caminho para autoridade β morre no
commit.** Uma claim de nível 4 que referencia o id do nó diretamente em `refs`
(sem também estar em `covers`) é aceita pelo gate incremental (com um warning
de `roundtrip dangling-ref`), mas o `changeset.commit` bloqueia:

```
changeset.commit → {"ok":false,"reasons":[
  "roundtrip dangling-ref @c_login_p4: ref \"auth/login.ts\" not found in claim set"
]}
```

### Exemplo completo, verificado ao vivo (covers → β)

Repo de 2 arquivos, domínio `auth`: `auth/login.ts` (âncora
`export function login(user, password) {`) e `auth/verify.ts` (âncora
`export function verify(user, password) {`). Sequência de deltas num único
`changeset` aberto sobre `["auth:5", "auth:4"]`:

```jsonc
// 1. claims de nível 5 (chão) e nível 4, cada uma cobrindo o nó correspondente via `covers` —
// `refs` fica livre para a escada (5→4), sem precisar apontar para o id do nó.
{ kind: "claim.add", payload: { id: "c_login_p5",  subject: "login entrypoint",  domain: "auth", level: 5, refs: [], covers: ["auth/login.ts"],  file: "auth/login.ts",  anchor: "export function login(user, password) {" } }
{ kind: "claim.add", payload: { id: "c_verify_p5", subject: "verify entrypoint", domain: "auth", level: 5, refs: [], covers: ["auth/verify.ts"], file: "auth/verify.ts", anchor: "export function verify(user, password) {" } }

// 2. claims de nível 4 apontam para a claim de nível 5 (adjacência 5→4), não para o nó "cru"
{ kind: "claim.add", payload: { id: "c_login_p4",  subject: "login() delegates credential check to verify()", domain: "auth", level: 4, refs: ["c_login_p5"],  file: "auth/login.ts",  anchor: "export function login(user, password) {" } }
{ kind: "claim.add", payload: { id: "c_verify_p4", subject: "verify() checks password non-empty",             domain: "auth", level: 4, refs: ["c_verify_p5"], file: "auth/verify.ts", anchor: "export function verify(user, password) {" } }
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
`docs/CHANGELOG.md`): havia três
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
