import type { AgentFlavorDef } from "./agent-registry"
import { detectableFlavors } from "./agent-registry"

export type ProbeResult = { found: boolean; version?: string; error?: string }

export async function safeProbe(bin: string, versionArgs: string[]): Promise<ProbeResult> {
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn([bin, ...versionArgs], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    })
  } catch (err) {
    const e = err as Error & { code?: string }
    if (e.code === "ENOENT") return { found: false, error: "not installed" }
    if (e.code === "EACCES") return { found: false, error: "permission denied" }
    return { found: false, error: e.message || String(err) }
  }

  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5000))

  try {
    const winner = await Promise.race([timeout, proc.exited])
    if (winner === "timeout") {
      proc.kill()
      return { found: false, error: "timeout" }
    }

    const exitCode = proc.exitCode
    const text = await new Response(proc.stdout).text()

    if (exitCode !== 0 && text.trim() === "") {
      const errText = await new Response(proc.stderr).text()
      return { found: false, error: errText.split("\n")[0]?.trim() || `exit code ${exitCode}` }
    }

    const version = text.split("\n")[0]?.trim() || undefined
    return { found: true, version }
  } catch (err) {
    proc.kill()
    const e = err as Error & { code?: string }
    if (e.code === "ENOENT") return { found: false, error: "not installed" }
    if (e.code === "EACCES") return { found: false, error: "permission denied" }
    return { found: false, error: (err as Error).message || String(err) }
  }
}

export type DoctorResult = { agentKind: string; name: string; found: boolean; version?: string; error?: string }

export async function probeFlavor(def: AgentFlavorDef): Promise<DoctorResult> {
  if (!def.bin) {
    return { agentKind: def.agentKind, name: def.name, found: false, error: "no binary defined" }
  }

  const bins = [def.bin, ...(def.fallbackBins ?? [])]
  let lastResult: ProbeResult = { found: false }

  for (const bin of bins) {
    const result = await safeProbe(bin, def.versionArgs ?? [])
    lastResult = result
    if (result.found) {
      return { agentKind: def.agentKind, name: def.name, found: true, version: result.version }
    }
  }

  return { agentKind: def.agentKind, name: def.name, found: false, error: lastResult.error }
}

export async function runDoctor(): Promise<DoctorResult[]> {
  const flavors = detectableFlavors()
  const results = await Promise.all(
    flavors.map(async (def) => {
      try {
        return await probeFlavor(def)
      } catch {
        return { agentKind: def.agentKind, name: def.name, found: false, error: "probe crashed" }
      }
    }),
  )
  results.sort((a, b) => a.agentKind.localeCompare(b.agentKind))
  return results
}

export function formatDoctorTable(results: DoctorResult[]): string {
  const kindHeader = "AGENT KIND"
  const nameHeader = "NAME"
  const versionHeader = "VERSION"
  const statusHeader = "STATUS"

  const kindWidth = Math.max(kindHeader.length, ...results.map((r) => r.agentKind.length))
  const nameWidth = Math.max(nameHeader.length, ...results.map((r) => r.name.length))
  const versionWidth = Math.max(versionHeader.length, ...results.map((r) => r.version?.length ?? 0))

  const sep = "  "
  const header =
    kindHeader.padEnd(kindWidth) +
    sep +
    nameHeader.padEnd(nameWidth) +
    sep +
    versionHeader.padEnd(versionWidth) +
    sep +
    statusHeader

  const rows = results.map((r) => {
    const kind = r.agentKind.padEnd(kindWidth)
    const name = r.name.padEnd(nameWidth)
    const version = (r.version ?? "-").padEnd(versionWidth)
    return kind + sep + name + sep + version + sep + (r.found ? "ok" : r.error ?? "-")
  })

  return [header, ...rows].join("\n")
}

export function printDoctorTable(results: DoctorResult[]): void {
  console.log(formatDoctorTable(results))
}
