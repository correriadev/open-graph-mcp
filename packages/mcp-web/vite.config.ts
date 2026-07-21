import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// opencode/graph/layout imports node:fs/node:path for its persistence helpers, which the
// viewer never calls. Stub them so the browser bundle links (seedLayout/lodForZoom are pure).
const stub = fileURLToPath(new URL("./src/node-stub.ts", import.meta.url))

export default defineConfig(({ mode }) => ({
  define: { __OG_E2E__: JSON.stringify(mode === "e2e") },
  plugins: [react()],
  resolve: {
    alias: {
      "node:fs": stub,
      "node:path": stub,
      "@open-graph-mcp/client": fileURLToPath(new URL("../client/src/index.ts", import.meta.url)),
    },
  },
  server: { port: 5175 },
  build: { target: "esnext", sourcemap: true },
}))
