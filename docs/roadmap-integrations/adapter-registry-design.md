# Design — Registry de flavors de agente (padrão adapter aplicado ao INT)

> Data: 2026-08-06. Status: **proposta de design — sem código.**
> Índice-pai: `README.md`. Companheiro de `02-pesquisa-runtime-adapters.md`.
>
> Origem: replicar no open-graph-mcp o padrão de adapter do open-design
> (Apache-2.0, commit `517f39a`) — **o padrão de design, reimplementado do
> zero**, não código copiado (ver §8 e a pesquisa §8.6.1).

---

## 0. Qual metade do open-design está sendo replicada

O open-design tem duas direções de integração com agentes. A pesquisa
congelada mapeou as duas e recomendou (§10) **não portar a primeira**:

| Direção | O que é | Veredito aqui |
|---|---|---|
| **OD dirige o agente** | daemon spawna o CLI como filho, parseia stdout, 26 `RuntimeAgentDef` | ❌ **fora** — mantido o veredito da pesquisa §8.1/§10: inverteria o papel do produto e adicionaria superfície de execução de binário arbitrário a um servidor que hoje só serve grafo |
| **O agente dirige OD** | OD é MCP server; `od mcp install <agent>` escreve na config de cada agente; plugin nativo por flavor | ✅ **esta proposta** — é *exatamente* o problema do INT-1/3/4/5/6, e é onde o padrão paga |

Ou seja: não é uma capacidade nova. É **arrumar o que o roadmap-integrations
já decidiu fazer à mão** com a estrutura que o open-design já provou em 25
CLIs.

---

## 1. O problema real (hoje, não hipotético)

O conhecimento "como o agente X se conecta ao open-graph-mcp" hoje está
espalhado por, no mínimo, sete lugares que precisam concordar entre si:

1. `README.md` do roadmap — decisão **ID5**, enum `agentKind` (`web`,
   `claude-code`, `opencode`, `cursor`, `windsurf`, `copilot`, `zed`,
   `gemini-cli`, `unknown`).
2. `quickstart.md` — um bloco de snippet por cliente, cada um com data de
   verificação (INT-1 DoD).
3. `01-scope-int-1-connection-kit.md` — a lista de clientes e os formatos
   de config.
4. `05-scope-int-5-editor-agents.md` — `capability-matrix.md` (a preencher),
   com linhas por cliente e colunas transport/tools/resources/push/rules.
5. `05-…` de novo — `rules-base.md` + um wrapper de formato por cliente
   (`.cursor/rules/open-graph.mdc`, `.github/copilot-instructions.md`,
   `GEMINI.md`, `AGENTS.md`…).
6. Flags do `packages/stdio-proxy` — `--agent-kind cursor`, `--live`.
7. `packages/claude-plugin/` — o flavor de referência (ID4).

Isso é o mesmo material, projetado sete vezes, em quatro formatos
diferentes, mantido por disciplina humana. O **risco transversal #4** do
próprio README já nomeia a consequência:

> "Conhecimento de config dos clientes desatualiza (formatos de mcp.json
> etc. mudam) — cada recipe do INT-5 carrega data de verificação; CI não
> cobre (manual por release)."

O padrão do open-design é a resposta direta a esse risco: **transformar o
conhecimento por-cliente em dado, e derivar as sete projeções dele.**

---

## 2. O achado portável, em uma frase

Do `docs/agent-adapters.md:15` do open-design:

> Um adapter **não** é uma classe que implementa o loop. É um **objeto de
> dados puro** — um literal por CLI — que *declara* como falar com aquele
> CLI. Um motor genérico lê esses campos e faz detecção, lançamento e
> parsing para todos uniformemente. Não há subclasse por agente e não há
> `run()` para implementar.

Consequência prática lá: adicionar um CLI é **um arquivo**. 26 defs, ~2.6k
linhas totais, ~100 linhas por agente — e nenhuma edição no motor, salvo
formato de wire genuinamente novo.

