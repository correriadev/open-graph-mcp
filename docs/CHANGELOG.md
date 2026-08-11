# CHANGELOG — base histórica do OpenGraph

**Consolidado em 2026-08-11.** Este arquivo substitui ~140 documentos que foram apagados de `docs/` no mesmo commit.

> **O que este arquivo é.** Registro de contexto: o que foi planejado, o que foi construído, o que foi decidido e o que falhou entre o início do projeto e a reestruturação da Arquitetura Cognitiva. Existe para que alguém que abra o repositório daqui a seis meses entenda *como se chegou até aqui* sem precisar dos documentos originais.
>
> **O que este arquivo não é.** Não é fonte normativa e não é preciso ao nível de citação. Datas, números e nomes de arquivo foram preservados onde estavam à mão, mas **a acurácia não é o propósito deste documento** — foi declarado explicitamente como não-objetivo na consolidação. Onde este texto divergir do código, o código vence. Onde divergir do roadmap vigente, o roadmap vigente vence.
>
> **Onde está a verdade agora.** `docs/BREAKINGCHANGE/` — `OpenGraph_Working_Paper_v1_0.md` (fonte normativa), `PRD.md` (89 requisitos), `ADR.md` (21 registros). Nessa ordem de autoridade.
>
> **Recuperação.** Nada aqui se perdeu de verdade: os 159 arquivos apagados estão rastreados em git e recuperáveis pelo histórico (`git log --diff-filter=D -- docs/`). Este arquivo existe para tornar essa consulta desnecessária, não impossível.

---

## 1. A forma do projeto que terminou aqui

O open-graph-mcp nasceu como linha de produto paralela a um fork do open-graph: **um serviço MCP** que serve de base de conhecimento centralizada, multi-usuário, rastreada em tempo real. O substrato conceitual veio inteiro do open-graph e era tratado como não-negociável em todos os roadmaps:

1. Núcleo determinístico, LLM na borda.
2. Porta única — o gate.
3. Verdade no grafo.
4. Autoridade ganha, não herdada.
5. Escada bidirecional.
6. Humano nos pontos irreversíveis.

Esses seis princípios atravessaram todos os planos abaixo sem nunca serem revisados. São eles que o Working Paper v1.0 reformula — não substitui.

O trabalho se organizou em **seis roadmaps paralelos**, cada um com seu índice, suas decisões numeradas e sua sequência de execução própria. Essa multiplicidade é ela mesma parte do contexto histórico: seis futuros planejados em paralelo, com dependências cruzadas entre si, é o que a BREAKINGCHANGE colapsa em um.

---

## 2. `roadmap-mcp/` — o produto

Cinco fases, do MCP read-only à federação. Decisões `D1`–`D13`:

- **D1** Server-only, sem `.graph/` local no cliente. **D2** Single-org com auditoria. **D3** Single-node SQLite. **D4** Lock híbrido (β pessimista / α otimista). **D5** Cliente web apartado. *(D1–D5 validadas pelo dono.)*
- **D6** Watch herdado sem refino na Fase 1. **D7** Watch opcional desde a Fase 2, via `WATCH_REPO_PATH` + `watch-bridge → appendEvent`. **D8** Múltiplos observers numa cell sem lock. **D9** Rebase explícito com atalho "Rebase & Commit".
- **D10** Tokens de 90 dias + renew por CLI admin — escopo da Fase 4. **Nunca implementado**: tokens permaneceram em memória até o fim, e restart derrubava todo cliente conectado. Foi o bloqueador de produto mais duro do projeto, citado como risco em três roadmaps diferentes.
- **D11** Corrida watch-vs-changeset resolvida por ordenação de `seq` global — quem admite primeiro ganha, o segundo rebasa. Explicitamente *não* "watch ganha sempre".
- **D13** Multi-tenant desde a Fase 2 — decidida pelo dono em 2026-07-12 **contra a recomendação da análise**. `tenant_id` em todas as tabelas, toda query escopada, JSONL espelhado por tenant, `seq` monotônico por tenant.

