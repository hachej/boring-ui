import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { createRemoteWorkerModeAdapter } from "@hachej/boring-agent/server"
import { createReadonlyProjectionOperations } from "@hachej/boring-bash/server"
import { createNodeWorkspace } from "@hachej/boring-sandbox/providers/node-workspace"
import { createPersistedScriptedPiHarness } from "./testing/scriptedPiHarness"
import {
  SCRIPTED_TWO_AGENT_CAPABILITY_PLUGINS,
  SCRIPTED_TWO_AGENT_DEFAULT,
  SCRIPTED_TWO_AGENT_FLEET,
} from "./testing/twoAgentFleet"
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import { createWorkspaceBeadsOperations } from "@hachej/boring-tasks/server"
import { loadBoringFactoryAgents } from "./factoryAgents"

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
    const beadsOperations = remoteWorkerModeAdapter
      ? undefined
      : createWorkspaceBeadsOperations(createNodeWorkspace(workspaceRoot))
    const localRuntimeMode = process.env.BORING_AGENT_MODE?.trim() === "direct" ? "direct" : "local"
    const factoryAgentsEnabled = process.env.VITE_BORING_FACTORY_AGENTS === "1"
    const factoryAgents = factoryAgentsEnabled ? await loadBoringFactoryAgents() : undefined
    const multiFilesystemPlayground = process.env.BORING_WORKSPACE_PLAYGROUND_MULTI_FS === "1" || process.env.VITE_PLAYGROUND_MULTI_FS === "1"
    const companyContextRoot = resolve(process.env.BORING_WORKSPACE_PLAYGROUND_COMPANY_CONTEXT_ROOT || workspaceRoot)
    if (multiFilesystemPlayground) mkdirSync(companyContextRoot, { recursive: true })
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
      // Explicit so the playground exercises the same `.agents` protection
      // production hosts get, instead of relying on the library default.
      readonlyWorkspacePaths: [".agents"],
      ...(factoryAgents ? { agents: factoryAgents, defaultAgentTypeId: "boring-concierge" } : {}),
      externalPlugins: EXTERNAL_PLUGINS_ENABLED,
      ...(process.env.BORING_AGENT_E2E_SCRIPTED_PI === "1"
        ? {
            harnessFactory: createPersistedScriptedPiHarness,
            agents: SCRIPTED_TWO_AGENT_FLEET,
            defaultAgentTypeId: SCRIPTED_TWO_AGENT_DEFAULT,
          }
        : {}),
      plugins: [
        {
          dir: resolve(APP_ROOT, "../../plugins/tasks"),
          options: {
            beadsOperations,
            config: { providers: [{ provider: "github", repo: "auto" }, { provider: "beads" }] },
          },
          trust: "internal",
        },
        ...(process.env.BORING_AGENT_E2E_SCRIPTED_PI === "1"
          ? SCRIPTED_TWO_AGENT_CAPABILITY_PLUGINS
          : []),
      ],
      defaultPluginPackages: ["@hachej/boring-ask-user", "@hachej/boring-diagram"],
      getFilesystemBindings: multiFilesystemPlayground
        ? async () => [{
            filesystem: "company_context",
            access: "readonly",
            operations: createReadonlyProjectionOperations({
              filesystem: "company_context",
              projectionRoot: companyContextRoot,
            }),
          }]
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
