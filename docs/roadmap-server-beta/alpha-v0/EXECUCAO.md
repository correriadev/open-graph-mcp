# Alpha v0 — execução (em andamento)

Iniciado em 2026-08-08. Prompts **congelados antes** de qualquer resultado.

## Montagem

| Braço | Worktree | MCP |
|---|---|---|
| **Controle** | `alpha-v0/controle` | não |
| **Tratamento** | `alpha-v0/tratamento` | `http://127.0.0.1:8890` |

Worktrees **independentes** — se compartilhassem, o segundo braço começaria
sobre o trabalho do primeiro.

Prompts idênticos exceto por um parágrafo: o do tratamento diz que existe um
servidor de grafo, como falar com ele, e que **a decisão de usar é dele**.
Nenhuma instrução sobre *como* usar. Se ele não usar, isso é o achado.

### Por que rodaram em paralelo

O escopo (§4) manda o controle primeiro, e a razão era contaminação do
**avaliador**: rodar o tratamento antes faria o controle acontecer numa cabeça
que já viu o resultado. Escrevendo os dois prompts **antes** de qualquer
execução e congelando-os, essa contaminação some — nenhum resultado pode
influenciar o enunciado do outro braço. Os agentes não compartilham contexto
nem worktree.

## O grafo do braço de tratamento (experimento A)

Indexado com a implementação **já revertida**, então o grafo não sabe que a
feature existiu:

```
bootstrap: {"nodes":298,"edges":613,"claims":0,"domains":5}
```

Verificado antes de soltar os agentes: os irmãos (`AntigravityCLIRunner`,
`ClaudeCLIRunner`, `CopilotCLIRunner`, `CursorCLIRunner`, `KiroCLIRunner`) e a
classe base `AbstractCliRunner.ts` aparecem; de Codex só existe o **teste**, não
a implementação. Sem vazamento.

`graph.impact` no `AgentRunnerFactory.ts`: 9 dependentes, 11 dependências.

## Vedação do gabarito

Antes de soltar os agentes:

- a implementação original e o `FEATURE.diff` foram movidos para **fora** de
  `alpha-v0` (estavam em `alpha-v0/gabarito`, onde um `ls` os acharia);
- o `alpha-manifest.json` saiu junto — ele **anunciava o hash do commit** da
  feature, que é tudo que um agente precisaria para um `git show`.

O que resta como via de vazamento, e não dá para eliminar sem reescrever
história: o commit da feature continua no histórico do próprio worktree, e
existe outra cópia do projeto no disco (`Documents/harness-kit`). As duas estão
**explicitamente proibidas** nos prompts, e a verificação é a transcrição —
cada agente foi instruído a declarar violação acidental, e um resultado honesto
foi declarado mais valioso que um bonito.

## Instrumento

`alpha-v0/mcp-state/server.log` — uma linha JSONL por chamada, com tool,
duração e veredito. É ele que responde objetivamente **se** o braço de
tratamento usou a ferramenta, sem depender do que o agente relata.

## Oráculo

`cd sdk && npx vitest run src/`

| Estado | Arquivos | Testes |
|---|---|---|
| Pristino (alvo) | 54 ok | **426** |
| Revertido (início dos dois braços) | 53 ok, 1 falha | 419 |

7 testes a reconquistar. Nenhum dos 419 pode quebrar.
