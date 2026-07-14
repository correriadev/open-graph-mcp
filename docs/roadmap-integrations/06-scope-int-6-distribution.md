# INT-6 — Escopo fechado (distribuição)

> Status: **escopo p/ execução** — fecha o roadmap; após INT-1..5.
> Índice-pai: `README.md`.
>
> **Objetivo:** o que existe passa a ser instalável por estranhos:
> pacotes publicados, versionamento, listagem em registries MCP, e docs
> de onboarding que não assumem contexto interno.

---

## 1. O que sai pronto no final

1. Pacotes publicados no npm.
2. Versionamento e release process definidos.
3. Listagem nos diretórios/registries MCP.
4. Onboarding público.

**Definição de pronto (DoD):**

- [ ] **npm**: publicar `@open-graph-mcp/stdio` (INT-1) e
      `@open-graph-mcp/client` (INT-2). Escopo npm reservado; `bunx
      @open-graph-mcp/stdio` funciona de máquina limpa (teste real em
      container).
- [ ] **Server distribuível**: decisão registrada de COMO se roda o
      server fora do monorepo — v1: `bunx @open-graph-mcp/server` (publicar
      packages/mcp-server com bin) OU git clone documentado; escolher na
      execução pelo que o bundling do Bun permitir com menos gambiarra
      (graph-core vendorado pesa; medir).
- [ ] **Versionamento**: semver por pacote, `CHANGELOG.md` por pacote,
      tag de release no monorepo. Compatibilidade declarada:
      cliente/proxy ↔ versão do server (campo `serverInfo.version` do
      initialize já existe — proxy loga mismatch maior).
- [ ] **Registries MCP**: submeter aos diretórios vigentes (registry
      oficial MCP + listas de servers usadas pelos clientes-alvo) —
      inventariar na execução quais existem/importam, registrar no doc.
- [ ] **Onboarding público**: README raiz reescrito p/ estranho: o que é,
      quickstart (INT-1) linkado, matriz (INT-5) linkada, seção de
      deployment suportado — **explícito: single-org/rede confiável
      (localhost/VPN/tailnet); NÃO exponha na internet pública** (D2;
      hosted é roadmap-mcp 05').
- [ ] **Plugin Claude Code instalável** de fora: marketplace entry (repo
      git próprio ou diretório no monorepo com instrução `/plugin
      marketplace add`).
- [ ] CI: job de release (publish por tag) — manual-approve, sem
      auto-publish em merge.

---

## 2. O que NÃO está nesta fase

- ❌ Hosted/SaaS, billing, multi-org — roadmap-mcp 05'.
- ❌ Docs site dedicado — README + docs/ bastam até tração.
- ❌ Telemetria de uso — decisão de produto fora deste roadmap.
- ❌ Suporte a instalação sem Bun (Node-only do server) — server é Bun
  (bun:sqlite); só a client lib promete Node (INT-2).

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| npm publish + máquina limpa | 1-2 dias |
| Versionamento + release job | 1 dia |
| Registries + onboarding README | 1-2 dias |
| **Total** | **3-5 dias** |

---

## 4. Riscos

1. **Publicar cristaliza contratos** (tool names, envelope, credentials
   file) — a partir do primeiro publish, breaking change vira major +
   migração documentada. É o preço; por isso INT-6 é o ÚLTIMO.
2. **Server no npm com graph-core vendorado** pode ser pesado/frágil —
   plano B explícito no DoD (git clone documentado é aceitável v1).
3. **Usuário expõe o server na internet** apesar do aviso — mitigação
   possível barata: bind default em 127.0.0.1 salvo `HOST` explícito
   (decidir na execução; hoje Bun.serve default binda em todas as
   interfaces).
