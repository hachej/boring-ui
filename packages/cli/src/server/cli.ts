import type { FastifyInstance } from "fastify"
import { execSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
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

const require = createRequire(import.meta.url)
const CLI_VERSION = (() => {
  try {
    const pkg = require("../../package.json") as { version?: string }
    return pkg.version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
})()

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

function resolvePackageRoot(packageName: string): string | null {
  try {
    return dirname(require.resolve(`${packageName}/package.json`))
  } catch {
    return null
  }
}

function boringPiSkillPaths(): string[] {
  const root = resolvePackageRoot("@hachej/boring-pi")
  if (!root) return []
  const skill = join(root, "skills", "boring-plugin-authoring", "SKILL.md")
  return existsSync(skill) ? [skill] : []
}

function boringPiPackageSource(): { source: string; skills: string[] } | undefined {
  const root = resolvePackageRoot("@hachej/boring-pi")
  return root ? { source: root, skills: ["skills/boring-plugin-authoring"] } : undefined
}

function ensureFrontendBuilt(publicDir: string) {
  if (existsSync(join(publicDir, "index.html"))) return
  console.error("\nError: boring-ui frontend not found.")
  console.error("Run `pnpm build:full` in packages/cli to build it first.\n")
  process.exit(1)
}

export async function registerStatic(app: FastifyInstance, publicDir: string) {
  ensureFrontendBuilt(publicDir)
  const { default: fastifyStatic } = await import("@fastify/static")
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
  })

  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" })
    }
    return reply.sendFile("index.html", publicDir)
  })
}

const HELP_TEXT = [
  "Usage: boring-ui [workspace] [options]",
  "",
  "Commands:",
  "  boring-ui [workspace]                 Start the workspace UI for a folder",
  "  boring-ui workspaces <subcommand>     Manage saved local workspaces",
  "  boring-ui scaffold-plugin <name> [workspace]",
  "                                       Scaffold a hot-reloadable plugin",
  "  boring-ui verify-plugin [name] [workspace]",
  "                                       Validate plugin manifests/files",
  "",
  "Options:",
  "  -p, --port <port>       HTTP port (default: 5200)",
  "      --host <host>       Listen host (default: 0.0.0.0)",
  "  -m, --mode <mode>       local-sandbox or local (default: local-sandbox)",
  "  -h, --help              Show this help",
].join("\n")

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

