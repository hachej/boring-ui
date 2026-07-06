import { HarnessPiChatService } from './pi-chat/harnessPiChatService'
import { formatOffset, parseOffset, type EventStreamStore } from './events/eventStreamStore'
import type { AgentMeteringSink } from './pi-chat/metering'
import type { PiSessionRequestContext } from './pi-chat/piSessionIdentity'
import type { AgentHarness, AgentHarnessFactoryInput } from '../shared/harness'
import type { Workspace } from '../shared/workspace'
import type {
  Agent,
  AgentConfig,
  AgentEvent,
  AgentReadiness,
  AgentResolveInputResponse,
  AgentSessions,
  PendingInputRequest,
  ResolveInputResponse,
  AgentSendInput,
  AgentStartReceipt,
  AgentStreamOptions,
} from '../shared/events'
import { AgentNotImplementedError, sessionStreamPath } from '../shared/events'
import type { SessionCtx, SessionListOptions, SessionStore } from '../shared/session'
import type { PromptPayload } from '../shared/chat'
import { ErrorCode } from '../shared/error-codes'
import type { AgentTool, ToolExecContext, ToolResult } from '../shared/tool'
import { MemoryPendingInputStore, type PendingInputRecord, type PendingInputStore } from './events/pendingRequests'

const DEFAULT_WORKDIR = ''
const DEFAULT_LIVE_BUFFER_SIZE = 1_000

interface AgentRuntime {
  harness: AgentHarness
  sessionStore: SessionStore
  service: HarnessPiChatService
}

export interface AgentRuntimeAdapterView {
  harness: AgentHarness
  sessionStore: SessionStore
  service: unknown
}

export interface CreateAgentRuntimeBridgeOptions {
  harness?: {
    runtimeCwd?: string
  }
  service?: {
    workdir?: string
    workspace?: Workspace
    eventStore?: EventStreamStore
    pendingInputs?: PendingInputStore
  }
}

export interface AgentRuntimeBridge {
  agent: Agent
  getRuntime(): Promise<AgentRuntimeAdapterView>
  currentRuntime(): Promise<AgentRuntimeAdapterView> | undefined
}

interface AgentSessionLiveState {
  bridge?: AgentPiChatEventStreamSubscription
  bridgePromise?: Promise<AgentSessionLiveState>
  events: AgentEvent[]
  subscribers: Set<StreamSubscriber>
  latestIndex: number
  evictedThroughIndex: number
  closed: boolean
}

interface StreamSubscriber {
  push(event: AgentEvent): void
  close(): void
}

interface AgentPiChatEventStreamSubscription {
  type: 'ok'
  unsubscribe(): void
  closed?: Promise<void>
}

export function createAgent(config: AgentConfig): Agent {
  return createAgentRuntimeBridge(config).agent
}

