# INT-3 — Escopo fechado (plugin Claude Code)

> Status: **escopo p/ execução** — após INT-2. Integração de referência (ID4).
> Índice-pai: `README.md`.
>
> **Objetivo:** Claude Code é a plataforma mais rica (plugins com MCP
> config + skills + hooks + statusline + comandos) — o plugin aqui define
> o TETO da experiência: o agente CONSULTA o grafo antes de codar, ABRE
> turno antes de mexer em cell alheia, e o humano VÊ presença sem sair do
> terminal.

---

## 1. O que sai pronto no final

Um plugin instalável (`/plugin install open-graph`) contendo:

1. Config MCP embutida (servidor + proxy/token automáticos).
2. Skill ensinando o fluxo de trabalho com o grafo.
3. Hooks: contexto na sessão, presença viva, aviso de lock.
4. Statusline com presença.
5. Comandos utilitários.

**Definição de pronto (DoD):**

- [x] **Estrutura de plugin** (marketplace local ou repo git):
      `.claude-plugin/` com MCP server config apontando pro connection
      kit (`bunx @open-graph-mcp/stdio --live --agent-kind claude-code`),
      de modo que instalar o plugin = tools disponíveis, token e beat
      resolvidos sem passo manual (só `--server` na primeira vez ou env).
- [x] **Skill `using-open-graph`** (a peça mais importante): ensina o
      agente QUANDO e COMO usar as tools —
      - antes de implementar: `graph.query` pelos termos da tarefa;
        tratar `gaps` como sinal de conhecimento faltante;
      - antes de editar área coberta por cell de outro: `presence.who
        {cell}` + `changeset.open` (turno); claim.add durante; commit no
        fim; abort se desistir;
      - `authority.flip` só com decisão humana explícita (princípio 6 do
        open-graph: humano nos pontos irreversíveis);
      - o que fazer ao receber `lock.denied` (esperar/negociar/focar
        outra cell — NUNCA martelar retry).
- [x] **Hook SessionStart**: injeta contexto curto — "grafo X conectado,
      N cells, você é <name>, M usuários presentes" + changesets abertos
      do usuário (`changeset.list_mine`) p/ retomar turno esquecido.
- [x] **Hook de system messages**: eventos relevantes (via lib INT-2,
      `agentKind: claude-code` já recebe `system.message` do server §8)
      viram mensagens visíveis na sessão — no mínimo os prioritários:
      seu cs abortado por TTL, lock.denied, authority.flipped. Mecanismo
      real implementado (diferente do previsto): o processo `--live`
      nunca chamava `og.systemMessages()` e o server nunca persistia
      `system.message` (sempre `ephemeral: true`, fora do `since` de
      replay) — não havia nada pra um processo separado drenar. Fix do
      lado servidor: tool nova `system.pending { token }` +
      tabela-índice-vivo `system_messages` (mesma classe de `locks`, não
      espelhada em JSONL). Hook `UserPromptSubmit` (não `PreToolUse` —
      evita poluir a cada Edit/Write, ver Riscos #2) drena uma vez por
      turno humano, mesmo padrão stateless-curl dos outros dois hooks.
      Ver commit `dd1616b`.
- [x] **Hook PreToolUse (Edit/Write) — advisory**: se o arquivo editado
      mapeia pra cell com lock de OUTRO usuário, avisar (não bloquear —
      D2 trust; bloqueio é decisão da Fase 4/authz). Mapeamento
      arquivo→cell via graph.query por path; se o grafo não mapeia,
      silêncio (zero falso alarme).
- [ ] **Statusline** (opcional ligável): `og: 3 online · turno cs_ab12
      (auth:P4)` — lê do estado do proxy.
- [x] **Comandos**: `/open-graph:who`, `/open-graph:turno <cells> <intent>`,
      `/open-graph:commit`, `/open-graph:abort` — atalhos humanos pros
      tools (o agente usa tools direto; comandos são pro HUMANO no loop).
      Correção empírica ao escopo: plugin commands são namespaced pelo
      NOME DO PLUGIN (`open-graph/skills|commands`), não por um prefixo
      arbitrário — `/og:*` não é alcançável sem renomear o plugin
      inteiro pra "og" (colidiria com `/plugin install open-graph`, já
      fixado). Confirmado empiricamente via
      `claude --plugin-dir packages/claude-plugin -p "..."` listando os
      4 comandos com o namespace real. `disable-model-invocation: true`
      em todos (só o humano invoca, spec §3 do escopo).
- [ ] **Validação real**: sessão de Claude Code com o plugin, executando
      o fluxo completo contra server real, com um segundo usuário na web
      UI vendo presença/turno do agente. Roteiro + resultado registrados
      (formato smoke-checklist da QA-1).

---

## 2. O que NÃO está nesta fase

- ❌ Bloqueio hard de edição em cell locked — Fase 4 (authz); v1 avisa.
- ❌ Auto-turno (abrir changeset sem o agente decidir) — o fluxo é
  ensinado pela skill, não imposto por hook; magia demais esconde o
  modelo mental do produto.
- ❌ Sync de todo o contexto do grafo pra sessão — query sob demanda;
  contexto de sessão só o resumo do SessionStart.
- ❌ Suporte a versões antigas do Claude Code — vigente na data.

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| Estrutura plugin + MCP wiring | 1-2 dias |
| Skill (escrever + iterar com uso real) | 2-3 dias |
| Hooks (SessionStart, system msgs, PreToolUse advisory) | 3-4 dias |
| Statusline + comandos | 1-2 dias |
| Validação de referência | 1 dia |
| **Total** | **1.5-2 semanas** |

---

## 4. Riscos

1. **Skill não "pega"** (agente ignora o fluxo). Mitigação: validação de
   referência mede isso de verdade; iterar descrição/gatilhos da skill é
   parte do escopo, não afterthought.
2. **Hook de system message vira spam de contexto.** Mitigação: drenar
   coalescido (mesma regra de coalescência dos toasts) + só kinds
   prioritários; medir tokens injetados na validação.
3. **Mapeamento arquivo→cell é heurístico** (grafo skeleton mapeia por
   domínio/level, não por arquivo exato). Aceito: advisory com baixa
   confiança fica calado (regra explícita no hook).