async function checkAuth(): Promise<number> {
  // Keep pi-coding-agent out of the CLI's top-level module graph so
  // lightweight subcommands (`scaffold-plugin`, `verify-plugin`) still run
  // from the workspace-local provisioned CLI copy, which intentionally does
  // not materialize the whole dependency tree.
  const { AuthStorage, ModelRegistry } = await import("@mariozechner/pi-coding-agent")
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
  const modelCount = await checkAuth()

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
    version: CLI_VERSION,
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
    systemPromptAppend: [
      workspaceAppServer.buildWorkspaceContextPrompt(),
      workspaceServer.buildBoringSystemPrompt({
        scaffoldCommand: "boring-ui scaffold-plugin",
        verifyCommand: "boring-ui verify-plugin",
        boringPiRootOverride: null,
      }),
    ].join("\n\n"),
    getWorkspaceId: async (request) => (await workspaceFromRequest(request)).id,
    getWorkspaceRoot: async (workspaceId) => (await requireWorkspace(workspaceId)).path,
    getSessionNamespace: async ({ workspaceId }) => `local-workspace-${workspaceId}`,
    getPi: async ({ workspaceRoot }) => {
      const collection = workspaceAppServer.collectWorkspaceAgentServerPlugins({ workspaceRoot })
      const pi = collection.agentOptions.pi ?? {}
      const packages = [...(pi.packages ?? [])]
      const boringPi = boringPiPackageSource()
      if (boringPi) packages.unshift(boringPi)
      return {
        ...pi,
        additionalSkillPaths: [
          ...boringPiSkillPaths(),
          ...(pi.additionalSkillPaths ?? []),
        ],
        packages,
      }
    },
    provisionRuntime: async ({ workspaceRoot, runtimeMode, runtimeBundle }) => {
      const collection = workspaceAppServer.collectWorkspaceAgentServerPlugins({ workspaceRoot })
      await workspaceAppServer.provisionWorkspaceAgentServer({
        workspaceRoot,
        runtimeMode,
        runtimeBundle,
        provisioningContributions: collection.provisioningContributions,
      })
    },
    getExtraTools: async ({ workspaceId, workspaceRoot, workspaceFsCapability }) => {
      const collection = workspaceAppServer.collectWorkspaceAgentServerPlugins({ workspaceRoot })
      return [
        ...workspaceServer.createWorkspaceUiTools(getBridge(workspaceId), {
          workspaceRoot: workspaceFsCapability === "strong" ? workspaceRoot : undefined,
        }),
        ...(collection.agentOptions.extraTools ?? []),
      ]
    },
  })

  await app.register(workspaceServer.uiRoutes, {
    getBridge: async (request) => getBridge((await workspaceFromRequest(request)).id),
  })

  app.get("/api/v1/workspace/meta", async () => ({
    projectName: "Boring UI",
    workspacesMode: true,
    version: CLI_VERSION,
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
  if ((await checkAuth()) === 0) console.log(AUTH_GUIDE)
  openBrowser(initialUrl)
}

function findRepoRoot(from: string): string | null {
  let current = from
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

// Recursively walk a directory and return relative paths to files
function walkDir(dir: string, base: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      walkDir(fullPath, base, out)
      continue
    }
    out.push(relative(base, fullPath))
  }
  return out
}

function replaceInFile(filePath: string, replacements: Record<string, string>) {
  let content = readFileSync(filePath, "utf8")
  for (const [from, to] of Object.entries(replacements)) {
    content = content.replaceAll(from, to)
  }
  writeFileSync(filePath, content, "utf8")
}

async function handlePluginCommand(opts: {
  positionals: string[]
  args: { path?: string }
}) {
  const subcommand = opts.positionals[1]
  if (subcommand !== "create") {
    console.log("Usage: boring-ui plugin create <name> [--path <dir>]")
    console.log("")
    console.log("Scaffold a new plugin from the template.")
    console.log("")
    console.log("Arguments:")
    console.log("  <name>        Plugin name (e.g. my-plugin)")
    console.log("  --path        Parent directory for the new plugin (default: plugins/)")
    return
  }

  const name = opts.positionals[2]
  if (!name) throw new Error("usage: boring-ui plugin create <name>")

  const __dirname = dirname(fileURLToPath(import.meta.url))
  const packageRoot = resolve(__dirname, "..", "..")
  const templateDir = join(packageRoot, "templates", "plugin")
  if (!existsSync(templateDir)) {
    throw new Error(
      `Plugin template not found at ${templateDir}.\n` +
      "This build may not include the plugin template.",
    )
  }

  const repoRoot = findRepoRoot(process.cwd())
  const customPath = opts.args.path
  const targetParent = customPath ? resolve(customPath) : join(repoRoot ?? process.cwd(), "plugins")
  const targetDir = join(targetParent, name)

  if (existsSync(targetDir)) {
    throw new Error(`Directory already exists: ${targetDir}`)
  }

  const id = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "")
  if (!id) throw new Error(`invalid plugin name: ${name}`)
  const symbolBase = id.replace(/-plugin$/, "") || id
  const pascalBase = symbolBase
    .split(/[-_]+/)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("")
  const camelBase = pascalBase.charAt(0).toLowerCase() + pascalBase.slice(1)
  const upperBase = symbolBase.replace(/-/g, "_").toUpperCase()

  console.log(`Scaffolding plugin "${id}" at ${targetDir}`)

  // Copy template (excluding node_modules)
  mkdirSync(targetParent, { recursive: true })
  cpSync(templateDir, targetDir, { recursive: true })

  // Walk and rename template identifiers/ids in all files.
  const files = walkDir(targetDir, targetDir)
  const pkgName = `@hachej/boring-${id}`
  for (const file of files) {
    const fullPath = join(targetDir, file)
    replaceInFile(fullPath, {
      "@hachej/boring-plugin-template": pkgName,
      "sample-plugin": id,
      "sample-panel": `${id}-panel`,
      "sample.open": `${id}.open`,
      "sample:": `${id}:`,
      '"sample"': `"${id}"`,
      "SAMPLE": upperBase,
      "Sample": pascalBase,
      "sampleSurfaceResolver": `${camelBase}SurfaceResolver`,
      "samplePanel": `${camelBase}Panel`,
    })

    if (file.includes("samplePlugin")) {
      const newFile = file.replace(/samplePlugin/g, `${camelBase}Plugin`)
      const oldPath = join(targetDir, file)
      const newPath = join(targetDir, newFile)
      if (oldPath !== newPath) {
        mkdirSync(dirname(newPath), { recursive: true })
        renameSync(oldPath, newPath)
      }
    }
  }

  console.log("")
  console.log(`✓ Created plugin \`${id}\` at ${relative(process.cwd(), targetDir)}`)
  console.log("")
  console.log("Next steps:")
  console.log(`  cd ${relative(process.cwd(), targetDir)}`)
  console.log("  pnpm install")
  console.log(`  pnpm --filter ${pkgName} typecheck`)
  console.log(`  pnpm --filter ${pkgName} test`)
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
      path: { type: "string" as const },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  })

  if (args.help) {
    console.log(HELP_TEXT)
    return
  }

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

  if (positionals[0] === "plugin") {
    await handlePluginCommand({
      positionals,
      args: { path: args.path as string | undefined },
    })
    return
  }

  if (positionals[0] === "workspaces") {
    await handleWorkspacesCommand({
      ...base,
      args: { name: args.name as string | undefined },
      positionals,
    })
    return
  }

  if (positionals[0] === "scaffold-plugin") {
    await handleScaffoldPluginCommand({ positionals })
    return
  }

  if (positionals[0] === "verify-plugin") {
    await handleVerifyPluginCommand({ positionals })
    return
  }

  await startFolderMode({
    ...base,
    folderArg: positionals[0],
  })
}

