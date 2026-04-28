import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"

const API_PORT = Number(process.env.API_PORT) || 5210
const PACKAGES = resolve(__dirname, "../../packages")

// Alias @boring/workspace → its src/ so vite HMR picks up workspace edits
// without a rebuild. (Re-opens the 2026-04-28 "no src aliases" decision —
// portability still works because relocating the app to a new repo just
// changes these alias paths to whatever the new layout is. Faster
// inner-loop is worth the one-time config update.) See
// CONSOLIDATE_AND_STANDALONIZE.md portability section.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@boring/workspace/globals.css": resolve(PACKAGES, "workspace/src/globals.css"),
      "@boring/workspace": resolve(PACKAGES, "workspace/src/index.ts"),
      // Workspace's own source uses `@/lib/utils` etc. (its private alias).
      // When we consume workspace via src, those imports need to resolve
      // through the same map workspace's own vite uses.
      "@/": resolve(PACKAGES, "workspace/src") + "/",
      "@": resolve(PACKAGES, "workspace/src"),
    },
  },
  server: {
    port: 5200,
    host: true,
    proxy: {
      "/api": `http://127.0.0.1:${API_PORT}`,
      "/health": `http://127.0.0.1:${API_PORT}`,
      "/ready": `http://127.0.0.1:${API_PORT}`,
    },
  },
})
