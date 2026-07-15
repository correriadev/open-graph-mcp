# Fase 5 — Escopo fechado (federação entre servidores)

> Status: **spec v2** — pós-Fase 4 verde. Não tem data; depende de adoção.
> ADR-pai: `docs/roadmap-mcp/ADR.md`. Anteriores: `01`–`04`.
>
> **Objetivo da Fase 5:** permitir que times distintos, cada um com seu
> servidor open-graph MCP, **referenciem conhecimento um do outro** sem
> perder soberania nem determinismo. O grafo do time B vira uma **torre
> estrangeira** read-only no servidor do time A — referenciável em claims
> locais, nunca flippável localmente.

Esta fase herda diretamente o `federation.ts` do open-graph original (Merkle
roots, manifestos assinados, locks pinned) e adapta para o mundo
cliente-servidor.

---

## 1. Por que federação (o caso de produto)

Cenário real:

- **Time A** mantém o produto "app de pagamentos". Seu grafo MCP tem cells
  em `domain=payments`.
- **Time B** mantém um serviço de "anti-fraude" consumido por A. Seu grafo
  MCP tem cells em `domain=fraud`.
- A quer escrever uma intenção no seu grafo que referencia a regra de
  scoring do time B (uma claim do B que expôs).
- Sem federação: A copia a regra (drifts), ou abre um canal Slack p/
  perguntar (manual), ou re-deriva (trabalho inútil).
- **Com federação:** A importa o manifesto v2 do B como **foreign tower**
  read-only. Suas claims locais podem referenciar a regra de scoring
  exposta do B. Quando B publica v3 (renomeou a regra), o watch do
  servidor A detecta `drift.foreign` e notifica "regra X mudou no
  manifesto B v3, 3 cells locais dependem dela".

Isto é o que o `federation.ts` do open-graph desenhava mas não tinha o
**servidor** como hospedeiro — no MCP-servidor, federação finalmente tem onde
morar.

---

## 2. O que sai pronto no final da Fase 5

1. **`graph.publish`** em um servidor A → emite manifesto assinado (Merkle
   root sobre `exposed: true` nodes) + semver version.
2. **`graph.subscribe-foreign`** no servidor B → vendors o manifesto de A
   como **foreign tower read-only** em sua memória/SQLite local. Pin do
   Merkle root em `federation.lock`.
3. **Referência cross-server em claims locais**: B pode citar
   `foreign:A:regra-scoring-v2` em refs de suas próprias claims.
4. **Drift detection federado**: quando A publica v3, o watch do B detecta
   quais foreign refs quebraram (Merkle diff) e marca as cells β dependentes
   como `suspended` (reuso do estado de Fase 2).
5. **Intent-level semver**: manifesto diff classifica mudanças
   (intent-preserved + code-changed = patch-like; intent-changed = breaking).
6. **Verificação offline**: toda verificação de refs federadas usa hashes
   do manifesto vendored; **nunca rede na gate** (INV-H4-1 herdado).

**Definição de pronto (DoD):**

- [ ] `graph.publish({ version: 'v2.0.0' })` → servidor A publica
      `manifest.json` (Merkle root + exposed entries + semver + assinatura).
- [ ] `graph.import-foreign({ manifestUrl, pinnedVersion })` → servidor B
      importa; foreign tower aparece no grafo de B; pin em
      `.graph-server/federation.lock`.
- [ ] Foreign nodes são renderizáveis no canvas de B (mas com badge
      "EXTERNAL — read-only") e referenciáveis em claims locais.
- [ ] Quando servidor B roda watch e detecta manifesto novo de A (poll
      periodic, default 1h): emiti `drift.foreign` events p/ todas cells β
      que dependem de foreign refs que mudaram.
- [ ] Intent-level semver diff: `graph.foreign-diff(prev, curr)` →
      `{ breaking_refs: [...], patch_refs: [...] }`.
- [ ] `foreign.flip` é **proibido** — tool call retorna `403` com
      `reason: "foreign_immutable"`.
- [ ] Graph-powered `graph.query` do B retorna foreign nodes marcados
      (não competing com locais; ranking local primeiro).
- [ ] Lock previne downgrade de manifesto (pinado; aborta se mismatch).

---

## 3. O que NÃO está na Fase 5

- ❌ Auto-discovery de servidores (registry, DNS, mDNS) — v2+.
- ❌ Sync bidirecional em tempo real (A↔B) — apenas pull unidirecional pelo watch
  periódico do consumidor. Push real-time entre servidores fica para Fase 5+
  se adoção pedir.
