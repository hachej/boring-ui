import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { AgentHarness, RunContext, AgentSendInput } from '../../../shared/harness'
import type { SessionStore } from '../../../shared/session'
import type { PiChatEvent } from '../../../shared/chat'
import type { Workspace } from '../../../shared/workspace'
import { ErrorCode } from '../../../shared/error-codes'
import { createInitialPiChatState, piChatReducer } from '../../../front/chat/pi/piChatReducer'
import { selectMessagesForRender } from '../../../front/chat/pi/selectors'
import type { PiAgentSessionAdapter, PiAgentSessionSnapshot } from '../PiAgentSessionAdapter'
import { HarnessPiChatService } from '../harnessPiChatService'
import type { PiSessionRequestContext } from '../piSessionIdentity'

const ctx: PiSessionRequestContext = {
  workspaceId: 'workspace-a',
  storageScope: 'scope-a',
  authSubject: 'user-a',
  requestId: 'request-a',
}

type PersistedSessionStore = SessionStore & {
  loadEntries?: (ctx: { workspaceId?: string; userId?: string }, sessionId: string) => Promise<{ id: string; messages: unknown[] }>
}

const sessionStore: SessionStore = {
  list: vi.fn(async () => []),
  create: vi.fn(async () => ({ id: 's1', title: 'New session', createdAt: '', updatedAt: '', turnCount: 0 })),
  load: vi.fn(async () => ({ id: 's1', title: 'New session', createdAt: '', updatedAt: '', turnCount: 0 })),
  delete: vi.fn(async () => {}),
}

type FakeAdapter = PiAgentSessionAdapter & {
  emit(event: AgentSessionEvent): void
  listenerCount(): number
}

