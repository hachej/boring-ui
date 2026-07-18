import { execFile as execFileCallback, execFileSync, spawn } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import fastify from "fastify"
import { afterEach, beforeAll, expect, test } from "vitest"
import { registerStatic } from "../server/cli.js"

const execFile = promisify(execFileCallback)
const testDir = dirname(fileURLToPath(import.meta.url))
const cliRoot = resolve(testDir, "../..")
const distBin = join(cliRoot, "dist", "index.js")
const tempDirs: string[] = []

function hasNewerSource(root: string, artifact: string): boolean {
  if (!existsSync(artifact)) return true
  const artifactMtime = statSync(artifact).mtimeMs
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) continue
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(path)
      } else if (entry.isFile() && statSync(path).mtimeMs > artifactMtime) {
        return true
      }
    }
  }
  return false
}

beforeAll(() => {
  const agentRoot = resolve(cliRoot, "../agent")
  const pluginCliRoot = resolve(cliRoot, "../plugin-cli")
  if (hasNewerSource(join(agentRoot, "src"), join(agentRoot, "dist/server/index.js"))) {
    execFileSync("pnpm", ["--dir", agentRoot, "build"], { stdio: "pipe" })
  }
  if (hasNewerSource(join(pluginCliRoot, "src"), join(pluginCliRoot, "dist/index.js"))) {
    execFileSync("pnpm", ["--dir", pluginCliRoot, "build"], { stdio: "pipe" })
  }
  if (hasNewerSource(join(cliRoot, "src"), distBin)) {
    execFileSync("pnpm", ["--dir", cliRoot, "build"], { stdio: "pipe" })
  }
}, 90_000)

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function testEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  // Preserve the caller's environment exactly. Boring CLI subcommands should
  // simply ignore model-provider env vars; tests must not mutate/scrub them.
  return { ...process.env, ...overrides, NO_COLOR: "1" }
}

async function runCli(args: string[], env: Record<string, string>) {
  return await execFile(process.execPath, [distBin, ...args], {
    cwd: cliRoot,
    env: testEnv(env),
    timeout: 10_000,
  })
}

async function runCliFailure(args: string[], env: Record<string, string> = {}) {
  try {
    await runCli(args, env)
    throw new Error("expected command to fail")
  } catch (error) {
    if (error instanceof Error && error.message === "expected command to fail") throw error
    return error as { stdout: string; stderr: string; code: number }
  }
}