export function createAgentRuntimeBridge(
  config: AgentConfig,
  options: CreateAgentRuntimeBridgeOptions = {},
): AgentRuntimeBridge {
  if (config.sessions && !config.harnessFactory) {
    throw new Error('createAgent sessions override requires a harnessFactory that uses the same SessionStore')
  }

  const pendingInputs = options.service?.pendingInputs ?? new MemoryPendingInputStore()
  const approvalCoordinator = new ApprovalCoordinator(pendingInputs)
  const runtimeLoader = createRuntimeLoader(config, options, approvalCoordinator)
  const getRuntime = runtimeLoader.get
  const eventStore = options.service?.eventStore
  const live = new AgentLiveEventBuffer(DEFAULT_LIVE_BUFFER_SIZE)
  const sessionContexts = new Map<string, SessionCtx | undefined>()
  const startedSessions = new Map<string, { sessionId: string; ctx: SessionCtx | undefined }>()
  const sendLocks = new Map<string, Promise<void>>()

  const sessions = createFacadeSessionStore(config.sessions, getRuntime, live, sessionContexts, startedSessions, pendingInputs, approvalCoordinator)
  const readiness = createReadiness(config)

  async function ensureSession(input: AgentSendInput, runtime: AgentRuntime): Promise<{ sessionId: string; sessionKey: string; ctx: SessionCtx | undefined }> {
    if (input.sessionId) {
      const ctx = await authorizeSessionAccess(runtime, input.sessionId, input.ctx, sessionContexts)
      return { sessionId: input.sessionId, sessionKey: sessionCacheKey(input.sessionId, ctx), ctx }
    }
    const service = runtime.service
    const created = await service.createSession?.(toPiRequestContext(input.ctx), {
      title: contentToText(input.content ?? input.message).slice(0, 80) || undefined,
    })
    if (!created) throw new Error('agent session creation is unavailable')
    rememberSessionCtx(sessionContexts, created.id, input.ctx)
    return { sessionId: created.id, sessionKey: sessionCacheKey(created.id, input.ctx), ctx: input.ctx }
  }

  async function ensureBridge(sessionKey: string, sessionId: string, ctx: SessionCtx | undefined, service: HarnessPiChatService): Promise<AgentSessionLiveState> {
    const state = live.ensure(sessionKey)
    if (state.bridge || state.closed) return state
    state.bridgePromise ??= (async () => {
      const subscribeFrom = state.latestIndex === 0 ? 0 : Number.MAX_SAFE_INTEGER
      let result = await service.subscribe(toPiRequestContext(ctx), sessionId, subscribeFrom, (chunk) => {
        live.publish(sessionKey, sessionId, chunk)
      })
      if (result.type !== 'ok') {
        result = await service.subscribe(toPiRequestContext(ctx), sessionId, result.latestSeq, (chunk) => {
          live.publish(sessionKey, sessionId, chunk)
        })
      }
      if (result.type !== 'ok') throw new AgentNotImplementedError('Historical pi-chat replay is not implemented until T1.')
      state.bridge = result
      result.closed?.finally(() => live.close(sessionKey)).catch(() => live.close(sessionKey))
      return state
    })()
    try {
      return await state.bridgePromise
    } finally {
      state.bridgePromise = undefined
    }
  }

  async function start(input: AgentSendInput): Promise<AgentStartReceipt> {
    const runtime = await getRuntime()
    const { sessionId, sessionKey, ctx } = await ensureSession(input, runtime)
    if (eventStore) await eventStore.createStream(sessionStreamPath(sessionId), { reopenClosed: true })
    startedSessions.set(sessionKey, { sessionId, ctx })
    await ensureBridge(sessionKey, sessionId, ctx, runtime.service)
    const startIndex = eventStore
      ? await durableNextEventIndex(eventStore, sessionId)
      : live.latestIndex(sessionKey)
    await runtime.service.prompt(toPiRequestContext(ctx), sessionId, toPromptPayload(input))
    return { sessionId, startIndex }
  }

  const agent: Agent = {
    sessions,
    readiness,

    start,

    stream(sessionId: string, options: AgentStreamOptions): AsyncIterable<AgentEvent> {
      return authorizedStream(sessionId, options)
    },

    async *send(input: AgentSendInput): AsyncIterable<AgentEvent> {
      const release = input.sessionId ? await acquireSessionLock(sendLocks, sessionCacheKey(input.sessionId, input.ctx)) : undefined
      try {
        const receipt = await start(input)
        let turnId: string | undefined
        for await (const event of authorizedStream(receipt.sessionId, { startIndex: receipt.startIndex, ctx: input.ctx })) {
          yield event
          if (event.chunk.type === 'agent-start') turnId = event.chunk.turnId
          if (isSendTerminalEvent(event, turnId)) break
        }
      } finally {
        release?.()
      }
    },

    async resolveInput(sessionId: string, requestId: string, response: AgentResolveInputResponse, ctx?: SessionCtx): Promise<void> {
      const runtime = await getRuntime()
      const pending = await pendingInputs.get(sessionId, requestId)
      if (!pending) throw inputRequestNotFoundError(sessionId, requestId)
      if (!sameSessionCtx(ctx, pending.ctx)) {
        throw stableAgentError(ErrorCode.enum.UNAUTHORIZED, 'input request context mismatch')
      }
      const accessCtx = await authorizeSessionAccess(runtime, sessionId, ctx, sessionContexts)
      await approvalCoordinator.resolve(toPiRequestContext(accessCtx), sessionId, requestId, response)
    },

    async interrupt(sessionId: string, ctx?: SessionCtx): Promise<unknown> {
      const runtime = await getRuntime()
      const accessCtx = await authorizeSessionAccess(runtime, sessionId, ctx, sessionContexts)
      approvalCoordinator.abortRecoveredSession(sessionId, accessCtx)
      return runtime.service.interrupt(toPiRequestContext(accessCtx), sessionId, {})
    },

    async stop(sessionId: string, ctx?: SessionCtx, opts?: { closeStream?: boolean }): Promise<unknown> {
      const runtime = await getRuntime()
      const accessCtx = await authorizeSessionAccess(runtime, sessionId, ctx, sessionContexts)
      approvalCoordinator.abortRecoveredSession(sessionId, accessCtx)
      const receipt = await runtime.service.stop(toPiRequestContext(accessCtx), sessionId, {})
      if (eventStore && opts?.closeStream !== false) await eventStore.closeStream(sessionStreamPath(sessionId))
      const sessionKey = sessionCacheKey(sessionId, accessCtx)
      live.close(sessionKey)
      startedSessions.delete(sessionKey)
      return receipt
    },

    async dispose(): Promise<void> {
      const runtime = await runtimeLoader.current()
      let stopError: unknown
      try {
        if (runtime) {
          const results = await Promise.allSettled([...startedSessions.values()].map((started) =>
            {
              approvalCoordinator.abortRecoveredSession(started.sessionId, started.ctx)
              return stopAndCloseStartedSession(runtime, eventStore, started)
            },
          ))
          stopError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason
        }
      } catch (error) {
        stopError = error
      } finally {
        approvalCoordinator.abortAllRecovered()
        live.dispose()
        startedSessions.clear()
        sessionContexts.clear()
        if (config.runtime !== 'none') await config.runtime.dispose?.()
      }
      if (stopError) throw stopError
    },
  }

  return {
    agent,
    getRuntime,
    currentRuntime: runtimeLoader.current,
  }

  async function* authorizedStream(sessionId: string, options: AgentStreamOptions): AsyncIterable<AgentEvent> {
    const runtime = await getRuntime()
    let accessCtx: SessionCtx | undefined
    try {
      accessCtx = await authorizeSessionAccess(runtime, sessionId, options.ctx, sessionContexts)
    } catch (error) {
      if (eventStore && (error as { code?: unknown })?.code === ErrorCode.enum.SESSION_NOT_FOUND) return
      throw error
    }
    if (eventStore) {
      await eventStore.createStream(sessionStreamPath(sessionId))
      yield* durableAgentEventStream(eventStore, sessionId, options.startIndex)
      return
    }
    yield* live.stream(sessionCacheKey(sessionId, accessCtx), options.startIndex)
  }
}

