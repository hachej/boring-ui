import type { FastifyInstance } from "fastify"
import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { basename, isAbsolute, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent"
import { createLocalWorkspaceRegistry, type LocalWorkspace } from "./localWorkspaces.js"

export interface RunCliOptions {
  argv?: string[]
  publicDir: string
}

const MODE_MAP = {
  "local": "direct", // no sandbox, full network access
  "local-sandbox": "local", // bwrap isolated, no network (Linux only)
} as const

type CliMode = keyof typeof MODE_MAP
type RuntimeMode = typeof MODE_MAP[CliMode]

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = statusCode
  return error
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return undefined
  return value.find((item): item is string => typeof item === "string")
}

function resolveWorkspaceIdFromRequest(request: { headers?: Record<string, unknown>; query?: unknown }): string {
  const headers = request.headers ?? {}
  const headerValue = headers["x-boring-workspace-id"]
    ?? Object.entries(headers).find(([key]) => key.toLowerCase() === "x-boring-workspace-id")?.[1]
  const query = request.query as Record<string, unknown> | undefined
  const raw = firstString(headerValue) ?? firstString(query?.workspaceId) ?? ""
  const workspaceId = raw.trim()
  if (!workspaceId) throw httpError("workspace id is required", 400)
  if (
    workspaceId.includes("\0")
    || workspaceId.includes("/")
    || workspaceId.includes("\\")
    || workspaceId.includes("..")
    || isAbsolute(workspaceId)
  ) {
    throw httpError("invalid workspace id", 400)
  }
  return workspaceId
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

function openBrowser(url: string) {
  try {
    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
    execSync(`${opener} ${url}`, { stdio: "ignore" })
  } catch {}
}

function ensureFrontendBuilt(publicDir: string) {
  if (existsSync(join(publicDir, "index.html"))) return
  console.error("\nError: boring-ui frontend not found.")
  console.error("Run `pnpm build:full` in packages/cli to build it first.\n")
  process.exit(1)
}

async function registerStatic(app: FastifyInstance, publicDir: string) {
  ensureFrontendBuilt(publicDir)
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

const AUTH_GUIDE = [
  "",
  "  ⚠  No LLM provider configured.",
  "",
  "  In another terminal, launch pi and run /login to set up an API key or",
  "  sign in to a subscription (Claude Pro/Max, ChatGPT Plus, Copilot):",
  "",
  "       pi                                    # if installed globally",
  "       npx @mariozechner/pi-coding-agent     # otherwise",
  "",
  "  Then at pi's prompt:  /login",
  "",
  "  Credentials are saved at ~/.pi/agent/auth.json. Then refresh the browser.",
  "",
].join("\n")

function checkAuth(): number {
  const authStorage = AuthStorage.create()
  const registry = ModelRegistry.create(authStorage)
  return registry.getAvailable().length
}

async function startFolderMode(opts: {
  folderArg?: string
  publicDir: string
  port: number
  host: string
  cliMode: CliMode
  mode: RuntimeMode
}) {
  const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT ?? resolve(opts.folderArg ?? process.cwd())
  const projectName = basename(resolve(workspaceRoot)) || "workspace"
  const modelCount = checkAuth()

  console.log(`\n${projectName}`)
  console.log(`  workspace  ${workspaceRoot}`)
  console.log(`  mode       ${opts.cliMode}`)
  console.log(`  port       ${opts.port}`)
  console.log(`  host       ${opts.host}`)
  if (modelCount === 0) console.log(AUTH_GUIDE)

  const { createWorkspaceAgentServer } = await import("@hachej/boring-workspace/app/server")
  const app = await createWorkspaceAgentServer({
    workspaceRoot,
    mode: opts.mode,
    logger: false,
  })

  app.get("/api/v1/workspace/meta", async () => ({
    workspaceRoot,
    projectName,
  }))

  await registerStatic(app as FastifyInstance, opts.publicDir)
  await app.listen({ port: opts.port, host: opts.host })
  console.log(`\n  http://localhost:${opts.port}\n`)
  openBrowser(`http://localhost:${opts.port}`)
}

async function startWorkspacesMode(opts: {
  publicDir: string
  port: number
  host: string
  cliMode: CliMode
  mode: RuntimeMode
}) {
  const [workspaceAppServer, workspaceServer, agentServer, fastifyModule] = await Promise.all([
    import("@hachej/boring-workspace/app/server"),
    import("@hachej/boring-workspace/server"),
    import("@hachej/boring-agent/server"),
    import("fastify"),
  ])
  const registry = createLocalWorkspaceRegistry()
  const app = fastifyModule.default({ logger: false, bodyLimit: 16 * 1024 * 1024 })
  const bridges = new Map<string, ReturnType<typeof workspaceServer.createInMemoryBridge>>()
  function getBridge(workspaceId: string) {
    let bridge = bridges.get(workspaceId)
    if (!bridge) {
      bridge = workspaceServer.createInMemoryBridge()
      bridges.set(workspaceId, bridge)
    }
    return bridge
  }

  async function requireWorkspace(workspaceId: string): Promise<LocalWorkspace> {
    const workspace = await registry.get(workspaceId)
    if (!workspace) throw httpError("unknown workspace", 404)
    if (!workspace.available) throw httpError("workspace folder unavailable", 409)
    return workspace
  }

  async function workspaceFromRequest(request: { headers?: Record<string, unknown>; query?: unknown }) {
    return await requireWorkspace(resolveWorkspaceIdFromRequest(request))
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
    mode: opts.mode,
    systemPromptAppend: workspaceAppServer.buildWorkspaceContextPrompt(),
    getWorkspaceId: async (request) => (await workspaceFromRequest(request)).id,
    getWorkspaceRoot: async (workspaceId) => (await requireWorkspace(workspaceId)).path,
    getSessionNamespace: async ({ workspaceId }) => `local-workspace-${workspaceId}`,
    getPi: async ({ workspaceRoot }) => ({
      additionalSkillPaths: [join(workspaceRoot, ".agents", "skills")],
    }),
    getExtraTools: async ({ workspaceId, workspaceRoot, workspaceFsCapability }) => [
      ...workspaceServer.createWorkspaceUiTools(getBridge(workspaceId), {
        workspaceRoot: workspaceFsCapability === "strong" ? workspaceRoot : undefined,
      }),
    ],
  })

  await app.register(workspaceServer.uiRoutes, {
    getBridge: async (request) => getBridge((await workspaceFromRequest(request)).id),
  })

  app.get("/api/v1/workspace/meta", async () => ({
    projectName: "Boring UI",
    workspacesMode: true,
  }))

  await registerStatic(app, opts.publicDir)
  await app.listen({ port: opts.port, host: opts.host })

  const initialWorkspace = (await registry.list()).find((workspace) => workspace.available)
  const initialUrl = initialWorkspace
    ? `http://localhost:${opts.port}/workspace/${encodeURIComponent(initialWorkspace.id)}`
    : `http://localhost:${opts.port}`

  console.log(`\nBoring UI`)
  console.log(`  workspaces ${registry.path}`)
  console.log(`  mode       ${opts.cliMode}`)
  console.log(`  port       ${opts.port}`)
  console.log(`  host       ${opts.host}`)
  console.log(`\n  ${initialUrl}\n`)
  if (checkAuth() === 0) console.log(AUTH_GUIDE)
  openBrowser(initialUrl)
}

async function handleWorkspacesCommand(opts: {
  args: { name?: string }
  positionals: string[]
  publicDir: string
  port: number
  host: string
  cliMode: CliMode
  mode: RuntimeMode
}) {
  const registry = createLocalWorkspaceRegistry()
  const subcommand = opts.positionals[1]
  if (subcommand === "add") {
    const target = opts.positionals[2]
    if (!target) throw new Error("usage: boring-ui workspaces add <folder>")
    const workspace = await registry.add(target, { name: opts.args.name })
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
    const id = opts.positionals[2]
    if (!id) throw new Error("usage: boring-ui workspaces remove <id>")
    await registry.remove(id)
    console.log(`removed ${id}`)
    return
  }
  if (subcommand === "rename") {
    const id = opts.positionals[2]
    const name = opts.positionals.slice(3).join(" ")
    if (!id || !name) throw new Error("usage: boring-ui workspaces rename <id> <name>")
    const workspace = await registry.rename(id, name)
    console.log(`renamed ${workspace.id} -> ${workspace.name}`)
    return
  }
  await startWorkspacesMode(opts)
}

export async function runCli(options: RunCliOptions): Promise<void> {
  const { values: args, positionals } = parseArgs({
    args: options.argv,
    options: {
      port: { type: "string", short: "p" },
      host: { type: "string" },
      mode: { type: "string", short: "m" },
      name: { type: "string", short: "n" },
    },
    allowPositionals: true,
    strict: false,
  })

  const port = Number(args.port ?? process.env.PORT) || 5200
  const host = (args.host as string | undefined) ?? process.env.HOST ?? "0.0.0.0"
  const rawMode = (args.mode as string | undefined) ?? process.env.BORING_MODE ?? "local-sandbox"
  if (!(rawMode in MODE_MAP)) {
    throw new Error(`invalid --mode "${rawMode}". Valid options: ${Object.keys(MODE_MAP).join(", ")}`)
  }
  const cliMode = rawMode as CliMode
  const mode = MODE_MAP[cliMode]

  const base = {
    publicDir: options.publicDir,
    port,
    host,
    cliMode,
    mode,
  }

  if (positionals[0] === "workspaces") {
    await handleWorkspacesCommand({
      ...base,
      args: { name: args.name as string | undefined },
      positionals,
    })
    return
  }

  await startFolderMode({
    ...base,
    folderArg: positionals[0],
  })
}
