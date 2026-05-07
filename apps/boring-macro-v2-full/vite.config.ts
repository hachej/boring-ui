import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"

const API_PORT = Number(process.env.API_PORT) || 5211
const PACKAGES = resolve(__dirname, "../../packages")
const APPS = resolve(__dirname, "..")
const useLocalPackages = process.env.BORING_USE_LOCAL_PACKAGES === "1"

const localPackageAlias = useLocalPackages
  ? [
      // Core aliases
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

// Always alias the macro plugin to its source — no dist for app packages.
const macroPluginAlias = {
  find: /^@boring\/macro\/plugin$/,
  replacement: resolve(APPS, "boring-macro-v2/src/plugins/macro/front/index.tsx"),
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "process.env": {},
  },
  resolve: {
    alias: [...(localPackageAlias ?? []), macroPluginAlias],
  },
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
    port: 5201,
    host: true,
    proxy: {
      "/api": `http://127.0.0.1:${API_PORT}`,
      // Proxy better-auth API calls but NOT /auth/signin or /auth/signup (frontend pages).
      "/auth": {
        target: `http://127.0.0.1:${API_PORT}`,
        bypass(req) {
          const path = (req.url ?? "").split("?")[0]
          if (path === "/auth/signin" || path === "/auth/signup") return req.url
        },
      },
      "/health": `http://127.0.0.1:${API_PORT}`,
      "/ready": `http://127.0.0.1:${API_PORT}`,
    },
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
