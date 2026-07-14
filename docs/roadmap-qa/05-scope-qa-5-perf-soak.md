# QA-5 — Escopo fechado (performance + soak)

> Status: **escopo p/ execução** — GATE DE ENTRADA da Fase 4 (roadmap-mcp).
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

- [ ] `presence-load.ts` estendido com `--soak`: 50 sessões SSE, 10 min,
      beat a cada 15s + claims contínuos (10 holders) + focus churn
      (troca de cell a cada ~30s por sessão). Medições por minuto.
- [ ] Asserções do soak:
  - Latência estável: p95 do último minuto < 2× p95 do primeiro minuto.
  - RSS estável: crescimento < 20% entre minuto 2 e minuto 10 (aquecido);
    sem crescimento monotônico (leak de session/presence/timer/debounce).
  - Zero sessões órfãs no fim: `state.sessions.size` volta a 0 após
    close de todos os clients (regressão do leak de SSE da Task 4).
- [ ] Broadcast storm: 50 sessões todas com focus + claims simultâneos →
      `user.typing_state` continua agregado (spec Fase 3 §5: transições,
      não ticks — asserta contagem de eventos ≪ contagem de claims).
- [ ] `docs/roadmap-qa/perf-log.md`: tabela (data, commit, cenário,
      p50/p95/p100, %<250ms, RSS início/fim). Registrar baseline atual +
      cada execução relevante (pré-release, pré-Fase 4).
- [ ] `bun run test:soak` no package.json do mcp-server. NÃO roda em CI
      (10 min, sensível a ambiente) — execução manual documentada.

---

## 2. O que NÃO está nesta fase

- ❌ Otimização — esta fase MEDE. Se números quebrarem, o fix é tarefa
  própria (candidato conhecido: N+1 do `presence.who`, já marcado com
  `ponytail:` — vira item real SE o soak mostrar degradação).
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
   (onde rebase multiplica escrita).
