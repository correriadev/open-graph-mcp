# Roadmap-beta-test — índice

> **⚠ ADIADO (2026-07-18, decisão do dono):** a web UI atual não
> sustenta a dinâmica criativa da sessão (sem `graph.query`, sem
> leitura de claims — evidência que o BD5 previa descobrir só no
> dry-run). A UI será recriada em `docs/roadmap-web-ui/` (React Flow);
> este roadmap retoma quando o gate UI-5 de lá for assinado. O que já
> foi entregue não se perde: BT-1 (release.yml + empacotamento +
> INSTALL.md) está implementado e independe da web UI.

> Como transformamos o open-graph-mcp numa **sessão coordenada de
> co-criação**: participantes (game devs + solo devs) usam as tools do
> grafo para criar, juntos e em tempo real, um jogo simples (história,
> mecânicas, gameloop). Server local do dono, exposto via ngrok só na
> janela de teste; artefato instalável sai do GitHub Actions. Irmão de
> `roadmap-mcp/` (produto), `roadmap-qa/` (qualidade) e
> `roadmap-integrations/` (conexão). Baseline: pós-INT-3 + QA-1..6.
> Substitui o plano anterior de beta por coortes A/B (instalação
> individual, removido); o que sobreviveu de lá está incorporado aqui:
> o gate pós-beta (§Gate de decisão abaixo) e as metas de ativação
> (<15 min instalação, BT-1).

## A tese (ler antes dos escopos)

O beta por instalação individual valida onboarding, mas dilui o
multiplayer: cada tester sozinho não vê presença de ninguém. A sessão
síncrona inverte isso — **uma janela, todos ao mesmo tempo, um objetivo
criativo comum** — e exercita o produto exatamente na sua forma mais
densa: presença simultânea máxima, locks disputados de verdade, turnos
colidindo nas mesmas cells. O jogo criado é pretexto; o produto sob
teste é a ferramenta de criação coletiva.

Nada disso exige feature nova de produto. Exige quatro coisas que hoje
não existem: (a) uma ponte **temporária e vigiada** entre a internet
pública e um server que é D2 por design (BT-0); (b) um **artefato** que
um estranho instala em minutos sem contexto do monorepo (BT-1); (c)
**instrumentação** que transforme a sessão em dados analisáveis — o
event log JSONL já grava quase tudo; falta a camada de métricas de
transporte/latência e o relatório (BT-2); (d) **conteúdo e dinâmica**
que façam o grafo virar mesa de game design em vez de demo técnica
(BT-4). E como é uma máquina, uma janela e uma chance, carga simulada
com o formato real da sessão (BT-3) e ensaio geral com go/no-go (BT-5)
são gates, não luxo.

## Documentos

| # | Arquivo | Função | Status |
|---|---|---|---|
| 0 | `00-scope-bt-0-exposicao-ngrok.md` | Topologia MCP + ngrok, análise de ameaça da janela, runbook de abrir/fechar túnel. **Primeiro.** | proposto |
| 1 | `01-scope-bt-1-pipeline-artefato.md` | GitHub Actions: job de release gerando o artefato instalável dos participantes. | proposto |
| 2 | `02-scope-bt-2-telemetria.md` | Métricas obrigatórias da sessão (definidas), coleta server-side, relatório pós-sessão. | proposto |
| 3 | `03-scope-bt-3-carga-concorrencia.md` | Teste de estresse com o SHAPE da sessão (hot cells disputadas), através do túnel real. | proposto |
| 4 | `04-scope-bt-4-conteudo-dinamica.md` | Graph seed do jogo, roteiro do facilitador, missões da sessão. | proposto |
| 5 | `05-scope-bt-5-dry-run-go-no-go.md` | Ensaio geral + checklist go/no-go + runbook do dia. **Gate final.** | proposto |

## Decisões (BD)

