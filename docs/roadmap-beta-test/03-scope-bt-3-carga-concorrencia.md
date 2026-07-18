# BT-3 — Escopo fechado (carga com o shape da sessão)

> Status: **proposto** — depois de BT-0 (túnel) e BT-2 (telemetria).
> Índice-pai: `README.md`.
>
> **Objetivo:** QA-5 provou o server sob soak genérico e broadcast
> storm — mas a sessão tem um shape próprio e mais hostil: poucas cells
> quentes disputadas por todos, rajadas de claims, tudo através de um
> túnel. Este escopo simula ESSE shape antes de expor participantes
> reais a ele.

---

## 1. O que sai pronto no final

1. **Cenário `session-shape`** no harness de load existente
   (`packages/mcp-server`, reuso do QA-5 — QD3: nada de framework
   novo): N usuários virtuais (default 12 = 8 humanos + 4 agentes,
   mix de agentKind) sobre um tenant `beta-loadtest`, com
   comportamento da dinâmica: query → tentar `changeset.open` numa de
   3–5 hot cells → em `lock.denied`, política realista (retry com
   backoff / trocar de cell / desistir) → claims em rajada → commit ou
   abandono (TTL) → SSE aberto o tempo todo recebendo broadcast.
2. **Duas execuções registradas**: local (baseline da máquina) e
   **através do túnel ngrok real** (o número que importa pra sessão).
3. **Números de referência no `perf-log.md`** (QA-5) + relatório BT-2
   gerado da rodada — a mesma análise que a sessão real vai receber.

**Definição de pronto (DoD):**

- [ ] **Cenário versionado** e parametrizável (`USERS`, `HOT_CELLS`,
      `DURATION`), rodável com um comando documentado no próprio
      cenário; QD1 mantido: informativo, nunca gate de CI.
- [ ] **Rodada local 10 min** sem erro de servidor (5xx/exceção); locks
      NUNCA em estado inconsistente (pós-condição verificada ao final:
      todo lock órfão expirou via TTL; nenhuma cell travada sem dono
      vivo).
- [ ] **Rodada via túnel 10 min** de máquina fora da LAN: p95 por tool
      e taxa de reconexão SSE registradas; comparação explícita com a
      baseline local no `perf-log.md` (o delta É o custo do ngrok).
- [ ] **Rajada de contenção**: sub-cenário com TODOS os usuários
      tentando a MESMA cell por 60s — server responde `lock.denied`
      consistente (um dono por vez, fila justa não exigida, corrupção
      proibida), telemetria captura cada negação com timestamps.
- [ ] **Relatório BT-2 da rodada do túnel** arquivado em
      `docs/roadmap-beta-test/relatorios/` (fecha o DoD de validação
      real do BT-2 junto).
- [ ] **Validação real**: tudo acima com data/plano ngrok/condições de
      rede anotados no `perf-log.md`.

---

## 2. O que NÃO está nesta fase

- ❌ Fix de performance além de regressão bloqueante — achado
  não-bloqueante vira débito registrado no README do roadmap-qa (mesmo
  tratamento do `presence.who` N+1).
- ❌ Simulação de conteúdo criativo realista — usuários virtuais geram
  claims sintéticos; realismo de conteúdo é o dry-run (BT-5) com
  humanos.
- ❌ Escala além de ~2× o nº esperado de participantes — sessão é
  convidada e finita; 50-sessões burst já existe (QA-5).
- ❌ Chaos engineering (matar túnel no meio, etc.) no harness — o plano
  B de queda é ensaiado manualmente no dry-run (BT-5), não automatizado.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Cenário session-shape + política de lock realista | 1-1.5 dia |
| Rodadas local + túnel + rajada, registro | 0.5-1 dia |
| Análise + relatório + débitos registrados | 0.5 dia |
| **Total** | **2-3 dias** |

---

## 4. Riscos

1. **O túnel degrada além do usável** (p95 de tool call estoura
   segundos, SSE reconecta em loop). Mitigação: é EXATAMENTE o que a
   rodada via túnel existe pra descobrir com 2 semanas de antecedência;
   resposta é plano ngrok pago ou tailnet (risco 3 do BT-0), decidida
   com número na mão.
2. **A rajada de contenção acha bug real de lock** (a família
   `readClaims`/`presence.who` sugere que índices vivos sob contenção
   merecem desconfiança). Mitigação: é feature do escopo, não risco —
   melhor o harness achar do que os amigos; bug bloqueante trava BT-5
   até fix + re-rodada.
3. **Usuários virtuais bem-comportados demais** (backoff educado ≠
   agente real martelando). Mitigação: política de retry inclui um
   perfil "impaciente" (retry agressivo) por design; e o dry-run com
   agentes reais (BT-5) é a segunda rede.
