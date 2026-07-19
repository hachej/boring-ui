import { execFile as execFileCallback } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import { afterEach } from "vitest"

export const execFile = promisify(execFileCallback)
const testDir = dirname(fileURLToPath(import.meta.url))
export const cliRoot = resolve(testDir, "../..")
export const distBin = join(cliRoot, "dist", "index.js")
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

export async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

export function testEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  // Preserve the caller's environment exactly. Boring CLI subcommands should
  // simply ignore model-provider env vars; tests must not mutate/scrub them.
  return { ...process.env, ...overrides, NO_COLOR: "1" }
}

export async function runCli(args: string[], env: Record<string, string>) {
  return await execFile(process.execPath, [distBin, ...args], {
    cwd: cliRoot,
    env: testEnv(env),
    timeout: 10_000,
  })
}

export async function runCliFailure(args: string[], env: Record<string, string> = {}) {
  try {
    await runCli(args, env)
    throw new Error("expected command to fail")
  } catch (error) {
    if (error instanceof Error && error.message === "expected command to fail") throw error
    return error as { stdout: string; stderr: string; code: number }
  }
}

export async function makeAgentDir(input: {
  definitionId?: string
  version?: string
  label?: string
  instructions?: string | Uint8Array
  refs?: {
    tools?: string[]
    capabilities?: string[]
    skills?: string[]
    mcpServers?: string[]
  }
} = {}): Promise<string> {
  const root = await makeTempDir("boring-cli-agent-validate-")
  const definition: Record<string, unknown> = {
    schemaVersion: 1,
    definitionId: input.definitionId ?? "reviewer-agent",
    version: input.version ?? "1.2.3",
    instructionsRef: "instructions.md",
  }
  if (input.label !== undefined) definition.label = input.label
  if (input.refs?.tools !== undefined) definition.toolRefs = input.refs.tools
  if (input.refs?.capabilities !== undefined) definition.capabilityRequirements = input.refs.capabilities
  if (input.refs?.skills !== undefined) definition.skillRefs = input.refs.skills
  if (input.refs?.mcpServers !== undefined) definition.mcpServerRefs = input.refs.mcpServers
  await writeFile(join(root, "agent.json"), `${JSON.stringify(definition, null, 2)}\n`, "utf-8")
  await writeFile(join(root, "instructions.md"), input.instructions ?? "Follow orders.\n")
  return root
}

