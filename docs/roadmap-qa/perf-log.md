# perf-log — QA-5

> Registro por execução (data, commit, cenário, números, ambiente). Regra QA-5 risco #1: comparações
> só INTRA-ambiente — a máquina do dev não é "a verdade", é a referência do dev.
>
> Ambiente de referência (todas as execuções abaixo): Linux x86_64, 12 vCPU, 14GiB RAM, Bun 1.3.14,
> localhost (Bun.serve + SQLite em `mkdtemp`).

## 2026-07-18 — commit `2819034` (baseline QA-5)

### Burst (`bun run test:load`) — Fase 3 §11 DoD

50 sessões SSE não-filtradas, 10 abrindo `changeset.open` concorrentemente em cells distintas, 500
amostras de latência (50 sessões × 10 opens).

| p50 | p95 | p100 (max) | % < 250ms |
|---|---|---|---|
| 50.1ms | 55.6ms | 56.1ms | 100.0% |

PASS (gate: p100 < 500ms, ≥85% < 250ms).

### Broadcast storm (`bun run test:storm`)

50 sessões, cada uma foca sua própria cell e dispara 40 `changeset.claim` concorrentes (2000 claims
no total). Mede coalescência de `user.typing_state` (spec §5.1: só em transição, nunca por tick).

| claims | typing_state events | ratio |
|---|---|---|
| 2000 | 50 | 2.50% |

PASS (gate: ratio < 10%, eventos ≤ 2×N sessões). 50 eventos = exatamente 1 transição
quiet→typing por usuário, o ideal teórico.

### Soak (`bun run test:soak`) — 10 min sustentado

50 sessões SSE, beat a cada 15s, focus churn a cada ~30s (pool de 8 cells), 10 holders com
`changeset.claim` contínuo (1/s cada, commit+reabre a cada 5 claims). RSS e latência (RPC
`presence.focus`) amostrados por minuto. Duas execuções reais de 10 min nesta data — a primeira
revelou (e a segunda confirmou o fix de) um leak no PRÓPRIO harness de teste antes de chegar ao
número real do servidor; ver `05-scope-qa-5-perf-soak.md` §5 para a análise completa.

**Execução #1 (harness com leak — `openSse` retendo eventos p/ sempre em 50 conexões × 10min):**

| minuto | RSS (MB) | claims | beats |
|---|---|---|---|
| 1 | 131.0 | 600 | 150 |
| 5 | 142.7 | 3000 | 950 |
| 10 | 155.8 | 5990 | 1950 |

RSS cresceu linear (~2.7MB/min) — não era leak de sessão/timer, era o design do teste (holders
nunca comitavam, `cs_deltas` crescia sem limite). Corrigido: holders passaram a comitar+reabrir a
cada 5 claims. Reexecutado → RSS ficou SUPERLINEAR (122.9% de crescimento, acelerando) — aí sim
sinal de leak real, mas do harness (`openSse` acumulando array de eventos, mesmo processo do
servidor), não do servidor. Fix: `openSseDiscard` (local ao script) descarta eventos após capturar
o `sessionId`.

**Execução #2 (harness corrigido — número real do servidor):**

| minuto | RSS (MB) | claims | beats |
|---|---|---|---|
| 1 | 157.8 | 600 | 150 |
| 2 (aquecido) | 124.7 | 1190 | 350 |
| 5 | 126.0 | 2640 | 900 |
| 10 | 127.6 | 5610 | 1868 |

| RSS growth (min2→min10) | monotônico? | orphan sessions | latência p95 (min1→min10) |
|---|---|---|---|
| **2.3%** ✅ | não ✅ | **0** ✅ | **15.9ms → 145.8ms (≈9×)** ❌ |

RSS e sessões órfãs: PASS, limpo. Latência: **FAIL real** — não é ruído nem artefato do harness
(harness já corrigido nesta execução). Causa raiz: `readClaims` (`store.ts:12`) faz full-tenant-scan
(`SELECT * FROM claims WHERE tenant_id = ?`, sem LIMIT) dentro de `incrementalGate`, chamado em TODO
`changeset.claim` — custo por chamada cresce com o total de claims já commitados (5610 ao final).
Mesma família do N+1 conhecido do `presence.who`. Ver scope doc §5 para os detalhes.

**Fix (mesma data): cache em memória de `readClaims` por tenant.** `state.claimsCache` — populado
lazy no primeiro `readClaims`, mantido incrementalmente por `writeClaim` (claims são append-only,
nunca mudam/somem depois de commitadas), invalidado por `invalidateClaimsCache` no único caminho que
escreve claims por fora de `writeClaim` (`rebuildFromJsonl`). Reexecução real de 10 min pós-fix:

| minuto | RSS (MB) | claims | beats |
|---|---|---|---|
| 1 | 161.5 | 600 | 150 |
| 2 (aquecido) | 123.9 | 1190 | 350 |
| 5 | 125.7 | 2980 | 950 |
| 10 | 126.8 | 5950 | 1950 |

| RSS growth (min2→min10) | monotônico? | orphan sessions | latência p95 (min1→min10) |
|---|---|---|---|
| 2.3% ✅ | não ✅ | 0 ✅ | **23.6ms → 26.3ms** ✅ (era 15.9ms → 145.8ms, ≈9× degradação, antes do fix) |

**PASS — todas as 4 asserções do soak.** Fase 4 gate: desbloqueado.

## Débito

- Latência do soak mede o round-trip HTTP de `presence.focus`, não chegada via SSE como o burst —
  ver comentário no próprio script (`presence-load.ts`, `runSoak`): correlacionar 50 observadores ×
  cada churn ao longo de 10 min é uma métrica mais pesada e diferente do que soak precisa provar
  ("o servidor continua respondendo sob carga sustentada").
- ~~`readClaims` full-tenant scan por `changeset.claim`~~ — **corrigido** 2026-07-18 (cache em
  memória por tenant, `state.claimsCache`). Ver acima.
- `presence.who` N+1 conhecido (`ponytail:` comment) — mesmo padrão do achado corrigido acima; ainda
  não medido isoladamente. Candidato a mesmo tratamento se algum soak futuro mostrar degradação.
