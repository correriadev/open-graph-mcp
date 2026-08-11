import { describe, expect, test } from "bun:test"
import {
  CellKey,
  canonicalCellKey,
  TRUTH_OWNERSHIP_VALUES,
  isValidTruthOwnership,
  updateLegacyStatusWithoutChangingOwnership,
  LEGACY_CLAIM_STATUS_VALUES,
  isValidLegacyClaimStatus,
  MAP_LEGACY_CLAIM_STATUS_DEFERRED,
  mapLegacyClaimStatusToEpistemicLifecycle,
  EPISTEMIC_LIFECYCLE_STATES,
  isValidEpistemicLifecycleState,
  BOUNDARY_COMMANDS,
  isBoundaryCommand,
  createHorizonId,
  createSequence,
  validateSequenceAdvance,
  validateNegotiationSeed,
  validatePersistentDelta,
  validateOperatorApproval,
  requiresSingleUseAuthorization,
  isValidCapabilityClassification,
  type TruthOwnership,
  type LegacyClaimStatus,
} from "../src/eap/types"

import {
  REFUSAL_CODES,
  createRefusal,
  isValidRefusalCode,
  getClientObligation,
} from "../src/eap/refusals"

describe("Task 01: EAP Contract Types", () => {
  describe("CellKey [B]", () => {
    test("Should canonicalize CellKey when a supported legacy spelling is supplied", () => {
      const key1 = CellKey.create("cognitive_line", "code")
      expect(key1.canonical).toBe("cognitive_line:5")
      expect(key1.level).toBe(5)

      const key2 = CellKey.create("domain_a", "file")
      expect(key2.canonical).toBe("domain_a:4")

      const key3 = CellKey.parse("cognitive_line:5")
      expect(key3.canonical).toBe("cognitive_line:5")

      const key4 = CellKey.parse("cognitive_line/5")
      expect(key4.canonical).toBe("cognitive_line:5")

      expect(canonicalCellKey("cognitive_line", "code")).toBe("cognitive_line:5")
    })

    test("Should reject CellKey when the domain is empty or the level is unsupported", () => {
      expect(() => CellKey.create("", 5)).toThrow("non-empty string")
      expect(() => CellKey.create("   ", 5)).toThrow("non-empty string")
      expect(() => CellKey.create("domain", 0)).toThrow("Unsupported CellKey level")
      expect(() => CellKey.create("domain", 6)).toThrow("Unsupported CellKey level")
      expect(() => CellKey.create("domain", "invalid_level")).toThrow("Unsupported CellKey level")
    })

    test("Should consider CellKey values equal when their canonical spellings match", () => {
      const keyA = CellKey.create("cognitive_line", 5)
      const keyB = CellKey.create("cognitive_line", "code")
      const keyC = CellKey.create("cognitive_line", 4)

      expect(keyA.equals(keyB)).toBe(true)
      expect(keyA.equals("cognitive_line:5")).toBe(true)
      expect(keyA.equals("cognitive_line/5")).toBe(true)
      expect(keyA.equals(keyC)).toBe(false)
    })
  })

  describe("TruthOwnership [B]", () => {
    test("Should validate closed TruthOwnership union", () => {
      expect(TRUTH_OWNERSHIP_VALUES).toEqual(["source", "graph", "suspended"])
      expect(isValidTruthOwnership("source")).toBe(true)
      expect(isValidTruthOwnership("graph")).toBe(true)
      expect(isValidTruthOwnership("suspended")).toBe(true)
      expect(isValidTruthOwnership("invalid")).toBe(false)
    })

    test("Should keep TruthOwnership independent when claim status changes", () => {
      const initialOwnership: TruthOwnership = "graph"
      const updatedStatus: LegacyClaimStatus = "verified"

      const newOwnership = updateLegacyStatusWithoutChangingOwnership(initialOwnership, updatedStatus)
      expect(newOwnership).toBe("graph")
    })
  })

  describe("LegacyClaimStatus & Migration Exclusion [B]", () => {
    test("Should validate closed LegacyClaimStatus union", () => {
      expect(LEGACY_CLAIM_STATUS_VALUES).toEqual([
        "pending-verification",
        "verified",
        "contradicts-floor",
        "test-spec",
      ])
      expect(isValidLegacyClaimStatus("pending-verification")).toBe(true)
      expect(isValidLegacyClaimStatus("verified")).toBe(true)
      expect(isValidLegacyClaimStatus("unknown")).toBe(false)
    })

    test("Should explicitly prevent inferred mapping of LegacyClaimStatus", () => {
      expect(MAP_LEGACY_CLAIM_STATUS_DEFERRED.isDeferred).toBe(true)
      expect(() => mapLegacyClaimStatusToEpistemicLifecycle("verified")).toThrow(
        MAP_LEGACY_CLAIM_STATUS_DEFERRED.reason
      )
    })
  })

  describe("Refusal Taxonomy & Obligations [E]", () => {
    test("Should validate all closed RefusalCodes and their client obligations", () => {
      for (const code of REFUSAL_CODES) {
        expect(isValidRefusalCode(code)).toBe(true)
        const obligation = getClientObligation(code)
        expect(typeof obligation).toBe("string")
        expect(obligation.length).toBeGreaterThan(5)
      }
    })
  })
})
