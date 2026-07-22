import { describe, expect, it } from "vitest"
import { createAgent, type AgentCoreSessionService, type PiChatEventSubscriber, type PiSessionCreateInit, type PiSessionRequestContext } from "@hachej/boring-agent/core"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import { createBoundWorkspaceAgentDispatcher } from "../../../../../packages/agent/src/server/workspaceAgentDispatcher"
import "../../../../../packages/agent/src/server/http/middleware"
import type { AgentEvent, AgentTool, SessionCtx, SessionDetail, SessionStore, SessionSummary } from "@hachej/boring-agent/shared"
import type { FollowUpPayload, PiChatEvent, PromptPayload } from "@hachej/boring-agent/shared"
import { createBoringAutomationTool } from "../automationTool"
import { ManualRunExecutor, type VerifiedAutomationActor } from "../manualRunExecutor"
import { createAutomationOperations } from "../operations"
import type { AutomationStore } from "../store"
import type { Automation, AutomationCreate, AutomationPatch, AutomationRun, AutomationRunBegin, AutomationRunLifecyclePatch } from "../../shared"

const ACTOR: VerifiedAutomationActor = { workspaceId: "workspace-a", userId: "user-a" }
const SESSION_CTX: SessionCtx = { workspaceId: ACTOR.workspaceId, userId: ACTOR.userId }

/**
 * Exercises the complete nested path used in production:
 * active parent Agent turn -> boring_automation tool -> operations -> executor
 * -> resolver/bound dispatcher -> Agent.send without a sessionId -> fresh child.
 */
describe("boring_automation nested dispatch", () => {
  it("completes a fresh automation child session before the parent tool turn is released", async () => {
    const sessions = new NestedSessionStore()
    sessions.seed("parent-session", SESSION_CTX)
    const service = new NestedSessionService(sessions)
    const agent = createAgent({
      runtimeFactory: async () => ({
        harness: { id: "nested-tool-test", placement: "server", sessions },
        sessionStore: sessions,
        service,
      }),
    })
    const resolver: WorkspaceAgentDispatcherResolver = {
      async resolve(ctx) {
        return createBoundWorkspaceAgentDispatcher(agent, ctx)
      },
    }
    const automationStore = new NestedAutomationStore()
    const executor = new ManualRunExecutor({
      store: automationStore,
      dispatcherResolver: resolver,
      actorResolver: () => { throw new Error("request actor resolver must not be used") },
    })
    const operations = createAutomationOperations({ store: automationStore, actor: ACTOR, executor })
    const tool = createBoringAutomationTool({
      resolveOperationsForActor: async () => ({ operations }),
    })
    service.installParentTool(tool)

    const parentEventsPromise = collectEvents(agent.send({
      sessionId: "parent-session",
      content: "Run my automation now",
      ctx: SESSION_CTX,
    }))

    const toolResult = await service.waitForToolResult()
    expect(toolResult.isError).toBe(false)
    expect(toolResult.details).toMatchObject({
      ok: true,
      operation: "run",
      run: { status: "succeeded", sessionId: "session-1" },
    })
    expect(sessions.createContexts).toEqual([SESSION_CTX])
    expect(service.promptedSessionIds).toEqual(["parent-session", "session-1"])

    // The child tool result exists while the parent prompt is still deliberately held.
    expect(service.parentReleased).toBe(false)
    service.releaseParent()
    await expect(parentEventsPromise).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: "parent-session",
        chunk: expect.objectContaining({ type: "agent-end" }),
      }),
    ]))
    await agent.dispose()
  })
})

