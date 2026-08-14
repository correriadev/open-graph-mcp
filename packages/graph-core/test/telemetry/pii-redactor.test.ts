import { describe, expect, it } from "bun:test";
import { PIIRedactor } from "../../src/telemetry/pii-redactor";

describe("PIIRedactor", () => {
  it("should scrub sensitive keys in log attributes", () => {
    const redactor = new PIIRedactor();
    const raw = {
      user: "alice",
      token: "secret-token-123",
      bearerToken: "bearer-xyz",
      nested: {
        password: "my-password",
        safeField: 42,
      },
    };

    const scrubbed = redactor.redact(raw) as typeof raw;
    expect(scrubbed.user).toBe("alice");
    expect(scrubbed.token).toBe("***REDACTED***");
    expect(scrubbed.bearerToken).toBe("***REDACTED***");
    expect(scrubbed.nested.password).toBe("***REDACTED***");
    expect(scrubbed.nested.safeField).toBe(42);
  });
});
