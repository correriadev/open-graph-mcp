import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import type { TraceContext } from "./types";

const traceStorage = new AsyncLocalStorage<TraceContext>();

const HEX_32_REGEX = /^[0-9a-fA-F]{32}$/;
const HEX_16_REGEX = /^[0-9a-fA-F]{16}$/;
const ALL_ZEROS_32 = "00000000000000000000000000000000";
const ALL_ZEROS_16 = "0000000000000000";

export function generateTraceId(): string {
  let id = randomBytes(16).toString("hex");
  while (id === ALL_ZEROS_32) {
    id = randomBytes(16).toString("hex");
  }
  return id;
}

export function generateSpanId(): string {
  let id = randomBytes(8).toString("hex");
  while (id === ALL_ZEROS_16) {
    id = randomBytes(8).toString("hex");
  }
  return id;
}

export function isValidTraceId(traceId: unknown): traceId is string {
  return typeof traceId === "string" && HEX_32_REGEX.test(traceId) && traceId !== ALL_ZEROS_32;
}

export function isValidSpanId(spanId: unknown): spanId is string {
  return typeof spanId === "string" && HEX_16_REGEX.test(spanId) && spanId !== ALL_ZEROS_16;
}

export function parseW3CTraceParent(header: unknown): { traceId: string; spanId: string; parentSpanId?: string } | null {
  if (typeof header !== "string") return null;
  const parts = header.trim().split("-");
  if (parts.length < 4) return null;
  const [version, traceId, spanId] = parts;
  if (version !== "00") return null;
  if (!isValidTraceId(traceId) || !isValidSpanId(spanId)) return null;
  return { traceId, spanId, parentSpanId: spanId };
}

export function formatW3CTraceParent(traceId: string, spanId: string, sampled = true): string {
  const safeTraceId = isValidTraceId(traceId) ? traceId : generateTraceId();
  const safeSpanId = isValidSpanId(spanId) ? spanId : generateSpanId();
  const flags = sampled ? "01" : "00";
  return `00-${safeTraceId}-${safeSpanId}-${flags}`;
}

export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

export function runWithTraceContext<T>(context: TraceContext, fn: () => T): T {
  return traceStorage.run(context, fn);
}

export function createTraceContext(overrides?: Partial<TraceContext>): TraceContext {
  const traceId = isValidTraceId(overrides?.traceId) ? overrides!.traceId! : generateTraceId();
  const spanId = isValidSpanId(overrides?.spanId) ? overrides!.spanId! : generateSpanId();
  
  return {
    traceId,
    spanId,
    parentSpanId: overrides?.parentSpanId,
    tenantId: overrides?.tenantId || "default-tenant",
    horizonId: overrides?.horizonId,
    agentId: overrides?.agentId,
  };
}
