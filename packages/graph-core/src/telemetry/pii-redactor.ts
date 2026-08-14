export const DEFAULT_REDACT_KEYS = [
  "token",
  "bearertoken",
  "password",
  "secret",
  "sessionkey",
  "authorization",
  "privatekey",
  "apikey",
  "credentials",
];

const REDACTED_MARKER = "***REDACTED***";

export class PIIRedactor {
  private redactKeySet: Set<string>;

  constructor(customKeys: string[] = []) {
    const combined = [...DEFAULT_REDACT_KEYS, ...customKeys.map((k) => k.toLowerCase())];
    this.redactKeySet = new Set(combined);
  }

  public shouldRedact(key: string): boolean {
    const lowerKey = key.toLowerCase();
    if (this.redactKeySet.has(lowerKey)) return true;
    for (const pattern of this.redactKeySet) {
      if (lowerKey.includes(pattern)) return true;
    }
    return false;
  }

  public redact<T>(val: T): T {
    if (val === null || val === undefined) return val;
    if (typeof val === "string") return val as unknown as T;
    if (typeof val !== "object") return val;

    if (Array.isArray(val)) {
      return val.map((item) => this.redact(item)) as unknown as T;
    }

    const obj = val as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (this.shouldRedact(key)) {
        cleaned[key] = REDACTED_MARKER;
      } else if (typeof value === "object" && value !== null) {
        cleaned[key] = this.redact(value);
      } else {
        cleaned[key] = value;
      }
    }

    return cleaned as T;
  }
}

export const defaultRedactor = new PIIRedactor();
