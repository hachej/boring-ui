import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"

const API_PORT = Number(process.env.API_PORT) || 5210
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 5200
const PACKAGES = resolve(__dirname, "../../packages")

// Alias @boring/workspace → its src/ so vite HMR picks up workspace edits
// without a rebuild. (Re-opens the 2026-04-28 "no src aliases" decision —
// portability still works because relocating the app to a new repo just
// changes these alias paths to whatever the new layout is. Faster
// inner-loop is worth the one-time config update.) See
// CONSOLIDATE_AND_STANDALONIZE.md portability section.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "process.env": {},
  },
  resolve: {
    alias: {
      // Order matters — most-specific subpaths first so `@boring/workspace`
      // doesn't shadow `@boring/workspace/testing` etc.
      "@boring/workspace/charts": resolve(PACKAGES, "workspace/src/front/charts/index.tsx"),
      "@boring/workspace/globals.css": resolve(PACKAGES, "workspace/src/globals.css"),
      "@boring/agent/front/styles.css": resolve(PACKAGES, "agent/src/front/styles/globals.css"),
      "@boring/workspace/app/front": resolve(PACKAGES, "workspace/src/app/front/index.ts"),
      "@boring/workspace/app/server": resolve(PACKAGES, "workspace/src/app/server/index.ts"),
      "@boring/workspace/testing": resolve(PACKAGES, "workspace/src/testing/index.ts"),
      "@boring/workspace/ui-shadcn": resolve(PACKAGES, "workspace/src/components/ui/index.ts"),
      "@boring/workspace/shared": resolve(PACKAGES, "workspace/src/shared/index.ts"),
      "@boring/workspace": resolve(PACKAGES, "workspace/src/index.ts"),
      // Workspace's own source uses `@/front/lib/utils` etc. (its private alias).
      // When we consume workspace via src, those imports need to resolve
      // through the same map workspace's own vite uses.
      "@/": resolve(PACKAGES, "workspace/src") + "/",
      "@": resolve(PACKAGES, "workspace/src"),
    },
  },
  server: {
    port: FRONTEND_PORT,
    host: true,
    proxy: {
      "/api": `http://127.0.0.1:${API_PORT}`,
      "/health": `http://127.0.0.1:${API_PORT}`,
      "/ready": `http://127.0.0.1:${API_PORT}`,
    },
    // Workspace root (= cwd in dev) holds user-editable files: deck/*.md,
    // tt.md, anything the agent writes. Without these ignores Vite triggers
    // a full page reload on every save, dropping the UI bridge SSE and
    // bouncing chat sessions. Watch only the app's own source.
    watch: {
      ignored: [
        "**/deck/**",
        "**/*.md",
        "**/src/plugins/**/front/**",
        "**/test-results/**",
        "**/.tsbuildinfo*",
        "**/.vite/**",
        "**/.turbo/**",
        "**/dist/**",
      ],
    },
  },
})