Pesquisas pré-código resolvidas em 2026-07-12: o SDK `@modelcontextprotocol/sdk` 1.29.0 já era dependência e suportava Streamable HTTP; e a extração de `graph-core` foi julgada desnecessária porque o pacote `opencode` já expunha `"./*": "./src/*.ts"`. *(Essa segunda conclusão foi depois revertida na prática — `graph-core` virou pacote próprio.)* Ficou aberto: transações `bun:sqlite` em workers/fibers.

Estimativa registrada: ~16–22 semanas até MVP multiplayer alpha. Fases 1–3 chegaram a verde; a Fase 4 nunca começou.

**Havia um `roadmap-mcp/ADR.md`** — o ADR original do projeto, com as decisões arquiteturais e a tese de produto. É superseded na íntegra por `docs/BREAKINGCHANGE/ADR.md`, que passa a ser o único documento com esse nome no repositório.

## 3. `roadmap-qa/` — qualidade

Sete fases (`QA-0`..`QA-6`), das quais seis foram implementadas. Baseline de partida: 86 testes verdes, **zero browser, zero CI, zero graph-core direto**.

Decisões `QD`: load test nunca bloqueia CI (`QD1`); flake de timing se resolve alargando janelas configuráveis, **nunca com retry automático silencioso** (`QD2`); Playwright é a única dependência de teste nova do roadmap inteiro (`QD3`); e2e roda contra build real via `vite preview`, não dev server (`QD4`); e2e usa os mesmos knobs determinísticos dos testes de integração — nunca `sleep` calibrado no relógio de produção (`QD5`).

O achado que justificou o roadmap inteiro veio do **QA-5 (soak de 10 min)**: `readClaims` fazia full-scan por tenant, e o p95 subiu ≈9× (15.9ms → 145.8ms) sob carga sustentada. Corrigido no mesmo dia com cache em memória por tenant e revalidado em 23.6ms → 26.3ms. É o exemplo canônico do projeto de teste que encontra defeito real em vez de confirmar o já sabido.

O **QA-6** inventariou 8 testes de ataque nomeados — quatro a mais do que o previsto, incluindo dois de `authority-flip` e um de DNS-rebinding em `protocol-compliance`.

Anti-escopo declarado e mantido: cobertura % como métrica, sprint retroativo de unit tests, mutation testing, fuzzing, visual regression, multi-browser, mobile.

Débito que sobreviveu: `tsc --noEmit` no mcp-server tinha baseline sujo pré-existente e nunca ganhou dono; branch protection em `main` ficou bloqueada por falta de acesso `gh`, não por trabalho pendente.

## 4. `roadmap-web-ui/` — a reescrita da UI

Recriação da web UI do zero sobre React Flow. A tese: a UI existente era "um espectador com botão de commit" — sem busca (`graph.query` sequer existia no `api.ts`), sem leitura de claims committados, form de delta hardcoded. Numa sessão de co-criação isso mata a dinâmica: escreve-se, não se lê.

A análise de mercado (Miro, Mural, FigJam, Lucid, Excalidraw) descartou plataformas com engine colaborativa própria por um motivo que continua valendo na v1.0: **o servidor já é a única verdade**, e qualquer CRDT de terceiro brigaria com o modelo de turnos.

Decisões `WD`: rebuild in-place em `packages/mcp-web`, com o `src/` velho morrendo no mesmo commit que traz ≥1 spec e2e novo — porque Playwright não falha com zero specs, e e2e vazio é gate sem dente (`WD1`); stack React 18 + `@xyflow/react` 12 + zustand + react-markdown, sem UI kit (`WD2`); `@open-graph-mcp/client` reusado integralmente e `api.ts` morto (`WD3`); servidor permanece autoritativo e layout é apresentação — o servidor **não** ganha conceito de x/y (`WD4`); beta adiado, com UI-5 como gate de retomada (`WD5`).

Risco principal registrado: React Flow renderiza um elemento DOM por nó, e o requisito documentado em `layout.ts` era "milhares de nós, custo O(visível)". Mitigação: spike de escala como trava, não como fase.

`UI-0` a `UI-4` foram entregues. `UI-5` nunca fechou.

## 5. `roadmap-integrations/` — conexão de agentes

