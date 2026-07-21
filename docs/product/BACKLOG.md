| ID | Title | Domain | Priority | Dependencies | Reworks | Score (TL) | Score (Adv) | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F001 | UI-2 closure — turn-lifecycle + lock-contention e2e + DoD flip | ui2_turnos_e2e | 1 | — | 1 | 0.90 | 0.84 | COMPLETED |
| F002 | UI-3 — leitura/query: claims browser, graph.query c/ gaps, history, sidebar | ui3_leitura_query | 2 | F001 | 2 | 0.79 | 0.88 | COMPLETED |
| F003 | UI-4 — nós ricos + zoom semântico + cell containers + minimapa | ui4_nos_ricos | 3 | F002 | 1 | 0.76 | 0.91 | COMPLETED |
| F004 | UI-5 — paridade e2e + mini-sessão + gate de retomada do beta | ui5_paridade_gate | 4 | F003 | 2 | - | - | BLOCKED |
| F005 | Claims/History pagination — cursor `since=<seq>&limit` para evitar OOM em tenant grande | audit_pagination_claims_history | 5 | F002 | 2 | 0.67 | 0.80 | BLOCKED |
| F006 | Presence.typing rate-limit (debounce client-side + índice por userId no server) | audit_typing_rate_limit | 6 | F002 | 1 | 0.88 | 0.92 | COMPLETED |
| F007 | DEV-only e2e instrumentation bridge (remove `window.__og_e2e` de prod) | audit_dev_only_e2e_bridge | 7 | F002 | 0 | 0.84 | 0.93 | COMPLETED |
| F008 | claimDraft JSON guard + `graph://claims?id=<ref>` lookup pontual para dangling refs | audit_claimdraft_ref_lookup | 8 | F002 | 2 | 0.93 | 0.67 | FAILED |
| F009 | redactFile deny-by-default + validação de write de level canônico | audit_redactfile_canonical_level | 9 | F002 | 2 | 0.94 | 0.66 | FAILED |
