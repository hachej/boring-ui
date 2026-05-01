import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs"
import { createWorkspaceAgentApp } from "../../packages/workspace/src/app"
import { createPlaygroundDataServerPlugin } from "./src/plugins/playgroundDataCatalog/server"

// The playground is the standalone dev surface for @boring/workspace.
// Backend is the agent package's Fastify app — same one production uses —
// so the file tree, file editor, and agent chat all hit the SAME paths
// against the SAME filesystem. No mock API.
//
// Workspace layout:
//   src/fixtures/  — committed seed content (reference, read-only)
//   workspace/     — gitignored runtime root the agent reads/writes/edits
//
// On dev start we seed missing fixture files into `workspace/`, so a fresh
// clone has demo content while existing runtime edits are not overwritten.

const AGENT_API_PORT = Number(process.env.AGENT_API_PORT) || 5210
const VITE_PORT = Number(process.env.PORT) || 5200
const FIXTURES_DIR = resolve(__dirname, "src/fixtures")
const WORKSPACE_DIR = resolve(__dirname, "workspace")
const TEMPLATE_DIR = resolve(__dirname, "workspace-template")

function seedWorkspaceFromFixtures(): void {
  if (!existsSync(WORKSPACE_DIR)) {
    mkdirSync(WORKSPACE_DIR, { recursive: true })
  }
  for (const name of readdirSync(FIXTURES_DIR)) {
    const src = resolve(FIXTURES_DIR, name)
    if (!statSync(src).isFile()) continue
    const dest = resolve(WORKSPACE_DIR, name)
    if (existsSync(dest)) continue
    copyFileSync(src, dest)
  }
}

let agentBoot: Promise<void> | null = null
async function startAgentApp() {
  if (agentBoot) return agentBoot
  agentBoot = (async () => {
    // createWorkspaceAgentApp wraps @boring/agent's createAgentApp and
    // additionally registers the UI bridge surface (get_ui_state /
    // exec_ui tools + /api/v1/ui/* routes) plus the file/tree/stat HTTP
    // endpoints the workspace frontend calls. One server, one filesystem,
    // one set of paths — agent and frontend can't drift apart.
    seedWorkspaceFromFixtures()
    const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT ?? WORKSPACE_DIR
    const app = await createWorkspaceAgentApp({
      workspaceRoot,
      templatePath: TEMPLATE_DIR,
      mode: "local",
      logger: true,
      plugins: [createPlaygroundDataServerPlugin({ workspaceRoot })],
    })
    await app.listen({ port: AGENT_API_PORT, host: "127.0.0.1" })
  })()
  return agentBoot
}

export default defineConfig({
  define: {
    "process.env": {},
  },
  plugins: [
    react(),
    tailwindcss(),
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
      "@boring/agent/front/styles.css": resolve(__dirname, "../../packages/agent/src/front/styles/globals.css"),
      "@boring/workspace/ui-shadcn": resolve(__dirname, "../../packages/workspace/src/front/components/ui/index.ts"),
      "@boring/workspace/shared": resolve(__dirname, "../../packages/workspace/src/shared/index.ts"),
      "@boring/workspace/testing": resolve(__dirname, "../../packages/workspace/src/front/testing/index.ts"),
      "@boring/workspace": resolve(__dirname, "../../packages/workspace/src/index.ts"),
      // Agent: consumed via package exports (dist). Live edits to agent
      // require `pnpm --filter @boring/agent build` + restart. Tried
      // aliasing to src here, but agent's source uses its OWN `@/` alias
      // for internal imports (~23 files like `@/front/lib`) that
      // conflicts with workspace's `@/` alias — vite has one global `@`,
      // so they can't coexist. Stay on dist for now.
      "@/": resolve(__dirname, "../../packages/workspace/src") + "/",
      "@": resolve(__dirname, "../../packages/workspace/src"),
    },
  },
  server: {
    port: VITE_PORT,
    host: true,
    proxy: {
      // All API traffic goes to the agent server — the agent owns the
      // filesystem and the UI bridge. No vite-side mocks.
      "/api/v1": `http://127.0.0.1:${AGENT_API_PORT}`,
    },
  },
})
