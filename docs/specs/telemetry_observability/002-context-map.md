# Context Map — Telemetry & Observability Subdomain

**Domain:** `telemetry_observability`  
**Project:** `open-graph-mcp`  
**Date:** 2026-08-14  

---

## 1. Bounded Context Map

```
+-------------------+        (W3C TraceContext)       +-------------------------+
|    stdio-proxy    | ------------------------------> |       mcp-server        |
| (Transport Edge)  |                                 | (Admission & Execution) |
+-------------------+                                 +-------------------------+
          |                                                        |
          | (Raw Stdio Logs)                                       | (Telemetry Events)
          v                                                        v
+-------------------------------------------------------------------------------+
|                        Telemetry & Audit Subdomain                            |
|  +-----------------------------------+   +---------------------------------+  |
|  |     Async Operational Logger      |   |     Epistemic Audit Engine      |  |
|  | (NDJSON / OTLP / Ring Buffer)     |   | (JSONL Ledger / SQLite Audit)   |  |
|  +-----------------------------------+   +---------------------------------+  |
+-------------------------------------------------------------------------------+
```

---

## 2. Context Relationships

1. **`stdio-proxy` -> `mcp-server` (Upstream / Downstream with Header Propagation):**
   - `stdio-proxy` injects `traceId` into JSON-RPC headers/metadata.
   - `mcp-server` consumes `traceId` and propagates it to `graph-core`.

2. **`mcp-server` -> `Telemetry & Audit Subdomain` (Supplier / Customer):**
   - `mcp-server` emits operational spans and epistemic audit events.
   - `Telemetry Engine` scrubbs PII, enqueues to ring buffer, and dispatches asynchronously.

3. **`Telemetry Subdomain` -> External Collectors (Datadog, Dynatrace, OTLP, Disk):**
   - Exports OpenTelemetry OTLP standard spans/metrics.
   - Writes append-only NDJSON log files for local/container tailing (`.logs/alpha-debug.log`).
