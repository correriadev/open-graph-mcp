# QA-1 — Escopo fechado (smoke browser manual-assistido)

> Status: **escopo p/ execução** — paralelo à QA-0, imediato.
> Índice-pai: `README.md`.
>
> **Objetivo:** validar AGORA, em browser real, o que a Fase 3 entregou —
> sem esperar as 1-2 semanas da QA-2. A UI web (main.ts ~17K, render.ts
> ~13K) nunca foi renderizada por teste nenhum; o bug do `onmessage` (SSE
> que nunca disparava) provou que esse caminho não era exercitado.

---

## 1. O que sai pronto no final

1. Roteiro de smoke escrito e versionado (`smoke-checklist.md`).
2. Uma execução completa registrada (data, commit, resultado por item).
3. Bugs achados viram issues ANTES da QA-2 começar.

**Definição de pronto (DoD):**

- [ ] `docs/roadmap-qa/smoke-checklist.md` com o roteiro:
  1. `bun run dev` (server) + `bun run dev:web`; abrir 2 abas.
  2. Presence bar mostra "Conectados (2)"; dots verdes.
  3. Aba A foca cell → avatar semi-transparente aparece na aba B.
  4. Aba A abre turno → badge de lock (avatar sólido) na aba B.
  5. Aba A faz claims → indicador "digitando…" com dots animados na B.
  6. Aba A commita → toast na aba B ("A commitou cs_X em [cell]").
  7. Click no toast → canvas jump p/ a cell.
  8. Burst de eventos no mesmo cs → toast coalescido "N eventos".
  9. Aba A liga invisible mode → some da presence bar da B; sem user.focused.
  10. Matar o server → reconexão; toast "Server reiniciou"; foco redeclarado
      (verificar na B que o avatar de A voltou).
  11. Aba B para de "pingar" (throttle da aba/devtools) → 60s → some da barra da A.
  12. Tooltip hover no avatar (nome + agentKind + última atividade).
- [ ] Cada item com resultado ✅/❌ + observação, data e commit no rodapé.
- [ ] ❌s viram issues (ou fixes imediatos se triviais) antes de QA-2.

---

## 2. O que NÃO está nesta fase

- ❌ Automação — é manual-assistido (claude-in-chrome ou humano), one-shot.
  A automação é exatamente a QA-2.
- ❌ Performance/latência percebida — QA-5.
- ❌ Múltiplos usuários reais (multi-máquina) — checkpoint de adoção do
  roadmap-mcp, não deste.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Escrever roteiro | 1h |
| Executar + registrar + triagem de bugs | 2-3h |
| **Total** | **1 sessão (~meio dia)** |

---

## 4. Riscos

1. **Vira "rodou uma vez, nunca mais".** Aceito por design: a recorrência
   automatizada é a QA-2; este roteiro fica como fallback de release
   manual e documentação viva do comportamento esperado.
2. **Ambiente dev ≠ prod.** Localhost esconde latência real; smoke valida
   funcionalidade, não UX sob rede ruim (fora do v1).
