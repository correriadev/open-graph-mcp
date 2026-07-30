# QA-7 — Plano de teste backend (exceto web/UI) contra repo-alvo real

> Status: **planejado** — 2026-07-30. Índice-pai: `README.md`.
>
> **Objetivo:** exercitar todo o backend (graph-core, mcp-server, client,
> stdio-proxy, claude-plugin) contra um repo-alvo REAL —
> `C:\Users\User\Documents\harness-kit` — em vez de fixtures sintéticas de
> 2-3 arquivos. Fixture pequena não distingue "funciona" de "funciona em
> escala"; um repo de 131 `.ts` + 55 `.md` distingue.
>
> **Anti-escopo:** `packages/mcp-web` inteiro — Playwright, DOM, canvas,
> render, store. Coberto por QA-2. Aqui nada roda browser.

---

## 0. Por que harness-kit

| Propriedade | Valor | Por que importa |
|---|---|---|
| Arquivos-fonte | 131 `.ts`, 55 `.md`, 9 `.json` | ~186 nós no esqueleto — 5× a fixture de 2 domínios do e2e |
| Estrutura | `sdk/src`, `sdk/tests`, `agents/`, `skills/`, `docs/`, `.claude-plugin/` | 6+ domínios naturais; testa `domains.json` de verdade, não `auth`/`billing` de brinquedo |
| TypeScript real | `sdk/src` com imports entre módulos | única fonte plausível de `meta.deps` ≠ `[]` quando Pass A existir |
| Repo git limpo e separado | `3a27c14` | drift/watch testável sem sujar o repo de trabalho |
| Não é o próprio repo | — | evita auto-referência: hoje `.graph/graph.json` do open-graph-mcp foi gerado no Linux e mascara bugs de path |

**Baseline de expectativa honesta:** o bootstrap fresh produz um
**esqueleto** (`pipeline: "skeleton"`), não um grafo governado — 186 nós
`kind: "File"`, `deps: []`, `edges: 0`, `claims: 0`. Isso é o
comportamento documentado em `packages/mcp-server/src/tools/graph-bootstrap.ts`
(§ nota de realidade), não um defeito a ser "consertado" neste plano.
Qualquer asserção deste plano que espere arestas está errada — ver Fase 6.

---

## 1. Pré-requisitos (bloqueantes, nesta ordem)

### P1. `bun install` aplicado
Verificado ausente em 2026-07-30: `react`, `zustand`, `@xyflow/react`,
`react-markdown`, `@playwright/test` não existiam em `node_modules`.
Sem isso, 5 arquivos de teste nem carregam.

```
bun install
```

### P2. Fix de separador de path (bloqueante para QUALQUER teste no Windows)

Dois pontos, uma causa:

- `packages/mcp-server/src/tools/graph-bootstrap.ts:47` — `path.relative()`
  gera ids `sdk\src\foo.ts` no Windows.
- `packages/graph-core/src/domains.ts:29` `matchesPattern()` — comparação
  de string crua; `"sdk\src\foo.ts"` nunca casa com `"sdk/src/*"` →
  **todo nó cai em `(unassigned)`** → colapsa a camada de células, e com
  ela autoridade β, focus, typing, lock e claims por célula.

Efeito medido em 2026-07-30: 6 dos 25 e2e falham por isso. Este plano é
**invalidado** sem o fix — cada teste de célula abaixo passaria a testar
`(unassigned)` contra `(unassigned)`.

Fix mínimo: normalizar `.split(path.sep).join("/")` na geração do id
(fonte da verdade) e defensivamente em `matchesPattern`. Regressão a
adicionar: um teste em `packages/graph-core/test/` que passe
`"sdk\\src\\foo.ts"` e espere domínio `sdk`.

### P3. Fix de HOME no stdio-proxy (bloqueia Fase 4 só no Windows)
`packages/stdio-proxy/test/helpers.ts:78` isola via `env.HOME`, mas
`packages/stdio-proxy/src/credentials.ts:53` usa `os.homedir()` — que no
Windows lê `USERPROFILE`. O proxy grava no HOME real do usuário e o teste
procura no tmp. 6 falhas. `chmod 0600` (2 falhas) não tem semântica no
Windows — o assert precisa de guarda `process.platform !== "win32"`, não
de remoção.

### P4. `.graph/domains.json` para harness-kit
O repo-alvo não tem um. Sem ele, `assignDomain` cai no fallback de
tiebreak alfabético sobre claims — e sem claims, domínio `null`. Criar
como **fixture versionada neste repo** (não dentro do harness-kit — o
alvo permanece intocado; copiada para um clone temporário na Fase 0):

```json
[
  { "pattern": "sdk/src/*",   "domain": "sdk" },
  { "pattern": "sdk/tests/*", "domain": "sdk-tests" },
  { "pattern": "agents/*",    "domain": "agents" },
  { "pattern": "skills/*",    "domain": "skills" },
  { "pattern": "docs/*",      "domain": "docs" },
  { "pattern": "*",           "domain": "root" }
]
```

