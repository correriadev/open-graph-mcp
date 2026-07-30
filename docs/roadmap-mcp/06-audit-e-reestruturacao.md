# Auditoria de arquitetura + proposta de reestruturação

> Data: 2026-07-30. Autor: análise assistida, sob pedido do proprietário.
> Status: **proposta p/ discussão** — nada aqui é decisão tomada.
>
> Contexto: o projeto não está testável por exploração. Este documento
> audita por quê, e propõe a sequência mínima até uma versão que se possa
> abrir e usar. Alinhado às três correções do proprietário: (1) intenção é
> **status de nó**, não tipo novo; (2) a prioridade é **uma versão
> testável**; (3) federação é necessária.

---

## 0. Achado principal

**O pipeline determinístico de conhecimento já existe, vendorado, e nunca
foi ligado ao servidor.**

`packages/graph-core` tinha **47 módulos**. Partindo do que o `mcp-server`
importa e seguindo o fecho transitivo, **26 eram alcançáveis** e
**21 nunca eram executados**:

```
boot-router  changeset-store  claims  context-compiler  docs  expand
extract-go  extract-python  extract-rust  federation  graphci  greenfield
intent-changeset  layout  merge-driver  migrate  project  quadtree
score  view  worktree
```

**Atualização 2026-07-30 (B3):** `changeset-store` e `intent-changeset`
foram DELETADOS — 45 módulos, 19 mortos. Ver §2 Eixo B3 para o racional e
para o que foi reimplementado no servidor.

Entre os 21 estão exatamente as capacidades que faltam:

| Módulo morto | O que ele faz | Ponto que resolve |
|---|---|---|
| `claims.ts` | Gera claims determinísticas de um arquivo (imports via AST → claim `dependency`, exports, âncoras verbatim). **Sem LLM.** | Testabilidade |
| `resolve.ts`* | Resolve spec de import → arquivo real | Arestas reais |
| `extract-{go,python,rust}.ts`, `symbols.ts`* | Nós em nível de símbolo, multi-linguagem | Granularidade |
| `federation.ts` | Manifesto assinado da superfície pública + merkle root + torre estrangeira read-only | (3) Federação |
| `greenfield.ts` | Subida governada **sem arquivo embaixo** — âncora no texto da claim-pai | (1) Nó planejado |
| `intent-changeset.ts` | Lote de intenção → 1 changeset atômico com blast radius | (1) Intenção |
| `project.ts`, `expand.ts`, `ascent.ts`* | Escada bidirecional (intenção ↔ código) | (1) Status |
| `graphci.ts` | Gate de merge headless: diff ancorado, autoridade, break-glass | Substituir CI convencional |
| `merge-driver.ts` | Driver de merge git | Substituir git |
| `changeset-store.ts` | Changeset primitivo | Duplicado no servidor |

\* alcançáveis, mas só por fatias mínimas (ver §1.2).

**Consequência:** a nota em `graph-bootstrap.ts` — *"o pipeline brownfield
REAL é uma sessão de agente LLM; não é spawnável"* — é **materialmente
enganosa**. Existe um piso determinístico (`claims.ts`, explicitamente
"TS puro, sem LLM") que produz claims e arestas de verdade. Ele foi
vendorado em 2026-07-12 e nunca conectado. O que o servidor expõe hoje
não é "a Fase 1 do pipeline" — é um **listador de arquivos**.

Isto reenquadra o trabalho: **não é construir o que falta, é conectar o
que já está lá.**

---

## 1. Auditoria

### 1.1 Por que não dá para testar por exploração

Encadeamento, do sintoma à raiz:

1. Abrir a UI mostra 186 caixas sem ligação — `edges: 0`, `claims: 0`,
   `domains: 0`.
2. Porque `buildSkeleton()` grava `deps: []` fixo e não existe `survey.json`,
   e `build.ts` só tem essas duas fontes de aresta.
3. Porque `buildSkeleton()` é um `readdir` recursivo de ~20 linhas, não o
   indexador vendorado.
4. **Sem claims, não há células com autoridade β.** Sem β, o lock, o gate
   e o changeset não têm sobre o que operar — as features das Fases 2-4
   existem mas não têm substrato.
5. Sem substrato, não há estado interessante para explorar. Só resta
   clicar em caixas cinzas.

Não é imaturidade difusa. É **um ponto de solda faltando**, e ele é
identificável em uma função.

### 1.2 Fatias mínimas: o módulo é importado, a capacidade não

Importar o módulo não significa usar a capacidade. Três casos:

- `extract.ts` — o servidor importa **só `excerptCheck`** (`gates.ts:15`).
  `extractImports`/`extractImportsAst`, que produzem as arestas, nunca são
  chamados pelo servidor.
- `indexer.ts` — usado só por `graph-query.ts` para busca por termo. O
  conceito de *gap* ("o termo não casou nada → pergunte ao humano"), que o
  próprio módulo chama de load-bearing, não é exposto por nenhuma tool.