async function makeAgentDir(input: {
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

async function makePublicDir(): Promise<string> {
  const publicDir = await makeTempDir("boring-cli-agent-dev-public-")
  await mkdir(join(publicDir, "assets"), { recursive: true })
  await writeFile(join(publicDir, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf-8")
  return publicDir
}

async function writeAgentDevSubprocessHarness(publicDir: string, captureFile: string): Promise<string> {
  const script = await makeTempDir("boring-cli-agent-dev-runner-")
  const scriptPath = join(script, "run-agent-dev.mjs")
  await writeFile(scriptPath, `
import { writeFileSync, readFileSync } from "node:fs"
import { runCli } from ${JSON.stringify(new URL(`file://${join(cliRoot, "dist", "server", "cli.js")}`).href)}
import { resolveMode } from ${JSON.stringify(new URL(`file://${resolve(cliRoot, "../agent/dist/server/index.js")}`).href)}

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
    const expectedToolName = process.env.BORING_AGENT_DEV_EXPECT_TOOL_NAME ?? "dev_capture_tool"
    const tool = this.input.tools.find((candidate) => candidate.name === expectedToolName)
    if (tool) {
      const result = await tool.execute({ from: "cli-dev-capture" }, { abortSignal: new AbortController().signal, toolCallId: "dev-tool-call", sessionId: this.sessionId, workspaceId: this.ctx.workspaceId, requestId: "dev-request" })
      const textResult = Array.isArray(result?.content) ? result.content.map((part) => part?.text).filter(Boolean).join("\\n") : ""
      record({ toolInvoked: true, toolName: tool.name, toolResult: textResult })
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
function toolForRef(ref) {
  const name = ref === "capture.tool" ? "dev_capture_tool" : ref.replace(/[^A-Za-z0-9_-]/g, "_") + "_tool"
  const resultText = ref === "capture.tool" ? "DEV_TOOL_SECRET_OUTPUT" : "RESULT_FOR_" + name
  return {
    name,
    description: "Capture dev CLI tool " + name,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(params, ctx) { record({ toolParams: params, toolCtx: { sessionId: ctx.sessionId, workspaceId: ctx.workspaceId } }); return { content: [{ type: "text", text: resultText }] } },
  }
}
const trustedToolCatalogAdapter = process.env.BORING_AGENT_DEV_WITH_CATALOG === "1" ? {
  async resolveToolCatalog(input) {
    record({ catalogRequest: input })
    if (process.env.BORING_AGENT_DEV_MUTATE_REFS_DURING_CATALOG === "1") {
      writeFileSync(input.directory + "/agent.json", JSON.stringify({ schemaVersion: 1, definitionId: input.agentTypeId, version: "1.2.3", instructionsRef: "instructions.md", toolRefs: ["capture.tool", "extra.tool"] }, null, 2))
    }
    if (process.env.BORING_AGENT_DEV_MUTATE_ID_DURING_CATALOG === "1") {
      writeFileSync(input.directory + "/agent.json", JSON.stringify({ schemaVersion: 1, definitionId: "mutated-agent", version: "1.2.3", instructionsRef: "instructions.md", toolRefs: ["capture.tool"] }, null, 2))
    }
    const refs = (process.env.BORING_AGENT_DEV_CATALOG_REFS ?? "capture.tool").split(",").filter(Boolean)
    return new Map(refs.map((ref) => [ref, toolForRef(ref)]))
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

async function runAgentDevProgram(args: string[], env: Record<string, string> = {}) {
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

async function runAgentDevProgramFailure(args: string[], env: Record<string, string> = {}) {
  try {
    await runAgentDevProgram(args, env)
    throw new Error("expected command to fail")
  } catch (error) {
    if (error instanceof Error && error.message === "expected command to fail") throw error
    return error as { stdout: string; stderr: string; code: number }
  }
}


test("installed boring-ui --help exits without starting a workspace", async () => {
  const result = await runCli(["--help"], {})

  expect(result.stdout).toContain("Usage: boring-ui")
  expect(result.stdout).toContain("Listen host (default: 127.0.0.1)")
  expect(result.stdout).toContain("--allow-insecure-local-bridge")
  expect(result.stdout).toContain("boring-ui agent validate <dir>")
  expect(result.stdout).toContain("boring-ui agent dev <dir>")
})


test("boring-ui agent dev rejects bare, both, and missing prompt before workspace effects", async () => {
  const root = await makeAgentDir()
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml")
  const baseEnv = { BORING_UI_WORKSPACES_PATH: registryPath }

  for (const args of [
    ["agent", "dev"],
    ["agent", "dev", root],
    ["agent", "dev", root, "--prompt"],
    ["agent", "dev", root, "--prompt", "   "],
    ["agent", "dev", root, "--prompt=   "],
    ["agent", "dev", root, "--prompt", "hi", "--serve"],
    ["agent", "dev", root, "--bogus"],
    ["--json", "agent", "dev", root, "--prompt", "hi"],
  ]) {
    const failure = await runAgentDevProgramFailure(args, baseEnv)
    expect(failure.code).toBe(2)
    expect(failure.stdout).toBe("")
    expect(failure.stderr).toContain("AUTHORED_AGENT_DEV_USAGE_INVALID")
  }
  expect(existsSync(registryPath)).toBe(false)
}, 30_000)


test("boring-ui agent dev one-shot materializes refs through trusted RunCliOptions catalog and redacts output", async () => {
  const workspaceRoot = await makeTempDir("boring-cli-agent-dev-workspace-")
  await mkdir(join(workspaceRoot, ".agents", "skills", "ambient-skill"), { recursive: true })
  await writeFile(join(workspaceRoot, ".agents", "skills", "ambient-skill", "SKILL.md"), "---\nname: ambient-skill\n---\nAMBIENT_SKILL_SECRET\n", "utf-8")
  await mkdir(join(workspaceRoot, ".pi"), { recursive: true })
  await writeFile(join(workspaceRoot, ".pi", "SYSTEM.md"), "AMBIENT_SYSTEM_SECRET\n", "utf-8")
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml")
  const root = await makeAgentDir({
    definitionId: "dev-agent",
    instructions: "AUTHORED_DEV_SECRET_PROMPT\n",
    refs: { tools: ["capture.tool"] },
  })

  const result = await runAgentDevProgram(["agent", "dev", root, "--prompt", "--USER_DEV_SECRET_PROMPT", "--allow-direct"], {
    BORING_AGENT_WORKSPACE_ROOT: workspaceRoot,
    BORING_UI_WORKSPACES_PATH: registryPath,
    BORING_AGENT_DEV_WITH_CATALOG: "1",
    BORING_AGENT_DEV_WITH_HARNESS: "1",
    BORING_AGENT_DEV_RUNTIME_ID: "direct",
  })

  expect(result.stderr).toBe("")
  expect(result.stdout).toContain("Authored agent dev one-shot completed.")
  expect(result.stdout).toContain("agent type  dev-agent")
  expect(result.stdout).toContain("runtime     local")
  expect(result.stdout).toContain("session     dev-dev-agent")
  expect(result.stdout).toContain("workspace   local:")
  expect(result.stdout).not.toContain(workspaceRoot)
  expect(result.stdout).not.toContain(root)
  expect(result.stdout).not.toContain("USER_DEV_SECRET_PROMPT")
  expect(result.stdout).not.toContain("AUTHORED_DEV_SECRET_PROMPT")
  expect(result.stdout).not.toContain("DEV_TOOL_SECRET_OUTPUT")

  expect(result.capture).toMatchObject({
    promptText: "--USER_DEV_SECRET_PROMPT",
    toolInvoked: true,
    toolParams: { from: "cli-dev-capture" },
    runtime: { create: 1, dispose: 1, mode: "direct" },
  })
  const factoryInput = result.capture.factoryInput as { systemPromptAppend?: string; tools?: string[] }
  expect(factoryInput.systemPromptAppend).toContain("AUTHORED_DEV_SECRET_PROMPT")
  expect(factoryInput.systemPromptAppend).not.toContain("AMBIENT_SKILL_SECRET")
  expect(factoryInput.systemPromptAppend).not.toContain("AMBIENT_SYSTEM_SECRET")
  expect(factoryInput.tools).toContain("dev_capture_tool")
  expect(factoryInput.tools).not.toContain("plugin_diagnostics")
  expect((result.capture.catalogRequest as { directory?: string; agentTypeId?: string; declaredToolRefs?: string[] })).toMatchObject({
    directory: root,
    agentTypeId: "dev-agent",
    declaredToolRefs: ["capture.tool"],
  })
  expect(await readFile(registryPath, "utf-8")).toContain(workspaceRoot)
}, 30_000)


test("A1 trusted example validates, materializes, and dev one-shot reflects authored changes without importing authored modules", async () => {
  const exampleRoot = resolve(cliRoot, "../agent/examples/trusted-authored-agent")
  const workspaceRoot = await makeTempDir("boring-cli-a1-example-workspace-")
  const root = await makeTempDir("boring-cli-a1-example-agent-")
  await cp(exampleRoot, root, { recursive: true })

  const validation = await runCli(["agent", "validate", root, "--json"], {})
  expect(validation.stderr).toBe("")
  expect(JSON.parse(validation.stdout)).toMatchObject({
    schemaVersion: 1,
    ok: true,
    agent: {
      agentTypeId: "claims-assistant",
      refs: { tools: ["claims.lookup"] },
    },
  })
  expect(validation.stdout).not.toContain(root)

  const { materializeAgentDirectory } = await import(
    new URL(`file://${resolve(cliRoot, "../agent/dist/server/index.js")}`).href
  ) as typeof import("@hachej/boring-agent/server")
  const catalogTool = {
    name: "claims_lookup",
    description: "Trusted claims lookup",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() { return { content: [{ type: "text" as const, text: "ok" }] } },
  }
  const materialized = await materializeAgentDirectory({
    directory: root,
    expectedAgentTypeId: "claims-assistant",
    toolCatalog: new Map([["claims.lookup", catalogTool]]),
  })
  expect(materialized.instructions).toContain("authored claims assistant example")
  expect(materialized.declaredToolRefs).toEqual(["claims.lookup"])
  expect(materialized.tools.map((tool) => tool.name)).toEqual(["claims_lookup"])

  const first = await runAgentDevProgram(["agent", "dev", root, "--prompt", "claim status", "--allow-direct"], {
    BORING_AGENT_WORKSPACE_ROOT: workspaceRoot,
    BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-a1-example-registry-"), "workspaces.yaml"),
    BORING_AGENT_DEV_WITH_CATALOG: "1",
    BORING_AGENT_DEV_CATALOG_REFS: "claims.lookup",
    BORING_AGENT_DEV_EXPECT_TOOL_NAME: "claims_lookup_tool",
    BORING_AGENT_DEV_WITH_HARNESS: "1",
    BORING_AGENT_DEV_RUNTIME_ID: "direct",
  })
  expect(first.stderr).toBe("")
  expect(first.stdout).toContain("Authored agent dev one-shot completed.")
  expect(first.capture).toMatchObject({
    toolInvoked: true,
    toolName: "claims_lookup_tool",
    toolResult: "RESULT_FOR_claims_lookup_tool",
  })
  const firstPrompt = (first.capture.factoryInput as { systemPromptAppend?: string }).systemPromptAppend ?? ""
  expect(firstPrompt).toContain("authored claims assistant example")
  expect((first.capture.catalogRequest as { declaredToolRefs?: string[] }).declaredToolRefs).toEqual(["claims.lookup"])

  await writeFile(join(root, "instructions.md"), "CHANGED A1 authored prompt behavior.\n", "utf-8")
  await writeFile(join(root, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "claims-assistant",
    version: "1.0.1",
    instructionsRef: "instructions.md",
    toolRefs: ["claims.changed"],
  }, null, 2), "utf-8")
  const changed = await runAgentDevProgram(["agent", "dev", root, "--prompt", "claim status", "--allow-direct"], {
    BORING_AGENT_WORKSPACE_ROOT: workspaceRoot,
    BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-a1-example-registry-"), "workspaces.yaml"),
    BORING_AGENT_DEV_WITH_CATALOG: "1",
    BORING_AGENT_DEV_CATALOG_REFS: "claims.changed",
    BORING_AGENT_DEV_EXPECT_TOOL_NAME: "claims_changed_tool",
    BORING_AGENT_DEV_WITH_HARNESS: "1",
    BORING_AGENT_DEV_RUNTIME_ID: "direct",
  })
  expect(changed.stderr).toBe("")
  const changedPrompt = (changed.capture.factoryInput as { systemPromptAppend?: string }).systemPromptAppend ?? ""
  expect(changedPrompt).toContain("CHANGED A1 authored prompt behavior.")
  expect(changedPrompt).not.toContain("authored claims assistant example")
  expect(changed.capture).toMatchObject({
    toolInvoked: true,
    toolName: "claims_changed_tool",
    toolResult: "RESULT_FOR_claims_changed_tool",
  })
  expect(changed.capture.toolName).not.toBe(first.capture.toolName)
  expect(changed.capture.toolResult).not.toBe(first.capture.toolResult)
  expect((changed.capture.catalogRequest as { declaredToolRefs?: string[] }).declaredToolRefs).toEqual(["claims.changed"])
}, 45_000)


test("boring-ui agent dev preserves compiler and schema error codes after lazy deps load", async () => {
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml")

  const malformed = await makeTempDir("boring-cli-agent-dev-malformed-")
  await writeFile(join(malformed, "agent.json"), "{ definitely not json", "utf-8")
  await writeFile(join(malformed, "instructions.md"), "Malformed dev prompt must not leak.\n", "utf-8")
  const malformedFailure = await runAgentDevProgramFailure(["agent", "dev", malformed, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
  })
  expect(malformedFailure.stderr.trim()).toBe('AGENT_MANIFEST_INVALID_JSON "agent.json": "agent.json must contain valid JSON"')
  expect(malformedFailure.stderr).not.toContain(malformed)
  expect(malformedFailure.stderr).not.toContain("Malformed dev prompt")

  const schema = await makeTempDir("boring-cli-agent-dev-schema-")
  await writeFile(join(schema, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "schema-agent",
    version: "1.0.0",
    instructionsRef: "instructions.md",
    deploymentId: "not-allowed",
  }), "utf-8")
  await writeFile(join(schema, "instructions.md"), "Schema dev prompt must not leak.\n", "utf-8")
  const schemaFailure = await runAgentDevProgramFailure(["agent", "dev", schema, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
  })
  expect(schemaFailure.stderr.trim()).toBe('AGENT_DEFINITION_UNSUPPORTED_FIELD "deploymentId": "deploymentId is not supported by schema version 1"')
  expect(schemaFailure.stderr).not.toContain(schema)
  expect(schemaFailure.stderr).not.toContain("Schema dev prompt")

  const missingManifest = await makeTempDir("boring-cli-agent-dev-missing-")
  await writeFile(join(missingManifest, "instructions.md"), "Missing manifest dev prompt must not leak.\n", "utf-8")
  const missingFailure = await runAgentDevProgramFailure(["agent", "dev", missingManifest, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
  })
  expect(missingFailure.stderr.trim()).toBe('AGENT_MANIFEST_NOT_FOUND "agent.json": "agent.json does not exist"')
  expect(missingFailure.stderr).not.toContain(missingManifest)
  expect(missingFailure.stderr).not.toContain("Missing manifest dev prompt")
  expect(existsSync(registryPath)).toBe(false)
}, 30_000)


test("boring-ui agent dev rejects catalog TOCTOU mutations before workspace effects", async () => {
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml")
  const refsRoot = await makeAgentDir({ definitionId: "toctou-agent", refs: { tools: ["capture.tool"] } })
  const idRoot = await makeAgentDir({ definitionId: "toctou-id-agent", refs: { tools: ["capture.tool"] } })

  const refsFailure = await runAgentDevProgramFailure(["agent", "dev", refsRoot, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
    BORING_AGENT_DEV_WITH_CATALOG: "1",
    BORING_AGENT_DEV_MUTATE_REFS_DURING_CATALOG: "1",
  })
  expect(refsFailure.stderr).toContain("AUTHORED_AGENT_REFERENCE_UNKNOWN")

  const idFailure = await runAgentDevProgramFailure(["agent", "dev", idRoot, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
    BORING_AGENT_DEV_WITH_CATALOG: "1",
    BORING_AGENT_DEV_MUTATE_ID_DURING_CATALOG: "1",
  })
  expect(idFailure.stderr).toContain("AUTHORED_AGENT_TYPE_MISMATCH")
  expect(existsSync(registryPath)).toBe(false)
}, 30_000)


test("boring-ui agent dev defaults to local-sandbox runtime without direct fallback and supports ref-free agents", async () => {
  const workspaceRoot = await makeTempDir("boring-cli-agent-dev-sandbox-workspace-")
  const root = await makeAgentDir({ definitionId: "sandbox-agent" })

  const result = await runAgentDevProgram(["agent", "dev", root, "--prompt", "sandbox prompt"], {
    BORING_AGENT_WORKSPACE_ROOT: workspaceRoot,
    BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml"),
    BORING_AGENT_DEV_WITH_HARNESS: "1",
    BORING_AGENT_DEV_RUNTIME_ID: "local",
  })

  expect(result.stderr).toBe("")
  expect(result.stdout).toContain("runtime     local-sandbox")
  expect(result.capture).toMatchObject({ runtime: { create: 1, dispose: 1, mode: "local" } })
  expect(result.capture).not.toHaveProperty("catalogRequest")
}, 30_000)


test("boring-ui agent dev one-shot emits success only after cleanup succeeds", async () => {
  const root = await makeAgentDir({ definitionId: "cleanup-agent" })

  const failure = await runAgentDevProgramFailure(["agent", "dev", root, "--prompt", "cleanup prompt", "--allow-direct"], {
    BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml"),
    BORING_AGENT_DEV_WITH_HARNESS: "1",
    BORING_AGENT_DEV_RUNTIME_ID: "direct",
    BORING_AGENT_DEV_DISPOSE_FAIL: "1",
  })

  expect(failure.code).toBe(1)
  expect(failure.stdout).not.toContain("Authored agent dev one-shot completed.")
  expect(failure.stdout).not.toContain("cleanup-agent")
  expect(failure.stderr).toContain("INTERNAL_ERROR")
  expect(failure.stderr).not.toContain("DISPOSE_SECRET")
  expect(failure.stderr).not.toContain(root)
}, 30_000)


test("boring-ui agent dev one-shot requires terminal ok and allows retry before success", async () => {
  const retryRoot = await makeAgentDir({ definitionId: "retry-agent" })
  const retry = await runAgentDevProgram(["agent", "dev", retryRoot, "--prompt", "retry prompt", "--allow-direct"], {
    BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml"),
    BORING_AGENT_DEV_WITH_HARNESS: "1",
    BORING_AGENT_DEV_RUNTIME_ID: "direct",
    BORING_AGENT_DEV_WILL_RETRY_ONCE: "1",
  })
  expect(retry.stdout).toContain("Authored agent dev one-shot completed.")
  expect(retry.capture).toMatchObject({ retryObserved: true, runtime: { dispose: 1 } })
  expect(retry.stderr).toBe("")

  for (const [env, code, leakedSecret] of [
    [{ BORING_AGENT_DEV_TERMINAL_STATUS: "error" }, "INTERNAL_ERROR", "TERMINAL_SECRET"],
    [{ BORING_AGENT_DEV_TERMINAL_STATUS: "aborted" }, "ABORTED", "terminal failure prompt"],
    [{ BORING_AGENT_DEV_ERROR_EVENT: "1" }, "INTERNAL_ERROR", "ERROR_EVENT_SECRET"],
  ] as const) {
    const root = await makeAgentDir({ definitionId: `terminal-${code.toLowerCase().replace(/_/g, "-")}` })
    const failure = await runAgentDevProgramFailure(["agent", "dev", root, "--prompt", "terminal failure prompt", "--allow-direct"], {
      BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml"),
      BORING_AGENT_DEV_WITH_HARNESS: "1",
      BORING_AGENT_DEV_RUNTIME_ID: "direct",
      ...env,
    })
    expect(failure.code).toBe(1)
    expect(failure.stdout).toBe("")
    expect(failure.stderr).toContain(code)
    expect(failure.stderr).not.toContain(leakedSecret)
    expect(failure.stderr).not.toContain(root)
  }
}, 45_000)


test("boring-ui agent dev rejects direct host mode unless --allow-direct is explicit", async () => {
  const root = await makeAgentDir()
  const failure = await runAgentDevProgramFailure(["--mode", "local", "agent", "dev", root, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml"),
  })

  expect(failure.code).toBe(2)
  expect(failure.stderr).toContain("AUTHORED_AGENT_DEV_USAGE_INVALID")
})


test("boring-ui agent dev rejects unresolved and unsupported refs without workspace side effects", async () => {
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml")
  const unresolved = await makeAgentDir({ refs: { tools: ["missing.tool"] } })
  const unsupported = await makeAgentDir({ refs: { skills: ["ambient-skill"] } })

  const missingCatalog = await runAgentDevProgramFailure(["agent", "dev", unresolved, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
  })
  expect(missingCatalog.stderr).toContain("AUTHORED_AGENT_CATALOG_REQUIRED")

  const unknownRef = await runAgentDevProgramFailure(["agent", "dev", unresolved, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
    BORING_AGENT_DEV_WITH_CATALOG: "1",
  })
  expect(unknownRef.stderr).toContain("AUTHORED_AGENT_REFERENCE_UNKNOWN")

  const unsupportedRef = await runAgentDevProgramFailure(["agent", "dev", unsupported, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
  })
  expect(unsupportedRef.stderr).toContain("AUTHORED_AGENT_REFERENCE_UNSUPPORTED")
  expect(existsSync(registryPath)).toBe(false)
}, 30_000)


test("boring-ui agent dev serve rejects non-loopback host before workspace effects", async () => {
  const root = await makeAgentDir({ definitionId: "nonloopback-agent" })
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml")

  const failure = await runAgentDevProgramFailure(["agent", "dev", root, "--serve"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
    HOST: "0.0.0.0",
  })

  expect(failure.code).toBe(2)
  expect(failure.stdout).toBe("")
  expect(failure.stderr).toContain("AUTHORED_AGENT_DEV_USAGE_INVALID")
  expect(existsSync(registryPath)).toBe(false)
}, 30_000)


test("boring-ui agent dev serve listens without auto-turn and cleans up on signal", async () => {
  const workspaceRoot = await makeTempDir("boring-cli-agent-dev-serve-workspace-")
  const root = await makeAgentDir({ definitionId: "serve-agent", instructions: "SERVE_SECRET_PROMPT\n" })
  const publicDir = await makePublicDir()
  const captureFile = join(await makeTempDir("boring-cli-agent-dev-serve-capture-"), "capture.json")
  const script = await writeAgentDevSubprocessHarness(publicDir, captureFile)
  const child = spawn(process.execPath, [script], {
    cwd: cliRoot,
    env: testEnv({
      BORING_AGENT_DEV_ARGS: JSON.stringify(["agent", "dev", root, "--serve", "--allow-direct"]),
      BORING_AGENT_DEV_CAPTURE_FILE: captureFile,
      BORING_AGENT_DEV_WITH_HARNESS: "1",
      BORING_AGENT_DEV_RUNTIME_ID: "direct",
      BORING_AGENT_WORKSPACE_ROOT: workspaceRoot,
      BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml"),
      PORT: "0",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => { stdout += String(chunk) })
  child.stderr.on("data", (chunk) => { stderr += String(chunk) })
  try {
    await new Promise<void>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error(`agent dev serve did not become ready; stdout=${stdout} stderr=${stderr}`)), 10_000)
      child.stdout.on("data", () => {
        if (stdout.includes("Authored agent dev server ready.") && stdout.includes("session     dev-serve-agent")) {
          clearTimeout(timeout)
          resolveReady()
        }
      })
      child.once("exit", (code) => {
        clearTimeout(timeout)
        rejectReady(new Error(`agent dev serve exited early (${code}); stdout=${stdout} stderr=${stderr}`))
      })
    })
    expect(stdout).toContain("runtime     local")
    expect(stdout).not.toContain(root)
    expect(stdout).not.toContain(workspaceRoot)
    expect(stdout).not.toContain("SERVE_SECRET_PROMPT")
    const beforeSignal = JSON.parse(await readFile(captureFile, "utf-8")) as Record<string, unknown>
    expect(beforeSignal).toHaveProperty("factoryInput")
    expect(beforeSignal).not.toHaveProperty("promptText")
    child.kill("SIGTERM")
    child.kill("SIGINT")
    const exitCode = await new Promise<number | null>((resolveExit) => child.once("exit", resolveExit))
    expect(exitCode).toBe(0)
    const afterSignal = JSON.parse(await readFile(captureFile, "utf-8")) as { runtime?: { create?: number; dispose?: number } }
    expect(afterSignal.runtime).toMatchObject({ create: 1, dispose: 1 })
  } finally {
    if (!child.killed) child.kill("SIGTERM")
  }
}, 30_000)


test("boring-ui agent dev serve reports close failure without leaking disposal details", async () => {
  const root = await makeAgentDir({ definitionId: "close-failure-agent" })
  const publicDir = await makePublicDir()
  const captureFile = join(await makeTempDir("boring-cli-agent-dev-close-failure-capture-"), "capture.json")
  const script = await writeAgentDevSubprocessHarness(publicDir, captureFile)
  const child = spawn(process.execPath, [script], {
    cwd: cliRoot,
    env: testEnv({
      BORING_AGENT_DEV_ARGS: JSON.stringify(["agent", "dev", root, "--serve", "--allow-direct"]),
      BORING_AGENT_DEV_CAPTURE_FILE: captureFile,
      BORING_AGENT_DEV_WITH_HARNESS: "1",
      BORING_AGENT_DEV_RUNTIME_ID: "direct",
      BORING_AGENT_DEV_DISPOSE_FAIL: "1",
      BORING_AGENT_WORKSPACE_ROOT: await makeTempDir("boring-cli-agent-dev-close-failure-workspace-"),
      BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml"),
      PORT: "0",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => { stdout += String(chunk) })
  child.stderr.on("data", (chunk) => { stderr += String(chunk) })
  try {
    await new Promise<void>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error(`agent dev close-failure serve did not become ready; stdout=${stdout} stderr=${stderr}`)), 10_000)
      child.stdout.on("data", () => {
        if (stdout.includes("session     dev-close-failure-agent")) {
          clearTimeout(timeout)
          resolveReady()
        }
      })
      child.once("exit", (code) => {
        clearTimeout(timeout)
        rejectReady(new Error(`agent dev close-failure serve exited early (${code}); stdout=${stdout} stderr=${stderr}`))
      })
    })
    child.kill("SIGTERM")
    const exitCode = await new Promise<number | null>((resolveExit) => child.once("exit", resolveExit))
    expect(exitCode).toBe(1)
    expect(stderr).toContain("INTERNAL_ERROR")
    expect(stderr).not.toContain("DISPOSE_SECRET")
    const capture = JSON.parse(await readFile(captureFile, "utf-8")) as { runtime?: { dispose?: number } }
    expect(capture.runtime).toMatchObject({ dispose: 1 })
  } finally {
    if (!child.killed) child.kill("SIGTERM")
  }
}, 30_000)


test("boring-ui agent validate reports a valid directory in human format without prompt or path leakage", async () => {
  const root = await makeAgentDir({
    label: "Review helper",
    instructions: "Do not print this prompt.\n",
  })

  const result = await runCli(["agent", "validate", root], {})

  expect(result.stderr).toBe("")
  expect(result.stdout).toContain("Authored agent directory is valid.")
  expect(result.stdout).toContain("id: reviewer-agent")
  expect(result.stdout).toContain("version: 1.2.3")
  expect(result.stdout).toContain("label: \"Review helper\"")
  expect(result.stdout).toContain(`instructions: ${new TextEncoder().encode("Do not print this prompt.\n").byteLength} bytes`)
  expect(result.stdout).toContain("tools: 0")
  expect(result.stdout).not.toContain("Do not print this prompt")
  expect(result.stdout).not.toContain(root)
})


test("boring-ui agent validate --json emits exact AgentValidateSuccessV1", async () => {
  const instructions = "Hello π\n"
  const root = await makeAgentDir({
    label: "JSON helper",
    instructions,
  })

  const result = await runCli(["agent", "validate", root, "--json"], {})

  expect(result.stderr).toBe("")
  expect(JSON.parse(result.stdout)).toEqual({
    schemaVersion: 1,
    ok: true,
    agent: {
      agentTypeId: "reviewer-agent",
      version: "1.2.3",
      label: "JSON helper",
      instructions: {
        present: true,
        byteLength: new TextEncoder().encode(instructions).byteLength,
      },
      refs: {
        tools: [],
        capabilities: [],
        skills: [],
        mcpServers: [],
      },
    },
  })
  expect(result.stdout).not.toContain(instructions.trim())
  expect(result.stdout).not.toContain(root)
})


test("boring-ui agent validate reports declared refs without catalog resolution claims", { timeout: 20_000 }, async () => {
  const root = await makeAgentDir({
    refs: {
      tools: ["shell.read", "issue.lookup"],
      capabilities: ["workspace-ready"],
      skills: ["triage"],
      mcpServers: ["linear"],
    },
  })

  const human = await runCli(["agent", "validate", root], {})
  expect(human.stdout).toContain("tools: 2 (shell.read, issue.lookup)")
  expect(human.stdout).toContain("capabilities: 1 (workspace-ready)")
  expect(human.stdout).toContain("skills: 1 (triage)")
  expect(human.stdout).toContain("mcpServers: 1 (linear)")
  expect(human.stdout).not.toMatch(/resolved|materialized|catalog|runtime/i)

  const json = await runCli(["agent", "validate", root, "--json"], {})
  expect(JSON.parse(json.stdout).agent.refs).toEqual({
    tools: ["shell.read", "issue.lookup"],
    capabilities: ["workspace-ready"],
    skills: ["triage"],
    mcpServers: ["linear"],
  })
})


test("boring-ui agent validate --json emits exact AgentCliErrorV1 and exit for malformed JSON", async () => {
  const root = await makeTempDir("boring-cli-agent-malformed-")
  await writeFile(join(root, "agent.json"), "{ definitely not json", "utf-8")
  await writeFile(join(root, "instructions.md"), "Secret prompt.\n", "utf-8")

  const failure = await runCliFailure(["agent", "validate", root, "--json"])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "AGENT_MANIFEST_INVALID_JSON",
      field: "agent.json",
      message: "agent.json must contain valid JSON",
    },
  })
  expect(failure.stderr).not.toContain(root)
  expect(failure.stderr).not.toContain("Secret prompt")
})


test("boring-ui agent validate reports schema failures with stable code and field", async () => {
  const root = await makeTempDir("boring-cli-agent-schema-")
  await writeFile(join(root, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "schema-agent",
    version: "1.0.0",
    instructionsRef: "instructions.md",
    deploymentId: "not-allowed",
  }), "utf-8")
  await writeFile(join(root, "instructions.md"), "Schema prompt.\n", "utf-8")

  const failure = await runCliFailure(["agent", "validate", root, "--json"])

  expect(failure.code).toBe(1)
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "AGENT_DEFINITION_UNSUPPORTED_FIELD",
      field: "deploymentId",
      message: "deploymentId is not supported by schema version 1",
    },
  })
})


