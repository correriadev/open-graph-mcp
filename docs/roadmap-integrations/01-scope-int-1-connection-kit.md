# INT-1 — Escopo fechado (connection kit)

> Status: **implementado** (branch `int-1-connection-kit`) — 5/5 DoD
> fechados.
> Índice-pai: `README.md`.
>
> **Objetivo:** o caminho "sem plugin": QUALQUER agente MCP conecta em
> minutos. Proxy stdio p/ clientes que não falam HTTP, fluxo de token que
> não exige entender o produto, e um quickstart por cliente.

---

## 1. O que sai pronto no final

1. Pacote `@open-graph-mcp/stdio` — proxy stdio↔HTTP (estilo mcp-remote).
2. Fluxo de token utilizável por agente (register + persistência local).
3. Quickstart genérico + um snippet de config por cliente.

**Definição de pronto (DoD):**

- [x] **Proxy stdio** `packages/stdio-proxy/`: binário `bunx
      @open-graph-mcp/stdio --server http://host:8787` que fala MCP stdio
      com o cliente e repassa JSON-RPC pro `/mcp`. Sem estado próprio além
      do processo. Testes: initialize/tools/list/tools/call via stdio
      contra server real.
- [x] **Token bootstrap no proxy**: flag `--name Alice [--tenant t]` → na
      primeira chamada, o proxy chama `session.register`, persiste
      `{server, token, userId}` em `~/.open-graph-mcp/credentials.json`
      (0600) e **injeta `token` automaticamente** nos argumentos de toda
      tools/call que declare `token` no inputSchema e não o tenha recebido.
      Agente nem precisa saber que token existe.
- [x] **Auto re-register**: resposta `invalid or expired token` (restart
      do server, pré-D10) → proxy re-registra com o MESMO name/tenant,
      atualiza credentials, repete a chamada UMA vez. Log em stderr.
- [x] **Injeção de sessionId**: `presence.focus/beat` exigem sessionId da
      conexão SSE — que cliente vanilla não tem. Proxy: se INT-2 lib
      presente/embutida, mantém a sessão viva e injeta; sem SSE, essas
      tools respondem erro claro ("live layer requires companion — see
      docs") em vez de falha críptica. (A resolução completa é INT-2.)
- [x] **Quickstart** `docs/roadmap-integrations/quickstart.md`:
  - Genérico: URL do server, register, exemplo de query e de turno.
  - Por cliente (um bloco cada, com data de verificação):
    - Claude Code: `claude mcp add open-graph --transport http <url>/mcp`
      (e alternativa stdio via proxy).
    - opencode: entrada de config MCP (formato vigente).
    - Cursor: `.cursor/mcp.json` (stdio via proxy; http se suportado).
    - Windsurf: `mcp_config.json`.
    - Copilot (VS Code agent mode / CLI): formato vigente.
    - Zed: context server (stdio via proxy).
    - Gemini CLI: `settings.json` mcpServers.
- [x] Cada snippet TESTADO de verdade em pelo menos: Claude Code +
      mais um cliente disponível na máquina; os demais marcados
      "documentado, não verificado" com data (honestidade > cobertura).
      Claude Code e opencode verificados de verdade contra server local
      (2026-07-16); Cursor/Windsurf/Copilot/Zed/Gemini CLI documentados
      não-verificados com data.

---

## 2. O que NÃO está nesta fase

- ❌ Camada viva no proxy (SSE/beat contínuo) — INT-2 entrega a lib; o
  proxy ganha `--live` DEPOIS que a lib existir.
- ❌ Multi-server/multi-perfil no credentials — um server por arquivo
  basta v1 (chave por URL se precisar depois).
- ❌ OAuth/device-flow — D2 single-org; token simples.
- ❌ Publicação npm — INT-6.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Proxy stdio + testes | 2-3 dias |
| Token bootstrap + auto re-register + injeção | 1-2 dias |
| Quickstart + snippets verificados | 1-2 dias |
| **Total** | **~1 semana** |

---

## 4. Riscos

1. **Injeção automática de token surpreende** (tool chamada "funciona"
   sem o agente saber de auth). Mitigação: stderr loga cada injeção;
   quickstart explica o modelo.
2. **Formatos de config desatualizam** — cada snippet com data; revisão
   por release (risco transversal 4 do README).
3. **Retry de re-register duplica efeito?** Não: tools são idempotentes
   ou falham limpo com token novo; retry é 1x e só no erro específico de
   token.
