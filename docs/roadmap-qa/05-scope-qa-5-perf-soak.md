# QA-5 — Escopo fechado (performance + soak)

> Status: **implementado (2026-07-18)** — harness completo, 5/5 itens do
> DoD verdes. A 1ª execução real de 10 min achou uma degradação de
> latência real (~9×) — não bug do teste, achado É o produto desta fase
> (ver §5) — causa raiz corrigida no mesmo dia (`readClaims` cacheado por
> tenant) e revalidada com um 2º soak real de 10 min, limpo. GATE DE
> ENTRADA da Fase 4 (roadmap-mcp): **desbloqueado**.
> Índice-pai: `README.md`.
>
> **Objetivo:** o load test atual (`presence-load.ts`) mede UM burst
> (10 opens, 500 amostras, p100=54ms). Alpha multiplayer precisa de
> comportamento SUSTENTADO: latência estável ao longo do tempo e memória
> que não vaza. Fase 4 não começa sem estes números.

---

## 1. O que sai pronto no final

1. Modo soak no script de load (sustentado, 10 min).
2. Cenário broadcast storm (typing agregado sob pressão).
3. Log de performance versionado, por commit.

**Definição de pronto (DoD):**

- [x] `presence-load.ts` estendido com `--soak`: 50 sessões SSE, 10 min,
      beat a cada 15s + claims contínuos (10 holders) + focus churn
      (troca de cell a cada ~30s por sessão). Medições por minuto.
      Achado ao escrever: os holders não podiam ficar acumulando claims
      num único changeset aberto pra sempre (confunde o sinal de RSS —
      ver abaixo) — cada holder comita e reabre a cada 5 claims,
      espelhando autoria real.
