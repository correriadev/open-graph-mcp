import { describe, expect, it } from "bun:test";
import { ProductionLogger } from "../../src/telemetry/production-logger";
import type { ProductionLogEvent } from "../../src/telemetry/types";

describe("ProductionLogger", () => {
  it("should enforce min log level and per-tenant level overrides", async () => {
    const logged: ProductionLogEvent[] = [];
    const logger = new ProductionLogger(
      "graph-core",
      { minLevel: "INFO" },
      async (events) => {
        logged.push(...events);
      }
    );

    logger.debug("event1", "debug msg");
    logger.info("event2", "info msg");

    logger.setTenantLevelOverride("tenant-debug", "DEBUG");

    await logger.shutdown();
    expect(logged.map((e) => e.message)).toEqual(["info msg"]);
  });
});
