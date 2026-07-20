# UI-2 Turnos E2E

Cobertura de testes ponta a ponta da fase UI-2 (turnos: abrir, draft, commit, lock/TTL) do `mcp-web`, contra o harness real do `mcp-server`.

## OVERVIEW

Fase UI-2 do `roadmap-web-ui` fechada por dois specs Playwright que exercitam o ciclo de turno multiplayer (open → claim → commit) e a contenção de lock (deny → release → retry), validando o DOM-API de `turn.tsx`/`app.tsx` e o fluxo SSE `changeset.*` do `@open-graph-mcp/mcp-server`.

## FOLDER STRUCTURE

Caminhos do `mcp-web` pertinentes a esta fase:

```
packages/mcp-web/
├── e2e/
│   ├── turn-lifecycle.e2e.ts    # QA-2 §3.1: alice open→3 claims→commit; bob SSE
│   ├── lock-contention.e2e.ts   # QA-2 §3.1 retry + §3.2/§3.3: deny, retry, gate-fail, malformed, TTL
│   ├── fixture.ts                # startHarness(): server-runner + page fixture
│   ├── driver.ts                 # webToken/webUserId/turns helpers
│   ├── server-runner.ts           # sobe mcp-server real por teste
│   └── ... (specs prévios: avatar, presence, reconnect, toast, typing, snapshot, settings)
├── src/
│   ├── turn.tsx                  # DOM-API #denied/#draft/#retry/#dreasons/#addclaim/#f_*
│   ├── app.tsx                   # header expõe IDs estáveis p/ e2e
│   ├── ghosts.ts                 # GhostStore: ghosts do changeset render em canvas
│   ├── store.ts                  # zustand store
│   └── ...
├── playwright.config.ts
└── package.json                  # test:e2e = playwright test

docs/roadmap-web-ui/
└── 02-scope-ui-2-turnos.md       # status=concluído, DoD [x]

docs/specs/ui2_turnos_e2e/        # artefatos de spec (problem-space, context-map, tactical-design, test-scenarios)
```

Os specs em `packages/mcp-web/e2e/` (exceto `turn-lifecycle` e `lock-contention`) cobrirão fases subsequentes do roadmap; os dois desta fase são isolados e rodam contra o mesmo `startHarness()`.

## COMPONENTES

