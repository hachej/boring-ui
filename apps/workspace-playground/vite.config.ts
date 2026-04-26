import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"
import { createAgentApp } from "@boring/agent/server"
import { mockApiPlugin } from "./src/mockApi"

const AGENT_API_PORT = Number(process.env.AGENT_API_PORT) || 5210

let agentBoot: Promise<void> | null = null
async function startAgentApp() {
  if (agentBoot) return agentBoot
  agentBoot = (async () => {
    const app = await createAgentApp({
      workspaceRoot: process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd(),
      mode: "local",
      logger: false,
    })
    await app.listen({ port: AGENT_API_PORT, host: "127.0.0.1" })
  })()
  return agentBoot
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    mockApiPlugin(),
    {
      name: "boring-agent-backend",
      async configureServer() {
        await startAgentApp()
      },
    },
  ],
  resolve: {
    alias: {
      "@boring/workspace/globals.css": resolve(__dirname, "../../packages/workspace/src/globals.css"),
      "@boring/workspace": resolve(__dirname, "../../packages/workspace/src/index.ts"),
      "@/": resolve(__dirname, "../../packages/workspace/src") + "/",
      "@": resolve(__dirname, "../../packages/workspace/src"),
    },
  },
  server: {
    port: 5200,
    // Bind to all interfaces so the dev server is reachable from outside
    // the VM (the OVH coding box is accessed by external IP). The previous
    // localhost-only bind broke remote access.
    host: true,
    proxy: {
      "/api/v1/agent": `http://127.0.0.1:${AGENT_API_PORT}`,
      "/api/v1/ui": `http://127.0.0.1:${AGENT_API_PORT}`,
    },
  },
})
