import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import { createAskUserServerPlugin } from "@hachej/boring-workspace-ask-user/server"
import { createPlaygroundDataServerPlugin } from "../plugins/playgroundDataCatalog/server"

export const AGENT_API_PORT = Number(process.env.AGENT_API_PORT) || 5210
export const VITE_PORT = Number(process.env.PORT) || 5200
export const APP_ROOT = resolve(import.meta.dirname, "../..")
export const FIXTURES_DIR = resolve(APP_ROOT, "src/fixtures")
export const WORKSPACE_DIR = resolve(APP_ROOT, "workspace")

export function seedWorkspaceFromFixtures(): void {
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

export async function startPlaygroundServer(): Promise<void> {
  if (agentBoot) return agentBoot
  agentBoot = (async () => {
    seedWorkspaceFromFixtures()
    const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT ?? WORKSPACE_DIR
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "local",
      logger: true,
      plugins: [createPlaygroundDataServerPlugin({ workspaceRoot })],
      pluginFactories: [({ bridge }) => createAskUserServerPlugin({ workspaceRoot, bridge })],
    })
    await app.listen({ port: AGENT_API_PORT, host: "127.0.0.1" })
  })()
  return agentBoot
}
