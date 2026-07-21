import type { FastifyInstance } from "fastify"
import type {
  ProvisionWorkspaceRuntimeOptions,
  RuntimeModeAdapter,
  RuntimeModeId,
  WorkspaceProvisioningAdapter,
  WorkspaceProvisioningResult,
} from "@hachej/boring-agent/server"
import type { BoringAgentRuntimePaths } from "@hachej/boring-sandbox/providers/node-workspace"
import { execSync } from "node:child_process"
import {
  existsSync,
  readFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { basename, isAbsolute, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createLocalWorkspaceRegistry, type LocalWorkspace } from "./localWorkspaces.js"
import type {
  RuntimePluginDiagnosticsResponse,
  RuntimePluginHostSnapshot,
  RuntimePluginServerSnapshotEntry,
} from "../shared/runtimePluginDiagnostics.js"
import { resolveBoringUiCliPackageRoot } from "./pluginDiscovery.js"
import {
  CLI_VERSION,
  MODE_MAP,
  createFolderModeApp,
  createWorkspacesModeApp,
  provisionCliWorkspaceRuntime,
  type CliMode,
  type RuntimeMode,
} from "./modeApps.js"

// Re-exported for existing importers (tests, embedding hosts).
export {
  createBoringUiCliRuntimePlugin,
  createFolderModeApp,
  createWorkspacesModeApp,
  provisionCliWorkspaceRuntime,
  resolveBoringUiPluginCliPackageRoot,
} from "./modeApps.js"
export { resolveBoringUiCliPackageRoot } from "./pluginDiscovery.js"

export interface RunCliOptions {
  argv?: string[]
  publicDir: string
}


function openBrowser(url: string) {
  try {
    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
    execSync(`${opener} ${url}`, { stdio: "ignore" })
  } catch {}
}

// resolveBoringUiCliPackageRoot is imported from ./pluginDiscovery.js so
// the discovery module can use the same helper without a circular import.


function ensureFrontendBuilt(publicDir: string) {
  if (existsSync(join(publicDir, "index.html"))) return
  console.error("\nError: boring-ui frontend not found.")
  console.error("Run `pnpm build:full` in packages/cli to build it first.\n")
  process.exit(1)
}

export async function registerStatic(app: FastifyInstance, publicDir: string) {
  ensureFrontendBuilt(publicDir)
  // Compress responses (gzip/brotli) before serving static assets. The front
  // bundle is multi-MB uncompressed; over a remote/tailscale link that raw
  // transfer dominates first-load time. Compression cuts it ~3-4x. Registered
  // before @fastify/static so its onSend hook wraps the file streams.
  const { default: fastifyCompress } = await import("@fastify/compress")
  await app.register(fastifyCompress, { global: true, encodings: ["br", "gzip"], threshold: 1024 })
  const { default: fastifyStatic } = await import("@fastify/static")
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
    // @fastify/send writes its own Cache-Control after setHeaders runs, so
    // disable it and set the header explicitly for both cases below.
    cacheControl: false,
    setHeaders(res, filePath) {
      // Vite emits content-hashed filenames under /assets, so they can be
      // cached forever — without this the multi-MB bundle is revalidated
      // (or re-downloaded) on every workspace open. Everything else (notably
      // index.html) keeps max-age=0 + etag so deploys are picked up
      // immediately.
      res.setHeader(
        "cache-control",
        /[\\/]assets[\\/]/.test(filePath)
          ? "public, max-age=31536000, immutable"
          : "public, max-age=0",
      )
    },
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
  "  boring-ui plugin <subcommand>         Install, list, and remove plugin sources",
  "  boring-ui agent validate <dir>        Validate an authored agent directory",
  "",
  "Options:",
  "  -p, --port <port>       HTTP port (default: 5200)",
  "      --host <host>       Listen host (default: 127.0.0.1)",
  "      --allow-insecure-local-bridge",
  "                            Allow unauthenticated local-cli bridge auth when binding a non-loopback host",
  "  -m, --mode <mode>       local-sandbox or local (default: local)",
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
  "       npx @earendil-works/pi-coding-agent  # otherwise",
  "",
  "  Then at pi's prompt:  /login",
  "",
  "  Credentials are saved at ~/.pi/agent/auth.json. Then refresh the browser.",
  "",
].join("\n")

async function checkAuth(): Promise<number> {
  // Keep pi-coding-agent out of the CLI's top-level module graph so help and
  // workspace-management commands stay lightweight.
  const { AuthStorage, ModelRegistry } = await import("@mariozechner/pi-coding-agent")
  const authStorage = AuthStorage.create()
  const registry = ModelRegistry.create(authStorage)
  return registry.getAvailable().length
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]"
}

function truthyEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes"
}

interface AgentCliErrorV1 {
  schemaVersion: 1
  ok: false
  error: {
    code: string
    field?: string
    message: string
  }
}

interface AgentValidateSuccessV1 {
  schemaVersion: 1
  ok: true
  agent: {
    agentTypeId: string
    version: string
    label?: string
    description?: string
    instructions: { present: true; byteLength: number }
  }
}

class AgentValidateCliError extends Error {
  readonly code: string
  readonly field?: string

  constructor(input: { code: string; field?: string; message: string }) {
    super(input.message)
    this.name = "AgentValidateCliError"
    this.code = input.code
    if (input.field !== undefined) this.field = input.field
  }
}

const AGENT_TYPE_ID_RE = /^[a-z][a-z0-9-]{0,62}$/

interface AgentValidateBundle {
  definition: {
    definitionId: string
    version: string
    label?: string
    description?: string
    instructionsRef: string
  }
  assets: readonly { path: string; content: string }[]
}

interface AgentValidateDeps {
  AgentDefinitionValidationError: new (...args: never[]) => Error & {
    validationCode: string
    field: string
  }
  AgentDirectoryCompilerError: new (...args: never[]) => Error & {
    compilerCode: string
    field: string
  }
  compileAgentDirectory: (directory: string) => Promise<AgentValidateBundle>
}

async function loadAgentValidateDeps(): Promise<AgentValidateDeps> {
  const [server, shared] = await Promise.all([
    import("@hachej/boring-agent/server"),
    import("@hachej/boring-agent/shared"),
  ])
  return {
    AgentDefinitionValidationError: shared.AgentDefinitionValidationError as AgentValidateDeps["AgentDefinitionValidationError"],
    AgentDirectoryCompilerError: server.AgentDirectoryCompilerError as AgentValidateDeps["AgentDirectoryCompilerError"],
    compileAgentDirectory: server.compileAgentDirectory as AgentValidateDeps["compileAgentDirectory"],
  }
}

function createAgentValidateSuccess(bundle: AgentValidateBundle): AgentValidateSuccessV1 {
  const { definition } = bundle
  if (!AGENT_TYPE_ID_RE.test(definition.definitionId)) {
    throw new AgentValidateCliError({
      code: "AUTHORED_AGENT_ID_INVALID",
      field: "definitionId",
      message: "definitionId must match ^[a-z][a-z0-9-]{0,62}$",
    })
  }

  const instructions = bundle.assets.find((asset) => asset.path === definition.instructionsRef)?.content
  if (instructions === undefined) {
    throw new AgentValidateCliError({
      code: "INTERNAL_ERROR",
      field: "instructionsRef",
      message: "compiled agent instructions asset is missing",
    })
  }

  return {
    schemaVersion: 1,
    ok: true,
    agent: {
      agentTypeId: definition.definitionId,
      version: definition.version,
      ...(definition.label === undefined ? {} : { label: definition.label }),
      ...(definition.description === undefined ? {} : { description: definition.description }),
      instructions: {
        present: true,
        byteLength: new TextEncoder().encode(instructions).byteLength,
      },
    },
  }
}

function escapeTerminalUnsafeCharacter(value: string): string {
  return value.replace(
    /[\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )
}

function safeHumanValue(value: string): string {
  return escapeTerminalUnsafeCharacter(value)
}

function safeHumanJsonValue(value: string): string {
  return escapeTerminalUnsafeCharacter(JSON.stringify(value))
}

function formatAgentValidateHuman(payload: AgentValidateSuccessV1): string {
  const lines = [
    "Authored agent directory is valid.",
    `  id: ${payload.agent.agentTypeId}`,
    `  version: ${safeHumanValue(payload.agent.version)}`,
  ]
  if (payload.agent.label !== undefined) lines.push(`  label: ${safeHumanJsonValue(payload.agent.label)}`)
  if (payload.agent.description !== undefined) {
    lines.push(`  description: ${safeHumanJsonValue(payload.agent.description)}`)
  }
  lines.push(`  instructions: ${payload.agent.instructions.byteLength} bytes`)
  return lines.join("\n")
}

function toAgentCliError(error: unknown, deps?: AgentValidateDeps): AgentCliErrorV1 {
  if (error instanceof AgentValidateCliError) {
    return {
      schemaVersion: 1,
      ok: false,
      error: {
        code: error.code,
        ...(error.field === undefined ? {} : { field: error.field }),
        message: error.message,
      },
    }
  }
  if (deps !== undefined && error instanceof deps.AgentDirectoryCompilerError) {
    return {
      schemaVersion: 1,
      ok: false,
      error: {
        code: error.compilerCode,
        field: error.field,
        message: error.message,
      },
    }
  }
  if (deps !== undefined && error instanceof deps.AgentDefinitionValidationError) {
    return {
      schemaVersion: 1,
      ok: false,
      error: {
        code: error.validationCode,
        field: error.field,
        message: error.message,
      },
    }
  }
  return {
    schemaVersion: 1,
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "agent validation failed",
    },
  }
}

