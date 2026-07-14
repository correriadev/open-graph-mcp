# INT-4 — Escopo fechado (plugin opencode)

> Status: **escopo p/ execução** — após INT-2; paralelizável com INT-3.
> Gate: 1+ usuário real de opencode pedindo (checkpoint do README).
> Índice-pai: `README.md`.
>
> **Objetivo:** o cliente não-web PROTOTÍPICO do produto — a Fase 3 §8
> (system messages) foi desenhada literalmente "pro opencode e
> companhia". Este plugin realiza aquele contrato: presença e
> notificações como texto na sessão do agente.

---

## 1. O que sai pronto no final

1. Plugin opencode (formato de plugin TS vigente do opencode) embarcando
   a lib INT-2 com `agentKind: "opencode"`.
2. System messages do server aparecendo na sessão do usuário.
3. Fluxo de turno utilizável pelo agente do opencode.

**Definição de pronto (DoD):**

- [ ] **Pesquisa congelada** (1 dia, ANTES de codar): API de plugin do
      opencode vigente — como registrar MCP server, como injetar
      mensagem na sessão, ciclo de vida do processo. Registrar achados
      no topo deste doc com data (mesma disciplina da matriz INT-5).
- [ ] Plugin registra o MCP server (direto HTTP se o opencode falar, ou
      via proxy INT-1) e sobe a lib `--live` com `agentKind: opencode`.
- [ ] **System messages → sessão**: `og.systemMessages(handler)` da lib →
      mecanismo de mensagem do opencode. Formato §8.1 já vem pronto do
      server (`[open-graph] …`); o plugin só entrega, não reescreve.
      Coalescer rajadas (mesma regra 500ms).
- [ ] **Presença**: beat automático enquanto a sessão do opencode vive;
      focus derivado do que o usuário/agente está mexendo se a API der
      esse sinal — senão, focus manual via comando.
- [ ] **Instrução ao agente** (equivalente da skill INT-3 no formato que
      o opencode usa — AGENTS.md/rules): mesmo fluxo query→turno→commit,
      mesmo texto-base, adaptado.
- [ ] **Validação real**: sessão opencode + web UI lado a lado; TTL-abort
      de um turno do opencode aparece como texto na sessão (o cenário
      canônico do §8) e como toast na web.

---

## 2. O que NÃO está nesta fase

- ❌ UI própria (canvas/TUI de presença) — §8.2: presença p/ não-web é
  lookup textual (`presence.who` → tabela markdown pelo agente), decisão
  assumida da Fase 3.
- ❌ Reimplementar SSE/beat no plugin — ID3: usa a lib.
- ❌ Fork/patch do opencode — só API pública de plugin; se a API não der
  p/ injetar mensagem, registrar limitação e cair pro polling visível
  por comando (ID2).

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Pesquisa API plugin opencode | 1 dia |
| Plugin (MCP + lib + mensagens) | 2-3 dias |
| Instrução/rules + validação real | 1-2 dias |
| **Total** | **~1 semana** |

---

## 4. Riscos

1. **API de plugin do opencode muda/é limitada.** Por isso a pesquisa é
   item 1 com resultado registrado; plano B explícito (polling por
   comando) já definido — sem descoberta no meio do código.
2. **Duplicação de mensagem** (system message via plugin + agente também
   lê presence.who) — plugin é a fonte de push; skill/rules instruem o
   agente a NÃO pollar o que já chega empurrado.