- **BD1 — ngrok é janela, não deployment.** O túnel existe só durante
  sessões agendadas (abrir → sessão → fechar, runbook BT-0); URL nova
  por sessão, nunca publicada em lugar indexável. D2 ("rede confiável")
  continua sendo o deployment suportado do produto — a janela é uma
  exceção operada, com dono presente e monitorando. *Reabre se:* beta
  virar contínuo/assíncrono → isso é hosted (roadmap-mcp `05'`), não
  mais túnel.
- **BD2 — Telemetria é escopo de beta, 100% server-side.** Deriva do
  event log JSONL existente + uma camada nova de log de métricas no
  server (latência/erro por tool call, conexões SSE). **Nada instalado
  no participante coleta dados** — plugin/proxy/web UI permanecem
  limpos. O anti-escopo de telemetria do roadmap-qa continua valendo
  para o produto; isto é instrumentação de laboratório, removível.
  *Reabre se:* produto decidir telemetria própria (decisão de produto,
  fora daqui).
- **BD3 — Um tenant dedicado por sessão** (`beta-<yyyymmdd>`). Isola o
  experimento do resto do server (D13 multi-tenant já existe pra isso),
  dá análise limpa por sessão (seq monotônico por tenant = timeline
  pronta) e permite descartar/arquivar sem tocar em nada mais. *Reabre
  se:* sessões precisarem continuar o MESMO jogo entre janelas — aí o
  tenant persiste entre sessões (decisão do facilitador, não técnica).
- **BD4 — Artefato via GitHub Release em repo privado; distribuição
  aos participantes é MANUAL via Google Drive (este beta somente).**
  *(Decidido pelo dono, 2026-07-18.)* O job de release (BT-1) continua
  sendo a fonte de verdade do artefato (build reprodutível, gate de CI,
  tag por sessão); o dono baixa os assets do Release e sobe no Drive —
  participantes recebem um link de pasta, zero conta GitHub envolvida.
  Sem npm publish, sem collaborators, sem repo público. *Reabre se:*
  beta virar recorrente/público — aí distribuição manual não escala e
  vira INT-6 (npm + registries).
- **BD5 — Web UI é o cliente garantido; agente MCP é camada opcional
  por participante.** Todo participante cria pela web UI (zero
  instalação além do link); quem tiver Claude Code instala o plugin e
  traz seu agente pra mesa. A sessão NÃO depende de todos terem agente.
  *Reabre se:* dry-run mostrar que a web UI sozinha não sustenta a
  dinâmica criativa.
- **BD6 — Server congela antes do go.** Nenhum deploy, restart ou
  mudança de config durante a janela: tokens são em memória (pré-D10) e
  um restart derruba a sessão inteira. O que não estiver pronto no
  go/no-go (BT-5) fica de fora da sessão. Sem exceção.

## Sequência de execução

```
BT-0 (exposição ngrok) ──► BT-2 (telemetria) ──► BT-3 (carga via túnel)
        │                                              │
BT-1 (pipeline artefato) ──────────────┐               │
BT-4 (conteúdo/dinâmica) ──────────────┤               │
                                       ▼               ▼
                              BT-5 (dry-run + go/no-go) ══ GATE da sessão real
```

BT-0 primeiro (tudo depende da topologia decidida e testada). BT-2 antes
de BT-3 de propósito: o teste de carga valida TAMBÉM a telemetria
(overhead + números fazendo sentido). BT-1 e BT-4 paralelizam com tudo.
BT-5 só começa com os quatro anteriores verdes, e a sessão real só
acontece com BT-5 verde.

## Esforço estimado (1 dev, ~50% dedicação)

- BT-0: 2-3 dias
- BT-1: 2-3 dias
- BT-2: 3-4 dias
- BT-3: 2-3 dias
- BT-4: 2-3 dias (+ facilitação na sessão)
- BT-5: 1-2 dias
- **Total até "sessão real liberada": ~2.5-3.5 semanas**

## Riscos transversais

1. **Expor um server D2 na internet, mesmo por janela.** CORS `*`, sem
   auth de transporte, token por argumento. Um URL vazado = qualquer um
   entra como "participante". Mitigação em camadas (BT-0): URL
   aleatório por sessão + distribuição só no canal privado do grupo +
   tenant dedicado (dano confinado, BD3) + dono monitorando o dashboard
   do ngrok ao vivo + túnel morre no fim da janela + snapshot/backup do
   `STATE_DIR` antes de abrir. **Aceito o residual**: dados da sessão
   são um jogo fictício criado por convidados, não segredo.