function unsupportedAgentValidateOption(token: string): AgentValidateCliError {
  return new AgentValidateCliError({
    code: "CONFIG_INVALID",
    field: token.startsWith("--json=") ? "--json" : token.split("=", 1)[0],
    message: "usage: boring-ui agent validate <dir> [--json]",
  })
}

function parseAgentValidateArgv(argv: string[]): {
  directory: string
  json: boolean
} {
  const json = argv.includes("--json")
  const agentIndex = argv.indexOf("agent")
  if (agentIndex < 0) {
    throw new AgentValidateCliError({
      code: "CONFIG_INVALID",
      field: "command",
      message: "usage: boring-ui agent validate <dir>",
    })
  }

  for (const token of argv.slice(0, agentIndex)) {
    if (token === "--json") continue
    if (token.startsWith("-")) throw unsupportedAgentValidateOption(token)
  }

  const tokens = argv.slice(agentIndex + 1).filter((token) => token !== "--json")
  const subcommand = tokens[0]
  if (subcommand !== "validate") {
    throw new AgentValidateCliError({
      code: "CONFIG_INVALID",
      field: "command",
      message: "usage: boring-ui agent validate <dir>",
    })
  }

  let directory: string | undefined
  for (const token of tokens.slice(1)) {
    if (token.startsWith("-")) throw unsupportedAgentValidateOption(token)
    if (directory !== undefined) {
      throw new AgentValidateCliError({
        code: "CONFIG_INVALID",
        field: "arguments",
        message: "usage: boring-ui agent validate <dir>",
      })
    }
    directory = token
  }
  if (!directory) {
    throw new AgentValidateCliError({
      code: "CONFIG_INVALID",
      field: "directory",
      message: "usage: boring-ui agent validate <dir>",
    })
  }
  return { directory, json }
}

async function handleAgentCommand(argv: string[]) {
  let json = argv.includes("--json")
  let deps: AgentValidateDeps | undefined
  try {
    const parsed = parseAgentValidateArgv(argv)
    json = parsed.json
    deps = await loadAgentValidateDeps()
    const payload = createAgentValidateSuccess(await deps.compileAgentDirectory(parsed.directory))
    console.log(json ? JSON.stringify(payload) : formatAgentValidateHuman(payload))
  } catch (error) {
    const payload = toAgentCliError(error, deps)
    const humanField = payload.error.field === undefined ? "" : ` ${safeHumanJsonValue(payload.error.field)}`
    console.error(json ? JSON.stringify(payload) : `${payload.error.code}${humanField}: ${safeHumanJsonValue(payload.error.message)}`)
    process.exitCode = 1
  }
}

async function startFolderMode(opts: {
  folderArg?: string
  publicDir: string
  port: number
  host: string
  cliMode: CliMode
  mode: RuntimeMode
  allowInsecureLocalBridgeAuth: boolean
}) {
  const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT ?? resolve(opts.folderArg ?? process.cwd())
  const projectName = basename(resolve(workspaceRoot)) || "workspace"
  const modelCount = await checkAuth()

  const url = `http://localhost:${opts.port}`
  console.log(`\n${projectName}`)
  console.log(`  workspace  ${workspaceRoot}`)
  console.log(`  mode       ${opts.cliMode}`)
  console.log(`  port       ${opts.port}`)
  console.log(`  host       ${opts.host}`)
  if (modelCount === 0) console.log(AUTH_GUIDE)
  console.log(`\n  starting ${url} …`)

  const app = await createFolderModeApp({
    workspaceRoot,
    mode: opts.mode,
    projectName,
    allowInsecureLocalBridgeAuth: opts.allowInsecureLocalBridgeAuth,
  })

  await registerStatic(app as FastifyInstance, opts.publicDir)
  await app.listen({ port: opts.port, host: opts.host })
  console.log(`  ${url}  ready\n`)
  openBrowser(url)
}