async function collectEvents(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

class NestedSessionStore implements SessionStore {
  private readonly records = new Map<string, SessionSummary>()
  private readonly owners = new Map<string, SessionCtx>()
  private created = 0
  readonly createContexts: SessionCtx[] = []

  seed(id: string, ctx: SessionCtx): void {
    this.records.set(id, summary(id))
    this.owners.set(id, { ...ctx })
  }

  async list(ctx: SessionCtx): Promise<SessionSummary[]> {
    return [...this.records.values()].filter((record) => sameCtx(this.owners.get(record.id), ctx))
  }

  async create(ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary> {
    this.createContexts.push({ ...ctx })
    const id = `session-${++this.created}`
    const record = { ...summary(id), title: init?.title ?? id }
    this.records.set(id, record)
    this.owners.set(id, { ...ctx })
    return record
  }

  async load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const record = this.records.get(sessionId)
    if (!record || !sameCtx(this.owners.get(sessionId), ctx)) throw new Error(`missing session ${sessionId}`)
    return record
  }

  async delete(ctx: SessionCtx, sessionId: string): Promise<void> {
    await this.load(ctx, sessionId)
    this.records.delete(sessionId)
    this.owners.delete(sessionId)
  }
}

class NestedSessionService implements AgentCoreSessionService {
  private readonly subscribers = new Map<string, Set<PiChatEventSubscriber>>()
  private readonly seq = new Map<string, number>()
  private tool?: AgentTool
  private toolResultPromise?: Promise<Awaited<ReturnType<AgentTool["execute"]>>>
  private markToolStarted!: () => void
  private readonly toolStarted = new Promise<void>((resolve) => { this.markToolStarted = resolve })
  private releaseParentGate!: () => void
  private readonly parentGate = new Promise<void>((resolve) => { this.releaseParentGate = resolve })
  readonly promptedSessionIds: string[] = []
  parentReleased = false

  constructor(private readonly sessions: NestedSessionStore) {}

  installParentTool(tool: AgentTool): void {
    this.tool = tool
  }

  async waitForToolResult() {
    await Promise.race([
      this.toolStarted,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("parent tool was not invoked")), 2_000)),
    ])
    return await this.toolResultPromise!
  }

  releaseParent(): void {
    this.parentReleased = true
    this.releaseParentGate()
  }

  async createSession(ctx: PiSessionRequestContext, init?: PiSessionCreateInit) {
    return this.sessions.create(toSessionCtx(ctx), init)
  }

  async deleteSession(ctx: PiSessionRequestContext, sessionId: string) {
    await this.sessions.delete(toSessionCtx(ctx), sessionId)
  }

  async readState(_ctx: PiSessionRequestContext, sessionId: string) {
    return {
      protocolVersion: 1 as const,
      sessionId,
      seq: this.seq.get(sessionId) ?? 0,
      status: "idle" as const,
      messages: [],
      queue: { followUps: [] },
      followUpMode: "one-at-a-time" as const,
    }
  }

  async subscribe(ctx: PiSessionRequestContext, sessionId: string, _cursor: number, subscriber: PiChatEventSubscriber) {
    await this.sessions.load(toSessionCtx(ctx), sessionId)
    const listeners = this.subscribers.get(sessionId) ?? new Set<PiChatEventSubscriber>()
    listeners.add(subscriber)
    this.subscribers.set(sessionId, listeners)
    return { type: "ok" as const, unsubscribe: () => listeners.delete(subscriber) }
  }

  async prompt(_ctx: PiSessionRequestContext, sessionId: string, payload: PromptPayload) {
    this.promptedSessionIds.push(sessionId)
    const turnId = `turn-${sessionId}`
    this.publish(sessionId, { type: "agent-start", seq: this.nextSeq(sessionId), turnId })
    if (sessionId === "parent-session") {
      if (!this.tool) throw new Error("parent tool is unavailable")
      this.toolResultPromise = this.tool.execute(
        { operation: "run", automationId: "automation-1" },
        {
          abortSignal: new AbortController().signal,
          toolCallId: "tool-call-1",
          sessionId,
          workspaceId: ACTOR.workspaceId,
          userId: ACTOR.userId,
        },
      )
      this.markToolStarted()
      await this.toolResultPromise
      await this.parentGate
    }
    this.publish(sessionId, { type: "agent-end", seq: this.nextSeq(sessionId), turnId, status: "ok" })
    return { accepted: true as const, cursor: this.seq.get(sessionId) ?? 0, clientNonce: payload.clientNonce }
  }

  async followUp(_ctx: PiSessionRequestContext, sessionId: string, payload: FollowUpPayload) {
    return { accepted: true as const, cursor: this.seq.get(sessionId) ?? 0, clientNonce: payload.clientNonce, clientSeq: payload.clientSeq, queued: true as const }
  }

  async clearQueue(_ctx: PiSessionRequestContext, sessionId: string) {
    return { accepted: true as const, cursor: this.seq.get(sessionId) ?? 0, cleared: 0 }
  }

  async interrupt(_ctx: PiSessionRequestContext, sessionId: string) {
    return { accepted: true as const, cursor: this.seq.get(sessionId) ?? 0 }
  }

  async stop(_ctx: PiSessionRequestContext, sessionId: string) {
    return { accepted: true as const, cursor: this.seq.get(sessionId) ?? 0, stopped: true as const, clearedQueue: [] }
  }

  private nextSeq(sessionId: string): number {
    const next = (this.seq.get(sessionId) ?? 0) + 1
    this.seq.set(sessionId, next)
    return next
  }

  private publish(sessionId: string, event: PiChatEvent): void {
    for (const subscriber of this.subscribers.get(sessionId) ?? []) subscriber(event)
  }
}

