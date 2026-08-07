# SB-0 — Escopo fechado (hardening do servidor: testar tudo e corrigir)

> Status: **em execução** (2026-08-06). Índice-pai: `README.md`.
>
> **Objetivo:** exercitar TODA a superfície funcional do `mcp-server` —
> feliz, negativa e de autorização — e corrigir o que a bateria revelar.
> `packages/mcp-web` está **fora de escopo por decisão do dono**.

---

## 0. Por que este escopo existe

Duas varreduras do código (superfície + cobertura) compararam as 18 tools, os
7 recursos `graph://`, o SSE, o sweeper, os gates e a camada de durabilidade
contra os 158 testes do pacote. A cobertura é boa em algumas áreas — claims,
gates, protocolo, isolamento multi-tenant — e **inexistente em outras que
machucam um usuário de beta**:

- `changeset.extend` **não tem um único teste**, e nenhuma menção em nenhum
  arquivo. É uma tool declarada e publicada.
- `changeset.abort` **nunca é invocada** por teste algum; só o abort
  implícito do sweeper é coberto.
- `graph://cell/{k}` e `graph://domain/{d}` só rodam dentro de
  `describe.skipIf(!targetRepoAvailable())` — ou seja, **no CI não rodam
  nunca**.
- `graph://changesets` tem zero testes.
- Nenhum dos quatro `"not the holder of this changeset"` (claim, commit,
  abort, extend) é exercido.
- Todo teste de SSE abre em `since=0`; o caminho de replay com cursor — que
  re-aplica afinidade para um `lock.denied` histórico não vazar num
  reconnect — nunca rodou com N≠0.

Não se estabiliza o que não se mede. Este escopo mede.

---

## 1. O que sai pronto no final

**Definição de pronto (DoD):**

- [ ] Toda tool (18) com ao menos um teste de caminho feliz **e** um
      negativo/autorização.
- [ ] Todo recurso `graph://` (7) exercitado no CI, **sem depender de repo
      externo** na máquina.
- [ ] Os quatro `"not the holder of this changeset"` afirmados.
- [ ] Zero `setTimeout` como mecanismo de sincronização em
      `packages/mcp-server/test/`.
- [ ] A questão do `makeReadFile`/`repoPath` respondida em definitivo —
      corrigida ou documentada como intencional.
- [ ] Gate de flake: suíte inteira 10× seguidas, zero falhas.
- [ ] Lista escrita de achados Tier 2/Tier 3 que o dono aceitou
      explicitamente como known-issues do beta.

---

## 2. O que NÃO está neste escopo

- ❌ `packages/mcp-web` e seus e2e. As 3 falhas de parity pré-existentes
      (`history`, `lock-contention`, `typing-indicator`) são de UI, foram
      confirmadas anteriores a qualquer mudança desta campanha, e ficam.
      O único contrato: **o número não pode crescer.**
- ❌ D10 (tokens 90d), F005 (paginação), F008/F009 (FAILED de 2026-07-21).
      São escopos próprios do `README.md` desta pasta. A campanha só os
      documenta se um teste esbarrar neles.
- ❌ Telemetria, performance e carga — `roadmap-qa/05` já cobre.

---

## 3. Regra de paralelismo (SB2)

Cada workstream é **dono exclusivo** dos seus arquivos-fonte. Test files são
sempre novos, com nome pré-atribuído, então não colidem.

**CONGELADOS para todos os streams:** `src/state.ts`, `src/claim-level.ts`,
`test/helpers.ts`. São hubs que todo stream ia querer tocar; quem precisar,
para e escala, e o integrador aplica serialmente.

**Nenhum agent executa git.** Seis processos commitando no mesmo worktree
disputam `.git/index.lock`. Agents editam e rodam testes; o integrador
commita por stream no fim.

**Helper novo** → definir local, no topo do próprio arquivo de teste. O
integrador deduplica para `test/helpers.ts` na Fase 3.

### Mapa de posse