async function stopAndCloseStartedSession(
  runtime: AgentRuntime,
  eventStore: EventStreamStore | undefined,
  started: { sessionId: string; ctx: SessionCtx | undefined },
): Promise<void> {
  let stopError: unknown
  try {
    await runtime.service.stop(toPiRequestContext(started.ctx), started.sessionId, {})
  } catch (error) {
    stopError = error
  }
  try {
    await eventStore?.closeStream(sessionStreamPath(started.sessionId))
  } catch (error) {
    stopError ??= error
  }
  if (stopError !== undefined) throw stopError
}

async function durableNextEventIndex(eventStore: EventStreamStore, sessionId: string): Promise<number> {
  const meta = await eventStore.getStreamMeta(sessionStreamPath(sessionId))
  if (!meta) return 0
  return parseOffset(meta.nextOffset) + 1
}

function durableAgentEventStream(
  eventStore: EventStreamStore,
  sessionId: string,
  startIndex: number,
): AsyncIterable<AgentEvent> {
  return {
    [Symbol.asyncIterator]: () => createDurableAgentEventIterator(eventStore, sessionId, startIndex),
  }
}

function createDurableAgentEventIterator(
  eventStore: EventStreamStore,
  sessionId: string,
  startIndex: number,
): AsyncIterator<AgentEvent> {
  const path = sessionStreamPath(sessionId)
  const queued: AgentEvent[] = []
  let active = true
  let initialized = false
  let currentOffset: string | undefined
  let wake: (() => void) | undefined

  return {
    async next() {
      if (!active) return { value: undefined, done: true }
      if (!Number.isInteger(startIndex) || startIndex < 0) {
        throw cursorOutOfRangeError('startIndex must be a non-negative integer', { startIndex })
      }
      currentOffset ??= formatOffset(startIndex - 1)
      if (!initialized) {
        initialized = true
        const meta = await eventStore.getStreamMeta(path)
        if (!meta) {
          active = false
          return { value: undefined, done: true }
        }
        const latestIndex = parseOffset(meta.nextOffset) + 1
        if (startIndex > latestIndex) {
          throw cursorOutOfRangeError(`startIndex ${startIndex} is ahead of next eventIndex ${latestIndex}`, {
            startIndex,
            latestIndex,
          })
        }
      }

      while (active) {
        if (queued.length > 0) return { value: queued.shift() as AgentEvent, done: false }

        const result = await eventStore.readEvents(path, { offset: currentOffset })
        currentOffset = result.nextOffset
        queued.push(...result.events.map((event) => toAgentEvent(event.data)))
        if (queued.length > 0) return { value: queued.shift() as AgentEvent, done: false }
        if (result.closed && result.upToDate) {
          active = false
          return { value: undefined, done: true }
        }
        if (!result.upToDate) continue

        await waitForDurableEvent(eventStore, path, () => active, () => currentOffset ?? '-1', (resolve) => {
          wake = resolve
        })
      }

      return { value: undefined, done: true }
    },
    async return() {
      active = false
      wake?.()
      wake = undefined
      return { value: undefined, done: true }
    },
  }
}

function waitForDurableEvent(
  eventStore: EventStreamStore,
  path: string,
  isActive: () => boolean,
  getOffset: () => string,
  setWake: (wake: () => void) => void,
): Promise<void> {
  return new Promise((resolve) => {
    if (!isActive()) {
      resolve()
      return
    }

    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      unsubscribe()
      resolve()
    }
    const unsubscribe = eventStore.subscribe(path, settle)
    setWake(settle)
    void eventStore.readEvents(path, { offset: getOffset(), limit: 1 }).then((result) => {
      if (result.events.length > 0 || (result.closed && result.upToDate)) settle()
    }).catch(() => {})
  })
}

function toAgentEvent(value: unknown): AgentEvent {
  const event = value as Partial<AgentEvent> | undefined
  if (
    event?.v === 1 &&
    typeof event.eventIndex === 'number' &&
    typeof event.timestamp === 'number' &&
    typeof event.sessionId === 'string' &&
    typeof event.chunk === 'object' &&
    event.chunk !== null
  ) {
    return event as AgentEvent
  }
  throw stableAgentError(ErrorCode.enum.INTERNAL_ERROR, 'stored event is not an AgentEvent envelope')
}

function createRuntimeLoader(config: AgentConfig, options: CreateAgentRuntimeBridgeOptions, approvalCoordinator: ApprovalCoordinator): {
  get(): Promise<AgentRuntime>
  current(): Promise<AgentRuntime> | undefined
} {
  let runtimePromise: Promise<AgentRuntime> | undefined
  return {
    get() {
      runtimePromise ??= createRuntime(config, options, approvalCoordinator)
      return runtimePromise
    },
    current() {
      return runtimePromise
    },
  }
}

