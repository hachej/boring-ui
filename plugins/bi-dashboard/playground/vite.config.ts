import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"
import { AGENT_API_PORT, VITE_PORT, startBiDashboardPlaygroundServer } from "./src/server"

export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [
    tailwindcss(),
    react(),
    {
      name: "bi-dashboard-playground-server",
      async configureServer() {
        await startBiDashboardPlaygroundServer()
      },
    },
  ],
  resolve: {
    alias: [
      { find: "@hachej/boring-workspace/globals.css", replacement: resolve(import.meta.dirname, "../../../packages/workspace/src/globals.css") },
      { find: "@hachej/boring-workspace/plugin", replacement: resolve(import.meta.dirname, "../../../packages/workspace/src/plugin.ts") },
      { find: "@hachej/boring-workspace/app/front", replacement: resolve(import.meta.dirname, "../../../packages/workspace/src/app/front/index.ts") },
      { find: "@hachej/boring-workspace/app/server", replacement: resolve(import.meta.dirname, "../../../packages/workspace/src/app/server/index.ts") },
      { find: "@hachej/boring-workspace/server", replacement: resolve(import.meta.dirname, "../../../packages/workspace/src/server/index.ts") },
      { find: "@hachej/boring-workspace", replacement: resolve(import.meta.dirname, "../../../packages/workspace/src/index.ts") },
      { find: "@hachej/boring-ui-kit/styles.css", replacement: resolve(import.meta.dirname, "../../../packages/ui/src/styles.css") },
      { find: /^@hachej\/boring-ui-kit$/, replacement: resolve(import.meta.dirname, "../../../packages/ui/src/index.ts") },
      { find: "@hachej/boring-generated-pane/front", replacement: resolve(import.meta.dirname, "../../generated-pane/src/front/index.ts") },
      { find: "@hachej/boring-generated-pane/shared", replacement: resolve(import.meta.dirname, "../../generated-pane/src/shared/index.ts") },
      { find: /^@hachej\/boring-generated-pane$/, replacement: resolve(import.meta.dirname, "../../generated-pane/src/shared/index.ts") },
      { find: "@hachej/boring-data-bridge/server", replacement: resolve(import.meta.dirname, "../../data-bridge/src/server/index.ts") },
    ],
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    esbuildOptions: { target: "esnext" },
  },
  esbuild: { target: "esnext" },
  build: { target: "esnext" },
  server: {
    host: "0.0.0.0",
    port: VITE_PORT,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${AGENT_API_PORT}`,
    },
  },
})
