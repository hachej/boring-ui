import type { FastifyInstance } from "fastify"
import type {
  BoringAgentRuntimePaths,
  ProvisionWorkspaceRuntimeOptions,
  RuntimeModeAdapter,
  RuntimeModeId,
  WorkspaceProvisioningAdapter,
  WorkspaceProvisioningResult,
} from "@hachej/boring-agent/server"
import { execSync } from "node:child_process"
import {
  existsSync,
  readFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { basename, isAbsolute, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createLocalWorkspaceRegistry, type LocalWorkspace } from "./localWorkspaces.js"
import { HELP_TEXT } from "./help.js"
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

  const startsServer = positionals[0] !== "workspaces" || !new Set(["add", "list", "remove", "rename"]).has(positionals[1] ?? "")
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
