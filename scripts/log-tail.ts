#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProductionLogEvent } from "../packages/graph-core/src/telemetry/types";

function findExistingLogFile(): string | undefined {
  const candidates = [
    "packages/mcp-server/.graph-server/server.log",
    ".graph-server/server.log",
    "packages/mcp-server/.logs/server.log",
    ".logs/server.log",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let explicitFile: string | undefined;
  let tenant: string | undefined;
  let level: string | undefined;
  let service: string | undefined;
  let follow = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--file" && args[i + 1]) {
      explicitFile = args[++i];
    } else if (arg === "--tenant" && args[i + 1]) {
      tenant = args[++i];
    } else if (arg === "--level" && args[i + 1]) {
      level = args[++i].toUpperCase();
    } else if (arg === "--service" && args[i + 1]) {
      service = args[++i];
    } else if (arg === "-f" || arg === "--follow") {
      follow = true;
    }
  }

  const defaultFile = process.env.LOG_FILE || findExistingLogFile() || (existsSync("packages/mcp-server") ? "packages/mcp-server/.graph-server/server.log" : ".graph-server/server.log");
  const file = explicitFile || defaultFile;

  return { file: resolve(file), isExplicitFile: !!explicitFile, tenant, level, service, follow };
}

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: "\x1b[36m", // Cyan
  INFO: "\x1b[32m",  // Green
  WARN: "\x1b[33m",  // Yellow
  ERROR: "\x1b[31m", // Red
  FATAL: "\x1b[35m", // Magenta
};
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

function formatLogLine(rawEvent: Record<string, unknown>): string {
  const level = ((rawEvent.level as string) || (rawEvent.error ? "ERROR" : (rawEvent.verdict === "refused" ? "WARN" : "INFO"))).toUpperCase();
  const color = LEVEL_COLORS[level] || RESET;
  const rawTs = (rawEvent.timestamp as string) || (rawEvent.ts as string) || new Date().toISOString();
  const time = rawTs.length >= 23 ? rawTs.substring(11, 23) : rawTs;
  const trace = rawEvent.traceId ? String(rawEvent.traceId).substring(0, 8) : "no-trace";
  const tenant = rawEvent.tenantId || rawEvent.tenant;
  const tenantStr = tenant ? `[${tenant}]` : "";
  const service = (rawEvent.service as string) || "mcp-server";
  const event = (rawEvent.event as string) || "event";

  let detail = "";
  if (event === "tools/call" || rawEvent.tool) {
    const toolName = rawEvent.tool || (rawEvent.attributes as Record<string, unknown> | undefined)?.tool || "unknown";
    const dur = rawEvent.durationMs !== undefined ? `${DIM}(${rawEvent.durationMs}ms)${RESET}` : "";
    const okBadge = rawEvent.ok === false || rawEvent.error ? "\x1b[31m[FAILED]\x1b[0m" : (rawEvent.verdict === "refused" ? "\x1b[33m[REFUSED]\x1b[0m" : "\x1b[32m[OK]\x1b[0m");
    const reasons = Array.isArray(rawEvent.reasons) ? ` ${DIM}reasons=${JSON.stringify(rawEvent.reasons)}${RESET}` : "";
    detail = `tool=\x1b[1m${toolName}\x1b[0m ${okBadge} ${dur}${reasons}`;
  } else if (event === "resources/read" || rawEvent.uri) {
    const uri = rawEvent.uri || (rawEvent.attributes as Record<string, unknown> | undefined)?.uri || "unknown";
    const dur = rawEvent.durationMs !== undefined ? `${DIM}(${rawEvent.durationMs}ms)${RESET}` : "";
    const okBadge = rawEvent.ok === false || rawEvent.error ? "\x1b[31m[FAILED]\x1b[0m" : "\x1b[32m[OK]\x1b[0m";
    detail = `uri=\x1b[1m${uri}\x1b[0m ${okBadge} ${dur}`;
  } else if (event === "boot") {
    detail = `server booted on port=${rawEvent.port ?? "?"} host=${rawEvent.host ?? "?"} tenants=${rawEvent.tenantsHydrated ?? "?"}`;
  } else if (rawEvent.message) {
    detail = String(rawEvent.message);
  }

  let attrStr = "";
  if (rawEvent.attributes && typeof rawEvent.attributes === "object" && Object.keys(rawEvent.attributes).length > 0) {
    const filteredAttrs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawEvent.attributes as Record<string, unknown>)) {
      if (!["tool", "uri", "durationMs", "ok", "verdict", "reasons", "ts", "timestamp", "event", "service", "level", "traceId", "spanId", "tenantId", "environment", "message"].includes(k)) {
        filteredAttrs[k] = v;
      }
    }
    if (Object.keys(filteredAttrs).length > 0) {
      attrStr = ` ${DIM}${JSON.stringify(filteredAttrs)}${RESET}`;
    }
  }

  let errStr = "";
  if (rawEvent.error) {
    const errObj = rawEvent.error as { code?: string; message?: string };
    errStr = ` \x1b[31mError(${errObj.code || "Error"}): ${errObj.message || String(rawEvent.error)}${RESET}`;
  }

  return `${DIM}${time}${RESET} ${color}[${level.padEnd(5)}]${RESET} ${DIM}[${service}]${RESET}${tenantStr} ${DIM}(${trace})${RESET} \x1b[1m${event}:\x1b[0m ${detail}${attrStr}${errStr}`;
}

function processLine(line: string, opts: ReturnType<typeof parseArgs>) {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const event = JSON.parse(trimmed) as Record<string, unknown>;
    const tenant = event.tenantId || event.tenant;
    const service = event.service || "mcp-server";
    const level = ((event.level as string) || (event.error ? "ERROR" : "INFO")).toUpperCase();

    if (opts.tenant && tenant !== opts.tenant) return;
    if (opts.service && service !== opts.service) return;
    if (opts.level && level !== opts.level) return;
    console.log(formatLogLine(event));
  } catch {
    // Non-JSON fallback
    console.log(`${DIM}${trimmed}${RESET}`);
  }
}

function main() {
  const opts = parseArgs();
  console.log(`\x1b[36m--- OpenGraph MCP Production Log Tailing (${opts.file}) ---\x1b[0m`);

  let targetFile = opts.file;

  if (!existsSync(targetFile)) {
    console.log(`Waiting for log file: ${targetFile}...`);
  } else {
    const content = readFileSync(targetFile, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      processLine(line, opts);
    }
  }

  if (opts.follow) {
    let lastSize = existsSync(targetFile) ? readFileSync(targetFile).length : 0;
    setInterval(() => {
      if (!existsSync(targetFile) && !opts.isExplicitFile) {
        const found = findExistingLogFile();
        if (found) {
          targetFile = resolve(found);
          console.log(`\x1b[32mAttached to log file: ${targetFile}\x1b[0m`);
        }
      }

      if (existsSync(targetFile)) {
        const currentContent = readFileSync(targetFile);
        if (currentContent.length > lastSize) {
          const newChunk = currentContent.subarray(lastSize).toString("utf-8");
          lastSize = currentContent.length;
          for (const line of newChunk.split("\n")) {
            processLine(line, opts);
          }
        }
      }
    }, 200);
  }
}

main();