Como agentes de código de terceiros (Claude Code, opencode, Cursor, Windsurf, Copilot, Zed, Gemini CLI) se conectam ao serviço.

A observação estrutural que organizou tudo: o servidor expõe **duas camadas de natureza diferente**. A camada MCP (tools, JSON-RPC) dá ~80% do produto a qualquer cliente genérico. A camada viva (SSE `/events`, heartbeat 15s, sessionId capability) é proprietária, e um cliente vanilla não vê nada dela — sem beat, a presença dele expira em 60s; sem SSE, ele nunca sabe que o próprio changeset foi abortado por TTL.

Consequência estratégica: não se porta o produto para cada agente. Entrega-se o endpoint compliant para todos de graça, mais um plugin fino por flavor onde a plataforma permitir.

Decisões `ID`: token em argumento de tool, não em header, porque todo cliente MCP passa argumento e nem todo passa header custom (`ID1`); **a camada viva nunca vira requisito** — todo fluxo tem fallback por polling, plugin melhora e não habilita (`ID2`); uma lib, N plugins, proibido reimplementar SSE/beat/reattach dentro de plugin (`ID3`); Claude Code é a integração de referência (`ID4`); `agentKind` é contrato, com vocabulário fechado `web · claude-code · opencode · cursor · windsurf · copilot · zed · gemini-cli · unknown` (`ID5`); stdio por proxy, não segundo transport no servidor (`ID6`).

`INT-0` (compliance), `INT-1` (connection kit) e `INT-2` (`@open-graph-mcp/client`) foram implementados e verificados ao vivo. A `compliance-matrix.md` terminou com 2 de 4 linhas `pending-manual` — e uma delas era o Claude Code CLI, justamente a integração de referência. **Ninguém chegou a provar que o cliente principal conecta.**

> ⚠ **Dependência viva.** `packages/mcp-server/src/agent-registry.ts` carrega onze campos `docsUrl` apontando para arquivos desta pasta (`03-scope-int-3-claude-code-plugin.md`, `04-scope-int-4-opencode-plugin.md`, `05-scope-int-5-editor-agents.md`, `README.md`). São dados de runtime servidos ao usuário pelo `doctor`/`install`, não comentários — e ficaram pendentes de redirecionamento após esta consolidação.

## 6. `roadmap-beta-test/` — o beta de sessão *(adiado)*

Uma sessão síncrona de co-criação: 5–10 participantes, uma janela agendada, um jogo simples criado ao vivo, servidor do dono exposto por ngrok. O jogo era pretexto; o produto sob teste era a ferramenta de criação coletiva.

**Adiado em 2026-07-18 por decisão do dono**, com o motivo registrado honestamente: a web UI não sustentava a dinâmica criativa — exatamente a descoberta que a decisão `BD5` previa que só apareceria no dry-run.

Decisões `BD`: ngrok é janela, não deployment — túnel só durante sessões agendadas, URL nova por sessão, nunca publicada em lugar indexável (`BD1`); telemetria 100% server-side, com **nada instalado no participante coletando dados** (`BD2`); um tenant dedicado por sessão, `beta-<yyyymmdd>` (`BD3`); artefato via GitHub Release privado e distribuição manual por Drive (`BD4`); web UI é o cliente garantido, agente MCP é camada opcional (`BD5`); **servidor congela antes do go** — nenhum deploy ou restart durante a janela, porque tokens em memória significam que um restart derruba a sessão inteira (`BD6`).

`BT-1` (o pipeline de release em `.github/workflows/release.yml`) foi implementado e sobreviveu ao adiamento — independe da web UI.

## 7. `roadmap-server-beta/` — o beta de servidor

A separação que destravou o projeto, registrada como `SB1`: **existem duas betas e não são a mesma coisa.** O beta de sessão (acima) precisava de UI, ngrok e facilitação. O beta de servidor precisa apenas que alguém que não é o dono aponte o próprio agente para `/mcp` e use por dias. Mantê-los juntos foi o que congelou os dois — o beta de servidor ficou preso atrás de um bloqueio de UI que não tinha nada a ver com ele.

