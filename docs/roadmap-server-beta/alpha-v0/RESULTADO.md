# Alpha v0 — resultado

Executado em 2026-08-08. Prompts congelados antes da execução.
Veredito pré-registrado (§7 do escopo): **fracasso informativo**.

## Placar

| | Controle (sem MCP) | Tratamento (com MCP) |
|---|---|---|
| Suíte final | **54 arq / 426 testes / 0 falhas** | **54 arq / 426 testes / 0 falhas** |
| Rodadas de teste até passar | 1 | 2 (a 2ª só p/ confirmar a suíte inteira) |
| Duração | ~97 s | ~94 s |
| **Chamadas ao MCP** | — | **0** |
| Violação de regra declarada | nenhuma | nenhuma |

Os dois reconstruíram a feature na primeira tentativa. O braço de tratamento
**não usou o servidor uma única vez.**

## A verificação que não depende de autorrelato

O agente do tratamento declarou não ter usado o MCP. O `server.log` confirma —
6 linhas no total, todas do meu setup de árbitro às 18:44:45 (boot,
`session.register`, `graph.bootstrap`, 2× `graph.query`, `graph.impact`),
nenhuma durante a execução dele.

É exatamente para isso que o log existe. Sem ele, "não usei" seria uma
afirmação sobre a qual não haveria evidência.

## Comparação com o gabarito

| | Linhas | Linhas diferentes do gabarito |
|---|---|---|
| Gabarito (original do projeto) | 184 | — |
| Controle | 102 | 148 |
| Tratamento | 97 | 149 |
| Controle × Tratamento | | 37 |

Os dois chegaram a implementações **funcionalmente equivalentes** (a suíte é o
juiz) e **estruturalmente mais enxutas** que a original — ~100 linhas contra
184. Não é "pior": o gabarito trata casos que o teste não exercita. É a
diferença esperada entre implementar-contra-teste e implementar-contra-produto.

Os dois braços convergiram entre si (37 linhas de diferença) mais do que
qualquer um convergiu com o original. Ambos leram as mesmas fontes decisivas: o
arquivo de teste, `AbstractCliRunner.ts` e os adaptadores irmãos.

## Por que o resultado é este — e a lição de desenho

**O teste tem 199 linhas e a implementação tem 184.** A especificação é maior
que o artefato. O teste dita os argumentos exatos da linha de comando, dois
formatos de evento JSON, as duas variantes de nomes de campo de usage, e as
mensagens de erro literais.

Com um teste assim, **não sobra ambiguidade para um grafo de conhecimento
resolver**. As duas perguntas que o open-graph responde bem — "o que existe" e
"o que quebra se eu mexer" — já estavam respondidas pelo teste e pelos cinco
irmãos no mesmo diretório.

Isso é uma limitação do **experimento**, não do produto. Escolhi a feature por
separar limpo entre implementação e teste, e essa mesma propriedade a tornou
auto-especificada demais para discriminar entre os braços.

## O que isto de fato mede

**Mede:** que as tools não atrapalharam, que o servidor ficou de pé o exercício
inteiro, e que um agente competente resolve esta classe de tarefa sem grafo
nenhum. Uma linha de base honesta.

**Não mede:** se o grafo ajuda, porque nunca foi consultado. E não mede a
integração real do Claude Code — os agentes falaram HTTP direto com o `/mcp`,
não por `claude mcp add --transport http`. Essa continua sendo sua tarefa.

## Achado colateral sobre o harness-kit

Os dois braços dispararam alerta de segurança do harness por embutirem
`--dangerously-bypass-approvals-and-sandbox` como argumento fixo do `codex`.

Verificado: a flag está **no arquivo de teste** (linhas 98 e 117 — a
especificação) e **na implementação original do projeto** (linha 22). Os
agentes não inventaram nada; reproduziram o que os mantenedores escreveram.

O alerta é um fato verdadeiro sobre o `harness-kit`: o adaptador do Codex
desabilita sandbox e aprovação por padrão. É decisão de vocês, no repositório
de vocês — fica registrado porque apareceu, não como recomendação.

## Como fazer o próximo alpha discriminar

O problema é a escolha da feature, e há três caminhos:

1. **Feature sem teste que a especifique.** Reverter algo cuja verificação seja
   indireta (um teste de integração que só falha, sem dizer por quê). Aí é
   preciso entender o sistema, não ler a spec.
2. **Feature transversal.** Algo que toque muitos arquivos, onde "o que quebra
   se eu mexer aqui" (`graph.impact`) tenha resposta não-óbvia. Um adaptador
   novo num diretório com cinco irmãos é o caso mais fácil que existe.
3. **Experimento B — grafo com conhecimento.** Rodar com `claims` commitadas
   antes do revert, e não com `claims: 0`. Aí o grafo carrega julgamento
   humano, não só estrutura — que é a tese do produto. Com a ressalva de
   vazamento do §3 do escopo.

Recomendo (2) combinado com (3): é onde a hipótese do produto é falsificável de
verdade.