test("boring-ui agent validate reports missing inputs with stable compiler code and field", async () => {
  const root = await makeTempDir("boring-cli-agent-missing-")
  await writeFile(join(root, "instructions.md"), "Missing manifest prompt.\n", "utf-8")

  const failure = await runCliFailure(["agent", "validate", root, "--json"])

  expect(failure.code).toBe(1)
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "AGENT_MANIFEST_NOT_FOUND",
      field: "agent.json",
      message: "agent.json does not exist",
    },
  })
  expect(failure.stderr).not.toContain(root)
})


test("boring-ui agent validate rejects traversal instructions refs without leaking paths", async () => {
  const root = await makeTempDir("boring-cli-agent-traversal-")
  await writeFile(join(root, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "traversal-agent",
    version: "1.0.0",
    instructionsRef: "../instructions.md",
  }), "utf-8")

  const failure = await runCliFailure(["agent", "validate", root, "--json"])

  expect(failure.code).toBe(1)
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "AGENT_DEFINITION_INVALID",
      field: "instructionsRef",
      message: "instructionsRef must be a safe relative asset path",
    },
  })
  expect(failure.stderr).not.toContain(root)
})


test("boring-ui agent validate rejects symlink escapes with stable compiler code and field", async () => {
  const root = await makeTempDir("boring-cli-agent-symlink-")
  const outside = await makeTempDir("boring-cli-agent-symlink-outside-")
  await writeFile(join(root, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "symlink-agent",
    version: "1.0.0",
    instructionsRef: "instructions.md",
  }), "utf-8")
  await writeFile(join(outside, "instructions.md"), "Outside prompt.\n", "utf-8")
  await symlink(join(outside, "instructions.md"), join(root, "instructions.md"))

  const failure = await runCliFailure(["agent", "validate", root, "--json"])

  expect(failure.code).toBe(1)
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "AGENT_PATH_SYMLINK_ESCAPE",
      field: "instructionsRef",
      message: "instructionsRef resolves outside the agent directory",
    },
  })
  expect(failure.stderr).not.toContain(root)
  expect(failure.stderr).not.toContain(outside)
  expect(failure.stderr).not.toContain("Outside prompt")
})


