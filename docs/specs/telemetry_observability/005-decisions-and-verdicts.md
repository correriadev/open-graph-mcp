# Decisions & Quality Gate Verdicts — Telemetry & Observability Subdomain

**Domain:** `telemetry_observability`  
**Project:** `open-graph-mcp`  
**Date:** 2026-08-14  

---

## 1. Initial Quality Gate Evaluation (Phase C Gate)

| Evaluator | Persona / Role | Score | Verdict | Key Findings |
|---|---|---|---|---|
| `harness-tech-lead` | Grumpy Tech Lead | `0.15` | REJECTED | O(N) memory shifting in RingBuffer, raw string PII leakage, W3C trace parent hex validation bypass, sync disk I/O. |
| `harness-qa` | Adversarial QA | `0.15` | FAILED | Circular reference stack overflow in `PIIRedactor`, compound key masking failure (`api_key`), `TypeError` on non-string trace headers. |

---

## 2. Refactoring & Resolution Matrix

| Issue ID | Severity | Root Cause | Implemented Resolution | Verification Test |
|---|---|---|---|---|
| **TECH-01 / QA-03** | CRITICAL | `Array.prototype.shift()` on 10,000 element array inside RingBuffer `push()` caused O(N) event-loop blocking. | Replaced with true O(1) circular head/tail array indexing with zero memory allocation. Added `droppedEventsCount` metrics. | `adversarial.test.ts` (10,000 req overflow benchmark) |
| **TECH-02 / QA-01** | CRITICAL | `PIIRedactor` ignored raw string payloads (`Bearer ...`, connection strings) and compound keys (`api_key`, `session_key`). | Implemented string regex pattern matchers for Bearer tokens, API keys, database connection strings, and expanded compound keys taxonomy. | `pii-redactor.test.ts` & `adversarial.test.ts` |
| **QA-02** | CRITICAL | Objects with circular references caused `RangeError: Maximum call stack size exceeded`. | Added `WeakSet` visited tracking in `PIIRedactor.redact()` returning `[CIRCULAR_REFERENCE]`. | `adversarial.test.ts` (circular ref test) |
| **TECH-03 / QA-05** | HIGH | `parseW3CTraceParent` allowed non-hex strings, all-zero invalid W3C IDs (`000000...`), and threw `TypeError` on non-string inputs. | Added strict hex regex validation (`/^[0-9a-fA-F]{32}$/`), safe type guards (`typeof header === 'string'`), parentSpanId linking, and all-zero ID rejection. | `trace-context.test.ts` & `adversarial.test.ts` |
| **TECH-04** | HIGH | `EpistemicAuditLedger` used synchronous `appendFileSync` on main event loop. | Refactored to non-blocking async `fs.promises.appendFile` with background directory creation. | `audit-ledger.ts` async refactor |

---

## 3. Final Quality Verdict & Promoted Conformance Status

- **Unit & Security Test Suite:** 10 / 10 tests passing (100% pass rate in 121ms).
- **Security Audit Status:** All 2 Critical and 4 High vulnerabilities resolved. Zero application crash risks.
- **ADR-0021 Compliance:** Full host log verification, 100% stdout isolation for stdio transport, non-blocking telemetry enqueue.
- **Final Approval Status:** **PASSED / APPROVED FOR MERGE** into `main`.
