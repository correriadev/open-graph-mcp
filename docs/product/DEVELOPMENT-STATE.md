| Feature ID | Task ID | Project | Description | Domain | Current Phase | Status |
| --- | --- | --- | --- | --- | --- | --- |
| F001 | 01 | mcp-web | Specify turn-lifecycle.e2e.ts harness bootstrap and open-turn flow | ui2_turnos_e2e | - | COMPLETED |
| F001 | 02 | mcp-web | Specify turn-lifecycle three claims including ref-by-click | ui2_turnos_e2e | - | COMPLETED |
| F001 | 03 | mcp-web | Specify turn-lifecycle commit and cross-browser node visibility | ui2_turnos_e2e | - | COMPLETED |
| F001 | 04 | mcp-web | Specify lock-contention.e2e.ts deny state legibility | ui2_turnos_e2e | - | COMPLETED |
| F001 | 05 | mcp-web | Specify lock-contention live-retry on lock.released without F5 | ui2_turnos_e2e | - | COMPLETED |
| F001 | 06 | mcp-web | Specify lock-contention gate-fail preserves typed claim text | ui2_turnos_e2e | - | COMPLETED |
| F001 | 07 | mcp-web | Flip DoDs and header status in 02-scope-ui-2-turnos.md | ui2_turnos_e2e | - | COMPLETED |
| F001 | 08 | mcp-web | Validate local CI gate: tsc, bun test, build, e2e chromium | ui2_turnos_e2e | - | COMPLETED |
| F002 | 01 | mcp-web | Verify GraphNode.claims schema (gating) — id-only or full payload? | ui3_leitura_query | - | COMPLETED |
| F002 | 02 | mcp-server | Additive server PR: read-only resource graph://claims?cell= with unit test | ui3_leitura_query | - | COMPLETED |
| F002 | 03 | mcp-web | Specify ClaimsBrowser component: panel, OpenClaim, RefChip, ReferencedBy, Provenance | ui3_leitura_query | - | COMPLETED |
| F002 | 04 | mcp-web | Specify ReverseIndex domain service (client-side, O(edges), invalidation on graph.rebuilt) | ui3_leitura_query | - | COMPLETED |
| F002 | 05 | mcp-web | Specify QueryBar ⌘K with gaps as first-class results and refinement suggestions | ui3_leitura_query | - | COMPLETED |
| F002 | 06 | mcp-web | Specify History route: filters byUser/target/kind, payload click expand | ui3_leitura_query | - | COMPLETED |
| F002 | 07 | mcp-web | Specify SidebarTree: domains→levels with claimCount + lockBadge + quick filters | ui3_leitura_query | - | COMPLETED |
| F002 | 08 | mcp-web | Specify query-and-read.e2e.ts: query→gap→query ok→open claim→navigate ref→open turn | ui3_leitura_query | - | COMPLETED |
| F002 | 09 | mcp-web | Specify history.e2e.ts: filter byUser/target/kind, payload click expand | ui3_leitura_query | - | COMPLETED |
| F002 | 10 | mcp-web | Flip DoDs and header status in 03-scope-ui-3-leitura-query.md | ui3_leitura_query | - | COMPLETED |
| F002 | 11 | mcp-web | Validate local CI gate: tsc, bun test, build, e2e chromium (+ mcp-server suite) | ui3_leitura_query | - | COMPLETED |
| F003 | 01 | mcp-web | Define semantic presentation contracts and deterministic visual-state resolution | ui4_nos_ricos | - | COMPLETED |
| F003 | 02 | mcp-web | Recalibrate deterministic layout for rich cards and cell headers | ui4_nos_ricos | - | COMPLETED |
| F003 | 03 | mcp-web | Render sanitized markdown and complete rich-node metadata | ui4_nos_ricos | - | COMPLETED |
| F003 | 04 | mcp-web | Complete three semantic zoom regimes without node remounts | ui4_nos_ricos | - | COMPLETED |
| F003 | 05 | mcp-web | Promote overlays into interactive rich cell containers | ui4_nos_ricos | - | COMPLETED |
| F003 | 06 | mcp-web | Add accessible state legend and React Flow minimap | ui4_nos_ricos | - | COMPLETED |
| F003 | 07 | mcp-web | Cover semantic zoom and rich snapshot behavior end to end | ui4_nos_ricos | - | COMPLETED |
| F003 | 08 | mcp-web | Measure rich-canvas pan performance in the session regime | ui4_nos_ricos | - | COMPLETED |
| F003 | 09 | mcp-web | Close UI-4 acceptance and continuous integration gates | ui4_nos_ricos | - | COMPLETED |
| F004 | 01 | mcp-web | Create the parity manifest and evidence checklist | ui5_paridade_gate | - | BLOCKED |
| F004 | 02 | mcp-web | Add parity-manifest consistency validation | ui5_paridade_gate | - | BLOCKED |
| F004 | 03 | mcp-web | Cover activity feed and outgoing typing parity | ui5_paridade_gate | - | BLOCKED |
| F004 | 04 | mcp-web | Cover turn reattach abort and TTL extension parity | ui5_paridade_gate | - | BLOCKED |
| F004 | 05 | mcp-web | Cover authorized admin re-bootstrap parity | ui5_paridade_gate | - | BLOCKED |
| F004 | 06 | mcp-web | Run the full parity suite as a required CI gate | ui5_paridade_gate | - | BLOCKED |
| F004 | 07 | mcp-web | Prepare the bounded LAN mini-session protocol | ui5_paridade_gate | - | BLOCKED |
| F004 | 08 | mcp-web | Execute the mini-session and triage all friction | ui5_paridade_gate | - | BLOCKED |
| F004 | 09 | mcp-web | Resolve and recheck mini-session blockers | ui5_paridade_gate | - | BLOCKED |
| F004 | 10 | mcp-web | Record the owner-signed beta resumption decision | ui5_paridade_gate | - | BLOCKED |
| F005 | 01 | mcp-server | Specify bounded cursor pagination for claims and history resources | audit_pagination_claims_history | - | BLOCKED |
| F005 | 02 | mcp-server | Implement the shared server cursor contract | audit_pagination_claims_history | - | BLOCKED |
| F005 | 03 | mcp-server | Document and regress the paginated MCP resource surface | audit_pagination_claims_history | - | BLOCKED |
| F005 | 01 | mcp-web | Specify idempotent paginated client projections | audit_pagination_claims_history | - | BLOCKED |
| F005 | 02 | mcp-web | Implement cursor-aware store and resource clients | audit_pagination_claims_history | - | BLOCKED |
| F005 | 03 | mcp-web | Make reverse references incremental | audit_pagination_claims_history | - | BLOCKED |
| F005 | 04 | mcp-web | Add claims and history continuation interactions | audit_pagination_claims_history | - | BLOCKED |
| F005 | 05 | mcp-web | Prove multi-page browser behavior | audit_pagination_claims_history | - | BLOCKED |
| F006 | 01 | mcp-web | Specify the connection-scoped typing rate limiter | audit_typing_rate_limit | - | COMPLETED |
| F006 | 02 | mcp-web | Implement bounded browser typing signals | audit_typing_rate_limit | - | COMPLETED |
| F006 | 03 | mcp-web | Prove typing UX and network call bounds | audit_typing_rate_limit | - | COMPLETED |
| F006 | 01 | mcp-server | Specify indexed actor-session lifecycle behavior | audit_typing_rate_limit | - | COMPLETED |
| F006 | 02 | mcp-server | Add the ephemeral actor-session index | audit_typing_rate_limit | - | COMPLETED |
| F006 | 03 | mcp-server | Make typing touches proportional to actor sessions | audit_typing_rate_limit | - | COMPLETED |
| F006 | 04 | mcp-server | Regress presence and typing integration | audit_typing_rate_limit | - | COMPLETED |
| F007 | 01 | mcp-web | Specify bridge eligibility and artifact isolation | audit_dev_only_e2e_bridge | - | COMPLETED |
| F007 | 02 | mcp-web | Extract the development-only e2e bridge | audit_dev_only_e2e_bridge | - | COMPLETED |
| F007 | 03 | mcp-web | Add explicit instrumented build ownership | audit_dev_only_e2e_bridge | - | COMPLETED |
| F007 | 04 | mcp-web | Regress browser observability and production exclusion | audit_dev_only_e2e_bridge | - | COMPLETED |
| F008 | 01 | mcp-server | Specify tenant-scoped claim point lookup | audit_claimdraft_ref_lookup | - | FAILED |
| F008 | 02 | mcp-server | Implement bounded claims-by-ID resolution | audit_claimdraft_ref_lookup | - | FAILED |
| F008 | 03 | mcp-server | Publish and regress the claims resource contract | audit_claimdraft_ref_lookup | - | FAILED |
| F008 | 01 | mcp-web | Specify safe draft and point-navigation outcomes | audit_claimdraft_ref_lookup | - | FAILED |
| F008 | 02 | mcp-web | Normalize malformed claim drafts | audit_claimdraft_ref_lookup | - | FAILED |
| F008 | 03 | mcp-web | Replace snapshot fallback with bounded point lookup | audit_claimdraft_ref_lookup | - | FAILED |
| F008 | 04 | mcp-web | Prove uncached reference UX and request bounds | audit_claimdraft_ref_lookup | - | FAILED |
| F009 | 01 | mcp-server | Specify canonical levels and deny-by-default file projection | audit_redactfile_canonical_level | - | FAILED |
| F009 | 02 | mcp-server | Enforce canonical claim levels at every write boundary | audit_redactfile_canonical_level | - | FAILED |
| F009 | 03 | mcp-server | Make claim file projection deny by default | audit_redactfile_canonical_level | - | FAILED |
| F009 | 04 | mcp-server | Regress persistence recovery and claim resources | audit_redactfile_canonical_level | - | FAILED |
