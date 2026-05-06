import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"

const API_PORT = Number(process.env.API_PORT) || 5210
const PACKAGES = resolve(__dirname, "../../packages")
const useLocalPackages = process.env.BORING_USE_LOCAL_PACKAGES === "1"
const localPackageAlias = useLocalPackages
  ? {
      // Order matters — most-specific subpaths first so `@hachej/boring-workspace`
      // doesn't shadow `@hachej/boring-workspace/testing` etc.
      "@hachej/boring-workspace/globals.css": resolve(PACKAGES, "workspace/src/globals.css"),
      "@hachej/boring-agent/front/styles.css": resolve(PACKAGES, "agent/src/front/styles/globals.css"),
      "@hachej/boring-workspace/app/front": resolve(PACKAGES, "workspace/src/app/front/index.ts"),
      "@hachej/boring-workspace/app/server": resolve(PACKAGES, "workspace/src/app/server/index.ts"),
      "@hachej/boring-workspace/charts": resolve(PACKAGES, "workspace/src/front/charts/index.tsx"),
      "@hachej/boring-workspace/testing": resolve(PACKAGES, "workspace/src/front/testing/index.ts"),
      "@hachej/boring-workspace/shared": resolve(PACKAGES, "workspace/src/shared/index.ts"),
      "@hachej/boring-workspace": resolve(PACKAGES, "workspace/src/index.ts"),
      "@/": resolve(PACKAGES, "workspace/src") + "/",
      "@": resolve(PACKAGES, "workspace/src"),
    }
  : undefined

// Default mode consumes @hachej/boring-* through package exports/dist, matching an npm
// consumer. Set BORING_USE_LOCAL_PACKAGES=1 for local package source aliases and
// fast HMR while developing workspace/agent internals.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "process.env": {},
  },
  resolve: localPackageAlias ? { alias: localPackageAlias } : undefined,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("recharts") || id.includes("victory-vendor")) return "vendor-recharts"
          if (id.includes("@codemirror/")) return "vendor-codemirror"
          if (id.includes("@tiptap/") || id.includes("lowlight")) return "vendor-tiptap"
        },
      },
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
    // Workspace root (= cwd in dev) holds user-editable files: deck/*.md,
    // tt.md, anything the agent writes. Without these ignores Vite triggers
    // a full page reload on every save, dropping the UI bridge SSE and
    // bouncing chat sessions. Watch only the app's own source.
    watch: {
      ignored: [
        "**/deck/**",
        "**/*.md",
        "**/test-results/**",
        "**/.tsbuildinfo*",
        "**/.vite/**",
        "**/.turbo/**",
        "**/dist/**",
      ],
    },
  },
})
