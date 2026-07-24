import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs"
import { readFile, readdir, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, relative, resolve } from "node:path"
import { createRemoteWorkerModeAdapter } from "@hachej/boring-agent/server"
import { createPersistedScriptedPiHarness } from "@hachej/boring-agent/server/testing/scriptedPiHarness"
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import { createTasksServerPlugin } from "@hachej/boring-tasks/server"

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

function resolvePlaygroundBindingPath(root: string, rawPath: string): string {
  const normalized = rawPath.trim() || "/"
  const withoutLeadingSlash = normalized.replace(/^\/+/, "")
  const resolved = resolve(root, withoutLeadingSlash || ".")
  const rel = relative(root, resolved)
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return resolved
  throw new Error("path escapes playground binding root")
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
    const localRuntimeMode = process.env.BORING_AGENT_MODE?.trim() === "direct" ? "direct" : "local"
    const multiFilesystemPlayground = process.env.BORING_WORKSPACE_PLAYGROUND_MULTI_FS === "1" || process.env.VITE_PLAYGROUND_MULTI_FS === "1"
    console.log(`[workspace-playground] workspace root: ${workspaceRoot}`)
    console.log(`[workspace-playground] runtime mode: ${remoteWorkerModeAdapter ? "remote-worker" : localRuntimeMode}`)
    if (remoteWorkerWorkspaceId) {
      console.log(`[workspace-playground] remote worker workspace id: ${remoteWorkerWorkspaceId}`)
    }
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      appRoot: APP_ROOT,
      sessionId: remoteWorkerWorkspaceId,
      mode: remoteWorkerModeAdapter ? undefined : localRuntimeMode,
      runtimeModeAdapter: remoteWorkerModeAdapter,
      logger: true,
      externalPlugins: EXTERNAL_PLUGINS_ENABLED,
      ...(process.env.BORING_AGENT_E2E_SCRIPTED_PI === "1"
        ? { harnessFactory: createPersistedScriptedPiHarness }
        : {}),
      plugins: [createTasksServerPlugin({
        workspaceRoot,
        config: { providers: [{ provider: "github", repo: "auto" }] },
      })],
      defaultPluginPackages: ["@hachej/boring-ask-user", "@hachej/boring-diagram"],
      runtimeProvisioner: multiFilesystemPlayground
        ? async ({ runtimeBundle }) => {
            const bundle = runtimeBundle as typeof runtimeBundle & { filesystemBindings?: unknown[] }
            bundle.filesystemBindings = [
              ...(bundle.filesystemBindings ?? []),
              {
                filesystem: "company_context",
                access: "readonly",
                operations: {
                  async read({ path }: { path: string }) {
                    const target = resolvePlaygroundBindingPath(workspaceRoot, path)
                    return { content: await readFile(target, "utf8") }
                  },
                  async list({ path }: { path: string }) {
                    const target = resolvePlaygroundBindingPath(workspaceRoot, path)
                    return { entries: await readdir(target) }
                  },
                  async find() {
                    return { paths: [] }
                  },
                  async grep() {
                    return { matches: [] }
                  },
                  async stat({ path }: { path: string }) {
                    const target = resolvePlaygroundBindingPath(workspaceRoot, path)
                    return { isDirectory: (await stat(target)).isDirectory() }
                  },
                  rejectMutation(operation: string) {
                    throw new Error(`company_context binding is readonly: ${operation}`)
                  },
                },
              },
            ]
          }
        : undefined,
      workspaceBridge: { allowInsecureLocalCliBrowserAuth: true },
    })
    app.get("/api/v1/workspace/meta", async () => {
      const localName = basename(workspaceRoot) || "Workspace"
      return {
        projectName: remoteWorkerWorkspaceId ? "Remote worker playground" : localName,
        workspaceId: remoteWorkerWorkspaceId ?? localName,
        workspaceRoot,
      }
    })
    await app.listen({ port: AGENT_API_PORT, host: "127.0.0.1" })
  })()
  return agentBoot
}
