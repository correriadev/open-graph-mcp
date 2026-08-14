#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProductionLogEvent } from "../packages/graph-core/src/telemetry/types";

function parseArgs() {
  const args = process.argv.slice(2);
  let file = ".logs/server.log";
  let tenant: string | undefined;
  let level: string | undefined;
  let service: string | undefined;
  let follow = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--file" && args[i + 1]) {
      file = args[++i];
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

  return { file: resolve(file), tenant, level, service, follow };
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

function formatLogLine(event: ProductionLogEvent): string {
  const color = LEVEL_COLORS[event.level] || RESET;
  const time = event.timestamp.substring(11, 23);
  const trace = event.traceId ? event.traceId.substring(0, 8) : "no-trace";
  const tenantStr = event.tenantId ? `[${event.tenantId}]` : "";

  let attrStr = "";
  if (event.attributes && Object.keys(event.attributes).length > 0) {
    attrStr = ` ${DIM}${JSON.stringify(event.attributes)}${RESET}`;
  }

  let errStr = "";
  if (event.error) {
    errStr = ` \x1b[31mError(${event.error.code || "Error"}): ${event.error.message}${RESET}`;
  }

  return `${DIM}${time}${RESET} ${color}[${event.level.padEnd(5)}]${RESET} ${DIM}[${event.service}]${RESET}${tenantStr} ${DIM}(${trace})${RESET} \x1b[1m${event.event}:${RESET} ${event.message}${attrStr}${errStr}`;
}

function processLine(line: string, opts: ReturnType<typeof parseArgs>) {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const event = JSON.parse(trimmed) as ProductionLogEvent;
    if (opts.tenant && event.tenantId !== opts.tenant) return;
    if (opts.service && event.service !== opts.service) return;
    if (opts.level && event.level !== opts.level) return;
    console.log(formatLogLine(event));
  } catch {
    // Non-JSON fallback
    console.log(`${DIM}${trimmed}${RESET}`);
  }
}

function main() {
  const opts = parseArgs();
  console.log(`\x1b[36m--- OpenGraph MCP Production Log Tailing (${opts.file}) ---\x1b[0m`);

  if (!existsSync(opts.file)) {
    console.log(`Waiting for log file: ${opts.file}...`);
  } else {
    const content = readFileSync(opts.file, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      processLine(line, opts);
    }
  }

  if (opts.follow) {
    let lastSize = existsSync(opts.file) ? readFileSync(opts.file).length : 0;
    setInterval(() => {
      if (existsSync(opts.file)) {
        const currentContent = readFileSync(opts.file);
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
