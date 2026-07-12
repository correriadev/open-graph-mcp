/**
 * claims.ts — schema + io dos claims (loop 2b-det). Os claims DETERMINÍSTICOS (dependency/export)
 * nascem aqui com verdict auto; os `subject` e os vereditos LLM entram na 2b-llm.
 */
import { createHash } from "node:crypto"
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import { extractImportsAst, extractExports, excerptCheck } from "./extract"

export type Confidence = "Certo" | "Provável" | "Chutando"
export type Claim = {
  id: string
  file: string
  excerpt: string
  content: string
  kind: "subject" | "dependency" | "export"
  verdict: { confidence: Confidence; overClaim: boolean }
}
export type ClaimsFile = { schemaVersion: 1; repo: string; generatedAt: string; claims: Claim[] }

/** id determinístico = sha256(file\nexcerpt\ncontent) truncado. Consolidação dedup por id. */
export function claimId(file: string, excerpt: string, content: string): string {
  return createHash("sha256").update(`${file}\n${excerpt}\n${content}`).digest("hex").slice(0, 16)
}

/**
 * Claims determinísticos de um arquivo: dependency (imports) + export. Verdict auto (ancorado).
 * Imports via extractImportsAst (spec 10): AST pra TS/TSX (cobre multilinha), regex fallback pras
 * demais extensões — mesma função decide, sem branch aqui.
 */
export async function deterministicClaims(file: string, content: string): Promise<Claim[]> {
  const mk = (kind: Claim["kind"], excerpt: string, text: string): Claim => {
    if (!excerptCheck(content, excerpt)) throw new Error(`excerpt não-verbatim em ${file}: ${excerpt}`)
    return {
      id: claimId(file, excerpt, text),
      file,
      excerpt,
      content: text,
      kind,
      verdict: { confidence: "Certo", overClaim: false },
    }
  }
  const claims: Claim[] = []
  for (const imp of await extractImportsAst(content, file)) claims.push(mk("dependency", imp.line, `importa ${imp.spec}`))
  for (const exp of extractExports(content)) claims.push(mk("export", exp.line, `exporta ${exp.name}`))
  return claims
}

/** Grava .graph/claims.json (cria .graph/ se faltar). */
export function writeClaims(root: string, claimsFile: ClaimsFile): string {
  const dir = path.join(root, ".graph")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "claims.json")
  writeFileSync(file, JSON.stringify(claimsFile, null, 2))
  return file
}

export function readClaims(root: string): ClaimsFile | null {
  const file = path.join(root, ".graph", "claims.json")
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, "utf8")) as ClaimsFile
}
