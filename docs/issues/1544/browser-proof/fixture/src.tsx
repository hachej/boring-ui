import React, { useCallback, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PiChatPanel } from '@proof-chat-panel'
import { ErrorCode } from '@proof-error-codes'
import '@proof-agent-styles'
import './style.css'

type Frame = Record<string, unknown>
const encoder = new TextEncoder()

function ProofApp() {
  const streamRef = useRef<ReadableStreamDefaultController<Uint8Array>>()
  const [completionCount, setCompletionCount] = useState(0)
  const [phase, setPhase] = useState('ready')
  const emit = useCallback((frame: Frame) => streamRef.current?.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`)), [])
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const proofFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.endsWith('/events?cursor=0')) {
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        streamRef.current = controller
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'heartbeat', now: '2026-09-07T00:00:00.000Z' })}\n`))
      } }), {
        headers: { 'content-type': 'application/x-ndjson' },
      })
    }
    if (url.endsWith('/state')) {
      return Response.json({
        ref: { agentTypeId: 'default', sessionId: 'ownership-proof' },
        seq: 0,
        summary: {
          ref: { agentTypeId: 'default', sessionId: 'ownership-proof' },
          title: 'Chat event ownership proof', status: 'idle',
          createdAt: Date.parse('2026-09-07T00:00:00.000Z'), updatedAt: Date.parse('2026-09-07T00:00:00.000Z'),
        },
        state: {
          protocolVersion: 1, sessionId: 'ownership-proof', seq: 0, status: 'idle',
          currentModel: { provider: 'anthropic', id: 'proof-model' },
          messages: [], queue: { followUps: [] }, followUpMode: 'one-at-a-time',
        },
      })
    }
    if (url.endsWith('/prompt') && init?.method === 'POST') {
      void (async () => {
        emit({ type: 'agent-start', seq: 1, turnId: 'turn-current' })
        await sleep(300)
        setPhase('current turn streaming')
        await sleep(700)
        emit({ type: 'agent-end', seq: 2, turnId: 'turn-stale', status: 'ok' })
        await sleep(300)
        setPhase('stale terminal rejected')
        await sleep(700)
        emit({
          type: 'error', seq: 3, turnId: 'turn-current', retryable: false,
          error: { code: ErrorCode.enum.INTERNAL_ERROR, message: 'Deterministic proof failure', retryable: false },
        })
        await sleep(300)
        setPhase('current turn failed')
        await sleep(700)
        emit({ type: 'agent-end', seq: 4, turnId: 'turn-current', status: 'ok' })
        await sleep(300)
        setPhase('contradictory terminal rejected')
        await sleep(700)
        emit({ type: 'agent-start', seq: 5, turnId: 'turn-next' })
        await sleep(300)
        setPhase('valid next turn streaming')
        await sleep(700)
        emit({ type: 'agent-end', seq: 6, turnId: 'turn-next', status: 'ok' })
        await sleep(300)
        setPhase('valid next turn completed')
      })()
      return Response.json({ accepted: true, cursor: 0, clientNonce: 'proof-nonce' })
    }
    setPhase(`unexpected request: ${init?.method ?? 'GET'} ${url}`)
    throw new Error(`Unexpected proof request: ${init?.method ?? 'GET'} ${url}`)
  }, [emit])

  return <main>
    <header>
      <div><p className="eyebrow">PR #1544 · deterministic browser proof</p><h1>Chat event ownership</h1></div>
      <div className="counter" aria-live="polite"><span>Host completion callbacks</span><strong data-testid="completion-count">{completionCount}</strong></div>
    </header>
    <section className="journey">
      <p><strong>Journey:</strong> send one prompt through the real <code>PiChatPanel → RemotePiSession → reducer → callback</code> path.</p>
      <p>The fixture delivers a stale terminal, a real error, a contradictory terminal, then one valid next turn.</p>
      <div className="phase" data-testid="phase"><span>Stream checkpoint</span><strong>{phase}</strong></div>
    </section>
    <section className="chat-shell">
      <PiChatPanel
        sessionId="ownership-proof"
        hydrateMessages
        serverResourcesEnabled={false}
        storageScope="pr-1544-proof"
        fetch={proofFetch as typeof fetch}
        onTurnComplete={() => setCompletionCount((value) => value + 1)}
        className="h-full"
      />
    </section>
  </main>
}

createRoot(document.getElementById('root')!).render(<ProofApp />)
