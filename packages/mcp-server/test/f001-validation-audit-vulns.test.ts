/**
 * f001-validation-audit-vulns.test.ts
 *
 * Regression suite for the four HIGH-severity findings of the Retry #5 Validation Audit
 * (REWORK-LOG "Edge Cases Missed"). Each test reproduces the reported exploit end-to-end and
 * therefore fails against the code as it stood when the audit was written.
 *
 *   1. AUTH_BYPASS   — re-registering a consumed approval id re-armed a spent single-use grant.
 *   2. AUTH_BYPASS   — an unparseable `expiresAt` made every expiry comparison false: never expires.
 *   3. RACE_CONDITION— the idempotency key was checked but never reserved: N concurrent calls,
 *                      N provider invocations.
 *   4. DATA_INTEGRITY— `SqliteRecallRepository.complete()` without a recallCase bypassed `write()`
 *                      and the JSONL mirror, so a rebuild resurrected a completed recall.
 */
import { describe, expect, test } from "bun:test"
import { createEapEnv } from "./eap-env"
import { CapabilityGateway } from "../src/eap/capability-gateway"
import { rebuildFromJsonl } from "../src/db"
import { createRecallCase, stepRecall, InMemoryDependencyQuery, type RecallNotice } from "@open-graph-mcp/graph-core/eap/recall"

describe("Validation audit HIGH #1 — a consumed single-use approval cannot be re-armed", () => {
  test("re-registering an existing approval id does not reset the consumed flag", async () => {
    const env = createEapEnv()
    try {
      const gateway = new CapabilityGateway(env.approvals, env.audit)
      gateway.registerClassification("deploy_tool", "irreversible")

      const approval = {
        id: "appr-single-use",
        approver: "operator-alice",
        scope: "deploy.production",
        expiresAt: Date.now() + 60_000,
        basedOnSeq: 42,
      }
      expect(env.approvals.registerApproval(approval).registered).toBe(true)

      const first = await gateway.execute({
        capabilityId: "deploy_tool",
        idempotencyKey: "idem-rearm-1",
        contract: { contractRef: "contract-deploy-01", targetScope: "deploy.production" },
        currentSeq: 42,
        approval,
        providerAction: () => ({ deployed: 1 }),
      })
      expect(first.status).toBe("COMPLETED")
      expect(env.approvals.getApproval("appr-single-use")?.consumed).toBe(true)

      // THE EXPLOIT: register the same id again. An unconditional INSERT OR REPLACE resets
      // `consumed` to 0 and re-arms the spent authorization.
      const reRegister = env.approvals.registerApproval(approval)
      expect(reRegister.registered).toBe(false)
      expect(env.approvals.getApproval("appr-single-use")?.consumed).toBe(true)

      let providerRanAgain = false
      const second = await gateway.execute({
        capabilityId: "deploy_tool",
        idempotencyKey: "idem-rearm-2",
        contract: { contractRef: "contract-deploy-01", targetScope: "deploy.production" },
        currentSeq: 42,
        approval,
        providerAction: () => {
          providerRanAgain = true
          return { deployed: 2 }
        },
      })
      expect(second.status).toBe("REFUSED")
      if (second.status === "REFUSED") expect(second.refusal.code).toBe("APPROVAL_ALREADY_USED")
      expect(providerRanAgain).toBe(false)
    } finally {
      env.cleanup()
    }
  })

  test("consumption is terminal: a second consumeAuthorization always refuses", () => {
    const env = createEapEnv()
    try {
      env.approvals.registerApproval({
        id: "appr-terminal",
        approver: "op",
        scope: "s",
        expiresAt: Date.now() + 60_000,
        basedOnSeq: 1,
      })
      expect(env.approvals.consumeAuthorization("appr-terminal").success).toBe(true)
      env.approvals.registerApproval({
        id: "appr-terminal",
        approver: "op",
        scope: "s",
        expiresAt: Date.now() + 60_000,
        basedOnSeq: 1,
        consumed: false,
      })
      const again = env.approvals.consumeAuthorization("appr-terminal")
      expect(again.success).toBe(false)
      if (!again.success) expect(again.refusal.code).toBe("APPROVAL_ALREADY_USED")
    } finally {
      env.cleanup()
    }
  })
})

describe("Validation audit HIGH #2 — a malformed expiry fails closed", () => {
  test("registration rejects an unparseable expiresAt", () => {
    const env = createEapEnv()
    try {
      const res = env.approvals.registerApproval({
        id: "appr-garbage-expiry",
        approver: "op",
        scope: "deploy.production",
        expiresAt: "not-a-timestamp",
        basedOnSeq: 42,
      })
      expect(res.registered).toBe(false)
      expect(env.approvals.getApproval("appr-garbage-expiry")).toBeUndefined()
    } finally {
      env.cleanup()
    }
  })

  test("a stored approval whose expiry does not parse is treated as expired, not as valid forever", async () => {
    const env = createEapEnv()
    try {
      const gateway = new CapabilityGateway(env.approvals, env.audit)
      gateway.registerClassification("deploy_tool", "irreversible")

      // Bypass registration validation to model a row that predates it (or arrived by replay).
      env.db
        .query(
          `INSERT OR REPLACE INTO operator_approvals
             (tenant_id, id, approver, scope, expires_at, based_on_seq, consumed, created_at, consumed_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL)`,
        )
        .run(env.tenantId, "appr-nan", "op", "deploy.production", "not-a-timestamp", 42, new Date().toISOString())

      let providerRan = false
      const res = await gateway.execute({
        capabilityId: "deploy_tool",
        idempotencyKey: "idem-nan",
        contract: { contractRef: "contract-deploy-01", targetScope: "deploy.production" },
        currentSeq: 42,
        approval: { id: "appr-nan", approver: "op", scope: "deploy.production", expiresAt: "not-a-timestamp", basedOnSeq: 42 },
        providerAction: () => {
          providerRan = true
          return {}
        },
      })

      expect(res.status).toBe("REFUSED")
      if (res.status === "REFUSED") expect(res.refusal.code).toBe("APPROVAL_EXPIRED")
      expect(providerRan).toBe(false)
    } finally {
      env.cleanup()
    }
  })
})