test("boring-ui agent validate rejects invalid UTF-8 with stable compiler code and field", async () => {
  const root = await makeTempDir("boring-cli-agent-utf8-")
  await writeFile(join(root, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "utf8-agent",
    version: "1.0.0",
    instructionsRef: "instructions.md",
  }), "utf-8")
  await writeFile(join(root, "instructions.md"), new Uint8Array([0xc3, 0x28]))

  const failure = await runCliFailure(["agent", "validate", root, "--json"])

  expect(failure.code).toBe(1)
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "AGENT_ASSET_INVALID_UTF8",
      field: "instructionsRef",
      message: "instructionsRef must contain valid UTF-8",
    },
  })
  expect(failure.stderr).not.toContain(root)
})


test("boring-ui agent validate rejects invalid product agent IDs with stable materializer code", async () => {
  const root = await makeAgentDir({ definitionId: "Invalid_ID" })

  const failure = await runCliFailure(["agent", "validate", root, "--json"])

  expect(failure.code).toBe(1)
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "AUTHORED_AGENT_ID_INVALID",
      field: "definitionId",
      message: "definitionId must match ^[a-z][a-z0-9-]{0,62}$",
    },
  })
  expect(failure.stderr).not.toContain(root)
})


test("boring-ui agent validate --json ignores unrelated server mode configuration", async () => {
  const root = await makeAgentDir()

  const result = await runCli(["agent", "validate", root, "--json"], { BORING_MODE: "definitely-invalid" })

  expect(result.stderr).toBe("")
  expect(JSON.parse(result.stdout)).toMatchObject({
    schemaVersion: 1,
    ok: true,
    agent: { agentTypeId: "reviewer-agent" },
  })
})


