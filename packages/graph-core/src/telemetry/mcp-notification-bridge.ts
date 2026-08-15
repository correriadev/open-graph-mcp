import type { ProductionLogEvent } from "./types";

export interface McpNotificationSink {
  sendNotification(method: string, params: Record<string, unknown>): void | Promise<void>;
}

export class McpNotificationBridge {
  private sink?: McpNotificationSink;

  constructor(sink?: McpNotificationSink) {
    this.sink = sink;
  }

  public setSink(sink: McpNotificationSink): void {
    this.sink = sink;
  }

  public handleLogEvent(event: ProductionLogEvent): void {
    if (!this.sink) return;
    const mcpLogLevel = event.level.toLowerCase();
    void this.sink.sendNotification("notifications/message", {
      level: mcpLogLevel,
      logger: event.service,
      data: {
        timestamp: event.timestamp,
        traceId: event.traceId,
        spanId: event.spanId,
        parentSpanId: event.parentSpanId,
        tenantId: event.tenantId,
        horizonId: event.horizonId,
        agentId: event.agentId,
        event: event.event,
        message: event.message,
        attributes: event.attributes,
        error: event.error,
      },
    });
  }
}