async function createRuntime(config: AgentConfig, options: CreateAgentRuntimeBridgeOptions, approvalCoordinator: ApprovalCoordinator): Promise<AgentRuntime> {
  const harnessFactory = config.harnessFactory ?? (await import('./harness/pi-coding-agent/createHarness')).createPiCodingAgentHarness
  const tools = wrapToolsForApproval(config.tools ?? [], approvalCoordinator)
  const harnessInput: AgentHarnessFactoryInput = {
    tools,
    cwd: config.workdir ?? DEFAULT_WORKDIR,
    runtimeCwd: options.harness?.runtimeCwd ?? options.service?.workdir ?? config.workdir,
    systemPromptAppend: config.systemPromptAppend,
    systemPromptDynamic: config.systemPromptDynamic,
    sessionRoot: config.sessionStorageRoot,
    telemetry: config.telemetry,
  }
  const harness = await harnessFactory(harnessInput)
  const sessionStore = config.sessions ?? harness.sessions
  const service = new HarnessPiChatService({
    harness,
    sessionStore,
    workdir: options.service?.workdir ?? config.workdir ?? DEFAULT_WORKDIR,
    workspace: options.service?.workspace,
    eventStore: options.service?.eventStore,
    pendingInputs: approvalCoordinator.pendingInputs,
    metering: config.metering as AgentMeteringSink | undefined,
  })
  approvalCoordinator.attachService(service)
  return {
    harness,
    sessionStore,
    service,
  }
}

function createReadiness(config: AgentConfig): AgentReadiness {
  const requirements = [...(config.readinessRequirements ?? [])]
  return {
    requirements,
    async status() {
      return requirements.map((key) => ({
        key,
        ready: false,
        message: 'readiness status is not available in the core facade',
      }))
    },
  }
}

function createFacadeSessionStore(
  baseStore: SessionStore | undefined,
  getRuntime: () => Promise<AgentRuntime>,
  live: AgentLiveEventBuffer,
  sessionContexts: Map<string, SessionCtx | undefined>,
  startedSessions: Map<string, { sessionId: string; ctx: SessionCtx | undefined }>,
  pendingInputs: PendingInputStore,
  approvalCoordinator: ApprovalCoordinator,
): AgentSessions {
  const store = async () => baseStore ?? (await getRuntime()).harness.sessions
  return {
    async list(ctx: SessionCtx, options?: SessionListOptions) {
      const summaries = await (await store()).list(ctx, options)
      return summaries.filter((summary) => canAccessStoredSessionCtx(summary.id, ctx, sessionContexts))
    },
    async create(ctx: SessionCtx, init?: { title?: string }) {
      const created = await (await store()).create(ctx, init)
      rememberSessionCtx(sessionContexts, created.id, ctx)
      return created
    },
    async load(ctx: SessionCtx, sessionId: string) {
      const runtime = await getRuntime()
      const accessCtx = await authorizeSessionAccess(runtime, sessionId, ctx, sessionContexts)
      return (await store()).load(accessCtx ?? {}, sessionId)
    },
    async delete(ctx: SessionCtx, sessionId: string) {
      const runtime = await getRuntime()
      const accessCtx = await authorizeSessionAccess(runtime, sessionId, ctx, sessionContexts)
      approvalCoordinator.abortRecoveredSession(sessionId, accessCtx)
      await runtime.service.deleteSession(toPiRequestContext(accessCtx), sessionId)
      const sessionKey = sessionCacheKey(sessionId, accessCtx)
      live.close(sessionKey)
      sessionContexts.delete(sessionKey)
      startedSessions.delete(sessionKey)
    },
    async pendingInputs(ctx: SessionCtx, opts?: { sessionId?: string }) {
      return pendingInputs.list(ctx, opts)
    },
  }
}

function toPiRequestContext(ctx?: SessionCtx): PiSessionRequestContext {
  return {
    workspaceId: ctx?.workspaceId,
    authSubject: ctx?.userId,
    requestId: 'agent-core',
  }
}

