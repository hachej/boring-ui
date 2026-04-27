import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"
import { createWorkspaceAgentApp } from "../../packages/workspace/src/server/index"
import { mockApiPlugin } from "./src/mockApi"

// The playground is the standalone dev surface for @boring/workspace and
// deliberately runs WITHOUT @boring/core: no auth, no DB, no users. The
// only inline backend is the agent (so the chat surface has something to
// talk to during UI development); everything else is mock data served by
// mockApiPlugin (file tree, files, etc.).

const AGENT_API_PORT = Number(process.env.AGENT_API_PORT) || 5210
const VITE_PORT = Number(process.env.PORT) || 5200

let agentBoot: Promise<void> | null = null
async function startAgentApp() {
  if (agentBoot) return agentBoot
  agentBoot = (async () => {
    // createWorkspaceAgentApp wraps @boring/agent's createAgentApp and
    // additionally registers the UI bridge surface (get_ui_state /
    // exec_ui tools + /api/v1/ui/* routes) — agent stays a pure tool
    // harness, workspace owns its own concerns end-to-end.
    const app = await createWorkspaceAgentApp({
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
      "@boring/workspace/ui-shadcn": resolve(__dirname, "../../packages/workspace/src/components/ui/index.ts"),
      "@boring/workspace/shared": resolve(__dirname, "../../packages/workspace/src/shared/index.ts"),
      "@boring/workspace/server": resolve(__dirname, "../../packages/workspace/src/server/index.ts"),
      "@boring/workspace": resolve(__dirname, "../../packages/workspace/src/index.ts"),
      "@/": resolve(__dirname, "../../packages/workspace/src") + "/",
      "@": resolve(__dirname, "../../packages/workspace/src"),
    },
  },
  server: {
    port: VITE_PORT,
    host: true,
    proxy: {
      "/api/v1/agent": `http://127.0.0.1:${AGENT_API_PORT}`,
      "/api/v1/ui": `http://127.0.0.1:${AGENT_API_PORT}`,
    },
  },
})
