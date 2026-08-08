# Alpha v0 — ambiente preparado

Escopo: `../02-scope-alpha-v0-reproducao-controlada.md`.
Preparado e **verificado ao vivo** em 2026-08-08.

## Onde está

| Caminho | O que é |
|---|---|
| `C:/Users/User/Documents/alpha-v0/harness-kit` | Cópia física (clone local). **O agente trabalha aqui.** |
| `C:/Users/User/Documents/alpha-v0/gabarito` | Implementação original + `FEATURE.diff`. **Fora do worktree, de propósito.** |
| `C:/Users/User/Documents/alpha-v0/alpha-manifest.json` | Números medidos. |

O repo original (`Documents/harness-kit`) **não foi tocado** e segue limpo.

## A feature

`2c965b3 feat: Add Codex CLI execution adapter and corresponding tests`

Escolhida porque separa limpo em implementação × teste, e porque
`CodexCLIRunner` tem **irmãos** (`ClaudeCLIRunner`, `CopilotCLIRunner`,
`AntigravityCLIRunner`) — há um padrão a inferir, que é o tipo de conhecimento
que um grafo deveria carregar.

O commit toca 6 arquivos: a implementação (`codex-cli/CodexCLIRunner.ts`, 184
linhas), três fiações de uma linha (`AgentRunnerFactory.ts`, `types.ts`,
`index.ts`), o ADR, e o **teste** (`__tests__/CodexCLIRunner.test.ts`, 199
linhas).

## O que foi feito, e a decisão que importa

`git revert --no-commit 2c965b3` aplica limpo — **mas apaga o teste junto**.
Sem teste não há gabarito e qualquer coisa que o agente escrever "funciona".
Por isso o teste é **restaurado** logo depois. Ele é o oráculo.

Estado atual do worktree:

```
 M sdk/docs/adr/AGENT-RUNNERS.md
 M sdk/src/agent-runner/AgentRunnerFactory.ts
 D sdk/src/agent-runner/codex-cli/CodexCLIRunner.ts   <- implementação removida
 M sdk/src/agent-runner/types.ts
 M sdk/src/index.ts
```

O teste está presente e falhando. `npm ci` já rodou.

## O oráculo — medido, não estimado

Escopo: `cd sdk && npx vitest run src/` (só unitários).

| Estado | Arquivos | Testes |
|---|---|---|
| **Pristino** | 54 ok, 0 falhas | **426** |
| **Revertido (agora)** | 53 ok, **1 falha** | **419** |

**Critério de sucesso: voltar a 54 arquivos e 426 testes, 0 falhas.** São
exatamente **7 testes** a reconquistar.

### Por que só `src/`

`npx vitest run` sem escopo varre também `tests/e2e/`, onde **7 arquivos falham
antes e depois do revert** — sobem CLIs reais e dependem de ferramentas
externas. Incluí-los tornaria "os testes passam" imensurável. Ficam fora do
oráculo de propósito, e a nota está no manifesto.

## O script

`prepare_alpha.py` reproduz tudo isto do zero, de forma idempotente:
pré-requisitos → cópia → `npm ci` → baseline pristino → gabarito → revert +
restaura teste → baseline revertido → manifesto.

```bash
python prepare_alpha.py            # prepara do zero
python prepare_alpha.py --verify   # mede e compara com o baseline
python prepare_alpha.py --reset    # devolve a cópia ao estado pristino
```

Ele traz uma **guarda dura**: se depois do revert a suíte continuar verde, o
revert não removeu a feature e o experimento seria nulo — o script aborta em vez
de deixar você rodar um teste sem gabarito.

> **Python não está instalado nesta máquina** (nem no PATH, nem no disco;
> `winget` disponível). O ambiente acima foi preparado **manualmente com os
> mesmos passos** e verificado ao vivo, então está pronto para uso agora. O
> script fica para reprodução/reset — para rodá-lo:
> `winget install Python.Python.3.12`.
>
> A parte mais frágil dele (interpretar a saída do vitest) foi validada contra a
> saída **real** dos dois baselines, mais os casos de borda "nada passa" e um
> nome de teste contendo a palavra "Tests".

## Antes de começar

1. **Braço de controle primeiro** (sem MCP), depois o de tratamento. Na ordem
   inversa, o controle acontece numa cabeça que já viu o resultado.
2. **Proibir o agente de consultar o histórico do git da feature** — `git log`,
   `git show`, `git diff`, `reflog`, `stash`. O gabarito está a um comando de
   distância, e o `FEATURE.diff` está fora do worktree justamente por isso.
3. **Decidir qual grafo o agente enxerga** (§3 do escopo): pré-feature mede
   "ajuda a construir"; pós-feature mede "o conhecimento sobrevive ao código".
   Como o revert já foi aplicado, um `graph.bootstrap` agora indexa o estado
   **pré-feature** — que é o experimento A, o recomendado.
