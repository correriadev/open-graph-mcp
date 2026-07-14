# INT-5 — Escopo fechado (Cursor, Windsurf, Copilot, Zed, Gemini CLI)

> Status: **escopo p/ execução** — após INT-1 (recipes) / INT-2 (se live).
> Índice-pai: `README.md`.
>
> **Objetivo:** os agentes de editor têm plataforma de extensão MENOS
> permeável (sem equivalente de hooks/skills do Claude Code na camada do
> agente) — a estratégia é: **recipe de config + arquivo de rules + o
> fallback de polling da lib** (ID2), e uma matriz honesta do que cada um
> consegue. Plugin de verdade só com demanda comprovada (ID4).

---

## 1. O que sai pronto no final

1. Matriz de capacidades versionada e datada.
2. Recipe de conexão por cliente (config + rules).
3. Limitações documentadas SEM promessa falsa.

**Definição de pronto (DoD):**

- [ ] **Matriz** `capability-matrix.md` — linhas por cliente, colunas:
      transport aceito (stdio/http), tools ok, resources ok, push
      possível? (mecanismo de extensão que permita SSE→sessão), rules
      file suportado, data de verificação, versão testada.
      Preencher com verificação REAL nos clientes disponíveis; os demais
      "documentado, não verificado".
- [ ] **Recipes** (um por cliente, curtos):
  - **Cursor**: `.cursor/mcp.json` → stdio proxy (`bunx
    @open-graph-mcp/stdio --live --agent-kind cursor`); rules
    (`.cursor/rules/open-graph.mdc`) com o fluxo query→turno→commit.
  - **Windsurf**: `mcp_config.json` idem; rules no formato deles.
  - **Copilot** (VS Code agent mode + CLI): config MCP vigente;
    instructions file (`.github/copilot-instructions.md`) com o fluxo.
  - **Zed**: context server (stdio proxy); rules/AGENTS conforme suporte.
  - **Gemini CLI**: `settings.json` mcpServers; `GEMINI.md` com o fluxo.
- [ ] **Rules-base compartilhada**: UM texto canônico do fluxo de
      trabalho (deriva da skill INT-3), versionado em
      `rules-base.md`; cada recipe é wrapper de formato — mudou o fluxo,
      muda num lugar.
- [ ] **AGENTS.md**: incluir seção open-graph no formato AGENTS.md
      genérico (vários agentes leem) — cobre clientes futuros de graça.
- [ ] **Limitações declaradas** por cliente: sem push → "seu turno pode
      expirar sem aviso; o agente deve chamar changeset.extend em tarefas
      longas e checar changeset.list_mine ao retomar" (o polling da lib
      no proxy `--live` cobre presença/beat; a NOTIFICAÇÃO na conversa é
      o que esses clientes não têm como injetar).

---

## 2. O que NÃO está nesta fase

- ❌ Extensão VS Code própria (sidebar de presença etc.) — seria produto
  novo; a web UI já é o canvas rico, um link basta.
- ❌ Plugin nativo por editor — só com usuário real pedindo (checkpoint).
- ❌ Testar TODA versão de TODO cliente — matriz com data/versão e
  disciplina de revisão por release.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Matriz + verificação nos clientes disponíveis | 1-2 dias |
| Rules-base + 5 recipes + AGENTS.md | 2-3 dias |
| **Total** | **3-5 dias** |

---

## 4. Riscos

1. **Recipes apodrecem** (formato de config muda) — data em cada um;
   revisão manual por release (assumido, transversal 4).
2. **Rules ignoradas pelo agente** (compliance varia por modelo/cliente)
   — a matriz registra o observado; onde rules não pegam, o produto
   ainda funciona como MCP tools cru (ID2: nada depende da camada
   ensinada).
3. **Beat via proxy `--live` em editor que mata o processo MCP entre
   chamadas** — presença intermitente; documentado como comportamento
   esperado (mesma nota da INT-2 §4.3).
