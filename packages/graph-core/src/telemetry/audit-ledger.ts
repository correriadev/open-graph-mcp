import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getTraceContext } from "./trace-context";
import type { EpistemicAuditEvent } from "./types";

export class EpistemicAuditLedger {
  private logFilePath?: string;

  constructor(logFilePath?: string) {
    this.logFilePath = logFilePath;
  }

  public record(
    gate: string,
    verdict: EpistemicAuditEvent["verdict"],
    details: { subject?: string; reason?: string; evidence?: Record<string, unknown> } = {}
  ): EpistemicAuditEvent {
    const activeCtx = getTraceContext();
    const event: EpistemicAuditEvent = {
      timestamp: new Date().toISOString(),
      traceId: activeCtx?.traceId || "00000000000000000000000000000000",
      tenantId: activeCtx?.tenantId || "default",
      horizonId: activeCtx?.horizonId,
      gate,
      verdict,
      subject: details.subject,
      reason: details.reason,
      evidence: details.evidence,
    };

    if (this.logFilePath) {
      try {
        mkdirSync(path.dirname(this.logFilePath), { recursive: true });
        appendFileSync(this.logFilePath, JSON.stringify(event) + "\n");
      } catch (err) {
        console.error("[EpistemicAuditLedger] Failed to append audit ledger entry:", err);
      }
    }

    return event;
  }
}
