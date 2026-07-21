// @vitest-environment jsdom
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { SessionSummary } from '../../../shared/session'
import { createInitialPiChatState, type PiChatState } from '../pi/piChatReducer'
import type { RemotePiSession, RemotePiSessionOptions } from '../pi/remotePiSession'
import { activeSessionStorageKey, scopedComposerStorageKey, type ActiveSessionStorageLike } from '../session'
import { PiChatPanel } from '../PiChatPanel'

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
})
Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:attachment') })
Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
Element.prototype.scrollIntoView = vi.fn()

function session(id: string, title = `Session ${id}`): SessionSummary {
  return { id, title, createdAt: '2026-06-03T00:00:00.000Z', updatedAt: '2026-06-03T00:01:00.000Z', turnCount: 1 }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
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

function storage(initial: Record<string, string> = {}): ActiveSessionStorageLike & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
  }
}

class FakeRemotePiSession {
  readonly prompt = vi.fn(async () => ({ accepted: true, cursor: this.state.lastSeq + 1, clientNonce: 'nonce' }))
  readonly followUp = vi.fn(async (payload: { message: string; clientNonce: string; clientSeq: number }) => {
    this.state = {
      ...this.state,
      optimisticOutbox: {
        ...this.state.optimisticOutbox,
        [payload.clientNonce]: {
          id: `optimistic:${payload.clientNonce}`,
          role: 'user',
          status: 'pending',
          clientNonce: payload.clientNonce,
          clientSeq: payload.clientSeq,
          parts: [{ type: 'text', id: `optimistic:${payload.clientNonce}:text`, text: payload.message }],
        },
      },
    }
    for (const listener of this.listeners) listener()
    return { accepted: true, cursor: this.state.lastSeq + 1, clientNonce: payload.clientNonce, clientSeq: payload.clientSeq, queued: true }
  })
  readonly clearQueue = vi.fn(async () => ({ accepted: true, cursor: this.state.lastSeq + 1, cleared: this.state.queue.followUps.length }))
  readonly interrupt = vi.fn(async () => ({ accepted: true, cursor: this.state.lastSeq + 1 }))
  readonly stop = vi.fn(async () => ({ accepted: true, cursor: this.state.lastSeq + 1, stopped: true, clearedQueue: this.state.queue.followUps }))
  readonly dispose = vi.fn()
  private readonly listeners = new Set<() => void>()

  constructor(public state: PiChatState) {}

  getState(): PiChatState {
    return this.state
  }

  getDebugState() {
    return {
      sessionId: this.state.sessionId,
      lastSeq: this.state.lastSeq,
      status: this.state.status,
      connection: this.state.connection.state,
      lastHeartbeatAt: this.state.connection.lastHeartbeatAt,
      queue: {
        followUps: this.state.queue.followUps.length,
        optimisticOutbox: Object.keys(this.state.optimisticOutbox).length,
        pendingToolCalls: this.state.pendingToolCallIds.size,
      },
      recentEventTypes: ['agent-start', 'message-delta'],
      gapCount: 1,
      retryNotice: this.state.retryNotice,
      largeStateWarning: {
        type: 'large-state' as const,
        sessionId: this.state.sessionId,
        approxBytes: 123456,
        messageCount: this.state.committedMessages.length,
        thresholdBytes: 10,
        thresholdMessages: 1,
      },
      history: { mode: 'full' as const, messageCount: this.state.committedMessages.length, streamingMessageCount: this.state.streamingMessage ? 1 as const : 0 as const },
      disposed: false,
      generation: 0,
      streamRunId: 0,
      reconnectAttempt: 0,
      hasReconnectTimer: false,
      inflightFetches: 0,
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setState(state: PiChatState): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }

  // Set by remoteFactory from the session options; lets tests push stream events
  // (e.g. agent-end) the way RemotePiSession would when frames arrive.
  onEvent?: (event: unknown) => void
  emit(event: unknown): void {
    this.onEvent?.(event)
  }
}

function remoteState(overrides: Partial<PiChatState> = {}): PiChatState {
  return {
    ...createInitialPiChatState({ sessionId: 'pi-1', storageScope: 'scope-a', status: 'idle' }),
    hydrated: true,
    lastSeq: 7,
    committedMessages: [
      { id: 'u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'u1:text', text: 'committed from /state' }] },
    ],
    connection: { state: 'connected' },
    ...overrides,
  }
}

function remoteFactory(remote: FakeRemotePiSession) {
  const factory = vi.fn((options: RemotePiSessionOptions) => {
    remote.state = {
      ...remote.state,
      sessionId: options.sessionId,
      workspaceId: options.workspaceId,
      storageScope: options.storageScope ?? remote.state.storageScope,
    }
    remote.onEvent = options.onEvent as ((event: unknown) => void) | undefined
    return remote as unknown as RemotePiSession
  })
  return factory
}

describe('PiChatPanel sandbox shell', () => {
  // Tests reuse storageScope values (scope-a, workspace-a, ...). Persisted
  // active-session pointers must not leak across tests, or a later test will try
  // to restore a session its fetch mock doesn't serve and render a navigation error.
  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  test('imports no old chat hooks/projection/AI SDK stream contracts', () => {
    const source = readFileSync('src/front/chat/PiChatPanel.tsx', 'utf8')
    for (const forbidden of ['use' + 'AgentChat', 'piChat' + 'Projection', 'piNative' + 'FollowUpQueue', '@ai-sdk' + '/react', 'UIMessageChunk']) {
      expect(source).not.toContain(forbidden)
    }
    expect(source).not.toMatch(/\buseChat\s*\(/)
  })

  test('hydrates selected Pi session from usePiSessions and can create a new session', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([session('pi-1', 'Running Pi session')]))
      .mockResolvedValueOnce(jsonResponse(session('pi-new', 'New session'), 201))
      .mockResolvedValueOnce(jsonResponse([session('pi-new', 'New session'), session('pi-1', 'Running Pi session')]))
    const createRemoteSession = remoteFactory(remote)

    render(<PiChatPanel showSessions serverResourcesEnabled={false} storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={createRemoteSession} />)

    await waitFor(() => expect(screen.getByText('committed from /state')).toBeTruthy())
    expect(screen.getAllByText('Running Pi session').length).toBeGreaterThan(0)
    expect(screen.getByText('committed from /state').closest('[data-boring-agent-part="chat"]')?.getAttribute('data-pi-chat-connection')).toBe('connected')
    expect(createRemoteSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'pi-1', storageScope: 'scope-a' }))

    const textarea = screen.getByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: 'first prompt' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({ message: 'first prompt' })))

    fireEvent.click(screen.getByRole('button', { name: 'New session' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/agent/pi-chat/sessions', expect.objectContaining({ method: 'POST' })))
  })

  test('clears the composer immediately after local prompt acceptance', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const promptReceipt = deferred<{ accepted: true; cursor: number; clientNonce: string }>()
    remote.prompt.mockImplementationOnce(async () => promptReceipt.promise)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    const textarea = await screen.findByLabelText('Agent prompt') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'clear me now' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({ message: 'clear me now' })))
    await waitFor(() => expect(textarea.value).toBe(''))