Nota: `matchesPattern` é glob simples (exato, `prefix*`, `*suffix`,
`*substr*`), first-match-wins. `"sdk/src/*"` é prefixo — casa recursivo.
A regra `"*"` final é `*substr*` com `pattern.length === 1`, que **cai no
`file === pattern`** — ou seja, NÃO é catch-all. Isso é uma limitação
real de `domains.ts:30-37` a documentar (ou corrigir) e não a contornar
silenciosamente; sem catch-all, o que sobrar vira `(unassigned)`, que é
o comportamento correto e por design não-flipável.

---

## 2. Fases

### Fase 0 — Harness de repo-alvo (0.5 dia)

Entregável: `packages/mcp-server/test/fixtures/target-repo.ts`.

- `prepareTargetRepo(src)` → copia harness-kit para um tmpdir (respeitando
  `DEFAULT_IGNORE`), injeta `.graph/domains.json`, devolve `{ root, cleanup }`.
- **Cópia, nunca o original.** Fase 5 (drift) escreve em arquivos-fonte;
  apontar o watcher para `C:\Users\User\Documents\harness-kit` sujaria um
  repo git de verdade.
- Env var `OG_TARGET_REPO` com default para o path acima, para o mesmo
  harness rodar em CI Linux com um clone.
- Guarda: se o repo-alvo não existir, os testes desta fase fazem `skip`
  com mensagem explícita — nunca falham por ambiente ausente, nunca
  passam em silêncio.

### Fase 1 — graph-core direto contra harness-kit (1 dia)

Hoje: 5 arquivos, 37 testes, só nos módulos que `gates.ts` importa.
QA-4 declarou "não retroativo" — este plano respeita isso e **não** abre
sprint de unit tests. Adiciona só o que o repo-alvo torna testável:

| Alvo | Asserção |
|---|---|
| `scan.ts` / `walkSource` | 186 arquivos-fonte encontrados; `node_modules`, `.git`, `dist` excluídos; symlinks pulados |
| `classify.ts` | distribuição P1-P5 estável e determinística entre duas execuções |
| `domains.ts` | cada arquivo mapeia para o domínio esperado; nenhum `(unassigned)` inesperado; **caso Windows-path** (P2) |
| `build.ts assembleGraph` | função pura, sem fs: meta+claims+survey sintéticos → grafo; `stats` batem com os arrays |
| `boot-gate.ts` | `graphChecksum` idêntico para o mesmo conteúdo; muda quando um nó muda |
| Determinismo | dois `buildGraph(root)` seguidos → JSON byte-idêntico exceto `generatedAt` |

### Fase 2 — mcp-server: bootstrap e query em escala (1-2 dias)

Os 39 arquivos existentes usam fixtures mínimas. Reexecutar os caminhos
críticos contra 186 nós:

- **`graph.bootstrap` fresh** — `pipeline: "skeleton"`; `stats.nodes`
  bate com a contagem de `walkSource`; `edges/claims/domains: 0` **é a
  asserção correta** (ver §0), não um TODO.
- **Idempotência** — segundo `bootstrap` sobre conteúdo inalterado →
  mesmo `graphId`, nenhum evento novo. Terceiro após tocar um arquivo →
  `graphId` diferente.
- **`graph.bootstrap` existing** — `.graph/graph.json` já presente →
  `pipeline: "existing"`, sem reescrever meta.
- **Corrupção** — `graph.json` truncado → `verdict: "corrupt"` → throw,
  não esqueleto silencioso por cima.
- **`graph.query` / resources** — `graph://snapshot`, `graph://cell/{d:P4}`,
  `graph://domain/{d}` sobre os 6 domínios reais; paginação com 186 nós
  (default 100, max 500, `nextCursor` + `hasMore` atravessando a fronteira
  de página — o que uma fixture de 3 arquivos nunca exercita).
- **`graph.rebuild`** — re-lê do disco e re-emite snapshot.

### Fase 3 — client (Node LTS) contra o servidor real (1 dia)

`packages/client` já roda em `node --test` no CI (`client-node`). Estender:

- `connect` + `/events` contra um servidor apontado para harness-kit.
- Snapshot inicial de 186 nós: envelope íntegro, `seq` monotônico.
- Reconexão com `since` — restart do servidor → `graphId` novo → cliente
  descarta `since` e refaz snapshot (comportamento de estado-em-memória
  documentado no README do mcp-server).
- `dist-smoke.mjs` continua valendo — o pacote publicado importa limpo.

### Fase 4 — stdio-proxy end-to-end (0.5 dia, depende de P3)

- `tools/list` / `tools/call` via stdin/stdout JSON-RPC contra servidor
  apontado para harness-kit.
- Bootstrap de credenciais: `--name`, `--tenant`, persistência 0600
  (POSIX), reuso in-process e on-disk, `server` divergente → re-registro.
