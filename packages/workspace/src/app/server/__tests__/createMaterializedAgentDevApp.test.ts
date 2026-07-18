import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent"
import {
  createMaterializedAgentDevApp,
  type CreateMaterializedAgentDevAppOptions,
} from "../createMaterializedAgentDevApp"
import {
  resolveMode,
  type AgentHarnessFactoryInput,
  type MaterializedAgentSourceV1,
  type RuntimeModeAdapter,
} from "@hachej/boring-agent/server"
import type {
  AgentCoreHarness,
  AgentCoreHarnessFactory,
  AgentCorePromptInput,
  AgentCoreSessionAdapter,
  AgentCoreSessionSnapshot,
  AgentTool,
  RunContext,
  SessionCtx,
  SessionDetail,
  SessionStore,
  SessionSummary,
} from "@hachej/boring-agent/shared"
import { afterEach, expect, test, vi } from "vitest"

const tempDirs: string[] = []
const NOW = "2026-07-18T00:00:00.000Z"

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function testTool(name = "authored_capture_tool", calls: Array<{ params: Record<string, unknown>; ctx: unknown }> = []): AgentTool {
  return {
    name,
    description: "Capture harness test tool",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(params, ctx) {
      calls.push({ params, ctx })
      return { content: [{ type: "text", text: "CAPTURE_TOOL_OK" }] }
    },
  }
}

function source(overrides: Partial<MaterializedAgentSourceV1> = {}): MaterializedAgentSourceV1 {
  return Object.freeze({
    schemaVersion: 1,
    agentTypeId: "capture-agent",
    version: "1.0.0",
    instructions: "AUTHORED_CAPTURE_INSTRUCTIONS",
    tools: Object.freeze([]),
    declaredToolRefs: Object.freeze([]),
    ...overrides,
  })
}

class CaptureSessionStore implements SessionStore {
  private readonly records = new Map<string, SessionSummary>()

  async list(_ctx: SessionCtx): Promise<SessionSummary[]> {
    return [...this.records.values()]
  }

  async create(_ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary> {
    const id = `capture-${this.records.size + 1}`
    const record = this.record(id, init?.title ?? "Capture")
    this.records.set(id, record)
    return { ...record }
  }

  async load(_ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const existing = this.records.get(sessionId)
    if (existing) return { ...existing }
    const record = this.record(sessionId, "Capture")
    this.records.set(sessionId, record)
    return { ...record }
  }

  async delete(_ctx: SessionCtx, sessionId: string): Promise<void> {
    this.records.delete(sessionId)
  }

  private record(id: string, title: string): SessionSummary {
    return { id, title, createdAt: NOW, updatedAt: NOW, turnCount: 0 }
  }
}

interface CaptureHarnessState {
  factoryInputs: AgentHarnessFactoryInput[]
  modelPrompts: string[]
  promptInputs: AgentCorePromptInput[]
  runContexts: RunContext[]
}

function createCaptureHarnessFactory(targetToolName: string, state: CaptureHarnessState): AgentCoreHarnessFactory {
  return async (input): Promise<AgentCoreHarness> => {
    state.factoryInputs.push(input)
    const sessions = new CaptureSessionStore()
    const adapter = new CaptureAdapter(input, targetToolName, state)
    return {
      id: "materialized-agent-dev-capture",
      placement: "server",
      sessions,
      async getPiSessionAdapter(_sendInput, ctx) {
        state.runContexts.push(ctx)
        return adapter
      },
      getSystemPrompt() {
        return adapter.systemPrompt()
      },
      async reloadSession() {
        return true
      },
    }
  }
}

class CaptureAdapter implements AgentCoreSessionAdapter {
  private readonly subscribers = new Set<(event: AgentSessionEvent) => void>()

  constructor(
    private readonly input: AgentHarnessFactoryInput,
    private readonly targetToolName: string,
    private readonly state: CaptureHarnessState,
  ) {}

  systemPrompt(): string {
    return ["CAPTURE_BASE_PROMPT", this.input.systemPromptAppend].filter(Boolean).join("\n\n")
  }

