# INT-0 — Escopo fechado (compliance MCP do /mcp)

> Status: **escopo p/ execução** — primeiro; destrava todos os clientes.
> Índice-pai: `README.md`.
>
> **Objetivo:** o `POST /mcp` atual (transport.ts, feito à mão) funciona,
> mas tem desvios de spec que clientes ESTRITOS (SDK oficial, inspector)
> podem rejeitar. Fechar os desvios + provar com matriz de validação
> contra clientes reais. Sem tocar na decisão arquitetural (HTTP-only,
> SSE próprio — ID6).

---

## 1. O que sai pronto no final

1. `/mcp` aceito por MCP Inspector, SDK client oficial e Claude Code.
2. Desvios de spec corrigidos ou documentados como decisão.
3. Matriz de validação versionada.

**Definição de pronto (DoD):**

- [ ] **Negociação de protocolVersion**: `initialize` hoje devolve
      `LATEST_PROTOCOL_VERSION` incondicional (transport.ts:161). Spec:
      responder a versão do CLIENTE se suportada, senão a mais recente
      suportada. Implementar eco/negociação.
- [ ] **Erros de execução de tool → `result.isError`**: hoje `callTool`
      que lança vira JSON-RPC error -32603 (transport.ts:196). Spec MCP:
      erro de PROTOCOLO é JSON-RPC error; erro de EXECUÇÃO da tool é
      `result: { content: [...], isError: true }`. Corrigir dispatch de
      `tools/call` (try/catch em volta de callTool, não do dispatch).
      Nota: muitos tools já devolvem `{ok:false, reasons}` como resultado
      normal — ESSES continuam assim (não são erro); isError é p/ throw
      (token inválido, tool desconhecida vira -32602/-32601).
- [ ] **`notifications/initialized`**: já cai no caminho de notification
      (204) — adicionar teste pinando.
- [ ] **GET /mcp → 405** (spec Streamable HTTP: server sem stream de
      server→client responde 405 Method Not Allowed ao GET). Hoje cai no
      404 genérico.
- [ ] **Header `MCP-Protocol-Version`** em respostas (spec 2025+) — eco
      da versão negociada.
- [ ] **Validação de Origin** configurável (`ALLOWED_ORIGINS` env;
      default atual `*` documentado como D2 single-org).
- [ ] **Matriz de validação** `docs/roadmap-integrations/compliance-matrix.md`:
      linhas = MCP Inspector, SDK TS `Client` + `StreamableHTTPClientTransport`,
      Claude Code (`claude mcp add --transport http`), curl cru; colunas =
      initialize, tools/list, tools/call ok, tools/call erro (isError),
      resources/read. Cada célula ✅/❌ + data + versão do cliente.
- [ ] Testes bun p/ cada item acima (protocol-compliance.test.ts).
- [ ] Suíte inteira verde.

---

## 2. O que NÃO está nesta fase

- ❌ Segundo transport (stdio no server) — ID6: proxy no INT-1.
- ❌ GET /mcp com stream SSE server→client (modo completo do Streamable
  HTTP) — a camada viva continua no `/events` próprio (decisão ADR).
  405 explícito + documentação.
- ❌ `Mcp-Session-Id` — opcional na spec; nosso estado de sessão MCP é
  stateless por design (token em args). Documentar, não implementar.
- ❌ Auth por header — Fase 4 (D10) reavalia; ID1 mantém token em args.
- ❌ resources/subscribe — fora por decisão registrada (transport.ts §doc).

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Negociação + isError + 405 + header | 1-2 dias |
| Origin configurável | 0.5 dia |
| Matriz de validação (rodar clientes reais) | 1-2 dias |
| Testes | 1 dia |
| **Total** | **3-5 dias** |

---

## 4. Riscos

1. **Cliente real exige o que decidimos não ter** (Mcp-Session-Id, GET
   stream). A matriz existe exatamente pra descobrir isso ANTES dos
   plugins; se um cliente-alvo travar, a decisão sobe pro README (ID) em
   vez de virar gambiarra local.
2. **isError muda contrato observado por consumidores atuais** (web
   client trata erro como reject do fetch JSON-RPC). Verificar mcp-web
   `api.ts` e testes ao mudar; a mudança é só p/ THROW dentro de tool —
   `{ok:false}` continua idêntico.
