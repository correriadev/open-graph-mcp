export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
export type ServiceName = 'mcp-server' | 'stdio-proxy' | 'mcp-web' | 'graph-core';
export type Environment = 'production' | 'staging' | 'alpha' | 'test';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  tenantId: string;
  horizonId?: string;
  agentId?: string;
}

export interface ProductionLogEvent extends TraceContext {
  timestamp: string;
  level: LogLevel;
  service: ServiceName;
  environment: Environment;
  event: string;
  message: string;
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
  attributes: Record<string, unknown>;
}

export interface TelemetryConfig {
  minLevel: LogLevel;
  logFilePath?: string;
  enableStderr: boolean;
  enableOtel: boolean;
  otelEndpoint?: string;
  redactKeys: string[];
  batchFlushIntervalMs: number;
  batchSize: number;
  tenantLevelOverrides?: Record<string, LogLevel>;
}

export type LogSink = (events: ProductionLogEvent[]) => Promise<void> | void;

export interface EpistemicAuditEvent {
  timestamp: string;
  traceId: string;
  tenantId: string;
  horizonId?: string;
  gate: string;
  verdict: 'PROMOTE' | 'CONTEST' | 'RECALL' | 'BOOT_PASS' | 'BOOT_FAIL' | 'ALLOWED' | 'DENIED';
  subject?: string;
  reason?: string;
  evidence?: Record<string, unknown>;
}