O análogo aqui: **um `AgentFlavorDef` por agente**, e as sete projeções da
§1 passam a ser *saída derivada*, não fonte.

---

## 3. O registry proposto

### 3.1 Forma (esboço ilustrativo — documentação, não implementação)

```ts
type AgentFlavorDef = {
  // Identidade — ID5 deixa de ser um enum solto e passa a ser
  // a chave primária do registry.
  agentKind: 'claude-code' | 'opencode' | 'cursor' | 'windsurf'
           | 'copilot' | 'zed' | 'gemini-cli';
  name: string;                    // rótulo humano ("Claude Code")
  docsUrl: string;

  // Detecção — "este agente existe nesta máquina?"
  bin?: string;                    // executável a procurar no PATH
  fallbackBins?: string[];
  versionArgs?: string[];          // ex. ['--version']

  // Como o open-graph-mcp entra na config DELE.
  // A tricotomia é literalmente a do open-design
  // (mcp-agent-install.ts): cli | json | manual.
  install:
    | { kind: 'cli';    command: string[] }        // ex. claude mcp add --transport http …
    | { kind: 'json';   configPath: string; shape: 'mcpServers' | 'contextServers' }
    | { kind: 'manual'; format: 'json'|'yaml'|'toml'; configPath: string|null };

  // Transport que o cliente aceita de fato.
  transport: 'http' | 'stdio-proxy';   // stdio-proxy ⇒ ID6 (server é HTTP-only)

  // Camada viva (ID2: NUNCA é requisito).
  liveTier: 'plugin'    // push nativo na conversa (claude-code, opencode)
          | 'polling'   // proxy --live cobre presença/beat; sem notificação
          | 'none';

  // Onde o rules-base canônico é materializado neste flavor.
  rules?: { path: string; format: 'mdc'|'md'|'agents-md' };

  // Honestidade como dado, não como prosa.
  verifiedAt: string | null;       // ISO date; null = documentado, não verificado
  verifiedVersion: string | null;
};
```

Todo campo é **dado** ou um caminho — nenhum comportamento. Exatamente o
critério do open-design ("every field is data or a pure arg-builder").

### 3.2 O que o motor genérico deriva

Uma vez que o registry existe, cada item da §1 vira um consumidor:

