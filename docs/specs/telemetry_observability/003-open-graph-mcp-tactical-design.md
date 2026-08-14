# Tactical Design — Telemetry & Observability Subdomain

**Domain:** `telemetry_observability` | **Project:** `open-graph-mcp` | **Language:** English  
**Date:** 2026-08-14  

---

## Section 1 — Main Architecture Components

| Element | Layer / Type | Invariants / Technical Rules |
|---|---|---|
| `ProductionLogger` | `graph-core` / Shared Core | Singleton async logger; non-blocking enqueue to Ring Buffer; scrubbs sensitive keys automatically. |
| `AsyncRingBuffer` | Core Utility | High-performance memory queue; flushes in background batches (e.g. 50ms or 100 items); zero main event loop blocking. |
| `TraceContextProvider` | Core Utility | Manages W3C `traceId`, `spanId`, `tenantId`, `horizonId` across async context store (AsyncLocalStorage). |
| `EpistemicAuditLedger` | Persistence Adapter | Writes immutable gate verdicts, promotion events, and recall notices to append-only JSONL & SQLite `capability_executions`. |
| `McpNotificationBridge` | `mcp-server` Adapter | Forwards `DEBUG` and `INFO` telemetry events to connected MCP clients via `notifications/message` or `telemetry/event`. |
| `LogTailCLI` | CLI Script (`scripts/log-tail.ts`) | Interactive terminal tailing tool with colorized output and multi-tenant filtering. |

---

## Section 2 — Value Objects & Contracts

```typescript
export interface ProductionLogEvent {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  service: 'mcp-server' | 'stdio-proxy' | 'mcp-web' | 'graph-core';
  environment: 'production' | 'staging' | 'alpha';
  tenantId: string;
  horizonId?: string;
  agentId?: string;
  event: string;
  message: string;
  error?: {
    code: string;
    stack?: string;
  };
  attributes: Record<string, unknown>;
}
```

```typescript
export interface TelemetryConfig {
  minLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  logFilePath?: string;
  enableOtel: boolean;
  otelEndpoint?: string;
  redactKeys: string[];
  batchFlushIntervalMs: number;
  batchSize: number;
}
```