- `changeset-store.ts` — **não alcançado**: o `mcp-server` reimplementou
  changesets em `tools/changeset.ts`. Duas noções de changeset no mesmo
  produto, livres para divergir. **Resolvido em B3** (vendorado deletado).

### 1.3 Dois modelos de verdade coexistindo

Já levantado na conversa, resumido aqui por completude:

| | `graph.bootstrap` (Fase 1) | `graph.import` (Fase 2+) |
|---|---|---|
| Token | nenhum | `requireToken` |
| Tenant | `DEFAULT_TENANT` fixo | do token |
| Destino | `.graph/` no repo-alvo + memória | SQLite + JSONL por tenant |
| Alinhado ao ADR D1 | **não** ("não há `.graph/` no cliente") | sim |

O caminho legado nunca foi aposentado quando a Fase 2 chegou.

### 1.4 Cobertura de teste x superfície

`graph-core`: **6 arquivos de teste para 47 módulos**. Os 21 módulos
não-ligados são também **não-testados**. Qualquer plano que os ligue
importa risco silencioso — e é por isso que §3 impõe teste-antes-de-ligar.

### 1.5 Vendoring congelado

`PROVENANCE.md` fixa a origem em `adc6a322`, 2026-07-12. Não há mecanismo
que detecte divergência com o upstream. Quanto mais tempo os 21 módulos
ficarem parados, mais caro o merge quando alguém precisar deles.

---

## 2. Proposta de reestruturação

Cinco eixos. **O Eixo A sozinho entrega a versão testável.** Os demais são
a direção de longo prazo que ele destrava.

### Eixo A — Testabilidade (prioridade absoluta)

**A1. Substituir `buildSkeleton` pelo pipeline determinístico.**
`claims.ts` + `resolve.ts` sobre cada arquivo-fonte: imports resolvidos →
`meta.deps` reais → arestas `depends-on` reais; claims `dependency`/
`export` com âncora verbatim → células com conteúdo. Sem LLM, sem
dependência nova. É a solda que falta.
*Resultado observável: `edges: 0` → milhares; `claims: 0` → milhares;
`domains: 0` → os domínios reais de `domains.json`.*

**A2. Nós em nível de símbolo.** `symbols.ts`/`treesitter.ts` já estão
vendorados. Nó = símbolo, não arquivo. É o que torna "célula" uma unidade
significativa em vez de sinônimo de pasta.

**A3. `graph.seed` — estado rico determinístico.** Uma tool/CLI que, sobre
um repo indexado, fabrica um estado **explorável**: N identidades, alguns
changesets commitados, claims com verdicts variados, autoridade β em
algumas células, histórico de eventos. Semente fixa → estado idêntico.
*Sem isto, mesmo com A1 o teste exploratório começa num grafo sem história
— dá para ver, não dá para exercitar presença, lock, drift, rebase.*
**Este é o item que mais separa "vejo um grafo" de "consigo testar".**

**A4. Inspector CLI.** `og inspect <repo>` imprimindo nós, células,
autoridade, locks e as últimas N linhas do event log. Hoje só se enxerga o
estado por HTTP+SSE, o que obriga a ter cliente rodando para diagnosticar
qualquer coisa.

**A5. Replay do event log.** O JSONL já é append-only e `rebuildFromJsonl`
já existe: expor "reconstruir até seq N" é quase grátis e converte
qualquer bug observado em caso reproduzível.

### Eixo B — Um único modelo de verdade

**B1.** Um pipeline de escrita só: indexar → SQLite + JSONL por tenant,
sempre com token. `graph.bootstrap` vira **admin-only** ou é aposentado.
**B2.** `.graph/` deixa de ser store e passa a ser **formato de
intercâmbio** (export/import, e insumo da federação) — o que reconcilia
com D1 sem jogar fora o formato.
**B3. FEITO (2026-07-30).** Deletados `graph-core/src/changeset-store.ts` e
`graph-core/src/intent-changeset.ts`. Ficou a implementação do servidor
(`mcp-server/src/tools/changeset.ts`): a vendorada era file-based (gravava em
`.graph/` do repo — a violação de D1 que este documento pede para eliminar),
sem tenant, sem token, sem lock por célula, sem transação, sem eventos, e era
código morto (só `intent-changeset.ts`, também morto, a importava).

Features que ela tinha e o servidor não, reimplementadas ou verificadas:

- **`blastRadius`** — reimplementado em `mcp-server/src/gates.ts` como função
  pura sobre os deltas persistidos + as células trancadas. Fechou um bug real:
  `blast_cells` era gravado só na CRIAÇÃO do changeset, então **expandir** um
  turno aberto (reabrir com uma célula já trancada + uma nova reusa o csId e
  tranca a nova) deixava o registro de auditoria subdeclarado. Agora é
  recalculado no commit, e o evento `changeset.committed` carrega `blastCells`
  (quais) além de `blastRadius` (quantas) — número sozinho não é revisável.