| WS | Arquivos-fonte (`packages/mcp-server/src/`) | Novos testes |
|---|---|---|
| **A** ciclo changeset + TTL | `tools/changeset.ts`, `sweeper.ts` | `changeset-extend`, `changeset-abort-tool`, `changeset-authz`, `changeset-closed-state`, `sweeper-resilience` |
| **B** recursos de leitura | `resources.ts` | `resources-cell-domain`, `resources-changesets`, `resources-claims-paging` |
| **C** SSE + subscribe | `sse.ts`, `affinity.ts`, `tools/graph-subscribe.ts`, **+ `packages/client/src/connect.ts`** | `sse-since-replay`, `subscribe-authz`, `subscribe-effect` |
| **D** auth + transporte + boot | `transport.ts`, `tools/session.ts`, `index.ts`, `system-message.ts` | `session-register-negative`, `system-pending-scoping`, `resource-read-auth`, `boot-env-validation` |
| **E** query + presença + flake | `tools/graph-query.ts`, `tools/presence.ts`, `tools/typing.ts` | `query-args`, `presence-who-filters` (+ refatora os testes com sleep) |
| **F** durabilidade + gates | `store.ts`, `gates.ts`, `db.ts`, `tools/graph-bootstrap.ts`, `tools/authority.ts`, `watch-bridge.ts` | `anchor-repo-path`, `rebuild-from-disk-fixture`, `watch-tenant-attribution` |

Contenções conhecidas, decididas de antemão:

- `resources/read` trata token em `transport.ts` (**D**), resolve em
  `resources.ts` (**B**). B afirma comportamento do resolver; qualquer
  correção em `tenantOf` é de D.
- `store.ts::makeReadFile` é de **F**, mas é chamado de `changeset.ts`
  (**A**). A escreve o teste se o sintoma for em claim/commit; o fix é de F.
- `sse.ts` (**C**) chama `presenceSessionClosed` de `presence.ts` (**E**). C
  testa o caminho de cancel; fix dentro de `presence.ts` é de E.

---

## 4. Política de tiers (SB3)

Mecânica de propósito — o agent não delibera.

- **Tier 1 — corrigir agora.** As três condições valem: (a) o defeito está
  em arquivo do próprio stream; (b) o fix não muda `inputSchema`, URI de
  recurso, `kind` de evento nem shape que teste existente já afirma; (c)
  nenhum outro pacote precisa mudar.
- **Tier 2 — escrever o teste, marcar `test.todo`, reportar.** O fix mudaria
  contrato, ou mora em arquivo alheio/congelado. Teste afirma o
  comportamento **desejado**, nome prefixado `REPORT-<WS><n>:`. Nunca
  `test.skip` com corpo que apodrece em silêncio.
- **Tier 3 — parar e escalar.** Semântica de autenticação/autorização,
  `durableTransaction`, ou arquivo congelado.

### Pré-classificados (ninguém re-litiga)

| Achado | Tier |
|---|---|
| `store.ts::makeReadFile` lê `state.repoPath`, não o `tenants.repo_path` do tenant | **1 (F)** — maior valor da campanha |
| `?since=abc` → `NaN` → backlog vazio silencioso | **1 (C)** — rejeitar; perda silenciosa é pior que erro alto |
| `PORT` sem validação → `NaN` | **1 (D)** — só no bloco `import.meta.main` |
| `graph.subscribe` sem token | **correção coordenada autorizada** — ver §5 |
| `sse.tenantOf` degrada token desconhecido para `default` | **3** — colide com o caminho `restartPending`, que é deliberado |
| `system.pending` lê-e-deleta sem transação | **3** (D reporta) |
| `state.lastTickHadEvents` global vs `tick` por tenant | **2 (F)** — campo mora em arquivo congelado |
| `resources.cellState` lê authority do grafo quente; `store.authorityOf` lê SQLite | B escreve o teste de divergência; se reproduzir e o fix couber em `resources.ts`, **1 (B)**; se o fix certo for no commit, **2**, entregue a A |

---

## 5. A correção coordenada do `graph.subscribe` (SB5)

Hoje `subscribe(state, sessionId, filters)` **não recebe token**: quem obtiver
um `sessionId` reescreve os filtros SSE de outra sessão — e portanto o que
aquela sessão recebe. `presence.ts` protege o caminho análogo com binding
sessionId→token e uma regex de formato; subscribe tem a regex e a checagem de
sessão viva, mas não o binding.

Sequência obrigatória, **sem breaking change**:

1. **Servidor** — `token` vira **opcional** no `inputSchema`. Presente:
   valida o binding sessionId→token com a mesma vara de medir do
   `presence.ts` `touch()`. Ausente: comportamento atual preservado.
2. **Cliente** — `packages/client/src/connect.ts` passa a mandar o token que
   já tem em mãos.
3. **NÃO** tornar obrigatório nesta campanha. Isso é decisão do dono depois
   que ficar claro que ninguém chama sem token.

**C escreve primeiro o teste de ataque que prova o sequestro.** Se não
reproduzir, para e reporta — não se corrige o que não se demonstrou.

---

## 6. Restrições de teste (valem para todos)

- Nunca `setTimeout`/sleep para sincronizar. Usar os knobs determinísticos:
  `s.tick()`, `s.sweep()`, `s.flush()`, `s.sweepPresenceNow()`,
  `s.tickTypingNow()`, e `SseClient.waitFor(pred)`.
- **Asserção negativa se prova por evento sentinela**, nunca por tempo
  decorrido: emita um evento posterior conhecido e espere por ele — quando
  o sentinela chega, a ausência do evento suprimido está provada.
- Todo teste: `port: 0`, `stateDir` fresco (`mkdtempSync`), e `stop()` em
  `finally`.
- Reusar os helpers de `test/helpers.ts`: `tempRepo`, `rpc`, `callTool`,
  `readResource`, `register`, `bootstrapAs`, `rebuildAs`, `openSse`.
  Lembrar que `rpc` **lança** tanto em `body.error` quanto em
  `result.isError === true`.

---

## 7. Ordem de valor

1. **A** — trabalho perdido: turno travado, commit duplo, claim admitido em
   changeset já abortado por TTL, `extend` que não salva o turno.
2. **F** — integridade: no caminho de produção `repoPath` nunca é setado,
   então a checagem de anchor/`verifyIntegrity` ou é no-op (o gate admite o
   que devia recusar) ou recusa indevidamente. Os dois modos são fatais e
   invisíveis de fora.
3. **D** — autorização: Bob drena o `system.pending` da Alice? Cross-tenant?
   `resources/read` com token forjado?
4. **C** — eventos perdidos: todo reconnect em produção é `since=N`.
5. **E** — confiabilidade do próprio gate: asserções negativas por
   `setTimeout` tornam o sinal do beta não confiável.
6. **B** — completude: recursos dark são read-only; bug ali é visível e
   recuperável.

---

## 8. Execução

**Fase 0 (integrador, serial).** Baseline `bun test` no root; árvore limpa;
registrar as 3 falhas de parity pré-existentes.

**Fase 1 (6 agents, paralelo).** Cada um com sua linha de posse, os tiers, os
knobs e as restrições rígidas do §6. Sem git.

**Fase 2 (integrador, serial).** Revisar cada diff **contra a posse
declarada**; commitar por stream na ordem A → F → D → C → B → E, rodando a
suíte após cada commit para saber qual stream quebrou o quê.

**Fase 3 (integrador, serial).** Adjudicar Tier 3 com o dono; deduplicar
helpers; gate de flake 10×.

---

## 9. Verificação

```bash
bun test                                             # root: 370 atuais + novos
bun run --cwd packages/mcp-server test                # 158 atuais + novos
bun run --cwd packages/client build
node --test packages/client/test/*.test.ts            # 65 verdes
cd packages/mcp-web && bunx tsc --noEmit && bun run build   # client não quebrou o consumidor
bun run --cwd packages/mcp-web test:parity            # exatamente 3 falhas, nem uma a mais
```

Gate de flake: `for i in $(seq 10); do bun test || break; done`.

Manual, ponta a ponta: subir o servidor, `graph.bootstrap` contra um repo
real, e reproduzir o cenário cliente-retry-após-TTL (abrir turno, deixar o
TTL expirar, tentar commit) confirmando recusa limpa.

---

## 10. Esforço estimado

| Item | Estimativa |
|---|---|
| Fase 1 (6 streams em paralelo) | 1 sessão |
| Fase 2 (revisão + integração serial) | 0.5 sessão |
| Fase 3 (Tier 3 + dedup + flake gate) | 0.5 sessão |