    await act(async () => {
      promptReceipt.resolve({ accepted: true, cursor: 8, clientNonce: 'nonce' })
      await promptReceipt.promise
    })
  })

  test('does not wipe a new draft typed before prompt receipt resolves', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const promptReceipt = deferred<{ accepted: true; cursor: number; clientNonce: string }>()
    remote.prompt.mockImplementationOnce(async () => promptReceipt.promise)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    const textarea = await screen.findByLabelText('Agent prompt') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'submitted draft' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({ message: 'submitted draft' })))
    await waitFor(() => expect(textarea.value).toBe(''))

    fireEvent.change(textarea, { target: { value: 'next draft' } })

    await act(async () => {
      promptReceipt.resolve({ accepted: true, cursor: 8, clientNonce: 'nonce' })
      await promptReceipt.promise
    })

    expect(textarea.value).toBe('next draft')
  })

  test('queues fast follow-ups after prompt receipt before stream events arrive', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle' }))
    const promptReceipt = deferred<{ accepted: true; cursor: number; clientNonce: string }>()
    remote.prompt.mockImplementationOnce(async () => promptReceipt.promise)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    const textarea = await screen.findByLabelText('Agent prompt') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'first prompt' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({ message: 'first prompt' })))

    await act(async () => {
      promptReceipt.resolve({ accepted: true, cursor: 8, clientNonce: 'nonce' })
      await promptReceipt.promise
    })

    await screen.findByRole('button', { name: 'Stop' })
    fireEvent.change(textarea, { target: { value: 'second while submitted' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => expect(remote.followUp).toHaveBeenCalledWith(expect.objectContaining({ message: 'second while submitted', clientSeq: 1 })))
    expect(remote.prompt).toHaveBeenCalledTimes(1)
  })

  test('queues fast follow-ups before the first prompt receipt resolves', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle' }))
    const promptReceipt = deferred<{ accepted: true; cursor: number; clientNonce: string }>()
    remote.prompt.mockImplementationOnce(async () => promptReceipt.promise)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    const textarea = await screen.findByLabelText('Agent prompt') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'first prompt' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({ message: 'first prompt' })))

    await screen.findByRole('button', { name: 'Stop' })
    fireEvent.change(textarea, { target: { value: 'second before receipt' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => expect(remote.followUp).toHaveBeenCalledWith(expect.objectContaining({ message: 'second before receipt', clientSeq: 1 })))
    expect(remote.prompt).toHaveBeenCalledTimes(1)

    await act(async () => {
      promptReceipt.resolve({ accepted: true, cursor: 8, clientNonce: 'nonce' })
      await promptReceipt.promise
    })
  })

  test('stop clears local submitted state when no stream events arrived yet', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle', lastSeq: 7 }))
    const promptReceipt = deferred<{ accepted: true; cursor: number; clientNonce: string }>()
    remote.prompt.mockImplementationOnce(async () => promptReceipt.promise)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    const textarea = await screen.findByLabelText('Agent prompt') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'will be stopped before events' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({ message: 'will be stopped before events' })))

    await act(async () => {
      promptReceipt.resolve({ accepted: true, cursor: 8, clientNonce: 'nonce' })
      await promptReceipt.promise
    })

    await screen.findByTestId('chat-working')
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() => expect(remote.stop).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByTestId('chat-working')).toBeNull())
    await screen.findByRole('button', { name: 'Submit' })
  })

  test('does not hold submitted state when stream events catch up before prompt receipt resolves', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle', lastSeq: 7 }))
    const promptReceipt = deferred<{ accepted: true; cursor: number; clientNonce: string }>()
    remote.prompt.mockImplementationOnce(async () => promptReceipt.promise)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    const textarea = await screen.findByLabelText('Agent prompt') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'settles before receipt' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({ message: 'settles before receipt' })))

    act(() => {
      remote.setState({
        ...remote.state,
        status: 'idle',
        lastSeq: 8,
        committedMessages: [
          ...remote.state.committedMessages,
          { id: 'a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'a1:text', text: 'done before receipt' }] },
        ],
      })
    })

    await act(async () => {
      promptReceipt.resolve({ accepted: true, cursor: 8, clientNonce: 'nonce' })
      await promptReceipt.promise
    })

    await waitFor(() => expect(screen.queryByTestId('chat-working')).toBeNull())
    await screen.findByRole('button', { name: 'Submit' })
    expect(textarea.value).toBe('')
  })

  test('keeps session working badge signal when a streaming panel unmounts', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle' }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    const statusEvents: Array<{ sessionId?: string; working?: boolean }> = []
    const onStatus = (event: Event) => {
      statusEvents.push((event as CustomEvent).detail ?? {})
    }
    window.addEventListener('boring:chat-session-status', onStatus)
    const { unmount } = render(<PiChatPanel serverResourcesEnabled={false} storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    await screen.findByText('committed from /state')
    act(() => {
      remote.setState({ ...remote.state, status: 'streaming' })
    })
    await screen.findByTestId('chat-working')
    unmount()
    window.removeEventListener('boring:chat-session-status', onStatus)

    expect(statusEvents).toContainEqual({ sessionId: 'pi-1', working: true })
    expect(statusEvents.at(-1)).toEqual({ sessionId: 'pi-1', working: true })
  })

  test('keeps the working indicator slot mounted across stream start and finish', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle' }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    await screen.findByText('committed from /state')
    const slot = document.querySelector('[data-boring-agent-part="chat-working-slot"]')
    expect(slot).toBeTruthy()
    expect(slot?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByTestId('chat-working')).toBeNull()

    act(() => {
      remote.setState({ ...remote.state, status: 'streaming' })
    })

    await screen.findByTestId('chat-working')
    expect(screen.queryByRole('progressbar', { name: 'Agent working' })).toBeNull()
    expect(document.querySelector('[data-boring-agent-part="chat-working-slot"]')).toBe(slot)
    expect(slot?.getAttribute('aria-hidden')).toBe('false')

    act(() => {
      remote.setState({ ...remote.state, status: 'idle' })
    })

    await waitFor(() => expect(screen.queryByTestId('chat-working')).toBeNull())
    expect(document.querySelector('[data-boring-agent-part="chat-working-slot"]')).toBe(slot)
    expect(slot?.getAttribute('aria-hidden')).toBe('true')
  })

  test('surfaces a rejected run as one notice, re-appears after dismissal, and never reports a turn', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle' }))
    // A canonical, non-billing ErrorCode — the seam is generic; the host decides the action.
    remote.prompt.mockRejectedValue(Object.assign(new Error('Session is locked.'), { errorCode: 'SESSION_LOCKED' }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    const onTurnComplete = vi.fn()
    const renderNoticeAction = vi.fn((notice: { errorCode?: string }) =>
      notice.errorCode === 'SESSION_LOCKED' ? <button type="button">Resolve</button> : null,
    )
    render(
      <PiChatPanel
        serverResourcesEnabled={false}
        storageScope="scope-a"
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
        renderNoticeAction={renderNoticeAction}
        onTurnComplete={onTurnComplete}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'expensive prompt' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => expect(remote.prompt).toHaveBeenCalledTimes(1))
    // The rejection surfaces as a single run-rejected notice carrying the server code.
    const notice = await waitFor(() => {
      const el = document.querySelector('[data-runtime-notice-id="run-rejected"]')
      if (!el) throw new Error('run-rejected notice not yet rendered')
      return el
    })
    expect(notice.textContent).toContain('Session is locked.')
    expect(renderNoticeAction).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'SESSION_LOCKED' }))
    expect(within(notice as HTMLElement).getByRole('button', { name: 'Resolve' })).toBeTruthy()

    // Dismissing it must not suppress it permanently — a fresh rejection re-renders it.
    fireEvent.click(within(notice as HTMLElement).getByRole('button', { name: 'Dismiss notice' }))
    await waitFor(() => expect(document.querySelector('[data-runtime-notice-id="run-rejected"]')).toBeNull())

    fireEvent.change(textarea, { target: { value: 'try again' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() => expect(remote.prompt).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(document.querySelector('[data-runtime-notice-id="run-rejected"]')).toBeTruthy())

    // A rejected send never admits a server turn, so it must not report one.
    expect(onTurnComplete).not.toHaveBeenCalled()
  })

  test('reports a hydrated assistant reply once for an external session', async () => {
    const remote = new FakeRemotePiSession(remoteState({ hydrated: false }))
    const onHydratedAssistantReply = vi.fn()
    render(<PiChatPanel sessionId="pi-1" serverResourcesEnabled={false} storageScope="scope-a" createRemoteSession={remoteFactory(remote)} onHydratedAssistantReply={onHydratedAssistantReply} />)

    act(() => remote.setState({
      ...remote.state,
      hydrated: true,
      committedMessages: [
        ...remote.state.committedMessages,
        { id: 'a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'a1:text', text: 'hydrated reply' }] },
      ],
    }))
    await waitFor(() => expect(onHydratedAssistantReply).toHaveBeenCalledExactlyOnceWith('pi-1'))

    act(() => remote.setState({ ...remote.state, committedMessages: [...remote.state.committedMessages] }))
    expect(onHydratedAssistantReply).toHaveBeenCalledOnce()
  })

  test('fires onTurnComplete per turn-settle event, including back-to-back queued turns', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle' }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    const onTurnComplete = vi.fn()
    render(
      <PiChatPanel
        serverResourcesEnabled={false}
        storageScope="scope-a"
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
        onTurnComplete={onTurnComplete}
      />,
    )

    await screen.findByText('committed from /state')
    expect(onTurnComplete).not.toHaveBeenCalled()

    // Non-settle events don't trigger it.
    act(() => { remote.emit({ type: 'agent-start', seq: 8, turnId: 't1' }) })
    expect(onTurnComplete).not.toHaveBeenCalled()

    // A non-terminal (auto-retry) end must NOT count as a settle.
    act(() => { remote.emit({ type: 'agent-end', seq: 9, turnId: 't1', status: 'error', willRetry: true }) })
    expect(onTurnComplete).not.toHaveBeenCalled()

    // Each TERMINAL agent-end is one settled turn — fires once each, even back-to-back
    // (no reliance on a rendered streaming→idle→streaming flicker the store may coalesce).
    act(() => { remote.emit({ type: 'agent-end', seq: 10, turnId: 't1', status: 'ok' }) })
    await waitFor(() => expect(onTurnComplete).toHaveBeenCalledTimes(1))
    act(() => { remote.emit({ type: 'agent-end', seq: 11, turnId: 't2', status: 'ok' }) })
    await waitFor(() => expect(onTurnComplete).toHaveBeenCalledTimes(2))
  })

  test('shows session controls by default for managed Pi sessions', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1', 'Default visible session')]))
    render(<PiChatPanel serverResourcesEnabled={false} storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    await screen.findByText('Default visible session')
    expect(screen.getByRole('button', { name: 'New session' })).toBeTruthy()
  })

  test('auto-creates only one session while the empty-list create is in flight', async () => {
    const createSessionResponse = deferred<Response>()
    const modelsResponse = deferred<Response>()
    const skillsResponse = deferred<Response>()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/api/v1/agent/pi-chat/sessions') && method === 'GET') return jsonResponse([])
      if (url.endsWith('/api/v1/agent/pi-chat/sessions') && method === 'POST') return createSessionResponse.promise
      if (url.endsWith('/api/v1/agent/models')) return modelsResponse.promise
      if (url.includes('/api/v1/agent/commands')) return skillsResponse.promise
      throw new Error(`unexpected fetch ${url}`)
    })

    render(<PiChatPanel storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} />)

    const createCalls = () => fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/api/v1/agent/pi-chat/sessions') && call[1]?.method === 'POST')
    await waitFor(() => expect(createCalls()).toHaveLength(1))

    await act(async () => {
      modelsResponse.resolve(jsonResponse({ models: [] }))
      skillsResponse.resolve(jsonResponse({ commands: [] }))
      await Promise.resolve()
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/agent/models', expect.anything()))
    expect(createCalls()).toHaveLength(1)

    await act(async () => {
      createSessionResponse.resolve(jsonResponse(session('pi-created', 'Auto created'), 201))
      await createSessionResponse.promise
    })
  })

  test('routes model and skill discovery through apiBaseUrl with scoped headers', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://agent.test/api/v1/agent/pi-chat/sessions') return jsonResponse([])
      if (url === 'https://agent.test/api/v1/agent/models') return jsonResponse({ models: [] })
      if (url.startsWith('https://agent.test/api/v1/agent/commands')) return jsonResponse({ commands: [] })
      throw new Error(`unexpected fetch ${url}`)
    })

    render(
      <PiChatPanel
        apiBaseUrl="https://agent.test/"
        storageScope="workspace-a"
        requestHeaders={{ Authorization: 'Bearer agent' }}
        fetch={fetchMock as unknown as typeof fetch}
      />,
    )

    await waitFor(() => {
      expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual(expect.arrayContaining([
        'https://agent.test/api/v1/agent/pi-chat/sessions',
        'https://agent.test/api/v1/agent/models',
        expect.stringContaining('https://agent.test/api/v1/agent/commands'),
      ]))
    })
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        headers: expect.objectContaining({
          Authorization: 'Bearer agent',
          'x-boring-storage-scope': 'workspace-a',
        }),
      })
    }
  })

  test('disables the submit control while sessions are hydrating', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
    const createRemoteSession = remoteFactory(new FakeRemotePiSession(remoteState()))

    render(<PiChatPanel serverResourcesEnabled={false} fetch={fetchMock as unknown as typeof fetch} createRemoteSession={createRemoteSession} />)

    const stop = await screen.findByRole('button', { name: 'Stop' })
    expect((stop as HTMLButtonElement).disabled).toBe(true)
  })

  test('shows loading instead of empty suggestions while the selected session state is pending', async () => {
    const remote = new FakeRemotePiSession(remoteState({ committedMessages: [], sessionId: 'pi-1' }))
    const createRemoteSession = vi.fn(() => remote as unknown as RemotePiSession)
    const { rerender } = render(
      <PiChatPanel
        sessionId="pi-1"
        serverResourcesEnabled={false}
        storageScope="scope-a"
        createRemoteSession={createRemoteSession}
      />,
    )

    await screen.findByText('What are we building?')

    rerender(
      <PiChatPanel
        sessionId="pi-2"
        serverResourcesEnabled={false}
        storageScope="scope-a"
        createRemoteSession={createRemoteSession}
      />,
    )

    expect(screen.getByText(/Loading chat history/)).toBeTruthy()
    expect(screen.queryByText('What are we building?')).toBeNull()
  })

  test('shows loading instead of empty suggestions before selected session state is available', async () => {
    const remote = {
      dispose: vi.fn(),
      getState: vi.fn(() => undefined),
      subscribe: vi.fn(() => () => {}),
    } as unknown as RemotePiSession
    const createRemoteSession = vi.fn(() => remote)

    render(
      <PiChatPanel
        sessionId="pi-1"
        serverResourcesEnabled={false}
        storageScope="scope-a"
        createRemoteSession={createRemoteSession}
      />,
    )

    expect(await screen.findByText(/Loading chat history/)).toBeTruthy()
    expect(screen.queryByText('What are we building?')).toBeNull()
  })

  test('uses explicit external ephemeral metadata instead of local-* IDs', async () => {
    const createRemoteSession = vi.fn((options: RemotePiSessionOptions) => (
      new FakeRemotePiSession(remoteState({ sessionId: options.sessionId })) as unknown as RemotePiSession
    ))
    const { rerender } = render(
      <PiChatPanel
        sessionId="local-work"
        nativeSessionStartEnabled
        serverResourcesEnabled={false}
        storageScope="scope-a"
        createRemoteSession={createRemoteSession}
      />,
    )

    await waitFor(() => expect(createRemoteSession).toHaveBeenCalledTimes(1))
    expect(createRemoteSession.mock.calls[0]?.[0].nativeFirstPrompt).toBeUndefined()

    rerender(
      <PiChatPanel
        sessionId="browser-draft"
        sessionEphemeral
        nativeSessionStartEnabled
        serverResourcesEnabled={false}
        storageScope="scope-a"
        createRemoteSession={createRemoteSession}
      />,
    )

    await waitFor(() => expect(createRemoteSession).toHaveBeenCalledTimes(2))
    expect(createRemoteSession.mock.calls[1]?.[0]).toMatchObject({ sessionId: 'browser-draft', autoStart: false })
    expect(createRemoteSession.mock.calls[1]?.[0].nativeFirstPrompt).toBeDefined()
  })

  test('keeps an external Pi session stable when equal request headers are recreated', async () => {
    const remote = new FakeRemotePiSession(remoteState({ sessionId: 'pi-1' }))
    const createRemoteSession = remoteFactory(remote)
    const { rerender } = render(
      <PiChatPanel
        sessionId="pi-1"
        serverResourcesEnabled={false}
        storageScope="scope-a"
        requestHeaders={{ Authorization: 'Bearer agent' }}
        createRemoteSession={createRemoteSession}
      />,
    )

    await waitFor(() => expect(createRemoteSession).toHaveBeenCalledTimes(1))

    rerender(
      <PiChatPanel
        sessionId="pi-1"
        serverResourcesEnabled={false}
        storageScope="scope-a"
        requestHeaders={{ Authorization: 'Bearer agent' }}
        createRemoteSession={createRemoteSession}
      />,
    )
    await act(async () => { await Promise.resolve() })

    expect(createRemoteSession).toHaveBeenCalledTimes(1)
    expect(remote.dispose).not.toHaveBeenCalled()
    expect(createRemoteSession).toHaveBeenCalledWith(expect.objectContaining({
      headers: { Authorization: 'Bearer agent' },
      sessionId: 'pi-1',
    }))
  })

  test('sends first prompts, queues busy follow-ups, edits queued text, and exposes stop/interrupt', async () => {
    const remote = new FakeRemotePiSession(remoteState({
      status: 'streaming',
      queue: { followUps: [{ id: 'q1', kind: 'followup', displayText: 'queued from server', clientSeq: 4 }] },
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    const textarea = await screen.findByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: 'next while busy' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => expect(remote.followUp).toHaveBeenCalledWith(expect.objectContaining({ message: 'next while busy', clientSeq: 5 })))
    act(() => {
      remote.setState({ ...remote.state, connection: { state: 'connected', lastHeartbeatAt: 123 } })
    })
    fireEvent.change(textarea, { target: { value: 'second while busy' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() => expect(remote.followUp).toHaveBeenCalledWith(expect.objectContaining({ message: 'second while busy', clientSeq: 6 })))
    expect(remote.prompt).not.toHaveBeenCalled()

    const editQueued = screen.getByRole('button', { name: 'Edit queued follow-ups' })
    expect(editQueued.textContent).not.toContain('Edit queued')
    fireEvent.click(editQueued)
    await waitFor(() => expect(remote.clearQueue).toHaveBeenCalledTimes(1))
    expect((textarea as HTMLTextAreaElement).value).toContain('queued from server')

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    fireEvent.keyDown(textarea, { key: 'Escape' })
    await waitFor(() => expect(remote.stop).toHaveBeenCalledTimes(1))
    expect(remote.interrupt).toHaveBeenCalledTimes(1)
  })

  test('dismisses composer pickers with Escape before interrupting a streaming turn', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'streaming' }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    const textarea = await screen.findByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: '/' } })
    await screen.findByRole('listbox', { name: 'Commands' })

    fireEvent.keyDown(textarea, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Commands' })).toBeNull())
    expect(remote.interrupt).not.toHaveBeenCalled()

    fireEvent.keyDown(textarea, { key: 'Escape' })
    await waitFor(() => expect(remote.interrupt).toHaveBeenCalledTimes(1))
  })

  test('rejects attachments that would exceed the Pi prompt body budget', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    const textarea = await screen.findByLabelText('Agent prompt')
    const oversizedFile = new File([new Uint8Array((4 * 1024 * 1024) + 1)], 'large.txt', { type: 'text/plain' })
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => oversizedFile }],
      },
    })

    await screen.findByText('Files must be under 4 MB each.')
    expect(remote.prompt).not.toHaveBeenCalled()
  })

  test('disables attachments while composer blockers are active', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle' }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(
      <PiChatPanel
        serverResourcesEnabled={false}
        storageScope="scope-a"
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
        composerBlockers={[{ id: 'select-file', reason: 'Select a file before chatting' }]}
      />,
    )

    const attach = await screen.findByRole('button', { name: 'Attach files' })
    expect((attach as HTMLButtonElement).disabled).toBe(true)
    expect(attach.getAttribute('title')).toBe('Attachments are available when the composer is ready.')
  })

  test('keeps attachment chips in their own composer row', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle' }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    const textarea = await screen.findByLabelText('Agent prompt')
    await waitFor(() => expect((textarea as HTMLTextAreaElement).disabled).toBe(false))
    const file = new File(['png'], 'image.png', { type: 'image/png' })
    const paste = createEvent.paste(textarea)
    Object.defineProperty(paste, 'clipboardData', {
      value: { items: [{ kind: 'file', getAsFile: () => file }] },
    })
    fireEvent(textarea, paste)

    const attachmentRow = (await screen.findByText('image.png')).closest('[data-boring-agent-part="composer-attachment-row"]')
    const inputRow = textarea.closest('[data-boring-agent-part="composer-input-row"]')
    expect(attachmentRow).toBeTruthy()
    expect(inputRow).toBeTruthy()
    expect(inputRow?.contains(attachmentRow)).toBe(false)
  })

  test('renders server queued follow-ups only in the composer banner', async () => {
    const remote = new FakeRemotePiSession(remoteState({
      status: 'streaming',
      queue: { followUps: [{ id: 'q1', kind: 'followup', displayText: 'queued from server', clientNonce: 'queued-nonce', clientSeq: 4 }] },
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    await screen.findByText('queued from server')
    expect(screen.getByText('1 queued follow-up').closest('[data-boring-agent-part="composer-queue-preview"]')).toBeTruthy()
    expect(document.querySelector('[data-boring-agent-message-id^="queue:"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete queued message' })).toBeNull()
  })

  test('renders optimistic queued follow-ups in the composer banner before server queue metadata arrives', async () => {
    const remote = new FakeRemotePiSession(remoteState({
      status: 'streaming',
      optimisticOutbox: {
        'queued-nonce': {
          id: 'optimistic:queued-nonce',
          role: 'user',
          status: 'pending',
          clientNonce: 'queued-nonce',
          clientSeq: 4,
          parts: [{ type: 'text', id: 'optimistic:queued-nonce:text', text: 'queued before server event' }],
        },
      },
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    await screen.findByText('queued before server event')
    expect(screen.getByText('queued before server event').closest('[data-boring-agent-part="composer-queue-preview"]')).toBeTruthy()
    expect(screen.queryByText('Waiting…')).toBeNull()
    expect(document.querySelector('[data-boring-agent-message-id="optimistic:queued-nonce"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete queued message' })).toBeNull()
  })

  test('does not render metadata-free queued follow-ups as transcript messages', async () => {
    const remote = new FakeRemotePiSession(remoteState({
      status: 'streaming',
      optimisticOutbox: {
        'nonce-1': {
          id: 'optimistic:nonce-1',
          role: 'user',
          status: 'pending',
          clientNonce: 'nonce-1',
          clientSeq: 1,
          parts: [{ type: 'text', id: 'optimistic:nonce-1:text', text: 'same queued text' }],
        },
        'nonce-2': {
          id: 'optimistic:nonce-2',
          role: 'user',
          status: 'pending',
          clientNonce: 'nonce-2',
          clientSeq: 2,
          parts: [{ type: 'text', id: 'optimistic:nonce-2:text', text: 'same queued text' }],
        },
      },
      queue: {
        followUps: [
          { id: 'q1', kind: 'followup', displayText: 'same queued text' },
          { id: 'q2', kind: 'followup', displayText: 'same queued text' },
        ],
      },
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    await screen.findByText('2 queued follow-ups')
    expect(document.querySelectorAll('[data-boring-agent-part="message"]')).toHaveLength(1)
    expect(document.querySelector('[data-boring-agent-message-id^="queue:"]')).toBeNull()
  })

  test('does not duplicate seq-only queued follow-ups in the composer banner', async () => {
    const remote = new FakeRemotePiSession(remoteState({
      status: 'streaming',
      optimisticOutbox: {
        'nonce-1': {
          id: 'optimistic:nonce-1',
          role: 'user',
          status: 'pending',
          clientNonce: 'nonce-1',
          clientSeq: 1,
          parts: [{ type: 'text', id: 'optimistic:nonce-1:text', text: 'seq-only queued text' }],
        },
      },
      queue: {
        followUps: [
          { id: 'q1', kind: 'followup', displayText: 'seq-only queued text', clientSeq: 1 },
        ],
      },
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    await screen.findByText('1 queued follow-up')
    const preview = screen.getByText('seq-only queued text').closest('[data-boring-agent-part="composer-queue-preview"]')
    expect(preview).toBeTruthy()
    expect(document.querySelectorAll('[data-boring-agent-part="message"]')).toHaveLength(1)
  })

  test('does not hide nonce-backed queued follow-ups when clientSeq collides with an existing user message', async () => {
    const remote = new FakeRemotePiSession(remoteState({
      committedMessages: [
        {
          id: 'consumed-followup',
          role: 'user',
          status: 'done',
          clientNonce: 'old-nonce',
          clientSeq: 1,
          parts: [{ type: 'text', id: 'consumed-followup:text', text: 'already sent' }],
        },
      ],
      queue: {
        followUps: [
          { id: 'q-new', kind: 'followup', displayText: 'new queued text', clientNonce: 'new-nonce', clientSeq: 1 },
        ],
      },
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    await screen.findByText('new queued text')
    expect(screen.getByText('new queued text').closest('[data-boring-agent-part="composer-queue-preview"]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete queued message' })).toBeNull()
  })

  test('keeps selector-backed queued follow-ups stable in the composer banner when server queue ids reindex', async () => {
    const remote = new FakeRemotePiSession(remoteState({
      status: 'streaming',
      queue: {
        followUps: [
          { id: 'queue:pi-1:followup:0:first', kind: 'followup', displayText: 'first queued', clientSeq: 1 },
          { id: 'queue:pi-1:followup:1:second', kind: 'followup', displayText: 'second queued', clientSeq: 2 },
        ],
      },
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    await screen.findByText(/first queued - second queued/)

    act(() => {
      remote.setState({
        ...remote.state,
        queue: {
          followUps: [
            { id: 'queue:pi-1:followup:0:second', kind: 'followup', displayText: 'second queued', clientSeq: 2 },
          ],
        },
      })
    })

    await screen.findByText('second queued')
    expect(document.querySelector('[data-boring-agent-message-id^="queue:"]')).toBeNull()
  })

  test('preserves system message role without assistant actions', async () => {
    const remote = new FakeRemotePiSession(remoteState({
      committedMessages: [
        { id: 'sys1', role: 'system', status: 'done', parts: [{ type: 'text', id: 'sys1:text', text: 'System notice' }] },
      ],
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    await screen.findByText('System notice')
    expect(document.querySelector('[data-boring-agent-message-id="sys1"]')?.getAttribute('data-boring-agent-message-role')).toBe('system')
    expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull()
  })

  test('does not expose regenerate without a canonical Pi regenerate endpoint', async () => {
    const remote = new FakeRemotePiSession(remoteState({
      committedMessages: [
        { id: 'u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'u1:text', text: 'please try this again' }] },
        { id: 'a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'a1:text', text: 'first answer' }] },
      ],
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    await screen.findByText('first answer')
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull()
    expect(remote.prompt).not.toHaveBeenCalled()
  })

  test('loads model, thinking, and thought visibility from scoped composer storage', async () => {
    const persisted = storage({
      [scopedComposerStorageKey('workspace-a', 'model')]: JSON.stringify({ provider: 'anthropic', id: 'claude-sonnet' }),
      [scopedComposerStorageKey('workspace-a', 'model:user-selected')]: '1',
      [scopedComposerStorageKey('workspace-a', 'thinking')]: 'high',
      [scopedComposerStorageKey('workspace-a', 'show-thoughts')]: '1',
    })
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))

    render(
      <PiChatPanel
        serverResourcesEnabled={false}
        thinkingControl
        storageScope="workspace-a"
        storage={persisted}
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    expect(screen.getByLabelText('Thinking level: High')).toBeTruthy()

    fireEvent.change(textarea, { target: { value: 'stored settings prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({
      message: 'stored settings prompt',
      model: { provider: 'anthropic', id: 'claude-sonnet' },
      thinkingLevel: 'high',
    })))
  })

  test('opens model and thinking pickers from slash commands', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(
      <PiChatPanel
        serverResourcesEnabled={false}
        storageScope="scope-a"
        availableModels={[
          { provider: 'anthropic', id: 'claude-sonnet', label: 'Claude Sonnet', available: true },
          { provider: 'openai', id: 'gpt-5', label: 'GPT 5', available: true },
        ]}
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    expect(screen.getByRole('button', { name: /Current model:/ }).textContent).toContain('/model:')
    expect(screen.getByRole('button', { name: 'Thinking level: Med' }).textContent).toContain('/thinking:')

    fireEvent.change(textarea, { target: { value: '/mod' } })
    let commands = await screen.findByRole('listbox', { name: 'Commands' })
    fireEvent.mouseDown(within(commands).getByText('/model'))
    await screen.findByText('Claude Sonnet')
    let picker = document.querySelector('[data-boring-agent-part="model-picker-menu"]')
    expect(picker?.className).toContain('bg-[color:var(--popover)]')
    expect(picker?.closest('[data-slot="popover-content"]')).toBeNull()
    expect((textarea as HTMLTextAreaElement).value).toBe('')
    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    expect(document.querySelector('[data-boring-agent-part="model-picker-menu"]')).not.toBeNull()
    expect((textarea as HTMLTextAreaElement).value).toBe('')
    const modelTrigger = screen.getByRole('button', { name: /Current model:/ })
    fireEvent.mouseDown(modelTrigger)
    fireEvent.click(modelTrigger)
    await waitFor(() => expect(document.querySelector('[data-boring-agent-part="model-picker-menu"]')).toBeNull())

    fireEvent.change(textarea, { target: { value: '/mod' } })
    commands = await screen.findByRole('listbox', { name: 'Commands' })
    fireEvent.mouseDown(within(commands).getByText('/model'))
    await screen.findByText('Claude Sonnet')
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(document.querySelector('[data-boring-agent-part="model-picker-menu"]')).toBeNull())

    fireEvent.change(textarea, { target: { value: '/mod' } })
    commands = await screen.findByRole('listbox', { name: 'Commands' })
    fireEvent.mouseDown(within(commands).getByText('/model'))
    await screen.findByText('Claude Sonnet')
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('button', { name: /Current model:/ }).textContent).toContain('Claude Sonnet'))

    fireEvent.change(textarea, { target: { value: '/thinking' } })
    commands = await screen.findByRole('listbox', { name: 'Commands' })
    fireEvent.mouseDown(within(commands).getByText('/thinking'))
    await screen.findByText('Deep reasoning')
    picker = document.querySelector('[data-boring-agent-part="thinking-picker-menu"]')
    expect(picker?.className).toContain('bg-[color:var(--popover)]')
    expect(picker?.closest('[data-slot="popover-content"]')).toBeNull()
    const thinkingTrigger = screen.getByRole('button', { name: 'Thinking level: Med' })
    fireEvent.mouseDown(thinkingTrigger)
    fireEvent.click(thinkingTrigger)
    await waitFor(() => expect(document.querySelector('[data-boring-agent-part="thinking-picker-menu"]')).toBeNull())

    fireEvent.change(textarea, { target: { value: '/thinking' } })
    commands = await screen.findByRole('listbox', { name: 'Commands' })
    fireEvent.mouseDown(within(commands).getByText('/thinking'))
    await screen.findByText('Deep reasoning')
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(document.querySelector('[data-boring-agent-part="thinking-picker-menu"]')).toBeNull())

    fireEvent.change(textarea, { target: { value: '/thinking' } })
    commands = await screen.findByRole('listbox', { name: 'Commands' })
    fireEvent.mouseDown(within(commands).getByText('/thinking'))
    await screen.findByText('Deep reasoning')
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Thinking level: High' })).toBeTruthy())
  })

  test('excludes requested built-in slash commands', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(
      <PiChatPanel
        serverResourcesEnabled={false}
        storageScope="scope-a"
        excludeBuiltinCommands={["model"]}
        availableModels={[
          { provider: 'anthropic', id: 'claude-sonnet', label: 'Claude Sonnet', available: true },
        ]}
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: '/mod' } })

    await waitFor(() => expect(screen.queryByText('/model')).toBeNull())
    expect(screen.queryByRole('listbox', { name: 'Commands' })).toBeNull()
  })

  test('preserves slash draft when requested picker is disabled while streaming', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'streaming' }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    const onComposerWarning = vi.fn()
    render(
      <PiChatPanel
        serverResourcesEnabled={false}
        storageScope="scope-a"
        availableModels={[
          { provider: 'anthropic', id: 'claude-sonnet', label: 'Claude Sonnet', available: true },
        ]}
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
        onComposerWarning={onComposerWarning}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: '/mod' } })
    const commands = await screen.findByRole('listbox', { name: 'Commands' })
    fireEvent.mouseDown(within(commands).getByText('/model'))

    expect((textarea as HTMLTextAreaElement).value).toBe('/mod')
    expect(document.querySelector('[data-boring-agent-part="model-picker-menu"]')).toBeNull()
    expect(onComposerWarning).toHaveBeenCalledWith('Model picker is unavailable while the agent is running.')
  })

  test('preserves keyboard slash draft when requested picker is host-controlled', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    const onComposerWarning = vi.fn()
    render(
      <PiChatPanel
        serverResourcesEnabled={false}
        storageScope="scope-a"
        model={{ provider: 'openai', id: 'gpt-5' }}
        availableModels={[
          { provider: 'openai', id: 'gpt-5', label: 'GPT 5', available: true },
        ]}
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
        onComposerWarning={onComposerWarning}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: '/model' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(onComposerWarning).toHaveBeenCalledWith('Model selection is controlled by the host.'))
    expect((textarea as HTMLTextAreaElement).value).toBe('/model')
    expect(remote.prompt).not.toHaveBeenCalled()
  })

  test('does not swallow submit clicks when an outside click closes the model picker', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(
      <PiChatPanel
        serverResourcesEnabled={false}
        storageScope="scope-a"
        availableModels={[
          { provider: 'anthropic', id: 'claude-sonnet', label: 'Claude Sonnet', available: true },
        ]}
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: 'submit while menu is open' } })
    fireEvent.click(screen.getByRole('button', { name: /Current model:/ }))
    await waitFor(() => expect(document.querySelector('[data-boring-agent-part="model-picker-menu"]')).not.toBeNull())

    const submit = screen.getByRole('button', { name: 'Submit' })
    fireEvent.mouseDown(submit)
    fireEvent.click(submit)

    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({
      message: 'submit while menu is open',
    })))
    expect(document.querySelector('[data-boring-agent-part="model-picker-menu"]')).toBeNull()
  })

  test('keeps controlled null model as Pi default in submitted prompt payload', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(
      <PiChatPanel
        serverResourcesEnabled={false}
        storageScope="scope-a"
        model={null}
        defaultModel={{ provider: 'openai', id: 'gpt-5' }}
        availableModels={[
          { provider: 'openai', id: 'gpt-5', label: 'GPT 5', available: true },
        ]}
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: 'use pi default model' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(remote.prompt).toHaveBeenCalled())
    const [[payload]] = remote.prompt.mock.calls as unknown as Array<[{ message?: string; model?: unknown }]>
    expect(payload).toMatchObject({ message: 'use pi default model' })
    expect(payload?.model).toBeUndefined()
  })

  test('reports invalid slash setting arguments without sending a prompt', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(
      <PiChatPanel
        serverResourcesEnabled={false}
        storageScope="scope-a"
        availableModels={[
          { provider: 'anthropic', id: 'claude-sonnet', label: 'Claude Sonnet', available: true },
        ]}
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: '/model nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await screen.findByText('No model matched "nope".')

    fireEvent.change(textarea, { target: { value: '/thinking extreme' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await screen.findByText('No thinking level matched "extreme".')

    expect(remote.prompt).not.toHaveBeenCalled()
  })

  test('does not write previous composer settings into a newly selected storage scope', async () => {
    const persisted = storage({
      [scopedComposerStorageKey('workspace-a', 'thinking')]: 'high',
      [scopedComposerStorageKey('workspace-a', 'show-thoughts')]: '1',
      [scopedComposerStorageKey('workspace-b', 'thinking')]: 'low',
      [scopedComposerStorageKey('workspace-b', 'show-thoughts')]: '0',
    })
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))

    const { rerender } = render(
      <PiChatPanel
        serverResourcesEnabled={false}
        thinkingControl
        storageScope="workspace-a"
        storage={persisted}
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
      />,
    )

    await screen.findByLabelText('Thinking level: High')

    rerender(
      <PiChatPanel
        serverResourcesEnabled={false}
        thinkingControl
        storageScope="workspace-b"
        storage={persisted}
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
      />,
    )

    await screen.findByLabelText('Thinking level: Low')
    expect(persisted.values.get(scopedComposerStorageKey('workspace-b', 'thinking'))).toBe('low')
    expect(persisted.values.get(scopedComposerStorageKey('workspace-b', 'show-thoughts'))).toBe('0')
  })

  test('submits controlled thinkingLevel even when the thinking controls are hidden', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))

    render(
      <PiChatPanel
        serverResourcesEnabled={false}
        thinkingLevel="high"
        thinkingControl={false}
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    expect(screen.queryByLabelText('Thinking level: High')).toBeNull()

    fireEvent.change(textarea, { target: { value: 'controlled thinking prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({
      message: 'controlled thinking prompt',
      thinkingLevel: 'high',
    })))
  })

  test('disables remote auto-start when hydrateMessages is false', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const createRemoteSession = remoteFactory(remote)

    render(
      <PiChatPanel
        sessionId="pi-external"
        hydrateMessages={false}
        serverResourcesEnabled={false}
        storageScope="scope-a"
        createRemoteSession={createRemoteSession}
      />,
    )

    await waitFor(() => expect(createRemoteSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'pi-external',
      autoStart: false,
    })))
  })

  test('settles auto-submit even when the prompt resolves after the turn is already idle', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle' }))
    const onAccepted = vi.fn()
    const onSettled = vi.fn()

    render(
      <PiChatPanel
        sessionId="pi-external"
        hydrateMessages={false}
        serverResourcesEnabled={false}
        storageScope="scope-a"
        initialDraft="auto prompt"
        autoSubmitInitialDraft
        createRemoteSession={remoteFactory(remote)}
        onAutoSubmitInitialDraftAccepted={onAccepted}
        onAutoSubmitInitialDraftSettled={onSettled}
      />,
    )

    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({ message: 'auto prompt' })))
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1))
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  test('does not settle auto-submit before the prompt receipt is accepted', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle' }))
    let resolvePrompt!: (value: { accepted: true; cursor: number; clientNonce: string }) => void
    const promptReceipt = new Promise<{ accepted: true; cursor: number; clientNonce: string }>((resolve) => {
      resolvePrompt = resolve
    })
    remote.prompt.mockImplementationOnce(async () => promptReceipt)
    const onAccepted = vi.fn()
    const onSettled = vi.fn()

    render(
      <PiChatPanel
        sessionId="pi-external"
        hydrateMessages={false}
        serverResourcesEnabled={false}
        storageScope="scope-a"
        initialDraft="auto prompt"
        autoSubmitInitialDraft
        createRemoteSession={remoteFactory(remote)}
        onAutoSubmitInitialDraftAccepted={onAccepted}
        onAutoSubmitInitialDraftSettled={onSettled}
      />,
    )

    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({ message: 'auto prompt' })))
    const textarea = await screen.findByLabelText('Agent prompt') as HTMLTextAreaElement
    expect(textarea.value).toBe('')
    act(() => {
      remote.setState({ ...remote.state, status: 'streaming' })
    })
    act(() => {
      remote.setState({ ...remote.state, status: 'idle' })
    })
    expect(onAccepted).not.toHaveBeenCalled()
    expect(onSettled).not.toHaveBeenCalled()

    await act(async () => {
      resolvePrompt({ accepted: true, cursor: 8, clientNonce: 'nonce' })
      await promptReceipt
    })

    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1))
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  test('settles auto-submit when the prompt rejects', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle' }))
    remote.prompt.mockRejectedValueOnce(new Error('network down'))
    const onAccepted = vi.fn()
    const onSettled = vi.fn()

    render(
      <PiChatPanel
        sessionId="pi-external"
        hydrateMessages={false}
        serverResourcesEnabled={false}
        storageScope="scope-a"
        initialDraft="auto prompt"
        autoSubmitInitialDraft
        createRemoteSession={remoteFactory(remote)}
        onAutoSubmitInitialDraftAccepted={onAccepted}
        onAutoSubmitInitialDraftSettled={onSettled}
      />,
    )

    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({ message: 'auto prompt' })))
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1))
    expect(onAccepted).not.toHaveBeenCalled()
    expect(await screen.findByText('network down')).toBeTruthy()
    expect((screen.getByLabelText('Agent prompt') as HTMLTextAreaElement).value).toBe('auto prompt')
  })

  test('does not consume auto-submit while composer blockers are active', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle' }))
    const createRemoteSession = remoteFactory(remote)
    const { rerender } = render(
      <PiChatPanel
        sessionId="pi-external"
        hydrateMessages={false}
        serverResourcesEnabled={false}
        storageScope="scope-a"
        initialDraft="blocked auto prompt"
        autoSubmitInitialDraft
        composerBlockers={[{ id: 'warmup', label: 'Preparing workspace' }]}
        createRemoteSession={createRemoteSession}
      />,
    )

    await waitFor(() => expect(createRemoteSession).toHaveBeenCalled())
    expect(remote.prompt).not.toHaveBeenCalled()

    rerender(
      <PiChatPanel
        sessionId="pi-external"
        hydrateMessages={false}
        serverResourcesEnabled={false}
        storageScope="scope-a"
        initialDraft="blocked auto prompt"
        autoSubmitInitialDraft
        composerBlockers={[]}
        createRemoteSession={createRemoteSession}
      />,
    )

    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({ message: 'blocked auto prompt' })))
  })

  test('uses composer blocker reason when label is absent', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle' }))
    render(
      <PiChatPanel
        sessionId="pi-external"
        hydrateMessages={false}
        serverResourcesEnabled={false}
        storageScope="scope-a"
        composerBlockers={[{ id: 'select-file', reason: 'Select a file before chatting' }]}
        createRemoteSession={remoteFactory(remote)}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    // The blocker text is shown once, in the actionable blocker bar — not also
    // echoed into the input placeholder (which would duplicate the same line).
    expect(textarea.getAttribute('placeholder')).toBe('')
    expect(screen.getAllByText('Select a file before chatting').length).toBe(1)
  })

  test('renders open and cancel composer blocker actions as accessible icon buttons', async () => {
    const remote = new FakeRemotePiSession(remoteState({ status: 'idle' }))
    const onAction = vi.fn()
    render(
      <PiChatPanel
        sessionId="pi-external"
        hydrateMessages={false}
        serverResourcesEnabled={false}
        storageScope="scope-a"
        composerBlockers={[{
          id: 'ask-user:q1',
          label: 'Answer the question in Questions to continue',
          actions: [{ id: 'open', label: 'Open Questions' }, { id: 'cancel', label: 'Cancel question' }],
        }]}
        onComposerBlockerAction={onAction}
        createRemoteSession={remoteFactory(remote)}
      />,
    )

    await screen.findByText('Answer the question in Questions to continue')
    const open = screen.getByRole('button', { name: 'Open Questions' })
    const cancel = screen.getByRole('button', { name: 'Cancel question' })
    expect(screen.queryByText('Open Questions')).toBeNull()
    expect(screen.queryByText('Cancel question')).toBeNull()

    fireEvent.click(open)
    fireEvent.click(cancel)
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'ask-user:q1' }), 'open')
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'ask-user:q1' }), 'cancel')
  })

  test('/reset does not race empty-session auto-create into duplicate session creation', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const remote = new FakeRemotePiSession(remoteState())
    let serverSessions = [session('pi-1', 'Only session')]
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/api/v1/agent/pi-chat/sessions') && method === 'GET') return jsonResponse(serverSessions)
      if (url.endsWith('/api/v1/agent/pi-chat/sessions/pi-1') && method === 'DELETE') {
        serverSessions = []
        return new Response(null, { status: 204 })
      }
      if (url.endsWith('/api/v1/agent/pi-chat/sessions') && method === 'POST') {
        const created = session(`pi-new-${fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/api/v1/agent/pi-chat/sessions') && call[1]?.method === 'POST').length}`, 'Reset session')
        serverSessions = [created]
        return jsonResponse(created, 201)
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    render(<PiChatPanel serverResourcesEnabled={false} fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    const textarea = await screen.findByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: '/reset' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      const createCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/api/v1/agent/pi-chat/sessions') && call[1]?.method === 'POST')
      expect(createCalls).toHaveLength(1)
    })
    await act(async () => {})
    const createCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/api/v1/agent/pi-chat/sessions') && call[1]?.method === 'POST')
    expect(createCalls).toHaveLength(1)
  })

  test('keeps a collapsed reasoning affordance when thoughts are hidden', async () => {
    const remote = new FakeRemotePiSession(remoteState({
      committedMessages: [
        {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'reasoning', id: 'r1', text: 'hidden reasoning', state: 'done' },
            { type: 'text', id: 'a1:text', text: 'answer' },
          ],
        },
      ],
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel serverResourcesEnabled={false} fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    await screen.findByText('answer')
    expect(document.querySelectorAll('[data-boring-agent-part="message-reasoning"]')).toHaveLength(1)
    const reasoning = document.querySelector('[data-boring-agent-part="message-reasoning"]')
    expect(reasoning?.querySelector('button')?.textContent).toMatch(/thoughts/i)
    expect(reasoning?.getAttribute('data-state')).toBe('closed')

    fireEvent.click(reasoning!.querySelector('button')!)
    await waitFor(() => expect(reasoning?.getAttribute('data-state')).toBe('open'))
    expect(reasoning?.textContent).toContain('hidden reasoning')
  })

  test('opens completed reasoning when persisted thoughts visibility is on', async () => {
    const persisted = storage({
      [scopedComposerStorageKey('scope-a', 'show-thoughts')]: '1',
    })
    const remote = new FakeRemotePiSession(remoteState({
      committedMessages: [
        {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'reasoning', id: 'r1', text: 'visible reasoning', state: 'done' },
            { type: 'text', id: 'a1:text', text: 'answer' },
          ],
        },
      ],
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel storageScope="scope-a" storage={persisted} serverResourcesEnabled={false} fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    await screen.findByText('answer')
    const reasoning = document.querySelector('[data-boring-agent-part="message-reasoning"]')
    expect(reasoning?.getAttribute('data-state')).toBe('open')
    expect(reasoning?.textContent).toContain('visible reasoning')
    fireEvent.click(reasoning!.querySelector('button')!)
    await waitFor(() => expect(reasoning?.getAttribute('data-state')).toBe('closed'))
  })

  test('renders safe debug metadata, status announcements, and large-state warning without prompt bodies', async () => {
    const remote = new FakeRemotePiSession(remoteState({
      status: 'streaming',
      connection: { state: 'reconnecting', lastHeartbeatAt: 123 },
      committedMessages: [
        {
          id: 'u-secret',
          role: 'user',
          status: 'done',
          parts: [
            { type: 'text', id: 'secret:text', text: 'SECRET_PROMPT_BODY /home/ubuntu/project/file.txt' },
            {
              type: 'file',
              id: 'secret:file',
              filename: 'SECRET_ATTACHMENT_NAME.txt',
              mediaType: 'text/plain',
              url: 'https://uploads.example.test/file?token=SECRET_ATTACHMENT_TOKEN',
            },
          ],
        },
        {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'reasoning', id: 'a1:reasoning', text: 'SECRET_REASONING_TRACE /tmp/private-workspace', state: 'done' },
            { type: 'text', id: 'a1:text', text: 'visible answer' },
          ],
        },
      ],
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))

    render(<PiChatPanel debug serverResourcesEnabled={false} storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    await waitFor(() => expect(screen.getAllByText('visible answer').length).toBeGreaterThan(0))
    expect(screen.getByText(/Large chat state/)).toBeTruthy()
    const debugPanel = await screen.findByRole('region', { name: 'Chat debug metadata' })
    expect(debugPanel.textContent).toContain('pi-1')
    expect(debugPanel.textContent).toContain('Runtime session id')
    expect(debugPanel.textContent).not.toContain('SECRET_PROMPT_BODY')
    expect(debugPanel.textContent).not.toContain('/home/ubuntu/project/file.txt')
    expect(debugPanel.textContent).not.toContain('SECRET_ATTACHMENT_NAME')
    expect(debugPanel.textContent).not.toContain('SECRET_ATTACHMENT_TOKEN')
    expect(debugPanel.textContent).not.toContain('SECRET_REASONING_TRACE')
    expect(debugPanel.textContent).not.toContain('/tmp/private-workspace')
  })

  test('runs /reload through the injected plugin reload callback', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/v1/agent/pi-chat/sessions')) return jsonResponse([session('pi-1')])
      throw new Error(`unexpected fetch ${url}`)
    })
    const onReloadAgentPlugins = vi.fn(async () => ({
      message: 'Extensions reloaded.\n\nWarnings:\nplugin front failed once but recovered',
      reloaded: true,
    }))
    const onCommandResult = vi.fn()

    render(
      <PiChatPanel
        storageScope="workspace-a"
        serverResourcesEnabled={false}
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
        onReloadAgentPlugins={onReloadAgentPlugins}
        onCommandResult={onCommandResult}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: '/reload' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(onReloadAgentPlugins).toHaveBeenCalledTimes(1))
    expect(onCommandResult).toHaveBeenCalledWith(expect.stringContaining('Extensions reloaded.'))
    expect(onCommandResult).toHaveBeenCalledWith(expect.stringContaining('plugin front failed once but recovered'))
    expect(remote.prompt).not.toHaveBeenCalled()
  })

  test('refreshes server skill slash commands after plugin reload', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    let reloadTriggered = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const parsed = new URL(url, 'https://agent.test')
      if (parsed.pathname === '/api/v1/agent/pi-chat/sessions') return jsonResponse([session('pi-1')])
      if (parsed.pathname === '/api/v1/agent/commands') {
        return jsonResponse({
          commands: reloadTriggered
            ? [{ name: 'fresh-skill', description: 'Fresh plugin skill', source: 'skill' }]
            : [],
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    const onReloadAgentPlugins = vi.fn(async () => {
      reloadTriggered = true
      return 'Agent plugins reloaded.'
    })
    const onCommandResult = vi.fn()

    render(
      <PiChatPanel
        storageScope="workspace-a"
        availableModels={[]}
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
        onReloadAgentPlugins={onReloadAgentPlugins}
        onCommandResult={onCommandResult}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')

    fireEvent.change(textarea, { target: { value: '/reload' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    // onCommandResult fires AFTER runPluginUpdate completes (and after setServerSkillsRefreshKey)
    await waitFor(() => expect(onCommandResult).toHaveBeenCalledWith(expect.stringContaining('Agent plugins reloaded.')))

    fireEvent.change(textarea, { target: { value: '/' } })
    expect(await screen.findByText('/fresh-skill')).toBeTruthy()
    expect(await screen.findByText('Fresh plugin skill')).toBeTruthy()
  })

  test('reports unconfigured plugin reload as an error without refreshing server commands', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    let commandsRequestCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const parsed = new URL(url, 'https://agent.test')
      if (parsed.pathname === '/api/v1/agent/pi-chat/sessions') return jsonResponse([session('pi-1')])
      if (parsed.pathname === '/api/v1/agent/commands') {
        commandsRequestCount += 1
        return jsonResponse({ commands: [] })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    const onCommandResult = vi.fn()

    const { container } = render(
      <PiChatPanel
        storageScope="workspace-a"
        availableModels={[]}
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
        onCommandResult={onCommandResult}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    await waitFor(() => expect(commandsRequestCount).toBeGreaterThanOrEqual(1))
    const preReloadCount = commandsRequestCount

    fireEvent.change(textarea, { target: { value: '/reload' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(onCommandResult).toHaveBeenCalledWith('Extension update failed: Agent plugin reload is not configured.'))
    expect(commandsRequestCount).toBe(preReloadCount)
    expect(container.querySelector('[data-boring-plugin-update="error"]')).toBeTruthy()
    expect(container.querySelector('[data-boring-plugin-update="success"]')).toBeNull()
    expect(remote.prompt).not.toHaveBeenCalled()
  })

  test('reports unknown legacy plugin reload results as errors', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/v1/agent/pi-chat/sessions')) return jsonResponse([session('pi-1')])
      throw new Error(`unexpected fetch ${url}`)
    })
    const onReloadAgentPlugins = vi.fn(async () => 'Agent harness does not support reload')
    const onCommandResult = vi.fn()

    const { container } = render(
      <PiChatPanel
        storageScope="workspace-a"
        serverResourcesEnabled={false}
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
        onReloadAgentPlugins={onReloadAgentPlugins}
        onCommandResult={onCommandResult}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: '/reload' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(onCommandResult).toHaveBeenCalledWith('Extension update failed: Agent harness does not support reload'))
    expect(container.querySelector('[data-boring-plugin-update="error"]')).toBeTruthy()
    expect(container.querySelector('[data-boring-plugin-update="success"]')).toBeNull()
    expect(remote.prompt).not.toHaveBeenCalled()
  })

  test('hotReloadEnabled=false makes /reload fall through as a normal Pi prompt', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/v1/agent/pi-chat/sessions')) return jsonResponse([session('pi-1')])
      if (url.endsWith('/api/v1/agent/reload')) throw new Error('reload route should not be called')
      throw new Error(`unexpected fetch ${url}`)
    })

    render(
      <PiChatPanel
        hotReloadEnabled={false}
        serverResourcesEnabled={false}
        storageScope="scope-a"
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: '/reload' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({ message: '/reload' })))
    expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/agent/reload', expect.anything())
  })

  test('reload-ish hydration uses persisted active id and renders state notices/queue from server snapshot', async () => {
    const persisted = storage({ [activeSessionStorageKey('scope-a')]: 'pi-1' })
    const remote = new FakeRemotePiSession(remoteState({
      status: 'streaming',
      connection: { state: 'reconnecting' },
      queue: { followUps: [{ id: 'q-reload', kind: 'followup', displayText: 'reload queue preview', clientSeq: 1 }] },
      notices: [{ id: 'stale-outbox-cleared', level: 'warning', text: 'Pending messages were dropped during recovery.' }],
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    const createRemoteSession = remoteFactory(remote)

    render(<PiChatPanel serverResourcesEnabled={false} storageScope="scope-a" storage={persisted} fetch={fetchMock as unknown as typeof fetch} createRemoteSession={createRemoteSession} />)

    await waitFor(() => expect(createRemoteSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'pi-1' })))
    expect(screen.getByText('committed from /state')).toBeTruthy()
    expect(screen.getAllByText('reload queue preview').length).toBeGreaterThan(0)
    expect(screen.getByText('Reconnecting to the agent session…')).toBeTruthy()
    expect(screen.getByText('Pending messages were dropped during recovery.')).toBeTruthy()

    const panel = screen.getByText('committed from /state').closest('[data-boring-agent-part="chat"]')
    expect(panel?.getAttribute('data-pi-chat-session-id')).toBe('pi-1')
  })
})
