# Roadmap-integrations — índice

> Como usuários conectam **seus agentes de código** (Claude Code, opencode,
> Cursor, Windsurf, Copilot, Zed, Gemini CLI…) ao serviço open-graph-mcp.
> Irmão de `roadmap-mcp/` (produto) e `docs/roadmap-qa/` (qualidade).
> Baseline: pós-Fase 3.

## A tese (ler antes das fases)

O servidor expõe DUAS camadas com naturezas diferentes:

1. **Camada MCP (tools)** — `POST /mcp`, JSON-RPC: initialize, tools/list,
   tools/call, resources/list/read. **Qualquer cliente MCP genérico já
   consegue ~80% do produto hoje**: query, changeset.open/claim/commit,
   presence.who, authority.flip. Auth é `session.register` → token **em
   argumento de tool** (não header) — zero exigência especial do cliente.
2. **Camada viva (proprietária)** — SSE `/events` (eventos afinados,
   ghosts, system.message), heartbeat 15s, sessionId capability. Cliente
   MCP vanilla NÃO vê nada disso: sem beat a presença dele expira em 60s;
   sem SSE ele nunca recebe "seu changeset foi abortado por TTL".

**Consequência estratégica:** não se "porta o produto" pra cada agente —
se entrega (a) o endpoint MCP compliant pra todos de graça, e (b) um
**plugin fino por flavor** que fecha a camada viva onde a plataforma do
agente permite (Claude Code e opencode permitem muito; Cursor/Windsurf/
Copilot permitem pouco → recipe + polling).

## Documentos

| # | Arquivo | Função | Status |
|---|---|---|---|
| 0 | `00-scope-int-0-mcp-compliance.md` | `/mcp` compliant com clientes reais (matrix de validação). **Primeiro.** | implementado — 2 linhas da matriz (Inspector, Claude Code CLI) pending-manual |
| 1 | `01-scope-int-1-connection-kit.md` | Proxy stdio, recipes de config por cliente, fluxo de token, quickstart. | implementado — 5 clientes documentados, 2 verificados (Claude Code, opencode) |
| 2 | `02-scope-int-2-client-lib.md` | `@open-graph-mcp/client`: lib TS da camada viva (base de todos os plugins). | implementado — extração + connect() + fix QA-1 + polling fallback + proxy `--live`, verificado ao vivo (2026-07-16) |
| 3 | `03-scope-int-3-claude-code-plugin.md` | Plugin Claude Code: MCP + skill + hooks + statusline. Integração de referência. | proposto |
| 4 | `04-scope-int-4-opencode-plugin.md` | Plugin opencode: system messages nativos (§8 da Fase 3 realizado). | proposto |
| 5 | `05-scope-int-5-editor-agents.md` | Cursor, Windsurf, Copilot, Zed, Gemini CLI: recipes + rules + matriz de capacidades. | proposto |
| 6 | `06-scope-int-6-distribution.md` | npm, versionamento, registries MCP, docs de onboarding. | proposto |

## Decisões (ID)

- **ID1 — Token em argumento de tool, não em header.** Já é assim; MANTER
  no v1. Todo cliente MCP consegue passar argumento; nem todo consegue
  header custom. Fase 4 (tokens 90d, D10) reavalia com `Authorization`
  opcional SEM remover o caminho por argumento.
- **ID2 — Camada viva NUNCA vira requisito.** Todo fluxo tem fallback por
  polling via tools (presence.who, changeset.list_mine, graph.history).
  Plugin melhora, não habilita.
- **ID3 — Uma lib, N plugins.** A camada viva é implementada UMA vez
  (`@open-graph-mcp/client`, INT-2); plugins são adaptadores finos por
  plataforma. Proibido reimplementar SSE/beat/reattach dentro de plugin.
- **ID4 — Claude Code é a integração de referência** (plataforma mais
  rica: plugins, skills, hooks, statusline, MCP nativo). opencode em
  segundo (system messages §8 foram desenhados pra ele). Editores (5)
  recebem recipe, não plugin, até a demanda provar o contrário.
- **ID5 — agentKind é contrato**: `web`, `claude-code`, `opencode`,
  `cursor`, `windsurf`, `copilot`, `zed`, `gemini-cli`, `unknown`.
  Servidor usa p/ rotear system.message (non-web) e p/ UI; plugins DEVEM
  declarar o seu.
- **ID6 — stdio via proxy, não segundo transport no server.** Server
  permanece HTTP-only; clientes stdio-only usam o proxy do connection kit
  (INT-1). Um transport a menos pra manter.

## Sequência de execução

```
INT-0 (compliance) ──► INT-1 (connection kit) ──► INT-2 (client lib)
                                                       │
                                     ┌─────────────────┼──────────────────┐
                                     ▼                 ▼                  ▼
                          INT-3 (Claude Code)   INT-4 (opencode)   INT-5 (editores)
                                     └─────────────────┴──────────────────┘
                                                       ▼
                                              INT-6 (distribuição)
```

INT-0 e INT-1 destravam TODOS os agentes de uma vez (é o caminho "sem
plugin"). INT-3/4/5 são paralelizáveis após INT-2. INT-6 fecha.

**Checkpoint de adoção (mesmo espírito do roadmap-mcp):** INT-4 e INT-5
só ganham investimento além do recipe se houver usuário real pedindo —
o custo de manter N plugins é permanente; recipe é barato.

## Esforço estimado (1 dev, ~50% dedicação)

- INT-0: 3-5 dias
- INT-1: 1 semana
- INT-2: 1-1.5 semana
- INT-3: 1.5-2 semanas
- INT-4: 1 semana
- INT-5: 3-5 dias (recipes/matrix; sem plugin)
- INT-6: 3-5 dias
- **Total até "qualquer agente conecta + plugin de referência": ~6-8 semanas**

## Riscos transversais

1. **APIs de plugin dos editores mudam rápido** (Cursor/Windsurf/Copilot).
   Por isso ID4: recipe primeiro, plugin só com demanda.
2. **Tokens em memória (pré-D10)**: restart do server derruba todos os
   clientes conectados até re-register. INT-1 mitiga no cliente (auto
   re-register); solução real é D10 na Fase 4 do roadmap-mcp.
3. **Segurança do endpoint aberto**: CORS `*` + sem auth de transporte é
   D2 (single-org trust) — aceitável em rede confiável, INADEQUADO na
   internet pública. INT-6 documenta o deployment suportado (localhost/
   VPN/tailnet); exposição pública é tema do hosted (roadmap-mcp 05').
4. **Conhecimento de config dos clientes desatualiza** (formatos de
   mcp.json etc. mudam) — cada recipe do INT-5 carrega data de
   verificação; CI não cobre (manual por release).

## Pesquisa pré-código (INT-0/INT-1)

1. Validar `/mcp` contra MCP Inspector + Claude Code real (`claude mcp
   add --transport http`) — o dispatch atual retorna sempre
   `LATEST_PROTOCOL_VERSION` sem negociar com a versão do cliente, e
   erros de execução de tool viram JSON-RPC error em vez de
   `result.isError` (spec manda isError p/ erro de tool) — ver INT-0.
2. Confirmar formatos vigentes de config MCP por cliente (Cursor
   `.cursor/mcp.json`, Windsurf `mcp_config.json`, Copilot/VS Code,
   Zed context servers, Gemini CLI settings) — INT-5 congela a matriz
   com data.