function createAdapter(followUps: string[] = []): FakeAdapter {
  const listeners = new Set<(event: AgentSessionEvent) => void>()
  const nativeFollowUps: Array<{ text: string; clientNonce?: string; clientSeq?: number }> = followUps.map((text) => ({ text }))
  const snapshot: PiAgentSessionSnapshot = {
    state: {},
    messages: [],
    isStreaming: true,
    isRetrying: false,
    retryAttempt: 0,
    pendingMessageCount: 0,
    steeringMessages: [],
    followUpMessages: followUps,
    followUpMode: 'one-at-a-time',
    sessionId: 's1',
  }

  return {
    readSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((listener: (event: AgentSessionEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    prompt: vi.fn(async () => {}),
    followUp: vi.fn(async (text: string, options?: { displayText?: string; clientNonce?: string; clientSeq?: number }) => {
      nativeFollowUps.push({ text: options?.displayText ?? text, clientNonce: options?.clientNonce, clientSeq: options?.clientSeq })
      snapshot.followUpMessages = nativeFollowUps.map((item) => item.text)
    }),
    clearFollowUp: vi.fn((options?: { clientNonce?: string; clientSeq?: number }) => {
      if (options?.clientNonce || options?.clientSeq !== undefined) {
        const index = nativeFollowUps.findIndex((item) => options.clientNonce
          ? item.clientNonce === options.clientNonce
          : item.clientSeq === options.clientSeq)
        if (index >= 0) nativeFollowUps.splice(index, 1)
      } else {
        nativeFollowUps.splice(0)
      }
      snapshot.followUpMessages = nativeFollowUps.map((item) => item.text)
    }),
    abort: vi.fn(async () => {}),
    abortRetry: vi.fn(),
    continueQueuedFollowUp: vi.fn(async () => {
      snapshot.followUpMessages = snapshot.followUpMessages.slice(1)
    }),
    emit(event: AgentSessionEvent) {
      for (const listener of listeners) listener(event)
    },
    listenerCount: () => listeners.size,
  }
}

function createAdapterForNativeSession(nativeSessionId: string): FakeAdapter {
  const adapter = createAdapter()
  adapter.readSnapshot().sessionId = nativeSessionId
  return adapter
}

function createHarness(adapter: PiAgentSessionAdapter): AgentHarness & {
  getPiSessionAdapter: (input: AgentSendInput, ctx: RunContext) => Promise<PiAgentSessionAdapter>
  hasPiSession: (sessionId: string, ctx?: { workspaceId?: string; userId?: string }) => boolean
} {
  return {
    id: 'fake-pi',
    placement: 'server',
    sessions: sessionStore,
    hasPiSession: vi.fn(() => false),
    getPiSessionAdapter: vi.fn(async () => adapter),
  }
}

function createService(adapter = createAdapter(), workspace?: Workspace) {
  const harness = createHarness(adapter)
  const service = new HarnessPiChatService({
    harness,
    sessionStore,
    workdir: '/workspace',
    ...(workspace ? { workspace } : {}),
  })
  return { service, harness, adapter }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function renderMessagesFromEvents(events: PiChatEvent[]) {
  const state = events.reduce((current, event) => (
    piChatReducer(current, { type: 'event', event })
  ), createInitialPiChatState({ sessionId: 's1', storageScope: 'scope-a' }))

  return selectMessagesForRender(state)
}

describe('HarnessPiChatService', () => {
  it('reports an unknown outcome when a native start retry has no receipt', async () => {
    const { service } = createService()

    await expect(service.promptNewSession(
      ctx,
      { message: 'hello', clientNonce: 'nonce' },
      { idempotencyKey: 'missing-receipt', retry: true },
    )).rejects.toMatchObject({
      code: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN,
      statusCode: 409,
      details: { firstSendState: 'unknown' },
    })
  })

  it('returns one prompt-failed receipt when native adapter setup fails after persistence', async () => {
    const nativeSessionId = 'native-setup-failed'
    const createNativePiSessionAdapter = vi.fn(async () => {
      throw Object.assign(new Error('injected resource failure'), { nativeSessionId })
    })
    const store: SessionStore = {
      ...sessionStore,
      load: vi.fn(async () => ({ id: nativeSessionId, nativeSessionId, title: 'Native', createdAt: '', updatedAt: '', turnCount: 1, hasAssistantReply: false })),
    }
    const service = new HarnessPiChatService({
      harness: ({ ...createHarness(createAdapter()), sessions: store, createNativePiSessionAdapter } as AgentHarness & { createNativePiSessionAdapter: typeof createNativePiSessionAdapter }),
      sessionStore: store,
      workdir: '/workspace',
    })
    const payload = { message: 'hello', clientNonce: 'nonce' }
    const start = { idempotencyKey: 'native-setup-failure', retry: false }

    await expect(service.promptNewSession(ctx, payload, start)).resolves.toMatchObject({
      accepted: false,
      nativeSessionId,
      session: { id: nativeSessionId },
    })
    await expect(service.promptNewSession(ctx, payload, start)).resolves.toMatchObject({ nativeSessionId })
    expect(createNativePiSessionAdapter).toHaveBeenCalledOnce()
  })

  it('only renames a native transcript after an assistant reply', async () => {
    const rename = vi.fn(async (_ctx, id: string, title: string) => ({ id, nativeSessionId: id, title, createdAt: '', updatedAt: '', turnCount: 1, hasAssistantReply: true }))
    const load = vi.fn(async () => ({ id: 'native-1', nativeSessionId: 'native-1', title: 'Native', createdAt: '', updatedAt: '', turnCount: 1, hasAssistantReply: false }))
    const store: SessionStore = { ...sessionStore, load, rename }
    const harness = { ...createHarness(createAdapter()), sessions: store }
    const service = new HarnessPiChatService({ harness, sessionStore: store, workdir: '/workspace' })

    await expect(service.renameSession(ctx, 'native-1', 'Renamed')).rejects.toMatchObject({ code: ErrorCode.enum.SESSION_LOCKED })
    expect(rename).not.toHaveBeenCalled()

    load.mockResolvedValueOnce({ id: 'native-1', nativeSessionId: 'native-1', title: 'Native', createdAt: '', updatedAt: '', turnCount: 1, hasAssistantReply: true })
    await expect(service.renameSession(ctx, 'native-1', '\r\n Renamed \n')).resolves.toMatchObject({ title: 'Renamed' })
    expect(rename).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace-a', userId: 'user-a' }), 'native-1', 'Renamed')
    await expect(service.renameSession(ctx, 'native-1', ' \r\n ')).rejects.toMatchObject({
      code: ErrorCode.enum.BRIDGE_COMMAND_INVALID,
      statusCode: 400,
    })
  })
  it('normalizes missing or stale native rename targets to SESSION_NOT_FOUND', async () => {
    const rename = vi.fn()
    const load = vi.fn()
    const store: SessionStore = { ...sessionStore, load, rename }
    const service = new HarnessPiChatService({ harness: { ...createHarness(createAdapter()), sessions: store }, sessionStore: store, workdir: '/workspace' })

    load.mockRejectedValueOnce(new Error('Session not found: native-1'))
    await expect(service.renameSession(ctx, 'native-1', 'Renamed')).rejects.toMatchObject({
      code: ErrorCode.enum.SESSION_NOT_FOUND,
      statusCode: 404,
    })

    load.mockResolvedValueOnce({ id: 'stale-1', title: 'Stale', createdAt: '', updatedAt: '', turnCount: 1, hasAssistantReply: true })
    await expect(service.renameSession(ctx, 'native-1', 'Renamed')).rejects.toMatchObject({
      code: ErrorCode.enum.SESSION_NOT_FOUND,
      statusCode: 404,
    })

    load.mockResolvedValueOnce({ id: 'native-1', nativeSessionId: 'native-1', title: 'Native', createdAt: '', updatedAt: '', turnCount: 1, hasAssistantReply: true })
    rename.mockRejectedValueOnce(new Error('Session not found: native-1'))
    await expect(service.renameSession(ctx, 'native-1', 'Renamed')).rejects.toMatchObject({
      code: ErrorCode.enum.SESSION_NOT_FOUND,
      statusCode: 404,
    })
    expect(rename).toHaveBeenCalledTimes(1)
  })

  it('disposes a receipt-only prompt, native channel, and metering exactly once', async () => {
    const adapter = createAdapter()
    const run = deferred<void>()
    const release = deferred<void>()
    adapter.prompt = vi.fn(() => run.promise)
    adapter.abort = vi.fn(async () => run.resolve())
    const releaseRun = vi.fn(() => release.promise)
    const service = new HarnessPiChatService({
      harness: createHarness(adapter),
      sessionStore,
      workdir: '/workspace',
      metering: {
        reserveRun: vi.fn(async () => ({})),
        recordUsage: vi.fn(async () => ({ billedMicros: 0 })),
        settleRun: vi.fn(async () => {}),
        releaseRun,
      },
    })

    await expect(service.prompt(ctx, 's1', { message: 'receipt only', clientNonce: 'nonce-dispose' })).resolves.toMatchObject({ accepted: true })
    expect(adapter.listenerCount()).toBe(1)
    let disposed = false
    const disposal = service.dispose().then(() => { disposed = true })
    await vi.waitFor(() => expect(releaseRun).toHaveBeenCalledOnce())
    expect(disposed).toBe(false)

    release.resolve()
    await Promise.all([disposal, service.dispose()])
    expect(adapter.abort).toHaveBeenCalledOnce()
    expect(adapter.abortRetry).toHaveBeenCalledOnce()
    expect(adapter.clearFollowUp).toHaveBeenCalledOnce()
    expect(adapter.listenerCount()).toBe(0)
    await expect(service.prompt(ctx, 's1', { message: 'late', clientNonce: 'nonce-late' })).rejects.toMatchObject({
      code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
    })
    const lateState = service.readState(ctx, 's1')
    expect(lateState).toBeInstanceOf(Promise)
    await expect(lateState).rejects.toMatchObject({ code: ErrorCode.enum.AGENT_BINDING_DISPOSED })
  })

  it('closes live channel subscriptions when disposed', async () => {
    const { service, adapter } = createService()
    const subscription = await service.subscribe(ctx, 's1', 0, () => {})
    expect(subscription.type).toBe('ok')
    if (subscription.type !== 'ok') throw new Error('expected live subscription')
    const closed = subscription.closed
    if (!closed) throw new Error('expected channel completion hook')

    await service.dispose()

    await expect(closed).resolves.toBeUndefined()
    expect(adapter.listenerCount()).toBe(0)
  })

  it('drains an in-flight session deletion before disposing its channel', async () => {
    const adapter = createAdapter()
    const loadGate = deferred<void>()
    const deleteSession = vi.fn(async () => {})
    const load = vi.fn()
      .mockResolvedValueOnce({ id: 's1' })
      .mockImplementationOnce(async () => {
        await loadGate.promise
        return { id: 's1' }
      })
    const service = new HarnessPiChatService({
      harness: createHarness(adapter),
      sessionStore: { ...sessionStore, load, delete: deleteSession },
      workdir: '/workspace',
    })
    const subscription = await service.subscribe(ctx, 's1', 0, () => {})
    expect(subscription.type).toBe('ok')
    if (subscription.type !== 'ok') throw new Error('expected live subscription')
    const closed = subscription.closed
    if (!closed) throw new Error('expected channel completion hook')

    const deletion = service.deleteSession(ctx, 's1')
    const disposal = service.dispose()
    loadGate.resolve()
    await Promise.all([deletion, disposal])

    expect(adapter.abort).toHaveBeenCalledOnce()
    expect(deleteSession).toHaveBeenCalledOnce()
    expect(adapter.listenerCount()).toBe(0)
    await expect(closed).resolves.toBeUndefined()
  })

  it('aborts an interrupt-triggered replacement run before draining the interrupt', async () => {
    const adapter = createAdapter(['queued follow-up'])
    const replacement = deferred<void>()
    let replacementStarted = false
    adapter.continueQueuedFollowUp = vi.fn(() => {
      replacementStarted = true
      return replacement.promise
    })
    adapter.abort = vi.fn(async () => {
      if (replacementStarted) replacement.resolve()
    })
    const { service } = createService(adapter)
    await service.subscribe(ctx, 's1', 0, () => {})
    const interrupt = service.interrupt(ctx, 's1', {})
    await vi.waitFor(() => expect(adapter.continueQueuedFollowUp).toHaveBeenCalledOnce())

    const disposal = service.dispose()
    await Promise.all([interrupt, disposal])

    expect(adapter.abort).toHaveBeenCalledTimes(2)
    expect(adapter.listenerCount()).toBe(0)
  })

  it('normalizes missing-session delete preflight without aborting a live adapter', async () => {
    const adapter = createAdapter()
    const load = vi.fn()
      .mockResolvedValueOnce({ id: 'missing', title: 'New session', createdAt: '', updatedAt: '', turnCount: 0 })
      .mockRejectedValueOnce(new Error('Session not found: missing'))
    const deleteSession = vi.fn(async () => {})
    const service = new HarnessPiChatService({
      harness: createHarness(adapter),
      sessionStore: {
        ...sessionStore,
        load,
        delete: deleteSession,
      },
      workdir: '/workspace',
    })
    const subscription = await service.subscribe(ctx, 'missing', 0, () => {})
    expect(subscription.type).toBe('ok')

    await expect(service.deleteSession(ctx, 'missing')).rejects.toMatchObject({
      code: ErrorCode.enum.SESSION_NOT_FOUND,
    })
    expect(adapter.abort).not.toHaveBeenCalled()
    expect(deleteSession).not.toHaveBeenCalled()

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('threads prompt clientNonce through the first matching user message event', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    await service.prompt(ctx, 's1', {
      message: 'prompt text',
      clientNonce: 'nonce-prompt',
    })

    adapter.emit({
      type: 'message_start',
      message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'prompt text' }] },
    } as unknown as AgentSessionEvent)

    expect(events.at(-1)).toMatchObject({
      type: 'message-start',
      role: 'user',
      clientNonce: 'nonce-prompt',
    })

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('keeps enriched prompt notes out of visible user message finals', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    const displayText = 'can you read this ?'
    const serverText = `${displayText}\n\n[attached: grafik.png (image/png, not inlined — binary) Saved in workspace at: assets/images/grafik.png]`

    await service.prompt(ctx, 's1', {
      message: serverText,
      displayMessage: displayText,
      clientNonce: 'nonce-attachment-note',
      attachments: [{ filename: 'grafik.png', mediaType: 'image/png', url: '/api/v1/files/raw?path=assets%2Fimages%2Fgrafik.png', path: 'assets/images/grafik.png' }],
    })

    adapter.emit({
      type: 'message_start',
      message: { id: 'u-attachment', role: 'user', content: [{ type: 'text', text: serverText }] },
    } as unknown as AgentSessionEvent)
    adapter.emit({
      type: 'message_end',
      message: { id: 'u-attachment', role: 'user', content: [{ type: 'text', text: serverText }] },
    } as unknown as AgentSessionEvent)

    expect(events.find((event) => event.type === 'message-start')).toMatchObject({
      type: 'message-start',
      text: displayText,
      clientNonce: 'nonce-attachment-note',
      files: [expect.objectContaining({ type: 'file', path: 'assets/images/grafik.png' })],
    })
    const final = events.find((event): event is Extract<PiChatEvent, { type: 'message-end' }> => event.type === 'message-end')?.final
    expect(final?.clientNonce).toBe('nonce-attachment-note')
    expect(final?.parts).toEqual([
      expect.objectContaining({ type: 'text', text: displayText }),
      expect.objectContaining({ type: 'file', filename: 'grafik.png', path: 'assets/images/grafik.png' }),
    ])

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('forwards prompt model, thinking, and image attachments through the Pi-native adapter path', async () => {
    const adapter = createAdapter()
    const { service, harness } = createService(adapter)
    const attachments = [
      { filename: 'diagram.png', mediaType: 'image/png', url: 'data:image/png;base64,abc123' },
      { filename: 'notes.txt', mediaType: 'text/plain', url: 'data:text/plain;base64,bm90ZXM=' },
    ]

    await service.prompt(ctx, 's1', {
      message: 'prompt text',
      clientNonce: 'nonce-prompt',
      model: { provider: 'anthropic', id: 'claude-sonnet' },
      thinkingLevel: 'high',
      attachments,
    })

    expect(harness.getPiSessionAdapter).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 's1',
      content: 'prompt text',
      model: { provider: 'anthropic', id: 'claude-sonnet' },
      thinkingLevel: 'high',
      attachments,
    }), expect.any(Object))
    expect(adapter.prompt).toHaveBeenCalledWith({
      text: 'prompt text',
      options: {
        images: [{ type: 'image', mimeType: 'image/png', data: 'abc123' }],
      },
    })
  })

  it('expands uploaded workspace image paths before prompting Pi', async () => {
    const adapter = createAdapter()
    const pngBytes = new Uint8Array(Buffer.from('iVBORw0KGgo=', 'base64'))
    const workspace = {
      stat: vi.fn(async () => ({ kind: 'file', size: pngBytes.byteLength, mtimeMs: 1 })),
      readBinaryFile: vi.fn(async (path: string) => {
        expect(path).toBe('assets/images/diagram.png')
        return pngBytes
      }),
    } as unknown as Workspace
    const { service } = createService(adapter, workspace)

    await service.prompt(ctx, 's1', {
      message: 'look at this',
      clientNonce: 'nonce-workspace-image',
      attachments: [
        {
          filename: 'diagram.png',
          mediaType: 'image/png',
          url: '/api/v1/files/raw?path=assets%2Fimages%2Fdiagram.png&workspaceId=workspace-a',
          path: 'assets/images/diagram.png',
        },
      ],
    })

    expect(adapter.prompt).toHaveBeenCalledWith({
      text: 'look at this',
      options: {
        images: [{ type: 'image', mimeType: 'image/png', data: Buffer.from(pngBytes).toString('base64') }],
      },
    })
  })

  it('does not expand non-image workspace file attachments', async () => {
    const adapter = createAdapter()
    const workspace = {
      stat: vi.fn(async () => ({ kind: 'file', size: 8, mtimeMs: 1 })),
      readBinaryFile: vi.fn(async () => new Uint8Array(Buffer.from('%PDF-1.4'))),
    } as unknown as Workspace
    const { service } = createService(adapter, workspace)

    await service.prompt(ctx, 's1', {
      message: 'read this pdf',
      clientNonce: 'nonce-pdf',
      attachments: [
        {
          filename: 'manual.pdf',
          mediaType: 'application/pdf',
          url: '/api/v1/files/raw?path=assets%2Fuploads%2Fmanual.pdf&workspaceId=workspace-a',
          path: 'assets/uploads/manual.pdf',
        },
      ],
    })

    expect(workspace.readBinaryFile).not.toHaveBeenCalled()
    expect(adapter.prompt).toHaveBeenCalledWith('read this pdf')
  })

  it('does not expand fake workspace image paths with non-image bytes', async () => {
    const adapter = createAdapter()
    const workspace = {
      stat: vi.fn(async () => ({ kind: 'file', size: 8, mtimeMs: 1 })),
      readBinaryFile: vi.fn(async () => new Uint8Array(Buffer.from('%PDF-1.4'))),
    } as unknown as Workspace
    const { service } = createService(adapter, workspace)

    await service.prompt(ctx, 's1', {
      message: 'attached fake image',
      clientNonce: 'nonce-fake-image',
      attachments: [
        {
          filename: 'fake.png',
          mediaType: 'image/png',
          url: '/api/v1/files/raw?path=assets%2Fimages%2Ffake.png&workspaceId=workspace-a',
          path: 'assets/images/fake.png',
        },
      ],
    })

    expect(workspace.readBinaryFile).toHaveBeenCalledWith('assets/images/fake.png')
    expect(adapter.prompt).toHaveBeenCalledWith('attached fake image')
  })

  it('does not expand oversized workspace image paths', async () => {
    const adapter = createAdapter()
    const workspace = {
      stat: vi.fn(async () => ({ kind: 'file', size: 11 * 1024 * 1024, mtimeMs: 1 })),
      readBinaryFile: vi.fn(async () => new Uint8Array(Buffer.from('too-large'))),
    } as unknown as Workspace
    const { service } = createService(adapter, workspace)

    await service.prompt(ctx, 's1', {
      message: 'attached large image',
      clientNonce: 'nonce-large-image',
      attachments: [
        {
          filename: 'large.png',
          mediaType: 'image/png',
          url: '/api/v1/files/raw?path=assets%2Fimages%2Flarge.png&workspaceId=workspace-a',
          path: 'assets/images/large.png',
        },
      ],
    })

    expect(workspace.readBinaryFile).not.toHaveBeenCalled()
    expect(adapter.prompt).toHaveBeenCalledWith('attached large image')
  })

  it('does not expand workspace images that grow after stat', async () => {
    const adapter = createAdapter()
    const workspace = {
      stat: vi.fn(async () => ({ kind: 'file', size: 8, mtimeMs: 1 })),
      readBinaryFile: vi.fn(async () => new Uint8Array(11 * 1024 * 1024)),
    } as unknown as Workspace
    const { service } = createService(adapter, workspace)

    await service.prompt(ctx, 's1', {
      message: 'attached growing image',
      clientNonce: 'nonce-growing-image',
      attachments: [
        {
          filename: 'growing.png',
          mediaType: 'image/png',
          url: '/api/v1/files/raw?path=assets%2Fimages%2Fgrowing.png&workspaceId=workspace-a',
          path: 'assets/images/growing.png',
        },
      ],
    })

    expect(adapter.prompt).toHaveBeenCalledWith('attached growing image')
  })

  it('acknowledges prompt acceptance before the active run settles', async () => {
    const adapter = createAdapter()
    const run = deferred<void>()
    adapter.prompt = vi.fn(() => run.promise)
    const { service } = createService(adapter)

    const receipt = await service.prompt(ctx, 's1', {
      message: 'long running prompt',
      clientNonce: 'nonce-running',
    })

    expect(receipt).toMatchObject({ accepted: true, clientNonce: 'nonce-running', cursor: 1 })
    expect(adapter.prompt).toHaveBeenCalledWith('long running prompt')
    run.resolve()
    await run.promise
  })

  it('publishes an error event when an accepted prompt run rejects before streaming events arrive', async () => {
    const adapter = createAdapter()
    const run = deferred<void>()
    adapter.prompt = vi.fn(() => run.promise)
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    const receipt = await service.prompt(ctx, 's1', {
      message: 'will fail',
      clientNonce: 'nonce-fail',
    })

    run.reject(new Error('provider down'))
    await run.promise.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(receipt).toMatchObject({ accepted: true, cursor: 1, clientNonce: 'nonce-fail' })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'message-start',
        seq: 1,
        role: 'user',
        text: 'will fail',
        clientNonce: 'nonce-fail',
      }),
      expect.objectContaining({
        type: 'error',
        seq: 2,
        error: expect.objectContaining({ message: 'provider down', retryable: false }),
      }),
    ]))
    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      seq: 2,
      status: 'error',
      error: expect.objectContaining({ message: 'provider down', retryable: false }),
      messages: [
        expect.objectContaining({
          role: 'user',
          clientNonce: 'nonce-fail',
          parts: [expect.objectContaining({ type: 'text', text: 'will fail' })],
        }),
      ],
    })

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('does not synthesize a prompt rejection after the prompt user message is consumed', async () => {
    const adapter = createAdapter()
    const run = deferred<void>()
    adapter.prompt = vi.fn(() => run.promise)
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    const receipt = await service.prompt(ctx, 's1', {
      message: 'started then failed',
      clientNonce: 'nonce-started',
    })
    adapter.emit({ type: 'agent_start', turnId: 'turn-started' } as unknown as AgentSessionEvent)
    adapter.emit({
      type: 'message_start',
      message: { id: 'u-started', role: 'user', content: [{ type: 'text', text: 'started then failed' }] },
    } as unknown as AgentSessionEvent)

    run.reject(new Error('provider down after start'))
    await run.promise.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(receipt).toMatchObject({ accepted: true, cursor: 1 })
    expect(events).toEqual([
      expect.objectContaining({ type: 'agent-start', seq: 1, turnId: 'turn-started' }),
      expect.objectContaining({ type: 'message-start', seq: 2, messageId: 'u-started', role: 'user', clientNonce: 'nonce-started' }),
    ])

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('still publishes prompt rejection after unrelated events advance the stream', async () => {
    const adapter = createAdapter()
    const run = deferred<void>()
    adapter.prompt = vi.fn(() => run.promise)
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    const receipt = await service.prompt(ctx, 's1', {
      message: 'fails after queue noise',
      clientNonce: 'nonce-noise',
    })
    adapter.emit({ type: 'queue_update', followUp: ['unrelated queued'] } as unknown as AgentSessionEvent)

    run.reject(new Error('provider down after queue event'))
    await run.promise.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(receipt).toMatchObject({ accepted: true, cursor: 1 })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'queue-updated', seq: 1 }),
      expect.objectContaining({ type: 'message-start', seq: 2, role: 'user', text: 'fails after queue noise', clientNonce: 'nonce-noise' }),
      expect.objectContaining({ type: 'error', seq: 3, error: expect.objectContaining({ message: 'provider down after queue event' }) }),
    ]))

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('keeps mapper sequence aligned after a pre-stream prompt rejection', async () => {
    const adapter = createAdapter()
    const failedRun = deferred<void>()
    const retryRun = deferred<void>()
    adapter.prompt = vi.fn()
      .mockImplementationOnce(() => failedRun.promise)
      .mockImplementationOnce(() => retryRun.promise)
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    await service.prompt(ctx, 's1', {
      message: 'first try',
      clientNonce: 'nonce-first',
    })
    failedRun.reject(new Error('provider down'))
    await failedRun.promise.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))

    await expect(service.prompt(ctx, 's1', {
      message: 'retry',
      clientNonce: 'nonce-retry',
    })).resolves.toMatchObject({ accepted: true, cursor: 3, clientNonce: 'nonce-retry' })
    expect(() => {
      adapter.emit({ type: 'agent_start', turnId: 'turn-retry' } as unknown as AgentSessionEvent)
      adapter.emit({
        type: 'message_start',
        message: { id: 'retry-user', role: 'user', content: [{ type: 'text', text: 'retry' }] },
      } as unknown as AgentSessionEvent)
    }).not.toThrow()
    retryRun.resolve()
    await retryRun.promise

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'message-start', seq: 1, role: 'user', text: 'first try', clientNonce: 'nonce-first' }),
      expect.objectContaining({ type: 'error', seq: 2 }),
      expect.objectContaining({ type: 'agent-start', seq: 3, turnId: 'turn-retry' }),
      expect.objectContaining({ type: 'message-start', seq: 4, messageId: 'retry-user', role: 'user', clientNonce: 'nonce-retry' }),
    ]))

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('prefers prompt metadata over queued follow-up metadata for repeated user text events', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    await service.prompt(ctx, 's1', {
      message: 'same text',
      clientNonce: 'nonce-prompt',
    })
    await service.followUp(ctx, 's1', {
      message: 'same text',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })

    adapter.emit({
      type: 'message_start',
      message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'same text' }] },
    } as unknown as AgentSessionEvent)
    expect(events.at(-1)).toMatchObject({
      type: 'message-start',
      role: 'user',
      clientNonce: 'nonce-prompt',
    })
    expect(events.at(-1)).not.toMatchObject({ clientSeq: 3 })

    adapter.emit({
      type: 'message_start',
      message: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'same text' }] },
    } as unknown as AgentSessionEvent)
    expect(events.at(-1)).toMatchObject({
      type: 'message-start',
      role: 'user',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('keeps Pi mapper context across tool call and tool result events', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit({
      type: 'message_start',
      message: { id: 'a1', role: 'assistant', content: [] },
    } as unknown as AgentSessionEvent)
    adapter.emit({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_end',
        partial: { id: 'a1' },
        toolCall: { id: 'tool-1', name: 'bash', arguments: { command: 'pwd' } },
      },
    } as unknown as AgentSessionEvent)
    adapter.emit({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      result: { content: '/workspace' },
    } as unknown as AgentSessionEvent)

    expect(events).toEqual([
      expect.objectContaining({ type: 'agent-start', seq: 1, turnId: 'turn-1' }),
      expect.objectContaining({ type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' }),
      expect.objectContaining({ type: 'tool-call', seq: 3, messageId: 'a1', toolCallId: 'tool-1' }),
      expect.objectContaining({ type: 'tool-result', seq: 4, messageId: 'a1', toolCallId: 'tool-1' }),
    ])

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('projects enriched prompt echoes with raw display text and nonce metadata', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    await service.prompt(ctx, 's1', {
      message: 'raw prompt\n\n@files: src/app.ts',
      displayMessage: 'raw prompt',
      clientNonce: 'nonce-1',
    })
    adapter.emit({
      type: 'message_start',
      message: { role: 'user', content: [{ type: 'text', text: 'raw prompt\n\n@files: src/app.ts' }] },
    } as unknown as AgentSessionEvent)

    expect(events).toContainEqual(expect.objectContaining({
      type: 'message-start',
      role: 'user',
      text: 'raw prompt',
      clientNonce: 'nonce-1',
    }))

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('includes the active live turn id in state snapshots during streaming reload', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)
    const subscription = await service.subscribe(ctx, 's1', 0, () => {})
    expect(subscription.type).toBe('ok')

    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)

    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      status: 'streaming',
      activeTurnId: 'turn-1',
    })

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('does not stamp the active turn id onto older snapshot rows during streaming reload', async () => {
    const adapter = createAdapter()
    const messages = adapter.readSnapshot().messages as unknown[]
    messages.push(
      { id: 'old-user', message: { role: 'user', content: 'old prompt', timestamp: 1 } },
      { id: 'old-assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'old answer' }], stopReason: 'stop', timestamp: 2 } },
      { id: 'active-user', message: { role: 'user', content: 'active prompt', timestamp: 3 } },
      { id: 'active-assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'working' }], timestamp: 4 } },
    )
    const { service } = createService(adapter)
    const subscription = await service.subscribe(ctx, 's1', 0, () => {})
    expect(subscription.type).toBe('ok')

    adapter.emit({ type: 'agent_start', turnId: 'turn-active' } as unknown as AgentSessionEvent)
    adapter.emit({
      type: 'message_start',
      message: { id: 'active-user', role: 'user', content: [{ type: 'text', text: 'active prompt' }] },
    } as unknown as AgentSessionEvent)
    adapter.emit({
      type: 'message_start',
      message: { id: 'active-assistant', role: 'assistant', content: [] },
    } as unknown as AgentSessionEvent)

    const snapshot = await service.readState(ctx, 's1')

    expect(snapshot).toMatchObject({
      status: 'streaming',
      activeTurnId: 'turn-active',
    })
    expect(snapshot.messages.map((message) => [message.id, message.turnId])).toEqual([
      ['old-user', undefined],
      ['old-assistant', undefined],
      ['active-user', 'turn-active'],
      ['active-assistant', 'turn-active'],
    ])

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('uses enriched server text when interrupt auto-post falls back to reposting a queued follow-up', async () => {
    const adapter = createAdapter()
    adapter.continueQueuedFollowUp = undefined
    const { service, harness } = createService(adapter)

    await service.followUp(ctx, 's1', {
      message: 'queued raw text\n\n@files: src/app.ts',
      displayMessage: 'queued raw text',
      clientNonce: 'queued-nonce',
      clientSeq: 1,
    })
    expect(adapter.followUp).toHaveBeenCalledWith('queued raw text\n\n@files: src/app.ts', {
      displayText: 'queued raw text',
      clientNonce: 'queued-nonce',
      clientSeq: 1,
    })
    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      queue: { followUps: [expect.objectContaining({ displayText: 'queued raw text' })] },
    })

    await service.interrupt(ctx, 's1', {})

    expect(adapter.prompt).toHaveBeenCalledWith('queued raw text\n\n@files: src/app.ts')
  })

  it('rejects interrupt instead of silently skipping fallback auto-post when one queued item cannot be safely consumed', async () => {
    const adapter = createAdapter(['first queued', 'second queued'])
    adapter.continueQueuedFollowUp = undefined
    const { service } = createService(adapter)

    await expect(service.interrupt(ctx, 's1', {})).rejects.toThrow('Cannot auto-post queued follow-up')

    expect(adapter.prompt).not.toHaveBeenCalled()
    expect(adapter.readSnapshot().followUpMessages).toEqual(['first queued', 'second queued'])
  })

  it('preserves the queued follow-up when fallback reposting fails', async () => {
    const adapter = createAdapter(['queued raw text'])
    adapter.continueQueuedFollowUp = undefined
    adapter.prompt = vi.fn(async () => { throw new Error('provider down') })
    const { service } = createService(adapter)

    await expect(service.interrupt(ctx, 's1', {})).rejects.toThrow('provider down')

    expect(adapter.readSnapshot().followUpMessages).toEqual(['queued raw text'])
  })

  it('projects id-less Pi live turns into one render row per user and assistant message', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    const user = { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1_700_000_000_000 }
    const assistant = { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: 1_700_000_000_001 }

    adapter.emit({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    adapter.emit({ type: 'message_start', message: user } as unknown as AgentSessionEvent)
    adapter.emit({ type: 'message_end', message: user } as unknown as AgentSessionEvent)
    adapter.emit({ type: 'message_start', message: { role: 'assistant', content: [] } } as unknown as AgentSessionEvent)
    adapter.emit({ type: 'message_end', message: assistant } as unknown as AgentSessionEvent)
    adapter.emit({ type: 'agent_end', messages: [user, assistant], willRetry: false } as unknown as AgentSessionEvent)

    const messageStarts = events.filter((event) => event.type === 'message-start')
    const messageEnds = events.filter((event) => event.type === 'message-end')
    const rendered = renderMessagesFromEvents(events)

    expect(messageStarts).toEqual([
      expect.objectContaining({ type: 'message-start', role: 'user' }),
      expect.objectContaining({ type: 'message-start', role: 'assistant' }),
    ])
    expect(messageEnds).toEqual([
      expect.objectContaining({ type: 'message-end', messageId: messageStarts[0]?.messageId }),
      expect.objectContaining({ type: 'message-end', messageId: messageStarts[1]?.messageId }),
    ])
    expect(events.filter((event) => event.type === 'agent-end')).toHaveLength(1)
    expect(rendered.map((message) => ({ id: message.id, role: message.role }))).toEqual([
      { id: messageStarts[0]?.messageId, role: 'user' },
      { id: messageStarts[1]?.messageId, role: 'assistant' },
    ])
    expect(new Set(rendered.map((message) => message.id)).size).toBe(2)

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('queues follow-ups through the harness metadata path when available', async () => {
    const { service, harness, adapter } = createService()

    await expect(service.followUp(ctx, 's1', {
      message: 'queued',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })).resolves.toMatchObject({ accepted: true, queued: true, clientNonce: 'nonce-q', clientSeq: 3 })

    expect(adapter.followUp).toHaveBeenCalledWith('queued', {
      displayText: 'queued',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })
  })

  it('enriches queue events emitted during follow-up enqueue', async () => {
    const adapter = createAdapter()
    const { service, harness } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')
    adapter.followUp = vi.fn(async () => {
      adapter.emit({ type: 'queue_update', followUp: ['queued'] } as unknown as AgentSessionEvent)
    })

    await service.followUp(ctx, 's1', {
      message: 'queued',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })

    expect(events.at(-1)).toMatchObject({
      type: 'queue-updated',
      queue: { followUps: [{ displayText: 'queued', clientNonce: 'nonce-q', clientSeq: 3 }] },
    })

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('threads queued follow-up selectors through recovered state and queue events', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)

    await service.followUp(ctx, 's1', {
      message: 'queued',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })

    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      queue: { followUps: [{ displayText: 'queued', clientNonce: 'nonce-q', clientSeq: 3 }] },
    })

    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    adapter.emit({ type: 'queue_update', followUp: ['queued'] } as unknown as AgentSessionEvent)
    expect(events.at(-1)).toMatchObject({
      type: 'queue-updated',
      queue: { followUps: [{ displayText: 'queued', clientNonce: 'nonce-q', clientSeq: 3 }] },
    })

    adapter.emit({
      type: 'message_start',
      message: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'queued' }] },
    } as unknown as AgentSessionEvent)
    expect(events.at(-1)).toMatchObject({
      type: 'message-start',
      role: 'user',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('keeps /state scoped to the requested browser-visible session id when Pi reports a linked native id', async () => {
    const adapter = createAdapterForNativeSession('native-pi-session')
    const { service } = createService(adapter)

    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      sessionId: 's1',
      queue: { followUps: [] },
    })
  })

  it('hydrates inactive persisted state through buildPiChatHistory without opening a live Pi adapter', async () => {
    const adapter = createAdapter()
    // The cold-load path now feeds the raw persisted pi message entries through
    // buildPiChatHistory — the same canonical projection as the live path.
    const persistedStore: PersistedSessionStore = {
      ...sessionStore,
      loadEntries: vi.fn(async () => ({
        id: 's-history',
        messages: [
          {
            id: 'u1',
            role: 'user',
            content: [{ type: 'text', text: 'persisted prompt' }],
          },
          {
            id: 'a1',
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'thought' },
              {
                type: 'toolCall',
                id: 'call-1',
                name: 'bash',
                arguments: { command: 'pwd' },
                ui: { rendererId: 'terminal.command', displayGroup: 'Commands', details: { command: 'pwd' }, extra: 'ignored' },
              },
              { type: 'text', text: 'persisted answer' },
            ],
            stopReason: 'stop',
          },
          {
            role: 'toolResult',
            toolCallId: 'call-1',
            content: [{ type: 'text', text: 'ok' }],
            isError: false,
          },
        ],
      })),
    }
    const harness = createHarness(adapter)
    const service = new HarnessPiChatService({
      harness,
      sessionStore: persistedStore,
      workdir: '/workspace',
    })

    const state = await service.readState(ctx, 's-history')

    expect(harness.getPiSessionAdapter).not.toHaveBeenCalled()
    expect(state).toMatchObject({
      sessionId: 's-history',
      status: 'idle',
      messages: [
        expect.objectContaining({
          id: 'u1',
          role: 'user',
          parts: [expect.objectContaining({ type: 'text', text: 'persisted prompt' })],
        }),
        expect.objectContaining({
          id: 'a1',
          role: 'assistant',
          parts: [
            expect.objectContaining({ type: 'reasoning', text: 'thought' }),
            expect.objectContaining({
              type: 'tool-call',
              id: 'call-1',
              toolName: 'bash',
              state: 'output-available',
              ui: { rendererId: 'terminal.command', displayGroup: 'Commands', details: { command: 'pwd' } },
            }),
            expect.objectContaining({ type: 'text', text: 'persisted answer' }),
          ],
        }),
      ],
    })
  })

  it('uses the live adapter instead of persisted state when the harness has a Pi session', async () => {
    const adapter = createAdapter()
    adapter.readSnapshot().messages = [
      { id: 'live-user', message: { role: 'user', content: [{ type: 'text', text: 'live prompt' }] } },
    ]
    const persistedStore: PersistedSessionStore = {
      ...sessionStore,
      loadEntries: vi.fn(async () => ({
        id: 's1',
        messages: [
          { id: 'stale-user', role: 'user', content: [{ type: 'text', text: 'stale prompt' }] },
        ],
      })),
    }
    const harness = createHarness(adapter)
    vi.mocked(harness.hasPiSession).mockReturnValue(true)
    const service = new HarnessPiChatService({
      harness,
      sessionStore: persistedStore,
      workdir: '/workspace',
    })

    const state = await service.readState(ctx, 's1')

    expect(harness.getPiSessionAdapter).toHaveBeenCalled()
    expect(state.messages).toEqual([
      expect.objectContaining({
        id: 'live-user',
        parts: [expect.objectContaining({ type: 'text', text: 'live prompt' })],
      }),
    ])
  })

  it('does not expose a live channel to a different session context', async () => {
    const adapter = createAdapter()
    adapter.readSnapshot().messages = [
      { id: 'live-user', message: { role: 'user', content: [{ type: 'text', text: 'live prompt' }] } },
    ]
    const scopedStore: SessionStore = {
      ...sessionStore,
      load: vi.fn(async (sessionCtx, sessionId) => {
        if (sessionCtx.workspaceId !== ctx.workspaceId || sessionCtx.userId !== ctx.authSubject) {
          throw new Error(`Session not found: ${sessionId}`)
        }
        return { id: sessionId, title: 'Scoped', createdAt: '', updatedAt: '', turnCount: 0 }
      }),
    }
    const harness = createHarness(adapter)
    vi.mocked(harness.hasPiSession).mockImplementation((_sessionId, sessionCtx) => sessionCtx?.workspaceId === ctx.workspaceId)
    const service = new HarnessPiChatService({
      harness,
      sessionStore: scopedStore,
      workdir: '/workspace',
    })

    await service.prompt(ctx, 's1', { message: 'live prompt', clientNonce: 'nonce-live' })
    await expect(service.readState({ ...ctx, workspaceId: 'workspace-b' }, 's1'))
      .rejects.toMatchObject({ code: ErrorCode.enum.SESSION_NOT_FOUND })

    expect(harness.getPiSessionAdapter).toHaveBeenCalledTimes(1)
  })

  it('threads prompt and follow-up selectors through only new recovered snapshot messages', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)

    await service.prompt(ctx, 's1', {
      message: 'same text',
      clientNonce: 'nonce-prompt',
    })
    await service.followUp(ctx, 's1', {
      message: 'same text',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })

    const currentTimestamp = Date.now() + 1000
    adapter.readSnapshot().messages = [
      { id: 'old-duplicate', role: 'user', content: [{ type: 'text', text: 'same text' }], timestamp: 1 },
      { id: 'u1', role: 'user', content: [{ type: 'text', text: 'same text' }], timestamp: currentTimestamp },
      { id: 'u2', role: 'user', content: [{ type: 'text', text: 'same text' }], timestamp: currentTimestamp + 1 },
    ]

    const state = await service.readState(ctx, 's1')
    expect(state).toMatchObject({
      messages: [
        { id: 'old-duplicate' },
        { id: 'u1', clientNonce: 'nonce-prompt' },
        { id: 'u2', clientNonce: 'nonce-q', clientSeq: 3 },
      ],
    })
    expect(state.messages[0]?.clientNonce).toBeUndefined()
    expect(state.messages[0]?.clientSeq).toBeUndefined()
  })

  it('delegates selected queue clears to the harness follow-up selector', async () => {
    const adapter = createAdapter()
    const { service, harness } = createService(adapter)

    await service.followUp(ctx, 's1', {
      message: 'queued',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })
    await expect(service.clearQueue(ctx, 's1', {
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })).resolves.toMatchObject({ accepted: true, cleared: 1 })

    expect(adapter.clearFollowUp).toHaveBeenCalledWith({
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })
  })

  it('prefers nonce over colliding clientSeq when removing selected metadata', async () => {
    const adapter = createAdapter()
    const { service } = createService(adapter)

    await service.followUp(ctx, 's1', { message: 'first', clientNonce: 'nonce-1', clientSeq: 1 })
    await service.followUp(ctx, 's1', { message: 'second', clientNonce: 'nonce-2', clientSeq: 1 })

    await expect(service.clearQueue(ctx, 's1', { clientNonce: 'nonce-2', clientSeq: 1 })).resolves.toMatchObject({ accepted: true, cleared: 1 })
    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      queue: { followUps: [{ displayText: 'first', clientNonce: 'nonce-1', clientSeq: 1 }] },
    })
  })

  it('does not turn selected clears that match nothing into full clears', async () => {
    const adapter = createAdapter(['first', 'second'])
    const { service } = createService(adapter)

    await expect(service.clearQueue(ctx, 's1', {
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })).resolves.toMatchObject({ accepted: true, cleared: 0 })

    expect(adapter.readSnapshot().followUpMessages).toEqual(['first', 'second'])
  })

  it('interrupts the active run and auto-posts the next queued follow-up', async () => {
    const adapter = createAdapter()
    const { service, harness } = createService(adapter)

    await service.followUp(ctx, 's1', {
      message: 'next queued',
      clientNonce: 'nonce-q',
      clientSeq: 3,
    })
    await expect(service.interrupt(ctx, 's1', {})).resolves.toMatchObject({ accepted: true })

    expect(adapter.abortRetry).toHaveBeenCalledTimes(1)
    expect(adapter.abort).toHaveBeenCalledTimes(1)
    expect(adapter.clearFollowUp).not.toHaveBeenCalled()
    expect(adapter.continueQueuedFollowUp).toHaveBeenCalledTimes(1)
    expect(adapter.prompt).not.toHaveBeenCalled()
    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      queue: { followUps: [] },
    })
  })

  it('does not auto-post queued follow-ups when interrupting an idle session', async () => {
    const adapter = createAdapter()
    adapter.readSnapshot().isStreaming = false
    adapter.readSnapshot().isRetrying = false
    const { service } = createService(adapter)

    await service.followUp(ctx, 's1', {
      message: 'idle queued',
      clientNonce: 'nonce-idle',
      clientSeq: 7,
    })
    await expect(service.interrupt(ctx, 's1', {})).resolves.toMatchObject({ accepted: true })

    expect(adapter.abortRetry).toHaveBeenCalledTimes(1)
    expect(adapter.abort).not.toHaveBeenCalled()
    expect(adapter.continueQueuedFollowUp).not.toHaveBeenCalled()
    expect(adapter.prompt).not.toHaveBeenCalled()
    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      queue: { followUps: [{ displayText: 'idle queued', clientNonce: 'nonce-idle', clientSeq: 7 }] },
    })
  })

  it('interrupts retry backoff and auto-posts the next queued follow-up', async () => {
    const adapter = createAdapter()
    adapter.readSnapshot().isStreaming = false
    adapter.readSnapshot().isRetrying = true
    const { service } = createService(adapter)

    await service.followUp(ctx, 's1', {
      message: 'queued during retry',
      clientNonce: 'nonce-retry',
      clientSeq: 4,
    })
    await expect(service.interrupt(ctx, 's1', {})).resolves.toMatchObject({ accepted: true })

    expect(adapter.abortRetry).toHaveBeenCalledTimes(1)
    expect(adapter.abort).toHaveBeenCalledTimes(1)
    expect(adapter.continueQueuedFollowUp).toHaveBeenCalledTimes(1)
    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      queue: { followUps: [] },
    })
  })

  it('preserves consuming metadata when fallback repost fails after interrupt', async () => {
    const adapter = createAdapter()
    delete adapter.continueQueuedFollowUp
    adapter.prompt = vi.fn(async () => {
      throw new Error('fallback failed')
    })
    const { service } = createService(adapter)
    const events: PiChatEvent[] = []
    const subscription = await service.subscribe(ctx, 's1', 0, (event) => events.push(event))
    expect(subscription.type).toBe('ok')

    await service.followUp(ctx, 's1', {
      message: 'same text later',
      clientNonce: 'nonce-fallback',
      clientSeq: 8,
    })
    await expect(service.interrupt(ctx, 's1', {})).rejects.toThrow('fallback failed')

    adapter.emit({
      type: 'message_start',
      message: { id: 'u-later', role: 'user', content: [{ type: 'text', text: 'same text later' }] },
    } as unknown as AgentSessionEvent)

    const laterUser = events.at(-1)
    expect(laterUser).toMatchObject({ type: 'message-start', role: 'user', messageId: 'u-later' })
    expect(laterUser).toMatchObject({ clientNonce: 'nonce-fallback', clientSeq: 8 })

    if (subscription.type === 'ok') subscription.unsubscribe()
  })

  it('clears the queued follow-up before fallback repost when native continue is unavailable', async () => {
    const adapter = createAdapter()
    delete adapter.continueQueuedFollowUp
    const { service, harness } = createService(adapter)

    await service.followUp(ctx, 's1', {
      message: 'fallback queued',
      clientNonce: 'nonce-fallback',
      clientSeq: 5,
    })
    await expect(service.interrupt(ctx, 's1', {})).resolves.toMatchObject({ accepted: true })

    expect(adapter.clearFollowUp).toHaveBeenCalledWith()
    expect(adapter.prompt).toHaveBeenCalledWith('fallback queued')
    await expect(service.readState(ctx, 's1')).resolves.toMatchObject({
      queue: { followUps: [] },
    })
  })

  it('clears the adapter queue on full clear and stop', async () => {
    const adapter = createAdapter(['first', 'second'])
    const { service, harness } = createService(adapter)

    await expect(service.clearQueue(ctx, 's1', {})).resolves.toMatchObject({ accepted: true, cleared: 2 })
    expect(adapter.clearFollowUp).toHaveBeenCalledTimes(1)

    const stopAdapter = createAdapter(['stop queued'])
    const stop = createService(stopAdapter)
    await expect(stop.service.stop(ctx, 's1', {})).resolves.toMatchObject({
      accepted: true,
      stopped: true,
      clearedQueue: [{ id: expect.stringContaining('queue:s1:followup'), kind: 'followup', displayText: 'stop queued' }],
    })

    expect(stopAdapter.clearFollowUp).toHaveBeenCalledTimes(1)
    expect(stopAdapter.abort).toHaveBeenCalledTimes(1)
  })
})