- **Gating por integridade de escada (`roundtripScoped`)** — **já estava**
  implementado no servidor antes desta limpeza: `gates.ts` o usa no gate
  incremental (advisory, vira `warning`) e no final (bloqueante, agregado por
  claim-raiz nova). Nada a portar.
- **`commitIntent`** (o wrapper de intenção do `intent-changeset.ts`) — NÃO foi
  portado, de propósito: é o Eixo C, que precisa ser desenhado sobre o
  changeset do servidor (tenant/lock/transação) e não sobre um arquivo. O
  conceito que vale preservar é "um lote de intenção multi-célula = UM objeto
  revisável", e o servidor já tem a primitiva (changeset multi-cell) para isso.

Verificado no caminho: o gate de escopo bloqueia claim **e** `authority.flip`
fora das células trancadas — logo o raio nunca cresce por delta fora do lock.
A união com as células declaradas existe porque uma célula pode ser trancada e
não receber delta nenhum: foi reservada, e isso é parte do raio revisável.
**B4.** `graphChecksum` passa a incluir âncora/conteúdo — fecha a lacuna
de invalidação achada nos testes (grafo em disco reescrito, memória velha,
mesmo `graphId`).

### Eixo C — Intenção como status de nó (correção 1 do proprietário)

Sem tipo de nó novo, como pedido:

**C1.** `status` no nó: `actual | planned | in-progress | deprecated`. Um
nó `planned` aponta para um arquivo que **ainda não existe** — caso que
`greenfield.ts` já resolve (âncora no texto da claim-pai, não em arquivo).
A aresta que liga o nó atual ao próximo carrega status correspondente.
**C2.** Ligar `intent-changeset.ts`: uma intenção = **um** changeset
atômico multi-célula, com blast radius, aprovado de uma vez. É o "ticket"
sem inventar entidade.
**C3.** O board é uma **query**, não uma tela nova: "o que está `planned`
no domínio X". Jira/Trello viram projeção do mesmo grafo.
**C4.** Ciclo de vida fecha sozinho: quando o arquivo real passa a existir
e a claim ancora nele, o nó vira `actual`. Nada de status copiado à mão —
é a diferença estrutural em relação a linkar ticket no commit message.

### Eixo D — Federação (correção 3 do proprietário)

**D1.** `federation.ts` já tem manifesto de superfície pública, merkle
root e pin em lock — mas **por invariante não faz rede** (`INV-H4-1`), é
vendoring manual de manifesto. Para malha: o próprio MCP **serve** seu
manifesto por HTTP; o consumidor busca e pina o root. A criptografia já
está pronta; falta o transporte e a política de atualização de pin.
**D2.** Autoridade cross-server é a **mesma regra um nível acima**: um
cérebro referencia célula de outro sem possuí-la, como hoje um claim
referencia nó sem ter autoridade na célula. Não precisa de conceito novo.
**D3.** Consequência a decidir cedo: identidade e confiança entre
servidores (quem assina, como se revoga). É o que trava D1 na prática.

### Eixo E — Disciplina de risco

**E1. Nenhum módulo é ligado sem teste próprio antes.** Os 21 são código
não exercitado; ligá-los às cegas troca "capacidade ausente" por "bug
silencioso", que é pior.
**E2.** Monitorar divergência com o upstream do vendoring.
**E3.** Marcar explicitamente o que é capacidade viva e o que é vendor
dormente — hoje a pasta parece 47 capacidades e entrega 26.

---

## 3. Sequência recomendada

```
E1 (teste antes de ligar)
   │
   ▼
A1 indexação determinística ──► A3 seed ──► VERSÃO TESTÁVEL ◄── objetivo
   │                                              │
   ├─► A2 símbolos                                ▼
   ├─► A4 inspector                        teste exploratório real
   └─► A5 replay                                  │
                                                  ▼
                                    B (verdade única) ──► C (status/intenção)
                                                              │
                                                              ▼
                                                          D (federação)
```

**O caminho crítico até "consigo testar" é E1 → A1 → A3.** Tudo o mais
depende de existir um grafo com conteúdo para operar.

## 4. O que este documento NÃO afirma

- Não afirma que `claims.ts` funciona: é código vendorado, **não testado,
  nunca executado neste produto**. A1 pressupõe validá-lo (E1), e é
  plausível que ele exija correção antes de ligar.
- Não estima esforço. As estimativas honestas dependem do resultado de E1
  sobre `claims.ts` e `resolve.ts`.
- Não propõe substituir CI/CD de execução (build/deploy sandboxado).
  `graphci.ts` é gate de merge, não executor — a lacuna de execução real
  permanece aberta e é de outra natureza (infra e confiança).