describe("Validation audit HIGH #3 — the idempotency key is reserved, not merely checked", () => {
  test("three concurrent executions with the same key invoke the provider exactly once", async () => {
    const env = createEapEnv()
    try {
      const gateway = new CapabilityGateway(env.approvals, env.audit)
      gateway.registerClassification("reversible_tool", "reversible")

      let invocations = 0
      const request = () =>
        gateway.execute({
          capabilityId: "reversible_tool",
          idempotencyKey: "idem-concurrent",
          contract: { contractRef: "contract-1", targetScope: "scope-1" },
          currentSeq: 1,
          providerAction: async () => {
            invocations++
            await new Promise((r) => setTimeout(r, 20))
            return { invocations }
          },
        })

      const results = await Promise.all([request(), request(), request()])
      expect(invocations).toBe(1)
      expect(results.filter((r) => r.status === "COMPLETED").length).toBeGreaterThanOrEqual(1)
      // Exactly one durable outcome exists for the key.
      expect(env.audit.count()).toBe(1)
    } finally {
      env.cleanup()
    }
  })

  test("a failed execution releases its reservation so the key can be retried", async () => {
    const env = createEapEnv()
    try {
      const gateway = new CapabilityGateway(env.approvals, env.audit)
      gateway.registerClassification("flaky_tool", "reversible")

      const failing = await gateway.execute({
        capabilityId: "flaky_tool",
        idempotencyKey: "idem-retry",
        contract: { contractRef: "contract-1", targetScope: "scope-1" },
        currentSeq: 1,
        providerAction: () => {
          throw new Error("provider down")
        },
      })
      expect(failing.status).toBe("FAILED")
      expect(env.audit.count()).toBe(0)

      const retried = await gateway.execute({
        capabilityId: "flaky_tool",
        idempotencyKey: "idem-retry",
        contract: { contractRef: "contract-1", targetScope: "scope-1" },
        currentSeq: 1,
        providerAction: () => ({ ok: true }),
      })
      expect(retried.status).toBe("COMPLETED")
      expect(env.audit.count()).toBe(1)
    } finally {
      env.cleanup()
    }
  })
})

describe("Validation audit HIGH #4 — recall completion is mirrored, not a raw UPDATE", () => {
  test("a recall completed without an explicit case stays completed across rebuildFromJsonl", async () => {
    const env = createEapEnv()
    try {
      const notice: RecallNotice = {
        recallId: "rec-mirror-1",
        contestationId: "cont-mirror-1",
        targetClaimIds: ["claim-A"],
        severity: "invalidating",
        contestationStatus: "admitted",
        initiatedAt: new Date().toISOString(),
      }
      const recallCase = createRecallCase(notice, new InMemoryDependencyQuery([{ from: "claim-B", to: "claim-A" }]))
      expect("refused" in recallCase).toBe(false)
      if ("refused" in recallCase) return

      await env.recalls.create(recallCase)
      const progress = stepRecall(recallCase, 10)
      expect(progress.isComplete).toBe(true)
      // Checkpoint WITHOUT the case: only the checkpoint row is mirrored, so the mirrored
      // `recall_cases` row is still the pre-completion one written by create().
      await env.recalls.checkpoint("rec-mirror-1", recallCase.checkpoint)

      // THE EXPLOIT: complete() WITHOUT the optional recallCase argument. A raw UPDATE never
      // reaches the append-only JSONL mirror, so the rebuild replays the pre-completion row.
      await env.recalls.complete("rec-mirror-1", recallCase.scarHistory!)

      const beforeRebuild = env.db
        .query("SELECT status FROM recall_cases WHERE tenant_id = ? AND id = ?")
        .get(env.tenantId, "rec-mirror-1") as { status: string } | null
      expect(beforeRebuild?.status).toBe("completed")

      rebuildFromJsonl(env.db, env.dir, env.tenantId)

      const afterRebuild = env.db
        .query("SELECT status FROM recall_cases WHERE tenant_id = ? AND id = ?")
        .get(env.tenantId, "rec-mirror-1") as { status: string } | null
      expect(afterRebuild?.status).toBe("completed")
      expect(await env.recalls.getScar("rec-mirror-1")).not.toBeNull()
    } finally {
      env.cleanup()
    }
  })
})
