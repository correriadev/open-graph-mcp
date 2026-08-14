import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { defaultRedactor } from "./pii-redactor";
import { generateTraceId, getTraceContext } from "./trace-context";
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
    
    // Scrub evidence and reason for PII
    const scrubbedReason = details.reason ? defaultRedactor.redactString(details.reason) : undefined;
    const scrubbedEvidence = details.evidence ? defaultRedactor.redact(details.evidence) : undefined;

    const event: EpistemicAuditEvent = {
      timestamp: new Date().toISOString(),
      traceId: activeCtx?.traceId || generateTraceId(),
      tenantId: activeCtx?.tenantId || "default",
      horizonId: activeCtx?.horizonId,
      gate,
      verdict,
      subject: details.subject,
      reason: scrubbedReason,
      evidence: scrubbedEvidence,
    };

    if (this.logFilePath) {
      const line = JSON.stringify(event) + "\n";
      const filePath = this.logFilePath;
      // Non-blocking async append
      void mkdir(path.dirname(filePath), { recursive: true })
        .then(() => appendFile(filePath, line))
        .catch((err) => {
          console.error("[EpistemicAuditLedger] Failed to append audit ledger entry:", err);
        });
    }

    return event;
  }
}
