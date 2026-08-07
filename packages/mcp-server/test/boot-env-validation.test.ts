/**
 * boot-env-validation.test.ts — WS-D. Two boot-time env-var gaps in `import.meta.main` (src/index.ts):
 *
 * 1. Tier 1 fix (applied): `PORT` was `Number(process.env.PORT ?? 8787)` with no validation — garbage
 *    (`PORT=abc`, `PORT=-1`, `PORT=99999`) silently became `NaN`, and `Bun.serve({ port: NaN })` falls
 *    back to a random ephemeral port instead of refusing, hiding a config error behind "the server came
 *    up somewhere". Extracted `parsePortEnv` as a pure function (same pattern as the pre-existing
 *    `parseDomainsEnv`), used ONLY inside the `import.meta.main` block — `startServer`'s signature and
 *    every other test's call to it are untouched.
 *
 * 2. `ALLOWED_ORIGINS=""` must fail CLOSED: `"".split(",").map(trim).filter(Boolean)` produces `[]`, not
 *    `undefined` — every Origin gets rejected, which is the opposite of leaving it unset (open, `["*"]`
 *    default). The code comment at the bottom of index.ts already calls this out as deliberate; pinned
 *    here at the HTTP layer so nobody "simplifies" `ALLOWED_ORIGINS=""` into meaning the same as unset.
 */
import { expect, test } from "bun:test"
import { parsePortEnv, startServer } from "../src/index"

// ---------------------------------------------------------------------------
// parsePortEnv
// ---------------------------------------------------------------------------

test("PORT não setado: parsePortEnv devolve o default 8787", () => {
  expect(parsePortEnv(undefined)).toBe(8787)
});

test("PORT válido: parsePortEnv devolve o inteiro", () => {
  expect(parsePortEnv("3000")).toBe(3000)
});

test("PORT não-numérico ('abc'): parsePortEnv falha alto, não vira NaN", () => {
  expect(() => parsePortEnv("abc")).toThrow(/PORT inválido/)
});

test("PORT vazio (''): parsePortEnv falha alto", () => {
  expect(() => parsePortEnv("")).toThrow(/PORT inválido/)
});

test("PORT negativo: parsePortEnv rejeita (fora do range de portas)", () => {
  expect(() => parsePortEnv("-1")).toThrow(/PORT inválido/)
});

test("PORT fracionário ('8080.5'): parsePortEnv rejeita", () => {
  expect(() => parsePortEnv("8080.5")).toThrow(/PORT inválido/)
});

test("PORT acima de 65535: parsePortEnv rejeita", () => {
  expect(() => parsePortEnv("99999")).toThrow(/PORT inválido/)
});

test("PORT zero: parsePortEnv rejeita (não é uma porta válida)", () => {
  expect(() => parsePortEnv("0")).toThrow(/PORT inválido/)
});

test("PORT com espaço em volta ('  3000  '): parsePortEnv tolera e parseia", () => {
  expect(parsePortEnv("  3000  ")).toBe(3000)
});

// ---------------------------------------------------------------------------
// ALLOWED_ORIGINS="" fails CLOSED — HTTP-layer pin
// ---------------------------------------------------------------------------

test("allowedOrigins: [] (equivalente a ALLOWED_ORIGINS=\"\") rejeita TODO Origin de browser com 403", async () => {
  const s = startServer({ allowedOrigins: [] })
  try {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example.com" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
    expect(res.status).toBe(403)

    // Even a plausible, legitimate-looking origin is rejected — [] means [], not "open".
    const res2 = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.example.com" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
    expect(res2.status).toBe(403)
  } finally {
    s.stop()
  }
});

test("allowedOrigins: [] ainda permite requests SEM Origin (clientes não-browser não são o alvo do guard)", async () => {
  const s = startServer({ allowedOrigins: [] })
  try {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" }, // no Origin header — curl/SDK-style caller
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
    expect(res.status).toBe(200)
  } finally {
    s.stop()
  }
});

test("allowedOrigins não setado (default): permanece aberto — QUALQUER Origin é aceito (D2)", async () => {
  const s = startServer() // no allowedOrigins passed → StartOptions default ["*"]
  try {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://anything.example.com" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
    expect(res.status).toBe(200)
  } finally {
    s.stop()
  }
});
