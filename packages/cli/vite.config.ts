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
      { find: /^@hachej\/boring-workspace$/, replacement: resolve(__dirname, "../workspace/src/index.ts") },
      { find: /^@hachej\/boring-workspace\/events$/, replacement: resolve(__dirname, "../workspace/src/front/events/index.ts") },
      { find: /^@hachej\/boring-workspace\/plugin$/, replacement: resolve(__dirname, "../workspace/src/plugin.ts") },
      { find: "@hachej/boring-workspace/app/front", replacement: resolve(__dirname, "../workspace/src/app/front/index.ts") },
      { find: /^@hachej\/boring-ask-user\/front$/, replacement: resolve(__dirname, "../../plugins/ask-user/src/front/index.tsx") },
      { find: /^@hachej\/boring-ask-user\/server$/, replacement: resolve(__dirname, "../../plugins/ask-user/src/server/index.ts") },
      { find: /^@hachej\/boring-ask-user\/shared$/, replacement: resolve(__dirname, "../../plugins/ask-user/src/shared/index.ts") },
      { find: /^@hachej\/boring-automation\/front$/, replacement: resolve(__dirname, "../../plugins/boring-automation/src/front/index.tsx") },
      { find: /^@hachej\/boring-diagram\/front$/, replacement: resolve(__dirname, "../../plugins/diagram/src/front/index.tsx") },
      { find: /^@hachej\/boring-diagram\/shared$/, replacement: resolve(__dirname, "../../plugins/diagram/src/shared/index.ts") },
      { find: /^@hachej\/boring-live-transcription\/front$/, replacement: resolve(__dirname, "../../plugins/live-transcription/src/front/index.tsx") },
      { find: /^@hachej\/boring-live-transcription\/shared$/, replacement: resolve(__dirname, "../../plugins/live-transcription/src/shared/index.ts") },
      { find: "@hachej/boring-agent/front", replacement: resolve(__dirname, "../agent/src/front/index.ts") },
      { find: "@hachej/boring-agent/shared", replacement: resolve(__dirname, "../agent/src/shared/index.ts") },
      { find: "@hachej/boring-agent", replacement: resolve(__dirname, "../agent/src/front/index.ts") },
      { find: /^@\/(.*)$/, replacement: resolve(__dirname, "../agent/src/$1") },
    ],
  },
  build: {
    outDir: "public",
    emptyOutDir: true,
  },
})
