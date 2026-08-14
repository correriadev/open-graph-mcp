import { describe, expect, it } from "bun:test";
import { PIIRedactor } from "../../src/telemetry/pii-redactor";
import { AsyncRingBuffer } from "../../src/telemetry/ring-buffer";
import {
  createTraceContext,
  formatW3CTraceParent,
  parseW3CTraceParent,
} from "../../src/telemetry/trace-context";

describe("Adversarial QA & Security Edge Cases", () => {
  it("should prevent circular reference stack overflow crashes in PIIRedactor", () => {
    const redactor = new PIIRedactor();
    const circularObj: Record<string, unknown> = { name: "test" };
    circularObj.self = circularObj; // Circular reference

    expect(() => redactor.redact(circularObj)).not.toThrow();
    const result = redactor.redact(circularObj) as Record<string, unknown>;
    expect(result.name).toBe("test");
    expect(result.self).toBe("[CIRCULAR_REFERENCE]");
  });

  it("should scrub snake_case keys and Bearer tokens in raw string payloads", () => {
    const redactor = new PIIRedactor();
    const payload = {
      api_key: "sk-proj-12345678901234567890",
      session_key: "sess-abc",
      header: "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      dbUrl: "postgres://admin:secretpass@localhost:5432/db",
    };

    const scrubbed = redactor.redact(payload) as typeof payload;
    expect(scrubbed.api_key).toBe("***REDACTED***");
    expect(scrubbed.session_key).toBe("***REDACTED***");
    expect(scrubbed.header).toContain("Bearer ***REDACTED***");
    expect(scrubbed.dbUrl).toContain("postgres://admin:***REDACTED***@localhost:5432/db");
  });

  it("should handle buffer overflow in O(1) circular ring buffer without Array.shift", () => {
    const buffer = new AsyncRingBuffer({ capacity: 10, batchSize: 5 });
    for (let i = 0; i < 25; i++) {
      buffer.push({
        timestamp: new Date().toISOString(),
        level: "INFO",
        service: "graph-core",
        environment: "test",
        traceId: "123",
        spanId: "456",
        tenantId: "t1",
        event: "e",
        message: `msg-${i}`,
        attributes: {},
      });
    }

    expect(buffer.getDroppedEventsCount()).toBe(15);
    expect(buffer.size()).toBe(10);
  });

  it("should safely reject non-hex and non-string inputs in W3C traceparent parser", () => {
    // Non-string input
    expect(parseW3CTraceParent(null as unknown as string)).toBeNull();
    expect(parseW3CTraceParent(12345 as unknown as string)).toBeNull();

    // Non-hex characters
    expect(parseW3CTraceParent("00-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-00f067aa0ba902b7-01")).toBeNull();

    // All zeros forbidden W3C trace IDs
    expect(parseW3CTraceParent("00-00000000000000000000000000000000-00f067aa0ba902b7-01")).toBeNull();

    // Valid header
    const valid = parseW3CTraceParent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
    expect(valid).not.toBeNull();
    expect(valid?.parentSpanId).toBe("00f067aa0ba902b7");
  });
});
