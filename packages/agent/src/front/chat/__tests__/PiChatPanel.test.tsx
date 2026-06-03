// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import type { SessionSummary } from '../../../shared/session'
import { createInitialPiChatState, type PiChatState } from '../pi/piChatReducer'
import type { RemotePiSession, RemotePiSessionOptions } from '../pi/remotePiSession'
import { activeSessionStorageKey, type ActiveSessionStorageLike } from '../session'
import { PiChatPanel } from '../PiChatPanel'

vi.mock('../components', () => ({
  MessageTimeline: ({ messages, queuePreview }: any) => (
    <div data-boring-agent-part="message-timeline">
      {messages.map((message: any) => (
        <article key={message.id} data-boring-agent-message-id={message.id}>
          {message.parts.map((part: any, index: number) => <span key={part.id ?? index}>{part.text ?? part.displayText ?? part.filename ?? part.toolName}</span>)}
        </article>
      ))}
      {queuePreview?.length ? (
        <div data-boring-agent-part="queue-preview">
          {queuePreview.map((item: any) => <span key={item.id}>{item.displayText}</span>)}
        </div>
      ) : null}
    </div>
  ),
  RuntimeNotices: ({ notices, onDismiss }: any) => (
    <div data-boring-agent-part="runtime-notices">
      {notices.map((notice: any) => (
        <button key={notice.id} type="button" onClick={() => onDismiss?.(notice.id)}>{notice.text}</button>
      ))}
    </div>
  ),
  ComposerBar: ({ value, onValueChange, onSend, onStop, onEditQueued, rightControls, disabled, queuePreview }: any) => (
    <div data-boring-agent-part="composer-bar" data-disabled={String(Boolean(disabled))}>
      <textarea aria-label="Agent prompt" value={value ?? ''} onChange={(event) => onValueChange?.(event.currentTarget.value)} />
      <button type="button" onClick={() => onSend({ text: value ?? '', files: [] })}>Send</button>
      <button type="button" onClick={onStop}>Stop</button>
      {onEditQueued ? <button type="button" onClick={() => onEditQueued(queuePreview)}>Edit queued</button> : null}
      {rightControls}
    </div>
  ),
}))

function session(id: string, title = `Session ${id}`): SessionSummary {
  return { id, title, createdAt: '2026-06-03T00:00:00.000Z', updatedAt: '2026-06-03T00:01:00.000Z', turnCount: 1 }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
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
  readonly followUp = vi.fn(async () => ({ accepted: true, cursor: this.state.lastSeq + 1, clientNonce: 'nonce', clientSeq: 1, queued: true }))
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
  const factory = vi.fn((_options: RemotePiSessionOptions) => remote as unknown as RemotePiSession)
  return factory
}