| Consumidor | Hoje | Com registry |
|---|---|---|
| `capability-matrix.md` (INT-5 DoD) | tabela escrita à mão | **gerada** do registry; drift impossível |
| `quickstart.md` blocos por cliente | 7 blocos de prosa | **gerados** de `install` + `transport` |
| `og mcp install <agent>` | não existe | motor genérico lendo `install.kind` (análogo do `od mcp install`) |
| `og doctor` | não existe | PATH-scan sobre `bin`/`fallbackBins` → "quais agentes existem aqui" |
| flags do stdio-proxy | `--agent-kind` string livre | validado contra as chaves do registry |
| enum `agentKind` do server (ID5) | enum duplicado no server | **derivado** — uma fonte |
| rules por flavor | 5 arquivos escritos à mão | `rules-base.md` + wrapper por `rules.format` |
| CI de frescor | inexistente (risco #4) | falha quando `verifiedAt` passa de N meses |

O ganho não é economia de linhas. É que **as sete projeções não podem mais
discordar entre si**, porque só existe uma fonte.

---

## 4. As três técnicas específicas que valem trazer junto

Além da forma do registry, três detalhes do open-design são diretamente
aplicáveis e resolvem problemas nomeados no roadmap:

### 4.1 Detecção resiliente por agente

`safeProbe()` (`detection.ts:350-366`) isola falha por agente — uma exceção
num probe não derruba a lista inteira. O comentário no código cita a issue
#2297: `/api/agents` devolvia `[]` antes desse guard.

Aplicação aqui: um `og doctor` que lista "Claude Code ✓ 2.1.0 / opencode ✗
não instalado / Cursor ✓" precisa da mesma disciplina — um agente quebrado
não pode esconder os outros. É uma regra de 5 linhas que só se aprende
depois do bug.

### 4.2 PATH-scan que sobrevive a launcher de GUI

`packages/platform/src/toolchain.ts` do open-design é a fonte única de
"onde CLIs realmente moram quando o processo herda um PATH mínimo": prefixos
npm/pnpm/bun/cargo/deno/go, shims asdf/volta/mise/nvm/fnm, raízes por versão
do Node, `%APPDATA%\npm` e scoop shims no Windows, `installation/` do fnm.

Relevância aqui é **condicional**: o open-graph-mcp roda hoje como processo
de terminal (`bun run dev`), que herda o PATH do shell — o problema não
existe. Ele passa a existir se algum dia houver invocação a partir de app
com GUI ou de serviço. Registrar agora, implementar só se o caso aparecer.

### 4.3 Harness de replay por PATH-overlay

`mocks/` do open-design: `export PATH="$PWD/mocks/bin:$PATH"` e `claude` /
`opencode` / `codex` viram binários falsos que reproduzem traces gravados no
protocolo nativo de cada um. **Zero tokens de LLM** para e2e e regressão.

Aplicação aqui é a mais valiosa das três, porque ataca o DoD mais frágil do
INT-1 ("cada snippet TESTADO de verdade em pelo menos Claude Code + mais um;
os demais marcados documentado-não-verificado"). Um harness análogo —
fixtures dos arquivos de config reais de cada cliente (`.cursor/mcp.json`,
`mcp_config.json`, `settings.json`, `~/.config/opencode/opencode.json`) num
diretório temporário, e o writer de `install` rodando contra eles — permite
**testar os 7 writers em CI sem ter os 7 agentes instalados**. Não substitui
verificação real (§7), mas garante que a *escrita* não corrompe config
alheia — que é o modo de falha caro.

---

## 5. Alinhamento com as decisões já tomadas

A proposta não reabre nenhuma decisão do README; ela dá corpo a elas.

- **ID1** (token em argumento) — ortogonal, intocado.
- **ID2** (camada viva nunca é requisito) — vira **verificável**:
  `liveTier: 'none' | 'polling'` obriga cada flavor a declarar seu fallback,
  em vez de a garantia viver só na prosa.
- **ID3** (uma lib, N plugins) — ganha o irmão exato: **um registry, N
  recipes**. Mesma lógica, aplicada à camada de conexão em vez da camada
  viva. É a decisão que mais sustenta esta proposta.
- **ID4** (Claude Code é referência; editores recebem recipe, não plugin) —
  preservado e agora *expresso em dado*: `liveTier: 'plugin'` para
  claude-code/opencode, `'polling'` para os cinco editores. A política de
  investimento vira um campo, não uma convenção lembrada.
- **ID5** (agentKind é contrato) — passa a ter uma implementação única em
  vez de um enum replicado entre server, proxy e docs.
- **ID6** (stdio via proxy, não segundo transport) — vira o campo
  `transport`, e o registry passa a ser o lugar que documenta *por que* cada
  cliente cai num lado.

E ataca diretamente o **risco #4** (conhecimento de config desatualiza),
que hoje não tem mitigação além de disciplina manual.

---

## 6. Onde encaixa no roadmap

```
INT-0 ──► INT-1 (feito) ──► INT-2 (feito) ──► INT-3 (Claude Code, proposto)
                                                     │
                          ┌──────────────────────────┤
                          ▼                          ▼
                  [ registry ]  ─────────────►  INT-4 / INT-5 / INT-6
```

**Momento certo: depois do INT-3, antes do INT-4/5.** A razão é a mesma que
o open-design usa para não generalizar cedo — o registry deve ser *extraído*
do flavor de referência já construído, não desenhado no vácuo. O INT-3
(Claude Code: MCP + skill + hooks + statusline) é quem revela quais campos
são realmente por-flavor e quais são universais. Fazer o registry antes do
INT-3 é adivinhar; fazer depois do INT-5 é reescrever 5 recipes.

Impacto nas estimativas do README:

| Fase | Estimativa atual | Com registry antes |
|---|---|---|
| Registry (extração pós-INT-3) | — | +3-5 dias |
| INT-4 (opencode) | 1 semana | ~igual (é `liveTier: 'plugin'`, o trabalho é o plugin) |
| INT-5 (5 editores) | 3-5 dias | **menor** — 5 registros + geração, não 5 recipes à mão |
| INT-6 (distribuição) | 3-5 dias | **menor** — `og mcp install` sai do motor genérico |

Custo líquido perto de zero; o que muda é *onde* o esforço fica — em
estrutura reusável, não em prosa que apodrece.

---

## 7. Não-escopo (explícito)

- ❌ **Spawn de agente.** Mantido o veredito da pesquisa §8.1/§10. O
  `mcp-server` continua sem `child_process`/`Bun.spawn`. Um `og doctor` que
  roda `<bin> --version` é probe de detecção, **não** é executar um agente —
  se essa distinção ficar borrada, o não-escopo foi violado.
- ❌ **Parsers de stream** (`json-event-stream.ts`, `claude-stream.ts`).
  São os componentes mais caros do open-design e só existem para quem
  spawna. Irrelevantes aqui.
- ❌ **Resume de sessão / ACP.** Dependem de um modelo de conversa
  persistida por turno que este produto não tem — ele é stateless por
  request MCP, com estado no grafo.
- ❌ **`externalMcpInjection`.** Conceitualmente invertido: lá o daemon
  configura um CLI para falar com um MCP server; aqui *nós somos* o MCP
  server.
- ❌ **Registry não verifica nada.** Uma linha `verifiedAt: null` continua
  significando "documentado, não verificado". O registry torna a
  desatualização **visível e checável em CI** — não a elimina. Honestidade
  > cobertura continua valendo (INT-1 DoD).

---

## 8. Riscos e licença

1. **Licença.** open-design é Apache-2.0; este repo declara MIT
   (`packages/mcp-server/package.json`). Apache-2.0 é compatível com reuso
   em projeto permissivo **desde que se preserve aviso de copyright e se
   inclua o texto da licença para o código derivado**. Esta proposta é
   deliberadamente *padrão de design reimplementado do zero* — que evita a
   questão. Se em algum momento um trecho literal for copiado, exige
   atribuição explícita (pesquisa §8.6.1).
2. **Generalização prematura.** Um registry desenhado antes de existir um
   segundo flavor real é especulação. Mitigação: §6 — extrair pós-INT-3.
3. **Geração de docs é um mecanismo a manter.** Gerar `capability-matrix.md`
   e `quickstart.md` do registry adiciona um passo de build. Se ninguém
   rodar, os docs congelam sem que se perceba. Mitigação: gerar em CI e
   falhar se o resultado divergir do commitado (o padrão "check-in
   generated, verify in CI").
4. **Acoplamento a formato de terceiro continua.** O registry não impede que
   a Cursor mude `.cursor/mcp.json`. Ele só garante que a mudança seja feita
   em **um** lugar em vez de sete. O trabalho de acompanhar upstream é
   permanente — o open-design é evidência disso: seus defs são cheios de
   comentários citando issues por versão de CLI.

---

## 9. Recomendação

**Adotar o padrão, na direção da conexão, extraído após o INT-3.**

O valor não está em imitar o open-design — está em que o open-graph-mcp já
decidiu suportar 7+ flavors de agente (ID5) e já nomeou o custo disso como
risco transversal #4. O open-design é a prova, em 25 CLIs, de que
conhecimento por-agente tratado como *dado declarativo* escala e que tratado
como *código/prosa por agente* não escala. A parte cara do open-design (os
parsers de stream) é justamente a que não se aplica aqui — o que sobra é a
parte barata e a de maior rendimento.

Próximo passo concreto, quando o INT-3 fechar: listar os campos que o plugin
Claude Code de fato precisou, e checar quantos são por-flavor. Se forem
menos de três, o registry não se justifica ainda e esta proposta espera o
INT-4.
