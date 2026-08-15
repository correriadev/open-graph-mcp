import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { startServer } from "../src/index";
import { callTool, register } from "./helpers";

describe("Telemetry & Observability Integration", () => {
  it("propagates W3C traceparent header into server logs and trace context", async () => {
    const s = startServer({ log: true });
    try {
      const logFile = `${s.state.stateDir}/server.log`;
      const a = await register(s.url, "telemetry-user");

      const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
      const spanId = "00f067aa0ba902b7";
      const traceparent = `00-${traceId}-${spanId}-01`;

      // Call tool passing traceparent and x-tenant-id headers
      const res = await fetch(`${s.url}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          traceparent,
          "x-tenant-id": "tenant-telemetry",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "system.pending",
            arguments: { token: a.token },
          },
        }),
      });

      expect(res.status).toBe(200);

      expect(existsSync(logFile)).toBe(true);
      const raw = readFileSync(logFile, "utf-8");
      const lines = raw.trim().split("\n").map((l) => JSON.parse(l));

      const pendingCall = lines.find((l) => l.event === "tools/call" && l.tool === "system.pending");
      expect(pendingCall).toBeTruthy();
      expect(pendingCall.traceId).toBe(traceId);
      expect(pendingCall.parentSpanId).toBe(spanId);
      expect(pendingCall.service).toBe("mcp-server");
      expect(pendingCall.level).toBe("INFO");
    } finally {
      s.stop();
    }
  });
});