function toPromptPayload(input: AgentSendInput): PromptPayload {
  return {
    message: contentToText(input.content ?? input.message),
    clientNonce: `agent:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    ...(input.model ? { model: input.model } : {}),
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    ...(input.attachments ? { attachments: input.attachments } : {}),
  }
}

function contentToText(content: AgentSendInput['content'] | AgentSendInput['message']): string {
  if (content === undefined) return ''
  if (typeof content === 'string') return content
  return content
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
    .join('\n')
}

async function loadSession(store: SessionStore, ctx: SessionCtx, sessionId: string): Promise<void> {
  try {
    await store.load(ctx, sessionId)
  } catch (error) {
    throw normalizeSessionLoadError(error, sessionId)
  }
}

async function assertLoadedSessionVisible(store: SessionStore, ctx: SessionCtx, sessionId: string): Promise<void> {
  const summaries = await store.list(ctx, { includeId: sessionId })
  if (!summaries.some((summary) => summary.id === sessionId)) {
    throw stableAgentError(ErrorCode.enum.UNAUTHORIZED, 'session context mismatch')
  }
}

function normalizeSessionLoadError(error: unknown, sessionId: string): unknown {
  if ((error as { code?: unknown })?.code === ErrorCode.enum.SESSION_NOT_FOUND || isPlainSessionNotFound(error, sessionId)) {
    return stableAgentError(ErrorCode.enum.SESSION_NOT_FOUND, 'session not found')
  }
  return error
}

async function authorizeSessionAccess(
  runtime: AgentRuntime,
  sessionId: string,
  callerCtx: SessionCtx | undefined,
  sessionContexts: Map<string, SessionCtx | undefined>,
): Promise<SessionCtx | undefined> {
  const requestedKey = sessionCacheKey(sessionId, callerCtx)
  const hasStoredCtx = sessionContexts.has(requestedKey)
  const storedCtx = sessionContexts.get(requestedKey)
  if (hasStoredCtx && callerCtx && !sameSessionCtx(callerCtx, storedCtx)) {
    throw stableAgentError(ErrorCode.enum.UNAUTHORIZED, 'session context mismatch')
  }
  if (hasStoredCtx && !callerCtx && !isEmptySessionCtx(storedCtx)) {
    throw stableAgentError(ErrorCode.enum.UNAUTHORIZED, 'session context required')
  }
  const accessCtx = callerCtx ?? storedCtx ?? {}
  await loadSession(runtime.sessionStore, accessCtx, sessionId)
  if (!hasStoredCtx) {
    await assertLoadedSessionVisible(runtime.sessionStore, accessCtx, sessionId)
    rememberSessionCtx(sessionContexts, sessionId, accessCtx)
  }
  return accessCtx
}

function rememberSessionCtx(sessionContexts: Map<string, SessionCtx | undefined>, sessionId: string, ctx: SessionCtx | undefined): void {
  sessionContexts.set(sessionCacheKey(sessionId, ctx), isEmptySessionCtx(ctx) ? undefined : { workspaceId: ctx?.workspaceId, userId: ctx?.userId })
}

function sameSessionCtx(a: SessionCtx | undefined, b: SessionCtx | undefined): boolean {
  return (a?.workspaceId ?? '') === (b?.workspaceId ?? '') && (a?.userId ?? '') === (b?.userId ?? '')
}

function isEmptySessionCtx(ctx: SessionCtx | undefined): boolean {
  return !ctx?.workspaceId && !ctx?.userId
}

function canAccessStoredSessionCtx(
  sessionId: string,
  callerCtx: SessionCtx,
  sessionContexts: Map<string, SessionCtx | undefined>,
): boolean {
  const sessionKey = sessionCacheKey(sessionId, callerCtx)
  if (!sessionContexts.has(sessionKey)) return true
  const storedCtx = sessionContexts.get(sessionKey)
  return sameSessionCtx(callerCtx, storedCtx)
}

function sessionCacheKey(sessionId: string, ctx: SessionCtx | undefined): string {
  return JSON.stringify([sessionId, ctx?.workspaceId ?? '', ctx?.userId ?? ''])
}

function stableAgentError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

function inputRequestNotFoundError(sessionId: string, requestId: string): Error & { code: string } {
  return Object.assign(new Error('input request not found'), {
    code: ErrorCode.enum.SESSION_NOT_FOUND,
    details: { sessionId, requestId },
  })
}

function inputResponseKindMismatchError(expected: string, received: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('input response kind mismatch'), {
    code: ErrorCode.enum.BRIDGE_COMMAND_INVALID,
    statusCode: 400,
    details: { expected, received },
  })
}

function wrapToolsForApproval(tools: AgentTool[], approvalCoordinator: ApprovalCoordinator): AgentTool[] {
  approvalCoordinator.registerTools(tools)
  return tools.map((tool) => ({
    ...tool,
    execute(params, ctx) {
      return approvalCoordinator.executeTool(tool, params, ctx)
    },
  }))
}

const RECOVERED_TOOL_ABORTED = Symbol('recovered-tool-aborted')
type RecoveredToolResult = ToolResult | undefined | typeof RECOVERED_TOOL_ABORTED

class ApprovalCoordinator {
  private service?: HarnessPiChatService
  private readonly waiters = new Map<string, Deferred<ResolveInputResponse>>()
  private readonly toolsByName = new Map<string, AgentTool>()
  private readonly recoveredToolAbortControllers = new Map<string, Set<AbortController>>()

  constructor(readonly pendingInputs: PendingInputStore) {}

  attachService(service: HarnessPiChatService): void {
    this.service = service
  }

  registerTools(tools: AgentTool[]): void {
    for (const tool of tools) this.toolsByName.set(tool.name, tool)
  }

  abortRecoveredSession(sessionId: string, ctx: SessionCtx | undefined): void {
    const key = sessionCacheKey(sessionId, ctx)
    const controllers = this.recoveredToolAbortControllers.get(key)
    if (!controllers) return
    this.recoveredToolAbortControllers.delete(key)
    for (const controller of controllers) controller.abort()
  }

  abortAllRecovered(): void {
    const controllerSets = [...this.recoveredToolAbortControllers.values()]
    this.recoveredToolAbortControllers.clear()
    for (const controllers of controllerSets) {
      for (const controller of controllers) controller.abort()
    }
  }

  async executeTool(tool: AgentTool, params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
    if (!(await toolNeedsApproval(tool, params, ctx))) return tool.execute(params, ctx)
    if (!ctx.sessionId) throw stableToolError(ErrorCode.enum.TOOL_EXECUTION_ERROR, 'tool approval requires a session id')
    if (ctx.abortSignal.aborted) throw approvalAbortedError()

    const request = await this.pendingInputs.create({
      sessionId: ctx.sessionId,
      requestId: createInputRequestId(ctx.sessionId, ctx.toolCallId),
      ctx: { workspaceId: ctx.workspaceId, userId: ctx.userId },
      auth: { userEmail: ctx.userEmail, userEmailVerified: ctx.userEmailVerified },
      kind: 'approval',
      toolName: tool.name,
      toolCallId: ctx.toolCallId,
      payload: { params },
    })
    const waiter = deferred<ResolveInputResponse>()
    const waiterKey = inputWaiterKey(ctx.sessionId, request.requestId)
    this.waiters.set(waiterKey, waiter)

    let aborted = false
    const abort = () => {
      if (aborted) return
      aborted = true
      waiter.reject(approvalAbortedError())
      void this.clearAbortedRequest(request).catch(() => undefined)
    }
    ctx.abortSignal.addEventListener('abort', abort, { once: true })
    if (ctx.abortSignal.aborted) abort()

    try {
      try {
        if (!aborted) {
          await this.service?.publishApprovalRequest(toPiRequestContext(request.ctx), request.sessionId, toPendingInputRequest(request))
        }
      } catch (error) {
        await this.pendingInputs.resolve(request.sessionId, request.requestId)
        throw error
      }
      const response = await waiter.promise
      if (response.kind !== 'approval') {
        throw stableToolError(ErrorCode.enum.TOOL_INVALID_INPUT, 'approval response expected')
      }
      if (response.decision === 'deny') return deniedApprovalResult(response)
      return tool.execute(params, ctx)
    } finally {
      ctx.abortSignal.removeEventListener('abort', abort)
      this.waiters.delete(waiterKey)
    }
  }

  async resolve(ctx: PiSessionRequestContext, sessionId: string, requestId: string, response: ResolveInputResponse): Promise<void> {
    const record = await this.pendingInputs.resolve(sessionId, requestId)
    if (!record) throw inputRequestNotFoundError(sessionId, requestId)
    if (record.kind !== response.kind) {
      await this.pendingInputs.create(record)
      throw inputResponseKindMismatchError(record.kind, response.kind)
    }
    const request = toPendingInputRequest(record)
    const recordCtx = withPendingInputAuth(ctx, record)
    try {
      await this.service?.publishApprovalResolved(recordCtx, sessionId, request, response)
    } catch (error) {
      await this.pendingInputs.create(record)
      throw error
    }

    const waiter = this.waiters.get(inputWaiterKey(sessionId, requestId))
    if (waiter) {
      waiter.resolve(response)
      return
    }

    void this.continueRecoveredResolvedInput(ctx, sessionId, request, record, response)
      .catch((error) => this.handleRecoveredContinuationFailure(ctx, sessionId, record, error))
  }

  private async continueRecoveredResolvedInput(
    ctx: PiSessionRequestContext,
    sessionId: string,
    request: PendingInputRequest,
    record: PendingInputRecord,
    response: ResolveInputResponse,
  ): Promise<void> {
    if (!this.service?.canContinueResolvedInput()) {
      throw new RecoveredApprovalContinuationError(new Error('resolved input recovery is unavailable'), false)
    }
    const abortController = new AbortController()
    const releaseAbortController = this.trackRecoveredToolAbort(record, abortController)
    let toolResultProduced = false
    try {
      const recoveredResult = await this.recoverToolResult(record, response, abortController.signal)
      toolResultProduced = recoveredResult !== undefined
      if (recoveredResult === RECOVERED_TOOL_ABORTED || abortController.signal.aborted) {
        throw new RecoveredApprovalContinuationError(new Error('recovered tool execution aborted'), true)
      }
      await this.service.continueResolvedInput(
        withPendingInputAuth(ctx, record),
        sessionId,
        request,
        response,
        recoveredResult,
        abortController.signal,
      )
    } catch (error) {
      if (error instanceof RecoveredApprovalContinuationError) throw error
      throw new RecoveredApprovalContinuationError(error, toolResultProduced)
    } finally {
      releaseAbortController()
    }
  }

  private async handleRecoveredContinuationFailure(
    ctx: PiSessionRequestContext,
    sessionId: string,
    record: PendingInputRecord,
    error: unknown,
  ): Promise<void> {
    if (!(error instanceof RecoveredApprovalContinuationError) || !error.toolResultProduced) {
      await this.pendingInputs.create(record)
      await this.service?.publishApprovalRequest(
        withPendingInputAuth(ctx, record),
        sessionId,
        toPendingInputRequest(record),
      ).catch(() => undefined)
    }
    await this.service?.publishResolvedInputRecoveryError(
      withPendingInputAuth(ctx, record),
      sessionId,
      error,
    ).catch(() => undefined)
  }

  private async clearAbortedRequest(request: PendingInputRecord): Promise<void> {
    const record = await this.pendingInputs.resolve(request.sessionId, request.requestId)
    if (!record) return
    await this.service?.publishApprovalResolved(
      toPiRequestContext(record.ctx),
      record.sessionId,
      toPendingInputRequest(record),
      { kind: 'approval', decision: 'deny', reason: 'aborted' },
    )
  }

  private async recoverToolResult(
    record: PendingInputRecord,
    response: ResolveInputResponse,
    abortSignal: AbortSignal,
  ): Promise<RecoveredToolResult> {
    if (record.kind !== 'approval') return undefined
    if (response.kind !== 'approval') return failClosedToolResult('approval response expected')
    if (response.decision === 'deny') return deniedApprovalResult(response)
    if (abortSignal.aborted) return RECOVERED_TOOL_ABORTED

    const params = paramsFromPendingPayload(record.payload)
    const tool = record.toolName ? this.toolsByName.get(record.toolName) : undefined
    if (!tool || !params || !record.toolCallId) {
      return failClosedToolResult('approved tool request could not be recovered')
    }

    try {
      return await tool.execute(params, {
        abortSignal,
        toolCallId: record.toolCallId,
        sessionId: record.sessionId,
        workspaceId: record.ctx?.workspaceId,
        userId: record.ctx?.userId,
        userEmail: record.auth?.userEmail,
        userEmailVerified: record.auth?.userEmailVerified,
        requestId: 'agent-core:resolve-input',
      })
    } catch (error) {
      if (abortSignal.aborted) return RECOVERED_TOOL_ABORTED
      return failClosedToolResult(error instanceof Error && error.message ? error.message : 'recovered tool execution failed')
    }
  }

  private trackRecoveredToolAbort(record: PendingInputRecord, controller: AbortController): () => void {
    const key = sessionCacheKey(record.sessionId, record.ctx)
    const controllers = this.recoveredToolAbortControllers.get(key) ?? new Set<AbortController>()
    controllers.add(controller)
    this.recoveredToolAbortControllers.set(key, controllers)
    return () => {
      controllers.delete(controller)
      if (controllers.size === 0) this.recoveredToolAbortControllers.delete(key)
    }
  }
}

class RecoveredApprovalContinuationError extends Error {
  constructor(readonly cause: unknown, readonly toolResultProduced: boolean) {
    super(cause instanceof Error && cause.message ? cause.message : 'resolved input recovery failed')
    this.name = 'RecoveredApprovalContinuationError'
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

async function toolNeedsApproval(tool: AgentTool, params: Record<string, unknown>, ctx: ToolExecContext): Promise<boolean> {
  if (typeof tool.needsApproval === 'function') return await tool.needsApproval(params, ctx)
  return tool.needsApproval === true
}

function createInputRequestId(sessionId: string, toolCallId: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random().toString(36).slice(2)}`
  return `approval:${sessionId}:${toolCallId}:${suffix}`
}

function inputWaiterKey(sessionId: string, requestId: string): string {
  return JSON.stringify([sessionId, requestId])
}

function toPendingInputRequest(record: PendingInputRecord): PendingInputRequest {
  return {
    sessionId: record.sessionId,
    requestId: record.requestId,
    kind: record.kind,
    ...(record.toolName ? { toolName: record.toolName } : {}),
    ...(record.toolCallId ? { toolCallId: record.toolCallId } : {}),
    ...(record.schema ? { schema: record.schema } : {}),
    createdAt: record.createdAt,
  }
}

function withPendingInputAuth(ctx: PiSessionRequestContext, record: PendingInputRecord): PiSessionRequestContext {
  return {
    ...ctx,
    ...(record.auth?.userEmail ? { authEmail: record.auth.userEmail } : {}),
    ...(record.auth?.userEmailVerified === undefined ? {} : { authEmailVerified: record.auth.userEmailVerified }),
  }
}

function stableToolError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

function approvalAbortedError(): Error & { code: string } {
  return stableToolError(ErrorCode.enum.ABORTED, 'tool approval was aborted')
}

function deniedApprovalResult(response: Extract<ResolveInputResponse, { kind: 'approval' }>): ToolResult {
  return {
    content: [{ type: 'text', text: response.reason ? `Denied by user: ${response.reason}` : 'Denied by user.' }],
    isError: true,
    details: {
      code: ErrorCode.enum.ABORTED,
      reason: response.reason,
      boringApprovalDenied: true,
    },
  }
}

function failClosedToolResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    details: { code: ErrorCode.enum.TOOL_EXECUTION_ERROR },
  }
}

