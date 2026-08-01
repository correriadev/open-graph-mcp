# Plano — F1 lock implícito · F2 greenfield pela web

> Data: 2026-07-31. Duas decisões do proprietário, planejadas juntas e executadas em
> sequência (ambas tocam `transport.ts` e a camada de gate).
>
> **F1.** O lock some do vocabulário. O gatilho é a transição LEITURA → EDIÇÃO; o nó
> passa a exibir *em edição por quem*.
> **F2.** Pela web só se faz GREENFIELD. Brownfield (indexar repo) é do agente, que
> tem filesystem. Browser não tem — `repoPath` pela web só funciona enquanto
> servidor e cliente são a mesma máquina.

---

## F1 — Lock implícito

### Hoje

Turno é declarado ANTES de saber o que se vai fazer: escolhe células, escreve
`intent`, e só então pode escrever. Três gatilhos explícitos de "Abrir turno" na web
(`app.tsx` topbar, `cell-container.tsx` cabeçalho, `claims-browser.tsx`), todos
chamando `openTurn()` → `changeset.open { cells, intent }` (`og.ts:297`). Contenção
volta como `cell_locked` e vira o banner `denied`.

### Alvo

| | Hoje | Alvo |
|---|---|---|
| Gatilho | botão "Abrir turno" | foco no campo de edição / 1ª tool de mutação |
| `intent` | obrigatório na abertura | pedido no **commit** |
| Contenção | erro `lock.denied` depois de tentar | estado do nó ANTES: "Bob editando" |
| Vocabulário | lock, turno, changeset | *em edição por X* |

### Decisões já tomadas (derivadas do modelo, não perguntadas)

1. **Granularidade continua por CÉLULA; apresentação por nó.** Autoridade, gates,
   coverage e roundtrip são todos escopados por `domain:level`. Mover o lock para o
   nó forkaria o modelo em dois escopos. O nó **herda e exibe** o estado da célula.
2. **`intent` migra para o commit.** Pedi-lo na abertura é exatamente o modal que
   estamos removendo.
3. **O changeset NÃO some** — continua sendo o mecanismo (atomicidade, gate, blast
   radius, auditoria). O que some é a exigência de declará-lo.

### Escopo

**Servidor**
- `changeset.claim` abre o turno implicitamente quando não há um aberto para a
  célula do delta, com `intent: ""`. Devolve o `csId` para o cliente rastrear.
- Nova tool **`node.edit { token, nodeId }`**: declara intenção de editar sem ainda
  ter delta (é o gatilho da UI ao focar o campo). Abre/reusa o turno da célula do nó
  e devolve `{ ok, csId, cell }` ou `{ ok: false, editingBy, since }`.
- `changeset.commit` aceita `intent` (obrigatório aqui agora).
- Eventos: `lock.acquired`/`lock.released` ganham par de projeção
  **`node.editing` / `node.idle`** com `{ cell, nodes[], byUser, holderName }`.
  Mantém os antigos (auditoria/afinidade já dependem deles).
- `changeset.open` continua existindo como caminho explícito (agentes que querem
  turno multi-célula deliberado). Não é mais o único caminho.

**Web**
- Remove os 3 gatilhos "Abrir turno". Editar um nó dispara `node.edit`.
- Card e painel do nó exibem *em edição por X* (estado, não cadeado).
- Campo desabilitado quando `editingBy` é outro; sem banner de erro.
- Commit pede o `intent` num campo simples.

### Riscos
- **Turno órfão:** `node.edit` abre turno que pode nunca receber delta. O TTL já
  cobre (sweeper expira), mas vale abortar no blur sem deltas.
- **Corrida:** dois usuários focam ao mesmo tempo. O segundo recebe
  `{ ok: false, editingBy }` — a UI reverte para leitura. Testar explicitamente.

---

## F2 — Greenfield pela web

### Hoje

`graph.bootstrap` exige um repo no filesystem do servidor. Sem repo não há grafo.
`incrementalGate` valida âncora contra ARQUIVO (`readFile(c.file)` + `excerptCheck`).

### Alvo

Criar conhecimento **sem chão de código** — ideação → concepção → arquitetura antes
de existir arquivo. A regra de âncora não muda, só a fonte do chão: a claim ancora
no **texto da claim-pai** em vez de num arquivo.

Já existe vendorado (entre os 19 módulos mortos):
- `ascent.ts` — a escada literal:
  `["ideação", "concepção", "arquitetura", "cenários", "testes", "código"]`,
  `CODE_LEVEL = 5`. `ascentGate(reconstructed, fileOf, readFile, policy)`.
- `greenfield.ts` — `greenfieldAscent(reconstructed, parentClaimsById, policy)`:
  mesmo `ascentGate`, com `fileOf`/`readFile` resolvendo `claim:<id>` → texto da
  claim-pai. Hard-block se a âncora não aparece verbatim no texto do pai —
  **idêntico ao brownfield**.
- `isFixedPoint` / `greenfieldReport` — aceite mecânico:
  `ascent(project(intent))` reproduz `intent`. Não é julgamento de LLM.

### Escopo

**Servidor**
- Nova tool **`graph.create { token, name }`** — grafo vazio no tenant,
  `tenants.repo_path` NULL, `mode: "greenfield"`. Emite `graph.created`.
- Coluna `tenants.mode` (`"brownfield" | "greenfield"`).
- `gates.ts` ganha branch greenfield: quando o tenant é greenfield (ou a claim
  referencia `claim:<id>`), a âncora é checada contra o texto da claim-pai via
  `greenfieldAscent`, não contra arquivo.
- `graph.rebuild` num tenant greenfield é no-op (não há repo p/ reindexar).
- Nós greenfield: criados a partir das claims admitidas (não de arquivos).

**Web**
- Tela inicial quando o tenant não tem grafo: "indexar repo (via agente)" vs
  **"criar do zero"**.
- Editor de escada: criar nó de ideação (nível 1, `refs: []`), descer para
  concepção referenciando o pai, etc. Nível exibido pelo nome (`levelName`).
- O gate greenfield roda no `changeset.claim` e o erro aponta a âncora que não
  ancora no texto do pai.

### Riscos
- **`greenfield.ts` é código morto e não testado.** Vale o E1 do documento de
  auditoria: teste próprio ANTES de ligar. Pode exigir correção.
- **Fronteira brownfield/greenfield.** Um tenant greenfield que depois ganha código
  precisa reconciliar — FORA deste escopo, registrar como pendência.

---

## Sequência

F1 primeiro: é menor, independente, e melhora o fluxo que já funciona. F2 depois,
começando pelo teste de `greenfield.ts` antes de ligá-lo.