- `live.test.ts` estendido com um `graph.query` real de payload grande
  (186 nós) — enquadramento de mensagem sob volume, não sob 3 linhas.

### Fase 5 — drift / watch (1 dia, risco alto)

Duas falhas conhecidas hoje (timeout 5s, `drift.node` não emite no
Windows) — `subscribe-drift.test.ts`. Com harness-kit:

- Editar um arquivo ancorado em `sdk/src` → `drift.node` para o cliente
  inscrito.
- Dois clientes recebem o mesmo drift no mesmo tick.
- **Investigação obrigatória primeiro:** determinar se a falha é
  fs-watcher no Windows ou bug de lógica. Se for plataforma, documentar e
  marcar `skip` com motivo — nunca deixar falhando "por ambiente" sem
  registro. Esta é a fase com maior chance de virar tarefa própria.

### Fase 6 — pipeline de conhecimento: o que este plano NÃO prova (0.5 dia, doc)

`edges: 0` no `.graph/graph.json` deste repo não é bug do bootstrap: é
consequência de `meta.deps` sempre `[]` no esqueleto e de `survey.json`
ausente (`build.ts:110-121` só tem essas duas fontes de aresta).

Entregável desta fase é **um documento, não um teste**: registrar em
`docs/roadmap-qa/README.md` (débitos) que a suíte backend cobre o
PROTOCOLO ponta-a-ponta e não cobre Pass A/B/C. Um teste de arestas só
faz sentido depois que existir uma fonte de `deps` — extração de imports
no esqueleto, ou o pipeline de agente. Escrever asserção de aresta antes
disso é teatro.

### Fase 7 — perf e segurança sobre o repo-alvo (1 dia)

- `test:load` / `test:soak` / `test:storm` com `repoPath` = harness-kit;
  comparar contra `perf-log.md`. QD1 vale: nunca bloqueia CI.
  Suspeito nomeado a observar: `presence.who` N+1 (débito 3 do README) —
  186 nós é a primeira carga plausível para vê-lo.
- Reexecutar as 8 linhas de `security-tests.md` sem alteração — o
  repo-alvo não muda a superfície de ataque, mas o inventário é gate de
  release e precisa estar verde na mesma rodada.

---

## 3. Comandos

```bash
bun install                                    # P1
bun test                                       # todos os pacotes (inclui unit do mcp-web, sem browser)
bun run --cwd packages/graph-core   test       # Fase 1
bun run --cwd packages/mcp-server   test       # Fases 2 e 5
node --test packages/client/test/*.test.ts     # Fase 3 (Node LTS real, não shim do bun)
bun run --cwd packages/stdio-proxy  test       # Fase 4
bun run --cwd packages/mcp-server   test:soak  # Fase 7
bun run --cwd packages/mcp-server   test:client-contract
```

Nada acima invoca Playwright.

---

## 4. Definição de pronto

- [ ] P1-P4 fechados; regressão de path-separator versionada.
- [ ] `bun test` verde no Windows **e** no Linux, ou cada `skip` com
      motivo de plataforma escrito no próprio teste.
- [ ] `prepareTargetRepo` versionado, com `skip` gracioso quando o
      repo-alvo não existe.
- [ ] Fases 1-4 com asserções contra os 186 nós reais, incluindo ao menos
      um caso de paginação que atravesse a fronteira de 100.
- [ ] Fase 5 resolvida ou registrada como tarefa própria com dono.
- [ ] Fase 6 documentada no README de QA.
- [ ] Fase 7 com número novo no `perf-log.md`.
- [ ] Suíte backend inteira < 2 min localmente.

---

## 5. Riscos

1. **P2 é bug de produto, não de teste.** Ids de nó com `\` vazam para o
   `graph.json` gravado — um grafo gerado no Windows não é legível por um
   cliente Linux. Escopo maior que "consertar o teste"; pode merecer
   tarefa própria.
2. **Fase 5 pode não fechar.** fs-watch no Windows é historicamente
   irregular. Plano B declarado: documentar + skip, não silenciar.
3. **Acoplamento a um repo externo.** Se harness-kit mudar, contagens
   mudam. Mitigação: assertar propriedades (determinismo, paginação,
   mapeamento de domínio), não números mágicos — exceto onde o número é
   derivado em runtime do próprio `walkSource`.
4. **Expectativa de arestas.** O maior risco deste plano é alguém ler
   `edges: 0` como falha e "consertar" inventando arestas. §0 e Fase 6
   existem para impedir isso.

---

## 6. Esforço

| Fase | Estimativa |
|---|---|
| P1-P4 (pré-requisitos) | 1 dia |
| 0 Harness | 0.5 dia |
| 1 graph-core | 1 dia |
| 2 mcp-server | 1-2 dias |
| 3 client | 1 dia |
| 4 stdio-proxy | 0.5 dia |
| 5 drift | 1 dia (risco) |
| 6 doc | 0.5 dia |
| 7 perf/sec | 1 dia |
| **Total** | **7.5-8.5 dias** |
