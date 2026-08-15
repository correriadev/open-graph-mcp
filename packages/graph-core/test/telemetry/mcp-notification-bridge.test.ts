import { describe, expect, it } from "bun:test";
import { McpNotificationBridge } from "../../src/telemetry/mcp-notification-bridge";
import type { ProductionLogEvent } from "../../src/telemetry/types";

describe("McpNotificationBridge", () => {
  it("should forward ProductionLogEvent as notifications/message to MCP notification sink", () => {
    const received: { method: string; params: Record<string, unknown> }[] = [];
    const sink = {
      sendNotification: (method: string, params: Record<string, unknown>) => {
        received.push({ method, params });
      },
    };

    const bridge = new McpNotificationBridge(sink);

    const logEvent: ProductionLogEvent = {
      timestamp: "2026-08-15T15:00:00.000Z",
      level: "INFO",
      service: "mcp-server",
      environment: "production",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      tenantId: "tenant-prod",
      event: "tools/call",
      message: "Tool executed successfully",
      attributes: { tool: "graph.query" },
    };

    bridge.handleLogEvent(logEvent);

    expect(received.length).toBe(1);
    expect(received[0].method).toBe("notifications/message");
    expect(received[0].params.level).toBe("info");
    expect(received[0].params.logger).toBe("mcp-server");
    expect((received[0].params.data as any).traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect((received[0].params.data as any).tenantId).toBe("tenant-prod");
  });
});
