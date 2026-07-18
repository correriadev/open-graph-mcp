# QA-3 — Escopo fechado (integração multi-cliente)

> Status: **implementado** (2026-07-18) — 4/4 itens do DoD fechados.
> Índice-pai: `README.md`.
>
> **Objetivo:** provar que web + não-web (opencode e companhia)
> interoperam sobre o MESMO evento — hoje cada lado é testado isolado.
> O contrato §8 da Fase 3 (system messages como texto pra quem não tem
> canvas) nunca foi validado com os dois tipos de cliente simultâneos.

---

## 1. O que sai pronto no final

1. Teste server-side cross-client (bun test, sem browser).
2. Script "cliente MCP de verdade" validando o contrato §8.2 de fora.
3. Cenário TTL-abort cross-client coberto.

**Definição de pronto (DoD):**

- [x] `test/cross-client.test.ts`: sessão `agentKind:"web"` + sessão
      `agentKind:"opencode"` observando a mesma cell; um commit acontece →
      web recebe o envelope cru e NENHUM `system.message`; opencode recebe
      envelope + `system.message` com texto pt-BR correto (formato
      `[open-graph] …`). Mesma verificação p/ `changeset.opened` (já
      coberta em `system-message.test.ts`, não duplicada aqui) e
      `authority.flipped`. Achado ao escrever: `changeset.aborted` roteia
      SÓ p/ observadores do cs_id + holder — NUNCA observadores de cell
      (`affinity.ts` §6.1) — diferente de todo resto testado aqui.
- [x] Cenário "opencode perde turno por TTL enquanto web observa":
      opencode abre turno, TTL expira → opencode recebe
      `system.message` "Seu changeset … abortado por TTL"; web recebe o
      envelope `changeset.aborted` (matéria-prima do toast). Web precisa
      filtrar por `event:changeset.aborted` (não `cell:…`, ver achado
      acima) pra receber o envelope.
- [x] Script `test/mcp-client-contract.ts` (estilo presence-load: script,
      não `.test.ts`): fala o protocolo como um agente falaria —
      `initialize`/`tools/list`/`tools/call presence.who` → valida shape
      da resposta JSON (§8.2: agente formata como tabela); `graph.history
      ?since=X` → replay durável consistente (sem duplicata, sem
      reordenação, idêntico entre leituras). Roda com `bun run
      test:client-contract`, 17/17 checks verdes. Achado ao escrever:
      `presence.who` não lista uma sessão registrada via `tools/call`
      puro até ela chamar `presence.beat` pelo menos uma vez — client
      tools-only precisa mintar seu próprio `sessionId` local e se
      declarar, igual `@open-graph-mcp/client`'s modo polling já faz
      (não é bug, é o design ID2: camada viva nunca é requisito).
- [x] Sessão sem `presence.beat` (agentKind desconhecido) não recebe
      `system.message` — o gate documentado da Task 5, pinado em teste.

---

## 2. O que NÃO está nesta fase

- ❌ Cliente opencode REAL de ponta a ponta (instalar/configurar opencode)
  — o script de contrato simula o protocolo; integração com o produto
  real é validação de adoção, não teste de CI.
- ❌ Push p/ dispositivos fora de sessão (e-mail etc.) — fora do v1
  (scope Fase 3 §2).
- ❌ UI web nesta fase — coberta na QA-2; aqui é servidor + protocolo.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| cross-client.test.ts + cenário TTL | 1-2 dias |
| Script de contrato MCP | 1-2 dias |
| Gate agentKind pinado | 0.5 dia |
| **Total** | **3-5 dias** |

---

## 4. Riscos

1. **Contrato §8 muda na Fase 4** (roles → quem recebe o quê muda).
   Aceito: estes testes são exatamente o que impede a Fase 4 de quebrar
   §8 sem perceber.
2. **Texto pt-BR asserta string.** Asserção no PREFIXO `[open-graph]` +
   fragmentos load-bearing (csId, cell), não na frase inteira — texto
   pode ser lapidado sem quebrar teste.
