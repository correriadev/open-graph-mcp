import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import type { TraceContext } from "./types";

const traceStorage = new AsyncLocalStorage<TraceContext>();

export function generateTraceId(): string {
  return randomBytes(16).toString("hex");
}

export function generateSpanId(): string {
  return randomBytes(8).toString("hex");
}

export function parseW3CTraceParent(header: string): { traceId: string; spanId: string } | null {
  if (!header) return null;
  const parts = header.trim().split("-");
  if (parts.length < 4) return null;
  const [version, traceId, spanId] = parts;
  if (version !== "00") return null;
  if (traceId.length !== 32 || spanId.length !== 16) return null;
  return { traceId, spanId };
}

export function formatW3CTraceParent(traceId: string, spanId: string, sampled = true): string {
  const flags = sampled ? "01" : "00";
  return `00-${traceId}-${spanId}-${flags}`;
}

export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

export function runWithTraceContext<T>(context: TraceContext, fn: () => T): T {
  return traceStorage.run(context, fn);
}

export function createTraceContext(overrides?: Partial<TraceContext>): TraceContext {
  return {
    traceId: overrides?.traceId || generateTraceId(),
    spanId: overrides?.spanId || generateSpanId(),
    parentSpanId: overrides?.parentSpanId,
    tenantId: overrides?.tenantId || "default-tenant",
    horizonId: overrides?.horizonId,
    agentId: overrides?.agentId,
  };
}
