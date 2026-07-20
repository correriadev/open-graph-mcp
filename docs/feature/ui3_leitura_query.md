# UI-3 Leitura e Query

## OVERVIEW

Disponibilize leitura navegável do grafo por **claims**, busca `graph.query`, histórico filtrável, árvore lateral e navegação entre referências. Preserve lacunas como resultados explícitos e derive claims do snapshot persistido.

## FOLDER STRUCTURE

```text
packages/
├── mcp-server/
│   ├── src/resources.ts              # projeta graph://claims por célula ou snapshot
│   └── test/resources.test.ts        # valida escopo SQL e projeção de claims
└── mcp-web/
    ├── e2e/query-and-read.e2e.ts     # cobre busca, lacunas, claims e referências
    ├── src/
    │   ├── app.tsx                   # integra rotas, query, histórico e sidebar
    │   ├── claims-browser.tsx        # lista claims, proveniência e relações reversas
    │   ├── history-view.tsx          # filtra e expande eventos de histórico
    │   ├── latest-request.ts         # descarta respostas assíncronas obsoletas
    │   ├── og.ts                     # adapta recursos e query do servidor
    │   └── query-bar.tsx              # busca debounced com matches e lacunas
    └── test/
        ├── latest-request.test.ts     # valida concorrência entre requests
        └── reverse-index.test.ts      # valida índice reverso snapshot-wide
```

## COMPONENTS

| Componente | Responsabilidade | Regra principal |
|---|---|---|
| `QueryBar` | Executar `graph.query` e renderizar matches ou lacunas | REQUIRED: exibir termo sem match e sugestões de refinamento. |
| `ClaimsBrowser` | Listar claims da célula e abrir detalhes | REQUIRED: mostrar proveniência, refs e `referenciado por`. |
| `HistoryView` | Exibir auditoria e payload detalhado | REQUIRED: persistir filtros `byUser`, `target` e `kind` na URL. |
| `latestRequest` | Ordenar respostas concorrentes | REQUIRED: ignorar resposta anterior após uma solicitação mais recente. |
| `graph://claims` | Projetar claims persistidos | REQUIRED: restringir leituras por tenant e célula no SQL. |

## DATA FLOW

1. **Abra** `QueryBar` por `#queryBtn` ou atalho de teclado.
2. **Execute** `graph.query` após o debounce e descarte respostas obsoletas.
3. **Selecione** um match para centralizar o nó e abrir sua célula no `ClaimsBrowser`.
4. **Leia** `graph://claims?cell=<domain:level>` para obter claims ordenados da célula.
5. **Construa** o índice reverso sobre todos os claims do snapshot.
6. **Navegue** por `RefChip` para abrir o claim alvo, inclusive em outra célula.

## INVARIANTS

- REQUIRED: trate lacunas como resultado de primeira classe, nunca como lista vazia silenciosa.
- REQUIRED: derive `referenciado por` do conjunto completo de claims do snapshot.
- REQUIRED: preserve o claim selecionado ao navegar entre células por referência.
- REQUIRED: mantenha filtros de histórico reproduzíveis pela URL.
- REQUIRED: renderize conteúdo de claim e payload como dados não editáveis.
- PROHIBITED: misture claims de tenants ou células diferentes na leitura filtrada.

## USER INTERFACE CONTRACT

| Seletor | Contrato |
|---|---|
| `#queryBtn` | Abrir a busca global. |
| `#query-input` | Receber o termo consultado. |
| `.query-result` | Selecionar um match conhecido. |
| `.query-gap` | Exibir ausência explícita de resultado. |
| `.refinement-suggestion` | Oferecer refinamento para uma lacuna. |
| `#claims-panel` | Exibir claims da célula selecionada. |
| `.claim-row` | Abrir um claim. |
| `.open-claim` | Exibir detalhes e proveniência. |
| `.ref-chip` | Navegar para o claim referenciado. |
| `.referenced-by` | Exibir referências reversas. |
| `#history-byuser`, `#history-target`, `#history-kind` | Controlar filtros persistidos do histórico. |

## VALIDATION

1. **Execute** os testes focados do servidor:

```bash
# CORRECT: valida o recurso de claims
bun test packages/mcp-server/test/resources.test.ts

# WRONG: omite a validação do isolamento de leitura
bun run dev
```

2. **Execute** os testes unitários da UI:

```bash
# CORRECT: valida concorrência e índice reverso
bun test packages/mcp-web/test/latest-request.test.ts packages/mcp-web/test/reverse-index.test.ts
```

3. **Execute** o cenário ponta a ponta:

```bash
# CORRECT: valida o fluxo completo de leitura e query
bun run --cwd packages/mcp-web test:e2e -- e2e/query-and-read.e2e.ts
```

## REFERENCES

| Documento | Relação |
|---|---|
| [UI-2 Turnos E2E](./ui2_turnos_e2e.md) | Define o harness, os eventos ao vivo e os contratos de turno reutilizados pela leitura. |