- [x] Asserções do soak:
  - RSS estável: **passou** — 2.3% de crescimento entre minuto 2 (aquecido)
    e minuto 10, sem padrão monotônico. Achado ao medir: a primeira
    tentativa mostrou 122.9% de crescimento acelerado — não era leak do
    servidor, era o PRÓPRIO harness: `openSse` (helpers.ts) retém todo
    evento recebido para sempre num array, correto pra testes curtos de
    asserção, memory leak de verdade quando usado por 50 conexões
    não-filtradas por 10 min no MESMO processo do servidor (`startServer`
    roda in-process). Fix: `openSseDiscard`, local a este script, que
    captura só o `sessionId` e descarta o resto — depois do fix, RSS ficou
    plano.
  - Zero sessões órfãs no fim: **passou** — `state.sessions.size` = 0 após
    close de todos os 50 clients.
  - Latência estável (p95 do último minuto < 2× p95 do primeiro):
    **FALHOU na 1ª execução real** — 15.9ms → 145.8ms (≈9×) em 10 min,
    depois do fix do harness acima (então não é o mesmo artefato). Causa
    raiz: `readClaims` (`store.ts:12`) fazia `SELECT * FROM claims WHERE
    tenant_id = ?` (full scan + JSON.parse por linha) dentro de
    `incrementalGate` em TODO `changeset.claim` — não só no commit. Com 10
    holders reivindicando ~1/s, o custo por chamada crescia com o total de
    claims já commitados (5610 ao final), O(n) por operação, O(n²)
    agregado ao longo do soak. Mesma família do N+1 já documentado do
    `presence.who` (README, Débitos #3) — não era bug deste script, era o
    comportamento real do servidor sob carga sustentada, exatamente o que
    esta fase existe pra revelar (§4 risco 3 previu isso). **Corrigido no
    mesmo dia**: `state.claimsCache` — cache em memória por tenant,
    populado lazy no primeiro `readClaims`, mantido incrementalmente por
    `writeClaim` (claims são append-only), invalidado por
    `invalidateClaimsCache` no único caminho que escreve claims por fora
    de `writeClaim` (`rebuildFromJsonl`). Revalidado com um 2º soak real
    de 10 min: p95 23.6ms → 26.3ms — **passou**.
    Escopo de correção é próprio (fora de QA-5 — "esta fase MEDE").
- [x] Broadcast storm: 50 sessões todas com focus + claims simultâneos →
      `user.typing_state` continua agregado (spec Fase 3 §5: transições,
      não ticks — asserta contagem de eventos ≪ contagem de claims).
      **Passou**: 2000 claims concorrentes (50 sessões × 40) → 50 eventos
      `user.typing_state` (ratio 2.5%, exatamente 1 transição
      quiet→typing por usuário — o ideal teórico).
- [x] `docs/roadmap-qa/perf-log.md`: tabela (data, commit, cenário,
      p50/p95/p100, %<250ms, RSS início/fim). Registrar baseline atual +
      cada execução relevante (pré-release, pré-Fase 4).
- [x] `bun run test:soak` (e `test:storm`) no package.json do mcp-server.
      NÃO rodam em CI (10 min / sensível a ambiente) — execução manual
      documentada.

---

## 2. O que NÃO está nesta fase

- ❌ Otimização — esta fase MEDE. Se números quebrarem, o fix é tarefa
  própria (candidato conhecido: N+1 do `presence.who`, já marcado com
  `ponytail:` — vira item real SE o soak mostrar degradação). **Aconteceu
  e foi corrigido no mesmo dia** (ver §5) precisamente porque bloqueava o
  gate de entrada da Fase 4 declarado no topo deste doc — não é uma
  reversão da regra "esta fase mede", é o próprio gate falhando e sendo
  desbloqueado. `presence.who` continua candidato, não medido isoladamente.
- ❌ Load distribuído/multi-máquina — single-node SQLite é decisão D3;
  50 usuários é o teto declarado do v1.
- ❌ Profiling contínuo/APM — fora do v1.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Modo soak + asserções | 1-2 dias |
| Broadcast storm | 0.5-1 dia |
| perf-log + baseline | 0.5 dia |
| **Total** | **2-3 dias** |

---

## 4. Riscos

1. **Número da máquina do dev vira "verdade".** Mitigação: perf-log
   registra AMBIENTE junto do número; comparações só intra-ambiente.
2. **Soak passa hoje, leak aparece em 6h.** Aceito: 10 min pega leaks
   lineares óbvios (timer/session); soak de horas só se surgir suspeita
   real em uso.
3. **SQLite single-writer sob claims contínuos.** É exatamente o que o
   soak vai revelar — se serializar mal, o dado chega antes da Fase 4
   (onde rebase multiplica escrita). **Confirmado e corrigido** — não era
   o writer em si (WAL mode, `busy_timeout` configurado), era `readClaims`
   fazendo full-tenant-scan a cada claim; ver §5.

---

## 5. Achado real do soak (2026-07-18) — degradação de latência sob carga sustentada, corrigida no mesmo dia

**Sintoma (1ª execução):** p95 de `presence.focus` sobe de 15.9ms (minuto
1) pra 145.8ms (minuto 10) — ≈9× — numa execução real de 10 minutos, 10
holders reivindicando ~1 claim/s cada (commit+reabre a cada 5 claims), 50
sessões com beat/focus churn. RSS ficou estável (2.3% de crescimento) e
zero sessões órfãs — não era leak de memória, era custo de CPU/IO
crescente por operação.

**Causa raiz:** `changesetClaim` (`changeset.ts`) chama `incrementalGate`,
que recebe `existingClaims: readClaims(state, tenant)` — `readClaims`
(`store.ts`) rodava `SELECT id, subject, domain, level, refs, anchor, file
FROM claims WHERE tenant_id = ?` (SEM LIMIT, sem filtro por cell/domain) e
fazia `JSON.parse` + alocava um objeto por linha, TODA vez que qualquer
changeset faz `changeset.claim` — não só no commit. Claims committed só
crescem (5610 no fim dos 10 min); o custo de cada nova claim.add crescia com
o total acumulado. Efeito agregado ao longo do soak: O(n²) em vez de O(n).

**Por que não é o mesmo achado de RSS (não é confundir dois bugs):** o
crescimento de RSS foi isolado e corrigido separadamente (era o harness
retendo eventos, `openSseDiscard` fix) ANTES desta execução; a run que
produziu os 15.9→145.8ms já rodava com o harness corrigido (RSS 2.3%,
plano) — a degradação de latência foi um achado limpo, reproduzido depois
do fix do harness, não resíduo do primeiro bug.

**Fix (mesmo dia):** `state.claimsCache` (`state.ts`) — `Map<tenant,
ClaimSnapshot[]>` populado lazy no primeiro `readClaims`, empurrado
incrementalmente por `writeClaim` (claims são append-only — nunca mudam
nem somem depois de commitadas, então empurrar é sempre seguro), invalidado
por `invalidateClaimsCache` (novo export de `store.ts`) no único caminho
que escreve claims por fora de `writeClaim` (`rebuildFromJsonl`, que não
conhece `ServerState` de propósito — invalidação é responsabilidade do
chamador, documentada no próprio `db.ts`).

**Revalidação:** 2º soak real de 10 min, harness idêntico, mesma máquina —
p95 23.6ms → 26.3ms (dentro do 2× threshold, praticamente plano), RSS 2.3%
de crescimento, 0 sessões órfãs. **PASS nas 4 asserções.** `presence.who`
tem o mesmo padrão (README, Débitos #3) e continua candidato pra tratamento
igual, sem medição isolada ainda.
