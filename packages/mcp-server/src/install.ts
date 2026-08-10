import path from "node:path"
import { mkdirSync, existsSync, readFileSync } from "node:fs"
import type { AgentFlavorDef } from "./agent-registry"
import { flavor } from "./agent-registry"

export type InstallResult = {
  agentKind: string
  agentName: string
  installKind: "cli" | "json" | "manual"
  dryRun: boolean
  success: boolean
  message: string
  command?: string[]
  configWritten?: string
}

const SERVER_DEFAULT = "http://localhost:8787"
const NAME_DEFAULT = "open-graph-user"

export function expandTilde(filePath: string): string {
  if (filePath.startsWith("~")) {
    const home = Bun.env.HOME ?? Bun.env.USERPROFILE
    if (!home) throw new Error("cannot expand ~: no HOME or USERPROFILE env var set")
    return path.join(home, filePath.slice(1))
  }
  return filePath
}

export function readJsonConfig(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, "utf-8")
    if (raw.trim().length === 0) return {}
    return JSON.parse(raw) as Record<string, unknown>
  } catch (err) {
    throw new Error(`failed to parse JSON config at ${filePath}: ${(err as Error).message}`)
  }
}

export function writeJsonConfig(filePath: string, data: Record<string, unknown>): void {
  const dir = path.dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  Bun.write(filePath, JSON.stringify(data, null, 2) + "\n")
}

export function buildServerEntry(
  flavorDef: AgentFlavorDef,
  serverUrl: string,
  name: string,
): Record<string, unknown> {
  const transport = flavorDef.transport
  if (transport === "stdio-proxy") {
    return {
      command: "bunx",
      args: [
        "@open-graph-mcp/stdio",
        "--server",
        serverUrl,
        "--name",
        name,
        "--live",
        "--agent-kind",
        flavorDef.agentKind,
      ],
    }
  }
  return {
    type: "http",
    url: `${serverUrl.replace(/\/+$/, "")}/mcp`,
  }
}

export function mergeMcpConfig(
  existing: Record<string, unknown>,
  entry: Record<string, unknown>,
  shape: "mcpServers" | "contextServers",
): { merged: Record<string, unknown>; existed: boolean } {
  const servers = (existing[shape] as Record<string, unknown> | undefined) ?? {}
  const existed = "open-graph" in servers
  if (existed) return { merged: existing, existed: true }
  const merged = { ...existing, [shape]: { ...servers, "open-graph": entry } }
  return { merged, existed: false }
}

async function runCliInstall(
  agentDef: AgentFlavorDef,
  agentKind: string,
  opts: { server: string; name: string; dryRun: boolean },
): Promise<InstallResult> {
  const cmd = agentDef.install as { kind: "cli"; command: string[] }
  const args = cmd.command.slice(1).map((arg) =>
    arg.replace("{{NAME}}", opts.name).replace("{{AGENT_KIND}}", agentKind),
  )
  const resolved = [cmd.command[0], ...args]

  if (opts.dryRun) {
    return {
      agentKind,
      agentName: agentDef.name,
      installKind: "cli",
      dryRun: true,
      success: true,
      message: `Would run: ${resolved.join(" ")}`,
      command: resolved,
    }
  }

  const proc = Bun.spawnSync({
    cmd: resolved,
    stdout: "pipe",
    stderr: "pipe",
  })

  if (proc.exitCode === 0) {
    return {
      agentKind,
      agentName: agentDef.name,
      installKind: "cli",
      dryRun: false,
      success: true,
      message: `Installed MCP config for ${agentDef.name} via: ${resolved.join(" ")}`,
      command: resolved,
    }
  }

  const stderr = proc.stderr.toString().trim()
  return {
    agentKind,
    agentName: agentDef.name,
    installKind: "cli",
    dryRun: false,
    success: false,
    message: `CLI install failed (exit ${proc.exitCode}): ${stderr || "no stderr output"}`,
    command: resolved,
  }
}

