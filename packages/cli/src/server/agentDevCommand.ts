import type { FastifyInstance } from "fastify"
import type {
  AuthoredAgentToolCatalog,
  MaterializedAgentSourceV1,
  WorkspaceAgentDispatcherResolver,
} from "@hachej/boring-agent/server"
import { createHash } from "node:crypto"
import { basename, resolve } from "node:path"
import { createLocalWorkspaceRegistry } from "./localWorkspaces.js"
import { registerStatic } from "./staticAssets.js"
import type { CliMode, RuntimeMode } from "./modeApps.js"
import type { AgentCommandDeps } from "./agentCommandDeps.js"
import type { AgentCommandRunOptions, AgentDevTrustedToolCatalogAdapter } from "./agentCommandTypes.js"
import { safeHumanValue, stableAgentCliError } from "./agentCommandSafe.js"
import { copyRefs, createAgentValidateSuccess } from "./agentValidateCommand.js"

interface AgentDevParsedArgv {
  directory: string
  prompt?: string
  serve: boolean
  allowDirect: boolean
}

function agentDevUsageError(field = "mode") {
  return stableAgentCliError(
    "AUTHORED_AGENT_DEV_USAGE_INVALID",
    field,
    "usage: boring-ui agent dev <dir> (--prompt <text> | --serve) [--allow-direct]",
  )
}

function parseAgentDevArgv(argv: string[]): AgentDevParsedArgv {
  const agentIndex = argv.indexOf("agent")
  if (agentIndex < 0) throw agentDevUsageError("command")
  const prefix = argv.slice(0, agentIndex)
  for (let index = 0; index < prefix.length; index += 1) {
    throw agentDevUsageError(prefix[index] || "arguments")
  }

  const tokens = argv.slice(agentIndex + 1)
  if (tokens[0] !== "dev") throw agentDevUsageError("command")
  let directory: string | undefined
  let prompt: string | undefined
  let serve = false
  let allowDirect = false
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === "--serve") {
      if (serve) throw agentDevUsageError("--serve")
      serve = true
      continue
    }
    if (token === "--allow-direct") {
      if (allowDirect) throw agentDevUsageError("--allow-direct")
      allowDirect = true
      continue
    }
    if (token === "--prompt") {
      if (prompt !== undefined) throw agentDevUsageError("--prompt")
      const value = tokens[index + 1]
      if (value === undefined || value.trim().length === 0) throw agentDevUsageError("--prompt")
      prompt = value
      index += 1
      continue
    }
    if (token?.startsWith("--prompt=")) {
      if (prompt !== undefined) throw agentDevUsageError("--prompt")
      const value = token.slice("--prompt=".length)
      if (!value || value.trim().length === 0) throw agentDevUsageError("--prompt")
      prompt = value
      continue
    }
    if (token?.startsWith("-")) throw agentDevUsageError(token)
    if (directory !== undefined) throw agentDevUsageError("arguments")
    directory = token
  }
  if (!directory) throw agentDevUsageError("directory")
  if ((prompt !== undefined && serve) || (prompt === undefined && !serve)) throw agentDevUsageError("mode")
  return { directory, ...(prompt === undefined ? {} : { prompt }), serve, allowDirect }
}

function redactedWorkspaceId(workspaceId: string): string {
  return `local:${createHash("sha256").update(workspaceId).digest("hex").slice(0, 10)}`
}

function terminalSafeId(value: string): string {
  return safeHumanValue(value.replace(/[^A-Za-z0-9_.:-]/g, "_"))
}

function hasUnsupportedRefs(definition: Parameters<typeof createAgentValidateSuccess>[0]["definition"]): boolean {
  return copyRefs(definition.capabilityRequirements).length > 0
    || copyRefs(definition.skillRefs).length > 0
    || copyRefs(definition.mcpServerRefs).length > 0
}

function sameRefs(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]"
}

function assertAgentDevServeHostPolicy(): void {
  const host = process.env.HOST ?? "127.0.0.1"
  if (!isLoopbackHost(host)) throw agentDevUsageError("--host")
}

async function materializeAgentForDev(input: {
  directory: string
  deps: AgentCommandDeps
  catalogAdapter?: AgentDevTrustedToolCatalogAdapter
}): Promise<MaterializedAgentSourceV1> {
  const bundle = await input.deps.compileAgentDirectory(input.directory)
  const validated = createAgentValidateSuccess(bundle)
  const declaredToolRefs = validated.agent.refs.tools
  let toolCatalog: AuthoredAgentToolCatalog | undefined
  if (declaredToolRefs.length > 0 && !hasUnsupportedRefs(bundle.definition)) {
    try {
      toolCatalog = await input.catalogAdapter?.resolveToolCatalog({
        directory: input.directory,
        agentTypeId: validated.agent.agentTypeId,
        declaredToolRefs,
      })
    } catch {
      throw stableAgentCliError("AUTHORED_AGENT_CATALOG_INVALID", "toolRefs", "trusted authored tool catalog is invalid")
    }
  }

  let source: MaterializedAgentSourceV1
  try {
    source = await input.deps.materializeAgentDirectory({
      directory: input.directory,
      expectedAgentTypeId: validated.agent.agentTypeId,
      ...(toolCatalog === undefined ? {} : { toolCatalog }),
    })
  } catch (error) {
    if (error instanceof input.deps.AuthoredAgentMaterializationError) throw error
    throw error
  }
  if (!sameRefs(source.declaredToolRefs, declaredToolRefs)) {
    throw stableAgentCliError(
      "AUTHORED_AGENT_REFERENCE_UNKNOWN",
      "toolRefs",
      "authored agent tool references changed during trusted catalog resolution",
    )
  }
  return source
}

