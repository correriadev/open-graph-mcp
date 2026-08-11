# Proveniência

Módulos vendorados de `open-graph` (fork opencode):

- Origem: `packages/opencode/src/graph/*.ts` + `packages/opencode/src/util/lazy.ts`
- Commit de origem: `adc6a322ec16d1e187109894ea29d15525022ae9` (branch `feat/treesitter-floor`)
- Data do vendoring: 2026-07-12
- Alterações locais: import `@/util/lazy` reescrito p/ `./util/lazy`. Nada mais.

Racional (ADR do roadmap, `docs/CHANGELOG.md` no repo de origem): o serviço
MCP "reusa conceitos do open-graph sem depender do seu runtime". O pacote
`opencode` é workspace privado de monorepo — não instalável como dependência git
limpa. Vendoring com proveniência explícita > submodule/git-dep.

Para re-sincronizar: copiar os arquivos de origem no commit desejado, reaplicar o
rewrite do import de `lazy`, atualizar este arquivo.