test("boring-ui agent validate accepts exact --json before the agent command", async () => {
  const root = await makeAgentDir()

  const result = await runCli(["--json", "agent", "validate", root], {})

  expect(result.stderr).toBe("")
  expect(JSON.parse(result.stdout)).toMatchObject({
    schemaVersion: 1,
    ok: true,
    agent: { agentTypeId: "reviewer-agent" },
  })
})


test("boring-ui agent validate accepts exact --json between agent and validate", async () => {
  const root = await makeAgentDir()

  const result = await runCli(["agent", "--json", "validate", root], {})

  expect(result.stderr).toBe("")
  expect(JSON.parse(result.stdout)).toMatchObject({
    schemaVersion: 1,
    ok: true,
    agent: { agentTypeId: "reviewer-agent" },
  })
})


test("boring-ui options before bare agent fail safely without starting non-loopback folder mode", async () => {
  const failure = await runCliFailure(["--host", "0.0.0.0", "agent"])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(failure.stderr).toContain("CONFIG_INVALID")
  expect(failure.stderr).toContain('"--host"')
  expect(failure.stderr).not.toContain("starting http://")
  expect(failure.stderr).not.toContain("--allow-insecure-local-bridge")
})


test("boring-ui agent validate rejects extra positionals instead of validating the wrong directory", async () => {
  const root = await makeAgentDir()

  const failure = await runCliFailure(["agent", "validate", root, "extra", "--json"])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "CONFIG_INVALID",
      field: "arguments",
      message: "usage: boring-ui agent validate <dir>",
    },
  })
})


