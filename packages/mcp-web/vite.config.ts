import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

// opencode/graph/layout imports node:fs/node:path for its persistence helpers, which the
// viewer never calls. Stub them so the browser bundle links (seedLayout/lodForZoom are pure).
const stub = fileURLToPath(new URL("./src/node-stub.ts", import.meta.url))

export default defineConfig({
  resolve: { alias: { "node:fs": stub, "node:path": stub } },
  server: { port: 5175 },
  build: { target: "esnext", sourcemap: true },
})