Outras decisões `SB`: posse exclusiva de arquivo é o que torna N agents paralelos seguro — provado na prática em 2026-08-06 com 3 agents concorrentes sem colisão (`SB2`); achado tem três tiers com classificação mecânica, senão cada agent re-litiga sozinho o que é seguro corrigir (`SB3`); **`main` nunca fica vermelha** — defeito conhecido vira `test.todo` nomeado, nunca um `fail` (`SB4`); o servidor **não** congela durante um beta de servidor, ao contrário do `BD6` (`SB6`).

O `SB-0` (hardening) fechou em 2026-08-07. O `01-evidencias-fluxo-completo.md` documentou o exercício do fluxo completo contra servidor real — escada, autoridade, impacto, drift, concorrência — mais um exercício multiplayer com dois agentes disputando o mesmo servidor, interrompido por um `taskkill` externo. Produziu os achados **F1–F8** e **MP-1–MP-3**, todos fechados, e vários deles ainda são citados como causa-raiz em comentários do código (`cell.ts`, `resources.ts`, `graph-impact.ts`, `claim-store.test.ts`).

### 7.1 Alpha v0 — o fracasso informativo

Executado em 2026-08-08, com prompts congelados antes da execução e **veredito pré-registrado**. O desenho: o dono reverte uma feature real do `harness-kit` e a reconstrói duas vezes — um braço de controle sem o servidor MCP, um braço de tratamento com ele — comparando ambos contra o gabarito do histórico.

| | Controle (sem MCP) | Tratamento (com MCP) |
|---|---|---|
| Suíte final | 54 arq / 426 testes / 0 falhas | 54 arq / 426 testes / 0 falhas |
| Rodadas até passar | 1 | 2 |
| Duração | ~97 s | ~94 s |
| **Chamadas ao MCP** | — | **0** |

Os dois braços reconstruíram a feature na primeira tentativa, e **o braço de tratamento não usou o servidor uma única vez.**

O ponto que importa não é o placar — é a verificação. O agente do tratamento *declarou* não ter usado o MCP; o `server.log` confirmou, com 6 linhas no total, todas do setup do árbitro às 18:44:45 e nenhuma durante a execução. Sem esse log, "não usei" seria uma afirmação sobre a qual não haveria evidência. É a lição que virou invariante no Working Paper: **verificação por log, nunca por autorrelato.**

A lição de desenho: uma feature pequena o bastante para caber inteira na cabeça do agente não gera demanda por substrato epistêmico. O experimento mediu corretamente e mediu a coisa errada.

## 8. `quality/AUDIT-2026-07-20.md` — a auditoria que virou backlog

Auditoria socrática dos commits `cfb24f5` → `393f7fe`. **Score final 0.66**, abaixo do threshold de 0.70, com a nota puxada para baixo por segurança (0.45) e escala (0.55).

Nove pontos abertos, dos quais três críticos: `claimsOfSnapshot` carregando tenant inteiro sem paginação; `presence.typing` sem batching nem rate-limit; e hooks `window.__og_e2e` presentes em produção. A direção recomendada — cursor pagination uniforme (`since=<seq>&limit=<N>`) em todos os recursos `graph://` — virou o desenho de `F005`.

Cinco desses pontos viraram features `F005`–`F009` no backlog autônomo.

## 9. `product/` — o loop autônomo

Três documentos operacionais mais uma config de bootstrap, que juntos registravam um **ciclo de desenvolvimento autônomo** rodando sobre o backlog: `BACKLOG.md` (features com scores TL/Adversarial e contagem de reworks), `DEVELOPMENT-STATE.md` (tasks por feature e fase), `DECISIONS.md` (trilha de auditoria de cada decisão tomada pelo loop) e `BOOTSTRAP-CONFIG.json`.

O ciclo tinha cinco fases — A (specs por software-architect), B (execução por tdd-orchestrator), C (validação por dois revisores independentes com thresholds de 0.70), D (gate de rework, `maxReworks=2`) e E (memória de projeto em `docs/feature/`) — e produziu o pipeline de specs de `docs/specs/`.

Placar final de nove features:

| ID | Feature | Status |
|---|---|---|
| F001 | UI-2 — turn-lifecycle + lock-contention e2e | COMPLETED |
| F002 | UI-3 — leitura/query, claims browser, history | COMPLETED |
| F003 | UI-4 — nós ricos + zoom semântico + minimapa | COMPLETED |
| F004 | UI-5 — paridade e2e + gate de retomada do beta | **BLOCKED** |
| F005 | Paginação de claims/history por cursor | **BLOCKED** |
| F006 | Rate-limit de `presence.typing` | COMPLETED |
| F007 | Bridge de instrumentação e2e dev-only | COMPLETED |
| F008 | Guard de JSON em `claimDraft` + lookup de ref | **FAILED** |
| F009 | `redactFile` deny-by-default + level canônico | **FAILED** |

O loop declarou HALT em 2026-07-21 com "5 COMPLETED, 2 BLOCKED, 2 FAILED — no executable features remain". `F008` e `F009` bateram `maxReworks` e pararam: o processo funcionou exatamente como especificado, e o efeito prático foi que **dois achados de segurança ficaram sem dono** — `F009` em particular terminou com resíduo de disclosure de ancestralidade de path.

Isso é contexto direto para a v1.0: um loop autônomo que trava por contagem de rework, e cujo travamento silenciosamente abandona achados de segurança, é o tipo de falha que a separação entre capacidade de inferir e autoridade para afirmar existe para tornar visível.

## 10. `specs/`, `feature/` e `prompts/` — o rastro de execução

`docs/specs/` guardava doze diretórios de feature, cada um com o mesmo pipeline: `001-problem-space` → `002-context-map` → `003-tactical-design` → `004-test-scenarios`, mais `QA.json`, `TL.json`, `TDD-OUTPUT.json` e, quando houve retry, `REWORK-LOG.md` e `TDD-OUTPUT.retryN.json`. `docs/feature/` guardava a memória de projeto escrita na fase E — nove documentos de navegação, um por feature aceita.

`docs/prompts/` tinha dois artefatos: o prompt de implementação das UI-3/4/5 e o `ui-concept-generator.md`, que fixava as diretrizes estéticas e os prompts de geração visual que serviram de norte para a UI.

Esse formato de spec é substituído. O que o sucede é o par PRD/ADR da BREAKINGCHANGE, com a diferença de que ali **todo critério de aceite é verificável por log** — a convenção nasceu como resposta direta ao que estes documentos mostraram sobre validação por julgamento.

---

## 11. O que foi realmente construído

Para separar plano de conquista — a distinção que o Working Paper marca como `[B]` versus `[E]`:

**Existe, com teste e evidência:** servidor MCP com tools, gates, SQLite multi-tenant, SSE, presença, affinity router e typing (29 arquivos de integração real, sem mocks); `graph-core` como pacote com ~50 módulos e 37 testes diretos nos cinco que o `gates.ts` importa; `@open-graph-mcp/client` com camada viva e fallback por polling; proxy stdio e recipes de conexão para 5 clientes; web UI React Flow até UI-4; CI GitHub Actions em push e PR; 8 testes de segurança nomeados; pipeline de release; e o registry de adapters de agente com 11 flavors.

**Foi planejado e nunca construído:** tokens persistentes (`D10`), lock otimista com rebase e authz (Fase 4 inteira), federação cross-server (Fase 5), o hosted (Fase 5'), a sessão de beta, e UI-5.

**Foi construído e nunca exercitado, ou ficou sem dono:** `F008` e `F009`; a validação manual do Claude Code na matriz de compliance; branch protection em `main`.

---

## 12. Por que tudo isto foi apagado

Os documentos acima descrevem um futuro que a reestruturação da Arquitetura Cognitiva substitui. Mantê-los como registro navegável tinha um custo específico e conhecido: seis roadmaps com sequências de execução próprias, decisões numeradas em cinco vocabulários paralelos (`D`, `QD`, `WD`, `ID`, `BD`, `SB`) e dois arquivos chamados `ADR.md` são, coletivamente, uma superfície onde alguém — humano ou agente — trabalha contra um plano morto sem perceber que ele morreu.

O que eles produziram não se perde: está no código, nos testes, e nos princípios que o Working Paper v1.0 herda e reformula. O que morre é a instrução de trabalho.