  readSnapshot(): AgentCoreSessionSnapshot {
    return {
      state: {},
      messages: [],
      isStreaming: false,
      isRetrying: false,
      retryAttempt: 0,
      pendingMessageCount: 0,
      steeringMessages: [],
      followUpMessages: [],
      followUpMode: "one-at-a-time",
      sessionId: "capture-session",
      sessionName: "Capture",
    }
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  async prompt(input: AgentCorePromptInput): Promise<void> {
    this.state.promptInputs.push(input)
    this.state.modelPrompts.push(this.systemPrompt())
    const tool = this.input.tools.find((candidate) => candidate.name === this.targetToolName)
    if (!tool) throw new Error(`capture harness tool missing: ${this.targetToolName}`)
    await tool.execute({ from: "capture-harness" }, {
      abortSignal: new AbortController().signal,
      toolCallId: "capture-tool-call",
      sessionId: "capture-session",
      workspaceId: "default",
      requestId: "capture-request",
    })
    this.emit({ type: "agent_end", messages: [], willRetry: false })
  }

  async followUp(): Promise<void> {}
  clearFollowUp(): void {}
  async abort(): Promise<void> {}

  private emit(event: AgentSessionEvent): void {
    for (const subscriber of this.subscribers) subscriber(event)
  }
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1
}

function countingDirectAdapter(counts: { create: number; dispose: number }): RuntimeModeAdapter {
  const direct = resolveMode("direct")
  return {
    ...direct,
    id: "direct",
    async create(ctx) {
      counts.create += 1
      return await direct.create(ctx)
    },
    async dispose() {
      counts.dispose += 1
      await direct.dispose?.()
    },
  }
}

async function createCaptureApp(
  overrides: Partial<CreateMaterializedAgentDevAppOptions> & { source?: MaterializedAgentSourceV1 } = {},
  state: CaptureHarnessState = { factoryInputs: [], modelPrompts: [], promptInputs: [], runContexts: [] },
) {
  const workspaceRoot = await makeTempDir("boring-materialized-dev-")
  const toolCalls: Array<{ params: Record<string, unknown>; ctx: unknown }> = []
  const authoredTool = testTool("authored_capture_tool", toolCalls)
  const counts = { create: 0, dispose: 0 }
  const dispatcher = vi.fn()
  const app = await createMaterializedAgentDevApp({
    source: source({ tools: Object.freeze([authoredTool]), declaredToolRefs: Object.freeze(["capture.ref"]) }),
    workspace: { root: workspaceRoot },
    runtime: { mode: "direct", runtimeModeAdapter: countingDirectAdapter(counts), provisionWorkspace: false },
    harnessFactory: createCaptureHarnessFactory(authoredTool.name, state),
    onWorkspaceAgentDispatcher: dispatcher,
    ...overrides,
  })
  return { app, workspaceRoot, toolCalls, counts, dispatcher, state }
}

test("materialized dev app maps authored instructions/tools once into the existing runtime", async () => {
  const { app, workspaceRoot, toolCalls, counts, dispatcher, state } = await createCaptureApp()
  try {
    const catalog = await app.inject({ method: "GET", url: "/api/v1/agent/catalog" })
    expect(catalog.statusCode).toBe(200)
    expect(catalog.json().tools.map((tool: { name: string }) => tool.name)).toContain("authored_capture_tool")

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/agent/pi-chat/capture-session/prompt",
      payload: { message: "invoke the authored tool", clientNonce: "capture-nonce-1" },
    })
    expect(response.statusCode).toBe(202)

    await vi.waitFor(() => expect(toolCalls).toHaveLength(1))
    expect(toolCalls[0]?.params).toEqual({ from: "capture-harness" })
    expect(state.promptInputs).toHaveLength(1)
    expect(state.modelPrompts).toHaveLength(1)
    expect(state.modelPrompts[0]).toContain("AUTHORED_CAPTURE_INSTRUCTIONS")
    expect(countOccurrences(state.modelPrompts[0] ?? "", "AUTHORED_CAPTURE_INSTRUCTIONS")).toBe(1)
    expect(state.factoryInputs).toHaveLength(1)
    expect(state.factoryInputs[0]?.cwd).toBe(workspaceRoot)
    expect(state.factoryInputs[0]?.tools.map((tool) => tool.name)).toContain("authored_capture_tool")
    expect(state.runContexts[0]?.workdir).toBe(workspaceRoot)
    expect(dispatcher).toHaveBeenCalledTimes(1)
    expect(counts.create).toBe(1)
  } finally {
    await app.close()
  }
  expect(counts.dispose).toBe(1)
})

async function writeAmbientCommandExtension(workspaceRoot: string): Promise<void> {
  await mkdir(join(workspaceRoot, ".pi", "extensions"), { recursive: true })
  await writeFile(join(workspaceRoot, ".pi", "extensions", "ambient-command.js"), `export default function(pi) {
  pi.registerCommand("ambient-probe", {
    description: "Ambient command that must not load by default.",
    async handler() {}
  })
}
`, "utf8")
}

