import type { Page } from '@playwright/test'

export async function installPiNativeMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const stateKey = '__boring_pi_native_e2e_state__'
    const encoder = new TextEncoder()
    const controllers = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>()

    type MockSessionSummary = {
      id: string
      title: string
      createdAt: string
      updatedAt: string
      turnCount: number
    }
    type MockEventStreamFailure = {
      cursor: number
      type: 'replay_gap' | 'cursor_ahead'
      latestSeq: number
      minReplaySeq?: number
      statePatch?: Partial<Pick<MockSessionState, 'seq' | 'status' | 'messages' | 'queue'>>
    }
    type MockPromptFailure = {
      remaining: number
      status?: number
      message?: string
    }
    type MockSessionState = {
      seq: number
      status: 'idle' | 'streaming'
      messages: Array<{ id: string; role: 'user' | 'assistant'; status?: string; clientSeq?: number; clientNonce?: string; parts: unknown[] }>
      queue: { followUps: Array<{ id: string; kind: 'followup'; displayText: string; clientSeq?: number; clientNonce?: string }> }
      prompts: Array<Record<string, unknown>>
      followups: Array<Record<string, unknown>>
      stops: number
      interrupts: number
      clears: number
      reloads: number
      uiCommandDispatches: number
      sessionCreates?: number
      sessionList503Remaining?: number
      sessionListRequests?: number
      sessionList503Served?: number
      eventStreamFailures?: MockEventStreamFailure[]
      eventStreamFailureServed?: number
      promptResponseDelayMs?: number
      promptFailure?: MockPromptFailure
      promptFailuresServed?: number
      promptTextDeltas?: string[]
      promptFinalText?: string
      promptFinalTexts?: string[]
      promptToolResultDelayMs?: number
      promptToolError?: boolean
      promptToolErrorText?: string
      promptToolDescription?: string
    }
    type MockState = MockSessionState & {
      sessions?: MockSessionSummary[]
      sessionStates?: Record<string, Partial<MockSessionState>>
      eventStreamRequests?: Array<{ sessionId: string; cursor: number }>
    }

    const initial = (): MockState => ({
      seq: 0,
      status: 'idle',
      messages: [],
      queue: { followUps: [] },
      prompts: [],
      followups: [],
      stops: 0,
      interrupts: 0,
      clears: 0,
      reloads: 0,
      uiCommandDispatches: 0,
    })
    const load = (): MockState => {
      try {
        const raw = localStorage.getItem(stateKey)
        return raw ? { ...initial(), ...JSON.parse(raw) } : initial()
      } catch {
        return initial()
      }
    }
    const save = (state: MockState) => localStorage.setItem(stateKey, JSON.stringify(state))
    const sessionIdFromUrl = (url: string) => {
      const match = url.match(/\/api\/v1\/agent\/pi-chat\/([^/]+)\//)
      return match ? decodeURIComponent(match[1] ?? '') : undefined
    }
    const cursorFromUrl = (url: string) => {
      try {
        const parsed = new URL(url, window.location.href)
        const raw = parsed.searchParams.get('cursor')
        const cursor = raw === null ? 0 : Number.parseInt(raw, 10)
        return Number.isFinite(cursor) && cursor >= 0 ? cursor : 0
      } catch {
        return 0
      }
    }
    const readSessionState = (root: MockState, sessionId: string): MockSessionState => ({
      ...initial(),
      ...(root.sessionStates?.[sessionId] ?? (sessionId === 'pi-e2e' ? root : {})),
    })
    const writeSessionState = (root: MockState, sessionId: string, sessionState: MockSessionState) => {
      if (root.sessionStates) {
        root.sessionStates[sessionId] = sessionState
        return root
      }
      return { ...root, ...sessionState }
    }
    const nextSeq = (state: MockState) => {
      state.seq += 1
      return state.seq
    }
    const emit = (sessionId: string, frame: unknown) => {
      const line = encoder.encode(`${JSON.stringify(frame)}\n`)
      const sessionControllers = controllers.get(sessionId)
      for (const controller of sessionControllers ?? []) {
        try {
          controller.enqueue(line)
        } catch {
          sessionControllers?.delete(controller)
        }
      }
    }
    const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
    const snapshot = (sessionId: string, state: MockState) => ({
      protocolVersion: 1,
      sessionId,
      seq: state.seq,
      status: state.status,
      messages: state.messages,
      queue: state.queue,
      followUpMode: 'one-at-a-time',
    })
    const finalAssistant = (id: string, parts: unknown[]) => ({ id, role: 'assistant' as const, status: 'done', parts })
    const emitPiE2E = (frame: unknown) => emit('pi-e2e', frame)

    const originalFetch = window.fetch.bind(window)
    window.addEventListener('boring:ui-command', () => {
      const state = load()
      state.uiCommandDispatches += 1
      save(state)
    })
    ;(window as unknown as { __piNativeE2EState: () => MockState }).__piNativeE2EState = load
    ;(window as unknown as { __piNativeE2EEmit: (sessionId: string, frame: unknown) => void }).__piNativeE2EEmit = emit

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      // The chat appends query params to some endpoints (e.g.
      // /pi-chat/sessions?activeSessionId=...). Match on the path so a query
      // string doesn't make an exact-match route fall through to the real backend.
      const pathname = url.split('?')[0] ?? url
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      const state = load()

      if (pathname.endsWith('/api/v1/agent/models') && method === 'GET') {
        return json({
          models: [
            { provider: 'anthropic', id: 'claude-sonnet', label: 'Claude Sonnet', available: true },
            { provider: 'anthropic', id: 'claude-opus', label: 'Claude Opus', available: true },
            { provider: 'openai', id: 'gpt-main', label: 'GPT Main', available: true },
            { provider: 'openai', id: 'gpt-fast', label: 'GPT Fast', available: true },
          ],
          defaultModel: { provider: 'anthropic', id: 'claude-sonnet' },
        })
      }
      if (pathname.endsWith('/api/v1/agent/pi-chat/sessions') && method === 'GET') {
        state.sessionListRequests = (state.sessionListRequests ?? 0) + 1
        if ((state.sessionList503Remaining ?? 0) > 0) {
          state.sessionList503Remaining = (state.sessionList503Remaining ?? 0) - 1
          state.sessionList503Served = (state.sessionList503Served ?? 0) + 1
          save(state)
          return json({ error: { message: 'preparing' } }, { status: 503 })
        }
        save(state)
        return json(state.sessions ?? [{ id: 'pi-e2e', title: 'Pi Native E2E', createdAt: '2026-06-03T00:00:00.000Z', updatedAt: '2026-06-03T00:00:00.000Z', turnCount: state.messages.length }])
      }
      if (pathname.endsWith('/api/v1/agent/pi-chat/sessions') && method === 'POST') {
        state.sessionCreates = (state.sessionCreates ?? 0) + 1
        save(state)
        return json({ id: 'pi-e2e-new', title: 'New Pi Native E2E', createdAt: '2026-06-03T00:00:00.000Z', updatedAt: '2026-06-03T00:00:00.000Z', turnCount: 0 }, { status: 201 })
      }
      const sessionId = sessionIdFromUrl(url)
      if (sessionId && url.includes(`/api/v1/agent/pi-chat/${encodeURIComponent(sessionId)}/state`)) {
        return json(snapshot(sessionId, readSessionState(state, sessionId)))
      }
      if (sessionId && url.includes(`/api/v1/agent/pi-chat/${encodeURIComponent(sessionId)}/events`)) {
        const cursor = cursorFromUrl(url)
        state.eventStreamRequests = [...(state.eventStreamRequests ?? []), { sessionId, cursor }]
        const sessionState = readSessionState(state, sessionId)
        const failureIndex = sessionState.eventStreamFailures?.findIndex((failure) => failure.cursor === cursor) ?? -1
        if (failureIndex >= 0) {
          const failures = [...(sessionState.eventStreamFailures ?? [])]
          const [failure] = failures.splice(failureIndex, 1)
          if (failure) {
            Object.assign(sessionState, failure.statePatch ?? {})
            if (failure.statePatch?.seq === undefined) sessionState.seq = Math.max(sessionState.seq, failure.latestSeq)
            sessionState.eventStreamFailures = failures
            sessionState.eventStreamFailureServed = (sessionState.eventStreamFailureServed ?? 0) + 1
            save(writeSessionState(state, sessionId, sessionState))
            return json({
              error: {
                message: failure.type,
                details: {
                  reason: failure.type,
                  latestSeq: failure.latestSeq,
                  minReplaySeq: failure.minReplaySeq ?? failure.latestSeq,
                },
              },
            }, { status: 409 })
          }
        }
        save(state)
        let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller
            const sessionControllers = controllers.get(sessionId) ?? new Set<ReadableStreamDefaultController<Uint8Array>>()
            sessionControllers.add(controller)
            controllers.set(sessionId, sessionControllers)
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'heartbeat', now: new Date().toISOString() })}\n`))
          },
          cancel() {
            if (streamController) controllers.get(sessionId)?.delete(streamController)
          },
        })
        return new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
      }
      if (url.includes('/api/v1/agent/pi-chat/pi-e2e/prompt') && method === 'POST') {
        const payload = JSON.parse(String(init?.body ?? '{}')) as { message: string; clientNonce: string; model?: unknown; thinkingLevel?: unknown }
        if ((state.promptResponseDelayMs ?? 0) > 0) {
          await new Promise((resolve) => setTimeout(resolve, state.promptResponseDelayMs))
        }
        if (state.promptFailure && state.promptFailure.remaining > 0) {
          const failure = state.promptFailure
          state.promptFailure = { ...failure, remaining: failure.remaining - 1 }
          state.promptFailuresServed = (state.promptFailuresServed ?? 0) + 1
          save(state)
          return json({
            error: {
              message: failure.message ?? 'simulated prompt failure',
            },
          }, { status: failure.status ?? 500 })
        }
        state.prompts.push({
          message: '<redacted>',
          clientNonce: payload.clientNonce,
          ...(payload.model ? { model: payload.model } : {}),
          ...(payload.thinkingLevel ? { thinkingLevel: payload.thinkingLevel } : {}),
        })
        const turnIndex = state.prompts.length
        const userId = `u${turnIndex}`
        const assistantId = `a${turnIndex}`
        const reasoningId = `r${turnIndex}`
        const toolId = `tool-${turnIndex}`
        const textId = `t${turnIndex}`
        state.status = 'streaming'
        nextSeq(state); emitPiE2E({ type: 'agent-start', seq: state.seq, turnId: `turn-${turnIndex}` })
        nextSeq(state); emitPiE2E({ type: 'message-start', seq: state.seq, messageId: userId, role: 'user', clientNonce: payload.clientNonce, text: payload.message })
        nextSeq(state); emitPiE2E({ type: 'message-start', seq: state.seq, messageId: assistantId, role: 'assistant' })
        nextSeq(state); emitPiE2E({ type: 'message-delta', seq: state.seq, messageId: assistantId, partId: reasoningId, kind: 'reasoning', delta: 'Reasoning visible' })
        nextSeq(state); emitPiE2E({ type: 'message-part-end', seq: state.seq, messageId: assistantId, partId: reasoningId, kind: 'reasoning', text: 'Reasoning visible' })
        const toolInput = {
          command: 'printf redacted',
          ...(state.promptToolDescription ? { description: state.promptToolDescription } : {}),
        }
        nextSeq(state); emitPiE2E({ type: 'tool-call', seq: state.seq, messageId: assistantId, toolCallId: toolId, toolName: 'bash', input: toolInput })
        if ((state.promptToolResultDelayMs ?? 0) > 0) {
          await new Promise((resolve) => setTimeout(resolve, state.promptToolResultDelayMs))
        }
        const promptToolErrorText = state.promptToolErrorText ?? 'TOOL_E2E_ERROR'
        const toolOutput = state.promptToolError
          ? { content: promptToolErrorText, errorText: promptToolErrorText }
          : { stdout: 'TOOL_E2E_OUTPUT' }
        nextSeq(state); emitPiE2E({
          type: 'tool-result',
          seq: state.seq,
          messageId: assistantId,
          toolCallId: toolId,
          output: toolOutput,
          isError: state.promptToolError === true,
          ...(state.promptToolError ? { errorText: promptToolErrorText } : {}),
        })
        const promptFinalText = state.promptFinalTexts?.[turnIndex - 1] ?? state.promptFinalText ?? 'PI_NATIVE_ASSISTANT_DONE'
        const textDeltas = state.promptTextDeltas?.length ? state.promptTextDeltas : [promptFinalText]
        for (const delta of textDeltas) {
          nextSeq(state); emitPiE2E({ type: 'message-delta', seq: state.seq, messageId: assistantId, partId: textId, kind: 'text', delta })
        }
        nextSeq(state); emitPiE2E({ type: 'message-part-end', seq: state.seq, messageId: assistantId, partId: textId, kind: 'text', text: promptFinalText })
        nextSeq(state); emitPiE2E({ type: 'file-changed', seq: state.seq, path: 'src/pi-native-e2e.ts', changeType: 'write' })
        nextSeq(state); emitPiE2E({ type: 'ui-command', seq: state.seq, command: { kind: 'openFile', params: { path: 'src/pi-native-e2e.ts' } }, displayOnly: true })
        const assistant = finalAssistant(assistantId, [
          { type: 'reasoning', id: reasoningId, text: 'Reasoning visible', state: 'done' },
          {
            type: 'tool-call',
            id: toolId,
            toolName: 'bash',
            state: state.promptToolError ? 'output-error' : 'output-available',
            input: toolInput,
            output: toolOutput,
            ...(state.promptToolError ? { errorText: promptToolErrorText } : {}),
          },
          { type: 'text', id: textId, text: promptFinalText },
        ])
        state.messages = [
          ...state.messages,
          { id: userId, role: 'user', status: 'done', clientNonce: payload.clientNonce, parts: [{ type: 'text', id: `${userId}:t`, text: '<redacted user prompt>' }] },
          assistant,
        ]
        nextSeq(state); emitPiE2E({ type: 'message-end', seq: state.seq, messageId: assistantId, final: assistant })
        state.status = 'idle'
        nextSeq(state); emitPiE2E({ type: 'agent-end', seq: state.seq, turnId: `turn-${turnIndex}`, status: 'ok' })
        save(state)
        return json({ accepted: true, cursor: state.seq, clientNonce: payload.clientNonce })
      }
      if (url.includes('/api/v1/agent/pi-chat/pi-e2e/followup') && method === 'POST') {
        const payload = JSON.parse(String(init?.body ?? '{}')) as { message: string; clientNonce: string; clientSeq: number }
        state.followups.push({ message: '<redacted>', clientSeq: payload.clientSeq, clientNonce: payload.clientNonce })
        state.status = 'streaming'
        state.queue.followUps.push({ id: `q${payload.clientSeq}`, kind: 'followup', displayText: payload.message, clientSeq: payload.clientSeq, clientNonce: payload.clientNonce })
        nextSeq(state); emitPiE2E({ type: 'queue-updated', seq: state.seq, queue: state.queue })
        save(state)
        return json({ accepted: true, cursor: state.seq, clientNonce: payload.clientNonce, clientSeq: payload.clientSeq, queued: true })
      }
      if (url.includes('/api/v1/agent/pi-chat/pi-e2e/queue/clear') && method === 'POST') {
        const payload = JSON.parse(String(init?.body ?? '{}')) as { clientNonce?: string; clientSeq?: number }
        const before = state.queue.followUps.length
        if (payload.clientNonce || payload.clientSeq !== undefined) {
          state.queue.followUps = state.queue.followUps.filter((followUp) => !(
            (payload.clientNonce && followUp.clientNonce === payload.clientNonce)
            || (payload.clientSeq !== undefined && followUp.clientSeq === payload.clientSeq)
          ))
        } else {
          state.queue.followUps = []
        }
        const cleared = before - state.queue.followUps.length
        state.clears += 1
        nextSeq(state); emitPiE2E({ type: 'queue-updated', seq: state.seq, queue: state.queue })
        save(state)
        return json({ accepted: true, cursor: state.seq, cleared })
      }
      if (url.includes('/api/v1/agent/pi-chat/pi-e2e/stop') && method === 'POST') {
        state.stops += 1
        state.status = 'idle'
        const clearedQueue = state.queue.followUps
        state.queue.followUps = []
        nextSeq(state); emitPiE2E({ type: 'agent-end', seq: state.seq, turnId: 'turn-1', status: 'aborted' })
        save(state)
        return json({ accepted: true, cursor: state.seq, stopped: true, clearedQueue })
      }
      if (url.includes('/api/v1/agent/pi-chat/pi-e2e/interrupt') && method === 'POST') {
        state.interrupts += 1
        state.status = 'idle'
        nextSeq(state); emitPiE2E({ type: 'agent-end', seq: state.seq, turnId: 'turn-1', status: 'aborted' })
        const next = state.queue.followUps.shift()
        if (next) {
          const userId = `u-followup-${next.clientSeq ?? state.interrupts}`
          const assistantId = `a-followup-${next.clientSeq ?? state.interrupts}`
          nextSeq(state); emitPiE2E({ type: 'agent-start', seq: state.seq, turnId: `turn-followup-${next.clientSeq ?? state.interrupts}` })
          nextSeq(state); emitPiE2E({
            type: 'message-start',
            seq: state.seq,
            messageId: userId,
            role: 'user',
            clientNonce: next.clientNonce,
            clientSeq: next.clientSeq,
            text: next.displayText,
          })
          nextSeq(state); emitPiE2E({ type: 'followup-consumed', seq: state.seq, messageId: userId, clientNonce: next.clientNonce, clientSeq: next.clientSeq })
          nextSeq(state); emitPiE2E({ type: 'queue-updated', seq: state.seq, queue: state.queue })
          nextSeq(state); emitPiE2E({ type: 'message-start', seq: state.seq, messageId: assistantId, role: 'assistant' })
          nextSeq(state); emitPiE2E({ type: 'message-delta', seq: state.seq, messageId: assistantId, partId: `${assistantId}:text`, kind: 'text', delta: 'AUTO_POSTED_FOLLOWUP_DONE' })
          const assistant = finalAssistant(assistantId, [{ type: 'text', id: `${assistantId}:text`, text: 'AUTO_POSTED_FOLLOWUP_DONE' }])
          state.messages = [
            ...state.messages,
            { id: userId, role: 'user', status: 'done', clientNonce: next.clientNonce, clientSeq: next.clientSeq, parts: [{ type: 'text', id: `${userId}:text`, text: next.displayText }] },
            assistant,
          ]
          nextSeq(state); emitPiE2E({ type: 'message-end', seq: state.seq, messageId: assistantId, final: assistant })
          nextSeq(state); emitPiE2E({ type: 'agent-end', seq: state.seq, turnId: `turn-followup-${next.clientSeq ?? state.interrupts}`, status: 'ok' })
        }
        save(state)
        return json({ accepted: true, cursor: state.seq })
      }
      if (pathname.endsWith('/api/v1/agent/reload') && method === 'POST') {
        state.reloads += 1
        save(state)
        window.dispatchEvent(new CustomEvent('boring-ui:agent-plugins-reloaded', { detail: { reloaded: true, diagnostics: [] } }))
        return json({ reloaded: true, diagnostics: [] })
      }
      return originalFetch(input, init)
    }
  })
}
