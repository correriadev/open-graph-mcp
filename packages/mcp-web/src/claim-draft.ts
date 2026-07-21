export type ClaimDraftOutcome = { ok: boolean; reasons: string[]; warnings: string[] }
type MutationResult = { ok?: boolean; reasons?: string[]; warnings?: string[] }
const MAX_RAW_JSON_CHARS = 65_536

export async function submitClaimDraft(
  formPayload: Record<string, unknown>,
  rawJson: string | undefined,
  mutate: (payload: Record<string, unknown>) => Promise<MutationResult>,
): Promise<ClaimDraftOutcome> {
  let payload = formPayload
  if (rawJson) {
    if (rawJson.length > MAX_RAW_JSON_CHARS) return { ok: false, reasons: ["raw JSON excede o limite"], warnings: [] }
    try {
      payload = JSON.parse(rawJson)
    } catch (error) {
      if (error instanceof SyntaxError) return { ok: false, reasons: ["raw JSON inválido"], warnings: [] }
      throw error
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, reasons: ["raw JSON deve ser um objeto"], warnings: [] }
    }
  }
  const result = await mutate(payload)
  return result.ok === false
    ? { ok: false, reasons: result.reasons ?? [], warnings: result.warnings ?? [] }
    : { ok: true, reasons: [], warnings: result.warnings ?? [] }
}
