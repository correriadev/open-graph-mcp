import { defaultRedactor, PIIRedactor } from "./pii-redactor";
import { AsyncRingBuffer } from "./ring-buffer";
import { generateSpanId, generateTraceId, getTraceContext } from "./trace-context";
import type {
  Environment,
  LogLevel,
  LogSink,
  ProductionLogEvent,
  ServiceName,
  TelemetryConfig,
} from "./types";

const LEVEL_SEVERITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50,
};

export class ProductionLogger {
  private config: TelemetryConfig;
  private ringBuffer: AsyncRingBuffer;
  private redactor: PIIRedactor;
  private serviceName: ServiceName;
  private environment: Environment;

  constructor(
    serviceName: ServiceName = "graph-core",
    config?: Partial<TelemetryConfig>,
    sink?: LogSink
  ) {
    this.serviceName = serviceName;
    this.environment = (process.env.NODE_ENV as Environment) || "alpha";
    this.config = {
      minLevel: config?.minLevel || "INFO",
      enableStderr: config?.enableStderr ?? false,
      enableOtel: config?.enableOtel ?? false,
      redactKeys: config?.redactKeys || [],
      batchFlushIntervalMs: config?.batchFlushIntervalMs || 50,
      batchSize: config?.batchSize || 100,
      tenantLevelOverrides: config?.tenantLevelOverrides || {},
    };

    this.redactor = new PIIRedactor(this.config.redactKeys);
    this.ringBuffer = new AsyncRingBuffer({
      batchSize: this.config.batchSize,
      flushIntervalMs: this.config.batchFlushIntervalMs,
      sink: sink || this.createDefaultSink(),
    });
  }

  private createDefaultSink(): LogSink {
    return async (events: ProductionLogEvent[]) => {
      for (const event of events) {
        if (this.config.enableStderr) {
          process.stderr.write(JSON.stringify(event) + "\n");
        }
      }
    };
  }

  public setMinLevel(level: LogLevel): void {
    this.config.minLevel = level;
  }

  public setTenantLevelOverride(tenantId: string, level: LogLevel): void {
    if (!this.config.tenantLevelOverrides) {
      this.config.tenantLevelOverrides = {};
    }
    this.config.tenantLevelOverrides[tenantId] = level;
  }

  public setSink(sink: LogSink): void {
    this.ringBuffer.setSink(sink);
  }

  private shouldLog(level: LogLevel, tenantId?: string): boolean {
    let effectiveMinLevel = this.config.minLevel;
    if (tenantId && this.config.tenantLevelOverrides?.[tenantId]) {
      effectiveMinLevel = this.config.tenantLevelOverrides[tenantId];
    }
    return LEVEL_SEVERITY[level] >= LEVEL_SEVERITY[effectiveMinLevel];
  }

  public log(
    level: LogLevel,
    event: string,
    message: string,
    attributes: Record<string, unknown> = {},
    error?: Error | { code: string; message: string; stack?: string }
  ): void {
    const activeCtx = getTraceContext();
    const tenantId = activeCtx?.tenantId || "default";

    if (!this.shouldLog(level, tenantId)) return;

    const scrubbedAttributes = this.redactor.redact(attributes);

    let errorObj: ProductionLogEvent["error"] | undefined;
    if (error) {
      if (error instanceof Error) {
        errorObj = {
          code: error.name || "Error",
          message: error.message,
          stack: error.stack,
        };
      } else {
        errorObj = error;
      }
    }

    const logEvent: ProductionLogEvent = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      environment: this.environment,
      traceId: activeCtx?.traceId || generateTraceId(),
      spanId: activeCtx?.spanId || generateSpanId(),
      parentSpanId: activeCtx?.parentSpanId,
      tenantId,
      horizonId: activeCtx?.horizonId,
      agentId: activeCtx?.agentId,
      event,
      message,
      attributes: scrubbedAttributes,
      error: errorObj,
    };

    this.ringBuffer.push(logEvent);
  }

  public debug(event: string, message: string, attributes?: Record<string, unknown>): void {
    this.log("DEBUG", event, message, attributes);
  }

  public info(event: string, message: string, attributes?: Record<string, unknown>): void {
    this.log("INFO", event, message, attributes);
  }

  public warn(event: string, message: string, attributes?: Record<string, unknown>): void {
    this.log("WARN", event, message, attributes);
  }

  public error(event: string, message: string, attributes?: Record<string, unknown>, err?: Error): void {
    this.log("ERROR", event, message, attributes, err);
  }

  public fatal(event: string, message: string, attributes?: Record<string, unknown>, err?: Error): void {
    this.log("FATAL", event, message, attributes, err);
  }

  public async shutdown(): Promise<void> {
    await this.ringBuffer.shutdown();
  }
}
