import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { createRemoteWorkerModeAdapter } from "@hachej/boring-agent/server"
import { createReadonlyProjectionOperations } from "@hachej/boring-bash/server"
import { createNodeWorkspace } from "@hachej/boring-sandbox/providers/node-workspace"
import { createPersistedScriptedPiHarness, isPlaygroundShowcaseSession, markPlaygroundShowcaseSession } from "./testing/scriptedPiHarness"
import { PLAYGROUND_SHOWCASE_SESSION_ROUTE } from "../shared/showcaseSession"
import {
  SCRIPTED_ONE_AGENT,
  SCRIPTED_ONE_AGENT_CAPABILITY_PLUGINS,
  SCRIPTED_TWO_AGENT_CAPABILITY_PLUGINS,
  SCRIPTED_TWO_AGENT_FLEET,
} from "./testing/twoAgentFleet"
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import { createWorkspaceBeadsOperations } from "@hachej/boring-tasks/server"
import { loadBoringFactoryAgents } from "./factoryAgents"
import { resolvePlaygroundAgentMode } from "./playgroundAgentMode"
import { resolvePlaygroundDefaultAgentTypeId } from "../shared/playgroundAgents"

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
    const agentMode = resolvePlaygroundAgentMode(process.env)
    // Same `workspaceRoot` value that is handed to createWorkspaceAgentServer
    // below: the fleet's instruction refs are addressed against the filesystem
    // this server actually serves, so they resolve or are not published.
    const factoryAgents = agentMode === "factory" ? await loadBoringFactoryAgents({}) : undefined
    const scriptedAgents = agentMode === "scripted-multi" ? SCRIPTED_TWO_AGENT_FLEET : SCRIPTED_ONE_AGENT
    const agents = factoryAgents ?? scriptedAgents
    const defaultAgentTypeId = resolvePlaygroundDefaultAgentTypeId(agents)
    const scriptedCapabilityPlugins = agentMode === "scripted-multi"
      ? SCRIPTED_TWO_AGENT_CAPABILITY_PLUGINS
      : agentMode === "scripted-single" ? SCRIPTED_ONE_AGENT_CAPABILITY_PLUGINS : []
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
      agents,
      defaultAgentTypeId,
      externalPlugins: EXTERNAL_PLUGINS_ENABLED,
      ...(agentMode === "factory" ? {} : { harnessFactory: createPersistedScriptedPiHarness }),
      plugins: [
        {
          dir: resolve(APP_ROOT, "../../plugins/tasks"),
          options: {
            beadsOperations,
            config: { providers: [{ provider: "github", repo: "auto" }, { provider: "beads" }] },
          },
          trust: "internal",
        },
        ...scriptedCapabilityPlugins,
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
        defaultAgentTypeId,
      }
    })
    // Dev-only wrapper the `?showcase=1` route creates every one of its
    // sessions through (see PLAYGROUND_SHOWCASE_SESSION_ROUTE). It forwards
    // to the ordinary create-session endpoint unchanged via `app.inject`
    // (no extra network hop, no duplicated auth/validation logic) and then
    // records the resulting id in the showcase provenance registry that
    // scriptedPiHarness.ts's boot-time sweep reads. Provenance lives in
    // *which route created the session*, not in title text — the ordinary
    // session-creation UI never calls this route, so nothing a user types
    // into a title can mark (or accidentally un-mark) a session here. See
    // apps/workspace-playground/src/shared/showcaseSession.ts.
    app.post(PLAYGROUND_SHOWCASE_SESSION_ROUTE, async (request, reply) => {
      const body = (request.body ?? {}) as { agentTypeId?: unknown; title?: unknown; requestId?: unknown; resumeSessionId?: unknown }
      const targetAgentTypeId = typeof body.agentTypeId === "string" && body.agentTypeId.trim() ? body.agentTypeId.trim() : defaultAgentTypeId
      const forwardBody: Record<string, unknown> = {}
      if (typeof body.title === "string") forwardBody.title = body.title
      if (typeof body.requestId === "string") forwardBody.requestId = body.requestId
      // `resumeSessionId` travels through the client's writable
      // sessionStorage (App.tsx) — a stale or manipulated value could
      // otherwise name an ordinary session this wrapper never created and
      // marked (or a showcase session belonging to a *different* agent
      // type — scripted session ids are only unique within one agent
      // namespace, so 'scripted-main' under `targetAgentTypeId` is a
      // different session than 'scripted-main' under any other agent), and
      // the gateway would happily hand that session's ref back
      // (embeddedGateway.ts createSession resumes any empty session it can
      // resolve, regardless of who created it). Only ever forward it when
      // it already names a session this wrapper itself previously marked
      // for THIS EXACT `targetAgentTypeId` — an unrecognized (agent, id)
      // pair is silently dropped, not forwarded, so the boot flow just
      // creates a brand-new (still perfectly valid) session instead. This
      // is what keeps "which route created it, for which agent" a
      // guarantee instead of a suggestion.
      if (
        typeof body.resumeSessionId === "string"
        && await isPlaygroundShowcaseSession(process.env.BORING_AGENT_SESSION_ROOT, targetAgentTypeId, body.resumeSessionId)
      ) {
        forwardBody.resumeSessionId = body.resumeSessionId
      }
      const workspaceIdHeader = request.headers["x-boring-workspace-id"]
      const injected = await app.inject({
        method: "POST",
        url: `/api/v1/agents/${encodeURIComponent(targetAgentTypeId)}/sessions`,
        headers: {
          "content-type": "application/json",
          ...(typeof workspaceIdHeader === "string" ? { "x-boring-workspace-id": workspaceIdHeader } : {}),
        },
        payload: JSON.stringify(forwardBody),
      })
      reply.code(injected.statusCode)
      reply.header("content-type", injected.headers["content-type"] ?? "application/json")
      if (injected.statusCode === 201) {
        try {
          const payload = JSON.parse(injected.body) as { sessionId?: unknown }
          if (typeof payload.sessionId === "string") {
            await markPlaygroundShowcaseSession(process.env.BORING_AGENT_SESSION_ROOT, targetAgentTypeId, payload.sessionId)
          }
        } catch {
          // Response wasn't the expected shape — forward it as-is below;
          // provenance just doesn't get recorded for this one.
        }
      }
      return reply.send(injected.body)
    })
    await app.listen({ port: AGENT_API_PORT, host: "127.0.0.1" })
  })()
  return agentBoot
}