test("materialized dev app defaults to no ambient plugins, plugin authoring, or skills", async () => {
  const workspaceRoot = await makeTempDir("boring-materialized-dev-ambient-")
  await mkdir(join(workspaceRoot, ".agents", "skills", "ambient-skill"), { recursive: true })
  await writeFile(join(workspaceRoot, ".agents", "skills", "ambient-skill", "SKILL.md"), "---\nname: ambient-skill\n---\n", "utf8")
  await writeAmbientCommandExtension(workspaceRoot)

  const state: CaptureHarnessState = { factoryInputs: [], modelPrompts: [], promptInputs: [], runContexts: [] }
  const app = await createMaterializedAgentDevApp({
    source: source(),
    workspace: { root: workspaceRoot },
    runtime: { mode: "direct", provisionWorkspace: false },
    harnessFactory: createCaptureHarnessFactory("missing-no-tools", state),
  })
  try {
    const [skills, catalog] = await Promise.all([
      app.inject({ method: "GET", url: "/api/v1/agent/skills" }),
      app.inject({ method: "GET", url: "/api/v1/agent/catalog" }),
    ])
    expect(skills.statusCode).toBe(200)
    expect(skills.json().skills.map((skill: { name: string }) => skill.name)).not.toContain("ambient-skill")
    const toolNames = catalog.json().tools.map((tool: { name: string }) => tool.name)
    expect(toolNames).not.toContain("plugin_diagnostics")
    expect(state.factoryInputs[0]?.systemPromptAppend ?? "").toContain("AUTHORED_CAPTURE_INSTRUCTIONS")
    expect(state.factoryInputs[0]?.systemPromptAppend ?? "").not.toContain("User workspace skills")
    expect(state.factoryInputs[0]?.systemPromptAppend ?? "").not.toContain("boring-ui-plugin scaffold")
    expect(state.factoryInputs[0]?.systemPromptAppend ?? "").not.toContain("boring-plugin-authoring")
  } finally {
    await app.close()
  }
})

test("materialized dev app forwards default Pi isolation to the real resource loader", async () => {
  const workspaceRoot = await makeTempDir("boring-materialized-dev-real-pi-isolation-")
  await mkdir(join(workspaceRoot, ".pi"), { recursive: true })
  await writeFile(join(workspaceRoot, ".pi", "SYSTEM.md"), "AMBIENT_SYSTEM_PROMPT", "utf8")
  await writeFile(join(workspaceRoot, ".pi", "APPEND_SYSTEM.md"), "AMBIENT_APPEND_PROMPT", "utf8")
  await writeAmbientCommandExtension(workspaceRoot)

  const app = await createMaterializedAgentDevApp({
    source: source({ instructions: "REAL_PI_AUTHORED_INSTRUCTIONS" }),
    workspace: { root: workspaceRoot },
    runtime: { mode: "direct", provisionWorkspace: false },
  })
  try {
    const commands = await app.inject({ method: "GET", url: "/api/v1/agent/commands?sessionId=real-pi-defaults" })
    expect(commands.statusCode).toBe(200)
    expect(commands.json().commands.map((command: { name: string }) => command.name)).not.toContain("ambient-probe")

    const prompt = await app.inject({ method: "GET", url: "/api/v1/agent/sessions/real-pi-defaults/system-prompt" })
    expect(prompt.statusCode).toBe(200)
    const systemPrompt = prompt.json().systemPrompt as string
    expect(systemPrompt).toContain("REAL_PI_AUTHORED_INSTRUCTIONS")
    expect(systemPrompt).not.toContain("AMBIENT_SYSTEM_PROMPT")
    expect(systemPrompt).not.toContain("AMBIENT_APPEND_PROMPT")
  } finally {
    await app.close()
  }
})

test("materialized dev app trusted-local plugin opt-in makes ambient extension fixture observable", async () => {
  const workspaceRoot = await makeTempDir("boring-materialized-dev-real-pi-extension-opt-in-")
  await writeAmbientCommandExtension(workspaceRoot)

  const app = await createMaterializedAgentDevApp({
    source: source(),
    workspace: { root: workspaceRoot },
    runtime: { mode: "direct", provisionWorkspace: false },
    trustedLocal: { externalPlugins: true },
  })
  try {
    const commands = await app.inject({ method: "GET", url: "/api/v1/agent/commands?sessionId=real-pi-opt-in" })
    expect(commands.statusCode).toBe(200)
    expect(commands.json().commands.map((command: { name: string }) => command.name)).toContain("ambient-probe")
  } finally {
    await app.close()
  }
}, 15_000)

