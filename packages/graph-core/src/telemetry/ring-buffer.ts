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
  private buffer: (ProductionLogEvent | undefined)[];
  private head = 0;
  private tail = 0;
  private count = 0;
  private droppedEventsCount = 0;
  private sink?: LogSink;
  private timer?: ReturnType<typeof setInterval>;
  private isFlushing = false;

  constructor(options: RingBufferOptions = {}) {
    this.capacity = options.capacity || 10000;
    this.batchSize = options.batchSize || 100;
    this.flushIntervalMs = options.flushIntervalMs || 50;
    this.buffer = new Array(this.capacity);
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
    if (this.count >= this.capacity) {
      // Overwrite oldest item in O(1) time
      this.head = (this.head + 1) % this.capacity;
      this.count--;
      this.droppedEventsCount++;
    }

    this.buffer[this.tail] = event;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;

    if (this.sink && this.count >= this.batchSize) {
      void this.flush();
    }
    return true;
  }

  public async flush(): Promise<void> {
    if (this.isFlushing || this.count === 0 || !this.sink) return;
    this.isFlushing = true;

    try {
      while (this.count > 0) {
        const batch: ProductionLogEvent[] = [];
        const toTake = Math.min(this.count, this.batchSize);

        for (let i = 0; i < toTake; i++) {
          const item = this.buffer[this.head];
          this.buffer[this.head] = undefined;
          this.head = (this.head + 1) % this.capacity;
          this.count--;
          if (item) batch.push(item);
        }

        if (batch.length > 0) {
          try {
            await this.sink(batch);
          } catch (err) {
            this.droppedEventsCount += batch.length;
            console.error("[AsyncRingBuffer] Error flushing batch, dropped events:", err);
          }
        }
      }
    } finally {
      this.isFlushing = false;
    }
  }

  public size(): number {
    return this.count;
  }

  public getDroppedEventsCount(): number {
    return this.droppedEventsCount;
  }

  public async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    while (this.count > 0) {
      await this.flush();
    }
  }
}
