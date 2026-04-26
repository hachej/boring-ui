import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"
import { mockApiPlugin } from "./src/mockApi"
import { startCoreServer } from "./src/server/main"

const CORE_API_PORT = Number(process.env.CORE_PORT) || 5420

let coreBoot: Promise<void> | null = null
async function startCoreApp() {
  if (coreBoot) return coreBoot
  coreBoot = (async () => {
    await startCoreServer(CORE_API_PORT)
  })()
  return coreBoot
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    mockApiPlugin(),
    {
      name: "boring-core-backend",
      async configureServer() {
        await startCoreApp()
      },
    },
  ],
  resolve: {
    alias: {
      "@boring/workspace/globals.css": resolve(__dirname, "../../packages/workspace/src/globals.css"),
      "@boring/workspace/ui-shadcn": resolve(__dirname, "../../packages/workspace/src/components/ui/index.ts"),
      "@boring/workspace": resolve(__dirname, "../../packages/workspace/src/index.ts"),
      "@boring/core/front": resolve(__dirname, "../../packages/core/src/front/index.ts"),
      "@/": resolve(__dirname, "../../packages/workspace/src") + "/",
      "@": resolve(__dirname, "../../packages/workspace/src"),
    },
  },
  server: {
    port: 5400,
    host: true,
    proxy: {
      "/auth": `http://127.0.0.1:${CORE_API_PORT}`,
      "/health": `http://127.0.0.1:${CORE_API_PORT}`,
      "/api/v1/config": `http://127.0.0.1:${CORE_API_PORT}`,
      "/api/v1/me": `http://127.0.0.1:${CORE_API_PORT}`,
      "/api/v1/workspaces": `http://127.0.0.1:${CORE_API_PORT}`,
      "/api/v1/capabilities": `http://127.0.0.1:${CORE_API_PORT}`,
    },
  },
})
