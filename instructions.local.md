# OpenGraph MCP — instruções locais para agentes LLM

Use este arquivo como runbook quando a sessão do agente estiver aberta no
**repositório-alvo**, não no checkout do `open-graph-mcp`.

## 1. CONTEXTO E VARIÁVEIS

Resolva estes valores antes de agir:

| Nome | Como obter |
|---|---|
| `OPEN_GRAPH_MCP_ROOT` | Diretório que contém este arquivo |
| `TARGET_REPO` | Diretório de trabalho atual da sessão; use caminho absoluto |
| `SERVER_URL` | `http://localhost:8787`, salvo indicação humana diferente |
| `USER_NAME` | Nome humano usado em presença e auditoria; pergunte se não foi informado |
| `TENANT_ID` | Use `default` no setup local inicial; não invente ou troque tenants silenciosamente |

REQUIRED: trate `OPEN_GRAPH_MCP_ROOT` e `TARGET_REPO` como diretórios diferentes.
REQUIRED: mantenha o grafo e o banco no servidor; nunca crie `.graph-server` dentro do repo-alvo.
PROHIBITED: use `GRAPH_REPO_PATH`. O servidor não lê mais essa variável.

## 2. SETUP DO SERVIDOR

Antes de configurar o MCP, confirme que Bun `1.3.14` está disponível. Se as
dependências ainda não estiverem instaladas, execute no checkout do OpenGraph:

```powershell
# CORRECT: dependências pertencem ao checkout do open-graph-mcp.
Set-Location $OPEN_GRAPH_MCP_ROOT
bun install --frozen-lockfile
```

Inicie o servidor em um terminal separado e mantenha-o ativo durante a sessão:

```powershell
# CORRECT: o servidor sobe vazio ou hidrata tenants persistidos em STATE_DIR.
Set-Location $OPEN_GRAPH_MCP_ROOT
bun run dev
```

O default é `http://127.0.0.1:8787` e `STATE_DIR=.graph-server`, relativo a
`OPEN_GRAPH_MCP_ROOT`. Se a porta já responder, reutilize o servidor; não inicie
uma segunda instância na mesma porta.

`DOMAINS` é opcional e só deve ser definido antes do primeiro bootstrap quando o
humano fornecer as regras. Sem ele, os nós entram em `(unassigned)`. Um pattern
como `src/*` cobre o prefixo inteiro; `src/**` está errado porque não há glob.

## 3. SETUP DO MCP NO REPOSITÓRIO-ALVO

Escolha **exatamente um** dos caminhos abaixo. Não configure simultaneamente a
entrada MCP manual e o plugin com o mesmo nome.

Execute o comando abaixo a partir de `TARGET_REPO`. Use escopo `local` para não
versionar configuração específica da máquina no repositório-alvo:

```powershell
# CORRECT: substitua as quatro variáveis pelos valores resolvidos na seção 1.
Set-Location $TARGET_REPO
claude mcp add --scope local open-graph -- bun "$OPEN_GRAPH_MCP_ROOT/packages/stdio-proxy/src/cli.ts" --server $SERVER_URL --name $USER_NAME --tenant $TENANT_ID --live --agent-kind claude-code
```

Depois de adicionar o MCP, reinicie ou recarregue a sessão do Claude Code e
confirme em `/mcp` que `open-graph` está conectado. O proxy registra a identidade,
persiste a credencial em `~/.open-graph-mcp/credentials.json` e injeta o token nas
tools autenticadas. Nunca peça, imprima ou grave esse token no repo-alvo.

ALTERNATIVE: para carregar também os hooks, comandos e skill do plugin, encerre a
sessão e inicie o Claude a partir de `TARGET_REPO` com:

```powershell
# CORRECT: o plugin local usa o stdio-proxy vizinho no monorepo.
claude --plugin-dir "$OPEN_GRAPH_MCP_ROOT/packages/claude-plugin"
```

O plugin local usa o tenant `default`. Para outro tenant, use a configuração MCP
explícita acima e confirme a troca com o humano. A credencial local atual é
cacheada por servidor; não apague ou substitua o arquivo de credenciais sem
autorização.

## 4. BOOTSTRAP INICIAL DO TENANT

Execute esta verificação imediatamente após conectar, antes de analisar ou editar
código:

1. Chame `graph.query` com termos reais do repo-alvo, como o nome do projeto e de
   um módulo conhecido.
2. Se a resposta for `not bootstrapped`, chame `graph.bootstrap` uma única vez com
   `repoPath` igual ao caminho absoluto de `TARGET_REPO`.
