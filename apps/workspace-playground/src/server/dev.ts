import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { createRemoteWorkerModeAdapter } from "@hachej/boring-agent/server"
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"

export const AGENT_API_PORT = Number(process.env.AGENT_API_PORT) || 5210
export const VITE_PORT = Number(process.env.PORT) || 5200
export const APP_ROOT = resolve(import.meta.dirname, "../..")
export const FIXTURES_DIR = resolve(APP_ROOT, "src/fixtures")
export const WORKSPACE_DIR = resolve(APP_ROOT, "workspace")
const EXTERNAL_PLUGINS_ENABLED = process.env.BORING_EXTERNAL_PLUGINS === "1"

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

export function seedWorkspaceFromFixtures(workspaceRoot = WORKSPACE_DIR): void {
  if (!existsSync(workspaceRoot)) {
    mkdirSync(workspaceRoot, { recursive: true })
  }
  seedFixtureEntry(FIXTURES_DIR, workspaceRoot)
}

let agentBoot: Promise<void> | null = null

export async function startPlaygroundServer(): Promise<void> {
  if (agentBoot) return agentBoot
  agentBoot = (async () => {
    const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT ?? WORKSPACE_DIR
    if (process.env.BORING_WORKSPACE_PLAYGROUND_SEED_FIXTURES !== "0") {
      seedWorkspaceFromFixtures(workspaceRoot)
    }
    const workerBaseUrl = process.env.BORING_WORKER_BASE_URL?.trim()
    const remoteWorkerModeAdapter = workerBaseUrl
      ? createRemoteWorkerModeAdapter({ baseUrl: workerBaseUrl })
      : undefined
    const remoteWorkerWorkspaceId = remoteWorkerModeAdapter
      ? (process.env.BORING_WORKSPACE_PLAYGROUND_WORKSPACE_ID?.trim() || randomUUID())
      : undefined
    console.log(`[workspace-playground] workspace root: ${workspaceRoot}`)
    console.log(`[workspace-playground] runtime mode: ${remoteWorkerModeAdapter ? "remote-worker" : "local"}`)
    if (remoteWorkerWorkspaceId) {
      console.log(`[workspace-playground] remote worker workspace id: ${remoteWorkerWorkspaceId}`)
    }
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      appRoot: APP_ROOT,
      sessionId: remoteWorkerWorkspaceId,
      mode: remoteWorkerModeAdapter ? undefined : "local",
      runtimeModeAdapter: remoteWorkerModeAdapter,
      logger: true,
      externalPlugins: EXTERNAL_PLUGINS_ENABLED,
      defaultPluginPackages: ["@hachej/boring-ask-user"],
    })
    app.get("/api/v1/workspace/meta", async () => ({
      projectName: basename(workspaceRoot) || "Workspace",
      workspaceId: remoteWorkerWorkspaceId ?? (basename(workspaceRoot) || "Workspace"),
      workspaceRoot,
    }))
    await app.listen({ port: AGENT_API_PORT, host: "127.0.0.1" })
  })()
  return agentBoot
}