- ❌ CRDT p/ resolver conflitos entre servidores — não há conflito, por
  design: foreign towers são read-only. Consumidor não edita grafo alheio.
- ❌ Multi-tier federation chain (servidor C federation B que federates
  A) — funciona por construção da Merkle, mas nãotested explicitamente em
  Fase 5 (caixa preta).
- ❌ Auth cross-org (A precisa saber quem em B consumiu). Trust é implícita:
  manifesto é público p/ quem tem URL; assinatura opcional p/ auditoria.

---

## 4. Modelo de dados (adições SQLite)

```sql
foreign_manifests
  server_id        TEXT PRIMARY KEY    -- identidade do servidor publicador
  server_url       TEXT                -- p/ puxar novas versoes (opcional)
  pinned_version   TEXT NOT NULL       -- semver
  pinned_merkle    TEXT NOT NULL       -- hash raiz do manifesto
  pinned_at        TEXT NOT NULL       -- quando consumidor pinou
  pinned_by        TEXT REFERENCES users(id)

foreign_nodes                       -- cache dos exposed entries do manifesto
  id               TEXT NOT NULL
  server_id        TEXT NOT NULL REFERENCES foreign_manifests(server_id)
  level            TEXT
  anchor           TEXT
  token_hash       TEXT
  responsibility   TEXT
  PRIMARY KEY (id, server_id)

federation_locks                    -- o .graph-server/federation.lock em SQLite
  server_id        TEXT PRIMARY KEY REFERENCES foreign_manifests(server_id)
  pinned_merkle    TEXT NOT NULL
  locked_at        TEXT NOT NULL
```

**Princípio:** `foreign_nodes` é cache derivado do manifesto (rebuildável
passando o manifesto). `federation_locks` é pinagem explícita (mudar
requer admin + novo import) — e, como todo estado mutável, espelhado no
JSONL durável conforme a regra canônica de verdade (ADR §4.1): JSONL =
verdade última, SQLite = índice live.

---

## 5. Mecânica de publicação

### 5.1 `graph.publish`

```
admin do servidor A ──► graph.publish({ version: 'v2.0.0' })
                          │
                          ├─ coleta todos nodes com exposed=true
                          ├─ ordena por id (determinístico)
                          ├─ computa Merkle root sobre as entries
                          ├─ assina com chave privada do servidor (opcional
                          │   p/ auditoria; ver §9 D12)
                          └─ grava manifest.json em URL pública
                             (default: .graph-server/manifests/v2.0.0.json
                              servido pelo próprio server)
```

`manifesto.json` shape é exatamente o `GraphManifest` do `federation.ts`
original — nada novo:

```ts
type GraphManifest = {
  repo: string        // identidade do server
  version: string
  merkleRoot: string
  exposed: ExposedEntry[]
  signature?: string  // opcional
}
```

### 5.2 `graph.import-foreign`

```
admin do servidor B ──► graph.import-foreign({
                          manifestUrl: 'https://aSERVER/manifests/v2.json',
                          pinnedVersion: 'v2.0.0'
                        })
                          │
                          ├─ GET manifesto (HTTP)
                          ├─ recomputa Merkle root; compara com declarado
                          │  (se mismatch → abort: manifesto corrupto)
                          ├─ se anterior pin existir:
                          │  - se mesmo merkle → no-op (idempotente)
                          │  - se merkle diferente → fail por default;
                          │    admin pode --force pin update
                          ├─ grava foreign_manifests + foreign_nodes +
                          │  federation_locks
                          └─ broadcast graph.foreign_imported p/ todos
                             (affinity: cells que já tinham refs p/
                             aquele server_id)
```

### 5.3 Drift federado (poll)

Watch fiber novo no servidor (Fase 5):

- Periodicidade default 1h (configurável; ponytail: 1h é barato p/ MVP,
  se necessário 5min em prod).
- Para cada `foreign_manifests` row: HEAD request à `server_url` (ou GET
  da última versão se suportado).
- Se versão mudou: compara Merkle roots.
  - Mesma root → drift="lexical manifest" (e.g. semver bump sem conteúdo).
  - Root diferente → dif entries expostas; gerar `drift.foreign` events
    p/ todas foreign refs que quebraram (token_hash diferente); marcar
    cells β dependentes como `suspended` (herdado de Fase 2 authority state).
- Não há auto-update do pin em drift; admin do B decide re-importar
  (explicit pin).

### 5.4 Straforing: "continuar em outra sem conflito"

