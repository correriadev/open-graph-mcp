import { defineConfig } from "@playwright/test"

// QD3/QD4: chromium only, against a real vite build (each spec's fixture.ts starts its own
// server+preview instance) — no shared webServer here, specs own their own harness lifecycle
// so reconnect.e2e.ts can kill+restart the server mid-test.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // QD2/roadmap-qa: flake is a bug, never masked by retry
  reporter: process.env.CI ? "line" : "list",
  use: {
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
})
