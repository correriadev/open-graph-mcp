export const DEFAULT_REDACT_KEYS = [
  "token",
  "bearertoken",
  "bearer_token",
  "bearer-token",
  "password",
  "secret",
  "sessionkey",
  "session_key",
  "session-key",
  "authorization",
  "privatekey",
  "private_key",
  "private-key",
  "apikey",
  "api_key",
  "api-key",
  "credentials",
  "auth",
];

const REDACTED_MARKER = "***REDACTED***";

// Sensitive pattern matchers in raw strings
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*/gi;
const API_KEY_PATTERN = /sk-[A-Za-z0-9]{20,}/gi;
const CONN_STR_PATTERN = /(:\/\/[^:]+:)([^@]+)(@)/gi;

export class PIIRedactor {
  private redactKeySet: Set<string>;

  constructor(customKeys: string[] = []) {
    const combined = [
      ...DEFAULT_REDACT_KEYS,
      ...customKeys.map((k) => k.toLowerCase().replace(/[-_]/g, "")),
    ];
    this.redactKeySet = new Set(combined);
  }

  public shouldRedact(key: string): boolean {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
    if (this.redactKeySet.has(normalizedKey)) return true;
    for (const pattern of this.redactKeySet) {
      if (normalizedKey.includes(pattern)) return true;
    }
    return false;
  }

  public redactString(str: string): string {
    if (!str) return str;
    return str
      .replace(BEARER_PATTERN, "Bearer ***REDACTED***")
      .replace(API_KEY_PATTERN, "sk-***REDACTED***")
      .replace(CONN_STR_PATTERN, "$1***REDACTED***$3");
  }

  public redact<T>(val: T, visited: WeakSet<object> = new WeakSet()): T {
    if (val === null || val === undefined) return val;
    if (typeof val === "string") return this.redactString(val) as unknown as T;
    if (typeof val !== "object") return val;

    // Prevent circular reference stack overflows
    if (visited.has(val as object)) {
      return "[CIRCULAR_REFERENCE]" as unknown as T;
    }
    visited.add(val as object);

    if (Array.isArray(val)) {
      return val.map((item) => this.redact(item, visited)) as unknown as T;
    }

    const obj = val as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (this.shouldRedact(key)) {
        cleaned[key] = REDACTED_MARKER;
      } else if (typeof value === "string") {
        cleaned[key] = this.redactString(value);
      } else if (typeof value === "object" && value !== null) {
        cleaned[key] = this.redact(value, visited);
      } else {
        cleaned[key] = value;
      }
    }

    return cleaned as T;
  }
}

export const defaultRedactor = new PIIRedactor();