### `turn-lifecycle.e2e.ts` (QA-2 §3.1)
- **Cadeia MULTI-cell**: alice abre turno com 3 claims em níveis adjacentes (`auth:P5` raiz `@CODE_LEVEL`, `auth:P4` refs `P5`, `auth:P3` refs `P4`); 2º e 3º via ref-por-clique no `.og-ghost-card[data-claim=<id>]`.
- **Gate final**: `roundtrip`, `dangling-ref`, `level-gap` devem passar (`mcp-server` `finalGate`).
- **SSE broadcast**: bob recebe `changeset.committed` → toast “alice commitou …” renderiza sem `page.reload`; `#seq` de bob incrementa numericamente `>= bobSeqBefore + 1`.
- **Cross-browser proof (RETRY #1)**: contagem de `.og-ghost-card` em bob ANTES do commit (cs aberto → ghosts visíveis) DEVE ir a 0 DEPOIS (cs fechado → `ghostStore.applystderr` remove). Toast + `#seq` são sinais adicionais; ghost-count é o side-effect canvas-real.

### `lock-contention.e2e.ts` (QA-2 §3.1 retry + §3.2/§3.3)
- **`#denied`**: dois `BrowserContext` disputam a mesma cell; o negado vê holder + csId + countdown como estado de primeira classe — nunca toast genérico. Asserção NEGATIVA de PII: `webUserId` (“alice” → `u_<hash>`) NÃO aparece em `#denied`.
- **Recovery**: holder libera via `abort`; negado clica `#retry` → reabre ao vivo, sem `page.reload` nem nova requisição `/events`.
- **Gate-fail legível (§3.2)**: claim com refs fora-de-escopo preserva texto digitado em `#f_subject`/`#f_domain`/`#f_level`/`#f_refs` e projeta reasons em `<li class="reason">` dentro de `ul#dreasons` (selector real do `DraftPanel`; `.gate-reasons` do spec 004 é aspiracional).
- **Commit-reject via API bypass (§3.2 a)**: `incrementalGate` é advisory em refs; `finalGate` (@commit) rejeita `dangling-ref` com reason nomeando o id ofensor — asserido via `changeset.commit` direto bypassando a UI (UI esconde o painel em `cs=null`, adaptation honesta no spec 004 §3.2).
- **Malformed JSON (§3.3)**: `#f_json`=`{invalid` → nenhum request `changeset.claim` no wire (contagem via `page.on('request')`); `#dreasons` mostra reason local “raw JSON inválido”; form estruturado preservado.
- **TTL-abort (§3.3, honest N/A)**: `startHarness({ ttlMs:50 })` → `h.control("sweep")` aborta changeset → toast “abortado por TTL” em alice. Painel desmonta em `cs=null` (`turn.tsx:147`), então “preservar texto digitado” é infeasível no UI — documentado no spec 004 §3.2 como branch N/A; cobertura unit-level fica em `GhostStore.test.ts`.

## ADAPTER NOTES

Adaptações honestas vs spec `004-mcp-web-test-scenarios.md`, registradas para um futuro LLM não re-derivar a semântica do produto:

1. **Refs apontam a CLAIMS, não a nós** — `mcp-server` `finalGate` rejeita refs fora do set de claims conhecidos do changeset. Clicar `.og-card` (file path) → commit rejeitado por `dangling-ref`. A semântica de ref-por-clique do produto é clicar o `.og-ghost-card` do delta recém-adicionado (`onClick` → `pickRef(d.id)`). Spec 004 usou `.og-card` por imprecisão; adaptado para `.og-ghost-card[data-claim=<id>]`.
2. **`#seq` endurecido para numérico** — `not.toHaveText(before)` passa por bump espúrio (presence/typing). `lock-contention` faz parse int após “seq ” e asserir `>= before+1`.
3. **Crescimento de nó depender de refs** — `changeset.ts` (~linha 171) só estende `n.claims` quando refs incluem id de nó. Como o gate exige claim-ids válidos, NADA cresce `n.claims` via turno normal. Visibilidade multiplayer atestada por toast broadcast + `#seq` + ghost-count, não por nó novo em bob.
4. **`#dreasons` é o selector real** — `.gate-reasons` do spec 004 é aspiracional; produção usa `ul#dreasons` com `li.reason`/`li.warning` (DraftPanel real).
5. **`.gate-reasons` aspiracional** — spec 004 descreve `.gate-reasons`; UI produz `#dreasons`. Não renomear a UI só para o spec; spec rotulado como aspirational.

## COMO RODAR

### Pré-requisitos
1. `bun install` na raiz do monorepo.
2. `playwright install` (navegadores Playwright).
3. Workspace build: o `server-runner.ts` importa `@open-graph-mcp/mcp-server` (workspace dep).

### Comando
1. Na raiz de `packages/mcp-web`, executar `e2e`:

```bash
# CORRECT: roda os specs UI-2 contra harness real
bun run test:e2e -- e2e/turn-lifecycle.e2e.ts e2e/lock-contention.e2e.ts

# WRONG: rodar a suite inteira quando só UI-2 mudou —custo desnecessário
bun run test:e2e
```

2. Para um único spec:

```bash
# CORRECT: isola o cenário de contenção
bun run test:e2e -- e2e/lock-contention.e2e.ts
```

## DOM API (seletores estáveis contratuais)

IDs/selectores que `turn.tsx`/`app.tsx` expõem como contrato de e2e e os dois specs dependem:

| Seletor          | papel                                                                 |
|-------------------|------------------------------------------------------------------------|
| `#denied`         | holder + csId + countdown quando `lock.denied`                         |
| `.denied-free`    | countdown regressivo                                                    |
| `#retry`          | botão reabrir turno após liberação do lock                              |
| `#draft`          | painel draft quando turno ativo                                          |
| `#dlist`          | lista de deltas do changeset (timeline)                                  |
| `#dreasons`       | `<ul>` com `<li class="reason">`/`<li class="warning">` do gate         |
| `#f_subject`, `#f_domain`, `#f_level`, `#f_refs`, `#f_json`, `#f_id` | campos do form de claim                              |
| `#addclaim`       | submete claim ao `changeset.claim`                                      |
| `.og-ghost-card`  | sub-card tracejado violeta de delta não-commitado; `data-claim=<id>`    |
| `#seq`            | contador sequencial SSE no header                                      |
| `.toast`          | broadcast `changeset.committed` / `changeset.aborted`                 |

REQUIRED: qualquer mudança em `turn.tsx`/`app.tsx` que renomeie ou remova um desses seletores DEVE atualizar os specs correspondentes — são API pública de e2e.

## BEST PRACTICES

REQUIRED:Gtk `startHarness` no `beforeAll`/`afterAll` por spec — um server-runner por arquivo, evita estado cruzado entre specs.
REQUIRED: Asserções PII negativas — passage through component HTML (`#denied`, `#dlist`) NÃO deve conter `userId` cru (`u_<hash>`), só display name.
REQUIRED: Ghost-count como side-effect mensurável cross-browser — toast sozinho é frágil (`maybeToast` depende de layout); `.og-ghost-card` count é ground-truth do canvas de bob.
FORBIDDEN: `page.reload()` para validar refresh multiplayer — UI-2 definiu SSE-vivo como norte; reload encobre regressões de evento.
FORBIDDEN: Depender de `.og-card` (nó) para ref-por-clique — gate rejeita; sempre `.og-ghost-card[data-claim=<id>]`.

## TIPS

Sempre que um spec precisar simular entrada de raw JSON inválida, asserir `page.on('request')` contando `changeset.claim` calls DEVE permanecer 0 — o guard local em `DraftPanel` bloqueia antes do wire. Sem o counter, um bug que escape do guard passa burro.

```ts
// CORRECT: bloqueia + conta wire
const claimCalls: string[] = []
page.on("request", r => { if (r.url().includes("changeset.claim")) claimCalls.push(r.url()) })
await page.fill("#f_json", "{invalid")
await page.click("#addclaim")
expect(claimCalls).toHaveLength(0)
expect(page.locator("#dreasons li.reason")).toContainText("inválido")
```

## REFERENCES

Nenhum documento em `docs/adr/` ou `docs/feature/` adicional ao tempo desta escrita. `docs/adr/ARCHITECTURE.md` e `docs/adr/TESTS.md` são pendentes (não solicitados neste ciclo); quando criados, referencie aqui ambos: ARCHITECTURE.md para camadas `mcp-web` (SSE, GhostStore, DraftPanel) e TESTS.md para a estratégia de e2e Playwright contra harness.