class NestedAutomationStore implements AutomationStore {
  private readonly automation: Automation = {
    id: "automation-1",
    title: "Nested automation",
    enabled: true,
    cron: "0 9 * * *",
    timezone: "UTC",
    model: "test:model",
    promptRef: "prompts/automation-1.md",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
  }
  private run?: AutomationRun

  async listAutomations() { return [this.automation] }
  async getAutomation(id: string) { return id === this.automation.id ? this.automation : null }
  async createAutomation(_input: AutomationCreate) { return this.automation }
  async updateAutomation(_id: string, _patch: AutomationPatch) { return this.automation }
  async deleteAutomation(_id: string) {}
  async getPrompt() { return "automation prompt" }
  async updatePrompt(_automationId: string, _body: string) {}
  async reconcileOrphanedRuns(_automationId: string) {}
  async beginRun(input: AutomationRunBegin) {
    this.run = {
      id: "run-1",
      automationId: input.automationId,
      sessionId: null,
      status: "queued",
      trigger: input.trigger,
      scheduledFor: input.scheduledFor ?? null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      promptSnapshot: input.promptSnapshot,
      modelSnapshot: input.modelSnapshot,
      error: null,
      createdAt: input.createdAt ?? "2026-07-19T00:00:00.000Z",
      updatedAt: input.createdAt ?? "2026-07-19T00:00:00.000Z",
    }
    return this.run
  }
  async updateRunLifecycle(_runId: string, patch: AutomationRunLifecyclePatch) {
    if (!this.run) throw new Error("run missing")
    this.run = { ...this.run, ...patch, updatedAt: patch.completedAt ?? this.run.updatedAt }
    return this.run
  }
  async listRuns() { return this.run ? [this.run] : [] }
}

function summary(id: string): SessionSummary {
  return { id, title: id, createdAt: "2026-07-19T00:00:00.000Z", updatedAt: "2026-07-19T00:00:00.000Z", turnCount: 0 }
}

function toSessionCtx(ctx: PiSessionRequestContext): SessionCtx {
  return { workspaceId: ctx.workspaceId, userId: ctx.authSubject }
}

function sameCtx(a: SessionCtx | undefined, b: SessionCtx | undefined): boolean {
  return (a?.workspaceId ?? "") === (b?.workspaceId ?? "") && (a?.userId ?? "") === (b?.userId ?? "")
}