2. **Uma máquina, uma rede doméstica, uma chance.** Queda de
   energia/ISP/notebook do dono mata a sessão ao vivo, na frente de
   todo mundo. Mitigação: checklist pré-go (energia, rede cabeada se
   possível, nada pesado rodando junto) + plano B ensaiado no dry-run
   ("túnel caiu": todos param 5 min, dono reabre, proxies re-registram
   sozinhos — web UI precisa re-registrar manual, roteiro BT-4 avisa).
   **Aceito o residual**: é beta com amigos, não SLA.
3. **ngrok free tem pegadinhas que quebram o produto silenciosamente**:
   página interstitial em browsers (quebra a web UI se o header
   `ngrok-skip-browser-warning` não chegar), limites de
   banda/conexões, URL efêmero. Mitigação: pesquisa pré-código abaixo
   valida CADA capacidade no plano real da conta; SSE + web UI + proxy
   através do túnel real é DoD do BT-0, não suposição.
4. **Contenção de lock é o produto — ou a frustração.** A dinâmica
   concentra todo mundo em poucas cells (história, mecânicas,
   gameloop); `lock.denied` em rajada é o momento-verdade do produto,
   mas mal facilitado vira fila de espera chata. Mitigação: BT-4
   desenha a dinâmica pra ISSO (cells suficientes pra paralelizar,
   missões que alternam foco); BT-3 mede o pior caso antes; telemetria
   (BT-2) captura tempo-até-resolução de cada negação pra julgar depois.
5. **Amostra pequena e amiga.** 5–10 participantes gentis não provam
   mercado. Aceito: o objetivo desta janela é robustez + usabilidade da
   ferramenta de criação (tese), não validação de demanda — essa
   continua sendo o checkpoint de adoção do roadmap-mcp, lido depois
   com as métricas do BT-2.

## Gate de decisão pós-beta (herdado do plano anterior)

Lido DEPOIS da(s) sessão(ões), com o relatório BT-2 na mão — é o
checkpoint de adoção do roadmap-mcp aplicado ao beta:

- **≥2 participantes voltando ao grafo sem cobrança** (sessão seguinte
  pedida, ou uso espontâneo do tenant entre janelas) → checkpoint
  fechado; investir Fase 4 (authz/tokens 90d) + INT-6 real.
- **Uso só quando cutucados** → pausa de produto; entrevistas de "por
  que não voltou" antes de codar qualquer coisa.
- Sinal > opinião: amigos elogiam por gentileza; a métrica do gate é
  comportamento (voltou), nunca feedback verbal. Pergunta fixa da retro
  (BT-4): "se isso sumisse amanhã, você sentiria falta? do quê?"

## Pesquisa pré-código (trava BT-0/BT-1)

1. **Capacidades reais do plano ngrok FREE** (decidido pelo dono,
   2026-07-18 — "por enquanto"; upgrade só se a matriz ou o BT-3
   provarem insuficiência): interstitial e o header `ngrok-skip-browser-warning` (a web
   UI consegue mandar? senão, plano pago ou domínio reservado);
   streaming SSE atravessa sem buffering?; limites de
   conexões/banda/duração de túnel; `--basic-auth` disponível? IP
   allowlist? Registrar a matriz testada (com data) no BT-0.
2. **Formato do artefato que menos atrita**: tarball com script de
   setup vs `bun build --compile` — testar o caminho completo numa
   máquina limpa SEM o monorepo antes de fixar o BT-1. O download em si
   está resolvido por BD4 (link de Google Drive); o que resta validar é
   só instalar → conectar a partir do tarball baixado.
3. **Confirmar que o event log JSONL por tenant contém o suficiente**
   pro funil de turno (open/claim/commit/abort com timestamps e
   userId) — o que faltar define o tamanho real da camada nova do BT-2.
