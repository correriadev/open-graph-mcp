# Test Scenarios — Telemetry & Observability Subdomain

**Domain:** `telemetry_observability`  
**Project:** `open-graph-mcp`  
**Date:** 2026-08-14  

---

## 1. Unit Scenarios

### 1.1 Non-Blocking Async Ring Buffer
- **Given** high-volume log emissions (10,000 events/sec)
- **When** `ProductionLogger.debug` or `info` is invoked
- **Then** the caller thread returns in < 0.1ms (O(1) queue push) and background batch flushing commits events without event loop lag.

### 1.2 PII Redaction
- **Given** log attributes containing sensitive keys (`bearerToken`, `sessionKey`, `password`, `secret`)
- **When** `ProductionLogger` serializes the log record
- **Then** all sensitive values are replaced with `***REDACTED***`.

### 1.3 Stdout Safety in MCP Server
- **Given** MCP server running under `stdio` transport
- **When** telemetry logs are emitted at any log level
- **Then** `process.stdout` receives zero raw log lines, preserving JSON-RPC 2.0 stream integrity.

---

## 2. Integration Scenarios

### 2.1 Trace Context Propagation
- **Given** an incoming request through `stdio-proxy` carrying a `traceId`
- **When** the request flows through `mcp-server` into `graph-core` admission gate
- **Then** all generated operational logs and epistemic audit records carry the exact same `traceId` and `tenantId`.

### 2.2 Dynamic Log Level Reconfiguration
- **Given** a server running with default `INFO` level
- **When** a dynamic configuration update changes `minLevel` to `DEBUG` for `tenantId = 'tenant-alpha'`
- **Then** `DEBUG` events for `tenant-alpha` are captured while other tenants remain at `INFO`.