function paramsFromPendingPayload(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const params = (payload as { params?: unknown }).params
  return params && typeof params === 'object' && !Array.isArray(params)
    ? params as Record<string, unknown>
    : undefined
}

async function acquireSessionLock(locks: Map<string, Promise<void>>, sessionId: string): Promise<() => void> {
  const previous = locks.get(sessionId) ?? Promise.resolve()
  let release!: () => void
  const current = previous.catch(() => {}).then(() => new Promise<void>((resolve) => {
    release = resolve
  }))
  locks.set(sessionId, current)
  await previous.catch(() => {})
  return () => {
    release()
    if (locks.get(sessionId) === current) locks.delete(sessionId)
  }
}

function isPlainSessionNotFound(error: unknown, sessionId: string): boolean {
  return error instanceof Error && (
    error.message === 'session not found' ||
    error.message === `Session not found: ${sessionId}` ||
    error.message === `missing session ${sessionId}`
  )
}

function isSendTerminalEvent(event: AgentEvent, turnId: string | undefined): boolean {
  const chunk = event.chunk
  if (chunk.type === 'error') return !chunk.turnId || chunk.turnId === turnId
  return chunk.type === 'agent-end' && chunk.willRetry !== true && chunk.turnId === turnId
}

class AgentLiveEventBuffer {
  private readonly sessions = new Map<string, AgentSessionLiveState>()
  private readonly eventIndexes = new Map<string, number>()

