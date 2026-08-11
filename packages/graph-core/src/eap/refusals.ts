/**
 * packages/graph-core/src/eap/refusals.ts
 * EAP Closed Taxonomy of Refusal Codes and Obligation Mapping.
 * Implements Task 01 & 05 of Feature F001 (cognitive_line domain).
 */

export const REFUSAL_CODES = [
  "ANCHOR_NOT_FOUND",
  "COVERAGE_UNBALANCED",
  "CELL_KEY_NONCANONICAL",
  "LADDER_VIOLATION",
  "PROVENANCE_MISSING",
  "TURN_SCOPE",
  "HORIZON_SKIP",
  "AUTHORITY_REF_INVALID",
  "ASSUMPTION_DROPPED",
  "STALE_BASE",
  "SCOPE_EXCEEDED",
  "APPROVAL_EXPIRED",
  "APPROVAL_STALE_SEQ",
  "EVIDENCE_REQUIRED",
  "TOOL_UNCLASSIFIED",
  "TOOL_OUT_OF_CONTRACT",
  "BUDGET_EXHAUSTED",
  "RECALL_UNPROVEN",
  "REHAB_WITHOUT_PROOF",
  "DIRECT_EDIT_FORBIDDEN",
  "ILLEGAL_TRANSITION",
  "BOUNDARY_COMMAND_AS_STATE",
  "RESOURCE_ABSENT",
  "MALFORMED_CONTRACT",
  "BOUNDARY_COMMAND_REJECTED",
] as const

export type RefusalCode = typeof REFUSAL_CODES[number]

export const REFUSAL_OBLIGATIONS: Record<RefusalCode, string> = {
  ANCHOR_NOT_FOUND: "corrigir a âncora sem re-submeter idêntico",
  COVERAGE_UNBALANCED: "completar cobertura ou renunciar a β",
  CELL_KEY_NONCANONICAL: "normalizar — jamais criar a célula na grafia nova",
  LADDER_VIOLATION: "reestruturar o changeset",
  PROVENANCE_MISSING: "completar proveniência",
  TURN_SCOPE: "aguardar/adquirir o turno",
  HORIZON_SKIP: "Re-target promotion proposal to the declared immediate parent horizon edge.",
  AUTHORITY_REF_INVALID: "completar o ciclo na origem",
  ASSUMPTION_DROPPED: "reintroduzir ou resolver com registro",
  STALE_BASE: "Rebase candidate against the current sequence and re-evaluate.",
  SCOPE_EXCEEDED: "Obtain an operator approval with scope matching the requested operation.",
  APPROVAL_EXPIRED: "Obtain a non-expired operator approval.",
  APPROVAL_STALE_SEQ: "Obtain operator approval bound to the current sequence.",
  EVIDENCE_REQUIRED: "Provide required evidence references to support proposal or contestation.",
  TOOL_UNCLASSIFIED: "classificar no adapter",
  TOOL_OUT_OF_CONTRACT: "escalar ao operador",
  BUDGET_EXHAUSTED: "escalonamento — nunca promoção",
  RECALL_UNPROVEN: "apresentar evidência — recall também atravessa gate",
  REHAB_WITHOUT_PROOF: "percorrer o caminho normal de verificação",
  DIRECT_EDIT_FORBIDDEN: "Submit knowledge candidate through the single Admission Gate.",
  ILLEGAL_TRANSITION: "Follow the normative epistemic lifecycle order (proposed -> deliberated -> admitted -> concretized -> verified).",
  BOUNDARY_COMMAND_AS_STATE: "Invoke boundary command (PROMOTE, CONTEST, INITIATE) as a boundary action, not a lifecycle state.",
  RESOURCE_ABSENT: "Verify resource identifier existence before issuing scope-dependent commands.",
  MALFORMED_CONTRACT: "Format contract payload according to published EAP schemas.",
  BOUNDARY_COMMAND_REJECTED: "Submit boundary commands (PROMOTE, CONTEST, INITIATE) to their dedicated boundary endpoints, not as lifecycle state transitions.",
}

export interface Refusal {
  code: RefusalCode
  obligation: string
  detail?: string
  seq?: number
}

export function isValidRefusalCode(code: unknown): code is RefusalCode {
  return typeof code === "string" && (REFUSAL_CODES as readonly string[]).includes(code)
}

export function getClientObligation(code: RefusalCode): string {
  const obligation = REFUSAL_OBLIGATIONS[code]
  if (!obligation) {
    throw new Error(`No client obligation mapped for refusal code: ${String(code)}`)
  }
  return obligation
}

export function createRefusal(code: string, detail?: string, seq?: number): Refusal {
  if (!isValidRefusalCode(code)) {
    throw new Error(`Invalid RefusalCode: '${code}'. Code must be part of the closed versioned EAP taxonomy.`)
  }
  const obligation = getClientObligation(code)
  return {
    code,
    obligation,
    ...(detail ? { detail } : {}),
    ...(seq !== undefined ? { seq } : {}),
  }
}

export function reasonToRefusal(reason: string): Refusal {
  let code: RefusalCode = "LADDER_VIOLATION"

  if (reason.includes("anchor not found") || reason.includes("anchor_missing")) {
    code = "ANCHOR_NOT_FOUND"
  } else if (
    reason.includes("coverage not balanced") ||
    reason.includes("uncovered_node") ||
    reason.includes("without claims")
  ) {
    code = "COVERAGE_UNBALANCED"
  } else if (
    reason.includes("out of turn scope") ||
    reason.includes("not locked by this changeset") ||
    reason.includes("locked by") ||
    reason.includes("not open") ||
    reason.includes("not the holder")
  ) {
    code = "TURN_SCOPE"
  } else if (
    reason.includes("invalid cell") ||
    reason.includes("noncanonical") ||
    reason.includes("cannot derive cell")
  ) {
    code = "CELL_KEY_NONCANONICAL"
  } else if (
    reason.includes("missing required fields") ||
    reason.includes("intent required") ||
    reason.includes("provenance")
  ) {
    code = "PROVENANCE_MISSING"
  } else if (
    reason.includes("invalid level") ||
    reason.includes("roundtrip") ||
    reason.includes("verify") ||
    reason.includes("unknown delta kind")
  ) {
    code = "LADDER_VIOLATION"
  }

  return createRefusal(code, reason)
}