function defaultWorkspaceRoot(): string {
  return process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd()
}

async function handleVerifyPluginCommand(opts: { positionals: string[] }) {
  // Usage: `boring-ui verify-plugin [<name>] [<workspace>]`
  // No name: verify every plugin under .pi/extensions/.
  // With name: verify only `.pi/extensions/<name>/`.
  // Workspace defaults to BORING_AGENT_WORKSPACE_ROOT when invoked
  // through the workspace-local shim, then cwd as a manual fallback.
  // The flag-free positional form keeps the invocation short for the
  // agent's bash tool.
  const maybeName = opts.positionals[1]
  const maybeWorkspace = opts.positionals[2]
  const looksLikePath = maybeName && (maybeName.includes("/") || maybeName.startsWith("."))
  const name = looksLikePath ? undefined : maybeName
  const workspaceRoot = resolve(maybeWorkspace ?? (looksLikePath ? maybeName! : defaultWorkspaceRoot()))

  const { findHintForError, formatVerifyResult, verifyPlugin } = await import("./verifyPlugin.js")
  const result = verifyPlugin({ workspaceRoot, ...(name ? { name } : {}) })
  console.log(formatVerifyResult(result))
  if (!result.ok) {
    // Surface actionable hints for the well-known mistakes so the agent
    // sees a one-line "do this instead" alongside the raw error.
    const hints: string[] = []
    for (const outcome of result.outcomes) {
      for (const err of outcome.errors) {
        const hint = findHintForError(err)
        if (hint) hints.push(`  hint (${outcome.id}): ${hint}`)
      }
    }
    if (hints.length > 0) {
      console.log("")
      console.log("Suggestions:")
      for (const hint of hints) console.log(hint)
    }
    process.exit(1)
  }
}

async function handleScaffoldPluginCommand(opts: { positionals: string[] }) {
  const name = opts.positionals[1]
  if (!name) {
    throw new Error("usage: boring-ui scaffold-plugin <name> [workspace]")
  }
  const workspaceRoot = resolve(opts.positionals[2] ?? defaultWorkspaceRoot())
  const { scaffoldPlugin } = await import("./scaffoldPlugin.js")
  const result = scaffoldPlugin({ name, workspaceRoot })
  console.log(`scaffolded ${name}`)
  console.log(`  dir   ${result.pluginDir}`)
  for (const file of result.filesCreated) {
    console.log(`  +     ${file}`)
  }
  console.log("")
  console.log("Next steps:")
  console.log(`  1. edit front/index.tsx for UI panels/commands/resolvers`)
  console.log(`  2. add pi.extensions / skills for hot-reloadable agent behavior`)
  console.log(`  3. bash \`boring-ui verify-plugin\` — confirms manifests + files are valid`)
  console.log(`  4. ask the user: /reload`)
  console.log("")
  console.log("Advanced server integration:")
  console.log("  boring.server is boot-time/static composition only. It is NOT hot-registered")
  console.log("  by /reload for .pi/extensions user plugins; use Pi extensions for agent tools.")
}