test("materialized dev app supports ref-free pre-materialized sources", async () => {
  const state: CaptureHarnessState = { factoryInputs: [], modelPrompts: [], promptInputs: [], runContexts: [] }
  const workspaceRoot = await makeTempDir("boring-materialized-dev-ref-free-")
  const app = await createMaterializedAgentDevApp({
    source: source({ tools: Object.freeze([]), declaredToolRefs: Object.freeze([]), instructions: "REF_FREE_INSTRUCTIONS" }),
    workspace: { root: workspaceRoot },
    runtime: { mode: "direct", provisionWorkspace: false },
    harnessFactory: createCaptureHarnessFactory("missing-ref-free", state),
  })
  try {
    const catalog = await app.inject({ method: "GET", url: "/api/v1/agent/catalog" })
    expect(catalog.statusCode).toBe(200)
    expect(catalog.json().tools.map((tool: { name: string }) => tool.name)).not.toContain("authored_capture_tool")
    expect(state.factoryInputs[0]?.systemPromptAppend).toContain("REF_FREE_INSTRUCTIONS")
  } finally {
    await app.close()
  }
})

test("materialized dev app rejects tool collisions before model harness creation and disposes", async () => {
  const workspaceRoot = await makeTempDir("boring-materialized-dev-collision-")
  const state: CaptureHarnessState = { factoryInputs: [], modelPrompts: [], promptInputs: [], runContexts: [] }
  const dispatcher = vi.fn()
  const counts = { create: 0, dispose: 0 }
  await expect(createMaterializedAgentDevApp({
    source: source({ tools: Object.freeze([testTool("read")]), declaredToolRefs: Object.freeze(["collides.read"]) }),
    workspace: { root: workspaceRoot },
    runtime: { mode: "direct", runtimeModeAdapter: countingDirectAdapter(counts), provisionWorkspace: false },
    harnessFactory: createCaptureHarnessFactory("read", state),
    onWorkspaceAgentDispatcher: dispatcher,
  })).rejects.toMatchObject({ code: "AUTHORED_AGENT_TOOL_COLLISION" })
  expect(state.factoryInputs).toHaveLength(0)
  expect(dispatcher).not.toHaveBeenCalled()
  expect(counts).toEqual({ create: 1, dispose: 1 })
})

test("materialized dev app rejects runtime adapter and policy mode mismatch before composing", async () => {
  const workspaceRoot = await makeTempDir("boring-materialized-dev-runtime-policy-")
  const state: CaptureHarnessState = { factoryInputs: [], modelPrompts: [], promptInputs: [], runContexts: [] }
  await expect(createMaterializedAgentDevApp({
    source: source(),
    workspace: { root: workspaceRoot },
    runtime: { mode: "local", runtimeModeAdapter: countingDirectAdapter({ create: 0, dispose: 0 }), provisionWorkspace: false },
    harnessFactory: createCaptureHarnessFactory("missing-runtime-policy", state),
  })).rejects.toMatchObject({
    code: "CONFIG_INVALID",
    field: "runtime.runtimeModeAdapter",
    message: "runtimeModeAdapter id direct does not match explicit mode local",
  })
  expect(state.factoryInputs).toHaveLength(0)
})

test("materialized dev app rejects missing workspace root with a stable code", async () => {
  await expect(createMaterializedAgentDevApp({
    source: source(),
    workspace: { root: " " },
    runtime: { mode: "direct", provisionWorkspace: false },
  })).rejects.toMatchObject({
    code: "CONFIG_INVALID",
    field: "workspace.root",
  })
})

test("materialized dev app rejects missing runtime mode before composition", async () => {
  const workspaceRoot = await makeTempDir("boring-materialized-dev-missing-mode-")
  await expect(createMaterializedAgentDevApp({
    source: source(),
    workspace: { root: workspaceRoot },
    runtime: { provisionWorkspace: false } as never,
  })).rejects.toMatchObject({
    code: "CONFIG_INVALID",
    field: "runtime.mode",
  })
})

test("materialized dev app rejects missing provisionWorkspace before composition", async () => {
  const workspaceRoot = await makeTempDir("boring-materialized-dev-missing-provision-")
  await expect(createMaterializedAgentDevApp({
    source: source(),
    workspace: { root: workspaceRoot },
    runtime: { mode: "direct" } as never,
  })).rejects.toMatchObject({
    code: "CONFIG_INVALID",
    field: "runtime.provisionWorkspace",
  })
})

test("materialized dev app disposes when dispatcher callback throws after runtime creation", async () => {
  const workspaceRoot = await makeTempDir("boring-materialized-dev-dispatcher-throws-")
  const counts = { create: 0, dispose: 0 }
  await expect(createMaterializedAgentDevApp({
    source: source(),
    workspace: { root: workspaceRoot },
    runtime: { mode: "direct", runtimeModeAdapter: countingDirectAdapter(counts), provisionWorkspace: false },
    onWorkspaceAgentDispatcher: () => {
      throw new Error("dispatcher callback failed")
    },
  })).rejects.toThrow("dispatcher callback failed")
  expect(counts).toEqual({ create: 1, dispose: 1 })
})
