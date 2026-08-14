import { describe, expect, it } from "bun:test";
import {
  createTraceContext,
  formatW3CTraceParent,
  getTraceContext,
  parseW3CTraceParent,
  runWithTraceContext,
} from "../../src/telemetry/trace-context";

describe("TraceContext", () => {
  it("should propagate trace context across async execution boundaries", async () => {
    const ctx = createTraceContext({ tenantId: "tenant-alpha" });
    await runWithTraceContext(ctx, async () => {
      const active = getTraceContext();
      expect(active?.tenantId).toBe("tenant-alpha");
      expect(active?.traceId).toHaveLength(32);
      expect(active?.spanId).toHaveLength(16);
    });
  });

  it("should parse and format W3C traceparent headers correctly", () => {
    const header = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const parsed = parseW3CTraceParent(header);
    expect(parsed).not.toBeNull();
    expect(parsed?.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(parsed?.spanId).toBe("00f067aa0ba902b7");

    const formatted = formatW3CTraceParent(parsed!.traceId, parsed!.spanId, true);
    expect(formatted).toBe(header);
  });
});