async function startWorkspacesMode(opts: {
  publicDir: string
  port: number
  host: string
  cliMode: CliMode
  mode: RuntimeMode
}) {
  const app = await createWorkspacesModeApp({ mode: opts.mode })
  const registry = createLocalWorkspaceRegistry()

  await registerStatic(app, opts.publicDir)
  await app.listen({ port: opts.port, host: opts.host })

  const initialWorkspace = (await registry.list()).find((workspace) => workspace.available)
  const initialUrl = initialWorkspace
    ? `http://localhost:${opts.port}/workspace/${encodeURIComponent(initialWorkspace.id)}`
    : `http://localhost:${opts.port}`

  console.log(`  workspaces ${registry.path}`)
  console.log(`  ${initialUrl}  ready\n`)
  // Do not run checkAuth() in workspaces server startup. It imports Pi's model
  // registry after the socket is listening, which can block the event loop and
  // make the first direct workspace URL wait on static assets. The browser can
  // surface provider/auth state through /api/v1/agent/models when needed.
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
  if (options.argv?.[0] === "plugin") {
    const { runBoringUiPluginCli } = await import("@hachej/boring-ui-plugin-cli")
    await runBoringUiPluginCli(options.argv.slice(1))
    return
  }

  const { values: args, positionals } = parseArgs({
    args: options.argv,
    options: {
      port: { type: "string", short: "p" },
      host: { type: "string" },
      mode: { type: "string", short: "m" },
      name: { type: "string", short: "n" },
      path: { type: "string" as const },
      json: { type: "boolean" as const },
      url: { type: "string" as const },
      workspace: { type: "string" as const },
      "panel-id": { type: "string" as const },
      "timeout-ms": { type: "string" as const },
      "allow-insecure-local-bridge": { type: "boolean" as const },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  })

  if (positionals[0] === "agent") {
    await handleAgentCommand(options.argv ?? [])
    return
  }

  if (args.help) {
    console.log(HELP_TEXT)
    return
  }

  const port = Number(args.port ?? process.env.PORT) || 5200
  const explicitHost = args.host !== undefined || process.env.HOST !== undefined
  const host = (args.host as string | undefined) ?? process.env.HOST ?? "127.0.0.1"
  const allowInsecureLocalBridgeAuth = isLoopbackHost(host) || truthyEnv(process.env.BORING_UI_ALLOW_INSECURE_LOCAL_BRIDGE) || args["allow-insecure-local-bridge"] === true
  const rawMode = (args.mode as string | undefined) ?? process.env.BORING_MODE
  let cliMode: CliMode
  let mode: RuntimeMode
  if (rawMode) {
    if (!(rawMode in MODE_MAP)) {
      throw new Error(`invalid --mode "${rawMode}". Valid options: ${Object.keys(MODE_MAP).join(", ")}`)
    }
    cliMode = rawMode as CliMode
    mode = MODE_MAP[cliMode]
  } else {
    // Default to direct (no sandbox) on every platform — including Linux with
    // bwrap available. Direct mode boots ~instantly (no pack/extract, no
    // sandbox spin-up); bwrap isolation is opt-in via `--mode local-sandbox`,
    // since its per-workspace first-boot provisioning cost should only be paid
    // when the caller explicitly wants the isolation (and accepts the wait).
    cliMode = "local"
    mode = "direct"
  }

  const startsServer = positionals[0] !== "agent" && (positionals[0] !== "workspaces" || !new Set(["add", "list", "remove", "rename"]).has(positionals[1] ?? ""))
  if (startsServer && !isLoopbackHost(host) && (!explicitHost || !allowInsecureLocalBridgeAuth)) {
    throw new Error("Binding boring-ui to a non-loopback host requires --host plus --allow-insecure-local-bridge. The local CLI WorkspaceBridge browser auth is unauthenticated.")
  }

  const base = {
    publicDir: options.publicDir,
    port,
    host,
    cliMode,
    mode,
    allowInsecureLocalBridgeAuth,
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
