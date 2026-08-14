# Problem Space — Telemetry & Observability Subdomain

**Domain:** `telemetry_observability`  
**Project:** `open-graph-mcp`  
**Date:** 2026-08-14  

---

## 1. Domain Vision & Strategic Context

The `telemetry_observability` subdomain provides enterprise-grade, zero-overhead operational telemetry and immutable epistemic auditability across all layers of the `open-graph-mcp` stack (`mcp-server`, `stdio-proxy`, `graph-core`, and `mcp-web`).

In accordance with **ADR-0021** (*Verification by host log, never self-report*), logging in `open-graph-mcp` serves a dual purpose:
1. **Operational Telemetry (High-Frequency & Metrics):** Real-time monitoring of RPC latency, memory/CPU usage, transport health, error rates, and W3C distributed trace propagation (`traceId`, `spanId`).
2. **Epistemic Audit & Governance (Immutable Ledger):** Tamper-evident record of Admission Gate evaluations, Epistemic Lifecycle transitions (`PROMOTE`, `CONTEST`, `RECALL`), tenant isolation boundary checks, and capability executions.

---

## 2. Ubiquitous Language & Core Terminology

- **TraceContext:** W3C compliant correlation metadata (`traceId`, `spanId`, `parentSpanId`) passed across all async boundaries and transports.
- **Epistemic Audit Event:** Structured immutable record capturing gate decisions, promotion proposals, and recall notices.
- **Async Ring Buffer:** Non-blocking in-memory log buffer that flushes records in batches to disk or OTLP collector without blocking the main event loop.
- **PII Redaction Engine:** Automatic scrubber preventing tokens, passwords, and sensitive keys from reaching log outputs.
- **Dynamic Log Level Controller:** Runtime mechanism to adjust log severity (`DEBUG`, `INFO`, `WARN`, `ERROR`) per tenant or subsystem without restarting processes.
- **MCP Telemetry Stream:** MCP protocol native logging via `notifications/message` and `telemetry/event`.

---

## 3. Subdomain Boundaries

| Subdomain | Type | Responsibilities |
|---|---|---|
| **Operational Telemetry** | Core | Latency tracking, W3C trace propagation, OTLP export, NDJSON stderr streaming. |
| **Epistemic Audit** | Core | Immutable event ledger (`.jsonl`), SQLite `capability_executions` audit log, gate evidence. |
| **Transport Telemetry** | Supporting | Stdio Proxy frame inspection, SSE reconnection metrics, RPC payload sizes. |
| **Log Governance** | Generic | PII redaction, dynamic log level filtering, ring buffer flushing. |

---

## 4. Key Strategic Questions & Invariants

1. **Stdout Isolation:** MCP JSON-RPC protocol mandates clean stdout. Telemetry MUST NEVER output unformatted text to stdout. All operational logs MUST use `stderr`, dedicated files, or OTLP streams.
2. **Non-Blocking Execution:** Telemetry calls MUST be non-blocking (O(1) in-memory enqueue). File I/O and network export happen asynchronously.
3. **Correlation Integrity:** Every gate stage evaluation, storage append, and proxy request MUST share the same `traceId` and `tenantId`.