describe('PiChatPanel sandbox shell', () => {
  test('imports no old chat hooks/projection/AI SDK stream contracts', () => {
    const source = readFileSync('src/front/chat/PiChatPanel.tsx', 'utf8')
    for (const forbidden of ['use' + 'AgentChat', 'piChat' + 'Projection', 'piNative' + 'FollowUpQueue', '@ai-sdk' + '/react', 'use' + 'Chat', 'UIMessageChunk']) {
      expect(source).not.toContain(forbidden)
    }
  })

  test('hydrates selected Pi session from usePiSessions and can create a new session', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([session('pi-1', 'Running Pi session')]))
      .mockResolvedValueOnce(jsonResponse(session('pi-new', 'New session'), 201))
      .mockResolvedValueOnce(jsonResponse([session('pi-new', 'New session'), session('pi-1', 'Running Pi session')]))
    const createRemoteSession = remoteFactory(remote)

    render(<PiChatPanel storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={createRemoteSession} />)

    await waitFor(() => expect(screen.getByText('committed from /state')).toBeTruthy())
    expect(screen.getAllByText('Running Pi session').length).toBeGreaterThan(0)
    expect(screen.getByText('connected')).toBeTruthy()
    expect(createRemoteSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'pi-1', storageScope: 'scope-a' }))

    const textarea = screen.getByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: 'first prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({ message: 'first prompt' })))

    fireEvent.click(screen.getAllByRole('button', { name: /new/i })[0]!)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/agent/pi-chat/sessions', expect.objectContaining({ method: 'POST' })))
  })

  test('sends first prompts, queues busy follow-ups, edits queued text, and exposes stop/interrupt', async () => {
    const remote = new FakeRemotePiSession(remoteState({
      status: 'streaming',
      queue: { followUps: [{ id: 'q1', kind: 'followup', displayText: 'queued from server', clientSeq: 4 }] },
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    render(<PiChatPanel storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    const textarea = await screen.findByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: 'next while busy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(remote.followUp).toHaveBeenCalledWith(expect.objectContaining({ message: 'next while busy', clientSeq: 5 })))
    act(() => {
      remote.setState({ ...remote.state, connection: { state: 'connected', lastHeartbeatAt: 123 } })
    })
    fireEvent.change(textarea, { target: { value: 'second while busy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(remote.followUp).toHaveBeenCalledWith(expect.objectContaining({ message: 'second while busy', clientSeq: 6 })))
    expect(remote.prompt).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Edit queued' }))
    await waitFor(() => expect(remote.clearQueue).toHaveBeenCalledTimes(1))
    expect((textarea as HTMLTextAreaElement).value).toContain('queued from server')

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }))
    await waitFor(() => expect(remote.stop).toHaveBeenCalledTimes(1))
    expect(remote.interrupt).toHaveBeenCalledTimes(1)
  })

  test('renders safe debug metadata, status announcements, and large-state warning without prompt bodies', async () => {
    const remote = new FakeRemotePiSession(remoteState({
      status: 'streaming',
      connection: { state: 'reconnecting', lastHeartbeatAt: 123 },
      committedMessages: [
        { id: 'u-secret', role: 'user', status: 'done', parts: [{ type: 'text', id: 'secret:text', text: 'SECRET_PROMPT_BODY /home/ubuntu/project/file.txt' }] },
        { id: 'a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'a1:text', text: 'visible answer' }] },
      ],
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))

    render(<PiChatPanel debug storageScope="scope-a" fetch={fetchMock as unknown as typeof fetch} createRemoteSession={remoteFactory(remote)} />)

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('reconnecting'))
    expect(screen.getByText(/Large Pi chat state/)).toBeTruthy()
    const debugPanel = screen.getByLabelText('Pi chat debug metadata')
    expect(debugPanel.textContent).toContain('"sessionId": "pi-1"')
    expect(debugPanel.textContent).toContain('"lastSeq": 7')
    expect(debugPanel.textContent).toContain('"gapCount": 1')
    expect(debugPanel.textContent).toContain('"followUps": 0')
    expect(debugPanel.textContent).not.toContain('SECRET_PROMPT_BODY')
    expect(debugPanel.textContent).not.toContain('/home/ubuntu/project/file.txt')
    expect(screen.getByText('visible answer')).toBeTruthy()
  })

  test('runs /reload through the injected plugin reload callback', async () => {
    const remote = new FakeRemotePiSession(remoteState())
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/v1/agent/pi-chat/sessions')) return jsonResponse([session('pi-1')])
      throw new Error(`unexpected fetch ${url}`)
    })
    const onReloadAgentPlugins = vi.fn(async () => 'Agent plugins reloaded.\n\nWarnings:\nrebuilt plugin front')
    const onCommandResult = vi.fn()

    render(
      <PiChatPanel
        storageScope="workspace-a"
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
        onReloadAgentPlugins={onReloadAgentPlugins}
        onCommandResult={onCommandResult}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: '/reload' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(onReloadAgentPlugins).toHaveBeenCalledTimes(1))
    expect(onCommandResult).toHaveBeenCalledWith(expect.stringContaining('Agent plugins reloaded.'))
    expect(onCommandResult).toHaveBeenCalledWith(expect.stringContaining('rebuilt plugin front'))
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
        storageScope="scope-a"
        fetch={fetchMock as unknown as typeof fetch}
        createRemoteSession={remoteFactory(remote)}
      />,
    )

    const textarea = await screen.findByLabelText('Agent prompt')
    fireEvent.change(textarea, { target: { value: '/reload' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(remote.prompt).toHaveBeenCalledWith(expect.objectContaining({ message: '/reload' })))
    expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/agent/reload', expect.anything())
  })

  test('reload-ish hydration uses persisted active id and renders state notices/queue from server snapshot', async () => {
    const persisted = storage({ [activeSessionStorageKey('scope-a')]: 'pi-1' })
    const remote = new FakeRemotePiSession(remoteState({
      status: 'streaming',
      connection: { state: 'reconnecting' },
      queue: { followUps: [{ id: 'q-reload', kind: 'followup', displayText: 'reload queue preview', clientSeq: 1 }] },
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([session('pi-1')]))
    const createRemoteSession = remoteFactory(remote)

    render(<PiChatPanel storageScope="scope-a" storage={persisted} fetch={fetchMock as unknown as typeof fetch} createRemoteSession={createRemoteSession} />)

    await waitFor(() => expect(createRemoteSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'pi-1' })))
    expect(screen.getByText('committed from /state')).toBeTruthy()
    expect(screen.getByText('reload queue preview')).toBeTruthy()
    expect(screen.getByText('Reconnecting to the agent session…')).toBeTruthy()

    const panel = screen.getByText('committed from /state').closest('[data-boring-agent-part="pi-chat-panel"]')
    expect(panel?.getAttribute('data-pi-chat-session-id')).toBe('pi-1')
  })
})
