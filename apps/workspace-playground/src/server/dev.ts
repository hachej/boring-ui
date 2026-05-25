import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"

export const AGENT_API_PORT = Number(process.env.AGENT_API_PORT) || 5210
export const VITE_PORT = Number(process.env.PORT) || 5200
export const APP_ROOT = resolve(import.meta.dirname, "../..")
export const FIXTURES_DIR = resolve(APP_ROOT, "src/fixtures")
export const WORKSPACE_DIR = resolve(APP_ROOT, "workspace")

function seedFixtureEntry(srcRoot: string, destRoot: string): void {
  for (const name of readdirSync(srcRoot)) {
    const src = resolve(srcRoot, name)
    const stats = statSync(src)
    if (stats.isDirectory()) {
      seedFixtureEntry(src, resolve(destRoot, name))
      continue
    }
    if (!stats.isFile()) continue
    const dest = resolve(destRoot, name)
    if (existsSync(dest)) continue
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(src, dest)
  }
}

export function seedWorkspaceFromFixtures(): void {
  if (!existsSync(WORKSPACE_DIR)) {
    mkdirSync(WORKSPACE_DIR, { recursive: true })
  }
  seedFixtureEntry(FIXTURES_DIR, WORKSPACE_DIR)
}

let agentBoot: Promise<void> | null = null

export async function startPlaygroundServer(): Promise<void> {
  if (agentBoot) return agentBoot
  agentBoot = (async () => {
    seedWorkspaceFromFixtures()
    const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT ?? WORKSPACE_DIR
    console.log(`[workspace-playground] workspace root: ${workspaceRoot}`)
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "local",
      logger: true,
      // App-default plugins are declared in apps/workspace-playground/
      // package.json#boring.defaultPluginPackages — the canonical app
      // manifest. The workspace reads them from there and flows each
      // entry through the standard load process (asset manager scan,
      // SSE event, front dynamic-import, jiti reload).
      appPackageJsonPath: resolve(APP_ROOT, "package.json"),
    })
    await app.listen({ port: AGENT_API_PORT, host: "127.0.0.1" })
  })()
  return agentBoot
}
