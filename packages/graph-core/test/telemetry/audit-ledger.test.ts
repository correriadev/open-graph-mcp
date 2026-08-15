import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach } from "bun:test";
import { EpistemicAuditLedger } from "../../src/telemetry/audit-ledger";
import { runWithTraceContext, createTraceContext } from "../../src/telemetry/trace-context";

describe("EpistemicAuditLedger", () => {
  const tempLog = join(tmpdir(), `test-audit-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);

  afterEach(() => {
    if (existsSync(tempLog)) {
      try {
        rmSync(tempLog, { force: true });
      } catch {}
    }
  });

  it("should record gate verdicts and inherit trace context", () => {
    const ledger = new EpistemicAuditLedger();
    const traceCtx = createTraceContext({ tenantId: "tenant-beta", horizonId: "horizon-99" });

    const event = runWithTraceContext(traceCtx, () => {
      return ledger.record("ADMISSION_GATE", "PROMOTE", {
        subject: "claim:node-1",
        reason: "Valid domain boundary",
        evidence: { confidence: 0.99 },
      });
    });

    expect(event.gate).toBe("ADMISSION_GATE");
    expect(event.verdict).toBe("PROMOTE");
    expect(event.tenantId).toBe("tenant-beta");
    expect(event.horizonId).toBe("horizon-99");
    expect(event.traceId).toBe(traceCtx.traceId);
    expect(event.subject).toBe("claim:node-1");
  });

  it("should scrub sensitive keys and tokens from evidence and reason", () => {
    const ledger = new EpistemicAuditLedger();

    const event = ledger.record("CAPABILITY_GATE", "DENIED", {
      reason: "Invalid Bearer secret-token-xyz-12345678",
      evidence: {
        password: "SuperSecretPassword123!",
        sessionKey: "session-abc-456",
        safeData: "ok",
      },
    });

    expect(event.reason).not.toContain("secret-token-xyz-12345678");
    expect(event.reason).toContain("***REDACTED***");
    expect(event.evidence?.password).toBe("***REDACTED***");
    expect(event.evidence?.sessionKey).toBe("***REDACTED***");
    expect(event.evidence?.safeData).toBe("ok");
  });

  it("should persist audit records to log file asynchronously", async () => {
    const ledger = new EpistemicAuditLedger(tempLog);

    ledger.record("LIFECYCLE_GATE", "BOOT_PASS", { subject: "tenant-1" });

    // Allow async non-blocking append to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(existsSync(tempLog)).toBe(true);
    const content = readFileSync(tempLog, "utf-8").trim();
    const parsed = JSON.parse(content);

    expect(parsed.gate).toBe("LIFECYCLE_GATE");
    expect(parsed.verdict).toBe("BOOT_PASS");
    expect(parsed.subject).toBe("tenant-1");
  });
});