  constructor(private readonly maxEvents: number) {}

  latestIndex(sessionKey: string): number {
    return this.eventIndexes.get(sessionKey) ?? 0
  }

  ensure(sessionKey: string): AgentSessionLiveState {
    let state = this.sessions.get(sessionKey)
    if (!state || state.closed) {
      const latestIndex = this.latestIndex(sessionKey)
      state = {
        events: [],
        subscribers: new Set(),
        latestIndex,
        evictedThroughIndex: latestIndex - 1,
        closed: false,
      }
      this.sessions.set(sessionKey, state)
    }
    return state
  }

  publish(sessionKey: string, sessionId: string, chunk: AgentEvent['chunk']): void {
    const state = this.ensure(sessionKey)
    if (state.closed) return
    const eventIndex = this.latestIndex(sessionKey)
    this.eventIndexes.set(sessionKey, eventIndex + 1)
    const event: AgentEvent = {
      v: 1,
      eventIndex,
      timestamp: Date.now(),
      sessionId,
      chunk,
    }
    state.latestIndex = event.eventIndex + 1
    state.events.push(event)
    if (state.events.length > this.maxEvents) {
      const evicted = state.events.splice(0, state.events.length - this.maxEvents)
      state.evictedThroughIndex = evicted[evicted.length - 1]?.eventIndex ?? state.evictedThroughIndex
    }
    for (const subscriber of state.subscribers) subscriber.push(event)
  }