3. Repita `graph.query` e confirme que o grafo responde.
4. Se o bootstrap falhar, pare e reporte o erro; não continue como se o grafo
   estivesse disponível.

```text
# CORRECT: somente "not bootstrapped" indica ausência de grafo no tenant.
graph.query -> not bootstrapped
graph.bootstrap({ repoPath: TARGET_REPO_ABSOLUTO })
graph.query -> { candidates, gaps }

# WRONG: zero candidatos ou gaps não autorizam reindexar outro repo no tenant.
graph.query -> { candidates: [], gaps: [...] }
graph.bootstrap({ repoPath: OUTRO_REPO })
```

REQUIRED: use caminho absoluto no primeiro `graph.bootstrap`.
REQUIRED: associe um tenant a um único repo-alvo estável.
PROHIBITED: rode bootstrap novamente apenas porque uma consulta retornou `gaps`.
PROHIBITED: reutilize um tenant já configurado para outro repositório sem decisão
humana explícita; isso substitui o grafo indexado daquele tenant.

## 5. WORKFLOW OBRIGATÓRIO DE TRABALHO

### Antes de editar

1. Chame `graph.query` com termos específicos da tarefa.
2. Leia os candidatos relevantes e trate `gaps` como ausência de conhecimento,
   não como permissão para inventar uma decisão arquitetural.
3. Para arquivos conhecidos, chame `graph.impact` com o id relativo POSIX do nó e
   avalie dependentes, dependências, autoridade e locks.
4. Chame `presence.who`, preferencialmente filtrando pela célula afetada.
5. Derive a célula dos candidatos (`domain:layer`, por exemplo `auth:P4`).
6. Antes da primeira edição, chame `changeset.open` com todas as células conhecidas
   e uma intenção curta. Guarde o `csId` retornado.

REQUIRED: não edite se `changeset.open` retornar `cell_locked`. Informe holder e
expiração; espere, negocie ou trabalhe em outra célula. Nunca faça retry em loop.
REQUIRED: se a tarefa crescer para outra célula, chame `changeset.open` novamente
com o conjunto completo de células antes de editar essa área. Use
`changeset.extend` somente para renovar o TTL, não para ampliar o escopo.

### Durante a alteração

- Mantenha o trabalho dentro das células bloqueadas pelo changeset.
- Use `changeset.extend` se o turno estiver próximo de expirar.
- Use `changeset.claim` somente para registrar uma claim/delta semântico válido;
  não fabrique claims apenas para justificar uma edição de código.
- Em `claim.add`, use `refs` apenas para ids de outras claims adjacentes na escada
  e use `covers` para ids de nós cobertos.
- Consulte novamente `graph.query` quando surgir um conceito ou módulo fora do
  contexto inicialmente carregado.

### Ao finalizar

1. Execute os testes e gates proporcionais à alteração no repo-alvo.
2. Chame `changeset.commit` com `csId` e uma `intent` final não vazia.
3. Se o gate recusar, reporte todas as razões; não esconda nem contorne a recusa.
4. Se abandonar, falhar ou mudar de plano, chame `changeset.abort` para liberar os
   locks.
5. Antes de encerrar uma sessão interrompida, use `changeset.list_mine` e feche ou
   recupere qualquer turno aberto.

## 6. LIMITES DE AUTORIDADE

PROHIBITED: chame `authority.flip` por iniciativa própria. Essa operação exige uma
ordem humana explícita contendo a célula e o destino (`source` ou `graph`).
PROHIBITED: altere o código do `open-graph-mcp` quando a tarefa pertence ao
repo-alvo, salvo solicitação humana explícita.
PROHIBITED: considere o grafo substituto da leitura do código. Use grafo e fonte
como evidências complementares e reconcilie divergências.
REQUIRED: quando MCP ou servidor estiver indisponível, reporte a degradação antes
de editar; não alegue ter seguido o workflow sem chamadas observáveis.

## 7. CHECKLIST DE SESSÃO

```text
[ ] TARGET_REPO e OPEN_GRAPH_MCP_ROOT são distintos e absolutos
[ ] servidor responde em SERVER_URL
[ ] /mcp mostra open-graph conectado
[ ] tenant confirmado; bootstrap executado somente se retornou "not bootstrapped"
[ ] graph.query executado antes da implementação
[ ] impacto, presença e células verificados
[ ] changeset aberto antes da primeira edição
[ ] testes executados
[ ] changeset commitado ou abortado; nenhum lock abandonado
```