async function runAgentDevOneShot(input: {
  resolver: WorkspaceAgentDispatcherResolver
  workspaceId: string
  sessionId: string
  prompt: string
}): Promise<void> {
  const dispatcher = await input.resolver.resolve({ workspaceId: input.workspaceId, userId: "local-dev" })
  let sawTerminalOk = false
  for await (const event of dispatcher.send({ sessionId: input.sessionId, content: input.prompt })) {
    const chunk = event.chunk
    if (chunk.type === "error") throw stableAgentCliError("INTERNAL_ERROR", "turn", "authored agent dev turn failed")
    if (chunk.type !== "agent-end") continue
    if (chunk.willRetry === true) continue
    if (chunk.status === "ok") {
      sawTerminalOk = true
      break
    }
    if (chunk.status === "aborted") throw stableAgentCliError("ABORTED", "turn", "authored agent dev turn aborted")
    throw stableAgentCliError("INTERNAL_ERROR", "turn", "authored agent dev turn failed")
  }
  if (!sawTerminalOk) throw stableAgentCliError("INTERNAL_ERROR", "turn", "authored agent dev turn did not complete")
}

async function closeAppOnce(app: FastifyInstance): Promise<void> {
  const state = app as FastifyInstance & { __boringAgentDevClosePromise?: Promise<void> }
  state.__boringAgentDevClosePromise ??= app.close()
  return await state.__boringAgentDevClosePromise
}

export async function handleAgentDevCommand(input: {
  argv: string[]
  options: AgentCommandRunOptions
  deps: AgentCommandDeps
}): Promise<void> {
  const parsed = parseAgentDevArgv(input.argv)
  if (parsed.serve) assertAgentDevServeHostPolicy()
  let resolver: WorkspaceAgentDispatcherResolver | undefined
  const source = await materializeAgentForDev({
    directory: parsed.directory,
    deps: input.deps,
    catalogAdapter: input.options.agentDev?.trustedToolCatalogAdapter,
  })
  const registry = createLocalWorkspaceRegistry()
  const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd()
  const workspace = await registry.add(workspaceRoot, { name: basename(resolve(workspaceRoot)) || "workspace" })
  const cliRuntimeMode: CliMode = parsed.allowDirect ? "local" : "local-sandbox"
  const runtimeMode: RuntimeMode = parsed.allowDirect ? "direct" : "local"
  const sessionId = `dev-${source.agentTypeId}`
  const app = await input.deps.createMaterializedAgentDevApp({
    source,
    workspace: { root: workspace.path, sessionId: workspace.id },
    runtime: {
      mode: runtimeMode,
      ...(input.options.agentDev?.runtimeModeAdapter ? { runtimeModeAdapter: input.options.agentDev.runtimeModeAdapter } : {}),
      provisionWorkspace: input.options.agentDev?.provisionWorkspace ?? true,
    },
    harnessFactory: input.options.agentDev?.harnessFactory,
    onWorkspaceAgentDispatcher: (value) => { resolver = value },
  })
  let serving = false
  try {
    if (!resolver) throw new Error("agent dev dispatcher was not initialized")
    if (parsed.prompt !== undefined) {
      await runAgentDevOneShot({ resolver, workspaceId: workspace.id, sessionId, prompt: parsed.prompt })
      await closeAppOnce(app)
      console.log("Authored agent dev one-shot completed.")
      console.log(`  workspace   ${terminalSafeId(redactedWorkspaceId(workspace.id))}`)
      console.log(`  agent type  ${terminalSafeId(source.agentTypeId)}`)
      console.log(`  runtime     ${terminalSafeId(cliRuntimeMode)}`)
      console.log(`  session     ${terminalSafeId(sessionId)}`)
      return
    }

    const parsedPort = process.env.PORT === undefined || process.env.PORT.trim() === "" ? NaN : Number(process.env.PORT)
    const port = Number.isFinite(parsedPort) && parsedPort >= 0 ? parsedPort : 5200
    const host = "127.0.0.1"
    await registerStatic(app, input.options.publicDir)
    const address = await app.listen({ port, host })
    serving = true
    console.log(`  workspace   ${terminalSafeId(redactedWorkspaceId(workspace.id))}`)
    console.log(`  agent type  ${terminalSafeId(source.agentTypeId)}`)
    console.log(`  runtime     ${terminalSafeId(cliRuntimeMode)}`)
    console.log(`  session     ${terminalSafeId(sessionId)}`)
    console.log(`  url         ${safeHumanValue(address)}`)
    console.log("Authored agent dev server ready.")
    let shutdownPromise: Promise<void> | undefined
    const removeShutdownListeners = () => {
      process.off("SIGINT", shutdown)
      process.off("SIGTERM", shutdown)
    }
    const shutdown = () => {
      shutdownPromise ??= (async () => {
        try {
          await closeAppOnce(app)
          removeShutdownListeners()
          process.exit(0)
        } catch {
          removeShutdownListeners()
          console.error("INTERNAL_ERROR: \"authored agent dev server shutdown failed\"")
          process.exit(1)
        }
      })()
    }
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)
  } finally {
    if (parsed.prompt !== undefined || !serving) await closeAppOnce(app)
  }
}

export function isAgentDevSubcommand(argv: string[]): boolean {
  const agentIndex = argv.indexOf("agent")
  return agentIndex >= 0 && argv[agentIndex + 1] === "dev"
}

export function assertAgentDevCanLoadDeps(argv: string[]): void {
  const parsed = parseAgentDevArgv(argv)
  if (parsed.serve) assertAgentDevServeHostPolicy()
}