  stream(sessionKey: string, startIndex: number): AsyncIterable<AgentEvent> {
    const state = this.ensure(sessionKey)
    this.assertReplayable(state, startIndex)
    return {
      [Symbol.asyncIterator]: () => {
        this.assertReplayable(state, startIndex)
        return createLiveIterator(state, startIndex)
      },
    }
  }

  close(sessionKey: string): void {
    const state = this.sessions.get(sessionKey)
    if (!state) return
    state.closed = true
    state.bridge?.unsubscribe()
    for (const subscriber of state.subscribers) subscriber.close()
    state.subscribers.clear()
  }

  dispose(): void {
    for (const [sessionId] of this.sessions) this.close(sessionId)
    this.sessions.clear()
  }

  private assertReplayable(state: AgentSessionLiveState, startIndex: number): void {
    if (!Number.isInteger(startIndex) || startIndex < 0) {
      throw cursorOutOfRangeError('startIndex must be a non-negative integer', {
        startIndex,
        latestIndex: state.latestIndex,
      })
    }
    if (startIndex <= state.evictedThroughIndex) {
      throw new AgentNotImplementedError('Historical stream replay is not implemented until T1.')
    }
    if (startIndex > state.latestIndex) {
      throw cursorOutOfRangeError(`startIndex ${startIndex} is ahead of next eventIndex ${state.latestIndex}`, {
        startIndex,
        latestIndex: state.latestIndex,
      })
    }
  }

}

function cursorOutOfRangeError(message: string, details: Record<string, unknown>): RangeError & { code: string; details: Record<string, unknown> } {
  return Object.assign(new RangeError(message), {
    code: ErrorCode.enum.CURSOR_OUT_OF_RANGE,
    details,
  })
}

function createLiveIterator(state: AgentSessionLiveState, startIndex: number): AsyncIterator<AgentEvent> {
  const queued: AgentEvent[] = []
  const waiters: Array<(result: IteratorResult<AgentEvent>) => void> = []
  let active = true

  const subscriber: StreamSubscriber = {
    push(event) {
      if (!active) return
      const waiter = waiters.shift()
      if (waiter) waiter({ value: event, done: false })
      else queued.push(event)
    },
    close() {
      if (!active) return
      active = false
      while (waiters.length > 0) waiters.shift()?.({ value: undefined, done: true })
    },
  }

  state.subscribers.add(subscriber)
  queued.push(...state.events.filter((event) => event.eventIndex >= startIndex))

  return {
    async next() {
      if (queued.length > 0) return { value: queued.shift() as AgentEvent, done: false }
      if (!active || state.closed) return { value: undefined, done: true }
      return new Promise<IteratorResult<AgentEvent>>((resolve) => waiters.push(resolve))
    },
    async return() {
      active = false
      state.subscribers.delete(subscriber)
      while (waiters.length > 0) waiters.shift()?.({ value: undefined, done: true })
      return { value: undefined, done: true }
    },
  }
}
