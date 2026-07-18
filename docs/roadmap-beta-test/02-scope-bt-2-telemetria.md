# BT-2 — Escopo fechado (telemetria da sessão)

> Status: **proposto** — depois de BT-0 (baseline de reconexão do túnel
> entra aqui); antes de BT-3 (a carga valida a telemetria). Índice-pai:
> `README.md`.
>
> **Objetivo:** a sessão é uma janela única — o que não for capturado
> se perde. Este escopo define as métricas OBRIGATÓRIAS (a pergunta em
> aberto do beta), implementa a coleta 100% server-side (BD2) e o
> relatório que transforma o log em avaliação de eficiência,
> estabilidade e usabilidade das ferramentas de criação.

---

## 1. O que sai pronto no final

1. **Camada de métricas no server** (removível, atrás de env
   `METRICS_LOG=path`): um JSONL append-only por sessão com um registro
   por tool call (`ts, tenant, userId, agentKind, tool, durMs, ok,
   errKind`) e por evento de conexão SSE (`connect, disconnect, reason,
   durMs`). Zero mudança de comportamento com a env desligada.
2. **Definição das métricas obrigatórias** (tabela abaixo) versionada —
   cada uma com fonte (event log JSONL existente vs metrics log novo) e
   pergunta que responde.
3. **Script de relatório** `scripts/beta-report.ts`: lê os dois logs de
   um tenant e emite `beta-report-<sessão>.md` com todas as métricas
   obrigatórias calculadas.

### Métricas obrigatórias

| Eixo | Métrica | Fonte | Pergunta que responde |
|---|---|---|---|
| Estabilidade | p50/p95/p99 de latência por tool (no server) | metrics log | server aguentou? compare com perf-log QA-5 |
| Estabilidade | taxa de erro por tool (por minuto, na janela) | metrics log | algo quebrou sob uso real? |
| Estabilidade | desconexões SSE por usuário/hora + duração média de conexão | metrics log | o túnel/edge derruba gente? (baseline BT-0) |
| Estabilidade | restarts de server na janela (meta: 0, BD6) | operacional | congelamento respeitado? |
| Eficiência | funil do turno: open→1º claim→commit (durações) | event log | o ciclo de criação flui ou trava? |
| Eficiência | commits ok vs abort (TTL vs gate-fail vs manual) | event log | quanta criação se perde, e por quê? |
| Eficiência | `lock.denied` por cell + tempo até resolução (retry ok, desistiu, TTL do dono) | event log + metrics log | contenção é momento-produto ou fila frustrante? (risco 4) |
| Eficiência | claims por changeset; `changeset.extend` por usuário | event log | TTL default serve pro ritmo criativo? |
| Usabilidade | `graph.query` gaps: termos sem match, por usuário | metrics log (args de query) | vocabulário da ferramenta bate com o dos criadores? |
| Usabilidade | tempo até 1º commit por participante (ativação) | event log | quanto custa "entrar no jogo"? |
| Usabilidade | distribuição de commits por usuário e por cell/domínio | event log | criação foi coletiva ou 2 pessoas dominaram? concentrou em 1 cell? |
| Usabilidade | mix humano (web) × agente (agentKind) por operação | metrics log | os agentes participaram da criação de fato? |
| Sessão | curva de presença simultânea na janela (pico + evolução) | event log/presença | quantos ficaram até o fim? |
| Sessão | system.message entregues × expirados sem drenar | event log + tabela `system_messages` | o canal de avisos funciona pra não-web? |

**Definição de pronto (DoD):**

- [ ] **Metrics log implementado** atrás de `METRICS_LOG`; com a env
      desligada, `bun test` inteiro passa sem diff de comportamento;
      com ela ligada, os testes de integração existentes geram um JSONL
      válido (teste novo que liga a env e valida o formato).
- [ ] **Overhead medido**: soak curto (reuso do harness QA-5) com e sem
      `METRICS_LOG` — p95 não degrada além de ruído; números no
      `perf-log.md` (QA-5) com data.
- [ ] **Pesquisa #3 do README respondida**: doc curto mapeando cada
      métrica da tabela → campo(s) exato(s) no event log ou metrics
      log; o que faltou virou campo novo do metrics log (não do event
      log — verdade do grafo não muda por telemetria).
- [ ] **`beta-report.ts` roda contra dados sintéticos** (fixture de
      sessão gerada por script ou pelo BT-3) e emite TODAS as métricas
      obrigatórias — nenhuma "N/A" por falta de dado.
- [ ] **Validação real**: relatório gerado a partir do teste de carga
      do BT-3 (dados atravessando o túnel real), arquivado em
      `docs/roadmap-beta-test/relatorios/`.

---

## 2. O que NÃO está nesta fase

- ❌ Telemetria no cliente/plugin/web UI — BD2; nunca neste roadmap.
- ❌ Dashboard live durante a sessão — o facilitador olha o dashboard
  do ngrok + `tail -f` do metrics log; visualização rica é pós-sessão.
- ❌ Telemetria de produto permanente — decisão de produto, fora
  (anti-escopo roadmap-qa mantido).
- ❌ Gravação de CONTEÚDO criativo pra análise — o conteúdo já vive no
  grafo (verdade no grafo); telemetria só mede processo, não duplica.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Metrics log + testes + overhead | 1.5 dia |
| Mapeamento métricas→campos (pesquisa #3) | 0.5 dia |
| `beta-report.ts` + fixture sintética | 1-1.5 dia |
| **Total** | **3-4 dias** |

---

## 4. Riscos

1. **Métrica definida sem dado que a sustente** descoberta só na
   análise pós-sessão (tarde demais). Mitigação: o DoD do relatório
   proíbe "N/A" — toda métrica roda contra dados sintéticos ANTES da
   sessão.
2. **Logar args de `graph.query` (pros gaps) captura texto dos
   participantes.** Mitigação: logar só `terms` e `gaps` (listas de
   termos, necessários pra métrica), nada de payloads de claim;
   participantes informados no consentimento (roteiro BT-4).
3. **Overhead do log síncrono aparece justo no pico.** Mitigação:
   append bufferizado + medição no DoD; se degradar, amostrar latência
   (1/N) antes de cortar métrica.
