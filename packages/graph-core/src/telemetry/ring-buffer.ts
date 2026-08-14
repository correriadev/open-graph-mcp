import type { LogSink, ProductionLogEvent } from "./types";

export interface RingBufferOptions {
  capacity?: number;
  batchSize?: number;
  flushIntervalMs?: number;
  sink?: LogSink;
}

export class AsyncRingBuffer {
  private capacity: number;
  private batchSize: number;
  private flushIntervalMs: number;
  private buffer: ProductionLogEvent[];
  private sink?: LogSink;
  private timer?: ReturnType<typeof setInterval>;
  private isFlushing = false;

  constructor(options: RingBufferOptions = {}) {
    this.capacity = options.capacity || 10000;
    this.batchSize = options.batchSize || 100;
    this.flushIntervalMs = options.flushIntervalMs || 50;
    this.buffer = [];
    this.sink = options.sink;

    if (this.flushIntervalMs > 0 && this.sink) {
      this.startTimer();
    }
  }

  public setSink(sink: LogSink): void {
    this.sink = sink;
    if (this.flushIntervalMs > 0 && !this.timer) {
      this.startTimer();
    }
  }

  private startTimer(): void {
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  public push(event: ProductionLogEvent): boolean {
    if (this.buffer.length >= this.capacity) {
      this.buffer.shift();
    }
    this.buffer.push(event);

    if (this.sink && this.buffer.length >= this.batchSize) {
      void this.flush();
    }
    return true;
  }

  public async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0 || !this.sink) return;
    this.isFlushing = true;

    try {
      while (this.buffer.length > 0) {
        const toFlush = this.buffer.splice(0, this.batchSize);
        await this.sink(toFlush);
      }
    } catch (err) {
      console.error("[AsyncRingBuffer] Error flushing telemetry batch:", err);
    } finally {
      this.isFlushing = false;
    }
  }

  public size(): number {
    return this.buffer.length;
  }

  public async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    while (this.buffer.length > 0) {
      await this.flush();
    }
  }
}
