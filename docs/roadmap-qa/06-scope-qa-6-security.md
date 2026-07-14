# QA-6 — Escopo fechado (segurança como suíte nomeada)

> Status: **escopo p/ execução** — qualquer hora; OBRIGATÓRIO antes da
> Fase 4 (roles/authz). Índice-pai: `README.md`.
>
> **Objetivo:** os testes de segurança JÁ existem (nasceram das reviews da
> Fase 3), mas estão espalhados e anônimos. Consolidar visibilidade — não
> reescrever — e institucionalizar o ciclo review→teste pinado.

---

## 1. O que sai pronto no final

1. Inventário versionado do que é teste de segurança e qual ataque cobre.
2. Processo: security review por release de fase; achado vira teste.
3. Pré-requisito da Fase 4 declarado.

**Definição de pronto (DoD):**

- [ ] `docs/roadmap-qa/security-tests.md` — inventário: arquivo → ataque
      coberto:
  - `tenant-isolation.test.ts` → dados/eventos não vazam entre tenants.
  - `presence-ownership.test.ts` → hijack de sessionId (mesmo tenant e
    cross-tenant): rejeitado, estado da vítima intacto, zero broadcast.
  - `lock-denied-private.test.ts` → `lock.denied` privado nas TRÊS portas:
    live (router), replay SSE (isRecipient), `graph://history` (SQL).
  - Session IDs aleatórios (capability opaca) — coberto por construção +
    ownership binding como defense in depth (comentários em sse.ts /
    presence.ts).
- [ ] Convenção documentada (no próprio inventário): teste novo de
      segurança entra no inventário no MESMO PR — inventário desatualizado
      é quebra de review.
- [ ] Processo: `/security-review` no diff acumulado antes de cada release
      de fase; cada achado confirmado vira teste pinado + linha no
      inventário. (Fase 3 fez isso implicitamente via reviews; formalizar.)
- [ ] Declarado como gate da Fase 4: authz nasce com testes NEGATIVOS
      (observer NÃO pode editar; editor NÃO pode admin; token expirado NÃO
      autentica) — feature de permissão sem teste negativo não mergeia.

---

## 2. O que NÃO está nesta fase

- ❌ Renomear/mover testes existentes (`*.sec.test.ts`) — churn sem valor;
  o inventário resolve a visibilidade.
- ❌ Pentest externo, SAST/DAST, dependabot — single-org trust (D2),
  fase errada; reavaliar no hosted (roadmap-mcp 05').
- ❌ Fuzzing de protocolo — anti-escopo global do roadmap QA.
- ❌ Threat model formal completo — o inventário + reviews por fase cobrem
  o v1; threat model é tarefa do hosted/multi-org.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Inventário + convenção | 0.5 dia |
| Processo por release (recorrente) | ~0.5 dia por fase |
| **Total setup** | **1 dia** |

---

## 4. Riscos

1. **Inventário vira documento morto.** Trava: regra "mesmo PR" no DoD —
   e é curto o suficiente pra manter.
2. **Falsa sensação de segurança** (D2 single-org esconde classe de
   ataques multi-org). Registrado: o inventário declara o modelo de
   confiança vigente no topo; hosted reabre tudo.
