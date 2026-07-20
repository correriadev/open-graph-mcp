# REWORK-LOG — F001 (ui2_turnos_e2e)

## RETRY #1 — 2026-07-19

**Scores:** TL 0.88 (PASS) | Adv 0.58 (RETRY, threshold 0.70)

### From the-grumpy-tech-lead (openPoints)

1. **Port/tempdir collision surface em CI parallel workers** — fixture.ts:76 usa port:0 ephemeral; se N workers rodam em paralelo, vale a pena estratégia determinística de ports? (Não bloqueante, mapear como tech-debt.)
2. **§3.1 "nó aparece no canvas de bob" silenciosamente untestable** — current adapta pra toast+#seq. Spec deve ser emendada (004) para refletir a realidade (refs apontam pra claim-ids, não node-ids => n.claims não cresce, commit não anexa novo nó visual ao canvas)? Ou é um product gap real (cycle commit não materializa nó novo no canvas)?
3. **lock-contention test 2 pinado em "out of turn scope"** — se incrementalGate começar a validar refs (strengthening), o teste quebra. É falso negativo ou regressão real?

### From adversarial-qa (edgeCasesMissed)

#### HIGH
- **§3.3 PII non-leak** — `lock-contention.e2e.ts:64` só asserção positiva ("alice" em #denied); **falta asserção negativa**: raw userId (UUID/hash) NÃO aparece no textContent do #denied. Regressão de leak de userId passaria burrado.
- **§3.2 gate-fail via "ref inexistente"** — spec 004 manda exercitar `refs:['node-inexistente-xyz']` rejeitado pelo gate com reason mencionando o id. Implementação substituiu por branch diferente (`domain="billing"` ≠ locked `auth:P4` → "out of turn scope"), que não nomeia o id rejeitado. Cenário literal do spec não testado.

#### MEDIUM
- **§3.1 multiplayer node visibility** — `turn-lifecycle.e2e.ts:28-30,108-125` substituiu a prova visual (`.og-card[data-id=<newId>]` em bob) por toast + #seq. Spec 004 §3.1 manda asserir contagem `.og-card` incrementa OU novo `[data-id]` aparece. Não feito.
- **§3.2 recovery path** — depois do reject, alice corrige #f_refs pra id válido e re-submete; asserir #dreasons esvazia e #dlist cresce. Não implementado (test 2 termina em csIdStill).
- **§3.2 "pelo menos um item referencia o id rejeitado"** — atual: regex genérico satisfaz sem nomear o claim/rejeitado. Faltando asserir id do claim ("badcell") ou ref aparece em alguma `<li class="reason">`.
- **§3.3 malformed raw JSON** — submeter JSON inválido pelo raw-JSON escape hatch; asserir nenhum /changeset/claim dispara e form preservado. Cenário ausente.
- **§3.2 TTL-abort preserva texto não-submetido** — risk #1 do roadmap (draft local × server divergem); harness expõe `control('tick')` exatamente pra isso. Sem cobertura e2e.

#### LOW
- **#seq soft-assertion** — `not.toHaveText(bobSeqBefore)` pode passar por bump espúrio (presence/typing). Endurecer pra `>= bobSeqBefore+1` numérico.
- **DoD checkbox convention** — spec §3.4 pede `[-x]` (checkbox marcado convenção repo); atual usado `[x]`. Reconciliar.
- **refpick post-addclaim state** — conditional re-arm (`if not on, click`) papers over real state machine; asserir estado explicitamente.

### Rework action plan (atomic for Phase B retry)

A. **lock-contention.e2e.ts:**
   - Adicionar asserção negativa: `await expect(denied).not.toContainText(rawUserId)` (buscar userId rejeitado via `h.readResource('presence.who')` antes; usar `m.userId` que NÃO deve aparecer).
   - Revisar cenário gate-fail: trocar o branch "out of turn scope" pelo cenário literal do §3.2 (ref inexistente). Verificar gates.ts: se incrementalGate é advisory em claim, o reject via commit falha com commit-reasons; se ainda assim advisory, registrar adaptation honest no spec e cobrir o "claim out of turn scope" como cenário separado (não substituir o literal).
   - Adicionar recovery step: alice edita #f_refs pra id válido (pegar snapshot node id existente), re-submete, asserir `#dlist` cresce `+1` e `#dreasons` vazio.
   - Adicionar TTL-abort test (curto `presenceTtlMs` ou usar `control('tick')` se changeset TTL tem knob equivalente; se não, documentar e deixar unit-covered).
   - Endurecer asserção do id rejeitado em `#dreasons li.reason` (id "badcell" ou ref ofensor aparece no texto).

B. **turn-lifecycle.e2e.ts:**
   - Acresententar asserção visual cross-browser: depois do commit, contar `.og-card` em bob `before` vs `after`; se contagem não muda (porque refs são claim-ids), documentar como adaptation honesta E spec 004 §3.1 amended; **OU** se há caminho prod (commit com refs a claim-ids causa anexação ao `n.claims` de um nó exists), asserir aquele side-effect visível (ex. card do owner bem como `.og-card-status` mostra `claims N+1`).
   - Endurecer `#seq`: `await expect.poll(...) >= bobSeqBefore+1` numérico.
   - Eliminar conditional re-toggle de #refpick: asserir estado pós-addclaim explicitamente (permanece on ou é cleared).

C. **Spec 004-mcp-web-test-scenarios.md:**
   - Emendar §3.1 (reality: commit com refs-to-claim-ids não anexa novo nó no canvas; spec tem que nomear o side-effect visível real — toast + #seq + lock release; ou reformular para esperar "card do owner mostra `· claims N` incrementar" se aplicável).
   - Emendar §3.2 (decompor em 2 cenários: (a) ref-absente-spi → commit reject com reasons nomeando ids; (b) domain mismatch → out-of-scope reject).
   - Emendar §3.3 (adicionar PII non-leak explicit: raw userId NÃO em #denied).
   - Reconciliar convenção checkbox DoD `[-x]` (mudar 003-mcp-web-tactical-design.md §3.4 se necessário) e aplicar ao 02-scope-ui-2.

D. **02-scope-ui-2-turnos.md (se reaberto):** durante RETRY, manter status atual "concluído" se o DoD já foi flipado OU reverter para "proposto" até QA passar? Decisão: manter concluído é dishonesto. Reverter header pra "proposto (em rework)" e checkboxes pra `[ ]` até validar novamente. Isso mantém apropriadamente o gate de retomada ativo.

### Notes

- Código de produção (turn.tsx, og.ts, base-card.tsx, store.ts) permanece intocado. Adapters only em e2e e docs.
- Tudo deve continuar passando CI verde ao final do RETRY.
- Se o §3.1 continuar infeasível com refs-to-claim-ids, documentar com decisão explícita no spec (não silenciar).