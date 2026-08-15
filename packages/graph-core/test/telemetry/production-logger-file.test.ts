import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach } from "bun:test";
import { ProductionLogger } from "../../src/telemetry/production-logger";

describe("ProductionLogger with file sink", () => {
  const tempLog = join(tmpdir(), `test-prod-log-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);

  afterEach(() => {
    if (existsSync(tempLog)) {
      try {
        rmSync(tempLog, { force: true });
      } catch {}
    }
  });

  it("should write logs to logFilePath and flush on demand", async () => {
    const logger = new ProductionLogger("mcp-server", {
      minLevel: "DEBUG",
      logFilePath: tempLog,
      batchFlushIntervalMs: 20,
    });

    logger.info("server.start", "Server has started", { port: 8787 });
    logger.debug("server.worker", "Worker initialized");

    await logger.flush();
    await logger.shutdown();

    expect(existsSync(tempLog)).toBe(true);
    const content = readFileSync(tempLog, "utf-8").trim().split("\n");
    expect(content.length).toBe(2);

    const first = JSON.parse(content[0]);
    expect(first.service).toBe("mcp-server");
    expect(first.level).toBe("INFO");
    expect(first.event).toBe("server.start");
    expect(first.attributes.port).toBe(8787);

    const second = JSON.parse(content[1]);
    expect(second.level).toBe("DEBUG");
    expect(second.event).toBe("server.worker");
  });
});
