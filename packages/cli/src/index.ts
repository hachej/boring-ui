import type { FastifyInstance } from "fastify"
import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { createLocalWorkspaceRegistry, type LocalWorkspace } from "./localWorkspaces.js"

const { values: args, positionals } = parseArgs({
  options: {
    port: { type: "string", short: "p" },
    host: { type: "string" },
    mode: { type: "string", short: "m" },
    name: { type: "string", short: "n" },
  },
  allowPositionals: true,
  strict: false,
})

const PORT = Number(args.port ?? process.env.PORT) || 5200
const HOST = (args.host as string | undefined) ?? process.env.HOST ?? "0.0.0.0"

// CLI-facing mode names → internal runtime mode
const MODE_MAP = {
  "local": "direct", // no sandbox, full network access
  "local-sandbox": "local", // bwrap isolated, no network (Linux only)
} as const
type CliMode = keyof typeof MODE_MAP
type RuntimeMode = typeof MODE_MAP[CliMode]

const rawMode = (args.mode as string | undefined) ?? process.env.BORING_MODE ?? "local-sandbox"
if (!(rawMode in MODE_MAP)) {
  console.error(`\nError: invalid --mode "${rawMode}". Valid options: ${Object.keys(MODE_MAP).join(", ")}\n`)
  process.exit(1)
}
const CLI_MODE = rawMode as CliMode
const MODE: RuntimeMode = MODE_MAP[CLI_MODE]
const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, "..", "public")

function ensureFrontendBuilt() {
  if (existsSync(join(publicDir, "index.html"))) return
  console.error("\nError: boring-ui frontend not found.")
  console.error("Run `pnpm build:full` in packages/cli to build it first.\n")
  process.exit(1)
}

function openBrowser(url: string) {
  try {
    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
    execSync(`${opener} ${url}`, { stdio: "ignore" })
  } catch {}
}

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = statusCode
  return error
}

function toCoreWorkspace(workspace: LocalWorkspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.id,
    isDefault: false,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    unavailable: !workspace.available,
    path: workspace.path,
  }
}

async function registerStatic(app: FastifyInstance) {
  ensureFrontendBuilt()
  const { default: fastifyStatic } = await import("@fastify/static")
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
    wildcard: false,
  })

  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" })
    }
    return reply.sendFile("index.html", publicDir)
  })
}

async function startFolderMode(folderArg?: string) {
  const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT ?? resolve(folderArg ?? process.cwd())
  const projectName = basename(resolve(workspaceRoot)) || "workspace"

  console.log(`\n${projectName}`)
  console.log(`  workspace  ${workspaceRoot}`)
  console.log(`  mode       ${CLI_MODE}`)
  console.log(`  port       ${PORT}`)
  console.log(`  host       ${HOST}`)

  const { createWorkspaceAgentServer } = await import("@hachej/boring-workspace/app/server")
  const app = await createWorkspaceAgentServer({
    workspaceRoot,
    mode: MODE,
    logger: false,
  })

  app.get("/api/v1/workspace/meta", async () => ({
    workspaceRoot,
    projectName,
  }))

  await registerStatic(app as FastifyInstance)
  await app.listen({ port: PORT, host: HOST })
  console.log(`\n  http://localhost:${PORT}\n`)
  openBrowser(`http://localhost:${PORT}`)
}