Aqui é onde a federação serve a sua tese original:

- Seu time A descobre que dependeu de uma regra B que mudou (manifesto B
  v3 quebrou).
- Watch do A avisa em tempo real (`drift.foreign · cell · broken_refs`).
- Time A abre cs `intent="rebase sobre regra X renomeada em B v3"` em Fase
  4 lock otimista, edits suas refs locais, commita. Outros devs do A
  recebem o commit e continuam.
- **Não há conflito de servidores.** B publica; A absorve o que quiser.

---

## 6. Intent-level semver diff

Diferenciar "breaking" (intent mudou) de "patch" (code mudou mas anchor e
responsibility iguais) é o que torna a federação útil p/ dependência
semântica, não syntax diff.

### 6.1 Regras

- Para cada exposed entry em v_prev que existe em v_new:
  - Se `responsibility` e `anchor` (ou `token_hash`) iguais → `patch`.
  - Se `responsibility` igual mas `token_hash` diferente → `patch_semantic`
    (code mudou, intent preservado; consumidor pode re-pin sem rebasa
    claims).
  - Se `responsibility` diferente → `breaking` (intent mudou; consumidor
    precisa rebasa/abort claims que dependiam).
- Entries novas em v_new → `added` (não quebra nada).
- Entries removidas v_prev → `removed` (breaking).

### 6.2 Output `graph.foreign-diff`

```ts
type ForeignDiff = {
  serverId: string
  prevVersion: string
  currVersion: string
  breaking_refs: { id, prev_resp, curr_resp }[]
  patch_semantic_refs: { id, prev_hash, curr_hash }[]
  additions: ExposedEntry[]
  removals: ExposedEntry[]
}
```

Cliente web mostra diff como changelog; AI/no agente pode usar p/ priorizar
rebase de cs.

---

## 7. Cliente web — peças UI

### 7.1 Foreign towers no canvas

- Renderizadas como torres normais, mas com:
  - Borda dashed (não solid; indica não-nativo).
  - Badge "EXTERNAL · server_id" no header da torre.
  - Cores levemente desaturadas (visualmente secundárias).
  - **Proibidos cliques de "Open Turn"** em foreign cells — botão disabled
    com tooltip "foreign tower — mutável só no servidor de origem".

### 7.2 Federation panel (sidebar)

- Lista de `foreign_manifests` com: server_id, pinned_version, pinned_at,
  drift_status (fresh/stale-checking/broken).
- Botão "Check now" p/ forçar poll imediato.
- Botão "Update pin" (admin só) p/ re-importar versão nova.
- Diff view: clique numa foreign com drift → changelog mostrando
  `breaking_refs` etc.

### 7.3 Toast em drift federado

- Se usuário tem focus em cell β que depende de foreign ref que quebrou:
  toast "manifesto X mudou e quebra 1 ref nesta cell. Rebase?"
- Click → abre "Open Turn" pré-preenchido com intent
  `"rebase sobre X v3, ref Y renamed"`.

---

## 8. Testes de aceite (Fase 5)

1. **publish-merkle.test.ts**: 5 exposed nodes → publish; manifesto tem
   merkle root; reordenar entries e publish novamente produz mesmo root
   (determinismo).
2. **import-foreign.test.ts**: servidor B importe manifesto de A;
   foreign tower aparece; foreign nodes referenciáveis em claims locais.
3. **foreign-immutable.test.ts**: attempt `foreign.flip` → 403 com
   `foreign_immutable`. Attempt `changeset.open(cells=[foreign:X:4])` →
   403 com `foreign_mutation_forbidden`.
4. **drift-detection.test.ts**: A publica v2; B importa; A publica v3
   com breaking change; watch do B detecta; cell β que depende →
   `suspended` com `cause: "foreign_drift"`.
5. **intent-diff.test.ts**: dois manifestos, v1 e v2; diff identifica
   breaking vs patch_semantic corretamente p/ fixtures com 3 mudanças mistas.
6. **pin-lock.test.ts**: re-importar manifesto A com mesmo Merkle →
   no-op; re-importar com Merkle diferente sem --force → fail; com --force
   → pin atualizado.
7. **federated-timeline.test.ts**: B consulta `graph.history`; eventos
   `drift.foreign` aparecem; `federation.imported` eventos também.
8. **referencing-foreign-in-local-claim.test.ts**: claim local em B aplica
   ref `foreign:A:regra-scoring` → válido; roundtrip scoped aceita;
   commit OK.
