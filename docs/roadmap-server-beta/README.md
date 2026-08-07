# Roadmap-server-beta — índice

> Como fechamos um **beta do SERVIDOR MCP**: alguém que não é o dono aponta o
> próprio agente de código para o `/mcp` e usa por dias, sem o dono por perto.
> Irmão de `roadmap-mcp/` (produto), `roadmap-qa/` (qualidade),
> `roadmap-integrations/` (conexão) e `roadmap-beta-test/` (sessão de
> co-criação, **adiado**). Baseline: `main` pós-merge da branch de UI
> (2026-08-06), 370 testes verdes no root.

## A tese (ler antes dos escopos)

**Existem duas betas neste projeto e elas não são a mesma coisa.**

`roadmap-beta-test/` descreve uma **sessão síncrona de co-criação**: 5–10
pessoas, uma janela agendada, um jogo criado ao vivo, servidor do dono
exposto por ngrok. Está **adiado desde 2026-07-18 por decisão do dono** — a
web UI não sustentava a dinâmica criativa — e depende do gate UI-5
(`F004`, BLOCKED no backlog).

Esta linha é a outra: **beta de servidor**. O produto sob teste é o serviço
MCP em si, consumido por agentes de terceiros pela porta que já existe. Não
depende de UI-5, não depende de ngrok, não depende de facilitação. Depende
do `roadmap-integrations/`, cujos INT-0 (compliance), INT-1 (connection kit)
e INT-2 (client lib) **já estão implementados**.

Manter as duas linhas juntas foi o que congelou as duas: o beta de servidor
ficou preso atrás de um bloqueio de UI que não tem nada a ver com ele.
Separá-las é a primeira decisão desta pasta (SB1).

O que um beta de servidor exige e um beta de sessão não exigia: o servidor
**não pode ser congelado** (BD6 do beta de sessão congelava o servidor
durante a janela — funciona para 3 horas, não para semanas), e o
comportamento sob uso prolongado e sob erro do cliente passa a importar mais
que a demo feliz.

## Documentos

| # | Arquivo | Função | Status |
|---|---|---|---|
| 0 | `00-scope-sb-0-hardening-servidor.md` | Campanha de teste-e-correção de toda a superfície do servidor. **Primeiro.** | em execução |

Escopos previstos (a escrever, ordem provável):

| # | Tema | Por que |
|---|---|---|
| 1 | **D10 — tokens persistentes** | Hoje tokens são em memória: restart derruba TODO cliente conectado. Único item da Fase 4 que um beta de servidor exige de verdade (lock otimista e rebase não). |
| 2 | **Validação do Claude Code** | A matriz de `roadmap-integrations/compliance-matrix.md` tem 2 de 4 linhas `pending-manual`, e uma delas é o Claude Code CLI — a integração de referência por decisão ID4. Ninguém provou que o cliente principal conecta. |
| 3 | **Retomada de F009 (e F008)** | `redactFile` deny-by-default terminou FAILED em 2026-07-21 com resíduo de *disclosure de ancestralidade de path*. Um servidor que lê o repo do usuário não leva isso para um beta sem decisão explícita. |
| 4 | **Empacotamento + runbook** | Como um estranho sobe o servidor e conecta sem o monorepo. Parte já existe (`release.yml`, BT-1). |

## Decisões (SB)

- **SB1 — Beta de servidor é linha separada do beta de sessão.** Esta pasta
  não substitui `roadmap-beta-test/`, que continua adiado e válido nos seus
  próprios termos. O acoplamento entre os dois (via BD5, "web UI é o cliente
  garantido") não se aplica aqui: o cliente garantido de um beta de servidor
  é qualquer cliente MCP. *Reabre se:* o dono decidir que só existe um beta e
  ele é o da sessão.
- **SB2 — Posse exclusiva de arquivo é o que torna N agents paralelos
  seguro.** Cada workstream é dono de um conjunto disjunto de arquivos-fonte;
  arquivos-hub ficam congelados e só o integrador os toca, serialmente.
  Provado na prática em 2026-08-06 com 3 agents concorrentes sem colisão.
  *Reabre se:* a campanha passar a exigir refactor transversal — aí é
  trabalho serial, não paralelo.
- **SB3 — Achado tem três tiers, e a classificação é mecânica.** Tier 1
  corrige na hora; Tier 2 vira teste `test.todo` + relatório; Tier 3 para e
  escala. Sem isso, cada agent re-litiga sozinho o que é "seguro corrigir" e
  o resultado diverge. Detalhe no escopo SB-0.
- **SB4 — `main` nunca fica vermelha.** Teste vermelho não é entregável. O
  CI é o gate do beta; uma suíte vermelha destrói o sinal para todo mundo,
  inclusive para os outros streams rodando ao mesmo tempo. Um defeito
  conhecido e não corrigido vira `test.todo` nomeado, nunca um `fail`.
- **SB5 — `packages/client` entra no escopo apenas para a correção
  coordenada do `graph.subscribe`.** O client não é a web — é a lib que o
  stdio-proxy e os plugins usam — mas mexer nele afeta a web indiretamente.
  Autorizado só para tornar o `token` opcional-mas-validado no subscribe,
  sem breaking change. *Reabre se:* surgir outro furo que só feche com
  mudança coordenada.
- **SB6 — O servidor não congela durante um beta de servidor.** Ao
  contrário do BD6 do beta de sessão. Isso promove restart-resiliência de
  "bom ter" a requisito, e é o que torna D10 (tokens persistentes) o
  primeiro escopo depois deste.

## Sequência de execução

```
SB-0 (hardening: testar tudo + corrigir)  ← trava os demais
        │
        ▼
SB-1 (D10 tokens persistentes) ──► SB-2 (validar Claude Code)
        │                                   │
        └──────────► SB-3 (F009) ───────────┤
                                            ▼
                                   SB-4 (empacotamento + runbook)
                                            ▼
                                     BETA DE SERVIDOR
```

SB-0 primeiro porque não se estabiliza o que não se mede: hoje há tools
declaradas com zero teste e recursos que só rodam se existir um repo externo
na máquina de quem roda o CI.

## Riscos transversais

1. **Postura D2 na rede.** CORS `*`, sem auth de transporte, token em
   argumento de tool. Aceitável em localhost/VPN/tailnet; inadequado em
   internet pública — e um beta de servidor é exatamente quando isso deixa
   de ser hipotético. Mitigação: SB-4 documenta o deployment suportado;
   exposição pública continua sendo tema do hosted (`roadmap-mcp 05'`).
2. **Tokens em memória (pré-D10).** Restart derruba todos os clientes.
   Verificado ao vivo em 2026-08-06. É o bloqueador de produto mais duro e
   é SB-1 por isso.
3. **F008/F009 saíram do radar sem resolução.** O loop autônomo declarou
   HALT em 2026-07-21 com "5 COMPLETED, 2 BLOCKED, 2 FAILED — no executable
   features remain", porque ambos bateram `maxReworks`. O processo
   funcionou como especificado; o efeito prático é que dois achados de
   segurança ficaram sem dono. SB-3 existe para forçar a decisão explícita:
   retomar ou aceitar formalmente o residual.
4. **Escala não testada.** F005 (paginação de claims/history) está BLOCKED;
   `claimsOfSnapshot` carrega o tenant inteiro. Para grafos de beta é
   tolerável, mas degrada conforme claims acumulam ao longo do beta.
   Fora do escopo de SB-0; entra se um teste esbarrar.
5. **Nenhum cliente de referência validado de ponta a ponta.** Só curl e o
   SDK TS foram executados contra o `/mcp`. SB-2 fecha.