async function startWorkspacesMode() {
  const [workspaceAppServer, workspaceServer, agentServer, fastifyModule] = await Promise.all([
    import("@hachej/boring-workspace/app/server"),
    import("@hachej/boring-workspace/server"),
    import("@hachej/boring-agent/server"),
    import("fastify"),
  ])
  const registry = createLocalWorkspaceRegistry()
  const app = fastifyModule.default({ logger: false, bodyLimit: 16 * 1024 * 1024 })
  const bridges = workspaceAppServer.createWorkspaceBridgeRegistry()

  async function requireWorkspace(workspaceId: string): Promise<LocalWorkspace> {
    const workspace = await registry.get(workspaceId)
    if (!workspace) throw httpError("unknown workspace", 404)
    if (!workspace.available) throw httpError("workspace folder unavailable", 409)
    return workspace
  }

  async function workspaceFromRequest(request: Parameters<typeof workspaceAppServer.resolveWorkspaceIdFromRequest>[0]) {
    return await requireWorkspace(workspaceAppServer.resolveWorkspaceIdFromRequest(request))
  }

  app.get("/api/v1/local-workspaces", async () => ({
    workspaces: await registry.list(),
  }))
  app.post("/api/v1/local-workspaces", async (request, reply) => {
    const body = request.body as { path?: unknown; name?: unknown }
    if (typeof body?.path !== "string" || !body.path.trim()) {
      return reply.code(400).send({ error: "workspace path is required" })
    }
    try {
      const workspace = await registry.add(body.path, {
        name: typeof body.name === "string" ? body.name : undefined,
      })
      return { workspace }
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "unable to add workspace",
      })
    }
  })
  app.delete("/api/v1/local-workspaces/:id", async (request) => {
    const { id } = request.params as { id: string }
    await registry.remove(id)
    return { ok: true }
  })

  // Core-compatible read endpoints so the shared/core switcher data shape is available locally.
  app.get("/api/v1/workspaces", async () => ({
    workspaces: (await registry.list()).map(toCoreWorkspace),
  }))
  app.get("/api/v1/workspaces/:id", async (request, reply) => {
    const { id } = request.params as { id: string }
    const workspace = await registry.get(id)
    if (!workspace) return reply.code(404).send({ error: "workspace not found" })
    return { workspace: toCoreWorkspace(workspace), role: "owner" }
  })

  await app.register(agentServer.registerAgentRoutes, {
    mode: MODE,
    systemPromptAppend: workspaceAppServer.buildWorkspaceContextPrompt(),
    getWorkspaceId: async (request) => (await workspaceFromRequest(request)).id,
    getWorkspaceRoot: async (workspaceId) => (await requireWorkspace(workspaceId)).path,
    getSessionNamespace: async ({ workspaceId }) => `local-workspace-${workspaceId}`,
    getResourceLoaderOptions: async ({ workspaceRoot }) => ({
      additionalSkillPaths: [join(workspaceRoot, ".agents", "skills")],
    }),
    getExtraTools: async ({ workspaceId, workspaceRoot, workspaceFsCapability }) => [
      ...workspaceServer.createWorkspaceUiTools(bridges.get(workspaceId), {
        workspaceRoot: workspaceFsCapability === "strong" ? workspaceRoot : undefined,
      }),
    ],
  })

  await app.register(workspaceServer.uiRoutes, {
    getBridge: async (request) => bridges.get((await workspaceFromRequest(request)).id),
  })

  app.get("/api/v1/workspace/meta", async () => ({
    projectName: "Boring UI",
    workspacesMode: true,
  }))

  await registerStatic(app)
  await app.listen({ port: PORT, host: HOST })

  console.log(`\nBoring UI`)
  console.log(`  workspaces ${registry.path}`)
  console.log(`  mode       ${CLI_MODE}`)
  console.log(`  port       ${PORT}`)
  console.log(`  host       ${HOST}`)
  console.log(`\n  http://localhost:${PORT}\n`)
  openBrowser(`http://localhost:${PORT}`)
}

async function handleWorkspacesCommand() {
  const registry = createLocalWorkspaceRegistry()
  const subcommand = positionals[1]
  if (subcommand === "add") {
    const target = positionals[2]
    if (!target) throw new Error("usage: boring-ui workspaces add <folder>")
    const workspace = await registry.add(target, { name: args.name as string | undefined })
    console.log(`${workspace.name}\n  id    ${workspace.id}\n  path  ${workspace.path}`)
    return
  }
  if (subcommand === "list") {
    const workspaces = await registry.list()
    if (workspaces.length === 0) {
      console.log("No workspaces. Add one with `boring-ui workspaces add <folder>`.")
      return
    }
    for (const workspace of workspaces) {
      console.log(`${workspace.available ? "✓" : "!"} ${workspace.name}  ${workspace.id}\n  ${workspace.path}`)
    }
    return
  }
  if (subcommand === "remove") {
    const id = positionals[2]
    if (!id) throw new Error("usage: boring-ui workspaces remove <id>")
    await registry.remove(id)
    console.log(`removed ${id}`)
    return
  }
  if (subcommand === "rename") {
    const id = positionals[2]
    const name = positionals.slice(3).join(" ")
    if (!id || !name) throw new Error("usage: boring-ui workspaces rename <id> <name>")
    const workspace = await registry.rename(id, name)
    console.log(`renamed ${workspace.id} -> ${workspace.name}`)
    return
  }
  await startWorkspacesMode()
}

try {
  if (positionals[0] === "workspaces") {
    await handleWorkspacesCommand()
  } else {
    await startFolderMode(positionals[0])
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