async function runJsonInstall(
  agentDef: AgentFlavorDef,
  agentKind: string,
  opts: { server: string; name: string; dryRun: boolean },
): Promise<InstallResult> {
  const shape = (agentDef.install as { shape: "mcpServers" | "contextServers" }).shape
  const rawPath = (agentDef.install as { configPath: string }).configPath
  const configPath = path.resolve(expandTilde(rawPath))
  const entry = buildServerEntry(agentDef, opts.server, opts.name)

  let existing: Record<string, unknown>
  try {
    existing = readJsonConfig(configPath) ?? {}
  } catch (err) {
    return {
      agentKind,
      agentName: agentDef.name,
      installKind: "json",
      dryRun: opts.dryRun,
      success: false,
      message: (err as Error).message,
    }
  }

  const { merged, existed } = mergeMcpConfig(existing, entry, shape)

  if (existed) {
    return {
      agentKind,
      agentName: agentDef.name,
      installKind: "json",
      dryRun: opts.dryRun,
      success: false,
      message: `"open-graph" entry already exists in ${shape} at ${configPath}`,
      configWritten: configPath,
    }
  }

  if (opts.dryRun) {
    return {
      agentKind,
      agentName: agentDef.name,
      installKind: "json",
      dryRun: true,
      success: true,
      message: `Would write ${shape} entry to ${configPath}: ${JSON.stringify(entry)}`,
      configWritten: configPath,
    }
  }

  writeJsonConfig(configPath, merged)
  return {
    agentKind,
    agentName: agentDef.name,
    installKind: "json",
    dryRun: false,
    success: true,
    message: `Wrote ${shape} entry for ${agentDef.name} to ${configPath}`,
    configWritten: configPath,
  }
}

async function runManualInstall(
  agentDef: AgentFlavorDef,
  agentKind: string,
  opts: { server: string; name: string; dryRun: boolean },
): Promise<InstallResult> {
  const manual = agentDef.install as { format: "json" | "yaml" | "toml"; configPath: string | null }
  const target = manual.configPath ? expandTilde(manual.configPath) : "your MCP client config"
  const entry = buildServerEntry(agentDef, opts.server, opts.name)
  const entryStr =
    manual.format === "json"
      ? JSON.stringify(entry, null, 2)
      : `${manual.format} equivalent of: ${JSON.stringify(entry)}`

  return {
    agentKind,
    agentName: agentDef.name,
    installKind: "manual",
    dryRun: opts.dryRun,
    success: true,
    message: `Manual install for ${agentDef.name}: add the following to ${target} (${manual.format} format):\n${entryStr}`,
  }
}

export async function runInstall(
  agentKind: string,
  opts: { server?: string; name?: string; dryRun?: boolean } = {},
): Promise<InstallResult> {
  const resolvedOpts = {
    server: opts.server ?? SERVER_DEFAULT,
    name: opts.name ?? NAME_DEFAULT,
    dryRun: opts.dryRun ?? false,
  }

  let agentDef: AgentFlavorDef
  try {
    agentDef = flavor(agentKind)
  } catch (err) {
    return {
      agentKind,
      agentName: "unknown",
      installKind: "manual",
      dryRun: resolvedOpts.dryRun,
      success: false,
      message: `Unknown agent kind "${agentKind}". Available: ${(err as Error).message}`,
    }
  }

  const install = agentDef.install

  switch (install.kind) {
    case "cli":
      return runCliInstall(agentDef, agentKind, resolvedOpts)
    case "json":
      return runJsonInstall(agentDef, agentKind, resolvedOpts)
    case "manual":
      return runManualInstall(agentDef, agentKind, resolvedOpts)
    default: {
      const _exhaustive: never = install
      return {
        agentKind,
        agentName: agentDef.name,
        installKind: "manual",
        dryRun: resolvedOpts.dryRun,
        success: false,
        message: `Unknown install kind: ${JSON.stringify(_exhaustive)}`,
      }
    }
  }
}
