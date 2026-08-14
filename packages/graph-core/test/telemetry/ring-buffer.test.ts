import { describe, expect, it } from "bun:test";
import { AsyncRingBuffer } from "../../src/telemetry/ring-buffer";
import type { ProductionLogEvent } from "../../src/telemetry/types";

describe("AsyncRingBuffer", () => {
  it("should push events in O(1) non-blocking execution", () => {
    const buffer = new AsyncRingBuffer({ capacity: 1000, batchSize: 100 });
    const start = performance.now();
    for (let i = 0; i < 5000; i++) {
      buffer.push({
        timestamp: new Date().toISOString(),
        level: "INFO",
        service: "graph-core",
        environment: "test",
        traceId: "123",
        spanId: "456",
        tenantId: "tenant-1",
        event: "test_event",
        message: `msg ${i}`,
        attributes: {},
      });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it("should flush batch when batchSize is reached", async () => {
    let flushedCount = 0;
    const buffer = new AsyncRingBuffer({
      capacity: 100,
      batchSize: 10,
      flushIntervalMs: 0,
      sink: async (events: ProductionLogEvent[]) => {
        flushedCount += events.length;
      },
    });

    for (let i = 0; i < 15; i++) {
      buffer.push({
        timestamp: new Date().toISOString(),
        level: "INFO",
        service: "graph-core",
        environment: "test",
        traceId: "123",
        spanId: "456",
        tenantId: "tenant-1",
        event: "test_event",
        message: `msg ${i}`,
        attributes: {},
      });
    }

    await buffer.flush();
    expect(flushedCount).toBe(15);
  });
});