9. **offline-gate.test.ts**: SIMULA sem rede; gate determinístico ainda
   valida claim local que referencia foreign (usa cache local do
   manifesto); INV-H4-1 preservado.

---

## 9. Assinatura de manifestos (decisões comerciais)

**D12 (a responder com você):** assinatura obrigatória, opcional, ou não
entra em v1 da Fase 5?

- **(a) Obrigatória:** cada servidor tem chave privada; manifestos assinados;
  consumidor verify antes de importar. Forte p/ auditoria; complexo p/
  setup (gerar/distribuir chaves).
- **(b) Opcional:** server pode publicar assinado ou não; consumidor decide
  aceitar não-assinado. Flexível; mas sem garantia de identidade.
- **(c) Não em Fase 5:** só Merkle root pinado; identificação por server_id
  string. Muito fraco; trivial de spoofar DNS.

**Minha proposta D12: (b) opicional.** Single-org default não-assinado
(it's inside VPN anyway); quando cross-org real surgir, assinatura liga. UI
mostra "ASSINADO" vs "NÃO ASSINADO" badge no federation panel.

---

## 10. Esforço estimado

| Item | Estimativa |
|---|---|
| `graph.publish` + sha merkle + assinatura opcional | 2 dias |
| `graph.import-foreign` + pin + lock | 2 dias |
| Foreign nodes renderização + Canvas badge | 1-2 dias |
| Watch federado (poll + diff) | 3 dias |
| Intent-level semver diff `graph.foreign-diff` | 2 dias |
| Cliente web: foreign tower, federation panel, drift toast, diff view | 4-5 dias |
| Migration Fase 4 → 5 (novas tabelas) | 1 dia |
| Testes (9 scripts) | 3 dias |
| Docs + protocolo `manifest.json` spec externa | 1 dia |
| **Total** | **4-6 semanas** (1 dev, ~50% dedicação) |

---

## 11. Riscos e travas

1. **Server A cai / URL morre.** B não consegue puxar updates; drift não
   é detectado, mas cache local continua válido (read-only). Mitigação:
   event `federation.server_unreachable` broadcast; admin de B decide
   despinar (expurga foreign tower) ou aguardar.
2. **Manifesto malicioso.** A publica manifesto com entries inválidas
   (anchors falsos, etc.). B não consegue verificar anchors sem o repo
   real de A — confia na palavra de A. Mitigação: assinatura (D12) +
   auditoria cross-org em Fase 5+.
3. **Poll frequency DoS.** A tem 50 consumers; todo mundo polla em 1h.
   A aguenta (HTTP GET 1/small arquivo). Em adocão maior, A pode exigir
   self-rate-limit (`Retry-After` header).
4. **Referência a foreign node removido em vcurr.** Claims de B ficam
   `dangling-foreign-ref`. Mitigação: `graph.foreign-diff` lista estes;
   watch do B notifica cada célula β dependente (mesma mecânica que
   `imports-manifest.ts` faz p/ cells cross-cell no open-graph original).
5. **Merkle com colisões teóricas.** sha256 colisões é computacionalmente
   irreal; não se proteger contra isto. Princípio ponytail: não ouvir
   paranóia sem custo-benefício.
6. **Multi-hop federation (A→B→C).** B importa A; C importa B; C referencia
   nodes de A transitivamente. Por construção Merkle funciona (C só vê
   `foreign` entries de B; nodes de A não expostos por B, C não vê).
   Não testado explicitamente em Fase 5; **importante p/ Fase 6+ se adoção
   pedir topologias reais**.

---

## 12. Perguntas p/ você

1. **D12 (assinatura de manifestos)**: opcional (R), obrigatória, não entra?
2. **Poll frequency 1h default**: server-side configurável? cliente não
   override?
3. **Auto-update pin em drift detectado?** Default=NO (admin decide);
   alt=log warning + alerta. **Proposta R: NO auto-update; require admin.**

---

## 13. Resumo executivo

**Fase 5 entrega:** `graph.publish`/`import-foreign` + torres estrangeiras
read-only + drift federado via poll + diff semver intent-level +
assinatura opcional de manifestos.

**Fase 5 NÃO entrega:** auto-discovery de servidores, sync bidirecional
real-time, auth cross-org com SSO.

**Risco principal:** adesão real — federação só faz sentido quando múltiplos
times distintos usam open-graph MCP. Sem uso cruzado, é feature speculativa.
Ponytail warning: **não codar Fase 5 sem 2+ times explicitamente pedindo
federação.**