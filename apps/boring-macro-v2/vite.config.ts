import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"

const API_PORT = Number(process.env.API_PORT) || 5210
const PACKAGES = resolve(__dirname, "../../packages")
const useLocalPackages = process.env.BORING_USE_LOCAL_PACKAGES === "1"
const localPackageAlias = useLocalPackages
  ? [
      // Core aliases — order matters: most-specific subpaths first
      { find: "@hachej/boring-core/front/top-bar-slot", replacement: resolve(PACKAGES, "core/src/front/components/TopBarSlot.tsx") },
      { find: "@hachej/boring-core/app/front/styles.css", replacement: resolve(PACKAGES, "core/src/app/front/styles.css") },
      { find: /^@hachej\/boring-core\/app\/front$/, replacement: resolve(PACKAGES, "core/src/app/front/index.ts") },
      { find: /^@hachej\/boring-core\/front$/, replacement: resolve(PACKAGES, "core/src/front/index.ts") },
      { find: "@hachej/boring-core/theme.css", replacement: resolve(PACKAGES, "core/src/front/theme.css") },
      // Workspace + agent aliases
      { find: "@hachej/boring-workspace/globals.css", replacement: resolve(PACKAGES, "workspace/src/globals.css") },
      { find: "@hachej/boring-agent/front/styles.css", replacement: resolve(PACKAGES, "agent/src/front/styles/globals.css") },
      { find: /^@hachej\/boring-workspace\/app\/front$/, replacement: resolve(PACKAGES, "workspace/src/app/front/index.ts") },
      { find: /^@hachej\/boring-workspace\/app\/server$/, replacement: resolve(PACKAGES, "workspace/src/app/server/index.ts") },
      { find: /^@hachej\/boring-workspace\/charts$/, replacement: resolve(PACKAGES, "workspace/src/front/charts/index.tsx") },
      { find: /^@hachej\/boring-workspace\/testing$/, replacement: resolve(PACKAGES, "workspace/src/front/testing/index.ts") },
      { find: /^@hachej\/boring-workspace\/shared$/, replacement: resolve(PACKAGES, "workspace/src/shared/index.ts") },
      { find: /^@hachej\/boring-workspace$/, replacement: resolve(PACKAGES, "workspace/src/index.ts") },
      { find: "@/", replacement: resolve(PACKAGES, "workspace/src") + "/" },
      { find: "@", replacement: resolve(PACKAGES, "workspace/src") },
    ]
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
    outDir: "dist/front",
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
