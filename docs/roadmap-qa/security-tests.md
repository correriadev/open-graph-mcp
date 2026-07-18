# security-tests — inventário (QA-6)

> Modelo de confiança vigente: **D2, single-org trust** — CORS aberto por
> padrão (`*`), sem auth de transporte, um tenant = uma organização
> confiável internamente. Os testes abaixo cobrem os ataques que fazem
> sentido NESSE modelo (isolamento entre tenants, hijack de sessão,
> vazamento de evento privado, DNS-rebinding). NÃO cobrem multi-org
> hostil dentro do mesmo tenant, nem pentest externo/SAST/DAST/fuzzing —
> fora de escopo do v1 (ver `06-scope-qa-6-security.md` §2). O hosted
> (roadmap-mcp) reabre o threat model quando D2 deixar de valer.
>
> **Convenção (regra deste inventário): teste novo de segurança entra
> aqui no MESMO PR.** Inventário desatualizado é quebra de review — não
> "documentar depois".

---

## Inventário

| Arquivo | Teste | Ataque coberto |
|---|---|---|
| `test/tenant-isolation.test.ts` | `two tenants are fully isolated: events, locks, graph and history do not cross` | Vazamento de dados/eventos entre tenants — grafo, locks (mesma cell, tenants distintos, sem colisão), `graph://history` (evento de um tenant nunca aparece no replay do outro). |
| `test/affinity-router.test.ts` | `tenant isolation: sessions in another tenant never receive, even with a matching filter` | Mesmo ataque acima, na camada do roteador puro (`route()`, sem I/O) — unidade isolada da integração ponta-a-ponta acima. |
| `test/presence-ownership.test.ts` | `presence.beat/focus with someone else's sessionId is rejected and leaves the victim untouched` | Hijack de sessão via `sessionId` roubado/adivinhado — mesmo tenant (Bob) E cross-tenant (Eve, outro tenant): `presence.focus`/`presence.beat` com `sessionId` alheio é rejeitado (`"session not owned by caller"`), presença da vítima (focus/visibility/lastSeen) fica intacta, zero broadcast do ataque, `presence.who` mostra a vítima inalterada. |
| `test/lock-denied-private.test.ts` | `lock.denied reaches ONLY the attempting session — the holder and a bystander get nothing` | `lock.denied` privado nas TRÊS portas: (1) live via SSE — só quem tentou recebe, holder e bystander observando a cell não recebem nada; (2) persistência — 1 linha em `events` (auditoria), mas nunca reaparece via replay; (3) `graph://history` — vazamento zero pra QUALQUER token (attacker, holder, bystander), decisão deliberada de manter privado mesmo do próprio attacker via canal durável. |
| `test/affinity-router.test.ts` | `lock.denied: ONLY the attempting user's session(s) — never a broadcast` | Mesmo ataque acima, na camada do roteador puro — complementa a cobertura de integração de `lock-denied-private.test.ts`. |
| `test/system-message.test.ts` | `lock.denied system.message reaches only the non-web session that attempted the lock` | Mesma privacidade do `lock.denied`, no canal de texto pt-BR pra clientes não-web (`system.message`/`system.pending`) — 4ª porta além das 3 do item acima. |
| `test/authority-flip.test.ts` | `authority.flip refuses when the caller's own open changeset already locks the cell (no reuse hijack)` | Um changeset aberto não pode ser reaproveitado pra flipar autoridade de uma cell que ele já tranca por acidente/reuso — evita mutação de estado fora do escopo declarado do turno. |
| `test/authority-flip.test.ts` | `authority.flip is denied when another user holds the cell — no state change` | `authority.flip` respeita o lock pessimista — outro usuário segurando a cell bloqueia o flip, sem mutação parcial. |
| `test/protocol-compliance.test.ts` | `restrictive allowedOrigins: a request with a disallowed Origin header is rejected 403` + 5 variantes (`/mcp` e `/events`, com/sem Origin, allowlist aberta/restrita) | Guarda ativa de DNS-rebinding (spec MCP: "MUST validate the Origin header on all incoming connections") — um `fetch()` cross-origin de um browser malicioso é rejeitado 403 antes de qualquer lógica de rota, não só escondido via CORS (que só impede LEITURA da resposta, não a execução). Cobre `ALLOWED_ORIGINS` default aberto (D2) e restrito. |

**Defense in depth documentado, sem teste próprio dedicado:** session IDs
são aleatórios (`crypto.randomUUID()`, `sse.ts`) — capability opaca, não
adivinhável/sequencial. O binding sessionId→token (`presence-ownership.test.ts`
acima) é a segunda camada: mesmo um ID vazado não basta sem o token do
dono. Comentado em `sse.ts`/`presence.ts`, não extraído em teste isolado
porque a cobertura real está no teste de ownership acima.

---

## Processo: security review por release de fase

1. Antes de cada release de fase (roadmap-mcp), rodar `/security-review`
   no diff acumulado da fase.
2. Todo achado CONFIRMADO vira teste pinado (regressão) + linha nova
   nesta tabela, no MESMO PR do fix — nunca "documentar depois".
3. A Fase 3 fez isso implicitamente (os 8 testes acima nasceram de
   reviews ad-hoc); isto formaliza o ciclo pra Fase 4 em diante.

## Gate da Fase 4 (authz/roles)

Toda feature de permissão nasce com **teste negativo** pinado antes de
mergear — não é opcional, não é "adicionar depois":

- observer NÃO pode editar (changeset.open/claim/commit rejeitado).
- editor NÃO pode admin (authority.flip / operações de admin rejeitadas).
- token expirado NÃO autentica (nenhuma tool aceita).

Feature de permissão sem o teste negativo correspondente **não mergeia**.
