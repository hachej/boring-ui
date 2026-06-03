import type { Page } from '@playwright/test'

export async function installPiNativeMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const stateKey = '__boring_pi_native_e2e_state__'
    const encoder = new TextEncoder()
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = []

    type MockState = {
      seq: number
      status: 'idle' | 'streaming'
      messages: Array<{ id: string; role: 'user' | 'assistant'; status?: string; parts: unknown[] }>
      queue: { followUps: Array<{ id: string; kind: 'followup'; displayText: string; clientSeq?: number; clientNonce?: string }> }
      prompts: Array<Record<string, unknown>>
      followups: Array<Record<string, unknown>>
      stops: number
      interrupts: number
      clears: number
      reloads: number
      uiCommandDispatches: number
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
    const nextSeq = (state: MockState) => {
      state.seq += 1
      return state.seq
    }
    const emit = (frame: unknown) => {
      const line = encoder.encode(`${JSON.stringify(frame)}\n`)
      for (const controller of controllers) controller.enqueue(line)
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

    const originalFetch = window.fetch.bind(window)
    window.addEventListener('boring:ui-command', () => {
      const state = load()
      state.uiCommandDispatches += 1
      save(state)
    })
    ;(window as unknown as { __piNativeE2EState: () => MockState }).__piNativeE2EState = load

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      const state = load()

      if (url.endsWith('/api/v1/agent/pi-chat/sessions') && method === 'GET') {
        return json([{ id: 'pi-e2e', title: 'Pi Native E2E', createdAt: '2026-06-03T00:00:00.000Z', updatedAt: '2026-06-03T00:00:00.000Z', turnCount: state.messages.length }])
      }
      if (url.endsWith('/api/v1/agent/pi-chat/sessions') && method === 'POST') {
        return json({ id: 'pi-e2e-new', title: 'New Pi Native E2E', createdAt: '2026-06-03T00:00:00.000Z', updatedAt: '2026-06-03T00:00:00.000Z', turnCount: 0 }, { status: 201 })
      }
      if (url.includes('/api/v1/agent/pi-chat/pi-e2e/state')) {
        return json(snapshot('pi-e2e', state))
      }
      if (url.includes('/api/v1/agent/pi-chat/pi-e2e/events')) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controllers.push(controller)
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'heartbeat', now: new Date().toISOString() })}\n`))
          },
          cancel() {
            // Test streams are short-lived and scoped to one page context.
          },
        })
        return new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
      }
      if (url.includes('/api/v1/agent/pi-chat/pi-e2e/prompt') && method === 'POST') {
        const payload = JSON.parse(String(init?.body ?? '{}')) as { message: string; clientNonce: string }
        state.prompts.push({ message: '<redacted>', clientNonce: payload.clientNonce })
        state.status = 'streaming'
        nextSeq(state); emit({ type: 'agent-start', seq: state.seq, turnId: 'turn-1' })
        nextSeq(state); emit({ type: 'message-start', seq: state.seq, messageId: 'a1', role: 'assistant' })
        nextSeq(state); emit({ type: 'message-delta', seq: state.seq, messageId: 'a1', partId: 'r1', kind: 'reasoning', delta: 'Reasoning visible' })
        nextSeq(state); emit({ type: 'message-part-end', seq: state.seq, messageId: 'a1', partId: 'r1', kind: 'reasoning', text: 'Reasoning visible' })
        nextSeq(state); emit({ type: 'tool-call', seq: state.seq, messageId: 'a1', toolCallId: 'tool-1', toolName: 'bash', input: { command: 'printf redacted' } })
        nextSeq(state); emit({ type: 'tool-result', seq: state.seq, messageId: 'a1', toolCallId: 'tool-1', output: 'TOOL_E2E_OUTPUT' })
        nextSeq(state); emit({ type: 'message-delta', seq: state.seq, messageId: 'a1', partId: 't1', kind: 'text', delta: 'PI_NATIVE_ASSISTANT_DONE' })
        nextSeq(state); emit({ type: 'message-part-end', seq: state.seq, messageId: 'a1', partId: 't1', kind: 'text', text: 'PI_NATIVE_ASSISTANT_DONE' })
        nextSeq(state); emit({ type: 'file-changed', seq: state.seq, path: 'src/pi-native-e2e.ts', changeType: 'write' })
        nextSeq(state); emit({ type: 'ui-command', seq: state.seq, command: { kind: 'openFile', params: { path: 'src/pi-native-e2e.ts' } }, displayOnly: true })
        const assistant = finalAssistant('a1', [
          { type: 'reasoning', id: 'r1', text: 'Reasoning visible', state: 'done' },
          { type: 'tool-call', id: 'tool-1', toolName: 'bash', state: 'output-available', input: { command: 'printf redacted' }, output: 'TOOL_E2E_OUTPUT' },
          { type: 'text', id: 't1', text: 'PI_NATIVE_ASSISTANT_DONE' },
        ])
        state.messages = [
          { id: 'u1', role: 'user', status: 'done', clientNonce: payload.clientNonce, parts: [{ type: 'text', id: 'u1:t', text: '<redacted user prompt>' }] },
          assistant,
        ]
        nextSeq(state); emit({ type: 'message-end', seq: state.seq, messageId: 'a1', final: assistant })
        state.status = 'streaming'
        save(state)
        return json({ accepted: true, cursor: state.seq, clientNonce: payload.clientNonce })
      }
      if (url.includes('/api/v1/agent/pi-chat/pi-e2e/followup') && method === 'POST') {
        const payload = JSON.parse(String(init?.body ?? '{}')) as { message: string; clientNonce: string; clientSeq: number }
        state.followups.push({ message: '<redacted>', clientSeq: payload.clientSeq, clientNonce: payload.clientNonce })
        state.status = 'streaming'
        state.queue.followUps.push({ id: `q${payload.clientSeq}`, kind: 'followup', displayText: payload.message, clientSeq: payload.clientSeq, clientNonce: payload.clientNonce })
        nextSeq(state); emit({ type: 'queue-updated', seq: state.seq, queue: state.queue })
        save(state)
        return json({ accepted: true, cursor: state.seq, clientNonce: payload.clientNonce, clientSeq: payload.clientSeq, queued: true })
      }
      if (url.includes('/api/v1/agent/pi-chat/pi-e2e/queue/clear') && method === 'POST') {
        const cleared = state.queue.followUps.length
        state.queue.followUps = []
        state.clears += 1
        nextSeq(state); emit({ type: 'queue-updated', seq: state.seq, queue: state.queue })
        save(state)
        return json({ accepted: true, cursor: state.seq, cleared })
      }
      if (url.includes('/api/v1/agent/pi-chat/pi-e2e/stop') && method === 'POST') {
        state.stops += 1
        state.status = 'idle'
        const clearedQueue = state.queue.followUps
        state.queue.followUps = []
        nextSeq(state); emit({ type: 'agent-end', seq: state.seq, turnId: 'turn-1', status: 'aborted' })
        save(state)
        return json({ accepted: true, cursor: state.seq, stopped: true, clearedQueue })
      }
      if (url.includes('/api/v1/agent/pi-chat/pi-e2e/interrupt') && method === 'POST') {
        state.interrupts += 1
        save(state)
        return json({ accepted: true, cursor: state.seq })
      }
      if (url.endsWith('/api/v1/agent/reload') && method === 'POST') {
        state.reloads += 1
        save(state)
        window.dispatchEvent(new CustomEvent('boring-ui:agent-plugins-reloaded', { detail: { reloaded: true, diagnostics: [] } }))
        return json({ reloaded: true, diagnostics: [] })
      }
      return originalFetch(input, init)
    }
  })
}