test("boring-ui agent validate rejects unsupported options with JSON error envelope", async () => {
  const root = await makeAgentDir()

  const failure = await runCliFailure(["agent", "validate", root, "--jsoon", "--json"])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "CONFIG_INVALID",
      field: "--jsoon",
      message: "usage: boring-ui agent validate <dir> [--json]",
    },
  })
})


test("boring-ui agent validate exact --json selects JSON even after an unsupported valued-looking option", async () => {
  const root = await makeAgentDir()

  const failure = await runCliFailure(["agent", "validate", root, "--port", "--json"])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "CONFIG_INVALID",
      field: "--port",
      message: "usage: boring-ui agent validate <dir> [--json]",
    },
  })
})


test("boring-ui agent validate exact --json selects JSON before an unsupported option", async () => {
  const root = await makeAgentDir()

  const failure = await runCliFailure(["agent", "validate", root, "--json", "--port"])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "CONFIG_INVALID",
      field: "--port",
      message: "usage: boring-ui agent validate <dir> [--json]",
    },
  })
})


test("boring-ui agent validate rejects valued --json syntax as human output unless exact --json is present", async () => {
  const root = await makeAgentDir()

  const failure = await runCliFailure(["agent", "validate", root, "--json=false"])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(failure.stderr).toContain("CONFIG_INVALID")
  expect(failure.stderr).toContain('"--json"')
  expect(failure.stderr).toContain('"usage: boring-ui agent validate <dir> [--json]"')
})