export async function makePublicDir(): Promise<string> {
  const publicDir = await makeTempDir("boring-cli-agent-dev-public-")
  await mkdir(join(publicDir, "assets"), { recursive: true })
  await writeFile(join(publicDir, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf-8")
  return publicDir
}

export async function writeAgentDevSubprocessHarness(publicDir: string, captureFile: string): Promise<string> {
  const script = await makeTempDir("boring-cli-agent-dev-runner-")
  const scriptPath = join(script, "run-agent-dev.mjs")
  await writeFile(scriptPath, `
import { writeFileSync, readFileSync } from "node:fs"
import { runCli } from ${JSON.stringify(new URL(`file://${join(cliRoot, "dist", "server", "cli.js")}`).href)}
import { AuthoredAgentMaterializationError, resolveMode } from ${JSON.stringify(new URL(`file://${resolve(cliRoot, "../agent/dist/server/index.js")}`).href)}

const captureFile = ${JSON.stringify(captureFile)}
function readCapture() {
  try { return JSON.parse(readFileSync(captureFile, "utf8")) } catch { return {} }
}
function record(patch) {
  writeFileSync(captureFile, JSON.stringify({ ...readCapture(), ...patch }, null, 2))
}
class Store {
  constructor() { this.records = new Map() }
  _record(id, ctx = {}) {
    const existing = this.records.get(id)
    if (existing) return existing
    const record = { id, title: "Dev capture", createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z", turnCount: 0, ctx }
    this.records.set(id, record)
    return record
  }
  async list(ctx) { return [...this.records.values()].filter((record) => (record.ctx.workspaceId ?? "") === (ctx.workspaceId ?? "") && (record.ctx.userId ?? "") === (ctx.userId ?? "")) }
  async create(ctx, init) { return this._record("created-session", ctx) }
  async load(ctx, id) { return this._record(id, ctx) }
  async delete(ctx, id) { this.records.delete(id) }
}
function createHarnessFactory() {
  return async (input) => {
    const sessions = new Store()
    const adapters = new Map()
    record({ factoryInput: { cwd: input.cwd, systemPromptAppend: input.systemPromptAppend, tools: input.tools.map((tool) => tool.name) } })
    return {
      id: "cli-agent-dev-capture",
      placement: "server",
      sessions,
      async getPiSessionAdapter(sendInput, ctx) {
        const key = sendInput.sessionId
        if (!adapters.has(key)) adapters.set(key, new Adapter(input, key, ctx))
        return adapters.get(key)
      },
      async reloadSession() { return true },
    }
  }
}
class Adapter {
  constructor(input, sessionId, ctx) { this.input = input; this.sessionId = sessionId; this.ctx = ctx; this.subscribers = new Set(); this.streaming = false }
  readSnapshot() { return { state: {}, messages: [], isStreaming: this.streaming, isRetrying: false, retryAttempt: 0, pendingMessageCount: 0, steeringMessages: [], followUpMessages: [], followUpMode: "one-at-a-time", sessionId: this.sessionId, sessionName: "Dev capture" } }
  subscribe(listener) { this.subscribers.add(listener); return () => this.subscribers.delete(listener) }
  async prompt(promptInput) {
    const text = typeof promptInput === "string" ? promptInput : promptInput.text
    this.streaming = true
    record({ promptText: text, promptCtx: this.ctx })
    await new Promise((resolve) => setTimeout(resolve, 10))
    if (process.env.BORING_AGENT_DEV_WILL_RETRY_ONCE === "1") {
      this.emit({ type: "agent_start", turnId: "dev-retry" })
      this.emit({ type: "agent_end", turnId: "dev-retry", status: "error", messages: [{ role: "assistant", stopReason: "error", content: [], errorMessage: "RETRY_SECRET" }], willRetry: true })
      record({ retryObserved: true })
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const turnId = "dev-turn"
    this.emit({ type: "agent_start", turnId })
    if (process.env.BORING_AGENT_DEV_ERROR_EVENT === "1") {
      this.emit({ type: "message_update", assistantMessageEvent: { type: "error", reason: "error", error: { errorMessage: "ERROR_EVENT_SECRET" } } })
    }
    const tool = this.input.tools.find((candidate) => candidate.name === "dev_capture_tool")
    if (tool) {
      await tool.execute({ from: "cli-dev-capture" }, { abortSignal: new AbortController().signal, toolCallId: "dev-tool-call", sessionId: this.sessionId, workspaceId: this.ctx.workspaceId, requestId: "dev-request" })
      record({ toolInvoked: true })
    }
    const status = process.env.BORING_AGENT_DEV_TERMINAL_STATUS ?? "ok"
    this.streaming = false
    const terminalMessages = status === "error"
      ? [{ role: "assistant", stopReason: "error", content: [], errorMessage: "TERMINAL_SECRET" }]
      : status === "aborted"
        ? [{ role: "assistant", stopReason: "aborted", content: [] }]
        : []
    this.emit({ type: "agent_end", turnId, status, messages: terminalMessages, willRetry: false })
  }
  async followUp() {}
  clearFollowUp() {}
  async abort() { this.streaming = false }
  emit(event) { for (const listener of this.subscribers) listener(event) }
}
function createRuntimeModeAdapter() {
  const direct = resolveMode("direct")
  return {
    ...direct,
    id: process.env.BORING_AGENT_DEV_RUNTIME_ID ?? "direct",
    async create(ctx) {
      const previous = readCapture().runtime ?? {}
      record({ runtime: { ...previous, create: (previous.create ?? 0) + 1, mode: this.id } })
      return await direct.create(ctx)
    },
    async dispose() {
      const previous = readCapture().runtime ?? {}
      record({ runtime: { ...previous, dispose: (previous.dispose ?? 0) + 1, mode: this.id } })
      await direct.dispose?.()
      if (process.env.BORING_AGENT_DEV_DISPOSE_FAIL === "1") throw new Error("DISPOSE_SECRET")
    },
  }
}
const tool = {
  name: process.env.BORING_AGENT_DEV_INVALID_TOOL_NAME === "1" ? "invalid tool name" : "dev_capture_tool",
  description: "Capture dev CLI tool",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute(params, ctx) { record({ toolParams: params, toolCtx: { sessionId: ctx.sessionId, workspaceId: ctx.workspaceId } }); return { content: [{ type: "text", text: "DEV_TOOL_SECRET_OUTPUT" }] } },
}
const collidingTool = {
  ...tool,
  name: tool.name,
  description: "Colliding dev CLI tool",
}
const trustedToolCatalogAdapter = process.env.BORING_AGENT_DEV_WITH_CATALOG === "1" ? {
  async resolveToolCatalog(input) {
    record({ catalogRequest: input })
    if (process.env.BORING_AGENT_DEV_THROW_CATALOG_SECRET === "1") {
      const error = new Error("CATALOG_SECRET " + input.directory + " /tmp/catalog-secret-path")
      error.code = "AUTHORED_AGENT_TOOL_INVALID"
      error.field = input.directory + "/secret-field"
      throw error
    }
    if (process.env.BORING_AGENT_DEV_THROW_CATALOG_GET_SECRET === "1") {
      return { get() { const error = new Error("CATALOG_GET_SECRET " + input.directory + " /tmp/catalog-get-secret-path"); error.code = "AUTHORED_AGENT_TOOL_INVALID"; error.field = input.directory + "/get-secret-field"; throw error } }
    }
    if (process.env.BORING_AGENT_DEV_THROW_TYPED_CATALOG_GET_SECRET === "1") {
      return { get() { throw new AuthoredAgentMaterializationError({ code: "AUTHORED_AGENT_TOOL_INVALID", field: input.directory + "/typed-secret-field", message: "TYPED_CATALOG_SECRET " + input.directory + " /tmp/typed-catalog-secret-path" }) } }
    }
    if (process.env.BORING_AGENT_DEV_MUTATE_REFS_DURING_CATALOG === "1") {
      writeFileSync(input.directory + "/agent.json", JSON.stringify({ schemaVersion: 1, definitionId: input.agentTypeId, version: "1.2.3", instructionsRef: "instructions.md", toolRefs: ["capture.tool", "extra.tool"] }, null, 2))
    }
    if (process.env.BORING_AGENT_DEV_MUTATE_ID_DURING_CATALOG === "1") {
      writeFileSync(input.directory + "/agent.json", JSON.stringify({ schemaVersion: 1, definitionId: "mutated-agent", version: "1.2.3", instructionsRef: "instructions.md", toolRefs: ["capture.tool"] }, null, 2))
    }
    if (process.env.BORING_AGENT_DEV_OMIT_CATALOG_REF === "1") return new Map()
    if (process.env.BORING_AGENT_DEV_COLLIDING_TOOL === "1") return new Map([["capture.tool", tool], ["other.tool", collidingTool]])
    return new Map([["capture.tool", tool]])
  },
} : undefined
await runCli({
  argv: JSON.parse(process.env.BORING_AGENT_DEV_ARGS ?? "[]"),
  publicDir: ${JSON.stringify(publicDir)},
  agentDev: {
    trustedToolCatalogAdapter,
    harnessFactory: process.env.BORING_AGENT_DEV_WITH_HARNESS === "1" ? createHarnessFactory() : undefined,
    runtimeModeAdapter: process.env.BORING_AGENT_DEV_RUNTIME_ID ? createRuntimeModeAdapter() : undefined,
    provisionWorkspace: false,
  },
})
`, "utf-8")
  return scriptPath
}

export async function runAgentDevProgram(args: string[], env: Record<string, string> = {}) {
  const publicDir = await makePublicDir()
  const captureFile = join(await makeTempDir("boring-cli-agent-dev-capture-"), "capture.json")
  const script = await writeAgentDevSubprocessHarness(publicDir, captureFile)
  const result = await execFile(process.execPath, [script], {
    cwd: cliRoot,
    env: testEnv({ ...env, BORING_AGENT_DEV_ARGS: JSON.stringify(args), BORING_AGENT_DEV_CAPTURE_FILE: captureFile }),
    timeout: 15_000,
  })
  let capture: Record<string, unknown> = {}
  try { capture = JSON.parse(await readFile(captureFile, "utf-8")) as Record<string, unknown> } catch {}
  return { ...result, capture, captureFile, script }
}

export async function runAgentDevProgramFailure(args: string[], env: Record<string, string> = {}) {
  try {
    await runAgentDevProgram(args, env)
    throw new Error("expected command to fail")
  } catch (error) {
    if (error instanceof Error && error.message === "expected command to fail") throw error
    return error as { stdout: string; stderr: string; code: number }
  }
}
