import { HarnessPiChatService } from './pi-chat/harnessPiChatService'
import type { EventStreamStore } from './events/eventStreamStore'
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
  AgentSendInput,
  AgentStartReceipt,
  AgentStreamOptions,
} from '../shared/events'
import { AgentNotImplementedError } from '../shared/events'
import type { SessionCtx, SessionListOptions, SessionStore } from '../shared/session'
import type { PromptPayload } from '../shared/chat'
import { ErrorCode } from '../shared/error-codes'

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

  const runtimeLoader = createRuntimeLoader(config, options)
  const getRuntime = runtimeLoader.get
  const live = new AgentLiveEventBuffer(DEFAULT_LIVE_BUFFER_SIZE)
  const sessionContexts = new Map<string, SessionCtx | undefined>()
  const startedSessions = new Map<string, { sessionId: string; ctx: SessionCtx | undefined }>()
  const sendLocks = new Map<string, Promise<void>>()

  const sessions = createFacadeSessionStore(config.sessions, getRuntime, live, sessionContexts, startedSessions)
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
    startedSessions.set(sessionKey, { sessionId, ctx })
    await ensureBridge(sessionKey, sessionId, ctx, runtime.service)
    const startIndex = live.latestIndex(sessionKey)
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

    async resolveInput(_sessionId: string, _requestId: string, _response: AgentResolveInputResponse): Promise<never> {
      throw new AgentNotImplementedError('resolveInput is not implemented until T1.')
    },

    async interrupt(sessionId: string, ctx?: SessionCtx): Promise<unknown> {
      const runtime = await getRuntime()
      const accessCtx = await authorizeSessionAccess(runtime, sessionId, ctx, sessionContexts)
      return runtime.service.interrupt(toPiRequestContext(accessCtx), sessionId, {})
    },

    async stop(sessionId: string, ctx?: SessionCtx): Promise<unknown> {
      const runtime = await getRuntime()
      const accessCtx = await authorizeSessionAccess(runtime, sessionId, ctx, sessionContexts)
      const receipt = await runtime.service.stop(toPiRequestContext(accessCtx), sessionId, {})
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
          await Promise.all([...startedSessions.values()].map((started) =>
            runtime.service.stop(toPiRequestContext(started.ctx), started.sessionId, {}),
          ))
        }
      } catch (error) {
        stopError = error
      } finally {
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
    const accessCtx = await authorizeSessionAccess(runtime, sessionId, options.ctx, sessionContexts)
    yield* live.stream(sessionCacheKey(sessionId, accessCtx), options.startIndex)
  }
}

function createRuntimeLoader(config: AgentConfig, options: CreateAgentRuntimeBridgeOptions): {
  get(): Promise<AgentRuntime>
  current(): Promise<AgentRuntime> | undefined
} {
  let runtimePromise: Promise<AgentRuntime> | undefined
  return {
    get() {
      runtimePromise ??= createRuntime(config, options)
      return runtimePromise
    },
    current() {
      return runtimePromise
    },
  }
}

async function createRuntime(config: AgentConfig, options: CreateAgentRuntimeBridgeOptions): Promise<AgentRuntime> {
  const harnessFactory = config.harnessFactory ?? (await import('./harness/pi-coding-agent/createHarness')).createPiCodingAgentHarness
  const harnessInput: AgentHarnessFactoryInput = {
    tools: config.tools ?? [],
    cwd: config.workdir ?? DEFAULT_WORKDIR,
    runtimeCwd: options.harness?.runtimeCwd ?? options.service?.workdir ?? config.workdir,
    systemPromptAppend: config.systemPromptAppend,
    systemPromptDynamic: config.systemPromptDynamic,
    sessionRoot: config.sessionStorageRoot,
    telemetry: config.telemetry,
  }
  const harness = await harnessFactory(harnessInput)
  const sessionStore = config.sessions ?? harness.sessions
  return {
    harness,
    sessionStore,
    service: new HarnessPiChatService({
      harness,
      sessionStore,
      workdir: options.service?.workdir ?? config.workdir ?? DEFAULT_WORKDIR,
      workspace: options.service?.workspace,
      eventStore: options.service?.eventStore,
      metering: config.metering as AgentMeteringSink | undefined,
    }),
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
): SessionStore {
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
      await runtime.service.deleteSession(toPiRequestContext(accessCtx), sessionId)
      const sessionKey = sessionCacheKey(sessionId, accessCtx)
      live.close(sessionKey)
      sessionContexts.delete(sessionKey)
      startedSessions.delete(sessionKey)
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