test("boring-ui agent validate human output escapes spoofing controls in manifest-controlled fields", async () => {
  const root = await makeAgentDir({
    version: "1.0.0\u202espoof\u202c\u0085",
    label: "Label\u2028Next\u2066spoof\u2069",
    refs: {
      tools: ["tool\u202eexe", "line\u2029break", "c1\u009bref"],
      capabilities: ["cap\u200fref"],
      skills: ["skill\u061cref"],
      mcpServers: ["mcp\u2066ref\u2069"],
    },
  })

  const result = await runCli(["agent", "validate", root], {})

  expect(result.stderr).toBe("")
  expect(result.stdout).toContain("1.0.0\\u202espoof\\u202c\\u0085")
  expect(result.stdout).toContain("Label\\u2028Next\\u2066spoof\\u2069")
  expect(result.stdout).toContain("tool\\u202eexe")
  expect(result.stdout).toContain("line\\u2029break")
  expect(result.stdout).toContain("c1\\u009bref")
  expect(result.stdout).toContain("cap\\u200fref")
  expect(result.stdout).toContain("skill\\u061cref")
  expect(result.stdout).toContain("mcp\\u2066ref\\u2069")
  expect(result.stdout).not.toContain("\u202espoof")
  expect(result.stdout).not.toContain("\u2028Next")
  expect(result.stdout).not.toContain("\u009bref")
})


test("boring-ui agent validate human errors escape manifest-controlled fields", async () => {
  const root = await makeTempDir("boring-cli-agent-human-redaction-")
  const unsafeKey = "bad\u001b]52;c;boom\u0007"
  await writeFile(join(root, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "escape-agent",
    version: "1.0.0",
    instructionsRef: "instructions.md",
    [unsafeKey]: true,
  }), "utf-8")
  await writeFile(join(root, "instructions.md"), "Prompt stays hidden.\n", "utf-8")

  const failure = await runCliFailure(["agent", "validate", root])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(failure.stderr).toContain("AGENT_DEFINITION_UNSUPPORTED_FIELD")
  expect(failure.stderr).toContain("\\u001b]52;c;boom\\u0007")
  expect(failure.stderr).not.toContain("\u001b]52;c;boom\u0007")
  expect(failure.stderr).not.toContain("Prompt stays hidden")
  expect(failure.stderr).not.toContain(root)
})


test("boring-ui agent validate human errors escape bidi and C1 controls in fields and messages", async () => {
  const root = await makeTempDir("boring-cli-agent-human-bidi-redaction-")
  const unsafeKey = "bad\u202espoof\u202c\u0085"
  await writeFile(join(root, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "escape-agent",
    version: "1.0.0",
    instructionsRef: "instructions.md",
    [unsafeKey]: true,
  }), "utf-8")
  await writeFile(join(root, "instructions.md"), "Prompt stays hidden.\n", "utf-8")

  const failure = await runCliFailure(["agent", "validate", root])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(failure.stderr).toContain("bad\\u202espoof\\u202c\\u0085")
  expect(failure.stderr).not.toContain("bad\u202espoof")
  expect(failure.stderr).not.toContain("\u0085")
  expect(failure.stderr).not.toContain("Prompt stays hidden")
  expect(failure.stderr).not.toContain(root)
})


