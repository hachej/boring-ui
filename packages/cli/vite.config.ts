import { resolve } from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { createBoringAppViteAliases } from "@hachej/boring-core/app/vite"

const baseResolve = createBoringAppViteAliases({ appRoot: __dirname })

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    ...baseResolve,
    alias: [
      ...baseResolve.alias,
      { find: "@hachej/boring-workspace/globals.css", replacement: resolve(__dirname, "../workspace/src/globals.css") },
      { find: "@hachej/boring-agent/front/styles.css", replacement: resolve(__dirname, "../agent/src/front/styles/globals.css") },
      { find: "@hachej/boring-workspace/app/front", replacement: resolve(__dirname, "../workspace/dist/app-front.js") },
      { find: "@hachej/boring-agent/front", replacement: resolve(__dirname, "../agent/dist/front/index.js") },
      { find: "@hachej/boring-agent/shared", replacement: resolve(__dirname, "../agent/dist/shared/index.js") },
      { find: "@hachej/boring-agent", replacement: resolve(__dirname, "../agent/dist/front/index.js") },
    ],
  },
  build: {
    outDir: "public",
    emptyOutDir: true,
  },
})
