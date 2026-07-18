# BT-1 — Escopo fechado (pipeline do artefato)

> Status: **proposto** — paraleliza com BT-0; trava só no item de
> pesquisa pré-código #2 do `README.md`. Índice-pai: `README.md`.
>
> **Objetivo:** hoje instalar = clonar o monorepo. Participante da
> sessão precisa de UM download + UM comando. Este escopo cria o job de
> release no GitHub Actions que empacota o que o participante instala
> (BD4), reaproveitando o CI existente (QA-0) como gate.

---

## 1. O que sai pronto no final

1. Job `release` em `.github/workflows/release.yml`: disparo manual
   (`workflow_dispatch`) + por tag `beta-v*`; **depende do job `test`
   verde** (mesmo commit); publica GitHub Release com os assets.
2. Assets do Release:
   - `open-graph-proxy-<ver>.tar.gz` — proxy stdio empacotado com
     `bun build --compile` se viável, senão tarball de fontes + script
     `setup.sh` que roda `bun install` local;
   - `open-graph-plugin-<ver>.tar.gz` — `packages/claude-plugin` pronto
     pra `/plugin marketplace add <dir>`;
   - `INSTALL.md` — instruções por cliente (web UI = só o link; Claude
     Code = plugin; outros = recipe do quickstart apontando pro proxy
     baixado), escrito pra estranho, EN.
3. Versionamento do beta: tag `beta-vN` por sessão; o Release nota qual
   versão do server estava congelada (BD6) — mismatch cliente/server
   diagnosticável.

**Definição de pronto (DoD):**

- [ ] **`release.yml`** versionado; `workflow_dispatch` roda ponta a
      ponta no GitHub real e o Release aparece com os 3 assets.
- [ ] **Gate herdado**: o job falha se `test` do CI (QA-0) não passou no
      commit taggeado — provado com um dispatch sobre commit quebrado
      (pode ser na branch de teste do PR de quebra proposital do QA-0).
- [ ] **Máquina limpa**: numa máquina/container SEM o monorepo, com só
      Bun instalado: baixar assets do Release → seguir `INSTALL.md` →
      proxy conecta num server de teste e completa register + query.
      Tempo cronometrado e registrado (<15 min é a meta do
      `beta-plan.md`).
- [ ] **Download por collaborator confirmado** (pesquisa #2 do README):
      um participante-cobaia (conta GitHub convidada, read) baixa o
      asset do repo privado sem ajuda — registrar COMO (browser
      logado / `gh release download` / outro).
- [ ] **Validação real**: checklist acima com datas no próprio doc; o
      Release da sessão real referencia este DoD.

---

## 2. O que NÃO está nesta fase

- ❌ npm publish / registries MCP — INT-6 (roadmap-integrations); BD4
  reabre se INT-6 mínimo sair antes da sessão.
- ❌ Auto-release em merge — release é manual-approve por design (mesmo
  espírito do INT-6 DoD de CI).
- ❌ Instalador sem Bun (binário Node/standalone garantido) —
  `bun build --compile` é tentativa, não promessa; fallback é tarball +
  Bun instalado pelo participante (INSTALL.md cobre).
- ❌ Assinatura/notarização de binário — beta com convidados; fora até
  distribuição pública (INT-6).

---

## 3. Esforço estimado

| Item | Estimativa |
|---|---|
| `release.yml` + empacotamento dos 3 assets | 1 dia |
| `INSTALL.md` pra estranho + teste máquina limpa | 0.5-1 dia |
| Teste de download por collaborator + ajustes | 0.5-1 dia |
| **Total** | **2-3 dias** |

---

## 4. Riscos

1. **`bun build --compile` engasga com o workspace** (graph-core
   vendorado, deps nativas). Mitigação: já previsto fallback tarball +
   `setup.sh`; decidir pelo que funcionar primeiro, não insistir
   (mesma lógica do INT-6 "medir na execução").
2. **Asset de Release em repo privado atrita mais que o esperado**
   (auth no download). Mitigação: DoD testa com cobaia real; se
   atritar, alternativa barata é anexar o tarball direto no canal
   privado do grupo pra ESTA sessão e registrar a fricção como input do
   INT-6.
3. **INSTALL.md envelhece a cada mudança de cliente.** Aceito: vale por
   sessão (tag), revalidado no dry-run (BT-5); manutenção contínua é
   INT-5/INT-6.