test("boring-ui refuses non-loopback host without explicit insecure bridge opt-in", async () => {
  await expect(runCli(["--host", "0.0.0.0"], {})).rejects.toMatchObject({
    stderr: expect.stringContaining("--allow-insecure-local-bridge"),
  })
})

test("boring-ui plugin reuses plugin CLI install/list/remove handlers", async () => {
  const root = await makeTempDir("boring-cli-plugin-facade-")
  const workspaceRoot = join(root, "workspace")
  const pluginRoot = join(root, "facade-plugin")
  await mkdir(join(pluginRoot, "front"), { recursive: true })
  await mkdir(workspaceRoot, { recursive: true })
  await writeFile(join(pluginRoot, "front", "index.tsx"), "export default function Plugin() { return null }\n", "utf-8")
  await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
    name: "facade-plugin",
    version: "1.0.0",
    boring: { front: "front/index.tsx" },
  }), "utf-8")

  const install = await runCli(["plugin", "install", pluginRoot, "--workspace", workspaceRoot], {})
  expect(install.stdout).toContain("installed facade-plugin")
  expect(install.stdout).toContain("scope local")

  const list = await runCli(["plugin", "list", "--json", "--workspace", workspaceRoot], {})
  expect(JSON.parse(list.stdout).records).toEqual([expect.objectContaining({ id: "facade-plugin", scope: "local" })])

  await expect(runCli(["plugin", "remove", "facade-plugin", "--workspace", workspaceRoot], {})).resolves.toMatchObject({
    stdout: expect.stringContaining("removed facade-plugin"),
  })
}, 20_000)

test("package exposes an installable boring-ui bin with published assets", async () => {
  const packageJson = JSON.parse(await readFile(join(cliRoot, "package.json"), "utf-8")) as {
    bin?: Record<string, string>
    files?: string[]
    dependencies?: Record<string, string>
  }

  expect(packageJson.bin?.["boring-ui"]).toBe("./dist/index.js")
  expect(packageJson.files).toEqual(expect.arrayContaining(["dist/", "public/"]))
  expect(packageJson.dependencies).toEqual(expect.objectContaining({
    "@fastify/static": expect.any(String),
    "@hachej/boring-agent": expect.any(String),
    "@hachej/boring-ask-user": expect.any(String),
    "@hachej/boring-workspace": expect.any(String),
    fastify: expect.any(String),
  }))

  const builtBin = await readFile(distBin, "utf-8")
  expect(builtBin.startsWith("#!/usr/bin/env node")).toBe(true)

  const builtCli = await readFile(join(cliRoot, "dist", "server", "cli.js"), "utf-8")
  expect(builtCli).not.toMatch(/from ["']@mariozechner\/pi-coding-agent["']/)
  expect(builtCli).not.toMatch(/from ["']@hachej\/boring-agent\/(server|shared)["']/)
})

test("installed CLI workspace subcommands use an isolated registry", { timeout: 30_000 }, async () => {
  const root = await makeTempDir("boring-cli-install-root-")
  const project = await makeTempDir("boring-cli-install-project-")
  const registryPath = join(root, "workspaces.yaml")
  const env = { BORING_UI_WORKSPACES_PATH: registryPath }

  await expect(runCli(["workspaces", "list"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining("No workspaces"),
  })

  const addResult = await runCli(["workspaces", "add", project], env)
  expect(addResult.stdout).toContain(project)
  const id = addResult.stdout.match(/id\s+(\S+)/)?.[1]
  if (!id) throw new Error(`missing workspace id in output: ${addResult.stdout}`)

  await expect(runCli(["workspaces", "list"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining(id),
  })

  await expect(runCli(["workspaces", "rename", id, "Renamed", "Project"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining("Renamed Project"),
  })
  await expect(runCli(["workspaces", "list"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining("Renamed Project"),
  })

  await expect(runCli(["workspaces", "remove", id], env)).resolves.toMatchObject({
    stdout: expect.stringContaining(`removed ${id}`),
  })
  await expect(runCli(["workspaces", "list"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining("No workspaces"),
  })
})

test("installed CLI serves built assets with browser-safe MIME types", async () => {
  const publicDir = await makeTempDir("boring-cli-static-public-")
  await mkdir(join(publicDir, "assets"))
  await writeFile(
    join(publicDir, "index.html"),
    '<!doctype html><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">',
    "utf-8",
  )
  await writeFile(join(publicDir, "assets", "app.js"), "console.log('ok')", "utf-8")
  await writeFile(join(publicDir, "assets", "app.css"), "body { color: black; }", "utf-8")

  const app = fastify({ logger: false })
  await registerStatic(app, publicDir)
  try {
    const script = await app.inject({ method: "GET", url: "/assets/app.js" })
    const stylesheet = await app.inject({ method: "GET", url: "/assets/app.css" })
    const fallback = await app.inject({ method: "GET", url: "/workspace/deep-link" })

    expect(script.statusCode).toBe(200)
    expect(script.headers["content-type"]).toContain("application/javascript")
    expect(stylesheet.statusCode).toBe(200)
    expect(stylesheet.headers["content-type"]).toContain("text/css")
    expect(fallback.statusCode).toBe(200)
    expect(fallback.headers["content-type"]).toContain("text/html")
  } finally {
    await app.close()
  }
}, 20_000)

test("installed boring-ui help does not expose plugin authoring commands", async () => {
  const result = await runCli(["--help"], {})

  expect(result.stdout).toContain("Usage: boring-ui")
  expect(result.stdout).not.toContain("plugin-status")
  expect(result.stdout).not.toContain("scaffold-plugin")
  expect(result.stdout).not.toContain("verify-plugin")
  expect(result.stdout).not.toContain("test-plugin")
  expect(result.stdout).not.toContain("plugin create")
})

test("installed CLI rejects file paths as local workspaces", async () => {
  const root = await makeTempDir("boring-cli-install-root-")
  const fileDir = await makeTempDir("boring-cli-install-file-")
  const file = join(fileDir, "not-a-workspace.txt")
  await writeFile(file, "not a directory", "utf-8")
  const env = { BORING_UI_WORKSPACES_PATH: join(root, "workspaces.yaml") }

  await expect(runCli(["workspaces", "add", file], env)).rejects.toMatchObject({
    stderr: expect.stringContaining("workspace path is not a directory"),
  })
  await expect(runCli(["workspaces", "list"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining("No workspaces"),
  })
}, 20_000)
